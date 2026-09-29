import { BrowserWindow, WebContentsView } from 'electron'
import { randomUUID } from 'node:crypto'
import type { DesktopLoginWindowOptions } from './runtime.ts'

/** 启动阶段的回跳先保留一条，待 Host 登录插件订阅后交付。 */
export class DesktopProtocolUrls {
  private pending: string | undefined
  private readonly listeners = new Set<(url: string) => void>()
  constructor(readonly scheme?: string) {}

  accept(url: string): boolean {
    if (!this.scheme) return false
    try { if (new URL(url).protocol !== `${this.scheme}:`) return false } catch { return false }
    if (!this.listeners.size) this.pending = url
    else for (const listener of this.listeners) listener(url)
    return true
  }
  acceptArgv(argv: readonly string[]): boolean {
    return argv.some(value => this.accept(value))
  }
  subscribe(listener: (url: string) => void): () => void {
    this.listeners.add(listener)
    if (this.pending) { const url = this.pending; this.pending = undefined; listener(url) }
    return () => { this.listeners.delete(listener) }
  }
}

/** 登录页的完成请求在同一临时 Cookie session 中交换，响应只回 Host。 */
export function openDesktopLoginWindow(options: DesktopLoginWindowOptions, signal?: AbortSignal): Promise<unknown> {
  signal?.throwIfAborted()
  const window = new BrowserWindow({
    title: options.title, width: 1000, height: 760, autoHideMenuBar: true,
    webPreferences: { partition: `desktop-login-${randomUUID()}`, sandbox: true, contextIsolation: true, nodeIntegration: false },
  })
  const contents = window.webContents, session = contents.session
  return new Promise((resolve, reject) => {
    let settled = false, completing = false
    const completion = new AbortController()
    const finish = (value: unknown, error?: Error): void => {
      if (settled) return
      settled = true
      signal?.removeEventListener('abort', abort)
      completion.abort()
      session.webRequest.onBeforeRequest(null)
      if (!window.isDestroyed()) window.destroy()
      void Promise.all([session.closeAllConnections(), session.clearStorageData()]).then(
        () => { if (error) reject(error); else resolve(value) },
        () => reject(new Error('Login window cleanup failed')),
      )
    }
    const abort = (): void => finish(undefined, new Error('Login cancelled'))
    window.once('closed', abort)
    signal?.addEventListener('abort', abort, { once: true })
    session.webRequest.onBeforeRequest({ urls: [options.completionUrl] }, (details, callback) => {
      // session.fetch 没有该窗口的 webContentsId，放行已发起的原生交换请求。
      if (details.webContentsId !== contents.id) { callback({}); return }
      callback({ cancel: true })
      if (completing || settled) return
      if (details.method !== 'POST' || !details.uploadData?.length || details.uploadData.some(part => !part.bytes)) {
        finish(undefined, new Error('Invalid login completion request')); return
      }
      completing = true
      const body = Buffer.concat(details.uploadData.map(part => part.bytes!)).toString('utf8')
      void session.fetch(options.completionUrl, {
        method: 'POST', credentials: 'include', headers: { 'content-type': 'application/json', accept: 'application/json' }, body,
        signal: AbortSignal.any([completion.signal, AbortSignal.timeout(30_000)]),
      }).then(async response => {
        if (!response.ok) throw new Error(`Login completion failed (${response.status})`)
        return await response.json()
      }).then(value => finish(value), () => finish(undefined, new Error('Login completion failed')))
    })
    void contents.loadURL(options.url).catch(() => finish(undefined, new Error('Login page could not be loaded')))
  })
}

type EmbeddedLogin = NonNullable<DesktopLoginWindowOptions['embedded']>

/** Browser content pixels plus the compatibility chrome inset become native contentView coordinates. */
export function calculateEmbeddedLoginBounds(contentSize: readonly number[], topInset: number, layout: EmbeddedLogin): Electron.Rectangle {
  const [width = 0, height = 0] = contentSize
  if (!Number.isFinite(width) || !Number.isFinite(height) || width < 600 || height < 400
    || !Number.isInteger(topInset) || topInset < 0 || topInset > 100
    || !Number.isInteger(layout.width) || layout.width < 200 || layout.width > 600
    || !Number.isInteger(layout.height) || layout.height < 200 || layout.height > 700
    || !Number.isFinite(layout.rightColumnFraction) || layout.rightColumnFraction < .25 || layout.rightColumnFraction > .75
    || !Number.isInteger(layout.top) || layout.top < 0 || layout.top > 500
    || layout.width > width * layout.rightColumnFraction || layout.top + layout.height > height - topInset) {
    throw new Error('Invalid embedded login bounds')
  }
  const rightColumnWidth = Math.round(width * layout.rightColumnFraction)
  return { x: width - rightColumnWidth + Math.round((rightColumnWidth - layout.width) / 2),
    y: topInset + layout.top, width: layout.width, height: layout.height }
}

/** One isolated remote login surface hosted by the existing main window, never by a DOM iframe. */
export function openDesktopLoginView(owner: BrowserWindow, topInset: number, options: DesktopLoginWindowOptions, signal?: AbortSignal): Promise<unknown> {
  signal?.throwIfAborted()
  if (owner.isDestroyed() || !options.embedded) throw new Error('Embedded login owner is unavailable')
  const layout = options.embedded
  const initialBounds = calculateEmbeddedLoginBounds(owner.getContentSize(), topInset, layout)
  if (typeof layout.css !== 'string' || layout.css.length > 8192
    || !Array.isArray(layout.allowedOrigins) || !layout.allowedOrigins.length || layout.allowedOrigins.length > 12) {
    throw new Error('Invalid embedded login policy')
  }
  const allowedOrigins = new Set(layout.allowedOrigins.map(origin => {
    const url = new URL(origin)
    if (url.protocol !== 'https:' || url.origin !== origin) throw new Error('Invalid embedded login origin')
    return origin
  }))
  if (!allowedOrigins.has(new URL(options.url).origin) || new URL(options.url).origin !== new URL(options.completionUrl).origin) {
    throw new Error('Invalid embedded login endpoint')
  }
  const view = new WebContentsView({ webPreferences: {
    partition: `desktop-login-${randomUUID()}`, sandbox: true, contextIsolation: true,
    nodeIntegration: false, webSecurity: true, allowRunningInsecureContent: false, webviewTag: false,
  } })
  const contents = view.webContents, session = contents.session
  return new Promise((resolve, reject) => {
    let settled = false, completing = false
    let mounted = false
    const completion = new AbortController()
    const loadingDeadline = setTimeout(() => finish(undefined, new Error('Login page could not be loaded')), 20_000)
    const blockNavigation = (event: Electron.Event): void => { event.preventDefault() }
    const blockDownload = (event: Electron.Event): void => { event.preventDefault() }
    const resize = (): void => {
      if (settled || owner.isDestroyed()) return
      const size = owner.getContentSize()
      if ((size[0] ?? 0) < 600 || (size[1] ?? 0) < 400) return
      try { view.setBounds(calculateEmbeddedLoginBounds(size, topInset, layout)) } catch { /* transient resize */ }
    }
    const finish = (value: unknown, error?: Error): void => {
      if (settled) return
      settled = true
      clearTimeout(loadingDeadline)
      let cleanupFailed = false
      const attempt = (action: () => void): void => { try { action() } catch { cleanupFailed = true } }
      attempt(() => signal?.removeEventListener('abort', abort))
      attempt(() => { owner.off('resize', resize); owner.off('closed', abort) })
      completion.abort()
      attempt(() => session.webRequest.onBeforeRequest(null))
      attempt(() => { session.setPermissionRequestHandler(null); session.setPermissionCheckHandler(null) })
      attempt(() => session.off('will-download', blockDownload))
      attempt(() => { contents.off('will-navigate', blockNavigation); contents.off('will-redirect', blockNavigation) })
      if (mounted && !owner.isDestroyed()) attempt(() => owner.contentView.removeChildView(view))
      if (!contents.isDestroyed()) attempt(() => contents.close())
      void Promise.all([session.closeAllConnections(), session.clearStorageData()]).then(
        () => { if (cleanupFailed) reject(new Error('Embedded login cleanup failed')); else if (error) reject(error); else resolve(value) },
        () => reject(new Error('Embedded login cleanup failed')),
      )
    }
    const abort = (): void => finish(undefined, new Error('Login cancelled'))
    try {
      signal?.addEventListener('abort', abort, { once: true })
      if (signal?.aborted) { abort(); return }
      owner.on('closed', abort); owner.on('resize', resize)
      contents.on('will-navigate', blockNavigation); contents.on('will-redirect', blockNavigation)
      contents.setWindowOpenHandler(() => ({ action: 'deny' }))
      session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false))
      session.setPermissionCheckHandler(() => false)
      session.on('will-download', blockDownload)
      session.webRequest.onBeforeRequest({ urls: ['<all_urls>'] }, (details, callback) => {
      if (details.url === options.completionUrl) {
        if (details.webContentsId !== contents.id && completing) { callback({}); return }
        callback({ cancel: true })
        if (details.webContentsId !== contents.id || completing) return
        if (details.method !== 'POST' || !details.uploadData?.length || details.uploadData.some(part => !part.bytes)) {
          finish(undefined, new Error('Invalid login completion request')); return
        }
        const body = Buffer.concat(details.uploadData.map(part => part.bytes!))
        if (body.length > 4096) { finish(undefined, new Error('Invalid login completion request')); return }
        completing = true
        void session.fetch(options.completionUrl, {
          method: 'POST', credentials: 'include', headers: { 'content-type': 'application/json', accept: 'application/json' },
          body: body.toString('utf8'), signal: AbortSignal.any([completion.signal, AbortSignal.timeout(30_000)]),
        }).then(async response => {
          if (!response.ok) throw new Error('Login completion failed')
          const payload = await response.text()
          if (Buffer.byteLength(payload) > 65536) throw new Error('Login completion response is too large')
          return JSON.parse(payload)
        }).then(value => finish(value), () => finish(undefined, new Error('Login completion failed')))
        return
      }
      let allowed = false
      try { allowed = allowedOrigins.has(new URL(details.url).origin) } catch { /* invalid URL */ }
      callback({ cancel: !allowed })
      })
      owner.contentView.addChildView(view)
      mounted = true
      view.setBounds(initialBounds)
      void contents.loadURL(options.url).then(async () => {
        if (!settled) await contents.insertCSS(layout.css)
        clearTimeout(loadingDeadline)
      }).catch(() => finish(undefined, new Error('Login page could not be loaded')))
    } catch { finish(undefined, new Error('Login page could not be loaded')) }
  })
}
