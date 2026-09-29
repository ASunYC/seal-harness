import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { runInNewContext } from 'node:vm'
import { fileURLToPath } from 'node:url'
import { build } from 'tsdown'
import { JSDOM } from 'jsdom'
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'

test('login screen matches the Stratex two-column flow while preserving password, SSO and WeCom actions', { timeout: 10000 }, async t => {
  const cwd = fileURLToPath(new URL('..', import.meta.url))
  const brandIcon = `data:image/png;base64,${(await readFile(new URL('../../../assets/icons/128x128.png', import.meta.url))).toString('base64')}`
  await build({ config: false, cwd, entry: { client: 'src/client.jsx' }, outDir: '.build', format: 'cjs', platform: 'browser', target: 'es2022', dts: false,
    deps: { neverBundle: [/^react(?:\/|$)/] }, define: { 'process.env.NODE_ENV': JSON.stringify('production'), __SEAL_HARNESS_ICON__: JSON.stringify(brandIcon) },
    outputOptions: { entryFileNames: 'client.js' },
  })
  const dom = new JSDOM('<!doctype html><html><head></head><body><main></main></body></html>')
  const oldWindow = globalThis.window, oldDocument = globalThis.document, oldFormData = globalThis.FormData
  globalThis.window = dom.window; globalThis.document = dom.window.document; globalThis.FormData = dom.window.FormData
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  const module = { exports: {} }
  let poll
  let reloads = 0
  runInNewContext(await readFile(new URL('../.build/client.js', import.meta.url), 'utf8'), {
    module, exports: module.exports, require: createRequire(import.meta.url), document, FormData: dom.window.FormData,
    window: {
      location: { reload: () => { reloads++ } },
      addEventListener: dom.window.addEventListener.bind(dom.window),
      removeEventListener: dom.window.removeEventListener.bind(dom.window),
      get matchMedia() { return dom.window.matchMedia },
    }, AbortController, setInterval: callback => { poll = callback; return 1 }, clearInterval: () => {},
  })
  const registered = [], disposers = [], calls = [], provided = new Map(), navigated = []
  let server = 'reachable', hostFailure = false, offlineSwitchRequired = false, probeResult = null, restoreResult = null
  const status = { user: null, accountId: null, epoch: 0, saved: false, persisted: false, persistenceAvailable: true, warning: null,
    services: { file: '/fixture/services.yml', entries: [
      { key: 'identityBaseUrl', value: 'https://example.com/', configured: true, source: 'file' },
      { key: 'storeBaseUrl', value: '', configured: false, source: 'default' },
    ] }, sso: { enabled: true, phase: 'idle' }, wecom: { enabled: true, phase: 'idle' },
  }
  const context = { layout: { selectPanel: panel => navigated.push(panel) }, effect: callback => disposers.push(callback()), provide: (key, value) => provided.set(key, value),
    slots: { inject: (_, callback) => callback(), register: (slot, component) => {
      const entry = { slot, component, disposed: false }; registered.push(entry)
      return () => { entry.disposed = true }
    } },
    connection: { rpc: { call: async (channel, endpoint, payload) => {
      assert.equal(channel, '/api'); calls.push({ endpoint, payload })
      if (endpoint.endsWith('/restore') && restoreResult) return await restoreResult()
      if (endpoint.endsWith('/availability')) {
        if (probeResult) return await probeResult
        if (hostFailure) throw new Error('Host RPC unavailable')
        return { ok: true, value: { server, sso: structuredClone(status.sso), wecom: structuredClone(status.wecom) } }
      }
      if (endpoint.endsWith('/offline')) return { ok: true, value: { switchingHome: offlineSwitchRequired } }
      if (endpoint.endsWith('/login') && payload.password !== 'correct') return { ok: false, error: { message: '账号或密码错误' } }
      if (endpoint.endsWith('/login')) { status.user = { id: 'one', username: payload.username, displayName: '测试用户' }; status.accountId = 'one'; status.persisted = payload.remember }
      if (endpoint.endsWith('/logout')) { status.user = null; status.accountId = null }
      if (endpoint.endsWith('/wecom/start')) status.wecom.phase = 'waiting'
      if (endpoint.endsWith('/wecom/cancel')) status.wecom.phase = 'idle'
      if (endpoint.endsWith('/sso/start')) status.sso.phase = 'waiting'
      if (endpoint.endsWith('/sso/cancel')) status.sso.phase = 'idle'
      return { ok: true, value: endpoint.endsWith('/logout') ? { remoteRevoked: true } : structuredClone(status) }
    } } },
  }
  module.exports.apply(context)
  const gate = registered.find(entry => entry.slot.name === 'root')
  assert(gate, 'signed-out startup occupies the root slot before workbench renders')
  assert(gate.slot.priority < 0)
  assert.equal(registered.some(entry => entry.slot.name === 'sidebar.panellist'), false)
  assert(provided.get('sealHarnessAuthClient'))
  const root = createRoot(document.querySelector('main'))
  t.after(async () => {
    try {
      await act(async () => root.unmount())
      disposers.forEach(dispose => dispose())
      assert.equal(document.querySelectorAll('style').length, 0)
    } finally {
      dom.window.close(); globalThis.window = oldWindow; globalThis.document = oldDocument; globalThis.FormData = oldFormData
      delete globalThis.IS_REACT_ACT_ENVIRONMENT
    }
  })
  await act(async () => root.render(React.createElement(gate.component)))
  assert(document.querySelector('.seal-harness-login-shell'))
  assert(document.querySelector('.seal-harness-login-visual'))
  assert.equal(document.querySelector('.seal-harness-login-mark')?.getAttribute('src'), brandIcon)
  assert.match(document.body.textContent, /连接团队，也能独立工作/)
  assert.match(document.body.textContent, /登录Seal Harness·开发者平台/)
  assert.equal(reloads, 0, 'signed-out status polling keeps the login prompt')
  await act(async () => assert.rejects(provided.get('sealHarnessAuthClient').call('login', { username: 'fixture', password: 'wrong' }), /账号或密码错误/))
  assert.equal(reloads, 0, 'failed login does not restart the workbench')
  assert.equal(gate.disposed, false)
  assert(document.querySelector('input[placeholder="工号或企业邮箱"]'))
  await act(async () => [...document.querySelectorAll('button')].find(button => button.textContent === '集团 SSO').click())
  assert.equal(document.querySelector('[name=password]'), null)
  await act(async () => [...document.querySelectorAll('button')].find(button => button.textContent === '使用统一认证继续').click())
  assert.equal(calls.findLast(call => call.endpoint.endsWith('/sso/start')).payload.remember, true)
  assert.equal(document.querySelector('[type=checkbox]').disabled, false, 'SSO waiting keeps persistence editable')
  await act(async () => document.querySelector('[type=checkbox]').click())
  assert.equal(calls.findLast(call => call.endpoint.endsWith('/sso/remember')).payload.remember, false)
  await act(async () => document.querySelector('[type=checkbox]').click())
  assert.equal(calls.findLast(call => call.endpoint.endsWith('/sso/remember')).payload.remember, true)
  await act(async () => [...document.querySelectorAll('button')].find(button => button.textContent === '取消统一认证').click())
  await act(async () => [...document.querySelectorAll('button')].find(button => button.textContent === '企业账号').click())
  document.querySelector('[name=username]').value = 'fixture'
  document.querySelector('[name=password]').value = 'correct'
  assert.equal(document.querySelector('[type=checkbox]').checked, true, 'password login remembers by default')
  await act(async () => document.querySelector('form').dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true })))
  assert.deepEqual(JSON.parse(JSON.stringify(calls.findLast(call => call.endpoint.endsWith('/login')).payload)), { username: 'fixture', password: 'correct', remember: true })
  assert.equal(gate.disposed, true, 'login reveals the workbench')
  assert.equal(reloads, 0, 'login preserves local workbench state without a reload')
  await act(async () => provided.get('sealHarnessAuthClient').refresh())
  assert.equal(reloads, 0, 'ordinary signed-in polling must not reload')

  // 重新装配 Client 后，已有 Host 登录态不触发页面重载。
  await act(async () => root.render(null))
  disposers.splice(0).forEach(dispose => dispose())
  module.exports.apply(context)
  await act(async () => provided.get('sealHarnessAuthClient').refresh())
  assert.equal(reloads, 0, 'an already authenticated page must not enter a reload loop')
  await act(async () => provided.get('sealHarnessAuthClient').call('logout'))
  assert.equal(reloads, 0, 'logout preserves the local workbench')
  assert.equal(registered.filter(entry => entry.slot.name === 'root' && !entry.disposed).length, 0, 'logout leaves local features accessible')
  await act(async () => root.render(React.createElement(registered.findLast(entry => entry.slot.key === 'seal-harness-identity').component)))
  await act(async () => document.querySelector('[aria-label="企业微信扫码登录"]').click())
  assert(document.querySelector('.seal-harness-wecom-mode'))
  assert.doesNotMatch(document.body.textContent, /弹出的企业微信窗口/, 'QR mode is embedded in the login page')
  assert.equal(calls.findLast(call => call.endpoint.endsWith('/wecom/start')).payload.remember, true)
  assert.equal(document.querySelector('[type=checkbox]').checked, true, 'QR mode displays the active remember policy')
  assert.equal(document.querySelector('[type=checkbox]').disabled, false, 'remember stays editable while waiting for a scan')
  const starts = calls.filter(call => call.endpoint.endsWith('/wecom/start')).length
  await act(async () => document.querySelector('[type=checkbox]').click())
  assert.equal(document.querySelector('[type=checkbox]').checked, false)
  assert.equal(calls.findLast(call => call.endpoint.endsWith('/wecom/remember')).payload.remember, false)
  assert.equal(calls.filter(call => call.endpoint.endsWith('/wecom/start')).length, starts, 'preference changes do not refresh the QR')
  await act(async () => [...document.querySelectorAll('button')].find(button => button.textContent === '刷新二维码').click())
  assert.equal(calls.filter(call => call.endpoint.endsWith('/wecom/start')).length, starts + 1)
  assert.equal(calls.findLast(call => call.endpoint.endsWith('/wecom/start')).payload.remember, false, 'refresh keeps the selected preference')
  await act(async () => document.querySelector('[type=checkbox]').click())
  assert.equal(calls.findLast(call => call.endpoint.endsWith('/wecom/remember')).payload.remember, true)

  assert.equal(calls.findLast(call => call.endpoint.endsWith('/wecom/start')).payload.embedded, false, 'account panel uses a separate native window')
  status.switchingHome = true
  await act(async () => provided.get('sealHarnessAuthClient').refresh())
  assert.match(document.body.textContent, /认证已完成，正在打开此账号的独立工作区/)
  assert.doesNotMatch(document.body.textContent, /正在加载企业微信二维码/)
  status.switchingHome = false
  await act(async () => provided.get('sealHarnessAuthClient').refresh())
  await act(async () => [...document.querySelectorAll('button')].find(button => button.textContent.includes('返回账号登录')).click())
  assert(calls.some(call => call.endpoint.endsWith('/wecom/cancel')))
  await act(async () => document.querySelector('[type=checkbox]').click())
  await act(async () => document.querySelector('[aria-label="企业微信扫码登录"]').click())
  assert.equal(calls.findLast(call => call.endpoint.endsWith('/wecom/start')).payload.remember, false, 'explicit opt-out applies to QR login')
  const cancellations = calls.filter(call => call.endpoint.endsWith('/wecom/cancel')).length
  await act(async () => root.render(null))
  assert.equal(calls.filter(call => call.endpoint.endsWith('/wecom/cancel')).length, cancellations + 1, 'leaving account closes the pending native login')
  status.wecom.enabled = false
  await act(async () => root.render(null))
  await act(async () => root.render(React.createElement(registered.findLast(entry => entry.slot.key === 'seal-harness-identity').component)))
  assert.equal(document.querySelector('[aria-label="企业微信扫码登录"]'), null)
  status.user = { id: 'one', username: 'fixture', displayName: '测试用户' }; status.accountId = 'one'; status.epoch++
  await act(async () => provided.get('sealHarnessAuthClient').refresh())
  assert.equal(reloads, 0, 'external login preserves local workbench')
  await act(async () => provided.get('sealHarnessAuthClient').refresh())
  assert.equal(reloads, 0)
  await act(async () => provided.get('sealHarnessAuthClient').call('refresh'))
  assert.equal(reloads, 0, 'token refresh preserves the current workbench')
  status.epoch++
  await act(async () => provided.get('sealHarnessAuthClient').refresh())
  assert.equal(reloads, 0, 'reauthentication does not reload local state')
  status.accountId = 'two'; status.user = { id: 'two', username: 'other', displayName: '另一用户' }
  await act(async () => provided.get('sealHarnessAuthClient').refresh())
  assert.equal(reloads, 0, 'account subscriptions replace reloads')
  await act(async () => root.render(null))
  disposers.splice(0).forEach(dispose => dispose())
  await act(async () => module.exports.apply(context))
  assert.equal(registered.filter(entry => entry.slot.name === 'root' && !entry.disposed).length, 0, 'restored startup identity enters the workbench without another click')
  // 无有效身份的新启动必须先登录；只有实际确认远端不可达才能主动跳过。
  await act(async () => root.render(null))
  disposers.splice(0).forEach(dispose => dispose())
  status.user = null; status.accountId = null
  module.exports.apply(context)
  const offlineAuth = provided.get('sealHarnessAuthClient')
  const startupGate = registered.findLast(entry => entry.slot.name === 'root')
  await act(async () => root.render(React.createElement(startupGate.component)))
  assert.equal([...document.querySelectorAll('button')].some(button => button.textContent === '跳过登录'), false)
  await act(async () => assert.rejects(offlineAuth.skipLogin(), /请先登录/))
  assert.equal(startupGate.disposed, false)
  server = 'notConfigured'
  await act(async () => offlineAuth.checkAvailability())
  assert([...document.querySelectorAll('button')].some(button => button.textContent === '进入本地工作台'), 'unconfigured product offers an explicit local workspace')
  server = 'reachable'
  hostFailure = true
  await act(async () => offlineAuth.checkAvailability())
  assert.match(document.body.textContent, /Host RPC unavailable/)
  assert.equal([...document.querySelectorAll('button')].some(button => button.textContent === '跳过登录'), false, 'Host errors cannot be mistaken for remote network failure')
  hostFailure = false; server = 'unreachable'
  await act(async () => offlineAuth.checkAvailability())
  const skip = [...document.querySelectorAll('button')].find(button => button.textContent === '跳过登录')
  assert(skip)
  server = 'reachable'
  await act(async () => skip.click())
  assert.equal(startupGate.disposed, false, 'skip rechecks connectivity before releasing startup')
  server = 'unreachable'
  await act(async () => offlineAuth.checkAvailability())
  offlineSwitchRequired = true
  await act(async () => [...document.querySelectorAll('button')].find(button => button.textContent === '跳过登录').click())
  assert.equal(startupGate.disposed, false, 'account Home remains gated until native restart into the neutral Home')
  assert(calls.some(call => call.endpoint.endsWith('/offline')))
  assert.match(document.body.textContent, /正在切换到离线工作区/)
  assert.equal([...document.querySelectorAll('button')].find(button => button.textContent === '跳过登录').disabled, true)
  await act(async () => root.render(null))
  disposers.splice(0).forEach(dispose => dispose())
  module.exports.apply(context)
  const loginHomeAuth = provided.get('sealHarnessAuthClient')
  const loginHomeGate = registered.findLast(entry => entry.slot.name === 'root')
  await act(async () => root.render(React.createElement(loginHomeGate.component)))
  offlineSwitchRequired = false
  await act(async () => loginHomeAuth.checkAvailability())
  await act(async () => [...document.querySelectorAll('button')].find(button => button.textContent === '跳过登录').click())
  assert.equal(loginHomeGate.disposed, true)
  assert.equal(loginHomeAuth.getStatus().user, null)
  server = 'reachable'
  await act(async () => { await loginHomeAuth.checkAvailability(); await loginHomeAuth.refresh() })
  assert.equal(registered.filter(entry => entry.slot.name === 'root' && !entry.disposed).length, 0, 'network recovery does not interrupt offline work')
  loginHomeAuth.openLogin()
  assert.equal(navigated.at(-1), 'seal-harness-identity')
  await act(async () => loginHomeAuth.call('login', { username: 'fixture', password: 'correct' }))
  assert.equal(loginHomeAuth.getStatus().user.username, 'fixture')
  assert.equal(navigated.at(-1), null)
  assert.equal(reloads, 0)
  const restartOffline = async () => {
    await act(async () => root.render(null))
    disposers.splice(0).forEach(dispose => dispose())
    server = 'unreachable'; probeResult = null; restoreResult = null
    Object.assign(status, { user: null, accountId: null, saved: true, restoreError: '连接失败', restoreErrorCode: 'unreachable', sso: { enabled: true, phase: 'idle' }, wecom: { enabled: true, phase: 'idle' } })
    await act(async () => module.exports.apply(context))
    return provided.get('sealHarnessAuthClient')
  }
  const acceptRestore = () => {
    Object.assign(status, { user: { id: 'restored', username: 'restored' }, accountId: 'restored', restoreError: null, restoreErrorCode: null })
    return { ok: true, value: structuredClone(status) }
  }
  let recovery = await restartOffline()
  let releaseProbe
  probeResult = new Promise(resolve => { releaseProbe = resolve })
  let checking
  await act(async () => { checking = recovery.checkAvailability() })
  restoreResult = acceptRestore
  await act(async () => recovery.call('restore'))
  await act(async () => {
    releaseProbe({ ok: true, value: { server: 'unreachable', sso: { enabled: false, phase: 'idle' }, wecom: { enabled: false, phase: 'idle' } } })
    await checking
  })
  assert.equal(recovery.getStatus().user.id, 'restored')
  assert.equal(recovery.getStatus().server, 'reachable', 'late failed probe cannot overwrite successful restore')
  assert.equal(recovery.getStatus().sso.enabled, true, 'late probe does not disable login methods')

  recovery = await restartOffline()
  probeResult = new Promise(resolve => { releaseProbe = resolve })
  await act(async () => { checking = recovery.recover() })
  await act(async () => recovery.call('sso/start', { remember: true }))
  const beforeSsoProbe = calls.filter(call => call.endpoint.endsWith('/restore')).length
  await act(async () => {
    releaseProbe({ ok: true, value: { server: 'reachable', sso: { enabled: true, phase: 'idle' }, wecom: { enabled: true, phase: 'idle' } } })
    await checking
  })
  assert.equal(recovery.getStatus().sso.phase, 'waiting', 'older probe cannot overwrite a newly started SSO transaction')
  assert.equal(calls.filter(call => call.endpoint.endsWith('/restore')).length, beforeSsoProbe)

  recovery = await restartOffline()
  const beforeRestore = calls.filter(call => call.endpoint.endsWith('/restore')).length
  let releaseRestore
  const restoreWait = new Promise(resolve => { releaseRestore = resolve })
  restoreResult = async () => { await restoreWait; return acceptRestore() }
  server = 'reachable'
  let polling
  await act(async () => { polling = poll(); await Promise.resolve(); await Promise.resolve(); await Promise.resolve() })
  assert.equal(recovery.getStatus().restoring, true, 'connectivity recovery automatically retries saved login')
  await act(async () => poll())
  assert.equal(calls.filter(call => call.endpoint.endsWith('/restore')).length, beforeRestore + 1, 'only one restore can be in flight')
  await act(async () => { releaseRestore(); await polling })
  assert.equal(recovery.getStatus().user.id, 'restored')
  assert.equal(recovery.getStatus().restoreError, null)
  assert.equal(recovery.getStatus().restoring, false)
  assert.equal(registered.filter(entry => entry.slot.name === 'root' && !entry.disposed).length, 0)

  recovery = await restartOffline()
  restoreResult = () => {
    status.restoreError = '身份服务暂时无法处理请求'; status.restoreErrorCode = 'serviceError'
    return { ok: false, error: { message: status.restoreError } }
  }
  server = 'reachable'
  await act(async () => poll())
  assert.equal(recovery.getStatus().restoreErrorCode, 'serviceError')
  assert.equal(recovery.getStatus().saved, true)
  restoreResult = acceptRestore
  await act(async () => poll())
  assert.equal(recovery.getStatus().user.id, 'restored', 'transient restore failure retries on the next check')

  for (const action of ['skip', 'login', 'sso/start', 'wecom/start', 'logout', 'expired']) {
    recovery = await restartOffline()
    const before = calls.filter(call => call.endpoint.endsWith('/restore')).length
    if (action === 'skip') await act(async () => recovery.skipLogin())
    else if (action === 'login') await act(async () => assert.rejects(recovery.call('login', { username: 'fixture', password: 'wrong' })))
    else if (action === 'expired') { status.saved = false; status.restoreErrorCode = 'sessionExpired' }
    else await act(async () => recovery.call(action))
    server = 'reachable'; restoreResult = acceptRestore
    await act(async () => { await poll(); await recovery.recover() })
    assert.equal(calls.filter(call => call.endpoint.endsWith('/restore')).length, before, `${action} prevents unsolicited old-account restoration`)
  }
})
