import { clientRequestSchema } from '@deepseek-ai/dsh-client-connection'
import { z } from 'zod'
import { createRemoteClients } from './clients.js'
import { RemoteHostError, RemoteHostService } from './service.js'

export const name = 'seal-harness-remote-desktop'
export const inject = ['connection', 'sealHarnessIdentity', 'sealHarnessDatabase']

export function apply(ctx) {
  const service = new RemoteHostService({ identity: ctx.sealHarnessIdentity, storage: ctx.sealHarnessDatabase, clients: createRemoteClients() })
  ctx.provide('sealHarnessRemoteHosts', service)
  ctx.effect(() => () => service.dispose(), 'seal-harness remote desktop lifecycle')
  for (const action of ['snapshot', 'save', 'delete', 'check', 'connect']) {
    const endpoint = `seal-harness-remote-desktop/${action}`
    ctx.connection.fetch.register({ path: `/api/${endpoint}`, methods: ['POST'], requestBody: 'buffered', async fetch(request) {
      if (request.headers.get('content-type')?.split(';')[0].trim() !== 'application/json') return new Response('Expected JSON', { status: 415 })
      let message
      try { message = clientRequestSchema.parse(await request.json()) }
      catch { return new Response('Invalid RPC request', { status: 400 }) }
      if (message.method !== endpoint) return new Response('Invalid RPC method', { status: 400 })
      let result
      try { result = { ok: true, value: await service[action](message.payload ?? {}, request.signal) } }
      catch (error) {
        const expected = error instanceof RemoteHostError || error instanceof z.ZodError
        if (!expected) ctx.logger?.warn(`远程主机操作 ${action} 未完成。`)
        result = { ok: false, error: { code: error instanceof RemoteHostError ? error.code : 'remoteHostFailed',
          message: error instanceof z.ZodError ? error.issues[0]?.message ?? '连接参数无效。' : expected ? error.message : '远程主机操作未完成，请重试。', details: {} } }
      }
      return Response.json({ type: 'server-response', rpcId: message.rpcId, result })
    } })
  }
}
