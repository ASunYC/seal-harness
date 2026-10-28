import { z } from 'zod'
import { clientRequestSchema } from '@deepseek-ai/dsh-client-connection'
import { createKnowledgeService } from './service.js'

export const name = '@seal-harness/knowledge'
export const inject = ['connection', 'sealHarnessWeknora']

export function apply(ctx) {
  const lifetime = new AbortController()
  ctx.effect(() => () => lifetime.abort(), 'knowledge: requests')
  const service = createKnowledgeService(ctx.sealHarnessWeknora)
  ctx.provide('sealHarnessKnowledge', service)
  for (const [action, handler] of Object.entries(service)) {
    const endpoint = `seal-harness-knowledge/${action}`
    ctx.connection.fetch.register({ path: `/api/${endpoint}`, methods: ['POST'], requestBody: 'buffered', async fetch(request) {
      if (request.headers.get('content-type')?.split(';')[0].trim() !== 'application/json') return new Response('Expected JSON', { status: 415 })
      if (Number(request.headers.get('content-length')) > 25 * 1024 * 1024) return new Response('Request too large', { status: 413 })
      let message
      try { message = clientRequestSchema.parse(await request.json()) }
      catch { return new Response('Invalid RPC request', { status: 400 }) }
      if (message.method !== endpoint) return new Response('Invalid RPC method', { status: 400 })
      let result
      try { result = { ok: true, value: await handler(message.payload ?? {}, AbortSignal.any([lifetime.signal, request.signal])) } }
      catch (error) {
        const invalid = error instanceof z.ZodError
        result = { ok: false, error: { code: invalid ? 'invalidInput' : error.code ?? 'knowledgeFailed', message: invalid ? '请检查名称、文档、文件大小或检索内容。' : error.message ?? '知识库操作未完成。', details: {} } }
      }
      return Response.json({ type: 'server-response', rpcId: message.rpcId, result })
    } })
  }
}
