import { join } from 'node:path'
import { createMcpToolDefinition } from '@deepseek-ai/dsh-mcp-client'
import { z } from 'zod'
import { catalogConnector } from '../../capability-shared/src/catalog.js'
import { createConnectorAdapter } from '../../capability-shared/vendor/cc-haha/cliAdapter.ts'
import { defaultRuntimeDependencies, managedInstallation, verifyManagedBinary } from '../../capability-shared/vendor/cc-haha/managedRuntime.ts'

export function nativeAdapter(id, home, owner, dependencies = defaultRuntimeDependencies) {
  const definition = catalogConnector(id), root = join(home, 'seal-harness-capabilities', 'office-cli', owner)
  if (definition.transport !== 'cli') throw new Error('不是办公 CLI 连接器。')
  return { definition, installation: managedInstallation(definition, root, dependencies),
    adapter: createConnectorAdapter(definition, root, dependencies), dependencies }
}

export const inject = ['tools']
export function apply(ctx, { serverName, native }) {
  const commandSchema = z.strictObject({ args: z.array(z.string().min(1).max(8192).refine(value => !value.includes('\0'))).max(100).default([]) })
  const description = `${native.definition.displayName}官方 CLI。先调用 help 查询命令，再执行业务命令。${native.definition.description ?? ''} 凭据与登录由连接器界面管理。`
  for (const rawName of ['help', 'execute']) {
    const tool = createMcpToolDefinition(ctx, { name: `mcp__${serverName}__${rawName}`, rawName,
      description: rawName === 'help' ? `${description} 返回帮助，不修改业务数据。` : description,
      inputSchema: { type: 'object', properties: { args: { type: 'array', items: { type: 'string' }, description: '官方 CLI 参数数组，不是 shell 命令。' } }, ...(rawName === 'execute' ? { required: ['args'] } : {}), additionalProperties: false },
      async call(input, execution) {
        const { args } = commandSchema.parse(input)
        if (rawName === 'execute' && (!args.length || args[0].startsWith('-'))) throw new Error('请提供明确的业务命令；查询帮助请使用 help。')
        if (['auth', 'config', 'logout'].includes(args[0])) throw new Error('请在连接器界面管理授权。')
        await verifyManagedBinary(native.definition, native.installation, native.dependencies)
        const result = await native.dependencies.run(native.installation.command, rawName === 'help' ? [...args, '--help'] : args,
          { env: native.installation.env, signal: execution.signal, timeoutMs: 60000 })
        return { content: [{ type: 'text', text: result.stdout || result.stderr || `退出码：${result.code}` }], isError: result.code !== 0 }
      },
    })
    ctx.effect(() => ctx.tools.register(tool))
  }
}
