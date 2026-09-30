import { dirname } from 'node:path'
import { z } from 'zod'
import { clientRequestSchema } from '@deepseek-ai/dsh-client-connection'
import { LocalIdentityError, LocalIdentityService } from './local-service.js'
import { loadServices, servicesSchema } from './services.js'

export const name = 'seal-harness-identity'
export const inject = ['connection', 'sealHarnessDatabase']
export const Config = z.strictObject({ services: servicesSchema.default({}) }).default({ services: {} })

export async function apply(ctx, config = {}) {
  const identity = new LocalIdentityService(ctx.sealHarnessDatabase)
  const services = await loadServices({ home: dirname(ctx.sealHarnessDatabase.path), services: config.services })
  ctx.provide('sealHarnessIdentity', identity)
  ctx.provide('sealHarnessServices', services)
  ctx.effect(() => () => identity.dispose(), 'seal-harness local identity')

  const empty = z.strictObject({})
  const handlers = {
    status(input) { empty.parse(input); return identity.getStatus() },
    register(input) { return identity.register(input) },
    login(input) { return identity.login(input) },
    logout(input) { empty.parse(input); return identity.logout() },
    'password/change'(input) { return identity.changePassword(input) },
  }
  for (const [action, handler] of Object.entries(handlers)) {
    const endpoint = `seal-harness-identity/${action}`
    ctx.connection.fetch.register({ path: `/api/${endpoint}`, methods: ['POST'], requestBody: 'buffered', async fetch(request) {
      if (request.headers.get('content-type')?.split(';')[0].trim() !== 'application/json') return new Response('Expected JSON', { status: 415 })
      let message
      try { message = clientRequestSchema.parse(await request.json()) }
      catch { return new Response('Invalid RPC request', { status: 400 }) }
      if (message.method !== endpoint) return new Response('Invalid RPC method', { status: 400 })
      let result
      try { result = { ok: true, value: await handler(message.payload ?? {}) } }
      catch (error) {
        const code = error instanceof LocalIdentityError ? error.code : error instanceof z.ZodError ? 'invalidInput' : 'operationFailed'
        const message = error instanceof LocalIdentityError ? error.message : '本地账号操作未完成，请重试。'
        result = { ok: false, error: { code, message, details: {} } }
      }
      return Response.json({ type: 'server-response', rpcId: message.rpcId, result })
    } })
  }
}
