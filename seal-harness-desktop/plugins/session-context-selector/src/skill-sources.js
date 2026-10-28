import { z } from 'zod'
import { clientRequestSchema } from '@deepseek-ai/dsh-client-connection'

export function registerSkillSources(ctx) {
  const lifetime = new AbortController()
  ctx.effect(() => () => lifetime.abort(), 'session skill sources: requests')
  const endpoint = 'seal-harness-capabilities/skills/sessionSources'
  ctx.connection.fetch.register({ path: `/api/${endpoint}`, methods: ['POST'], requestBody: 'buffered', async fetch(request) {
    if (request.headers.get('content-type')?.split(';')[0].trim() !== 'application/json') return new Response('Expected JSON', { status: 415 })
    let message
    try { message = clientRequestSchema.parse(await request.json()) } catch { return new Response('Invalid RPC request', { status: 400 }) }
    if (message.method !== endpoint) return new Response('Invalid RPC method', { status: 400 })
    let result
    try {
      const { sessionId } = z.strictObject({ sessionId: z.string().min(1).max(256) }).parse(message.payload)
      const owner = ctx.sealHarnessIdentity.getSession()
      if (!owner) throw new Error('请先登录本地账号。')
      const signal = AbortSignal.any([request.signal, lifetime.signal])
      const live = ctx.agents.get(sessionId)
      let observation, lease
      try {
        let cwd, scope = live
        if (live) cwd = await ctx.workingDirectory.ensure(live, signal)
        else {
          observation = await ctx.sessionQuery.observeSession(sessionId, { signal })
          if (!observation.projections) throw new Error('会话目录尚未就绪，请重新打开会话。')
          const values = observation.projections.values
          cwd = values.workingDirectory ?? observation.header.cwd ?? ctx.workingDirectory.defaultDirectory
          // 与原生目录一致：未知或不可用的旧 preset 回落到全局注册表。
          lease = await ctx.agentPresets.acquireScope(values.agentPreset ?? undefined).catch(() => undefined)
          scope = lease?.key
        }
        const registry = (live && ctx.agentPresets.serviceFor(live, 'skills')) || ctx.skills
        const items = (await registry.list({ cwd, scope, signal })).filter(skill => skill.invocation.userInvocable)
          .map(({ name, path, source }) => ({ name, ...(path ? { path } : {}), source }))
        signal.throwIfAborted()
        const current = ctx.sealHarnessIdentity.getSession()
        if (current?.accountId !== owner.accountId || current.epoch !== owner.epoch) throw new Error('账号已变化，请重新打开技能选择器。')
        result = { ok: true, value: { items } }
      } finally {
        try { await lease?.[Symbol.asyncDispose]?.() } finally { observation?.[Symbol.dispose]?.() }
      }
    } catch (error) {
      result = { ok: false, error: { code: 'skillSourcesFailed', message: error instanceof z.ZodError ? '技能目录请求格式无效。' : '无法读取当前会话技能来源，请重新打开会话后重试。', details: {} } }
    }
    return Response.json({ type: 'server-response', rpcId: message.rpcId, result })
  } })
}
