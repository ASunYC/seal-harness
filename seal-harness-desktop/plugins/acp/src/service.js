import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import { AcpError, abortable, discover, environmentSchema, presets, runnerConfig, runnerId } from './config.js'
import { AcpProcess } from './transport.js'

const idInput = z.strictObject({ id: runnerId })
const saveInput = z.strictObject({ id: runnerId.optional(), name: z.string().trim().min(1).max(100), config: runnerConfig,
  enabled: z.boolean().default(false), environment: environmentSchema.optional() })
const runInput = z.strictObject({ id: runnerId, prompt: z.string().trim().min(1).max(30000) })
const key = (owner, id) => `seal-harness-acp/${owner}/${id}`
const publicRun = ({ id, kind, runnerId, runnerName, status, startedAt, finishedAt, output, truncated, error, stopReason, permissionDecision }) =>
  ({ id, kind, runnerId, runnerName, status, startedAt, finishedAt, output, truncated, error, stopReason, permissionDecision })

export class AcpService {
  constructor({ storage, identity, credentials, subprocess, createProcess = options => new AcpProcess(options) }) {
    Object.assign(this, { storage, identity, credentials, subprocess, createProcess })
    this.runs = new Map(); this.checks = new Map(); this.jobs = new Set(); this.mutations = new Set(); this.closed = false
    this.unsubscribe = identity.subscribe?.(() => {
      const session = identity.getSession()
      for (const run of this.jobs) if (run.owner !== session?.accountId || run.epoch !== session?.epoch) {
        run.controller.abort(new AcpError('accountChanged', '账号已变化，ACP 任务已停止。'))
        this.runs.delete(run.id)
      }
      this.checks.clear()
    })
  }
  scope() {
    if (this.closed) throw new AcpError('disposed', 'ACP 插件已关闭。')
    const session = this.identity.getSession()
    if (!session?.accountId) throw new AcpError('notLoggedIn', '请先登录本地账号。')
    return session
  }
  same(session) {
    const now = this.scope()
    if (now.accountId !== session.accountId || now.epoch !== session.epoch) throw new AcpError('accountChanged', '账号已变化，请重新操作。')
  }
  record(session, id) {
    const row = this.storage.db.prepare('SELECT * FROM acp_runners WHERE user_id = ? AND id = ?').get(session.accountId, id)
    if (!row) throw new AcpError('runnerNotFound', '请先配置这个账号的 Runner 和工作目录。')
    return { ...row, config: runnerConfig.parse(JSON.parse(row.config_json)) }
  }
  async snapshot(input = {}) {
    z.strictObject({}).parse(input)
    const session = this.scope()
    const saved = this.storage.db.prepare('SELECT * FROM acp_runners WHERE user_id = ? ORDER BY created_at').all(session.accountId)
    const items = new Map(presets.map(preset => [preset.id, { ...preset, config: { command: preset.command, args: preset.args, cwd: '', permission: 'reject', timeoutSeconds: 300 }, configured: false, enabled: false }]))
    for (const row of saved) items.set(row.id, { ...(items.get(row.id) ?? { id: row.id, note: '自定义 ACP v1 stdio Runner。' }), name: row.name,
      config: runnerConfig.parse(JSON.parse(row.config_json)), configured: true, enabled: Boolean(row.enabled) })
    const result = await Promise.all([...items.values()].map(async item => {
      const record = await this.credentials.readRecord(key(session.accountId, item.id))
      const environment = environmentSchema.parse(record?.kind === 'grant' ? record.payload?.environment ?? {} : {})
      const environmentNames = Object.keys(environment)
      return { id: item.id, name: item.name, note: item.note, config: item.config, configured: item.configured,
        enabled: item.enabled, environmentNames, discovery: await discover(this.subprocess, item.config.command, undefined, environment),
        check: this.checks.get(key(session.accountId, item.id)) ?? null }
    }))
    this.same(session)
    return { items: result, runs: [...this.runs.values()].filter(run => run.owner === session.accountId).map(publicRun).reverse(),
      note: '启用只允许使用此配置，不代表已登录或协议可用。检查会启动 Runner 并握手；只有执行任务才发送提示词。' }
  }
  async stopRunner(owner, id) {
    const jobs = [...this.jobs].filter(run => run.owner === owner && run.runnerId === id)
    if (jobs.some(run => run.cleanupFailed)) throw new AcpError('cleanupFailed', 'Runner 停止状态未知，暂不能修改配置，请检查 Host 和子进程。')
    for (const run of jobs) run.controller.abort(new AcpError('cancelled', 'ACP 任务已停止。'))
    await Promise.all(jobs.map(run => run.done))
    if (jobs.some(run => run.cleanupFailed)) throw new AcpError('cleanupFailed', 'Runner 尚未确认停止，暂不能修改配置。')
  }
  async mutate(session, id, operation) {
    const slot = key(session.accountId, id)
    if ([...this.jobs].some(run => run.owner === session.accountId && run.runnerId === id && run.cleanupFailed)) throw new AcpError('cleanupFailed', 'Runner 停止状态未知，暂不能修改配置。')
    if (this.mutations.has(slot)) throw new AcpError('runnerBusy', 'Runner 配置正在修改，请稍候。')
    this.mutations.add(slot)
    try { return await operation() } finally { this.mutations.delete(slot) }
  }
  async save(input) {
    const parsed = saveInput.parse(input), session = this.scope(), id = parsed.id ?? `runner-${randomUUID()}`
    if (!parsed.id && this.storage.db.prepare('SELECT count(*) AS count FROM acp_runners WHERE user_id = ?').get(session.accountId).count >= 32)
      throw new AcpError('runnerLimit', '每个账号最多保存 32 个 Runner。')
    return this.mutate(session, id, async () => {
      await this.stopRunner(session.accountId, id)
      this.same(session)
      if (parsed.environment !== undefined) await this.credentials.modifyRecord(key(session.accountId, id), () => ({ kind: 'grant', payload: { version: 1, environment: parsed.environment } }))
      this.same(session)
      const now = Date.now()
      this.storage.db.prepare(`INSERT INTO acp_runners VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(user_id, id) DO UPDATE SET name = excluded.name, config_json = excluded.config_json, enabled = excluded.enabled, updated_at = excluded.updated_at`)
        .run(session.accountId, id, parsed.name, JSON.stringify(parsed.config), parsed.enabled ? 1 : 0, now, now)
      this.checks.delete(key(session.accountId, id))
      return { id }
    })
  }
  async toggle(input) {
    const { id, enabled } = z.strictObject({ id: runnerId, enabled: z.boolean() }).parse(input), session = this.scope()
    this.record(session, id)
    return this.mutate(session, id, async () => {
      if (!enabled) await this.stopRunner(session.accountId, id)
      this.same(session)
      this.storage.db.prepare('UPDATE acp_runners SET enabled = ?, updated_at = ? WHERE user_id = ? AND id = ?').run(enabled ? 1 : 0, Date.now(), session.accountId, id)
      return { id, enabled }
    })
  }
  async delete(input) {
    const { id } = idInput.parse(input), session = this.scope()
    this.record(session, id)
    return this.mutate(session, id, async () => {
      await this.stopRunner(session.accountId, id)
      this.same(session)
      await this.credentials.modifyRecord(key(session.accountId, id), () => ({ kind: 'grant', payload: { version: 1, environment: {} } }))
      this.same(session)
      this.storage.db.prepare('DELETE FROM acp_runners WHERE user_id = ? AND id = ?').run(session.accountId, id)
      this.checks.delete(key(session.accountId, id))
      return { deleted: true }
    })
  }
  launch(session, row, prompt = null) {
    if (this.mutations.has(key(session.accountId, row.id))) throw new AcpError('runnerBusy', 'Runner 配置正在修改，请稍候。')
    if ([...this.jobs].some(run => run.cleanupFailed)) throw new AcpError('cleanupFailed', '已有 ACP 进程停止状态未知，不能开始新的操作，请检查 Host 和子进程。')
    if ([...this.jobs].some(run => run.owner === session.accountId)) throw new AcpError('runnerBusy', '当前账号已有 ACP 操作，请先停止或等待完成。')
    for (const old of [...this.runs.values()].filter(run => run.owner === session.accountId && !this.jobs.has(run)).slice(0, -19)) this.runs.delete(old.id)
    const run = { id: randomUUID(), kind: prompt === null ? 'check' : 'task', runnerId: row.id, runnerName: row.name, owner: session.accountId, epoch: session.epoch,
      status: prompt === null ? 'checking' : 'starting', startedAt: Date.now(), finishedAt: null, output: '', truncated: false,
      error: null, stopReason: null, permissionDecision: null, controller: new AbortController(), process: null }
    this.runs.set(run.id, run)
    this.jobs.add(run)
    run.done = this.perform(session, row, run, prompt)
    run.done.then(() => { if (!run.cleanupFailed) this.jobs.delete(run) }, () => {})
    return run
  }
  async perform(session, row, run, prompt) {
    let terminal = 'completed'
    const timeout = setTimeout(() => run.controller.abort(new AcpError('timeout', 'ACP 操作已超时并停止。')), row.config.timeoutSeconds * 1000)
    const startup = setTimeout(() => run.controller.abort(new AcpError('timeout', 'ACP 握手超时，请检查程序及登录状态。')), 15000)
    try {
      const record = await abortable(this.credentials.readRecord(key(session.accountId, row.id)), run.controller.signal)
      this.same(session)
      const env = environmentSchema.parse(record?.kind === 'grant' ? record.payload?.environment ?? {} : {})
      run.process = this.createProcess({ subprocess: this.subprocess, config: row.config, env, signal: run.controller.signal,
        onText: text => { const room = 65536 - run.output.length; run.output += text.slice(0, Math.max(0, room)); if (text.length > room) run.truncated = true },
        onPermission: decision => { run.permissionDecision = decision } })
      const facts = await run.process.open()
      clearTimeout(startup)
      this.same(session); run.controller.signal.throwIfAborted()
      this.checks.set(key(session.accountId, row.id), { ready: true, checkedAt: Date.now(), ...facts })
      if (prompt !== null) {
        run.status = 'running'
        const result = await run.process.prompt(prompt)
        this.same(session); run.controller.signal.throwIfAborted()
        run.stopReason = result.stopReason
        if (result.stopReason !== 'end_turn') throw new AcpError('incomplete', 'Runner 未正常完成任务，请查看停止原因或权限策略。')
      }
    } catch (error) {
      terminal = run.controller.signal.aborted ? run.controller.signal.reason?.code === 'timeout' ? 'timeout' : 'cancelled' : 'failed'
      run.error = error instanceof AcpError ? error.message : 'ACP 操作未完成，请检查程序、登录和工作目录。'
      if (!this.closed && !run.controller.signal.aborted) this.checks.set(key(session.accountId, row.id), { ready: false, checkedAt: Date.now(), error: run.error })
    } finally {
      run.status = 'stopping'
      clearTimeout(timeout); clearTimeout(startup)
      try { if (run.controller.signal.aborted) await run.process?.cancel(); await run.process?.close() }
      catch { terminal = 'blocked'; run.cleanupFailed = true; run.error = 'ACP 进程未确认完全停止，请检查 Host 日志。' }
      run.status = terminal
      run.finishedAt = Date.now()
    }
    return publicRun(run)
  }
  async check(input) {
    const { id } = idInput.parse(input), session = this.scope(), run = this.launch(session, this.record(session, id))
    const result = await run.done
    this.same(session)
    if (result.status !== 'completed') throw new AcpError(result.status, result.error)
    return this.checks.get(key(session.accountId, id))
  }
  run(input) {
    const { id, prompt } = runInput.parse(input), session = this.scope(), row = this.record(session, id)
    if (!row.enabled) throw new AcpError('runnerDisabled', '请先启用此 Runner。')
    return publicRun(this.launch(session, row, prompt))
  }
  async cancel(input) {
    const { id } = z.strictObject({ id: z.string().uuid() }).parse(input), session = this.scope(), run = this.runs.get(id)
    if (!run || run.owner !== session.accountId || run.epoch !== session.epoch) throw new AcpError('runNotFound', '没有可操作的 ACP 任务。')
    run.controller.abort(new AcpError('cancelled', 'ACP 任务已停止。'))
    const result = await run.done
    this.same(session)
    return result
  }
  async execute(input, signal) {
    const session = this.scope(), started = this.run(input), run = this.runs.get(started.id)
    const cancel = () => run.controller.abort(new AcpError('cancelled', 'ACP 调用已取消。'))
    signal.addEventListener('abort', cancel, { once: true })
    if (signal.aborted) cancel()
    try { const result = await run.done; this.same(session); return result }
    finally { signal.removeEventListener('abort', cancel) }
  }
  async dispose() {
    this.closed = true; this.unsubscribe?.()
    const runs = [...this.jobs]
    for (const run of runs) run.controller.abort(new AcpError('disposed', 'ACP 插件已关闭。'))
    await Promise.all(runs.map(run => run.done))
    if (runs.some(run => run.cleanupFailed)) throw new AcpError('cleanupFailed', 'ACP 子进程停止状态未知。')
    this.runs.clear(); this.checks.clear()
  }
}
