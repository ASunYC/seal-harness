import { execFile as execFileCallback } from 'node:child_process'
import { lstat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { isAbsolute, join } from 'node:path'
import { promisify } from 'node:util'
import { blenderConnector } from '../../capability-shared/src/catalog.js'
import { ConnectorError } from './schema.js'

const execFile = promisify(execFileCallback)
const packageSpec = `mcp-for-blender==${blenderConnector.version}`
const runtimeArgs = ['--python', '3.11', '--from', packageSpec, 'mcp-for-blender']

export async function findUvx({ environment = process.env, home = homedir(), platform = process.platform, stat = lstat } = {}) {
  const pathValue = Object.entries(environment).find(([name]) => name.toUpperCase() === 'PATH')?.[1] ?? ''
  const directories = [join(home, '.local', 'bin'), ...pathValue.split(platform === 'win32' ? ';' : ':')]
  const executable = platform === 'win32' ? 'uvx.exe' : 'uvx'
  for (const directory of new Set(directories.filter(isAbsolute))) {
    const candidate = join(directory, executable)
    try {
      const info = await stat(candidate)
      if (info.isFile() && !info.isSymbolicLink()) return candidate
    } catch { /* 继续检查其他已知目录。 */ }
  }
  throw new ConnectorError('未找到 uvx。请先安装 uv，然后重新安装 Blender MCP。')
}

export function blenderConfiguration(command) {
  return {
    id: blenderConnector.id, catalogId: blenderConnector.id, name: blenderConnector.displayName,
    summary: blenderConnector.description, category: 'development', transport: 'stdio', command,
    args: runtimeArgs, env: { UV_PYTHON_PREFERENCE: 'only-managed', BLENDER_MCP_SAFE_MODE: '1' },
    toolCallTimeoutMs: 120000, installed: true, enabled: false,
  }
}

export function createBlenderIntegration({ locate = findUvx, run = execFile } = {}) {
  return {
    async prepare(signal) {
      signal?.throwIfAborted()
      const command = await locate()
      signal?.throwIfAborted()
      try {
        await run(command, [...runtimeArgs, 'install-addon'], {
          env: { ...process.env, UV_PYTHON_PREFERENCE: 'only-managed' },
          windowsHide: true, timeout: 180000, maxBuffer: 32768, signal,
        })
      } catch {
        signal?.throwIfAborted()
        throw new ConnectorError('Blender 插件安装失败。请检查 Blender、uv 和网络后重试。')
      }
      signal?.throwIfAborted()
      return blenderConfiguration(command)
    },
  }
}
