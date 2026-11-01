import { clientRequestSchema } from '@deepseek-ai/dsh-client-connection'
import { createSuperagentService } from './service.js'

export const name = 'seal-harness-superagent'
export const inject = ['connection', 'desktopRuntime']

export function apply(ctx) {
  const lifetime = new AbortController()
  ctx.effect(() => () => lifetime.abort(), 'superagent: requests')
  const service = createSuperagentService({ openExternal: url => ctx.desktopRuntime.openExternal(url) })
  for (const action of ['status', 'open']) {
    const endpoint = `seal-harness-superagent/${action}`
    ctx.connection.fetch.register({ path: `/api/${endpoint}`, methods: ['POST'], requestBody: 'buffered', async fetch(request) {
      if (request.headers.get('content-type')?.split(';')[0].trim() !== 'application/json') return new Response('Expected JSON', { status: 415 })
      let message
      try { message = clientRequestSchema.parse(await request.json()) }
      catch { return new Response('Invalid RPC request', { status: 400 }) }
      if (message.method !== endpoint) return new Response('Invalid RPC method', { status: 400 })
      let result
      try { result = { ok: true, value: await service[action](AbortSignal.any([request.signal, lifetime.signal])) } }
      catch (error) { result = { ok: false, error: { code: 'superagentFailed', message: error.message ?? 'Superagent 操作未完成。', details: {} } } }
      return Response.json({ type: 'server-response', rpcId: message.rpcId, result })
    } })
  }
}
