import { join } from 'node:path'
import { z } from 'zod'
import { credentialKey } from '@deepseek-ai/dsh-credentials'
import { createScope } from '@deepseek-ai/dsh-scope'
import * as mcpClient from '@deepseek-ai/dsh-mcp-client'
import * as sseClient from '../../connectors/src/sse.js'
import { ExpertError, nameSchema, versionSchema } from './package.js'
import { materializeConnectors, materializeSkills, resolveCapabilities } from './capabilities.js'

const key = credentialKey('seal-harness-capabilities', 'expert-session-selections')
const reference = z.strictObject({ name: nameSchema, version: versionSchema, digest: z.string().regex(/^[a-f0-9]{64}$/) })
const stateSchema = z.strictObject({ version: z.literal(1), rows: z.array(z.strictObject({
  // 兼容未发布的多选原型记录：最后一次选择成为唯一当前专家。
  accountId: z.string().min(1), sessionId: z.string().min(1).max(256), experts: z.array(reference).max(8).transform(items => items.slice(-1)),
})).max(1000).refine(rows => new Set(rows.map(row => `${row.accountId}\0${row.sessionId}`)).size === rows.length) })
const sessionSchema = z.strictObject({ sessionId: z.string().min(1).max(256) })
const changeSchema = sessionSchema.extend({ name: nameSchema, version: versionSchema.optional(), expectedDigest: z.string().regex(/^[a-f0-9]{64}$/).optional(), selected: z.boolean() }).strict()
const readState = record => record === undefined ? { version: 1, rows: [] } : stateSchema.parse(record.kind === 'grant' ? record.payload : null)

/** 专家作为可撤销的会话上下文，不重写已经开始的原生 preset 或用户模型。 */
export function createSessionExperts(ctx, { home, owner, load, list }) {
  const credentials = () => ctx.get('credentials')
  const active = new Map()
  const account = () => {
    const identity = ctx.get('sealHarnessIdentity')?.getSession()
    if (!identity?.accountId) throw new ExpertError('请先登录本机账号。')
    return { id: owner(), epoch: identity.epoch }
  }
  const assertAccount = expected => {
    const current = account()
    if (current.id !== expected.id || current.epoch !== expected.epoch) throw new ExpertError('专家账号已变化，请重新选择。')
  }
  const state = async () => {
    if (!credentials()) throw new ExpertError('会话专家存储服务未就绪。')
    return readState(await credentials().readRecord(key))
  }
  const live = id => {
    const agent = ctx.get('agents')?.get(id)
    if (!agent || String(agent.id) !== id) throw new ExpertError('当前会话尚未就绪，请重新打开后选择专家。')
    return agent
  }
  const connectorRefs = async (sessionId, ids, expected) => {
    const connectors = ctx.get('sealHarnessConnectors')
    if (!connectors && ids.length) throw new ExpertError('连接器插件未加载。')
    if (connectors) await connectors.call('setSessionExperts', { sessionId, ids, expectedAccountId: expected.id })
  }
  async function prepare(refs) {
    const experts = [], skills = new Map(), servers = [], connectorIds = new Set()
    for (const ref of refs) {
      const loaded = await load(ref)
      if (loaded.pkg.digest !== ref.digest) throw new ExpertError('专家内容已变化，请移除后重新添加。')
      const { pkg } = loaded
      const resolved = await resolveCapabilities(ctx, pkg.manifest.capabilities?.filter(item => !pkg.portableDependencies.some(dep => dep.kind === item.kind && dep.sourceId === item.sourceId)))
      const directory = join(home, 'seal-harness-capabilities', 'experts', loaded.name)
      resolved.skills.push(...await materializeSkills(pkg, join(directory, `${ref.version}.skills`)))
      servers.push(...(await materializeConnectors(pkg, join(directory, `${ref.version}.connectors`), ctx, loaded.state.origin?.accountId, id => connectorIds.add(id)))
        .map(server => ({ ...server, serverName: `${ref.name}-${server.serverName}` })))
      for (const [serverName, server] of Object.entries(pkg.manifest.toolPolicy?.mcpServers ?? {})) servers.push({ serverName: `${ref.name}-${serverName}`, transport: 'stdio', ...server })
      for (const skill of resolved.skills) {
        if (skills.has(skill.name) && skills.get(skill.name).content !== skill.content) throw new ExpertError(`所选专家包含同名但内容不同的技能：${skill.name}`)
        skills.set(skill.name, skill)
      }
      // portable MCP 也可能通过现有连接器服务落地，统一按工具所属条目授权。
      const bound = resolved.toolNames.length ? (await ctx.get('sealHarnessConnectors')?.call('list'))?.items ?? [] : []
      for (const item of bound) if (resolved.toolNames.some(name => name.startsWith(`mcp__zz-${item.id}__`))
        || (pkg.portableDependencies ?? []).some(dep => dep.kind === 'mcp' && item.source?.id === dep.sourceId)) connectorIds.add(item.id)
      experts.push({ name: ref.name, title: pkg.manifest.displayName.zh, persona: pkg.manifest.personaInstructions,
        personality: pkg.manifest.personality, toolNames: resolved.toolNames, toolPolicy: pkg.manifest.toolPolicy })
    }
    return { experts, skills: [...skills.values()], servers, connectorIds: [...connectorIds] }
  }
  async function mount(agent, prepared, expected) {
    const scope = createScope(agent.ctx, agent)
    try {
      scope.ctx.on('agent/request', async (_payload, next) => { assertAccount(expected); const result = await next(); assertAccount(expected); return result })
      const prompt = scope.ctx.get('systemPrompt')
      if (!prompt) throw new ExpertError('会话上下文服务尚未就绪。')
      prompt.context({ name: 'seal-harness-session-experts', order: 82, required: true, interpolate: false,
        text: () => prepared.experts.map(expert => [
          `## 当前会话专家：${expert.title}`, expert.persona,
          expert.personality === 'friendly' ? '交流友善、耐心。' : expert.personality === 'pragmatic' ? '表达简洁，以可执行结果为先。' : '',
          expert.toolNames.length ? `专家绑定的工具：${expert.toolNames.join('、')}` : '',
          expert.toolPolicy?.webSearch && expert.toolPolicy.webSearch !== 'disabled' ? '需要网上资料时使用 web_search 并引用来源。' : '',
          expert.toolPolicy?.allowedTools?.requestUserInput ? '需要补充信息时使用 ask_user_question。' : '',
        ].filter(Boolean).join('\n')).join('\n\n') })
      for (const skill of prepared.skills) {
        const registry = scope.ctx.get('skills')
        if (!registry) throw new ExpertError('技能服务未加载。')
        scope.ctx.effect(() => registry.register({ ...skill, provider: 'seal-harness-session-expert' }))
      }
      const skillText = prepared.skills.map(skill => `## ${skill.name}\n${skill.content}\n资源目录：${skill.resourceBase?.path ?? ''}`).join('\n\n')
      if (skillText) prompt.context({ name: 'seal-harness-session-expert-skills', order: 83, required: true, interpolate: false, text: skillText })
      for (const server of prepared.servers) await scope.ctx.plugin(server.transport === 'sse' ? sseClient : mcpClient, { ...server, failOnStartupError: true })
      return scope
    } catch (error) { await scope.dispose(); throw error }
  }
  async function replace(agent, refs, expected, persist) {
    const sessionId = String(agent.id), previous = active.get(sessionId)
    const prepared = await prepare(refs)
    assertAccount(expected)
    await previous?.scope.dispose()
    active.delete(sessionId)
    let scope
    try {
      if (refs.length) scope = await mount(agent, prepared, expected)
      await connectorRefs(sessionId, prepared.connectorIds, expected)
      assertAccount(expected)
      await persist?.()
      assertAccount(expected)
      if (scope) active.set(sessionId, { scope, prepared, refs, account: expected, agent })
    } catch (error) {
      await scope?.dispose()
      // 失败恢复原上下文与工具引用；持久状态只在运行时装配成功后写入。
      try {
        assertAccount(expected)
        await connectorRefs(sessionId, previous?.prepared.connectorIds ?? [], expected)
        if (previous) active.set(sessionId, { ...previous, scope: await mount(agent, previous.prepared, previous.account) })
      } catch (rollback) { throw new ExpertError(`专家添加失败且原状态恢复失败，请重新打开会话：${rollback.message}`) }
      throw error
    }
  }
  const restore = async agent => {
    if (!ctx.get('sealHarnessIdentity')?.getSession()?.accountId) return
    const expected = account(), sessionId = String(agent.id)
    const refs = (await state()).rows.find(row => row.accountId === expected.id && row.sessionId === sessionId)?.experts ?? []
    if (!refs.length) return
    await replace(agent, refs, expected)
  }
  const releaseCreated = ctx.on?.('agent/created', ({ agent }) => restore(agent))
  const releaseDisposed = ctx.on?.('agent/disposed', async ({ agent }) => {
    const current = active.get(String(agent.id))
    if (current?.agent !== agent) return
    active.delete(String(agent.id)); await current.scope.dispose()
  })
  const unsubscribe = ctx.get('sealHarnessIdentity')?.subscribe?.(() => {
    const old = [...active.values()]; active.clear()
    void Promise.all(old.map(item => item.scope.dispose())).catch(error => ctx.logger?.warn('会话专家清理失败：%s', error.message))
  })
  return {
    async assertRemovable(name) {
      const expected = account()
      if ((await state()).rows.some(row => row.accountId === expected.id && row.experts.some(ref => ref.name === name))) {
        throw new ExpertError('此专家已加入会话，请先从会话中移除，再删除专家。')
      }
    },
    async sessionList(input) {
      const { sessionId } = sessionSchema.parse(input), expected = account()
      const agent = live(sessionId)
      const refs = (await state()).rows.find(row => row.accountId === expected.id && row.sessionId === sessionId)?.experts ?? []
      if (refs.length && active.get(sessionId)?.agent !== agent) {
        if (agent.status !== 'idle') throw new ExpertError('请等待当前回复完成后再恢复专家。')
        await agent.runMaintenance(() => replace(agent, refs, expected))
      }
      const snapshot = await list()
      assertAccount(expected)
      return { ...snapshot, selectedIds: refs.map(ref => ref.name) }
    },
    async sessionSet(input) {
      const payload = changeSchema.parse(input), expected = account(), agent = live(payload.sessionId)
      if (agent.status !== 'idle') throw new ExpertError('请等待当前回复完成后再调整专家。')
      return agent.runMaintenance(async signal => {
        const stored = await state()
        let refs = stored.rows.find(row => row.accountId === expected.id && row.sessionId === payload.sessionId)?.experts ?? []
        refs = refs.filter(ref => ref.name !== payload.name)
        if (payload.selected) {
          const loaded = await load(payload)
          if (loaded.pkg.digest !== payload.expectedDigest) throw new ExpertError('专家已更新，请刷新列表后重试。')
          refs = [{ name: loaded.name, version: loaded.version, digest: loaded.pkg.digest }]
        }
        await replace(agent, refs, expected, async () => {
          signal.throwIfAborted(); assertAccount(expected)
          await credentials().modifyRecord(key, record => {
            const value = readState(record)
            return { kind: 'grant', payload: stateSchema.parse({ version: 1, rows: [
              ...value.rows.filter(row => row.accountId !== expected.id || row.sessionId !== payload.sessionId),
              ...(refs.length ? [{ accountId: expected.id, sessionId: payload.sessionId, experts: refs }] : []),
            ] }) }
          })
        })
        return this.sessionList({ sessionId: payload.sessionId })
      })
    },
    async dispose() {
      releaseCreated?.(); releaseDisposed?.(); unsubscribe?.()
      const old = [...active.values()]; active.clear()
      await Promise.all(old.map(item => item.scope.dispose()))
    },
  }
}
