import { constants } from 'node:fs'
import { lstat, open, readdir, realpath } from 'node:fs/promises'
import { basename, isAbsolute, join, relative, sep } from 'node:path'
import { createHash } from 'node:crypto'
import AdmZip from 'adm-zip'
import { parse } from 'yaml'
import { isSkillName } from '@deepseek-ai/dsh-skill'

export class SkillError extends Error {
  code = 'skillRejected'
}

export const MAX_PACKAGE_BYTES = 64 * 1024 * 1024
const MAX_FILE_BYTES = 16 * 1024 * 1024
const MAX_FILES = 2000
const IGNORED = new Set(['.git', 'node_modules', '.DS_Store', 'Thumbs.db', '__pycache__'])

export function safeRelative(value) {
  if (typeof value !== 'string' || !value || value.length > 1024 || /[\\:\x00-\x1f]/.test(value)) {
    throw new SkillError('技能包包含不安全的文件路径')
  }
  if (value.split('/').some(part => !part || part === '.' || part === '..' || /[. ]$/.test(part)
    || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part))) {
    throw new SkillError('技能包包含不安全的文件路径')
  }
  return value
}

export function inside(root, path) {
  const rel = relative(root, path)
  return rel === '' || (!isAbsolute(rel) && rel !== '..' && !rel.startsWith(`..${sep}`))
}

export async function readBoundedFile(path, maxBytes, signal, boundary) {
  const handle = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0))
  try {
    const stat = await handle.stat()
    if (!stat.isFile() || stat.size > maxBytes) throw new SkillError('技能文件超过大小限制或不是普通文件')
    if (boundary && !inside(boundary, await realpath(path))) throw new SkillError('技能文件越过了所选边界')
    const bytes = Buffer.alloc(stat.size + 1)
    let offset = 0
    while (offset < bytes.length) {
      signal?.throwIfAborted()
      const { bytesRead } = await handle.read(bytes, offset, bytes.length - offset, offset)
      if (!bytesRead) break
      offset += bytesRead
    }
    if (offset !== stat.size || (await handle.stat()).mtimeMs !== stat.mtimeMs) throw new SkillError('技能文件读取期间发生变化，请重试')
    return { bytes: bytes.subarray(0, offset), mode: stat.mode & 0o777 }
  } finally { await handle.close() }
}

/** 读取明确选择的目录，不追随包内链接，也不执行内容。 */
export async function readDirectory(path, signal) {
  if (!isAbsolute(path)) throw new SkillError('请输入技能目录的绝对路径')
  const root = await realpath(path)
  if ((await lstat(path)).isSymbolicLink()) throw new SkillError('请选择真实目录，不能导入符号链接')
  const files = []
  let total = 0
  async function walk(directory, depth) {
    signal?.throwIfAborted()
    if (depth > 16) throw new SkillError('技能目录嵌套超过 16 层')
    if (!inside(root, await realpath(directory))) throw new SkillError('技能目录越过了所选边界')
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      if (IGNORED.has(entry.name) || entry.name.endsWith('.pyc')) continue
      const full = join(directory, entry.name)
      if (entry.isSymbolicLink()) throw new SkillError(`技能包不能包含符号链接：${entry.name}`)
      if (entry.isDirectory()) { await walk(full, depth + 1); continue }
      if (!entry.isFile()) throw new SkillError(`技能包不能包含特殊文件：${entry.name}`)
      const name = safeRelative(relative(root, full).split(sep).join('/'))
      const file = await readBoundedFile(full, Math.min(MAX_FILE_BYTES, MAX_PACKAGE_BYTES - total), signal, root)
      total += file.bytes.length
      if (files.length >= MAX_FILES) throw new SkillError('技能包最多包含 2000 个文件')
      files.push({ path: name, ...file })
    }
  }
  await walk(root, 0)
  return files
}

export function readArchive(bytes, { maxPackageBytes = MAX_PACKAGE_BYTES, maxFileBytes = MAX_FILE_BYTES, maxExpandedBytes = maxPackageBytes, maxFiles = MAX_FILES } = {}) {
  if (!Buffer.isBuffer(bytes)) bytes = Buffer.from(bytes)
  if (!bytes.length || bytes.length > maxPackageBytes) throw new SkillError(`ZIP 必须小于 ${Math.floor(maxPackageBytes / 1024 / 1024)} MiB`)
  const archive = new AdmZip(bytes)
  const entries = archive.getEntries()
  if (entries.length > maxFiles) throw new SkillError(`ZIP 最多包含 ${maxFiles} 个条目`)
  const seen = new Set()
  const files = []
  let total = 0
  for (const entry of entries) {
    const path = safeRelative(entry.rawEntryName.toString('utf8').replace(/\/$/, ''))
    const folded = path.toLowerCase()
    if (seen.has(folded)) throw new SkillError('ZIP 包含重复或大小写冲突的路径')
    seen.add(folded)
    const mode = entry.header.attr >>> 16
    const kind = mode & 0o170000
    if (kind && kind !== 0o100000 && kind !== 0o040000) throw new SkillError('ZIP 不能包含符号链接或特殊文件')
    if (entry.isDirectory) continue
    total += entry.header.size
    if (entry.header.size > maxFileBytes || total > maxExpandedBytes) throw new SkillError('ZIP 解压后超过大小限制')
    const data = entry.getData()
    if (data.length !== entry.header.size) throw new SkillError('ZIP 文件大小校验失败')
    files.push({ path, bytes: data, mode: mode & 0o777 || 0o644 })
  }
  return files
}

export function parseSkill(bytes) {
  const raw = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)([\s\S]*)$/)
  if (!match) throw new SkillError('SKILL.md 需要 YAML name 和 description 头信息')
  const data = parse(match[1], { maxAliasCount: 20 })
  if (!data || typeof data !== 'object' || typeof data.name !== 'string' || data.name.length > 128 || !isSkillName(data.name)) {
    throw new SkillError('技能名称必须使用小写字母、数字和连字符，例如 data-analysis')
  }
  if (typeof data.description !== 'string' || !data.description.trim() || data.description.length > 8000) throw new SkillError('技能需要不超过 8000 字符的 description')
  for (const legacy of ['disableModelInvocation', 'modelInvocable', 'userInvocable']) {
    if (Object.hasOwn(data, legacy)) throw new SkillError(`不支持 ${legacy}，请使用 disable-model-invocation / user-invocable`)
  }
  const booleanField = (key, fallback) => {
    if (!Object.hasOwn(data, key)) return fallback
    const value = String(data[key]).toLowerCase()
    if (['true', 'yes', 'on', '1'].includes(value)) return true
    if (['false', 'no', 'off', '0'].includes(value)) return false
    throw new SkillError(`${key} 必须为布尔值`)
  }
  return {
    name: data.name, description: data.description.trim(), content: match[2].trim(),
    invocation: { modelInvocable: !booleanField('disable-model-invocation', false), userInvocable: booleanField('user-invocable', true) },
  }
}

/** ZIP 集合中的每个 SKILL.md 是一个独立导入候选；嵌套技能不隐式夹带。 */
export function inspectFiles(files) {
  const paths = files.map(file => safeRelative(file.path).toLowerCase())
  if (new Set(paths).size !== paths.length) throw new SkillError('技能包包含大小写冲突的路径')
  const roots = files.filter(file => basename(file.path) === 'SKILL.md').map(file => file.path.slice(0, -8))
  if (!roots.length) throw new SkillError('目录或 ZIP 中没有 SKILL.md')
  return roots.map(prefix => {
    const children = roots.filter(other => other !== prefix && other.startsWith(prefix))
    const members = files.filter(file => file.path.startsWith(prefix) && !children.some(child => file.path.startsWith(child)))
      .map(file => ({ ...file, path: file.path.slice(prefix.length) })).sort((a, b) => a.path.localeCompare(b.path, 'en'))
    const key = prefix || '.'
    try {
      const metadata = parseSkill(members.find(file => file.path === 'SKILL.md').bytes)
      const hash = createHash('sha256')
      for (const file of members) hash.update(`${file.path}\0${file.bytes.length}\0`).update(file.bytes)
      return { key, ...metadata, files: members, contentHash: hash.digest('hex'), fileCount: members.length, byteSize: members.reduce((sum, file) => sum + file.bytes.length, 0) }
    } catch (error) { return { key, name: prefix.replace(/\/$/, '') || 'SKILL.md', error: error.message } }
  })
}

export async function inspectPath(path, signal) {
  if (typeof path !== 'string' || !isAbsolute(path)) throw new SkillError('请输入目录或 ZIP 的绝对路径')
  const stat = await lstat(path)
  if (stat.isDirectory()) return inspectFiles(await readDirectory(path, signal))
  if (!stat.isFile() || !path.toLowerCase().endsWith('.zip') || stat.size > MAX_PACKAGE_BYTES) throw new SkillError('请选择技能目录或不超过 64 MiB 的 ZIP')
  return inspectFiles(readArchive((await readBoundedFile(path, MAX_PACKAGE_BYTES, signal)).bytes))
}

export function createArchive(files) {
  const archive = new AdmZip()
  for (const file of files) archive.addFile(file.path, file.bytes, '', file.mode)
  return archive.toBuffer()
}
