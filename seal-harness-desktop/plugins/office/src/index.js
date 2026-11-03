import { dirname, join } from 'node:path'
import { createRequire } from 'node:module'
import { clientRequestSchema } from '@deepseek-ai/dsh-client-connection'
import { z } from 'zod'
import { OfficeError, OfficeService } from './service.js'

export const name = 'seal-harness-office'
export const inject = ['connection', 'sealHarnessIdentity', 'sealHarnessDatabase']
export function apply(ctx) {
  const namespace = createRequire(import.meta.url)('../package.json').office.storageNamespace
  if (!/^[a-z0-9-]{1,64}$/u.test(namespace)) throw new Error('Invalid Office storage namespace')
  const service = new OfficeService({ root: join(dirname(ctx.sealHarnessDatabase.path), 'office-documents', namespace), identity: ctx.sealHarnessIdentity })
  ctx.provide('sealHarnessOffice', service)
  ctx.effect(() => () => service.dispose(), 'local Office worker lifecycle')
  for (const action of ['snapshot','create','import','inspect','edit','download']) {
    const endpoint = `seal-harness-office/${action}`
    ctx.connection.fetch.register({ path: `/api/${endpoint}`, methods: ['POST'], requestBody: 'buffered', async fetch(request) {
      if (request.headers.get('content-type')?.split(';')[0].trim() !== 'application/json') return new Response('Expected JSON', { status: 415 })
      const bytes = await request.arrayBuffer()
      if (bytes.byteLength > 12 * 1024 * 1024) return new Response('File too large', { status: 413 })
      let message
      try { message = clientRequestSchema.parse(JSON.parse(new TextDecoder().decode(bytes))) }
      catch { return new Response('Invalid RPC request', { status: 400 }) }
      if (message.method !== endpoint) return new Response('Invalid method', { status: 400 })
      try { return Response.json({ type: 'server-response', rpcId: message.rpcId, result: { ok: true, value: await service[action](message.payload ?? {}, request.signal) } }) }
      catch (error) {
        const known = error instanceof OfficeError
        return Response.json({ type: 'server-response', rpcId: message.rpcId, result: { ok: false, error: { code: known ? error.code : error instanceof z.ZodError ? 'invalidInput' : 'officeFailed', message: known ? error.message : '文档参数无效或操作未完成，原文件未改动。', details: {} } } })
      }
    } })
  }
}
