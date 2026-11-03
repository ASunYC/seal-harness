import { z } from 'zod'
import { clientRequestSchema } from '@deepseek-ai/dsh-client-connection'
import { ComputerUseError } from './config.js'
import { ComputerUseService } from './service.js'

export const name = 'seal-harness-computer-use'
export const inject = ['connection', 'sealHarnessIdentity', 'credentials', 'agents', 'sessionController']
export function apply(ctx) {
  const service = new ComputerUseService(ctx)
  ctx.provide('sealHarnessComputerUse', service)
  ctx.effect(() => () => service.dispose(), 'seal computer-use lifecycle')
  for (const action of ['snapshot', 'save', 'delete', 'check', 'start', 'stop']) {
    const method = `seal-harness-computer-use/${action}`
    ctx.connection.fetch.register({ path: `/api/${method}`, methods: ['POST'], requestBody: 'buffered', async fetch(request) {
      if (request.headers.get('content-type')?.split(';')[0].trim() !== 'application/json') return new Response('Expected JSON', { status: 415 })
      let message
      try { message = clientRequestSchema.parse(await request.json()) } catch { return new Response('Invalid RPC request', { status: 400 }) }
      if (message.method !== method) return new Response('Invalid RPC method', { status: 400 })
      let result
      try { result = { ok: true, value: await service[action](message.payload ?? {}, request.signal) } }
      catch (error) {
        const expected = error instanceof ComputerUseError || error instanceof z.ZodError
        if (!expected) ctx.logger?.warn(`电脑操作 ${action} 失败。`)
        result = { ok: false, error: { code: error instanceof ComputerUseError ? error.code : 'computerUseFailed',
          message: error instanceof z.ZodError ? error.issues[0]?.message ?? '电脑操作参数无效。' : expected ? error.message : '电脑操作未完成，请检查目标驱动、桌面权限或SSH连接。', details: {} } }
      }
      return Response.json({ type: 'server-response', rpcId: message.rpcId, result })
    } })
  }
}
