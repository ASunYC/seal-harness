import { createDecisionService } from './service.js'
import { DecisionError } from './decision.js'

export const name = 'ask-jev'
export const inject = ['connection', 'credentials']

function clientMessage(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || value.type !== 'client-request' || typeof value.rpcId !== 'string' || !value.rpcId
    || typeof value.method !== 'string') throw new Error('Invalid RPC request')
  return value
}

export function apply(ctx) {
  const service = createDecisionService({
    credentials: ctx.get('credentials'),
    identity: () => ctx.get('sealHarnessIdentity'),
  })
  const lifetime = new AbortController()
  ctx.effect(() => () => lifetime.abort(), 'ask-jev: pending requests')
  const handlers = {
    status: () => service.status(),
    configure: input => service.configure(input),
    decide: (input, signal) => service.decide(input, signal),
  }
  for (const [action, handler] of Object.entries(handlers)) {
    const endpoint = `ask-jev/${action}`
    ctx.connection.fetch.register({ path: `/api/${endpoint}`, methods: ['POST'], requestBody: 'buffered', async fetch(request) {
      if (request.headers.get('content-type')?.split(';')[0].trim() !== 'application/json')
        return new Response('Expected JSON', { status: 415 })
      let message
      try { message = clientMessage(await request.json()) }
      catch { return new Response('Invalid RPC request', { status: 400 }) }
      if (message.method !== endpoint) return new Response('Invalid RPC method', { status: 400 })
      let result
      try { result = { ok: true, value: await handler(message.payload ?? {}, AbortSignal.any([request.signal, lifetime.signal])) } }
      catch (error) {
        const safe = error instanceof DecisionError
        result = { ok: false, error: { code: safe ? error.code : 'operationFailed',
          message: safe ? error.message : '决策操作未完成，请查看插件日志。', details: {} } }
        if (!safe) ctx.logger?.warn('Ask Jev 操作失败：%s', action)
      }
      return Response.json({ type: 'server-response', rpcId: message.rpcId, result })
    } })
  }
}
