import { clientRequestSchema } from '@deepseek-ai/dsh-client-connection'
import { TokenStatsService } from './service.js'
import { projectionKey, usageProjection } from './projection.js'
import { TokenStatsError } from './errors.js'

export const name = '@seal-harness/token-stats'
export const inject = ['connection', 'sealHarnessDatabase', 'sealHarnessIdentity', 'sessionProjections']

export function apply(ctx) {
  const projections = ctx.sessionProjections
  projections.register(usageProjection)
  const service = new TokenStatsService({
    storage: ctx.sealHarnessDatabase, identity: ctx.sealHarnessIdentity,
    readPreset: session => projections.stateOf(session, 'agentPreset') ?? session.header?.agentPreset ?? '',
  })
  ctx.provide('sealHarnessTokenStats', service)
  ctx.on('session/event', (session, event) => {
    if (!['turn/start', 'turn/end'].includes(event.type)) return
    try { service.capture(session, event, event.type === 'turn/end' ? projections.stateOf(session, projectionKey) : null) }
    catch (error) { ctx.logger?.error('Token 用量记录失败', error) }
  })
  for (const action of ['snapshot', 'export']) {
    const endpoint = `seal-harness-token-stats/${action}`
    ctx.connection.fetch.register({ path: `/api/${endpoint}`, methods: ['POST'], requestBody: 'buffered', async fetch(request) {
      if (request.headers.get('content-type')?.split(';')[0].trim() !== 'application/json') return new Response('Expected JSON', { status: 415 })
      let message
      try { message = clientRequestSchema.parse(await request.json()) } catch { return new Response('Invalid RPC request', { status: 400 }) }
      if (message.method !== endpoint) return new Response('Invalid RPC method', { status: 400 })
      let result
      try { result = { ok: true, value: service[action](message.payload ?? {}) } }
      catch (error) {
        const expected = error instanceof TokenStatsError
        if (!expected && error.name !== 'ZodError') ctx.logger?.error('Token 统计查询失败', error)
        result = { ok: false, error: { code: expected ? error.code : error.name === 'ZodError' ? 'invalidInput' : 'tokenStatsFailed',
          message: expected ? error.message : error.name === 'ZodError' ? '统计筛选条件无效，请检查日期、时区和筛选项。' : '用量统计暂不可用，请查看日志后重试。', details: {} } }
      }
      return Response.json({ type: 'server-response', rpcId: message.rpcId, result })
    } })
  }
}
