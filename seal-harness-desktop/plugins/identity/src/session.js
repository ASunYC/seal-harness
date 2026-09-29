import { createHash } from 'node:crypto'
import { credentialKey } from '@deepseek-ai/dsh-credentials'
import { z } from 'zod'
import { IdentityError, jwtExpiresAtMs, loginSchema, passwordSchema, sessionSchema } from './provider.js'

const savedSchema = z.object({ baseUrl: z.string(), session: sessionSchema })
// 沿用 Stratex 的五分钟刷新窗口，实际期限取远端 JWT exp。
const ACCESS_REFRESH_SKEW_MS = 5 * 60_000

export class IdentitySession {
  #current = null
  #epoch = 0
  #generation = 0
  #flight = null
  #listeners = new Set()
  #storage = Promise.resolve()
  #disposed = false
  constructor({ provider, credentials, logger, canPersist = () => true }) {
    this.provider = provider; this.credentials = credentials; this.logger = logger
    this.canPersist = canPersist
    this.key = credentialKey('seal-harness-identity', `session-${createHash('sha256').update(provider.baseUrl).digest('hex')}`)
    this.persistenceAvailable = false
    this.saved = false
    this.warning = null
    this.restoreError = null
    this.restoreErrorCode = null
  }
  async initialize() {
    try {
      this.persistenceAvailable = (await this.credentials.describeRecord(this.key)).writable
      this.saved = Boolean(await this.credentials.readRecord(this.key))
    } catch { this.warning = 'persistenceFailed' }
    if (this.saved && this.persistenceAvailable) {
      try { await this.restore() }
      catch (error) {
        this.logger?.warn('启动恢复登录失败：%s', error.code)
      }
    }
  }
  getSession() {
    const current = this.#current
    return current ? Object.freeze({ accountId: current.accountId, epoch: this.#epoch, accessToken: current.session.accessToken, subject: current.session.user.id }) : null
  }
  exportHandoff() {
    if (!this.#current) throw new IdentityError('sessionExpired')
    return structuredClone(this.#current.session)
  }
  getRemember() { return this.#current?.remember === true }
  async getAccessToken() {
    if (!this.#current) throw new IdentityError('sessionExpired')
    const generation = this.#generation
    if (this.#current.accessExpiresAtMs <= Date.now() + ACCESS_REFRESH_SKEW_MS) {
      await this.refreshSession()
      this.#assert(generation)
    }
    return this.#current.session.accessToken
  }
  getStatus() {
    const current = this.#current
    return { user: current ? { ...current.session.user } : null, accountId: current?.accountId ?? null, epoch: this.#epoch,
      persisted: current?.persisted ?? false, persistenceAvailable: this.persistenceAvailable, saved: this.saved, warning: this.warning, restoreError: this.restoreError, restoreErrorCode: this.restoreErrorCode }
  }
  subscribe(listener) { this.#listeners.add(listener); return () => this.#listeners.delete(listener) }
  #notify() {
    for (const listener of this.#listeners) {
      try { Promise.resolve(listener()).catch(() => this.logger?.warn('身份订阅处理失败')) }
      catch { this.logger?.warn('身份订阅处理失败') }
    }
  }
  #assert(generation) { if (this.#disposed || this.#generation !== generation) throw new IdentityError('staleOperation') }
  #transition() {
    if (this.#disposed) throw new IdentityError('staleOperation')
    this.#generation++; this.#epoch++; this.#current = null; this.#flight = null; this.warning = null; this.restoreError = null; this.restoreErrorCode = null
    this.#notify()
    return this.#generation
  }
  #queue(action) {
    const job = this.#storage.then(action)
    this.#storage = job.catch(() => {})
    return job
  }
  async #clear(generation) {
    await this.#queue(async () => {
      this.#assert(generation)
      try { await this.credentials.deleteRecord(this.key); this.saved = false }
      catch { this.warning = 'persistenceFailed'; this.#notify(); throw new IdentityError('persistenceFailed') }
    })
    this.#assert(generation)
  }
  async #save(session, remember, generation, signal) {
    let persisted = false
    await this.#queue(async () => {
      this.#assert(generation)
      signal?.throwIfAborted()
      try {
        if (remember && this.persistenceAvailable && this.canPersist(session.user)) {
          await this.credentials.modifyRecord(this.key, () => ({ kind: 'grant', payload: { baseUrl: this.provider.baseUrl, session } }))
          persisted = true
        } else await this.credentials.deleteRecord(this.key)
        this.saved = persisted
      } catch (error) {
        if (error.code === 'staleOperation') throw error
        // 轮换后的保存失败时清除旧记录，避免下次恢复已失效的 refresh token。
        await this.credentials.deleteRecord(this.key).catch(() => { throw new IdentityError('persistenceFailed') })
        this.saved = false; this.warning = 'persistenceFailed'
      }
    })
    this.#assert(generation)
    return persisted
  }
  async #accept(session, remember, generation, signal) {
    this.#assert(generation)
    signal?.throwIfAborted()
    if (session.user.status !== 'active') throw new IdentityError('accountDisabled')
    const accessExpiresAtMs = jwtExpiresAtMs(session.accessToken)
    const persisted = await this.#save(session, remember, generation, signal)
    this.#assert(generation)
    if (signal?.aborted) { await this.#clear(generation); signal.throwIfAborted() }
    this.#current = { session, accessExpiresAtMs, persisted, remember, accountId: JSON.stringify([this.provider.baseUrl, session.user.id]) }
    this.#notify()
    return this.getStatus()
  }
  async login(input, signal) {
    const request = loginSchema.parse(input)
    const generation = this.#transition()
    await this.#clear(generation)
    const session = await this.provider.login(request, signal)
    this.#assert(generation)
    session.user = await this.provider.me(session, signal)
    return this.#accept(session, request.remember, generation)
  }
  async restore(signal) {
    const generation = this.#transition()
    if (!this.persistenceAvailable) throw new IdentityError('persistenceFailed')
    let saved
    try {
      saved = await this.#queue(async () => {
        this.#assert(generation)
        const record = await this.credentials.readRecord(this.key)
        if (record?.kind !== 'grant') throw new IdentityError('sessionExpired')
        return savedSchema.parse(record.payload)
      })
      this.#assert(generation)
      if (saved.baseUrl !== this.provider.baseUrl || saved.session.user.status !== 'active') throw new IdentityError('sessionExpired')
      const refreshed = await this.provider.refresh(saved.session, signal)
      this.#assert(generation)
      if (refreshed.user.id !== saved.session.user.id) throw new IdentityError('sessionExpired')
      return await this.#accept(refreshed, true, generation)
    } catch (error) {
      this.#assert(generation)
      const failure = error instanceof IdentityError ? error : new IdentityError('sessionExpired')
      if (['sessionExpired', 'accountDisabled'].includes(failure.code)) await this.#clear(generation)
      this.restoreError = failure.message; this.restoreErrorCode = failure.code
      this.#notify()
      throw failure
    }
  }
  refreshSession() {
    if (!this.#current) return Promise.reject(new IdentityError('sessionExpired'))
    if (this.#flight) return this.#flight
    const current = this.#current, generation = this.#generation
    const flight = (async () => {
      try {
        const refreshed = await this.provider.refresh(current.session)
        this.#assert(generation)
        if (refreshed.user.id !== current.session.user.id) throw new IdentityError('sessionExpired')
        await this.#accept(refreshed, current.remember, generation)
      } catch (error) {
        this.#assert(generation)
        if (['sessionExpired', 'accountDisabled'].includes(error.code)) await this.#clear(this.#transition())
        throw error
      } finally { if (this.#flight === flight) this.#flight = null }
    })()
    this.#flight = flight
    return flight
  }
  async me(signal) {
    if (!this.#current) throw new IdentityError('sessionExpired')
    const generation = this.#generation
    try {
      let user
      try { user = await this.provider.me(this.#current.session, signal) }
      catch (error) {
        this.#assert(generation)
        if (error.code !== 'sessionExpired') throw error
        await this.refreshSession()
        this.#assert(generation)
        user = await this.provider.me(this.#current.session, signal)
      }
      this.#assert(generation)
      this.#current = { ...this.#current, session: { ...this.#current.session, user } }
      this.#notify()
      return this.getStatus()
    } catch (error) {
      this.#assert(generation)
      if (['sessionExpired', 'accountDisabled'].includes(error.code)) await this.#clear(this.#transition())
      throw error
    }
  }
  async changePassword(input, signal) {
    const request = passwordSchema.parse(input)
    if (!this.#current) throw new IdentityError('sessionExpired')
    const generation = this.#generation
    await this.getAccessToken()
    this.#assert(generation)
    await this.provider.changePassword(this.#current.session, request, signal)
    this.#assert(generation)
    return { changed: true }
  }
  async logout() {
    const previous = this.#current, generation = this.#transition()
    await this.#clear(generation)
    let remoteRevoked = true
    if (previous) { try { await this.provider.logout(previous.session) } catch { remoteRevoked = false } }
    return { remoteRevoked }
  }
  async acceptExternalSession(session, remember, generation, signal) {
    this.#assert(generation)
    const verified = { ...session, user: await this.provider.me(session, signal) }
    return this.#accept(verified, remember, generation, signal)
  }
  async beginExternalLogin() { const generation = this.#transition(); await this.#clear(generation); return generation }
  dispose() { this.#generation++; this.#epoch++; this.#current = null; this.#disposed = true; this.#notify(); this.#listeners.clear() }
}
