import { randomUUID } from 'node:crypto'
import { defineTool } from '@deepseek-ai/dsh-tools'

const output = { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] }

export function registerConnectorCreationTool(ctx, connectors) {
  return ctx.tools.register(defineTool({
    name: 'create_connector',
    description: '根据用户在对话中明确给出的真实 MCP 地址或本机可执行文件路径，创建当前账号的未安装个人连接器。信息不足时先询问；不要编造端点，不要在工具参数中收集密钥。保存成功后才能告知用户创建完成。',
    parameters: {
      name: { type: 'string', required: true, description: '用户可见的连接器名称。' },
      summary: { type: 'string', required: true, description: '连接器的用途。' },
      transport: { type: 'string', required: true, enum: ['streamable-http', 'sse', 'stdio'], description: 'MCP 连接方式。' },
      url: { type: 'string', description: 'HTTP/SSE 的真实 MCP URL。' },
      command: { type: 'string', description: 'stdio 的本机可执行文件绝对路径。' },
      args: { type: 'array', items: { type: 'string' }, description: 'stdio 的命令参数，不含密钥。' },
      cwd: { type: 'string', description: 'stdio 的本机工作目录绝对路径，可选。' },
      category: { type: 'string', enum: ['office', 'development'], description: '办公类或开发类。' },
    },
    output,
    async execute(args, execution) {
      execution.signal.throwIfAborted()
      const accountId = ctx.get('sealHarnessIdentity')?.getSession()?.accountId
      if (!accountId) throw new Error('请先登录 Seal Harness 本机账号。')
      if (!args.name?.trim() || !args.summary?.trim()) throw new Error('请补充连接器名称和用途。')
      const current = await connectors.call('list')
      if (current.items.some(item => item.name === args.name)) throw new Error('当前账号已有同名连接器，请换一个名称。')
      execution.signal.throwIfAborted()
      if (ctx.get('sealHarnessIdentity')?.getSession()?.accountId !== accountId) throw new Error('登录账号已变化，请重新发起创建。')
      const saved = await connectors.call('createDraft', {
        id: `local-${randomUUID().slice(0, 8)}`, name: args.name.trim(), summary: args.summary.trim(),
        transport: args.transport, category: args.category ?? 'office',
        ...(args.transport === 'stdio'
          ? { command: args.command ?? '', args: args.args ?? [], cwd: args.cwd ?? '' }
          : { url: args.url ?? '' }),
      })
      const item = saved.items.find(item => item.name === args.name.trim() && item.installed === false)
      if (!item) throw new Error('连接器保存结果不完整，请刷新个人列表核对。')
      return JSON.stringify({ status: 'created', id: item.id, name: item.name, installed: false, message: '连接器已创建完成，前往「连接器 > 个人」安装并配置凭据。' })
    },
  }))
}
