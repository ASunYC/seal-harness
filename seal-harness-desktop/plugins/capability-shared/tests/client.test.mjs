import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { runInNewContext } from 'node:vm'
import { JSDOM } from 'jsdom'
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'

const require = createRequire(import.meta.url)

test('连接器和知识库内容容器沿用专家页左右留白', () => {
  const cases = [
    ['专家', '../../experts/src/styles.js', 'experts-page__content'],
    ['连接器', '../../connectors/src/styles.js', 'capability-page__content'],
    ['知识库', '../../knowledge/src/source-styles.js', 'zz-knowledge \\.library-page__content'],
  ]
  for (const [name, path, className] of cases) {
    const css = readFileSync(new URL(path, import.meta.url), 'utf8')
    const rule = css.match(new RegExp(`\\.${className}\\s*\\{([^}]*)\\}`))?.[1] ?? ''
    assert.match(rule, /max-width:\s*1740px/, name)
    assert.match(rule, /padding:\s*var\(--sp-5\) var\(--sp-6\) var\(--sp-7\)/, name)
  }
})

test('built clients register independent panels, preserve resource installation and account state, and unload independently', async t => {
  const dom = new JSDOM('<!doctype html><html><head></head><body><main></main></body></html>')
  const oldWindow = globalThis.window, oldDocument = globalThis.document
  globalThis.window = dom.window
  globalThis.document = dom.window.document
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  dom.window.HTMLDialogElement.prototype.showModal = function () { this.open = true }
  dom.window.HTMLDialogElement.prototype.close = function () { this.open = false }
  const registered = [], disposers = new Map(), calls = []
  const plugins = new Map()
  for (const name of ['store', 'connectors', 'skills', 'experts']) {
    runInNewContext(readFileSync(new URL(`../../${name}/lib/client.js`, import.meta.url), 'utf8'), {
      window: { __ModuleLoader__: { load: ({ id, factory }) => { assert.equal(id, `@seal-harness/${name}`); plugins.set(name, factory(require)) } } },
      document: dom.window.document, atob, AbortController, setTimeout, clearTimeout,
    })
  }
  let status = { user: null, accountId: null, epoch: 0 }
  let loginOpened = false
  let selectedPanel = undefined
  let installationUnavailable = false
  const authListeners = new Set()
  const workspaceSnapshot = { items: [] }
  const asset = { id: 'fixture-skill', name: '契约技能', summary: '本地测试目录', tags: [], versions: [{ version: '1.2.3', status: 'published' }] }
  const mount = name => {
    const cleanups = []
    disposers.set(name, cleanups)
    plugins.get(name).apply({
      sealHarnessAuthClient: {
        getStatus: () => status,
        subscribe: listener => { authListeners.add(listener); return () => authListeners.delete(listener) },
        openLogin: () => { loginOpened = true },
      },
      layout: { selectPanel: panel => { selectedPanel = panel } },
      workspaces: { list: { getSnapshot: () => workspaceSnapshot, subscribe: () => () => {} } },
      effect: callback => cleanups.push(callback()),
      slots: { inject: (_, callback) => callback(), register: (slot, component) => {
        const item = { slot, component, owner: name }
        registered.push(item)
        cleanups.push(() => registered.splice(registered.indexOf(item), 1))
      } },
      connection: { rpc: { call: async (channel, endpoint, payload) => {
        assert.equal(channel, '/api'); assert(endpoint.startsWith('seal-harness-capabilities/')); endpoint = endpoint.slice('seal-harness-capabilities/'.length); calls.push({ endpoint, payload })
        if (endpoint === 'skills/install' && installationUnavailable) throw new Error('技能插件已卸载，无法安装。')
        const value = endpoint === 'store/list' ? [asset] : endpoint === 'store/detail' ? asset
          : endpoint === 'skills/list' ? { revision: 0, skills: [] }
            : endpoint === 'skills/sources' ? { sources: [] } : { items: [] }
        return { ok: true, value }
      } } },
    })
  }
  const unmount = name => {
    for (const dispose of disposers.get(name) ?? []) dispose?.()
    disposers.delete(name)
  }
  for (const name of plugins.keys()) mount(name)
  assert.equal(document.querySelectorAll('style').length, 3)
  const panels = registered.filter(item => item.slot.name === 'main')
  assert.deepEqual(panels.map(item => item.slot.key), ['seal-harness-connectors', 'seal-harness-skills', 'seal-harness-experts'])
  const sidebarPanels = registered.filter(item => item.slot.name === 'sidebar.panellist')
  assert.equal(sidebarPanels.length, 3)
  assert.deepEqual(sidebarPanels.map(item => [item.slot.id, item.slot.order]), [
    ['seal-harness-connectors', 50],
    ['seal-harness-skills', 30],
    ['seal-harness-experts', 20],
  ])
  assert.equal(registered.some(item => item.owner === 'store'), false, 'store retains services without standalone navigation')
  const root = createRoot(document.querySelector('main'))
  t.after(async () => {
    await act(async () => root.unmount())
    for (const name of disposers.keys()) unmount(name)
    assert.equal(dom.window.document.querySelectorAll('style').length, 0)
    dom.window.close(); globalThis.window = oldWindow; globalThis.document = oldDocument
    delete globalThis.IS_REACT_ACT_ENVIRONMENT
  })
  for (const [entry, iconName] of sidebarPanels.map(entry => [entry, ({ connectors: 'connectors', skills: 'store', experts: 'agents' })[entry.owner]])) {
    await act(async () => root.render(React.createElement('button', null, React.createElement(entry.component, { size: 18 }))))
    assert.equal(document.querySelector('[data-sidebar-icon-name]')?.getAttribute('data-sidebar-icon-name'), iconName)
  }
  const click = async text => {
    const button = [...document.querySelectorAll('button')].find(button => button.textContent === text || button.getAttribute('aria-label') === text)
    assert(button, `missing button ${text}`)
    await act(async () => button.click())
  }
  await act(async () => root.render(React.createElement(panels.find(item => item.owner === 'skills').component)))
  assert.match(document.body.textContent, /登录/)
  await click('返回会话，离开技能页')
  assert.equal(selectedPanel, null)
  assert.equal(calls.length, 0, 'signed-out skills catalog does not request cloud content')
  await click('去登录')
  assert.equal(loginOpened, true)
  await act(async () => {
    status = { user: { name: '测试用户' }, accountId: 'account-a', epoch: 1 }
    authListeners.forEach(listener => listener())
  })
  assert.match(document.body.textContent, /契约技能/)
  await click('查看 契约技能 详情')
  await click('安装此版本')
  assert(calls.some(call => call.endpoint === 'skills/install'), 'install starts directly from the user action')
  const installation = calls.find(call => call.endpoint === 'skills/install')
  assert.deepEqual(JSON.parse(JSON.stringify(installation.payload)), { id: 'fixture-skill', version: '1.2.3' })
  await click('查看 契约技能 详情')
  installationUnavailable = true
  await click('安装此版本')
  assert.match(document.querySelector('[role=status]').textContent, /技能插件已卸载，无法安装/)
  assert.doesNotMatch(document.body.textContent, /已安装。/)
  await click('关闭能力详情')
  await click('刷新')
  assert.match(document.body.textContent, /契约技能/, 'store browsing survives an unavailable installer')
  await click('查看 契约技能 详情')
  installationUnavailable = false
  const loadsBeforeChange = calls.filter(call => call.endpoint === 'store/list').length
  await act(async () => {
    status = { ...status, epoch: 2 }
    authListeners.forEach(listener => listener())
  })
  assert.equal(document.querySelector('[aria-label="能力详情"]'), null, 'new identity epoch clears old details')
  assert.equal(calls.filter(call => call.endpoint === 'store/list').length, loadsBeforeChange + 1)
  await act(async () => {
    status = { user: null, accountId: null, epoch: 3 }
    authListeners.forEach(listener => listener())
  })
  assert.match(document.body.textContent, /登录/)
  const cloudCalls = calls.filter(call => call.endpoint.startsWith('store/')).length
  for (const { component, owner } of panels) {
    await act(async () => root.render(React.createElement(component)))
    assert.equal(document.querySelector('[role=alert]'), null)
    assert(document.querySelector('button'))
    if (owner === 'skills') {
      await click('个人')
      await click('本地 Skill')
    }
  }
  assert(calls.some(call => call.endpoint === 'connectors/list'))
  assert(calls.some(call => call.endpoint === 'skills/sources'))
  assert(calls.some(call => call.endpoint === 'experts/list'))
  assert.equal(calls.filter(call => call.endpoint.startsWith('store/')).length, cloudCalls, 'local panels do not request the cloud store')
  for (const owner of ['connectors', 'experts']) {
    const panel = panels.find(item => item.owner === owner)
    await act(async () => root.render(React.createElement(panel.component)))
    const beforeLogin = calls.filter(call => call.endpoint === 'store/list').length
    await act(async () => {
      status = { user: { name: '测试用户' }, accountId: 'account-a', epoch: status.epoch + 1 }
      authListeners.forEach(listener => listener())
    })
    assert.equal(calls.filter(call => call.endpoint === 'store/list').length, beforeLogin + 1, `${owner} automatically loads its catalog after login`)
    await click(owner === 'connectors' ? '查看详情' : '查看与安装')
    assert(document.querySelector('dialog[open]'), `${owner} opens its public detail`)
    await act(async () => {
      status = { ...status, accountId: 'account-b', epoch: status.epoch + 1 }
      authListeners.forEach(listener => listener())
    })
    assert.equal(calls.filter(call => call.endpoint === 'store/list').length, beforeLogin + 2, `${owner} reloads its catalog for the new identity`)
    assert.equal(document.querySelector('dialog[open]'), null, `${owner} clears old details after identity changes`)
    await act(async () => {
      status = { user: null, accountId: null, epoch: status.epoch + 1 }
      authListeners.forEach(listener => listener())
    })
    assert.equal(calls.filter(call => call.endpoint === 'store/list').length, beforeLogin + 2, `${owner} avoids cloud requests after logout`)
    assert.doesNotMatch(document.body.textContent, /契约技能/, `${owner} clears the previous account catalog`)
  }
  await act(async () => root.render(null))
  for (const name of plugins.keys()) {
    unmount(name)
    const remainingPanels = name === 'store' ? 3 : 2
    assert.equal(document.querySelectorAll('style').length, remainingPanels, `${name} removes only its style`)
    assert.equal(registered.filter(item => item.slot.name === 'main').length, remainingPanels)
    for (const panel of registered.filter(item => item.slot.name === 'main')) {
      await act(async () => root.render(React.createElement(panel.component)))
      assert.equal(document.querySelector('[role=alert]'), null, `${panel.owner} remains usable`)
    }
    await act(async () => root.render(null))
    mount(name)
    assert.equal(document.querySelectorAll('style').length, 3)
    const reloaded = registered.find(item => item.owner === name && item.slot.name === 'main')
    if (name === 'store') assert.equal(reloaded, undefined)
    else {
      await act(async () => root.render(React.createElement(reloaded.component)))
      assert.equal(document.querySelector('[role=alert]'), null)
    }
    await act(async () => root.render(null))
  }
  assert.equal(authListeners.size, 0, 'unmounted panels release identity subscriptions')
})
