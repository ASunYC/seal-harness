import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { runInNewContext } from 'node:vm'
import { JSDOM } from 'jsdom'
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { Simulate } from 'react-dom/test-utils'

const require = createRequire(import.meta.url)
const copy = value => JSON.parse(JSON.stringify(value))
const host = (id, protocol = 'ssh') => ({ id, name: `${protocol.toUpperCase()}服务器`, config: { protocol, host: id === 'ipv6' ? '::1' : `${id}.example.test`, port: { ssh: 22, rdp: 3389, vnc: 5900 }[protocol], username: protocol === 'ssh' ? 'alice' : '', identityFile: '', clientPath: '' }, createdAt: 1, updatedAt: 1 })
const snapshot = hosts => ({ hosts, platform: 'win32', clients: { ssh: { available: true }, rdp: { available: true }, vnc: { available: false, reason: '请安装 TigerVNC 或指定客户端绝对路径。' } } })

async function mountPanel(t, api) {
  const dom = new JSDOM('<html><head></head><body><div id="app"></div></body></html>')
  // React 在测试DOM建立前已加载，会选择旧input事件分支；补齐仅JSDOM缺少的监听接口。
  dom.window.HTMLElement.prototype.attachEvent = function (name, listener) { this.addEventListener(name.replace(/^on/, ''), listener) }
  dom.window.HTMLElement.prototype.detachEvent = function (name, listener) { this.removeEventListener(name.replace(/^on/, ''), listener) }
  const previous = { window: globalThis.window, document: globalThis.document }
  globalThis.window = dom.window; globalThis.document = dom.window.document; globalThis.IS_REACT_ACT_ENVIRONMENT = true
  const loaded = {}, root = createRoot(document.querySelector('#app'))
  runInNewContext(await readFile(new URL('../lib/client.js', import.meta.url), 'utf8'), {
    window: { __ModuleLoader__: { load({ factory }) { Object.assign(loaded, factory(require)) } } }, document: dom.window.document, AbortController,
  })
  let unmounted = false
  const unmount = async () => { if (!unmounted) { unmounted = true; await act(async () => root.unmount()) } }
  t.after(async () => {
    await unmount(); dom.window.close(); globalThis.window = previous.window; globalThis.document = previous.document
    delete globalThis.IS_REACT_ACT_ENVIRONMENT
  })
  await act(async () => root.render(React.createElement(loaded.RemoteDesktopPanel, { api })))
  return { dom, unmount, async click(label) {
    const button = [...document.querySelectorAll('button')].find(item => (item.getAttribute('aria-label') || item.textContent) === label)
    assert(button, `missing button: ${label}`); assert.equal(button.disabled, false, label)
    await act(async () => button.click())
  }, async change(label, value) {
    const field = document.querySelector(`[aria-label="${label}"]`)
    assert(field, label)
    await act(async () => Simulate.change(field, { target: { value } }))
  }, async submit() {
    const form = document.querySelector('.seal-remote-form'); assert(form)
    await act(async () => form.dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true })))
  } }
}

test('multi-host page lists clients, searches and filters without connecting or reading a local screen', async t => {
  const calls = []
  const panel = await mountPanel(t, async (action, payload) => { calls.push({ action, payload }); return snapshot([host('linux'), host('windows', 'rdp'), host('ipv6', 'vnc')]) })
  assert.deepEqual(calls.map(item => item.action), ['snapshot'])
  assert.equal(document.querySelector('h1').textContent, '远程主机')
  assert.equal(document.querySelectorAll('[data-host-id]').length, 3)
  assert.match(document.body.textContent, /TigerVNC/)
  assert.match(document.body.textContent, /\[::1\]:5900/)
  assert.equal(document.querySelector('img'), null)
  assert.doesNotMatch(document.body.textContent, /本机桌面|主屏幕|允许鼠标|手机/)
  await panel.change('搜索主机', 'alice')
  assert.equal(document.querySelectorAll('[data-host-id]').length, 1)
  await panel.change('搜索主机', '')
  await panel.change('筛选协议', 'rdp')
  assert.equal(document.querySelector('[data-host-id]').dataset.hostId, 'windows')
  await panel.change('搜索主机', 'unknown')
  assert.match(document.body.textContent, /没有匹配的主机/)
  assert.deepEqual(calls.map(item => item.action), ['snapshot'])
})

test('form creates and edits protocol profiles, preserves failed drafts and invalidates old checks', async t => {
  const calls = [], existing = host('linux'); let failing = true
  const panel = await mountPanel(t, async (action, payload) => {
    calls.push({ action, payload: copy(payload) })
    if (action === 'snapshot') return snapshot([existing])
    if (action === 'check') return { client: { available: true }, network: { reachable: true }, checkedAt: 1 }
    if (action === 'save') { if (failing) throw Error('地址未通过检查'); return { host: { id: payload.id ?? 'created', ...copy(payload) } } }
  })
  await panel.click('检查 SSH服务器')
  assert.match(document.querySelector('.seal-remote-check').textContent, /端口可达不代表/)
  await panel.click('编辑 SSH服务器')
  await panel.change('主机名称', '开发机')
  await panel.change('服务器地址', 'dev.example.test')
  await panel.change('私钥文件', 'C:\\keys\\id_ed25519')
  await panel.submit()
  assert.equal(document.querySelector('[aria-label="主机名称"]').value, '开发机')
  assert.match(document.querySelector('[role="alert"]').textContent, /地址未通过检查/)
  failing = false; await panel.submit()
  assert.equal(document.querySelector('[role="dialog"]'), null)
  assert.match(document.body.textContent, /dev.example.test:22/)
  assert.equal(document.querySelector('.seal-remote-check'), null)
  assert.equal(calls.filter(item => item.action === 'save').at(-1).payload.config.identityFile, 'C:\\keys\\id_ed25519')
  await panel.click('添加主机')
  await panel.change('连接协议', 'rdp')
  assert.equal(document.querySelector('[aria-label="端口"]').value, '3389')
  assert.equal(document.querySelector('[aria-label="私钥文件"]'), null)
  assert.equal(document.querySelector('[aria-label="用户名"]'), null, 'Windows mstsc asks username in native login')
  await panel.change('连接协议', 'vnc')
  assert.equal(document.querySelector('[aria-label="端口"]').value, '5900')
  await panel.change('主机名称', '图形服务器')
  await panel.change('服务器地址', 'vnc.example.test')
  await panel.change('客户端程序', 'C:\\Program Files\\TigerVNC\\vncviewer.exe')
  await panel.submit()
  const config = calls.filter(item => item.action === 'save').at(-1).payload.config
  assert.deepEqual(config, { protocol: 'vnc', host: 'vnc.example.test', port: 5900, username: '', identityFile: '', clientPath: 'C:\\Program Files\\TigerVNC\\vncviewer.exe' })
  assert.equal(document.querySelectorAll('[data-host-id]').length, 2)
  assert.equal(document.querySelector('input[type="password"]'), null)
})

test('check distinguishes missing clients from network reachability and connect only claims launch', async t => {
  const calls = []
  const panel = await mountPanel(t, async (action, payload) => {
    calls.push({ action, payload })
    if (action === 'snapshot') return snapshot([host('vnc', 'vnc')])
    if (action === 'check') return { client: { available: false, reason: '请安装 TigerVNC' }, network: { reachable: true }, checkedAt: 1 }
    if (action === 'connect') return { launched: true, client: 'TigerVNC', hostId: payload.id, message: '客户端已启动，请在客户端窗口完成登录。' }
  })
  await panel.click('检查 VNC服务器')
  const result = document.querySelector('.seal-remote-check').textContent
  assert.match(result, /客户端：不可用/); assert.match(result, /网络：端口可达/); assert.match(result, /请安装 TigerVNC/)
  await panel.click('连接 VNC服务器')
  assert.match(document.querySelector('.seal-remote-notice').textContent, /客户端已启动/)
  assert.doesNotMatch(document.querySelector('.seal-remote-notice').textContent, /已连接|登录成功/)
  await panel.unmount()
  assert.deepEqual(calls.map(item => item.action), ['snapshot', 'check', 'connect'], 'leaving must not disconnect native windows')
})

test('delete requires confirmation, cancellation is inert and failed delete remains retryable', async t => {
  const calls = []; let fail = true
  const panel = await mountPanel(t, async (action, payload) => {
    calls.push({ action, payload })
    if (action === 'snapshot') return snapshot([host('linux')])
    if (action === 'delete' && fail) throw Error('删除失败，请重试')
    return { deleted: true }
  })
  await panel.click('删除 SSH服务器')
  assert.equal(calls.length, 1)
  await panel.click('取消')
  assert.equal(document.querySelector('[role="dialog"]'), null)
  await panel.click('删除 SSH服务器'); await panel.click('确认删除')
  assert.match(document.querySelector('[role="alert"]').textContent, /删除失败/)
  assert(document.querySelector('[data-host-id="linux"]'))
  fail = false; await panel.click('确认删除')
  assert.equal(document.querySelector('[role="dialog"]'), null)
  assert.equal(document.querySelectorAll('[data-host-id]').length, 0)
  assert.match(document.body.textContent, /添加第一台远程主机/)
})

test('unmount cancels an in-flight check and ignores its late result', async t => {
  let settle, signal
  const panel = await mountPanel(t, async (action, payload, requestSignal) => {
    if (action === 'snapshot') return snapshot([host('linux')])
    if (action === 'check') { signal = requestSignal; return new Promise(resolve => { settle = resolve }) }
  })
  await panel.click('检查 SSH服务器')
  assert.equal(document.querySelector('[aria-label="编辑 SSH服务器"]').disabled, true, 'do not allow a checked config to be edited while pending')
  await panel.unmount(); assert.equal(signal.aborted, true)
  await act(async () => settle({ client: { available: true }, network: { reachable: true } }))
  assert.equal(document.querySelector('#app').textContent, '')
})

test('initial load failure can be retried and empty state still allows adding a host', async t => {
  let fail = true
  const panel = await mountPanel(t, async () => { if (fail) throw Error('读取失败'); return snapshot([]) })
  assert.match(document.querySelector('[role="alert"]').textContent, /读取失败/)
  fail = false; await panel.click('刷新主机列表')
  assert.equal(document.querySelector('[role="alert"]'), null)
  await panel.click('添加主机')
  assert.equal(document.querySelector('[role="dialog"]').getAttribute('aria-label'), '添加主机')
  await act(async () => document.querySelector('[role="dialog"]').dispatchEvent(new panel.dom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true })))
  assert.equal(document.querySelector('[role="dialog"]'), null)
})

test('client registers remote hosts as the existing independently primary panel with late navigation', async () => {
  const dom = new JSDOM('<html><head></head><body></body></html>'), loaded = {}, registrations = [], effects = []
  let injectNavigation
  runInNewContext(await readFile(new URL('../lib/client.js', import.meta.url), 'utf8'), { window: { __ModuleLoader__: { load({ factory }) { Object.assign(loaded, factory(require)) } } }, document: dom.window.document })
  loaded.apply({ connection: {}, effect(callback) { effects.push(callback()) }, inject(names, callback) { assert.deepEqual(Array.from(names), ['sealHarnessNavigation']); injectNavigation = callback } })
  injectNavigation({ effect(callback) { effects.push(callback()) }, sealHarnessNavigation: { register(value) { registrations.push(value); return () => registrations.pop() } } })
  assert.deepEqual(copy({ id: registrations[0].id, label: registrations[0].label, primary: registrations[0].primary, order: registrations[0].order }), { id: 'remote-desktop', label: '远程主机', primary: true, order: 120 })
  for (const dispose of effects) dispose?.()
  assert.equal(registrations.length, 0); assert.equal(dom.window.document.querySelectorAll('style').length, 0)
  dom.window.close()
})
