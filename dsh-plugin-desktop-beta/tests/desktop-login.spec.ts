import { afterEach, expect, it, vi } from 'vitest'
import { EventEmitter } from 'node:events'

const electron = vi.hoisted(() => ({ windows: [] as any[], fetch: vi.fn() }))
vi.mock('electron', () => ({ BrowserWindow: class extends EventEmitter {
  destroyed = false
  hook: ((details: any, callback: (value: any) => void) => void) | null = null
  readonly session = {
    fetch: electron.fetch,
    closeAllConnections: vi.fn(async () => {}), clearStorageData: vi.fn(async () => {}),
    webRequest: { onBeforeRequest: (...args: any[]) => { this.hook = args.length === 1 ? null : args[1] } },
  }
  readonly webContents = { id: 42, session: this.session, loadURL: vi.fn(async () => {}) }
  constructor(readonly options: unknown) { super(); electron.windows.push(this) }
  isDestroyed() { return this.destroyed }
  destroy() { this.destroyed = true; this.emit('closed') }
} }))

import { DesktopProtocolUrls, openDesktopLoginWindow } from '../src/desktop-login.ts'

afterEach(() => { electron.windows.length = 0; vi.clearAllMocks() })

it('delivers cold and running protocol URLs to Host subscribers and releases a listener', () => {
  const links = new DesktopProtocolUrls('product-login'), listener = vi.fn()
  expect(links.acceptArgv(['electron', 'product-login://auth/netauth/callback?ticket=one'])).toBe(true)
  const release = links.subscribe(listener)
  expect(listener).toHaveBeenCalledWith('product-login://auth/netauth/callback?ticket=one')
  expect(links.accept('product-login://auth/netauth/callback?ticket=two')).toBe(true)
  expect(listener).toHaveBeenCalledTimes(2)
  release()
  links.accept('product-login://auth/netauth/callback?ticket=three')
  expect(listener).toHaveBeenCalledTimes(2)
})

it('exchanges the page completion request through its own Cookie session and closes the login window', async () => {
  const payload = { accessToken: 'fixture', refreshToken: 'fixture-refresh', user: { id: 'one' } }
  electron.fetch.mockResolvedValue(Response.json(payload))
  const options = { url: 'https://example.com/internal/auth/login', completionUrl: 'https://example.com/api/auth/complete', title: '登录' }
  const result = openDesktopLoginWindow(options)
  const window = electron.windows[0], callback = vi.fn()
  expect(window.webContents.loadURL).toHaveBeenCalledWith(options.url)
  window.hook({ url: options.completionUrl, method: 'POST', webContentsId: 42, uploadData: [{ bytes: Buffer.from('{"code":"one","state":"two"}') }] }, callback)
  expect(callback).toHaveBeenCalledWith({ cancel: true })
  await expect(result).resolves.toEqual(payload)
  expect(electron.fetch).toHaveBeenCalledWith(options.completionUrl, expect.objectContaining({ credentials: 'include', method: 'POST', body: '{"code":"one","state":"two"}' }))
  expect(window.destroyed).toBe(true)
  expect(window.hook).toBeNull()
  expect(window.session.clearStorageData).toHaveBeenCalledOnce()
})

it.each(['close', 'cancel'])('ends a login when the user chooses %s', async action => {
  const controller = new AbortController()
  const result = openDesktopLoginWindow({ url: 'https://example.com/login', completionUrl: 'https://example.com/complete', title: '登录' }, controller.signal)
  const assertion = expect(result).rejects.toThrow('Login cancelled')
  if (action === 'close') electron.windows[0].destroy()
  else controller.abort()
  await assertion
  expect(electron.windows[0].session.clearStorageData).toHaveBeenCalledOnce()
})
