import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { runInNewContext } from 'node:vm'
import { JSDOM } from 'jsdom'
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { Simulate } from 'react-dom/test-utils'

const require = createRequire(import.meta.url)
const profile = (id = 'local') => ({ id, name: id === 'local' ? '本机' : '测试虚拟机', mode: id === 'local' ? 'local' : 'vm', driverPath: '', guestOS: 'linux', host: id === 'local' ? '' : 'vm.example.test', port: 22, username: '', identityFile: '', socket: '' })
const snapshot = () => ({ profiles: [profile(), profile('vm-1')], defaultMode: 'local', backgroundOnly: true, runtime: null })

async function mount(t, api, { component = 'ComputerUsePanel', ...props } = {}) {
  const dom = new JSDOM('<html><head></head><body><div id="app"></div></body></html>')
  dom.window.HTMLElement.prototype.attachEvent = function (name, listener) { this.addEventListener(name.replace(/^on/, ''), listener) }
  dom.window.HTMLElement.prototype.detachEvent = function (name, listener) { this.removeEventListener(name.replace(/^on/, ''), listener) }
  const previous = { window: globalThis.window, document: globalThis.document }
  globalThis.window = dom.window; globalThis.document = dom.window.document; globalThis.IS_REACT_ACT_ENVIRONMENT = true
  const loaded = {}, root = createRoot(document.querySelector('#app'))
  dom.window.__ModuleLoader__ = { load({ factory }) { Object.assign(loaded, factory(require)) } }
  runInNewContext(await readFile(new URL('../lib/client.js', import.meta.url), 'utf8'), { window: dom.window, document: dom.window.document, AbortController })
  let unmounted = false
  const unmount = async () => { if (!unmounted) { unmounted = true; await act(async () => root.unmount()) } }
  t.after(async () => { await unmount(); dom.window.close(); globalThis.window = previous.window; globalThis.document = previous.document; delete globalThis.IS_REACT_ACT_ENVIRONMENT })
  await act(async () => root.render(React.createElement(loaded[component], { api, ...props })))
  return { loaded, root, unmount, async click(label) {
    const button = [...document.querySelectorAll('button')].find(item => (item.getAttribute('aria-label') || item.textContent) === label)
    assert(button, label); assert.equal(button.disabled, false, label); await act(async () => button.click())
  }, async change(label, value) {
    const field = document.querySelector(`[aria-label="${label}"]`); assert(field, label)
    await act(async () => Simulate.change(field, { target: { value } }))
  }, async submit() {
    const form = document.querySelector('.seal-computer-dialog form'); assert(form)
    await act(async () => form.dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true })))
  } }
}

test('management defaults to local and background only, without implicitly starting computer control', async t => {
  const calls = [], panel = await mount(t, async (action, payload) => { calls.push({ action, payload: JSON.parse(JSON.stringify(payload)) }); return snapshot() })
  assert.deepEqual(calls, [{ action: 'snapshot', payload: {} }])
  assert.equal(document.querySelector('[data-target-id="local"]').getAttribute('aria-current'), 'page')
  assert.equal(document.querySelector('.seal-computer-detail h2').textContent, '本机')
  assert.match(document.body.textContent, /不抢鼠标.*不支持后台的动作会拒绝/)
  assert.match(document.body.textContent, /请先打开一个会话/)
  assert.equal(document.querySelector('input[type="checkbox"]'), null)
  assert.equal([...document.querySelectorAll('button')].some(item => item.textContent === '启用电脑操作'), false)
  await panel.click('选择 测试虚拟机')
  assert.match(document.querySelector('.seal-computer-detail').textContent, /vm.example.test:22/)
  assert.equal(calls.length, 1)
})

test('VM profiles save SSH settings with failed drafts retained and Windows desktop guidance', async t => {
  const calls = []; let fail = true
  const panel = await mount(t, async (action, payload) => {
    calls.push({ action, payload: JSON.parse(JSON.stringify(payload)) })
    if (action === 'snapshot') return snapshot()
    if (action === 'save') { if (fail) throw Error('地址无效，请修正'); return { profile: { ...payload.profile, id: 'new-vm' } } }
  })
  await panel.click('添加虚拟机'); await panel.change('目标名称', 'Windows桌面'); await panel.change('来宾系统', 'win32')
  assert.match(document.querySelector('[role="dialog"]').textContent, /同一 Windows 账号.*Session 0/)
  assert.equal(document.querySelector('[aria-label="桌面服务端点"]').value, '\\\\.\\pipe\\cua-driver')
  await panel.change('SSH 地址', 'vm.example.test'); await panel.change('SSH 用户名', 'user'); await panel.change('SSH 端口', '2222')
  await panel.submit()
  assert.match(document.querySelector('[role="alert"]').textContent, /地址无效/)
  assert.equal(document.querySelector('[aria-label="目标名称"]').value, 'Windows桌面')
  fail = false; await panel.submit()
  const saved = calls.filter(item => item.action === 'save').at(-1).payload.profile
  assert.equal(saved.mode, 'vm'); assert.equal(saved.port, 2222); assert.equal(saved.username, 'user')
  assert.equal(Object.hasOwn(saved, 'password'), false)
  assert.equal(document.querySelector('[role="dialog"]'), null)
  assert.equal(document.querySelector('[data-target-id="new-vm"]').getAttribute('aria-current'), 'page')
})

test('local target cannot be deleted; VM delete requires confirmation and errors remain retryable', async t => {
  let deletes = 0, fail = true
  const panel = await mount(t, async action => {
    if (action === 'snapshot') return snapshot()
    if (action === 'delete') { deletes++; if (fail) throw Error('请先停止这个目标'); return { deleted: true } }
  })
  assert.equal([...document.querySelectorAll('button')].some(item => item.textContent === '删除目标'), false)
  await panel.click('本机设置'); assert.equal(document.querySelector('[aria-label="SSH 地址"]'), null)
  await panel.click('取消'); await panel.click('选择 测试虚拟机'); await panel.click('删除目标'); await panel.click('取消')
  assert.equal(deletes, 0)
  await panel.click('删除目标'); await panel.click('确认删除'); assert.match(document.querySelector('[role="alert"]').textContent, /请先停止/)
  fail = false; await panel.click('确认删除')
  assert.equal(deletes, 2); assert.equal(document.querySelector('[data-target-id="vm-1"]'), null)
  assert.equal(document.querySelector('[data-target-id="local"]').getAttribute('aria-current'), 'page')
})

test('connection diagnostics never start a desktop session or claim ready from a missing driver', async t => {
  const calls = []
  const panel = await mount(t, async (action, payload) => { calls.push({ action, payload }); return action === 'snapshot' ? snapshot() : { available: false, reason: '未找到驱动，请检查设置。' } })
  await panel.click('检查连接')
  assert.match(document.querySelector('.seal-computer-diagnostic').textContent, /尚不可用.*未找到驱动/)
  assert.deepEqual(calls.map(item => item.action), ['snapshot', 'check'])
})

test('settings content starts the current session on local in background and can stop it', async t => {
  const calls = [], runtime = { targetId: 'local', targetName: '本机', mode: 'local', status: 'running', sessionId: 'session', backgroundOnly: true }
  const panel = await mount(t, async (action, payload) => {
    calls.push({ action, payload: JSON.parse(JSON.stringify(payload)) })
    if (action === 'snapshot') return snapshot()
    if (action === 'start') return { runtime }
    return { stopped: true }
  }, { sessionId: 'session', sessionTitle: '设置测试会话' })
  assert.deepEqual(calls[0].payload, { sessionId: 'session' })
  assert.match(document.body.textContent, /当前会话：设置测试会话/)
  await panel.click('启用电脑操作')
  assert.deepEqual(calls.find(item => item.action === 'start').payload, { sessionId: 'session', id: 'local' })
  assert.match(document.querySelector('.seal-computer-runtime').textContent, /本机 · 运行中/)
  await panel.click('停止电脑操作')
  assert.equal(calls.filter(item => item.action === 'start').length, 1)
  assert.deepEqual(calls.find(item => item.action === 'stop').payload, { sessionId: 'session' })
})

test('unmount cancels an in-flight check and ignores late results without stopping unrelated sessions', async t => {
  let finish, signal
  const calls = [], panel = await mount(t, async (action, _payload, active) => {
    calls.push(action)
    if (action === 'snapshot') return snapshot()
    if (action === 'check') { signal = active; return new Promise(resolve => { finish = resolve }) }
  })
  await panel.click('检查连接'); await panel.unmount()
  assert.equal(signal.aborted, true)
  await act(async () => finish({ available: true }))
  assert.equal(document.querySelector('.seal-computer-page'), null)
  assert.deepEqual(calls, ['snapshot', 'check'])
})

test('only settings registers a menu and derives the active session from the public root selector', async t => {
  const panel = await mount(t, async () => snapshot())
  const slots = [], effects = [], calls = []
  const auth = { user: { id: 'alice' }, accountId: 'alice', epoch: 1 }
  const ctx = { connection: { rpc: { async call(_base, method, payload) { calls.push({ method, payload: JSON.parse(JSON.stringify(payload)) }); return { ok: true, value: snapshot() } } } },
    sealHarnessAuthClient: { getStatus: () => auth, subscribe: () => () => {} },
    effect(callback) { const dispose = callback(); effects.push(dispose); return dispose },
    slots: { inject(name, callback) { assert.equal(name, 'settings.section'); callback() }, register(definition, Component) { slots.push({ definition, Component }); return () => {} } },
  }
  panel.loaded.apply(ctx)
  assert.deepEqual(slots.map(item => item.definition.name), ['settings.section'])
  assert.equal(slots[0].definition.label(), '电脑操作')
  assert.equal(panel.loaded.ComputerUseSelector, undefined)
  const section = slots[0].Component
  const byId = { other: { id: 'other', title: '未选中的会话', retainedBy: { mainView: 0 } }, active: { id: 'active', title: '当前会话名称', retainedBy: { mainView: 1 } } }
  const useSessions = selector => selector({ byId })
  await act(async () => panel.root.render(React.createElement(section, { useSessions })))
  assert.deepEqual(calls.at(-1).payload, { sessionId: 'active' })
  assert.match(document.body.textContent, /当前会话：当前会话名称/)
  byId.active.retainedBy.mainView = 0
  await act(async () => panel.root.render(React.createElement(section, { useSessions })))
  assert.deepEqual(calls.at(-1).payload, {})
  assert.match(document.body.textContent, /请先打开一个会话/)
  for (const dispose of effects.reverse()) dispose?.()
})
