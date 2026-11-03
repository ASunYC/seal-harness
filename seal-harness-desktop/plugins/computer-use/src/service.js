import { createHash, randomUUID } from 'node:crypto'
import { credentialKey } from '@deepseek-ai/dsh-credentials'
import { z } from 'zod'
import { ComputerUseError, profileSchema, localProfile } from './config.js'
import { createComputerRuntime } from './runtime.js'
import { mountComputerScope } from './bridge.js'

const sessionIdSchema = z.string().min(1).max(256)
const idSchema = z.union([z.literal('local'), z.string().uuid()])
const savedSchema = z.strictObject({ version: z.literal(1), profiles: z.array(profileSchema).max(64) })
export const computerUseCredentialKey = owner => credentialKey('seal-harness-computer-use', `account-${createHash('sha256').update(owner).digest('hex')}`)
const key = computerUseCredentialKey
const targetKey = profile => profile.mode === 'local' ? 'local' : `${profile.host.toLowerCase()}:${profile.port}:${profile.username}:${profile.socket}`
const publicRun = run => run ? { sessionId: run.sessionId, targetId: run.profile.id, targetName: run.profile.name, mode: run.profile.mode, status: run.status, backgroundOnly: true, ...(run.issue ? { issue: run.issue } : {}) } : null

export class ComputerUseService {
  constructor(ctx, { runtime = createComputerRuntime(), mount = mountComputerScope } = {}) {
    Object.assign(this, { ctx, runtime, mount })
    this.active = new Map(); this.checks = new Set(); this.closed = false; this.starting = Promise.resolve()
    this.unsubscribe = ctx.sealHarnessIdentity.subscribe(() => {
      for (const run of this.active.values()) if (!this.isOwner(run.owner)) void this.release(run).catch(() => ctx.logger?.warn('电脑操作账号切换清理失败。'))
      for (const check of this.checks) if (!this.isOwner(check.owner)) check.controller.abort()
    })
    this.releaseDisposed = ctx.on?.('agent/disposed', async ({ agent }) => {
      const run = this.active.get(String(agent.id))
      if (run?.agent === agent) await this.release(run)
    })
  }
  owner() {
    if (this.closed) throw new ComputerUseError('closed', '电脑操作插件已关闭。')
    const owner = this.ctx.sealHarnessIdentity.getSession()
    if (!owner?.accountId) throw new ComputerUseError('loginRequired', '请先登录本地账号。')
    return owner
  }
  isOwner(expected) {
    const owner = this.ctx.sealHarnessIdentity.getSession()
    return !this.closed && owner?.accountId === expected.accountId && owner?.epoch === expected.epoch
  }
  same(owner) { if (!this.isOwner(owner)) throw new ComputerUseError('accountChanged', '账号已变化，请重新操作。') }
  async profiles(owner) {
    const record = await this.ctx.credentials.readRecord(key(owner.accountId))
    this.same(owner)
    const rows = record === undefined ? [] : savedSchema.parse(record.kind === 'grant' ? record.payload : null).profiles
    return [rows.find(item => item.id === 'local') ?? { ...localProfile }, ...rows.filter(item => item.id !== 'local')]
  }
  async profile(owner, id) {
    const profile = (await this.profiles(owner)).find(item => item.id === id)
    if (!profile) throw new ComputerUseError('targetNotFound', '此账号没有这个电脑操作目标。')
    return profile
  }
  async snapshot(input = {}) {
    const { sessionId } = z.strictObject({ sessionId: sessionIdSchema.optional() }).parse(input)
    const owner = this.owner(), profiles = await this.profiles(owner)
    const run = sessionId ? this.active.get(sessionId) : null
    return { profiles, defaultMode: 'local', backgroundOnly: true, runtime: run && this.isOwner(run.owner) ? publicRun(run) : null }
  }
  async save(input) {
    const { profile: raw } = z.strictObject({ profile: profileSchema }).parse(input)
    const owner = this.owner(), rows = await this.profiles(owner)
    if (raw.id && !rows.some(item => item.id === raw.id)) throw new ComputerUseError('targetNotFound', '请刷新后重新选择目标。')
    const profile = { ...raw, id: raw.mode === 'local' ? 'local' : raw.id ?? randomUUID() }
    if (rows.length >= 64 && !rows.some(item => item.id === profile.id)) throw new ComputerUseError('tooManyTargets', '最多保存64个目标。')
    await this.ctx.credentials.modifyRecord(key(owner.accountId), record => {
      this.same(owner)
      const old = record === undefined ? [] : savedSchema.parse(record.kind === 'grant' ? record.payload : null).profiles
      return { kind: 'grant', payload: savedSchema.parse({ version: 1, profiles: [...old.filter(item => item.id !== profile.id), profile] }) }
    })
    this.same(owner)
    await this.stopTarget(owner.accountId, profile.id)
    return { profile }
  }
  async delete(input) {
    const { id } = z.strictObject({ id: idSchema }).parse(input), owner = this.owner()
    if (id === 'local') throw new ComputerUseError('localRequired', '本机是默认目标，不能删除。')
    await this.profile(owner, id)
    await this.ctx.credentials.modifyRecord(key(owner.accountId), record => {
      this.same(owner)
      const previous = savedSchema.parse(record?.kind === 'grant' ? record.payload : null)
      return { kind: 'grant', payload: { version: 1, profiles: previous.profiles.filter(item => item.id !== id) } }
    })
    this.same(owner); await this.stopTarget(owner.accountId, id)
    return { deleted: true }
  }
  async check(input, signal) {
    const { id } = z.strictObject({ id: idSchema }).parse(input), owner = this.owner()
    const check = { owner, controller: new AbortController() }
    const active = AbortSignal.any([check.controller.signal, ...(signal ? [signal] : [])])
    this.checks.add(check)
    try {
      const result = await this.runtime.inspect(await this.profile(owner, id), active)
      active.throwIfAborted(); this.same(owner)
      return { ...result, backgroundOnly: true }
    } finally { this.checks.delete(check) }
  }
  assertActive(run) {
    this.same(run.owner); run.controller.signal.throwIfAborted()
    if (this.active.get(run.sessionId) !== run || run.status !== 'running') throw new ComputerUseError('stopped', '电脑操作已停止，请在会话中重新启用。')
  }
  start(input, signal) {
    const parsed = z.strictObject({ sessionId: sessionIdSchema, id: idSchema.default('local') }).parse(input)
    const owner = this.owner()
    const result = this.starting.then(() => this.activate(parsed, owner, signal))
    this.starting = result.catch(() => {})
    return result
  }
  async activate({ sessionId, id }, owner, signal) {
    signal?.throwIfAborted(); this.same(owner)
    const profile = await this.profile(owner, id)
    let agent = this.ctx.agents.get(sessionId)
    if (!agent && this.ctx.sessionController) {
      const resolved = await this.ctx.sessionController.resolveAgent(sessionId)
      if (resolved.error) throw new ComputerUseError('sessionUnavailable', '会话尚未就绪，请重新打开会话。')
      agent = resolved.agent
    }
    this.same(owner); signal?.throwIfAborted()
    if (!agent || String(agent.id) !== sessionId) throw new ComputerUseError('sessionUnavailable', '请先打开会话，再启用电脑操作。')
    if (agent.status !== 'idle') throw new ComputerUseError('sessionBusy', '请等待当前回复结束后启用或切换目标。')
    const previous = this.active.get(sessionId)
    if (previous && !this.isOwner(previous.owner)) throw new ComputerUseError('sessionOwned', '此会话的电脑操作属于另一个账号。')
    if ([...this.active.values()].some(run => run !== previous && ['running', 'starting'].includes(run.status) && targetKey(run.profile) === targetKey(profile)))
      throw new ComputerUseError('targetBusy', '这个桌面已由另一个会话使用，请先停止它。')
    if (previous) await this.release(previous)
    const run = { owner, sessionId, agent, profile, status: 'starting', controller: new AbortController(), connection: null, scope: null, chain: Promise.resolve() }
    this.active.set(sessionId, run)
    const abort = () => run.controller.abort()
    signal?.addEventListener('abort', abort, { once: true })
    try {
      const connection = await this.runtime.launch(profile, { signal: run.controller.signal, sessionLabel: `seal-${randomUUID()}` })
      if (run.controller.signal.aborted || !this.isOwner(owner)) {
        await connection.close()
        run.controller.signal.throwIfAborted(); this.same(owner)
      }
      run.connection = connection
      run.controller.signal.throwIfAborted(); this.same(owner)
      await agent.runMaintenance(async maintenanceSignal => {
        maintenanceSignal?.throwIfAborted(); run.controller.signal.throwIfAborted()
        const scope = await this.mount(agent, { connection: run.connection, profile,
          label: `seal-${randomUUID()}`, assertActive: () => this.assertActive(run), call: (name, args, callSignal) => this.call(run, name, args, callSignal) })
        if (run.controller.signal.aborted || !this.isOwner(owner)) {
          await scope.dispose()
          run.controller.signal.throwIfAborted(); this.same(owner)
        }
        run.scope = scope
      })
      run.controller.signal.throwIfAborted(); this.same(owner)
      run.status = 'running'
      return { runtime: publicRun(run) }
    } catch (error) {
      await this.release(run)
      throw error
    } finally { signal?.removeEventListener('abort', abort) }
  }
  call(run, name, args, signal) {
    const operation = run.chain.then(async () => {
      this.assertActive(run)
      const active = AbortSignal.any([run.controller.signal, ...(signal ? [signal] : [])])
      active.throwIfAborted()
      const result = await run.connection.callTool(name, args, active)
      this.assertActive(run); active.throwIfAborted()
      return result
    })
    run.chain = operation.catch(() => {})
    return operation
  }
  async release(run) {
    if (run.releasing) return run.releasing
    run.controller.abort()
    if (this.active.get(run.sessionId) === run) this.active.delete(run.sessionId)
    run.releasing = (async () => {
      const outcomes = await Promise.allSettled([run.scope?.dispose(), run.connection?.close()])
      if (outcomes.some(item => item.status === 'rejected')) throw new ComputerUseError('stopFailed', '电脑操作连接清理失败，请检查驱动进程。')
    })()
    return run.releasing
  }
  async stop(input) {
    const { sessionId } = z.strictObject({ sessionId: sessionIdSchema }).parse(input), owner = this.owner(), run = this.active.get(sessionId)
    if (run) {
      if (run.owner.accountId !== owner.accountId || run.owner.epoch !== owner.epoch) throw new ComputerUseError('sessionOwned', '不能停止另一个账号的电脑操作。')
      await this.release(run)
    }
    return { stopped: true }
  }
  async stopTarget(ownerId, targetId) {
    await Promise.all([...this.active.values()].filter(run => run.owner.accountId === ownerId && run.profile.id === targetId).map(run => this.release(run)))
  }
  async dispose() {
    this.unsubscribe(); this.releaseDisposed?.(); this.closed = true
    for (const check of this.checks) check.controller.abort()
    await Promise.all([...this.active.values()].map(run => this.release(run)))
  }
}
