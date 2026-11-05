import { dirname } from 'node:path'
import { z } from 'zod'
import { clientRequestSchema } from '@deepseek-ai/dsh-client-connection'
import { OfficeError, OfficeService } from './service.js'

export const name = 'seal-harness-workspace-word'
export const inject = ['connection', 'sessions', 'sandboxPolicy', 'fs', 'sealHarnessIdentity', 'sealHarnessDatabase', 'sealHarnessOffice']
const workerCodes = new Set(['loginRequired', 'accountChanged', 'cancelled', 'timeout', 'busy', 'readOnlyDocument', 'invalidDocument', 'closed'])

export function apply(ctx) {
  const service = new OfficeService({
    sessions: ctx.sessions, sandboxPolicy: ctx.sandboxPolicy, fs: ctx.fs,
    identity: ctx.sealHarnessIdentity, home: dirname(ctx.sealHarnessDatabase.path),
    transform: (input, signal) => ctx.sealHarnessOffice.transform(input, signal),
  })
  ctx.effect(() => () => service.dispose(), 'seal-harness-workspace-word: document leases')
  const handlers = {
    open: input => service.open(input),
    save: input => service.save(input),
    edit: input => service.edit(input),
    create: input => service.create(input),
    import: input => service.import(input),
    download: input => service.download(input),
    close: input => service.close(input),
  }
  for (const [action, handler] of Object.entries(handlers)) {
    const endpoint = `seal-harness-workspace-word/${action}`
    ctx.connection.fetch.register({ path: `/api/${endpoint}`, methods: ['POST'], requestBody: 'buffered', async fetch(request) {
      if (request.headers.get('content-type')?.split(';')[0].trim() !== 'application/json') return new Response('Expected JSON', { status: 415 })
      let message
      try { message = clientRequestSchema.parse(await request.json()) }
      catch { return new Response('Invalid RPC request', { status: 400 }) }
      if (message.method !== endpoint) return new Response('Invalid RPC method', { status: 400 })
      let result
      try { result = { ok: true, value: await handler(message.payload ?? {}) } }
      catch (error) {
        const workerError = workerCodes.has(error?.code)
        if (!(error instanceof OfficeError || error instanceof z.ZodError || workerError)) ctx.logger?.error(error)
        result = { ok: false, error: {
          code: error instanceof OfficeError || workerError ? error.code : error instanceof z.ZodError ? 'invalidRequest' : 'officeFailed',
          message: error instanceof OfficeError || workerError ? error.message : error instanceof z.ZodError ? '文档请求参数无效。' : '文档操作失败，请查看插件日志。',
          details: {},
        } }
      }
      return Response.json({ type: 'server-response', rpcId: message.rpcId, result })
    } })
  }
}
