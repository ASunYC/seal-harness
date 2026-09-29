import { join } from 'node:path'
import { z } from 'zod'
import { resolveDshHome } from '@deepseek-ai/dsh-home-paths'
import { clientRequestSchema } from '@deepseek-ai/dsh-client-connection'
import { createAgentService } from './service.js'

export const name = 'seal-harness-agents'
export const inject = ['connection', 'sealHarnessServices', 'sealHarnessIdentity', 'credentials', 'settings', 'llm', 'agents', 'sessions', 'workspaceRegistry']
export const Config = z.strictObject({}).default({})
const instance = z.strictObject({ kind: z.enum(['flow', 'autonomous']), target: z.enum(['local', 'remote', 'platform']), id: z.string().min(1).max(160) })
const requestSchema = instance.omit({ id: true }).extend({ request: z.record(z.string(), z.unknown()) })

export async function apply(ctx) {
  const service = await createAgentService(ctx, { home: resolveDshHome(), resources: join(import.meta.dirname, 'resources') })
  ctx.provide('sealHarnessAgents', service)
  const lifetime = new AbortController()
  ctx.effect(() => async () => { lifetime.abort(); await service.dispose() }, 'seal-harness-agents requests')
  const handlers = {
    catalog: input => { z.strictObject({}).parse(input); return service.catalog() },
    models: input => { z.strictObject({}).parse(input); return service.models() },
    request: input => service.request(requestSchema.parse(input)),
    open: input => service.open(instance.parse(input)),
  }
  for (const [action, handler] of Object.entries(handlers)) {
    const endpoint = `seal-harness-agents/${action}`
    ctx.connection.fetch.register({ path: `/api/${endpoint}`, methods: ['POST'], requestBody: 'buffered', async fetch(request) {
      if (request.headers.get('content-type')?.split(';')[0].trim() !== 'application/json') return new Response('Expected JSON', { status: 415 })
      let message
      try { message = clientRequestSchema.parse(await request.json()) } catch { return new Response('Invalid RPC request', { status: 400 }) }
      if (message.method !== endpoint) return new Response('Invalid RPC method', { status: 400 })
      let result
      try {
        lifetime.signal.throwIfAborted(); request.signal.throwIfAborted()
        const value = await handler(message.payload ?? {})
        lifetime.signal.throwIfAborted()
        result = { ok: true, value }
      } catch (error) {
        result = { ok: false, error: { code: error instanceof z.ZodError ? 'invalidInput' : error.code ?? 'operationFailed', message: error instanceof z.ZodError ? '实例参数无效，请检查必填字段。' : error.message } }
      }
      return Response.json({ type: 'server-response', rpcId: message.rpcId, result })
    } })
  }
}
