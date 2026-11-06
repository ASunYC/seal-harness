import { createHash, randomUUID } from 'node:crypto'
import { spawn } from 'node:child_process'
import { openSync, closeSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { mkdir, readFile, rm } from 'node:fs/promises'
import { setTimeout as delay } from 'node:timers/promises'
import { buildingBuilt } from './catalog.js'
import { AppError, removeManaged, verifyExecutable } from './installer.js'
import { inspectLocalRelease, installLocalRelease } from './local-release.js'
import { buildingBuiltRunning, assertBuildingBuiltStopped } from './launcher.js'

export class BuildingBuiltService {
  constructor({ storage, identity, logger, platform = process.platform, arch = process.arch,
    launch = spawn, checkRunning = buildingBuiltRunning, checkStopped = assertBuildingBuiltStopped,
    catalog = buildingBuilt }) {
    Object.assign(this, { storage, identity, logger, platform, arch, launch, checkRunning, checkStopped, catalog })
    this.jobs = new Map()
    this.lifetime = new AbortController()
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
    const root = join(dirname(this.storage.path), 'applications', createHash('sha256').update(accountId).digest('hex'), 'buildingbuilt')
    return { root, runtime: join(root, 'runtime'), data: join(root, 'data') }
  }
  record(accountId) { return this.storage.db.prepare('SELECT * FROM application_installations WHERE user_id = ? AND app_id = ?').get(accountId, 'buildingbuilt') }
  save(accountId, state, manifest = {}) {
    this.storage.db.prepare(`INSERT INTO application_installations (user_id, app_id, state, manifest_json, installed_at) VALUES (?, 'buildingbuilt', ?, ?, ?)
      ON CONFLICT(user_id, app_id) DO UPDATE SET state=excluded.state, manifest_json=excluded.manifest_json, installed_at=excluded.installed_at`)
      .run(accountId, state, JSON.stringify(manifest), new Date().toISOString())
  }
  list() {
    const account = this.account(), row = this.record(account.accountId), job = this.jobs.get(account.accountId)
    return { ...this.catalog, supported: this.platform === 'win32' && this.arch === 'x64',
      installed: row?.state === 'installed' || row?.state === 'uninstalling',
      state: job?.busy ? job.action : row?.state === 'installed' ? 'installed' : row ? 'interrupted' : 'uninstalled',
      progress: job?.progress ?? null,
      error: job?.error ?? (row && row.state !== 'installed' && !job?.busy ? '上次操作未完成，请重新安装或卸载。' : ''),
      version: row?.state === 'installed' ? JSON.parse(row.manifest_json).version : this.catalog.version,
    }
  }
  start(action, sourcePath) {
    const account = this.account(), key = account.accountId
    if (this.jobs.get(key)?.busy) throw new AppError('应用正在处理，请等待完成。')
    if (action === 'install' && (this.platform !== 'win32' || this.arch !== 'x64')) throw new AppError('BuildingBuilt 当前发布包仅支持 Windows x64。')
    const job = { action, busy: true, progress: null, error: '', controller: new AbortController() }
    this.jobs.set(key, job)
    const signal = AbortSignal.any([job.controller.signal, this.lifetime.signal])
    job.promise = (action === 'install' ? this.install(account, sourcePath, signal, job) : this.uninstall(account, signal)).catch(error => {
      job.error = error instanceof AppError ? error.message : signal.aborted ? '操作已取消，可重新尝试。' : '操作未完成，请检查发布包和应用日志。'
      this.logger?.warn('BuildingBuilt %s 失败：%s', action, String(error))
    }).finally(() => { job.busy = false; job.progress = null })
    return { accepted: true }
  }
  async install(account, sourcePath, signal, job) {
    const paths = this.paths(account.accountId), previous = this.record(account.accountId)
    const release = await inspectLocalRelease(sourcePath, this.catalog.manifestSha256)
    if (release.manifest.version !== this.catalog.version) throw new AppError('BuildingBuilt 发布包版本与 Seal 应用目录不一致。')
    if (previous) {
      const manifest = JSON.parse(previous.manifest_json)
      await this.checkStopped(join(paths.runtime, manifest.entry?.path ?? 'BuildingBuilt.exe'))
    }
    this.assertAccount(account)
    await mkdir(paths.data, { recursive: true })
    this.save(account.accountId, 'installing')
    try {
      await installLocalRelease(paths.root, release, signal, value => { job.progress = value }, entry => {
        this.assertAccount(account)
        this.save(account.accountId, 'installed', { version: release.manifest.version, entry: { path: entry.path, sha256: entry.sha256 } })
      })
    } catch (error) {
      if (previous) this.save(account.accountId, previous.state, JSON.parse(previous.manifest_json))
      else this.storage.db.prepare("DELETE FROM application_installations WHERE user_id = ? AND app_id = 'buildingbuilt'").run(account.accountId)
      throw error
    }
  }
  async open() {
    const account = this.account(), row = this.record(account.accountId)
    if (this.jobs.get(account.accountId)?.busy) throw new AppError('应用正在处理，请稍后重试。')
    if (row?.state !== 'installed') throw new AppError('请先安装 BuildingBuilt。')
    const paths = this.paths(account.accountId), manifest = JSON.parse(row.manifest_json)
    const executable = await verifyExecutable(paths.runtime, manifest.entry)
    if (await this.checkRunning(executable)) return { opened: true, alreadyRunning: true }
    this.assertAccount(account)
    await mkdir(paths.data, { recursive: true })
    const nonce = randomUUID(), ready = join(paths.data, 'launch-ready.json')
    await rm(ready, { force: true })
    const log = openSync(join(paths.data, 'buildingbuilt.log'), 'a')
    let child
    try {
      child = this.launch(executable, [], { cwd: paths.data,
        env: { ...process.env, BUILDING_BUILT_DATA_DIR: paths.data, BUILDING_BUILT_READY_FILE: ready,
          BUILDING_BUILT_LAUNCH_NONCE: nonce, WEBVIEW2_USER_DATA_FOLDER: join(paths.data, 'webview') },
        detached: true, stdio: ['ignore', log, log], windowsHide: true, shell: false })
    } finally { closeSync(log) }
    await new Promise((resolve, reject) => { child.once('spawn', resolve); child.once('error', () => reject(new AppError('BuildingBuilt 进程无法启动。'))) })
    child.unref()
    for (let attempt = 0; attempt < 120; attempt += 1) {
      this.assertAccount(account)
      if (child.exitCode !== null || child.signalCode !== null) throw new AppError('BuildingBuilt 在打开窗口前退出。')
      const marker = await readFile(ready, 'utf8').catch(() => null)
      if (marker) {
        try { if (JSON.parse(marker).nonce === nonce) return { opened: true, ready: true } } catch { /* wait for complete marker */ }
      }
      await delay(250, undefined, { signal: this.lifetime.signal })
    }
    throw new AppError('BuildingBuilt 已启动，但窗口未在 30 秒内就绪。')
  }
  async uninstall(account, signal) {
    const row = this.record(account.accountId), paths = this.paths(account.accountId)
    if (!row) return
    await this.checkStopped(join(paths.runtime, JSON.parse(row.manifest_json).entry?.path ?? 'BuildingBuilt.exe'))
    this.assertAccount(account)
    signal.throwIfAborted()
    this.save(account.accountId, 'uninstalling', JSON.parse(row.manifest_json))
    await removeManaged(paths.root, paths.runtime)
    this.storage.db.prepare("DELETE FROM application_installations WHERE user_id = ? AND app_id = 'buildingbuilt'").run(account.accountId)
  }
  identityChanged() { for (const job of this.jobs.values()) if (job.busy) job.controller.abort() }
  async dispose() { this.lifetime.abort(); await Promise.all([...this.jobs.values()].map(job => job.promise)); this.jobs.clear() }
}
