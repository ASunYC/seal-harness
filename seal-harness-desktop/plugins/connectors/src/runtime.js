import { dirname, join } from 'node:path'

/**
 * 旧版 CodeGraph 连接器的包装脚本不会转发工作区参数；在 Host 侧直接启动其受校验的随包 CLI。
 * 其他 STDIO 连接器保持 descriptor 声明的命令、参数和工作目录。
 */
export function resolveStdioRuntime(entry, env) {
  if (entry.workspacePath && entry.bootstrap?.instructions?.blockId === 'codegraph') {
    const codegraphRoot = dirname(entry.command)
    return {
      command: entry.command,
      args: [
        '--liftoff-only', join(codegraphRoot, 'lib', 'dist', 'bin', 'codegraph.js'),
        'serve', '--mcp', '--path', entry.workspacePath,
      ],
      cwd: entry.cwd,
      env: {
        ...env,
        CODEGRAPH_NO_DOWNLOAD: '1',
        CODEGRAPH_NO_DAEMON: '1',
        CODEGRAPH_TELEMETRY: '0',
        DO_NOT_TRACK: '1',
      },
    }
  }
  return { command: entry.command, args: entry.args, cwd: entry.cwd, env }
}
