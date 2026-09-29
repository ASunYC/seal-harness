import { IdentityError, parseSession } from './provider.js'

const embeddedCss = `
html,body{width:100%;height:100%;margin:0;overflow:hidden!important;background:transparent!important}
.probe-page{width:100%;min-height:100%!important;padding:0!important;overflow:hidden!important;background:transparent!important}
.probe-page>header,.diagnostics{display:none!important}
.panel-shell{padding:0!important;gap:0!important;border-radius:0!important;background:transparent!important;box-shadow:none!important}
.panel-host{width:100%!important;min-width:0!important;min-height:100%!important;display:grid!important;place-items:center!important}
`
const embeddedOptions = {
  width: 320, height: 380, rightColumnFraction: 1 / 2.25, top: 132, css: embeddedCss,
  allowedOrigins: [
    'https://login.work.weixin.qq.com', 'https://wwcdn.weixin.qq.com',
    'https://open.work.weixin.qq.com', 'https://work.weixin.qq.com', 'https://wework.qpic.cn',
  ],
}

/** 企业微信复用原页面、Cookie 与 complete 协议，原生视图只负责承载网页。 */
export class IdentityWecom {
  #operation = 0
  #controller = null
  #available = false
  #remember = true
  constructor({ provider, identity, runtime, request = fetch }) {
    this.provider = provider; this.identity = identity; this.runtime = runtime; this.request = request
    this.phase = 'idle'
  }
  getStatus() { return { enabled: this.#available, phase: this.phase } }
  async refreshAvailability(signal) {
    if (!this.runtime?.openLoginWindow || !this.provider.baseUrl) {
      this.#available = false
      return this.getStatus()
    }
    try {
      const response = await this.request(new URL('api/v1/auth/wecom/probe/config', this.provider.baseUrl).href, {
        method: 'GET', redirect: 'manual', headers: { 'Cache-Control': 'no-store' }, signal: AbortSignal.any([AbortSignal.timeout(5000), ...(signal ? [signal] : [])]),
      })
      if (response.body) await response.body.cancel().catch(() => {})
      this.#available = response.status === 200
    } catch { this.#available = false }
    return this.getStatus()
  }
  setRemember(remember) {
    if (this.phase !== 'waiting') throw new IdentityError('staleOperation')
    this.#remember = remember
    return this.getStatus()
  }
  cancel() { this.#operation++; this.#controller?.abort(); this.#controller = null; this.phase = 'idle' }
  async start({ remember = true, embedded = true } = {}) {
    this.cancel()
    const operation = this.#operation
    await this.refreshAvailability()
    if (operation !== this.#operation) throw new IdentityError('staleOperation')
    if (!this.#available) throw new IdentityError('wecomUnavailable')
    const controller = new AbortController()
    this.#controller = controller
    const generation = await this.identity.beginExternalLogin()
    if (operation !== this.#operation) throw new IdentityError('staleOperation')
    this.#remember = remember
    this.phase = 'waiting'
    void this.runtime.openLoginWindow({
      title: '企业微信登录',
      url: new URL('internal/auth/wecom-probe', this.provider.baseUrl).href,
      completionUrl: new URL('api/v1/auth/wecom/complete', this.provider.baseUrl).href,
      ...(embedded ? { embedded: { ...embeddedOptions, allowedOrigins: [new URL(this.provider.baseUrl).origin, ...embeddedOptions.allowedOrigins] } } : {}),
    }, controller.signal).then(async payload => {
      if (operation !== this.#operation) return
      this.phase = 'completing'
      await this.identity.acceptExternalSession(parseSession(payload), this.#remember, generation, controller.signal)
      if (operation === this.#operation) this.phase = 'idle'
    }).catch(error => { if (operation === this.#operation) this.phase = controller.signal.aborted || error.message === 'Login cancelled' ? 'idle' : 'failed' })
    return this.getStatus()
  }
}
