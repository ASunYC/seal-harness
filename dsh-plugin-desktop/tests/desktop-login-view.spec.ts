import { EventEmitter } from 'node:events'
import { afterEach, expect, it, vi } from 'vitest'

const electron = vi.hoisted(() => ({ views: [] as any[], fetch: vi.fn() }))
vi.mock('electron', () => ({
  WebContentsView: class {
    bounds: unknown
    hook: ((details: any, callback: (value: any) => void) => void) | null = null
    readonly session = Object.assign(new EventEmitter(), {
      fetch: electron.fetch,
      closeAllConnections: vi.fn(async () => {}), clearStorageData: vi.fn(async () => {}),
      setPermissionRequestHandler: vi.fn(), setPermissionCheckHandler: vi.fn(),
      webRequest: { onBeforeRequest: (...args: any[]) => { this.hook = args.length === 1 ? null : args[1] } },
    })
    readonly webContents = Object.assign(new EventEmitter(), {
      id: 43, session: this.session, loadURL: vi.fn(async () => {}), insertCSS: vi.fn(async () => {}),
      close: vi.fn(), isDestroyed: vi.fn(() => false), setWindowOpenHandler: vi.fn(),
    })
    constructor(readonly options: unknown) { electron.views.push(this) }
    setBounds(bounds: unknown) { this.bounds = bounds }
  },
}))

import { calculateEmbeddedLoginBounds, openDesktopLoginView } from '../src/desktop-login.ts'

class OwnerWindow extends EventEmitter {
  destroyed = false
  width = 1180
  height = 760
  readonly contentView = { addChildView: vi.fn(), removeChildView: vi.fn() }
  getContentSize() { return [this.width, this.height] }
  isDestroyed() { return this.destroyed }
  close() { this.destroyed = true; this.emit('closed') }
}

const options = {
  url: 'https://agent.geovisearth.com/internal/auth/wecom-probe',
  completionUrl: 'https://agent.geovisearth.com/api/v1/auth/wecom/complete',
  title: '企业微信登录',
  embedded: { width: 320, height: 380, rightColumnFraction: 1 / 2.25, top: 132, css: '.probe-page{padding:0!important}',
    allowedOrigins: ['https://agent.geovisearth.com', 'https://login.work.weixin.qq.com'] },
}

afterEach(() => { electron.views.length = 0; vi.clearAllMocks() })

it('positions an isolated login view inside the owner, resizes it and exchanges completion in its own session', async () => {
  const owner = new OwnerWindow()
  const payload = { accessToken: 'fixture', refreshToken: 'refresh', user: { id: 'one' } }
  electron.fetch.mockResolvedValue(Response.json(payload))
  expect(calculateEmbeddedLoginBounds([1180, 760], 36, options.embedded)).toEqual({ x: 758, y: 168, width: 320, height: 380 })
  const result = openDesktopLoginView(owner as any, 36, options)
  const view = electron.views[0]
  expect(view.options.webPreferences.partition).toMatch(/^desktop-login-/)
  expect(view.options.webPreferences).toMatchObject({ sandbox: true, contextIsolation: true, nodeIntegration: false, webSecurity: true })
  expect(owner.contentView.addChildView).toHaveBeenCalledWith(view)
  await vi.waitFor(() => expect(view.webContents.insertCSS).toHaveBeenCalledWith(options.embedded.css))
  owner.width = 1363; owner.emit('resize')
  expect(view.bounds).toEqual(calculateEmbeddedLoginBounds([1363, 760], 36, options.embedded))
  const callback = vi.fn()
  view.hook({ url: options.completionUrl, method: 'POST', webContentsId: 43, uploadData: [{ bytes: Buffer.from('{"code":"one"}') }] }, callback)
  expect(callback).toHaveBeenCalledWith({ cancel: true })
  await expect(result).resolves.toEqual(payload)
  expect(electron.fetch).toHaveBeenCalledWith(options.completionUrl, expect.objectContaining({ credentials: 'include', body: '{"code":"one"}' }))
  expect(owner.contentView.removeChildView).toHaveBeenCalledWith(view)
  expect(view.webContents.close).toHaveBeenCalledOnce()
  expect(view.session.clearStorageData).toHaveBeenCalledOnce()
})

it.each(['cancel', 'close'])('cleans the embedded view and Cookie session on %s', async action => {
  const owner = new OwnerWindow(), controller = new AbortController()
  const result = openDesktopLoginView(owner as any, 0, options, controller.signal)
  const assertion = expect(result).rejects.toThrow('Login cancelled')
  if (action === 'close') owner.close()
  else controller.abort()
  await assertion
  const view = electron.views[0]
  if (action !== 'close') expect(owner.contentView.removeChildView).toHaveBeenCalledWith(view)
  expect(view.hook).toBeNull()
  expect(view.session.clearStorageData).toHaveBeenCalledOnce()
})

it('rejects unlisted resources, navigation, popups and permissions', async () => {
  const owner = new OwnerWindow(), controller = new AbortController()
  const result = openDesktopLoginView(owner as any, 0, options, controller.signal)
  const view = electron.views[0], denied = vi.fn(), allowed = vi.fn()
  view.hook({ url: 'https://unlisted.example/pixel', webContentsId: 43 }, denied)
  view.hook({ url: 'https://login.work.weixin.qq.com/qr', webContentsId: 43 }, allowed)
  expect(denied).toHaveBeenCalledWith({ cancel: true })
  expect(allowed).toHaveBeenCalledWith({ cancel: false })
  const navigation = { preventDefault: vi.fn() }
  view.webContents.emit('will-navigate', navigation, 'https://unlisted.example/')
  expect(navigation.preventDefault).toHaveBeenCalledOnce()
  expect(view.webContents.setWindowOpenHandler.mock.calls[0][0]()).toEqual({ action: 'deny' })
  const permission = vi.fn()
  view.session.setPermissionRequestHandler.mock.calls[0][0](view.webContents, 'camera', permission)
  expect(permission).toHaveBeenCalledWith(false)
  controller.abort()
  await expect(result).rejects.toThrow('Login cancelled')
})

it('rejects an invalid completion without forwarding it and clears the temporary session', async () => {
  const owner = new OwnerWindow()
  const result = openDesktopLoginView(owner as any, 0, options)
  const view = electron.views[0], callback = vi.fn()
  view.hook({ url: options.completionUrl, method: 'GET', webContentsId: 43 }, callback)
  expect(callback).toHaveBeenCalledWith({ cancel: true })
  await expect(result).rejects.toThrow('Invalid login completion request')
  expect(electron.fetch).not.toHaveBeenCalled()
  expect(view.session.clearStorageData).toHaveBeenCalledOnce()
})

it('rejects an oversized completion response without returning tokens', async () => {
  const owner = new OwnerWindow()
  electron.fetch.mockResolvedValue(new Response('x'.repeat(65537)))
  const result = openDesktopLoginView(owner as any, 0, options)
  const view = electron.views[0]
  view.hook({ url: options.completionUrl, method: 'POST', webContentsId: 43, uploadData: [{ bytes: Buffer.from('{}') }] }, vi.fn())
  await expect(result).rejects.toThrow('Login completion failed')
  expect(view.session.clearStorageData).toHaveBeenCalledOnce()
})

it('rejects invalid embedded bounds before creating a native view', () => {
  expect(() => openDesktopLoginView(new OwnerWindow() as any, 0, { ...options, embedded: { ...options.embedded, width: 9999 } })).toThrow('Invalid embedded login bounds')
  expect(electron.views).toHaveLength(0)
})
