import { z } from 'zod'
import { clientRequestSchema } from '@deepseek-ai/dsh-client-connection'
import { createLocalProjects, ProjectError } from './local-store.js'

export const name = 'seal-harness-projects'
export const inject = ['connection', 'sealHarnessDatabase', 'sealHarnessIdentity']
export const Config = z.object({}).default({})

export function apply(ctx) {
  const projects = createLocalProjects(ctx.sealHarnessDatabase, ctx.sealHarnessIdentity)
  ctx.provide('sealHarnessProjects', projects)
  const handlers = { list: () => projects.list(), detail: input => projects.detail(input), create: input => projects.create(input),
    update: input => projects.update(input), delete: input => projects.delete(input) }
  for (const [action, handler] of Object.entries(handlers)) {
    const endpoint = `seal-harness-projects/${action}`
    ctx.connection.fetch.register({ path: `/api/${endpoint}`, methods: ['POST'], requestBody: 'buffered', async fetch(request) {
      if (request.headers.get('content-type')?.split(';')[0].trim() !== 'application/json') return new Response('Expected JSON', { status: 415 })
      let message
      try { message = clientRequestSchema.parse(await request.json()) }
      catch { return new Response('Invalid RPC request', { status: 400 }) }
      if (message.method !== endpoint) return new Response('Invalid RPC method', { status: 400 })
      let result
      try { result = { ok: true, value: await handler(message.payload ?? {}) } }
      catch (error) {
        const code = error instanceof ProjectError ? error.code : error instanceof z.ZodError ? 'invalidRequest' : 'operationFailed'
        const safe = error instanceof ProjectError ? error.message : '项目操作未完成，请重试。'
        result = { ok: false, error: { code, message: safe, details: {} } }
      }
      return Response.json({ type: 'server-response', rpcId: message.rpcId, result })
    } })
  }
}
