import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import { z } from 'zod'
import { IdentityError, parseSession } from './provider.js'

export const returnUri = 'seal-harness://auth/netauth/callback'
const statusSchema = z.object({ enabled: z.boolean(), desktopFlow: z.boolean() })
const startSchema = z.object({ authorizationUrl: z.string().url().max(8192), expiresAtMs: z.number().int().positive() })

/** PKCE 事务只驻留 Host；浏览器服务负责系统浏览器和原生回跳登记。 */
export class IdentitySso {
  #pending = null
  #operation = 0
  #controller = null
  #enabled = false
  #reason = null
  constructor({ provider, identity, browser }) {
    this.provider = provider; this.identity = identity; this.browser = browser
    this.returnUri = browser?.returnUri ?? returnUri
    this.phase = 'idle'
  }
  getStatus() {
    if (this.#pending && this.#pending.expiresAtMs <= Date.now()) { this.cancel(); this.phase = 'failed' }
    return { enabled: this.#enabled, phase: this.phase, reason: this.browser ? this.#reason : 'ssoUnavailable' }
  }
  async refreshAvailability(signal) {
    if (!this.browser) { this.#enabled = false; return this.getStatus() }
    try {
      const status = await this.provider.request('netauth/status', { schema: statusSchema, signal: AbortSignal.any([AbortSignal.timeout(5000), ...(signal ? [signal] : [])]) })
      this.#enabled = status.enabled && status.desktopFlow
      this.#reason = this.#enabled ? null : 'notConfigured'
    } catch (error) { this.#enabled = false; this.#reason = error.code ?? 'unreachable' }
    return this.getStatus()
  }
  cancel() { this.#operation++; this.#pending = null; this.#controller?.abort(); this.#controller = null; this.phase = 'idle'; return this.getStatus() }
  setRemember(remember) {
    if (this.getStatus().phase !== 'waiting' || !this.#pending) throw new IdentityError('staleOperation')
    this.#pending.remember = remember
    return this.getStatus()
  }
  async start({ remember = true } = {}) {
    if (!this.browser) throw new IdentityError('ssoUnavailable')
    this.cancel()
    const operation = this.#operation
    const controller = new AbortController()
    this.#controller = controller
    this.phase = 'starting'
    const assertCurrent = () => { if (operation !== this.#operation) throw new IdentityError('staleOperation') }
    try {
      const generation = await this.identity.beginExternalLogin()
      assertCurrent()
      const status = await this.provider.request('netauth/status', { schema: statusSchema, signal: controller.signal })
      assertCurrent()
      if (!status.enabled || !status.desktopFlow) throw new IdentityError('notConfigured')
      const state = randomBytes(32).toString('base64url'), codeVerifier = randomBytes(32).toString('base64url')
      const started = await this.provider.request('netauth/desktop/start', {
        body: { state, codeChallenge: createHash('sha256').update(codeVerifier).digest('base64url'), returnUri: this.returnUri }, schema: startSchema, signal: controller.signal,
      })
      assertCurrent()
      const url = new URL(started.authorizationUrl)
      if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || started.expiresAtMs <= Date.now()) throw new IdentityError('invalidResponse')
      this.#pending = { state, codeVerifier, expiresAtMs: Math.min(started.expiresAtMs, Date.now() + 10 * 60 * 1000), generation, remember }
      this.phase = 'waiting'
      await this.browser.openExternal(url.href)
      assertCurrent()
      return this.getStatus()
    } catch (error) { if (operation === this.#operation) { this.#pending = null; this.phase = 'failed' }; throw error }
  }
  async callback(value) {
    const pending = this.#pending
    if (!pending || this.phase !== 'waiting') throw new IdentityError('invalidCallback')
    let url
    try { url = new URL(value) } catch { throw new IdentityError('invalidCallback') }
    const state = url.searchParams.get('state') ?? '', ticket = url.searchParams.get('ticket') ?? ''
    if (`${url.protocol}//${url.host}${url.pathname}` !== this.returnUri || url.username || url.password || url.hash
      || [...url.searchParams.keys()].some(key => !['state', 'ticket'].includes(key))
      || url.searchParams.getAll('state').length !== 1 || url.searchParams.getAll('ticket').length !== 1
      || !/^[A-Za-z0-9_-]{32,128}$/.test(state) || ticket.length < 1 || ticket.length > 8192
      || pending.expiresAtMs <= Date.now() || Buffer.byteLength(state) !== Buffer.byteLength(pending.state)
      || !timingSafeEqual(Buffer.from(state), Buffer.from(pending.state))) throw new IdentityError('invalidCallback')
    this.#pending = null
    this.phase = 'completing'
    const operation = this.#operation
    try {
      const session = parseSession(await this.provider.request('netauth/desktop/complete', {
        body: { state, ticket, codeVerifier: pending.codeVerifier }, statusCodes: { 401: 'invalidCallback', 403: 'invalidCallback', 409: 'invalidCallback', 410: 'invalidCallback' }, signal: this.#controller.signal,
      }))
      if (operation !== this.#operation) throw new IdentityError('staleOperation')
      await this.identity.acceptExternalSession(session, pending.remember, pending.generation, this.#controller.signal)
      if (operation === this.#operation) this.phase = 'idle'
    } catch (error) { if (operation === this.#operation) this.phase = 'failed'; throw error }
  }
}
