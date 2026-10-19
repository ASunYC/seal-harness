import { createHash } from 'node:crypto'
import { dirname, join } from 'node:path'
import { mkdir } from 'node:fs/promises'
import { spawn } from 'node:child_process'
import { dbx, dbxArtifacts } from './catalog.js'
import { AppError, cachedArtifact, installRuntime, removeManaged, verifyExecutable } from './installer.js'
import { assertNoOtherDbx, assertDbxStopped } from './launcher.js'

export class ApplicationsService {
  constructor({ storage, identity, connectors, logger, platform = process.platform, arch = process.arch, download, launch = spawn, checkRunning = assertNoOtherDbx, checkStopped = assertDbxStopped }) {
    Object.assign(this, { storage, identity, connectors, logger, platform, arch, download, launch, checkRunning, checkStopped })
    this.download ??= (artifact, signal, progress) => cachedArtifact(join(dirname(storage.path), 'applications', 'cache'), artifact, signal, progress)
    this.jobs = new Map(); this.children = new Map(); this.lifetime = new AbortController()
  }
  account() {
    const session = this.identity.getSession()
    if (!session?.accountId) throw new AppError('请先登录本机账号。')
    return session
  }
  assertAccount(account) {
    this.lifetime.signal.throwIfAborted()
    const current = this.account()
    if (current.accountId !== account.accountId || current.epoch !== account.epoch) throw new AppError('账号已变化，操作已取消。')
  }
  paths(accountId) {
    const root = join(dirname(this.storage.path), 'applications', createHash('sha256').update(accountId).digest('hex'), 'dbx')
    return { root, runtime: join(root, 'runtime'), data: join(root, 'data') }
  }
  record(accountId) { return this.storage.db.prepare('SELECT * FROM application_installations WHERE user_id = ? AND app_id = ?').get(accountId, 'dbx') }
  save(accountId, state, manifest = {}) {
    this.storage.db.prepare(`INSERT INTO application_installations (user_id, app_id, state, manifest_json, installed_at) VALUES (?, 'dbx', ?, ?, ?)
      ON CONFLICT(user_id, app_id) DO UPDATE SET state=excluded.state, manifest_json=excluded.manifest_json, installed_at=excluded.installed_at`)
      .run(accountId, state, JSON.stringify(manifest), new Date().toISOString())
  }
  async list() {
    const account = this.account(), { accountId } = account, row = this.record(accountId), job = this.jobs.get(accountId)
    const snapshot = await this.connectors.call('list')
    this.assertAccount(account)
    const connector = snapshot.items.find(item => item.managedApplication === 'dbx')
    return { items: [{ ...dbx, supported: this.platform === 'win32' && ['x64', 'arm64'].includes(this.arch),
      installed: row?.state === 'installed' || row?.state === 'uninstalling', state: job?.busy ? job.action : row?.state === 'installed' ? 'installed' : row ? 'interrupted' : 'uninstalled',
      progress: job?.progress ?? null, error: job?.error ?? (row && row.state !== 'installed' && !job?.busy ? '上次操作未完成，请重试安装或卸载。' : ''),
      mcpStatus: connector?.status ?? 'uninstalled', toolCount: connector?.tools?.length ?? 0,
      connectorId: connector?.id ?? null, version: row?.state === 'installed' ? JSON.parse(row.manifest_json).version : dbx.version,
    }] }
  }
  start(action) {
    const account = this.account(), key = account.accountId
    if (this.jobs.get(key)?.busy) throw new AppError('应用正在处理，请等待完成。')
    if (action === 'install') dbxArtifacts(this.platform, this.arch)
    const job = { action, busy: true, progress: null, error: '', controller: new AbortController() }
    this.jobs.set(key, job)
    const signal = AbortSignal.any([job.controller.signal, this.lifetime.signal])
    job.promise = (action === 'install' ? this.install(account, signal, job) : action === 'connect' ? this.connectInstalled(account, signal) : this.uninstall(account, signal)).catch(error => {
      job.error = error instanceof AppError ? error.message : signal.aborted ? '操作已取消，可重新尝试。' : '操作未完成，请重试；卸载前请先退出 DBX（包括托盘）。'
      this.logger?.warn('应用 %s 失败：%s', action, String(error))
    }).finally(() => { job.busy = false; job.progress = null })
    return { accepted: true }
  }
  async install(account, signal, job) {
    const { accountId } = account, paths = this.paths(accountId), current = this.record(accountId)
    if (current?.state === 'installed') { await this.connect(account, JSON.parse(current.manifest_json), signal); return }
    await mkdir(paths.root, { recursive: true }); await mkdir(paths.data, { recursive: true })
    await this.connectors.call('removeApplication', { appId: 'dbx', expectedAccountId: accountId }, signal)
    this.assertAccount(account)
    this.save(accountId, 'installing')
    let installed = false
    try {
      const files = await installRuntime(paths.root, dbxArtifacts(this.platform, this.arch), signal, progress => { job.progress = progress }, this.download)
      this.assertAccount(account)
      const manifest = { version: dbx.version, mcpVersion: dbx.mcpVersion, files }
      this.save(accountId, 'installed', manifest); installed = true
      await this.connect(account, manifest, signal)
      this.logger?.info('DBX %s 和 MCP %s 已安装。', dbx.version, dbx.mcpVersion)
    } finally {
      if (!installed) {
        await removeManaged(paths.root, paths.runtime)
        this.storage.db.prepare("DELETE FROM application_installations WHERE user_id = ? AND app_id = 'dbx'").run(accountId)
      }
    }
  }
  async connect(account, manifest, signal = this.lifetime.signal) {
    this.assertAccount(account)
    const paths = this.paths(account.accountId)
    const command = await verifyExecutable(paths.runtime, manifest.files.mcp)
    this.assertAccount(account)
    const snapshot = await this.connectors.call('registerApplication', { appId: 'dbx', expectedAccountId: account.accountId, command, cwd: paths.data, dataDir: paths.data }, signal)
    const connector = snapshot.items.find(item => item.managedApplication === 'dbx')
    if (connector?.status !== 'active') throw new AppError('DBX 已安装，MCP 尚未就绪。请先打开 DBX 完成初始化，再点击“连接 MCP”。')
  }
  async restore() {
    const account = this.identity.getSession()
    if (!account?.accountId) return
    const row = this.record(account.accountId)
    if (row?.state === 'installed' && !this.jobs.get(account.accountId)?.busy) {
      try {
        const snapshot = await this.connectors.call('list')
        this.assertAccount(account)
        if (snapshot.items.some(item => item.managedApplication === 'dbx' && item.enabled === false)) return
        this.start('connect')
      }
      catch (error) { this.logger?.warn('DBX MCP 恢复失败：%s', String(error)) }
    }
  }
  reconnect() { return this.start('connect') }
  async connectInstalled(account, signal) {
    const row = this.record(account.accountId)
    if (row?.state !== 'installed') throw new AppError('请先安装 DBX。')
    await this.connect(account, JSON.parse(row.manifest_json), signal)
  }
  async open() {
    const account = this.account(), row = this.record(account.accountId)
    if (this.jobs.get(account.accountId)?.busy) throw new AppError('应用正在处理，请稍后重试。')
    if (row?.state !== 'installed') throw new AppError('请先安装 DBX。')
    const paths = this.paths(account.accountId), manifest = JSON.parse(row.manifest_json)
    const executable = await verifyExecutable(paths.runtime, manifest.files.desktop)
    await this.checkRunning(executable)
    this.assertAccount(account)
    const child = this.launch(executable, [], { cwd: paths.data, env: { ...process.env, DBX_DATA_DIR: paths.data, WEBVIEW2_USER_DATA_FOLDER: join(paths.data, 'webview') }, detached: true, stdio: 'ignore', windowsHide: false, shell: false })
    await new Promise((resolve, reject) => { child.once('spawn', resolve); child.once('error', () => reject(new AppError('DBX 无法启动，请检查程序和系统 WebView2。'))) })
    child.unref()
    const previous = this.children.get(account.accountId)
    if (!previous || previous.exitCode !== null || previous.signalCode !== null) this.children.set(account.accountId, child)
    return { opened: true }
  }
  async uninstall(account, signal) {
    const { accountId } = account, row = this.record(accountId), paths = this.paths(accountId)
    const child = this.children.get(accountId)
    if (child && child.exitCode === null && child.signalCode === null) throw new AppError('请先退出 DBX（包括托盘），再卸载。')
    if (row?.state === 'installed') await this.checkStopped(join(paths.runtime, JSON.parse(row.manifest_json).files.desktop.path))
    this.assertAccount(account)
    await this.connectors.call('removeApplication', { appId: 'dbx', expectedAccountId: accountId }, signal)
    this.assertAccount(account)
    if (!row) return
    this.save(accountId, 'uninstalling', JSON.parse(row.manifest_json))
    await removeManaged(paths.root, paths.runtime)
    this.storage.db.prepare("DELETE FROM application_installations WHERE user_id = ? AND app_id = 'dbx'").run(accountId)
    this.logger?.info('DBX 已卸载，连接配置保留。')
  }
  identityChanged() { for (const job of this.jobs.values()) if (job.busy) job.controller.abort(); void this.restore() }
  async dispose() { this.lifetime.abort(); await Promise.all([...this.jobs.values()].map(job => job.promise)); this.jobs.clear() }
}
