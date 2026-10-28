import { clientRequestSchema } from '@deepseek-ai/dsh-client-connection'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { z } from 'zod'
import { AcpError } from './config.js'
import { AcpService } from './service.js'

export const name = 'seal-harness-acp'
export const inject = ['connection', 'sealHarnessDatabase', 'sealHarnessIdentity', 'credentials', 'subprocess', 'tools']

export function apply(ctx) {
  const service = new AcpService({ storage: ctx.sealHarnessDatabase, identity: ctx.sealHarnessIdentity, credentials: ctx.credentials, subprocess: ctx.subprocess })
  ctx.provide('sealHarnessAcp', service)
  ctx.effect(() => () => service.dispose(), 'seal-harness ACP lifecycle')
  for (const action of ['snapshot', 'save', 'toggle', 'delete', 'check', 'run', 'cancel']) {
    const endpoint = `seal-harness-acp/${action}`
    ctx.connection.fetch.register({ path: `/api/${endpoint}`, methods: ['POST'], requestBody: 'buffered', async fetch(request) {
      if (request.headers.get('content-type')?.split(';')[0].trim() !== 'application/json') return new Response('Expected JSON', { status: 415 })
      let message
      try { message = clientRequestSchema.parse(await request.json()) } catch { return new Response('Invalid RPC request', { status: 400 }) }
      if (message.method !== endpoint) return new Response('Invalid RPC method', { status: 400 })
      let result
      try { result = { ok: true, value: await service[action](message.payload ?? {}) } }
      catch (error) { result = { ok: false, error: { code: error instanceof AcpError ? error.code : 'acpFailed', message: error instanceof AcpError ? error.message : error instanceof z.ZodError ? 'Runner 配置或请求格式无效。' : 'ACP 操作未完成，请检查配置。', details: {} } } }
      return Response.json({ type: 'server-response', rpcId: message.rpcId, result })
    } })
  }
  const output = { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] }
  ctx.tools.register(defineTool({ name: 'list_acp_runners', description: '列出本机账号配置并启用的 ACP 编程 Runner。程序被发现不等于已通过协议检查或登录。', parameters: {}, output,
    async execute() { return JSON.stringify((await service.snapshot()).items.filter(item => item.enabled)) } }))
  ctx.tools.register(defineTool({ name: 'acp_runner', description: '通过已配置并启用的 ACP Runner 执行用户指定的编程任务。使用该 Runner 保存的工作目录与权限策略；它在独立进程中使用自己的模型/账号，结果来自真实 ACP 协议。先用 list_acp_runners 查询标识。',
    parameters: { id: { type: 'string', required: true, description: '已启用 Runner 的准确 id。' }, prompt: { type: 'string', required: true, description: '要交给外部编程 Runner 的独立任务。' } }, output,
    async execute(input, execution) { return JSON.stringify(await service.execute(input, execution.signal)) } }))
}
