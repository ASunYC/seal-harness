import { z } from 'zod'

const messages = {
  invalidInput: '请检查输入格式。', invalidCredentials: '账号或密码不正确。',
  passwordCurrentInvalid: '当前密码不正确。', accountDisabled: '此账号已被停用。',
  sessionExpired: '登录已过期，请重新登录。', unreachable: '无法连接身份服务，请稍后重试。',
  timeout: '身份服务请求超时，请稍后重试。', serviceError: '身份服务暂时无法处理请求，请稍后重试。',
  invalidResponse: '身份服务返回的数据无效。', notConfigured: '此登录服务尚未配置。',
  staleOperation: '账号已改变，本次操作已取消。', persistenceFailed: '无法清理或保存登录，请检查本地凭据存储。',
  ssoUnavailable: '统一认证需要登记Seal Harness回跳地址并连接桌面浏览器服务。',
  wecomUnavailable: '当前身份服务未开放企业微信登录，请使用 Platform 账号或检查服务连接。',
  homeSwitchFailed: '无法打开账号独立工作区，请检查本地数据目录后重新登录。',
  invalidCallback: '登录回跳无效、已过期或已使用，请重新发起登录。',
}
export class IdentityError extends Error {
  constructor(code) { super(messages[code] ?? '身份操作失败。'); this.code = code }
}
export const userSchema = z.object({
  id: z.string().min(1).max(256), username: z.string().min(1).max(128), displayName: z.string().max(128).optional(),
  role: z.enum(['admin', 'vip', 'guest']), status: z.enum(['active', 'disabled']),
  createdAt: z.string().datetime({ offset: true }), lastLoginAt: z.string().datetime({ offset: true }),
})
const tokenSchema = z.string().min(16).max(16384).regex(/^\S+$/)
const jwtPayloadSchema = z.object({ exp: z.number().int().positive() })
export const sessionSchema = z.object({ accessToken: tokenSchema, refreshToken: tokenSchema, user: userSchema })
const refreshSchema = sessionSchema.partial({ refreshToken: true })
export const loginSchema = z.strictObject({ username: z.string().trim().min(1).max(64), password: z.string().min(1).max(256), remember: z.boolean().default(true) })
export const passwordSchema = z.strictObject({ currentPassword: z.string().min(1).max(256), newPassword: z.string().min(6).max(64), confirmPassword: z.string().min(6).max(64) })
  .refine(value => value.newPassword === value.confirmPassword, { path: ['confirmPassword'], message: '两次新密码不一致' })

export function parseSession(payload, previousRefreshToken) {
  const result = (previousRefreshToken ? refreshSchema : sessionSchema).safeParse(payload)
  if (!result.success) throw new IdentityError('invalidResponse')
  if (result.data.user.status !== 'active') throw new IdentityError('accountDisabled')
  return { ...result.data, refreshToken: result.data.refreshToken ?? previousRefreshToken }
}

export function jwtExpiresAtMs(token) {
  const segments = token.split('.')
  if (segments.length !== 3 || !segments[1]) throw new IdentityError('invalidResponse')
  try {
    const payload = jwtPayloadSchema.parse(JSON.parse(Buffer.from(segments[1], 'base64url').toString('utf8')))
    const expiresAtMs = payload.exp * 1000
    if (!Number.isSafeInteger(expiresAtMs)) throw new Error('invalid expiry')
    return expiresAtMs
  } catch { throw new IdentityError('invalidResponse') }
}

/** Stratex c656400bc 的密码协议；网络响应只在这里转成身份领域数据。 */
export class IdentityProvider {
  constructor(baseUrl, fetchImpl = fetch) { this.baseUrl = baseUrl; this.fetch = fetchImpl }

  async checkAvailability(signal) {
    if (!this.baseUrl) return 'notConfigured'
    let response
    try {
      response = await this.fetch(new URL('api/v1/auth/me', this.baseUrl), {
        method: 'GET', redirect: 'manual', credentials: 'omit', headers: { accept: 'application/json' },
        signal: AbortSignal.any([AbortSignal.timeout(5000), ...(signal ? [signal] : [])]),
      })
      // HTTP 错误仍证明服务可连接；只有网络失败允许离线跳过。
      return 'reachable'
    } catch { return 'unreachable' }
    finally { if (response?.body) await response.body.cancel().catch(() => {}) }
  }

  async request(path, { body, token, schema, statusCodes = {}, signal, expectJson = true } = {}) {
    if (!this.baseUrl) throw new IdentityError('notConfigured')
    let response
    try {
      response = await this.fetch(new URL(`api/v1/auth/${path}`, this.baseUrl), {
        method: body === undefined ? 'GET' : 'POST', redirect: 'error',
        headers: { accept: 'application/json', ...(body === undefined ? {} : { 'content-type': 'application/json' }), ...(token ? { authorization: `Bearer ${token}` } : {}) },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.any([AbortSignal.timeout(10000), ...(signal ? [signal] : [])]),
      })
      if (!response.ok) throw new IdentityError(statusCodes[response.status] ?? (response.status === 404 ? 'notConfigured' : 'serviceError'))
      if (!expectJson) return
      const chunks = []; let bytes = 0
      for await (const chunk of response.body ?? []) {
        bytes += chunk.byteLength
        if (bytes > 1024 * 1024) throw new IdentityError('invalidResponse')
        chunks.push(chunk)
      }
      let payload
      try { payload = JSON.parse(Buffer.concat(chunks).toString('utf8')) }
      catch { throw new IdentityError('invalidResponse') }
      if (!schema) return payload
      const parsed = schema.safeParse(payload)
      if (!parsed.success) throw new IdentityError('invalidResponse')
      return parsed.data
    } catch (error) {
      if (error instanceof IdentityError) throw error
      throw new IdentityError(error.name === 'TimeoutError' ? 'timeout' : 'unreachable')
    } finally { if (response?.body && !response.bodyUsed) await response.body.cancel().catch(() => {}) }
  }

  async login({ username, password }, signal) {
    return parseSession(await this.request('login', { body: { username, password }, signal, statusCodes: { 401: 'invalidCredentials', 403: 'accountDisabled' } }))
  }
  async refresh(session, signal) {
    return parseSession(await this.request('refresh', { body: { refreshToken: session.refreshToken }, signal, statusCodes: { 401: 'sessionExpired', 403: 'sessionExpired' } }), session.refreshToken)
  }
  async me(session, signal) {
    const { user } = await this.request('me', { token: session.accessToken, signal, schema: z.object({ user: userSchema }), statusCodes: { 401: 'sessionExpired', 403: 'sessionExpired' } })
    if (user.status !== 'active') throw new IdentityError('accountDisabled')
    if (user.id !== session.user.id) throw new IdentityError('sessionExpired')
    return user
  }
  async logout(session) {
    try { await this.request('logout', { token: session.accessToken, body: { refreshToken: session.refreshToken }, expectJson: false, statusCodes: { 401: 'sessionExpired', 403: 'sessionExpired' } }) }
    catch (error) { if (error.code !== 'sessionExpired') throw error }
  }
  async changePassword(session, { currentPassword, newPassword }, signal) {
    await this.request('password/change', { token: session.accessToken, body: { currentPassword, newPassword }, signal, schema: z.object({ ok: z.literal(true) }), statusCodes: { 400: 'invalidInput', 401: 'passwordCurrentInvalid', 403: 'sessionExpired' } })
  }
}
