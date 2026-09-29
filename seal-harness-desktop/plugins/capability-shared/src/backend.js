import { z } from 'zod'

const sessionSchema = z.object({ accountId: z.string().min(1), epoch: z.union([z.string(), z.number()]), accessToken: z.string().min(1) })
const envelopeSchema = z.object({ success: z.literal(true), data: z.unknown(), meta: z.record(z.string(), z.unknown()).default({}) })
const pageSchema = z.object({ total: z.number().int().nonnegative(), offset: z.number().int().nonnegative(), asOf: z.string().datetime({ offset: true }) })
const itemSchema = z.object({ id: z.string().min(1), name: z.string().min(1) }).passthrough()
const collectionSchema = z.enum(['skills', 'mcps', 'experts'])
const scopeSchema = z.enum(['published', 'mine'])
const messages = {
  notConfigured: '尚未配置能力仓库地址。请在Seal Harness服务配置中填写 storeBaseUrl。',
  identityUnavailable: '用户插件尚未接入；本地能力可继续使用。',
  authenticationRequired: '请先登录，再访问云端能力。',
  identityChanged: '当前用户已变化，请刷新后重试。',
  accessDenied: '当前账号没有此操作的权限。',
  conflict: '内容已被其他人修改，请刷新后重试。',
  notFound: '该能力或版本已不存在，请刷新目录。',
  unreachable: '无法连接能力服务，请检查网络和服务地址后重试。',
  invalidResponse: '能力服务返回的数据不符合接口约定。',
  invalidRequest: '请求参数无效，请检查输入。',
  requestRejected: '能力服务拒绝了此操作。',
  cancelled: '操作已取消。',
}

export class BackendError extends Error {
  constructor(code, status) {
    super(messages[code] ?? messages.requestRejected)
    this.code = code
    this.status = status
  }
}

function baseUrl(value) {
  if (!value) return null
  const url = new URL(value)
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new Error('能力服务地址必须为不含凭据、查询参数或片段的 HTTP(S) URL。')
  url.pathname = `${url.pathname.replace(/\/+$/, '')}/`
  return url
}

function targetUrl(base, path) {
  if (!base) throw new BackendError('notConfigured')
  if (typeof path !== 'string' || /^[/.\\]/.test(path) || path.includes('\\')) throw new BackendError('invalidRequest')
  const target = new URL(path, base)
  if (target.origin !== base.origin || !target.pathname.startsWith(base.pathname) || target.hash || target.username || target.password) throw new BackendError('invalidRequest')
  return target
}

/** 读取限制覆盖真实字节流，不依赖服务端 Content-Length。 */
async function readBytes(response, maxBytes) {
  if (Number(response.headers.get('content-length')) > maxBytes) {
    await response.body?.cancel()
    throw new BackendError('invalidResponse')
  }
  if (!response.body) return Buffer.alloc(0)
  const chunks = []
  let size = 0
  const reader = response.body.getReader()
  try {
    for (;;) {
      const { value, done } = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > maxBytes) throw new BackendError('invalidResponse')
      chunks.push(value)
    }
    return Buffer.concat(chunks, size)
  } finally {
    await reader.cancel().catch(() => {})
    reader.releaseLock()
  }
}

function parseJson(bytes) {
  try { return JSON.parse(bytes.toString('utf8')) } catch { throw new BackendError('invalidResponse') }
}

/** Stratex 协议适配。身份服务始终按调用读取，不缓存 token 或个人目录。 */
export class CapabilityBackend {
  constructor({ backendUrl = '', mcpCenterUrl = '', getIdentity = () => undefined, fetchImpl = fetch, timeoutMs = 15_000 } = {}) {
    const base = baseUrl(backendUrl)
    this.registry = base ? new URL('api/v1/stratex/', base) : null
    this.center = baseUrl(mcpCenterUrl)
    this.getIdentity = getIdentity
    this.fetchImpl = fetchImpl
    this.timeoutMs = timeoutMs
  }

  async status() {
    const identity = this.getIdentity()
    const current = identity ? await identity.getSession() : null
    return { backendConfigured: !!this.registry, centerConfigured: !!this.center, user: !identity ? 'unavailable' : current ? 'signedIn' : 'signedOut' }
  }

  async session(identity) {
    if (!identity) throw new BackendError('identityUnavailable')
    const current = await identity.getSession()
    if (!current) throw new BackendError('authenticationRequired')
    const parsed = sessionSchema.safeParse(current)
    if (!parsed.success) throw new BackendError('authenticationRequired')
    return parsed.data
  }

  async account() {
    const { accountId, epoch } = await this.session(this.getIdentity())
    return { accountId, epoch }
  }

  async assertAccount(captured) {
    const current = await this.account()
    if (current.accountId !== captured.accountId || current.epoch !== captured.epoch) throw new BackendError('identityChanged')
  }

  async assertSession(identity, initial) {
    if (this.getIdentity() !== identity) throw new BackendError('identityChanged')
    const current = await this.session(identity)
    if (current.accountId !== initial.accountId || current.epoch !== initial.epoch) throw new BackendError('identityChanged')
  }

  async exchange(path, { method = 'GET', body, headers, signal, maxBytes = 4 * 1024 * 1024 } = {}) {
    const target = targetUrl(this.registry, path)
    const identity = this.getIdentity()
    const initial = await this.session(identity)
    let current = initial
    const cancellation = signal ? AbortSignal.any([signal, AbortSignal.timeout(this.timeoutMs)]) : AbortSignal.timeout(this.timeoutMs)
    try {
      for (let attempt = 0; attempt < 2; attempt++) {
        await this.assertSession(identity, initial)
        const requestHeaders = new Headers(headers)
        requestHeaders.set('accept', 'application/json')
        requestHeaders.set('authorization', `Bearer ${current.accessToken}`)
        if (body !== undefined && !(body instanceof FormData)) requestHeaders.set('content-type', 'application/json')
        const response = await this.fetchImpl(target, { method, headers: requestHeaders, body: body === undefined || body instanceof FormData ? body : JSON.stringify(body), redirect: 'error', signal: cancellation })
        await this.assertSession(identity, initial).catch(async error => { await response.body?.cancel(); throw error })
        const refreshable = response.status === 401
        if (refreshable && attempt === 0 && identity.refreshSession) {
          await response.body?.cancel()
          await identity.refreshSession()
          await this.assertSession(identity, initial)
          current = await this.session(identity)
          continue
        }
        if (!response.ok) {
          await response.body?.cancel()
          const code = response.status === 401 ? 'authenticationRequired' : response.status === 403 ? 'accessDenied' : response.status === 404 ? 'notFound' : [409, 412, 428].includes(response.status) ? 'conflict' : response.status >= 500 ? 'unreachable' : 'requestRejected'
          throw new BackendError(code, response.status)
        }
        const bytes = await readBytes(response, maxBytes)
        await this.assertSession(identity, initial)
        return { bytes, headers: response.headers, status: response.status }
      }
    } catch (error) {
      if (error instanceof BackendError) throw error
      throw new BackendError(signal?.aborted ? 'cancelled' : 'unreachable')
    }
    throw new BackendError('authenticationRequired')
  }

  async request(path, options = {}) {
    const result = await this.exchange(path, options)
    if (result.status === 204) return { data: null, meta: {}, headers: result.headers }
    const parsed = envelopeSchema.safeParse(parseJson(result.bytes))
    if (!parsed.success) throw new BackendError('invalidResponse')
    return { ...parsed.data, headers: result.headers }
  }

  async download(path, options = {}) {
    return this.exchange(path, { ...options, maxBytes: options.maxBytes ?? 512 * 1024 * 1024 })
  }

  async upload(path, bytes, options = {}) {
    const body = new FormData()
    body.set('file', new Blob([bytes], { type: 'application/zip' }), 'capability.zip')
    return this.request(path, { ...options, method: 'POST', body })
  }

  async list(collection, scope = 'published', signal) {
    collectionSchema.parse(collection)
    scopeSchema.parse(scope)
    const identity = this.getIdentity()
    const initial = await this.session(identity)
    const items = []
    const seen = new Set()
    let snapshot
    for (let page = 0; page < 100; page++) {
      const query = new URLSearchParams({ scope, limit: '100', offset: String(items.length) })
      if (snapshot) query.set('asOf', snapshot.asOf)
      await this.assertSession(identity, initial)
      const result = await this.request(`${collection}?${query}`, { signal })
      const meta = pageSchema.safeParse(result.meta)
      const data = z.array(itemSchema).max(100).safeParse(result.data)
      if (!meta.success || !data.success || meta.data.offset !== items.length || (snapshot && (meta.data.asOf !== snapshot.asOf || meta.data.total !== snapshot.total))) throw new BackendError('invalidResponse')
      snapshot = meta.data
      for (const item of data.data) {
        if (seen.has(item.id)) throw new BackendError('invalidResponse')
        seen.add(item.id)
        items.push(item)
      }
      if (items.length > snapshot.total) throw new BackendError('invalidResponse')
      await this.assertSession(identity, initial)
      if (items.length === snapshot.total) return items
      if (!data.data.length) throw new BackendError('invalidResponse')
    }
    throw new BackendError('invalidResponse')
  }

  async detail(collection, id, signal) {
    collectionSchema.parse(collection)
    z.string().min(1).max(256).refine(value => !['.', '..'].includes(value)).parse(id)
    return (await this.request(`${collection}/${encodeURIComponent(id)}`, { signal })).data
  }

  async listCenter(signal) {
    const target = targetUrl(this.center, 'api/v1/catalog/applications')
    try {
      const response = await this.fetchImpl(target, { headers: { accept: 'application/json', 'X-MCP-Catalog-Features': 'auth-experience-v1' }, redirect: 'error', signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(this.timeoutMs)]) : AbortSignal.timeout(this.timeoutMs) })
      if (!response.ok) { await response.body?.cancel(); throw new BackendError('unreachable', response.status) }
      return parseJson(await readBytes(response, 1024 * 1024))
    } catch (error) {
      if (error instanceof BackendError) throw error
      throw new BackendError(signal?.aborted ? 'cancelled' : 'unreachable')
    }
  }
}
