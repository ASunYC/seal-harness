import { z } from 'zod'
import { clientRequestSchema } from '@deepseek-ai/dsh-client-connection'
import { OrganizationError, OrganizationService } from './service.js'

export const name = 'seal-harness-organization'
export const inject = ['connection', 'sealHarnessDatabase', 'sealHarnessIdentity']

export function apply(ctx) {
  const service = new OrganizationService({ storage: ctx.sealHarnessDatabase, identity: ctx.sealHarnessIdentity })
  ctx.provide('sealHarnessOrganization', service)
  const handlers = {
    snapshot(input) { z.strictObject({}).parse(input); return service.snapshot() },
    'company/save': input => service.saveCompany(input),
    'department/save': input => service.saveDepartment(input),
    'department/delete': input => service.deleteDepartment(input),
    'person/save': input => service.savePerson(input),
    'person/delete': input => service.deletePerson(input),
  }
  for (const [action, handler] of Object.entries(handlers)) {
    const endpoint = `seal-harness-organization/${action}`
    ctx.connection.fetch.register({ path: `/api/${endpoint}`, methods: ['POST'], requestBody: 'buffered', async fetch(request) {
      if (request.headers.get('content-type')?.split(';')[0].trim() !== 'application/json') return new Response('Expected JSON', { status: 415 })
      let message
      try { message = clientRequestSchema.parse(await request.json()) }
      catch { return new Response('Invalid RPC request', { status: 400 }) }
      if (message.method !== endpoint) return new Response('Invalid RPC method', { status: 400 })
      let result
      try { result = { ok: true, value: handler(message.payload ?? {}) } }
      catch (error) {
        const expected = error instanceof OrganizationError || error instanceof z.ZodError
        if (!expected) ctx.logger?.error(error)
        result = { ok: false, error: { code: error instanceof OrganizationError ? error.code : 'organizationFailed',
          message: error instanceof OrganizationError ? error.message : error instanceof z.ZodError ? '组织资料格式无效，请检查填写内容。' : '组织资料操作未完成，请查看日志。', details: {} } }
      }
      return Response.json({ type: 'server-response', rpcId: message.rpcId, result })
    } })
  }
}
