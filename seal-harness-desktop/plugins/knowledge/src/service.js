import { createHash, randomUUID } from 'node:crypto'
import { credentialKey } from '@deepseek-ai/dsh-credentials'
import { z } from 'zod'
import { schemas, groupSchema, fileSchema, listSchema } from './contracts.js'

const accessSchema = z.object({ clientCredential: z.string().startsWith('kbc_'), client: z.object({ id: z.string(), knowledgeBaseId: z.string() }).passthrough() })
const encode = encodeURIComponent
export class KnowledgeService {
  constructor({ config, identity, credentials, fetchImpl = fetch }) {
    this.config = config; this.identity = identity; this.credentials = credentials; this.fetch = fetchImpl
    this.lifetime = new AbortController()
    this.account = new AbortController()
    this.pendingCredential = null
    this.removeIdentity = identity.subscribe(() => { this.account.abort(); this.account = new AbortController() })
  }
  dispose() { this.lifetime.abort(); this.account.abort(); this.removeIdentity() }
  configure(config) { this.account.abort(); this.account = new AbortController(); this.config = config; this.pendingCredential = null }
  get prefix() { return this.config.knowledgeTargetType === 'platform' ? 'api/v1/' : 'v1/' }
  async credential(signal) {
    if (this.config.knowledgeTargetType === 'platform') return { authorization: `Bearer ${await this.identity.getAccessToken()}` }
    if (!this.pendingCredential) {
      const baseUrl = this.config.knowledgeBaseUrl
      const key = credentialKey('seal-harness-knowledge', `client-${createHash('sha256').update(baseUrl).digest('hex')}`)
      const flight = this.credentials.modifyRecord(key, async record => {
        if (record) { accessSchema.parse(record.payload); return undefined }
        const response = await this.fetch(new URL('v1/clients', baseUrl), {
          method: 'POST', headers: { 'content-type': 'application/json', 'idempotency-key': randomUUID() }, body: JSON.stringify({ name: 'Seal Harness桌面' }),
          signal: AbortSignal.any([this.lifetime.signal, AbortSignal.timeout(20000)]),
        })
        if (!response.ok) throw new Error(`知识库客户端注册失败（HTTP ${response.status}），请检查服务配置。`)
        return { kind: 'grant', payload: accessSchema.parse(await response.json()) }
      }).then(record => accessSchema.parse(record.payload)).catch(error => { if (this.pendingCredential === flight) this.pendingCredential = null; throw error })
      this.pendingCredential = flight
    }
    const access = await this.pendingCredential
    signal.throwIfAborted()
    return { 'x-knowledge-client-credential': access.clientCredential }
  }
  async request(path, method = 'GET', body, signal, { binary = false, chunk = false, offset } = {}) {
    if (!this.config.knowledgeBaseUrl) throw new Error('知识库服务尚未配置，请设置 services.yml 的 knowledgeBaseUrl。')
    const combined = AbortSignal.any([this.lifetime.signal, this.account.signal, ...(signal ? [signal] : []), AbortSignal.timeout(method === 'GET' ? 20000 : 300000)])
    combined.throwIfAborted()
    const baseUrl = this.config.knowledgeBaseUrl, targetType = this.config.knowledgeTargetType
    const headers = new Headers(await this.credential(combined))
    combined.throwIfAborted()
    if (body !== undefined) headers.set('content-type', chunk ? 'application/offset+octet-stream' : 'application/json')
    if (chunk) headers.set('upload-offset', String(offset))
    if (method === 'POST') headers.set('idempotency-key', randomUUID())
    const init = { method, headers, body: body === undefined ? undefined : chunk ? body : JSON.stringify(body), signal: combined }
    let response = await this.fetch(new URL(path, baseUrl), init)
    if (response.status === 401 && targetType === 'platform') {
      await response.body?.cancel()
      await this.identity.refreshSession()
      combined.throwIfAborted()
      headers.set('authorization', `Bearer ${await this.identity.getAccessToken()}`)
      response = await this.fetch(new URL(path, baseUrl), init)
    }
    if (chunk) {
      const header = response.headers.get('upload-offset'), next = header === null ? NaN : Number(header)
      await response.body?.cancel()
      if ((response.ok || response.status === 409) && Number.isSafeInteger(next) && next > offset && next <= offset + body.length) return { receivedBytes: next }
      throw new Error(`文件分块上传失败（HTTP ${response.status}），请重新上传。`)
    }
    if (!response.ok) {
      await response.body?.cancel()
      throw new Error(`知识库请求失败（HTTP ${response.status}）。${response.status === 401 ? '请检查知识库凭据或重新登录。' : response.status === 404 ? '请刷新列表并确认服务版本。' : '请稍后重试。'}`)
    }
    if (response.status === 204) return null
    if (binary) return response
    const data = await response.json()
    combined.throwIfAborted()
    return data
  }
  async invoke(action, payload = {}, signal) {
    signal = AbortSignal.any([this.account.signal, ...(signal ? [signal] : [])])
    signal.throwIfAborted()
    const input = schemas[action].parse(payload)
    const request = (path, method, body, options) => this.request(this.prefix + path, method, body, signal, options)
    const groupPath = input.groupId ? `knowledge-groups/${encode(input.groupId)}` : 'knowledge-groups'
    const filePath = `${groupPath}/files/${encode(input.fileId ?? '')}`
    switch (action) {
      case 'status': return { targetType: this.config.knowledgeTargetType, baseUrl: this.config.knowledgeBaseUrl }
      case 'list': {
        const items = []
        let offset = 0
        for (;;) {
          const page = listSchema.parse(await request(`knowledge-groups?${new URLSearchParams({ scope: input.scope, limit: '100', offset: String(offset) })}`))
          if (page.offset !== offset) throw new Error('知识库分页偏移无效，请重试。')
          items.push(...page.items)
          offset = page.offset + page.items.length
          if (offset >= page.total) break
          if (!page.items.length || offset <= page.offset) throw new Error('知识库分页响应无效，请重试。')
        }
        const installations = z.object({ items: z.array(z.object({ groupId: z.string(), status: z.string() }).passthrough()) }).parse(await request('knowledge-installations'))
        return { items, installations: installations.items }
      }
      case 'detail': {
        const [group, files] = await Promise.all([request(groupPath), request(`${groupPath}/files`)])
        return { group: groupSchema.parse(group), files: z.object({ items: z.array(fileSchema) }).parse(files).items }
      }
      case 'save': { const { groupId, ...body } = input; return groupSchema.parse(await request(groupPath, groupId ? 'PATCH' : 'POST', body)) }
      case 'archive': return request(groupPath, 'DELETE')
      case 'install': case 'uninstall': return request(`${groupPath}/installation`, action === 'install' ? 'POST' : 'DELETE')
      case 'shareUsers': return z.object({ users: z.array(z.object({ id: z.string(), username: z.string(), displayName: z.string() })).max(20) }).parse(await request(`wiki/library/share-users?${new URLSearchParams({ query: input.query })}`))
      case 'grants': return request(`${groupPath}/grants`)
      case 'grant': return request(`${groupPath}/grants`, 'PUT', { principal: input.principal, role: input.role })
      case 'revokeGrant': return request(`${groupPath}/grants?${new URLSearchParams(input.principal)}`, 'DELETE')
      case 'preview': return z.object({ fileName: z.string(), content: z.string() }).passthrough().parse(await request(`${filePath}/preview`))
      case 'retry': return request(`${filePath}/retry`, 'POST', {})
      case 'deleteFile': return request(filePath, 'DELETE')
      case 'download': return request(`${filePath}/download`, 'GET', undefined, { binary: true })
      case 'uploadStart': {
        const { groupId, ...body } = input
        return z.object({ id: z.string(), receivedBytes: z.number().int().nonnegative() }).parse(await request(`${groupPath}/files/upload-sessions`, 'POST', body))
      }
      case 'uploadChunk': return request(`knowledge-upload-sessions/${encode(input.uploadId)}`, 'PATCH', Buffer.from(input.base64, 'base64'), { chunk: true, offset: input.offset })
      case 'uploadComplete': return request(`knowledge-upload-sessions/${encode(input.uploadId)}/complete`, 'POST', {})
      case 'uploadCancel': return request(`knowledge-upload-sessions/${encode(input.uploadId)}`, 'DELETE')
      case 'search': return z.object({ citations: z.array(z.object({ groupId: z.string(), fileId: z.string(), fileName: z.string(), chunkId: z.string(), excerpt: z.string(), score: z.number() }).passthrough()) }).parse(await request('knowledge-retrieval/query', 'POST', input))
      case 'read': return request('knowledge-retrieval/read', 'POST', input)
      case 'navigate': return this.navigate(input, signal)
      case 'share': case 'shares': case 'redeem': case 'revokeShare': {
        if (this.config.knowledgeTargetType !== 'standalone') throw new Error('授权码分享用于独立知识服务；平台知识库请使用资料集授权。')
        return this.request(`v1/shares${action === 'share' ? '/codes' : action === 'redeem' ? '/redeem' : action === 'revokeShare' ? `/${encode(input.shareId)}` : ''}`, action === 'shares' ? 'GET' : action === 'revokeShare' ? 'DELETE' : 'POST', ['share', 'redeem'].includes(action) ? input : undefined, signal)
      }
    }
  }
  async workflowResources(signal) {
    signal = AbortSignal.any([this.account.signal, ...(signal ? [signal] : [])])
    signal.throwIfAborted()
    const { items } = await this.invoke('list', { scope: 'installed' }, signal)
    const resources = []
    for (const group of items) {
      const detail = await this.invoke('detail', { groupId: group.id }, signal)
      for (const file of detail.files) resources.push({ kind: 'wiki', sourceId: file.id, collectionId: group.id, version: String(detail.group.revision), name: file.fileName, ...(file.status !== 'ready' ? { unavailableReason: '资料尚未完成索引' } : {}) })
    }
    signal.throwIfAborted()
    return { resources, warnings: [] }
  }
  async workflowExport(selection, signal) {
    signal = AbortSignal.any([this.account.signal, ...(signal ? [signal] : [])])
    signal.throwIfAborted()
    const request = z.object({ kind: z.literal('wiki'), sourceId: z.string().min(1), collectionId: z.string().min(1), version: z.string().min(1) }).passthrough().parse(selection)
    const detail = await this.invoke('detail', { groupId: request.collectionId }, signal)
    if (String(detail.group.revision) !== request.version) throw new Error('资料集版本已变化，请刷新资源后重新选择。')
    const file = detail.files.find(row => row.id === request.sourceId)
    if (!file || file.status !== 'ready') throw new Error('所选资料尚未完成索引或已被移除。')
    const preview = await this.invoke('preview', { groupId: request.collectionId, fileId: request.sourceId }, signal)
    if (!preview.content.trim()) throw new Error('资料正文不可读取，请检查解析状态。')
    const content = JSON.stringify({ pages: [{ title: preview.fileName, content: preview.content }] })
    if (Buffer.byteLength(content) > 450_000) throw new Error('知识正文超过 450 KB，无法作为实例资源导出。')
    const current = await this.invoke('detail', { groupId: request.collectionId }, signal)
    if (String(current.group.revision) !== request.version) throw new Error('资料集在导出期间发生变化，请刷新后重试。')
    signal.throwIfAborted()
    const digest = createHash('sha256').update(content).digest('hex')
    const stable = createHash('sha256').update(`${this.config.knowledgeBaseUrl}:${request.collectionId}:${request.sourceId}`).digest('hex')
    const assetId = `${stable.slice(0, 8)}-${stable.slice(8, 12)}-5${stable.slice(13, 16)}-a${stable.slice(17, 20)}-${stable.slice(20, 32)}`
    return { capabilities: [{ assetId, assetType: 'wiki', name: preview.fileName, version: digest, descriptor: { wiki: { snapshotPath: 'snapshot.json' }, permissions: [], publisherSource: { ...request, contentSha256: digest } }, files: [{ path: 'snapshot.json', content }] }], credentials: [] }
  }
  async navigate(input, signal) {
    const { operation, groupId, query, limit, offset, ...selectors } = input
    let path, body
    if (operation === 'files') { path = 'files'; body = { groupId, offset: offset ?? 0 } }
    else if (operation === 'search') {
      if (!query || Object.keys(selectors).length) throw new Error('search 需要 query，不接受文件位置参数。')
      path = 'query'; body = { groupIds: [groupId], query, limit: limit ?? 5 }
    } else if (operation === 'evidence') {
      path = 'read'; body = schemas.read.parse({ groupId, ...selectors })
    } else {
      if (!selectors.fileId && !selectors.fileName) throw new Error('请指定 fileId 或 fileName。')
      if ([selectors.sectionId, selectors.tableId, selectors.page, selectors.slide, selectors.sheet].filter(value => value !== undefined).length > 1) throw new Error('每次只能指定一种原文范围。')
      if (selectors.cell && !selectors.sheet || (selectors.rowStart || selectors.rowEnd) && !selectors.tableId && !selectors.sheet || selectors.rowStart && selectors.rowEnd && selectors.rowEnd < selectors.rowStart) throw new Error('表格范围无效。')
      path = 'document'; body = { groupId, operation, ...selectors, maxChars: selectors.maxChars ?? 4000 }
    }
    return this.request(`${this.prefix}knowledge-retrieval/${path}`, 'POST', body, signal)
  }
}
