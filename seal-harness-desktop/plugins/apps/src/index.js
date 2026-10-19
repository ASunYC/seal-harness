import { z } from 'zod'
import { clientRequestSchema } from '@deepseek-ai/dsh-client-connection'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { ApplicationsService } from './service.js'
import { AppError } from './installer.js'

export const name = 'seal-harness-apps'
export const inject = ['connection', 'sealHarnessDatabase', 'sealHarnessIdentity', 'sealHarnessConnectors', 'tools']

export function apply(ctx) {
  const service = new ApplicationsService({ storage: ctx.sealHarnessDatabase, identity: ctx.sealHarnessIdentity, connectors: ctx.sealHarnessConnectors, logger: ctx.logger })
  ctx.effect(() => {
    const unsubscribe = ctx.sealHarnessIdentity.subscribe(() => service.identityChanged())
    void service.restore()
    return async () => { unsubscribe(); await service.dispose() }
  }, 'seal-harness applications lifecycle')
  ctx.provide('sealHarnessApps', service)
  const handlers = { list: () => service.list(), install: () => service.start('install'), uninstall: () => service.start('uninstall'), open: () => service.open(), reconnect: () => service.reconnect() }
  for (const [action, handler] of Object.entries(handlers)) {
    const endpoint = `seal-harness-apps/${action}`
    ctx.connection.fetch.register({ path: `/api/${endpoint}`, methods: ['POST'], requestBody: 'buffered', async fetch(request) {
      if (request.headers.get('content-type')?.split(';')[0].trim() !== 'application/json') return new Response('Expected JSON', { status: 415 })
      let message
      try { message = clientRequestSchema.parse(await request.json()) } catch { return new Response('Invalid RPC request', { status: 400 }) }
      if (message.method !== endpoint) return new Response('Invalid RPC method', { status: 400 })
      let result
      try {
        z.strictObject(action === 'list' ? {} : { id: z.literal('dbx') }).parse(message.payload ?? {})
        result = { ok: true, value: await handler() }
      } catch (error) {
        ctx.logger?.warn('应用操作失败：%s', action)
        result = { ok: false, error: { code: 'applicationFailed', message: error instanceof AppError ? error.message : error instanceof z.ZodError ? '应用请求格式无效。' : '应用操作未完成，请重试或查看日志。', details: {} } }
      }
      return Response.json({ type: 'server-response', rpcId: message.rpcId, result })
    } })
  }
  ctx.effect(() => ctx.tools.register(defineTool({
    name: 'open_installed_application', description: '用户要求打开已安装的 DBX 数据库应用时使用。数据库查询请使用已加入会话的 DBX MCP 连接器工具。',
    parameters: { id: { type: 'string', required: true, enum: ['dbx'], description: '应用标识 dbx。' } },
    output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
    async execute(args) { z.strictObject({ id: z.literal('dbx') }).parse(args); return JSON.stringify(await service.open()) },
  })), 'seal-harness open installed application')
}
