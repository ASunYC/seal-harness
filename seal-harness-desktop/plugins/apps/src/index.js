import { z } from 'zod'
import { clientRequestSchema } from '@deepseek-ai/dsh-client-connection'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { ApplicationsService } from './service.js'
import { BuildingBuiltService } from './buildingbuilt-service.js'
import { AppError } from './installer.js'

export const name = 'seal-harness-apps'
export const inject = ['connection', 'sealHarnessDatabase', 'sealHarnessIdentity', 'sealHarnessConnectors', 'tools']

export function apply(ctx) {
  const service = new ApplicationsService({ storage: ctx.sealHarnessDatabase, identity: ctx.sealHarnessIdentity, connectors: ctx.sealHarnessConnectors, logger: ctx.logger })
  const buildingBuilt = new BuildingBuiltService({ storage: ctx.sealHarnessDatabase, identity: ctx.sealHarnessIdentity, logger: ctx.logger })
  ctx.effect(() => {
    const unsubscribe = ctx.sealHarnessIdentity.subscribe(() => { service.identityChanged(); buildingBuilt.identityChanged() })
    void service.restore()
    return async () => { unsubscribe(); await Promise.all([service.dispose(), buildingBuilt.dispose()]) }
  }, 'seal-harness applications lifecycle')
  ctx.provide('sealHarnessApps', service)
  const handlers = {
    list: async () => {
      const account = service.account()
      const dbxItems = (await service.list()).items
      const item = buildingBuilt.list()
      const current = service.account()
      if (current.accountId !== account.accountId || current.epoch !== account.epoch) throw new AppError('账号已变化，请重试。')
      return { items: [...dbxItems, item] }
    },
    install: payload => payload.id === 'dbx' ? service.start('install') : buildingBuilt.start('install', payload.sourcePath),
    uninstall: payload => payload.id === 'dbx' ? service.start('uninstall') : buildingBuilt.start('uninstall'),
    open: payload => payload.id === 'dbx' ? service.open() : buildingBuilt.open(),
    reconnect: () => service.reconnect(),
  }
  for (const [action, handler] of Object.entries(handlers)) {
    const endpoint = `seal-harness-apps/${action}`
    ctx.connection.fetch.register({ path: `/api/${endpoint}`, methods: ['POST'], requestBody: 'buffered', async fetch(request) {
      if (request.headers.get('content-type')?.split(';')[0].trim() !== 'application/json') return new Response('Expected JSON', { status: 415 })
      let message
      try { message = clientRequestSchema.parse(await request.json()) } catch { return new Response('Invalid RPC request', { status: 400 }) }
      if (message.method !== endpoint) return new Response('Invalid RPC method', { status: 400 })
      let result
      try {
        const payload = action === 'list' ? z.strictObject({}).parse(message.payload ?? {})
          : action === 'reconnect' ? z.strictObject({ id: z.literal('dbx') }).parse(message.payload ?? {})
          : action === 'install' ? z.union([
            z.strictObject({ id: z.literal('dbx') }),
            z.strictObject({ id: z.literal('buildingbuilt'), sourcePath: z.string().min(1).max(2048) }),
          ]).parse(message.payload ?? {})
          : z.strictObject({ id: z.enum(['dbx', 'buildingbuilt']) }).parse(message.payload ?? {})
        result = { ok: true, value: await handler(payload) }
      } catch (error) {
        ctx.logger?.warn('应用操作失败：%s', action)
        result = { ok: false, error: { code: 'applicationFailed', message: error instanceof AppError ? error.message : error instanceof z.ZodError ? '应用请求格式无效。' : '应用操作未完成，请重试或查看日志。', details: {} } }
      }
      return Response.json({ type: 'server-response', rpcId: message.rpcId, result })
    } })
  }
  ctx.effect(() => ctx.tools.register(defineTool({
    name: 'open_installed_application', description: '打开已安装的 DBX 或 BuildingBuilt 独立桌面应用。数据库查询请使用已加入会话的 DBX MCP 连接器工具。',
    parameters: { id: { type: 'string', required: true, enum: ['dbx', 'buildingbuilt'], description: '应用标识。' } },
    output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
    async execute(args) { const { id } = z.strictObject({ id: z.enum(['dbx', 'buildingbuilt']) }).parse(args); return JSON.stringify(await (id === 'dbx' ? service.open() : buildingBuilt.open())) },
  })), 'seal-harness open installed application')
}
