import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { lstat, readFile, realpath, writeFile } from 'node:fs/promises'
import { join, isAbsolute } from 'node:path'
import { safeRelative } from '../../skills/src/package.js'
import { ConnectorError } from './schema.js'

const execute = promisify(execFile)
export async function prepareWorkspace(entry, path, signal) {
  if (!isAbsolute(path)) throw new ConnectorError('工作区需要绝对路径。')
  const root = await realpath(path)
  if (!(await lstat(root)).isDirectory()) throw new ConnectorError('请选择工作区目录。')
  if (!entry.bootstrap) return root
  const { directory, ...bootstrap } = entry.bootstrap
  const marker = join(root, safeRelative(bootstrap.completionMarker))
  const complete = async () => { try { return (await lstat(marker)).isFile() } catch (error) { if (error.code === 'ENOENT') return false; throw error } }
  if (!await complete()) {
    await execute(join(directory, safeRelative(bootstrap.executable)), [join(directory, safeRelative(bootstrap.entrypoint)), ...bootstrap.args], { cwd: root, signal, timeout: bootstrap.timeoutMs, maxBuffer: 1024 * 1024, windowsHide: true })
    if (!await complete()) throw new ConnectorError('工作区初始化未生成完成标记，请检查连接器程序。')
  }
  const file = join(root, 'AGENTS.md'), start = `<!-- SEAL_HARNESS-CONNECTOR:${entry.id}:START -->`, end = `<!-- SEAL_HARNESS-CONNECTOR:${entry.id}:END -->`
  let content = ''
  try { content = await readFile(file, 'utf8') } catch (error) { if (error.code !== 'ENOENT') throw error }
  const block = `${start}\n${bootstrap.instructions.content}\n${end}`
  const first = content.indexOf(start), last = content.indexOf(end)
  if (first >= 0 && last >= first) content = content.slice(0, first) + block + content.slice(last + end.length)
  else content = `${content.trimEnd()}\n\n${block}\n`.trimStart()
  await writeFile(file, content)
  return root
}
