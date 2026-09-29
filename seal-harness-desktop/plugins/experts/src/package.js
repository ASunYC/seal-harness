import { createHash } from 'node:crypto'
import { lstat, open, readdir } from 'node:fs/promises'
import { constants } from 'node:fs'
import { join } from 'node:path'
import { crc32, inflateRawSync } from 'node:zlib'
import AdmZip from 'adm-zip'
import { parse } from 'yaml'
import { z } from 'zod'

// 兼容 Stratex c656400 的 stratex.expert/v1；只迁移磁盘/线协议，不包含其运行时。
export class ExpertError extends Error {
  constructor(message) { super(message); this.code = 'expertRejected' }
}

export const MAX_BYTES = 100 * 1024 * 1024
export const MANIFEST = 'stratex-expert.json'
export const nameSchema = z.string().regex(/^[a-z0-9][a-z0-9-]{0,62}$/)
export const versionSchema = z.string().max(128).regex(/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/)
const localPath = z.string().min(1).max(512).regex(/^[A-Za-z0-9._/-]+$/).refine(value => {
  try { safePath(value); return true } catch { return false }
})
const bilingual = z.strictObject({ zh: z.string().trim().min(1).max(200), en: z.string().trim().max(200).default('') })
const instructions = z.string().trim().min(1).refine(value => Buffer.byteLength(value) <= 512 * 1024)
export const manifestSchema = z.strictObject({
  schemaVersion: z.literal('stratex.expert/v1'), name: nameSchema, version: versionSchema,
  entryAgent: z.string().trim().min(1).max(200), agents: z.array(localPath).min(1).max(64),
  displayName: bilingual, profession: bilingual, description: bilingual,
  personaInstructions: instructions, model: z.string().trim().min(1).max(200),
  skills: z.array(localPath).max(64).optional(),
  capabilities: z.array(z.strictObject({ kind: z.enum(['skill', 'mcp']), sourceId: z.string().trim().min(1).max(256), version: z.string().trim().min(1).max(128).optional() })).max(64).optional(),
  avatar: localPath.optional(), categoryId: z.string().trim().max(100).optional(), tags: z.array(bilingual).max(64).optional(),
  quickPrompts: z.array(bilingual).max(16).optional(), initPrompt: bilingual.optional(),
  reasoningEffort: z.enum(['minimal', 'low', 'medium', 'high']).optional(),
  personality: z.enum(['none', 'friendly', 'pragmatic']).optional(),
  toolPolicy: z.strictObject({
    allowedTools: z.strictObject({ requestUserInput: z.boolean().optional() }).optional(),
    webSearch: z.enum(['disabled', 'cached', 'indexed', 'live']).optional(),
    mcpServers: z.record(z.string().min(1).max(120).refine(value => value !== 'stratex_mcp_chrome_devtools'), z.strictObject({
      command: z.string().trim().min(1).max(512), args: z.array(z.string().max(512)).max(64).optional(),
      env: z.record(z.string().max(120), z.string().max(4000)).optional(),
    })).optional(),
    includeSkillInstructions: z.boolean().optional(),
  }).optional(),
})
const frontmatterSchema = z.strictObject({ name: z.string().trim().min(1).max(200), description: z.string().trim().max(2000).optional(), displayName: z.string().trim().max(200).optional(), profession: z.string().trim().max(200).optional(), maxTurns: z.coerce.number().int().positive().max(1000).optional() })

/** @param {string} value @returns {string} */
export function safePath(value) {
  if (typeof value !== 'string' || value.length > 512 || !value || /[\\:\x00-\x1f\x7f]/.test(value)) throw new ExpertError('专家包包含不安全路径。')
  if (value.split('/').some(part => !part || part === '.' || part === '..' || /[ .]$/.test(part) || /^(con|prn|aux|nul|clock\$|conin\$|conout\$|com[1-9¹²³]|lpt[1-9¹²³])(?:\.|$)/i.test(part))) throw new ExpertError('专家包包含不安全路径。')
  return value
}

/** @param {Buffer | Uint8Array} bytes @returns {Map<string, Buffer>} */
export function decodeZip(bytes) {
  if (bytes.length > 128 * 1024 * 1024) throw new ExpertError('专家压缩包超过 128 MiB。')
  const entries = new AdmZip(Buffer.from(bytes)).getEntries()
  if (entries.length > 5000) throw new ExpertError('专家包条目超过 5000。')
  const files = new Map(), names = new Set()
  let expanded = 0
  for (const entry of entries) {
    const path = safePath(entry.isDirectory ? entry.entryName.replace(/\/$/, '') : entry.entryName)
    const type = (entry.header.attr >>> 16) & 0o170000
    if ((type && type !== 0o100000 && type !== 0o040000) || (entry.header.flags & 1)) throw new ExpertError('专家包不允许符号链接、特殊文件或加密条目。')
    if (names.has(path.toLowerCase())) throw new ExpertError('专家包包含重复路径。')
    names.add(path.toLowerCase())
    if (entry.isDirectory) continue
    expanded += entry.header.size
    if (expanded > MAX_BYTES || files.size >= 2000) throw new ExpertError('专家包超过 100 MiB 或 2000 文件上限。')
    const compressed = entry.getCompressedData()
    const content = entry.header.method === 0 ? compressed : entry.header.method === 8
      ? inflateRawSync(compressed, { maxOutputLength: Math.max(1, entry.header.size) }) : null
    if (!content || content.length !== entry.header.size || crc32(content) !== entry.header.crc) throw new ExpertError('专家包文件校验失败。')
    files.set(path, content)
  }
  const fileNames = new Set([...files.keys()].map(path => path.toLowerCase()))
  for (const path of files.keys()) {
    for (let parent = path.slice(0, path.lastIndexOf('/')); path.includes('/') && parent; parent = parent.slice(0, parent.lastIndexOf('/'))) {
      if (fileNames.has(parent.toLowerCase())) throw new ExpertError('专家包文件与目录冲突。')
      if (!parent.includes('/')) break
    }
  }
  return files
}

/** @param {string} path @returns {Promise<Map<string, Buffer>>} */
export async function readDirectory(path) {
  const files = new Map()
  let size = 0
  const walk = async (directory, prefix = '') => {
    if (!(await lstat(directory)).isDirectory()) throw new ExpertError('专家目录不能是符号链接。')
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const relative = safePath(prefix + entry.name)
      const full = join(directory, entry.name)
      const info = await lstat(full)
      if (info.isDirectory()) await walk(full, `${relative}/`)
      else {
        if (!info.isFile()) throw new ExpertError('专家包不能包含符号链接或特殊文件。')
        size += info.size
        if (size > MAX_BYTES || files.size >= 2000) throw new ExpertError('专家包超过 100 MiB 或 2000 文件上限。')
        const handle = await open(full, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0))
        let bytes
        try {
          if (!(await handle.stat()).isFile()) throw new ExpertError('专家包文件状态已变化。')
          bytes = await handle.readFile()
        } finally { await handle.close() }
        if (bytes.length !== info.size) throw new ExpertError('专家包读取期间发生变化，请重试。')
        files.set(relative, bytes)
      }
    }
  }
  await walk(path)
  return files
}

/** @param {Map<string, Buffer>} source @returns {{manifest: object, files: Map<string, Buffer>, digest: string, agents: object[]}} */
export function validatePackage(source) {
  let files = source
  if (!files.has(MANIFEST)) {
    const manifests = [...files.keys()].filter(path => path.split('/').length === 2 && path.endsWith(`/${MANIFEST}`))
    if (manifests.length !== 1) throw new ExpertError('专家包缺少唯一的 stratex-expert.json。')
    const prefix = manifests[0].slice(0, -MANIFEST.length)
    if ([...files.keys()].some(path => !path.startsWith(prefix))) throw new ExpertError('专家包根目录不唯一。')
    files = new Map([...files].map(([path, bytes]) => [path.slice(prefix.length), bytes]))
  }
  if (files.get(MANIFEST).length > 1024 * 1024) throw new ExpertError('专家清单超过 1 MiB。')
  const manifest = manifestSchema.parse(JSON.parse(files.get(MANIFEST).toString('utf8')))
  const names = new Set(), agentNames = new Set()
  let size = 0
  for (const [path, bytes] of files) {
    safePath(path)
    if (names.has(path.toLowerCase())) throw new ExpertError('专家包包含重复路径。')
    names.add(path.toLowerCase())
    size += bytes.length
  }
  if (size > MAX_BYTES || files.size > 2000) throw new ExpertError('专家包超过文件或体积上限。')
  const agents = manifest.agents.map(path => {
    const bytes = files.get(path)
    if (!bytes || bytes.length > 513 * 1024) throw new ExpertError(`专家 agent 缺失或过大：${path}`)
    const match = bytes.toString('utf8').match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)([\s\S]*)$/)
    if (!match) throw new ExpertError(`专家 agent 缺少 frontmatter：${path}`)
    const meta = frontmatterSchema.parse(parse(match[1], { maxAliasCount: 0 }))
    if (agentNames.has(meta.name)) throw new ExpertError('专家 agent 名称重复。')
    agentNames.add(meta.name)
    return { ...meta, path, body: match[2].trim() }
  })
  if (!agentNames.has(manifest.entryAgent)) throw new ExpertError('专家入口未命中 agent 的 frontmatter name。')
  for (const path of [...(manifest.skills ?? []), ...(manifest.avatar ? [manifest.avatar] : [])]) {
    if (!files.has(path) && ![...files.keys()].some(file => file.startsWith(`${path}/`))) throw new ExpertError(`专家引用的文件缺失：${path}`)
  }
  const hash = createHash('sha256')
  for (const [path, bytes] of [...files].sort(([a], [b]) => a < b ? -1 : 1)) hash.update(path).update('\0').update(bytes).update('\0')
  let portableDependencies = []
  if (files.has('config/agent-assets-bundle.json')) {
    const bundle = JSON.parse(files.get('config/agent-assets-bundle.json').toString('utf8'))
    const dependencies = bundle.clientRelease?.portableDependencies ?? []
    if (!Array.isArray(dependencies)) throw new ExpertError('专家能力闭包格式无效。')
    portableDependencies = z.array(z.object({ kind: z.enum(['skill', 'mcp']), sourceId: z.string().min(1), version: z.string().min(1), packageRoot: localPath })).max(2048).parse(dependencies)
    for (const dependency of portableDependencies) {
      if (!dependency.packageRoot.startsWith(`materials/${dependency.kind === 'skill' ? 'skills' : 'mcps'}/`) || ![...files.keys()].some(path => path.startsWith(`${dependency.packageRoot}/`))) throw new ExpertError('专家依赖包目录缺失或无效。')
    }
  }
  return { manifest, files, digest: hash.digest('hex'), agents, portableDependencies, portableDependencyCount: portableDependencies.length }
}

/** @param {object} manifest @returns {Map<string, Buffer>} */
export function draftFiles(manifest) {
  const parsed = manifestSchema.parse(manifest)
  if (parsed.agents.length !== 1) throw new ExpertError('新建专家必须只有一个入口 agent。')
  return new Map([[MANIFEST, Buffer.from(JSON.stringify(parsed, null, 2) + '\n')], [parsed.agents[0], Buffer.from(`---\nname: ${JSON.stringify(parsed.entryAgent)}\n---\n\n${parsed.personaInstructions}\n`)]])
}

/** @param {Map<string, Buffer>} files @returns {Buffer} */
export function encodeZip(files) {
  const zip = new AdmZip()
  for (const [path, bytes] of [...files].sort(([a], [b]) => a < b ? -1 : 1)) {
    zip.addFile(safePath(path), bytes, '', 0o644)
    zip.getEntry(path).header.time = new Date(1980, 0, 1)
  }
  return zip.toBuffer()
}

/** 移除本机连接器凭据和资产坐标；不会自动发布或改变可见性。 */
export function portablePackage(pkg) {
  const { capabilities, toolPolicy, ...rest } = pkg.manifest
  const { mcpServers, ...portablePolicy } = toolPolicy ?? {}
  const manifest = manifestSchema.parse({ ...rest, ...(Object.keys(portablePolicy).length ? { toolPolicy: portablePolicy } : {}) })
  const files = new Map([...pkg.files].filter(([path]) => path !== 'config/agent-assets-bundle.json' && !path.startsWith('materials/mcps/')))
  files.set(MANIFEST, Buffer.from(JSON.stringify(manifest, null, 2) + '\n'))
  const stripped = { capabilities: capabilities ?? [], mcpServers: Object.keys(mcpServers ?? {}) }
  files.set('README.md', Buffer.from(`# ${manifest.displayName.zh}\n\n本包导出时已移除本机能力引用和 MCP 启动配置。接收者需要重新配置并授权。\n\n${JSON.stringify(stripped, null, 2)}\n`))
  return { ...validatePackage(files), stripped }
}
