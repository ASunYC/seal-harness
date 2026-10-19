import { createHash, randomUUID } from 'node:crypto'
import { mkdir, writeFile, readFile, rename, rm, lstat, readdir } from 'node:fs/promises'
import { basename, dirname, join, relative, resolve, isAbsolute } from 'node:path'
import AdmZip from 'adm-zip'

export class AppError extends Error { code = 'applicationFailed' }
export const digest = bytes => createHash('sha256').update(bytes).digest('hex')
const MAX_ARCHIVE = 160 * 1024 * 1024
const MAX_EXTRACTED = 400 * 1024 * 1024

/** 所有删除均限于本账号的程序目录，拒绝 junction / symlink。 */
export async function removeManaged(root, target) {
  const base = resolve(root), path = resolve(target), rel = relative(base, path)
  if (!rel || rel.startsWith('..') || isAbsolute(rel)) throw new AppError('应用文件路径不在安装目录内。')
  let parent = path
  for (;;) {
    const info = await lstat(parent).catch(error => { if (error.code === 'ENOENT') return null; throw error })
    if (info?.isSymbolicLink()) throw new AppError('应用目录不能是符号链接或联接。')
    if (parent === dirname(parent)) break
    parent = dirname(parent)
  }
  async function checkTree(directory) {
    const info = await lstat(directory).catch(error => { if (error.code === 'ENOENT') return null; throw error })
    if (!info) return
    if (info.isSymbolicLink()) throw new AppError('应用目录不能包含符号链接或联接。')
    if (info.isDirectory()) for (const entry of await readdir(directory)) await checkTree(join(directory, entry))
  }
  await checkTree(path)
  await rm(path, { recursive: true, force: true, maxRetries: 6, retryDelay: 250 })
}

export async function downloadArtifact(artifact, signal, progress, fetchImpl = fetch) {
  const response = await fetchImpl(artifact.url, { signal: AbortSignal.any([signal, AbortSignal.timeout(600000)]) })
  if (!response.ok) throw new AppError(`下载 ${artifact.kind === 'desktop' ? 'DBX' : 'MCP'} 失败（HTTP ${response.status}），请重试。`)
  const total = Number(response.headers.get('content-length')) || 0
  if (total > MAX_ARCHIVE) throw new AppError('应用安装包超过大小限制。')
  const chunks = []; let received = 0
  for await (const chunk of response.body) {
    signal.throwIfAborted()
    received += chunk.length
    if (received > MAX_ARCHIVE) throw new AppError('应用安装包超过大小限制。')
    chunks.push(chunk); progress({ phase: `下载${artifact.kind === 'desktop' ? '应用' : 'MCP'}`, received, total })
  }
  const bytes = Buffer.concat(chunks)
  if (digest(bytes) !== artifact.sha256) throw new AppError('安装包校验失败，文件未安装，请重新下载。')
  return bytes
}

/** 只缓存已经通过固定摘要校验的官方包，重装时不重复下载。 */
export async function cachedArtifact(cache, artifact, signal, progress) {
  await mkdir(cache, { recursive: true })
  const path = join(cache, `${artifact.sha256}.zip`)
  const previous = await readFile(path).catch(error => { if (error.code === 'ENOENT') return null; throw error })
  if (previous && digest(previous) === artifact.sha256) { signal.throwIfAborted(); return previous }
  const bytes = await downloadArtifact(artifact, signal, progress)
  const temporary = join(cache, `${randomUUID()}.tmp`)
  try { await writeFile(temporary, bytes, { flag: 'wx' }); await rename(temporary, path) }
  finally { await rm(temporary, { force: true }) }
  return bytes
}

export async function extractArtifact(bytes, artifact, destination) {
  if (bytes.length > MAX_ARCHIVE || digest(bytes) !== artifact.sha256) throw new AppError('安装包校验失败。')
  const zip = new AdmZip(bytes), entries = zip.getEntries(), seen = new Set()
  let total = 0
  if (entries.length > 5000) throw new AppError('安装包文件数量超过限制。')
  for (const entry of entries) {
    const name = entry.entryName.replaceAll('\\', '/'), parts = name.replace(/\/$/, '').split('/')
    const mode = (entry.header.attr >>> 16) & 0xf000
    if (!name || parts.some(part => !part || part === '.' || part === '..' || /[<>:"|?*\x00-\x1f]/.test(part) || /[. ]$/.test(part)
      || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\.|$)/i.test(part)) || mode === 0xa000 || entry.header.flags & 1) throw new AppError('安装包含不安全的文件路径或类型。')
    const key = name.replace(/\/$/, '').toLowerCase()
    if (seen.has(key)) throw new AppError('安装包含重复文件。')
    seen.add(key); total += entry.header.size
    if (total > MAX_EXTRACTED) throw new AppError('安装包解压大小超过限制。')
  }
  const executables = entries.filter(entry => !entry.isDirectory && basename(entry.entryName).toLowerCase() === artifact.executable.toLowerCase())
  if (executables.length !== 1) throw new AppError(`安装包中未找到唯一的 ${artifact.executable}。`)
  await mkdir(destination, { recursive: true })
  for (const entry of entries) {
    const path = join(destination, ...entry.entryName.replaceAll('\\', '/').split('/'))
    if (entry.isDirectory) await mkdir(path, { recursive: true })
    else {
      const data = entry.getData()
      if (data.length !== entry.header.size) throw new AppError('安装包内容损坏。')
      await mkdir(dirname(path), { recursive: true }); await writeFile(path, data, { flag: 'wx' })
    }
  }
  const executable = executables[0].entryName.replaceAll('\\', '/')
  const binary = await readFile(join(destination, executable))
  if (binary[0] !== 0x4d || binary[1] !== 0x5a) throw new AppError('应用程序不是有效的 Windows 可执行文件。')
  return { path: `${artifact.kind}/${executable}`, sha256: digest(binary) }
}

export async function installRuntime(root, artifacts, signal, progress, download = downloadArtifact) {
  await mkdir(root, { recursive: true })
  const stage = join(root, `stage-${randomUUID()}`), runtime = join(root, 'runtime')
  await mkdir(stage)
  try {
    const files = {}
    for (const artifact of artifacts) {
      const bytes = await download(artifact, signal, progress)
      signal.throwIfAborted(); progress({ phase: '校验并解压', received: 0, total: 0 })
      files[artifact.kind] = await extractArtifact(bytes, artifact, join(stage, artifact.kind))
    }
    signal.throwIfAborted()
    await removeManaged(root, runtime)
    await rename(stage, runtime)
    return files
  } finally { await removeManaged(root, stage) }
}

export async function verifyExecutable(root, file) {
  const target = resolve(root, file.path), rel = relative(resolve(root), target)
  if (rel.startsWith('..') || isAbsolute(rel)) throw new AppError('应用程序路径无效。')
  const info = await lstat(target)
  let parent = target
  for (;;) {
    if ((await lstat(parent)).isSymbolicLink()) throw new AppError('应用程序路径不能包含符号链接或联接。')
    if (parent === dirname(parent)) break
    parent = dirname(parent)
  }
  if (!info.isFile() || digest(await readFile(target)) !== file.sha256) throw new AppError('应用程序已更改或丢失，请卸载后重新安装。')
  return target
}
