import { adapterHandlers } from './adapter.js'
import { readVersion } from './version.js'
import { readArchive, safeRelative } from '../../skills/src/package.js'
import { createHash } from 'node:crypto'
import { z } from 'zod'
import { BackendError } from '../../capability-shared/src/backend.js'

const collection = z.enum(['skills', 'mcps', 'experts'])
const segment = z.string().trim().min(1).max(256).refine(value => !['.', '..'].includes(value))
const identity = z.object({ collection, id: segment }).strict()
const versionIdentity = identity.extend({ version: segment })
const etag = z.string().min(1).max(512)
const validationIssue = z.object({ code: z.string().max(160), message: z.string().max(1000), path: z.string().max(1000).optional() })
const validationResult = z.object({ valid: z.boolean(), errors: z.array(validationIssue), warnings: z.array(validationIssue) })
const assetFields = z.object({
  name: z.string().trim().min(1).max(160), slug: z.string().trim().min(1).max(160),
  summary: z.string().max(2000), kind: z.string().min(1).max(64), category: z.enum(['office', 'development']),
  metadata: z.object({ sourceType: z.enum(['external_mcp', 'http_adapter']) }).optional(),
  publisherTeam: z.string().max(160).default(''), tags: z.array(z.string().max(64)).max(30).default([]),
}).strict()
const editableDescriptor = z.object({
  description: z.string().trim().min(1).max(10_000),
  releaseNotes: z.string().max(10_000).default(''),
  entrypoint: z.string().max(1000).optional(),
  transport: z.enum(['http', 'stdio', 'sse']).optional(),
  endpointTemplate: z.string().max(2000).optional(),
  authMode: z.enum(['none', 'api_key', 'oauth_authorization_code_pkce', 'token_exchange']).optional(),
})
const dependencies = z.array(z.object({ assetId: z.string().uuid(), versionRange: z.string().min(1).max(128), optional: z.boolean().default(false) })).max(100)
const editableVersion = versionIdentity.extend({ descriptor: editableDescriptor, dependencies: dependencies.default([]) })
const artifactInput = versionIdentity.extend({ contentBase64: z.string().min(1).max(90_000_000) })
const artifactInspection = z.object({ artifactSha256: z.string().regex(/^[a-f0-9]{64}$/), warnings: z.array(z.object({ code: z.string(), message: z.string(), path: z.string().optional() })) })
function artifactBytes(input) {
  const bytes = Buffer.from(input.contentBase64, 'base64')
  if (!bytes.length || bytes.length > 64 * 1024 * 1024) throw new BackendError('invalidRequest')
  return bytes
}
function editableCollection(request) {
  if (request.collection === 'experts') throw new BackendError('invalidRequest')
}
const versionSchema = z.object({
  version: z.string().min(1).max(64), status: z.enum(['draft', 'private', 'published', 'yanked']),
  etag, packageReady: z.boolean().optional(), createdAt: z.string().optional(),
  artifact: z.object({ sizeBytes: z.number().nonnegative(), sha256: z.string() }).optional(),
})
const assetSchema = z.object({
  id: segment, name: z.string().min(1).max(160), summary: z.string().max(2000).default(''),
  slug: z.string().optional(), kind: z.string().optional(), category: z.string().optional(),
  publisherTeam: z.string().optional(), tags: z.array(z.string()).default([]),
  visibility: z.enum(['private', 'company', 'public']).optional(), revision: z.number().int().nonnegative().optional(),
  sourceType: z.enum(['external_mcp', 'http_adapter']).optional(), metadata: z.object({ sourceType: z.enum(['external_mcp', 'http_adapter']).optional() }).optional(),
  updatedAt: z.string().optional(), latestVersion: versionSchema.optional(), draftVersion: versionSchema.optional(),
  versions: z.array(versionSchema).optional(),
})
const centerSchema = z.object({
  data: z.array(z.object({ connectorId: segment, name: z.string(), summary: z.string(), category: z.enum(['office', 'development']), tags: z.array(z.string()), version: z.string(), clientAuthMode: z.enum(['none', 'oauth']), authExperience: z.enum(['none', 'personal_token', 'provider_oauth', 'shared']).optional(), toolCount: z.number().int().nonnegative().optional(), iconRevision: z.string().min(1).max(512).optional() })).max(1000),
  meta: z.object({ schemaVersion: z.literal('mcp-center.catalog/v1'), asOf: z.string(), revision: z.string() }),
})

const assetPath = ({ collection, id }) => `${collection}/${encodeURIComponent(id)}`
const versionPath = input => `${assetPath(input)}/versions/${encodeURIComponent(input.version)}`

function present(value, collection) {
  const parsed = assetSchema.safeParse(value)
  if (!parsed.success) throw new BackendError('invalidResponse')
  // 不把后端 descriptor 内的环境变量、静态请求头或磁盘坐标发给浏览器。
  return { ...parsed.data, collection }
}

export function createStore(backend, { centerCache } = {}) {
  return {
    ...adapterHandlers(backend),
    status: () => backend.status(),
    async list(input, signal) {
      const request = z.object({ collection, scope: z.enum(['published', 'mine']).default('published') }).strict().parse(input)
      return (await backend.list(request.collection, request.scope, signal)).map(item => present(item, request.collection))
    },
    async detail(input, signal) {
      const request = identity.parse(input)
      const result = await backend.request(assetPath(request), { signal })
      return { ...present(result.data, request.collection), etag: result.headers.get('etag') }
    },
    async center(_input, signal) {
      try {
        const parsed = centerSchema.safeParse(await backend.listCenter(signal))
        if (!parsed.success) throw new BackendError('invalidResponse')
        await centerCache?.writeCatalog(parsed.data).catch(() => {})
        return parsed.data.data
      } catch (failure) {
        if (!centerCache) throw failure
        try {
          const cached = centerSchema.safeParse(await centerCache.readCatalog())
          if (cached.success) return cached.data.data
        } catch { /* 无有效快照时继续报告真实网络错误。 */ }
        throw failure
      }
    },
    async centerIcon(input, signal) {
      const request = z.object({ connectorId: segment, iconRevision: z.string().min(1).max(512).optional() }).strict().parse(input)
      try {
        const icon = await backend.readCenterIcon(request.connectorId, signal)
        await centerCache?.writeIcon(request.connectorId, request.iconRevision, icon).catch(() => {})
        return icon
      } catch (failure) {
        if (!centerCache) throw failure
        try { return await centerCache.readIcon(request.connectorId, request.iconRevision) }
        catch { throw failure }
      }
    },
    async createAsset(input, signal) {
      const request = z.object({ collection, fields: assetFields }).strict().parse(input)
      return present((await backend.request(request.collection, { method: 'POST', body: request.fields, signal })).data, request.collection)
    },
    async updateAsset(input, signal) {
      const request = identity.extend({ fields: assetFields, etag }).parse(input)
      if (request.collection === 'experts') throw new BackendError('invalidRequest')
      await backend.request(assetPath(request), { method: 'PATCH', body: request.fields, headers: { 'if-match': request.etag }, signal })
      return { saved: true }
    },
    async version(input, signal) {
      const request = versionIdentity.parse(input)
      editableCollection(request)
      const { current } = await readVersion(backend, request, signal)
      return { ...versionSchema.parse(current), descriptor: editableDescriptor.parse(current.descriptor), dependencies: dependencies.parse(current.dependencies ?? []) }
    },
    async createVersion(input, signal) {
      const request = editableVersion.parse(input)
      editableCollection(request)
      await backend.request(`${assetPath(request)}/versions`, { method: 'POST', body: { version: request.version, descriptor: { schemaVersion: 'stratex.capability/v1', ...request.descriptor }, dependencies: request.dependencies }, signal })
      return { saved: true }
    },
    async updateVersion(input, signal) {
      const request = editableVersion.extend({ etag }).parse(input)
      editableCollection(request)
      const { current } = await readVersion(backend, request, signal)
      if (current.etag !== request.etag) throw new BackendError('conflict')
      await backend.request(versionPath(request), { method: 'PATCH', body: { descriptor: { ...current.descriptor, ...request.descriptor }, dependencies: request.dependencies }, headers: { 'if-match': request.etag }, signal })
      return { saved: true }
    },
    async inspectArtifact(input, signal) {
      const request = artifactInput.parse(input)
      editableCollection(request)
      const bytes = artifactBytes(request)
      const result = artifactInspection.parse((await backend.upload(`${versionPath(request)}/artifact/inspect`, bytes, { signal })).data)
      if (result.artifactSha256 !== createHash('sha256').update(bytes).digest('hex')) throw new BackendError('invalidResponse')
      return result
    },
    async uploadArtifact(input, signal) {
      const request = artifactInput.extend({ expectedSha256: z.string().regex(/^[a-f0-9]{64}$/) }).parse(input)
      editableCollection(request)
      const bytes = artifactBytes(request)
      if (request.expectedSha256 !== createHash('sha256').update(bytes).digest('hex')) throw new BackendError('conflict')
      await backend.upload(`${versionPath(request)}/artifact`, bytes, { signal })
      return { saved: true }
    },
    async artifactFiles(input, signal) {
      const request = versionIdentity.extend({ collection: z.literal('skills'), path: z.string().optional() }).strict().parse(input)
      if (request.path) safeRelative(request.path)
      const { current } = await readVersion(backend, request, signal)
      if (!current.artifact) return { files: [], path: null, content: null }
      const { bytes } = await backend.download(`${versionPath(request)}/export`, { signal, maxBytes: 64 * 1024 * 1024 })
      if (bytes.length !== current.artifact.sizeBytes || createHash('sha256').update(bytes).digest('hex') !== current.artifact.sha256) throw new BackendError('invalidResponse')
      // 导出包的封装配置可能含服务连接信息，只预览技能文件，不传 descriptor 或凭据文件。
      const files = readArchive(bytes).filter(file => !/(?:^|\/)(?:manifest\.json|descriptor\.json|\.env(?:\..*)?|credentials?(?:\..*)?|id_rsa|id_ed25519)$/i.test(file.path))
      const path = request.path ?? files.find(file => /(?:^|\/)SKILL\.md$/.test(file.path))?.path ?? files[0]?.path
      const file = files.find(file => file.path === path)
      if (request.path && !file) throw new BackendError('invalidRequest')
      let content = null, message = ''
      if (file?.bytes.length > 2 * 1024 * 1024) message = '文件超过 2 MiB，请导出技能包后查看。'
      else if (file) {
        try { content = new TextDecoder('utf-8', { fatal: true }).decode(file.bytes); if (content.includes('\0')) throw new Error('binary') }
        catch { content = null; message = '此文件不是 UTF-8 文本，请导出技能包后查看。' }
      }
      return { files: files.map(file => ({ path: file.path, size: file.bytes.length })), path: path ?? null, content, message }
    },
    async exportVersion(input, signal) {
      const request = versionIdentity.parse(input)
      editableCollection(request)
      const { bytes } = await backend.download(`${versionPath(request)}/export`, { signal, maxBytes: 64 * 1024 * 1024 })
      return { fileName: `${request.collection}-${request.version.replace(/[^a-zA-Z0-9.-]/g, '_')}.zip`, contentBase64: bytes.toString('base64') }
    },
    async transition(input, signal) {
      const request = versionIdentity.extend({ action: z.enum(['validate', 'release', 'publish', 'yank']), etag }).parse(input)
      if (request.collection === 'experts' && ['validate', 'release'].includes(request.action)) throw new BackendError('invalidRequest')
      const result = await backend.request(`${versionPath(request)}/${request.action}`, { method: 'POST', body: {}, headers: { 'if-match': request.etag, ...(request.collection === 'experts' && request.action === 'publish' ? { 'x-expert-expected-status': 'draft' } : {}) }, signal })
      return { saved: true, validation: request.action === 'validate' ? validationResult.parse(result.data) : undefined }
    },
    async deleteAsset(input, signal) {
      const request = identity.extend({ etag }).parse(input)
      if (request.collection === 'experts') throw new BackendError('invalidRequest')
      await backend.request(assetPath(request), { method: 'DELETE', headers: { 'if-match': request.etag }, signal })
      return { removed: true }
    },
    async deleteVersion(input, signal) {
      const request = versionIdentity.extend({ etag }).parse(input)
      if (request.collection === 'experts') throw new BackendError('invalidRequest')
      await backend.request(versionPath(request), { method: 'DELETE', headers: { 'if-match': request.etag }, signal })
      return { removed: true }
    },
  }
}
