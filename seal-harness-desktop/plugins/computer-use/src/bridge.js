import { createScope } from '@deepseek-ai/dsh-scope'
import { createMcpToolDefinition } from '@deepseek-ai/dsh-mcp-client'
import { backgroundArguments, publicToolSchema, supportedTools } from './background.js'

export const inject = ['tools']
export async function apply(ctx, options) {
  const tools = (await options.connection.listTools()).filter(tool => supportedTools.has(tool.name))
  for (const tool of tools) {
    const definition = createMcpToolDefinition(ctx, {
      name: `mcp__seal_computer__${tool.name}`, rawName: tool.name,
      description: `${tool.name}：操作当前已启用目标的已打开窗口。先读取窗口状态再操作。严格后台，不支持时拒绝，禁止前台升级；不能启动应用或控制全局鼠标。${tool.description ?? ''}`,
      inputSchema: publicToolSchema(tool), outputSchema: tool.outputSchema,
      call: async (input, execution) => {
        options.assertActive()
        const args = backgroundArguments(tool.name, input, { local: options.profile.mode === 'local' })
        // 每个进程连接使用自身的隐式session，不允许模型选择另一个Driver session。
        delete args.session
        if (tool.inputSchema?.properties?.session) args.session = options.label
        const result = await options.call(tool.name, args, execution.signal)
        options.assertActive()
        return result
      },
    })
    ctx.effect(() => ctx.tools.register(definition))
  }
  if (!tools.length) throw new Error('Cua Driver没有提供可用的后台窗口工具。')
}

export async function mountComputerScope(agent, options) {
  const scope = createScope(agent.ctx, agent)
  try {
    const prompt = scope.ctx.get('systemPrompt')
    if (!prompt) throw new Error('当前会话上下文服务未就绪。')
    prompt.context({ name: 'seal-computer-use', order: 85, required: true, interpolate: false,
      text: `当前电脑操作目标：${options.profile.name}（${options.profile.mode === 'local' ? '本机' : '虚拟机'}）。严格后台：先通过list_apps/list_windows找到已打开窗口，使用准确pid/window_id；每次动作前按需读取新状态及截图。只使用后台交付；后台失败应说明原因，不能用其他命令、脚本、浏览器、foreground或全局鼠标绕过。不能启动应用，需用户先打开目标软件。读取返回的实际画面/可访问性树验证结果，不把未验证的动作当成成功。停止授权后不可继续操作。` })
    await scope.ctx.plugin({ inject, apply }, options)
    return scope
  } catch (error) { await scope.dispose(); throw error }
}
