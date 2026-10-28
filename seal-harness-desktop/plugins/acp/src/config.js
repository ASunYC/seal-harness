import { isAbsolute } from 'node:path'
import { realpath, stat } from 'node:fs/promises'
import { z } from 'zod'

export class AcpError extends Error {
  constructor(code, message, options) { super(message, options); this.code = code }
}
export async function abortable(operation, signal) {
  signal.throwIfAborted()
  let onAbort
  const aborted = new Promise((_, reject) => { onAbort = () => reject(signal.reason); signal.addEventListener('abort', onAbort, { once: true }) })
  try { return await Promise.race([operation, aborted]) } finally { signal.removeEventListener('abort', onAbort) }
}
const text = (max = 4096) => z.string().max(max).refine(value => !value.includes('\0'), '不能包含空字符')
export const runnerId = z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}$/)
export const runnerConfig = z.strictObject({
  command: text().trim().min(1).refine(value => isAbsolute(value) || !/[\\/\r\n]/.test(value), '命令必须是绝对路径或 PATH 中的程序名'),
  args: z.array(text(8192)).max(64).default([]),
  cwd: text().trim().min(1).refine(isAbsolute, '工作目录必须是绝对路径'),
  timeoutSeconds: z.number().int().min(5).max(3600).default(300),
  permission: z.enum(['reject', 'allow-once']).default('reject'),
})
export const environmentSchema = z.record(z.string().regex(/^[A-Za-z_][A-Za-z0-9_]{0,127}$/), text(16384))
  .refine(value => Object.keys(value).length <= 32 && !Object.keys(value).some(key => /^(DSH_|ELECTRON_|NODE_OPTIONS$)/i.test(key)), '环境变量超限或包含产品保留变量')

export const presets = Object.freeze([
  { id: 'opencode', name: 'OpenCode', command: 'opencode', args: ['acp'], note: '需要已安装并登录的 OpenCode ACP 模式。' },
  { id: 'codebuddy', name: 'CodeBuddy', command: 'codebuddy', args: ['--acp'], note: '需要 CodeBuddy 的 ACP 模式。' },
  { id: 'claude', name: 'Claude Code', command: 'claude-agent-acp', args: [], note: '需要单独安装并配置 Claude ACP adapter；普通 claude 命令不等于 ACP。' },
  { id: 'codex', name: 'Codex', command: 'codex-acp', args: [], note: '需要 Codex ACP adapter，并使用其自己的登录/模型配置。' },
  { id: 'kimi', name: 'Kimi Code', command: 'kimi', args: ['acp'], note: '先使用 Kimi 自身登录，再启动 ACP。' },
  { id: 'cursor', name: 'Cursor CLI', command: 'agent', args: ['acp'], note: '需要 Cursor CLI ACP 模式及其自己的授权。' },
  { id: 'pi', name: 'Pi', command: 'pi-acp', args: [], note: '需要预先安装 pi-acp；不会自动使用 npx 下载。' },
])

export async function usableDirectory(path) {
  const resolved = await realpath(path).catch(() => { throw new AcpError('invalidDirectory', '工作目录不存在或不可访问。') })
  if (!(await stat(resolved)).isDirectory()) throw new AcpError('invalidDirectory', '工作目录必须是文件夹。')
  return resolved
}

export async function discover(subprocess, command, signal, environment) {
  const bound = signal ?? AbortSignal.timeout(2000)
  try {
    const executable = await abortable(subprocess.resolveExecutable(command, environment, bound), bound)
    const supported = process.platform !== 'win32' || !/\.(cmd|bat|ps1)$/i.test(executable)
    return { found: true, executable, supported, message: supported ? '已找到程序，仍需检查 ACP 协议和登录。' : 'Windows 脚本入口不能直接作为程序启动；请将命令改为 node.exe，参数填写 adapter 的实际 JS 入口。' }
  } catch (error) {
    if (signal?.aborted) throw error
    return { found: false, supported: false, message: bound.aborted ? '程序检查超时，请检查路径是否可访问。' : '未找到程序，请先安装对应 ACP CLI/adapter，或填写其绝对路径。' }
  }
}
