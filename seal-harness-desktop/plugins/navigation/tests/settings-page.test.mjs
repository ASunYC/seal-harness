import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { runInNewContext } from 'node:vm'
import { Context } from '@deepseek-ai/cordis'
import React, { act, useSyncExternalStore } from 'react'
import { createRoot } from 'react-dom/client'
import { JSDOM } from 'jsdom'

const require = createRequire(import.meta.url)
const PANEL = 'seal-harness-settings'

// 发布版client-store在Node缺少浏览器开发依赖；此适配器执行原生shell自己的init/action声明，
// 不复制其状态行为，也不放宽slot登记校验。下方使用真实Cordis及SlotRegistry。
function observable(initial) {
  let value = initial
  const listeners = new Set()
  return {
    getSnapshot: () => value,
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener) },
    set(next) { if (Object.is(value, next)) return; value = next; for (const listener of listeners) listener() },
    update(mutate) { const next = { ...value }; mutate(next); this.set(next) },
  }
}
const stores = {
  createSnapshotStore: observable,
  defineStore(spec) { return { spec, create() {
    const source = observable(spec.init())
    return { ...source, store: source, actions: Object.fromEntries(Object.entries(spec.actions).map(([name, mutate]) => [name, (...args) => source.update(draft => mutate(draft, ...args))])) }
  } } },
}
function primitive(name) {
  if (name === 'useModalLayer' || name === 'closeTopModal') return () => {}
  if (name === 'Tooltip') return ({ children }) => children
  if (name.startsWith('Icon')) return props => React.createElement('svg', { 'aria-hidden': true, ...props })
  if (name === 'ConnectionIndicator') return () => React.createElement('span', { 'data-native-connection': true })
  return ({ children }) => React.createElement('span', null, children)
}
const primitives = new Proxy({}, { get: (_target, name) => primitive(String(name)) })

async function loadClient(file, dom, aliases = {}) {
  let loaded
  dom.window.__ModuleLoader__ = { load({ factory }) { loaded = factory(name => Object.hasOwn(aliases, name) ? aliases[name] : require(name)) } }
  runInNewContext(await readFile(file, 'utf8'), { window: dom.window, document: dom.window.document,
    navigator: dom.window.navigator, console, queueMicrotask, setTimeout, clearTimeout })
  return loaded
}

async function fixture(t, { presenter = true, nativeInitially = true } = {}) {
  const dom = new JSDOM('<html><head></head><body><div id="root"></div></body></html>')
  const previous = { window: globalThis.window, document: globalThis.document }
  globalThis.window = dom.window; globalThis.document = dom.window.document; globalThis.IS_REACT_ACT_ENVIRONMENT = true
  const client = await loadClient(new URL('../lib/client.js', import.meta.url), dom)
  assert.equal(typeof client.apply, 'function')
  const renderer = await loadClient(require.resolve('@deepseek-ai/dsh-client-ui-renderer/client'), dom)
  const native = await loadClient(require.resolve('@deepseek-ai/dsh-client-ui-settings-general/client'), dom, {
    '@deepseek-ai/dsh-client-store': stores, '@deepseek-ai/dsh-client-ui-primitives': primitives,
  })
  const ctx = new Context(), panelInfo = observable({ activePanelId: null }), visits = []
  const layout = { panelInfo, selectPanel(id) { visits.push(id); panelInfo.set({ activePanelId: id }) } }
  ctx.provide('layout', layout)
  ctx.provide('sessions', { list: observable({ byId: {} }) })
  await ctx.plugin({ apply(inner) { new renderer.SlotRegistry(inner) } }).await()
  ctx.slots.register({ name: 'root', children: {
    'sidebar.settings': { kind: 'single', scope: 'root' }, main: { kind: 'keyed', scope: 'root' },
    'sidebar.toggle.badge': { kind: 'single', scope: 'root' }, 'shell.overlay': { kind: 'list', scope: 'root' },
  } }, () => null)
  const commands = new Map(), locale = observable({ revision: 1 }), sections = new Map(), entryViews = new WeakMap(), instances = new WeakMap()
  const dictionary = { trigger: '设置', title: '设置', close: '关闭设置', 'general.nav': '通用设置' }
  const translate = key => dictionary[key] ?? key
  ctx.provide('locale', { ...locale, bind: () => translate, register() { return () => {} } })
  ctx.provide('connection', { state: observable('connected'), reconnect() {} })
  ctx.provide('remote', { $host: { isLoopback: false } })
  ctx.provide('remote.settings', {})
  ctx.provide('modules', { entries: { releaseChange: observable(undefined), dismissRelease() {} } })
  ctx.provide('configForms', { developerTools: { enabled: observable(false) } })
  ctx.provide('shortcuts', { catalog: observable([]), register(command) { commands.set(command.id, command); return () => commands.delete(command.id) } })
  let nativeFiber, productFiber, headerActions = 0, saves = 0
  const root = createRoot(document.querySelector('#root'))
  const usePanelInfo = selector => useSyncExternalStore(panelInfo.subscribe, () => selector(panelInfo.getSnapshot()))
  const useSessions = selector => selector({ phase: 'ready', byId: { session: { id: 'session', blank: false, retainedBy: { mainView: 1 } } } })
  const hooks = source => selector => useSyncExternalStore(source.subscribe, () => selector(source.getSnapshot()))
  function View({ entry, owner }) {
    // 业务表单是占位fixture；此处只验证真实原生shell的分类、授权回调及生命周期。
    if (entry.children?.['settings.general.item']) return React.createElement('div', { 'data-section-form': 'general' },
      React.createElement('span', null, '通用设置'), React.createElement('button', { onClick: () => saves++ }, '保存此项'),
      React.createElement('button', { onClick: owner.close }, '完成并关闭'))
    let instance
    if (entry.store) {
      instance = instances.get(entry.store)
      if (!instance) { instance = entry.store.create(); instances.set(entry.store, instance) }
    }
    const business = entry.inject?.() ?? {}, hookProps = Object.fromEntries(Object.entries(business.hooks ?? {}).map(([name, source]) => [`use${name[0].toUpperCase()}${name.slice(1)}`, hooks(source)]))
    const { hooks: _hooks, ...injected } = business
    return React.createElement(entry.component, { wide: true, usePanelInfo, useSessions, t: translate,
      ...owner, ...injected, ...hookProps, ...(instance ? { useStore: hooks(instance), actions: instance.actions } : {}),
      renderSlot: (name, nextOwner = {}, options = {}) => {
        assert.ok(entry.children?.[name], `native entry owns child ${name}`)
        const candidates = ctx.slots.entries(name).filter(candidate => options.only === undefined || candidate.options.id === options.only)
        if (!candidates.length) return options.fallback ?? null
        const chosen = candidates[0]
        return renderEntry(chosen, nextOwner)
      },
    })
  }
  function renderEntry(entry, owner = {}) {
    let Component = entryViews.get(entry)
    if (!Component) { Component = props => React.createElement(View, { entry, owner: props.owner }); entryViews.set(entry, Component) }
    return React.createElement(Component, { owner })
  }
  function App() {
    const current = usePanelInfo(state => state.activePanelId)
    useSyncExternalStore(listener => ctx.slots.subscribe('sidebar.settings', listener), () => ctx.slots.getVersion('sidebar.settings'))
    useSyncExternalStore(listener => ctx.slots.subscribe('main', listener), () => ctx.slots.getVersion('main'))
    const nativeEntry = ctx.slots.entries('sidebar.settings')[0]
    const main = ctx.slots.entries('main').find(entry => entry.options.key === current)
    return React.createElement(React.Fragment, null, nativeEntry && renderEntry(nativeEntry), main ? renderEntry(main) : React.createElement('div', { 'data-other-panel': current ?? 'conversation' }))
  }
  const installNative = async () => {
    await act(async () => {
      nativeFiber = await ctx.plugin({ name: 'native-settings-contract', inject: native.inject, apply: native.apply }).await()
      const entry = ctx.slots.entries('sidebar.settings')[0]
      assert.ok(entry, `native activation ${nativeFiber.status}; error=${String(nativeFiber.error)}; missing remote.settings=${String(ctx.get('remote.settings'))}`)
      assert.ok(entry.children?.['settings.presentation'], 'installed native patch declares its optional presentation seat')
      const ids = ['general', 'models', 'plugins', 'ask-jev', 'agent-presets', 'image-generation', 'weknora', 'computer-use', 'token-stats', 'desktop']
      for (const [index, id] of ids.entries()) {
        if (id === 'general') continue
        const label = id
        const release = ctx.slots.register({ name: 'settings.section', id, priority: -100, order: index, label }, ({ close }) => React.createElement('div', { 'data-section-form': id },
          React.createElement('span', null, label), React.createElement('button', { onClick: () => saves++ }, '保存此项'),
          React.createElement('button', { onClick: close }, '完成并关闭')))
        sections.set(id, release)
      }
      ctx.slots.register({ name: 'settings.action', id: 'test-action', order: 20 }, () => React.createElement('button', { onClick: () => headerActions++ }, '原生设置操作'))
      root.render(React.createElement(App))
    })
  }
  const installProduct = async () => {
    await act(async () => {
      productFiber = await ctx.plugin({ name: 'seal-settings-page-contract', inject: client.inject, apply: client.apply }).await()
      root.render(React.createElement(App))
    })
  }
  if (presenter) await installProduct()
  if (nativeInitially) await installNative()
  t.after(async () => { await act(async () => root.unmount()); await ctx.fiber.dispose(); dom.window.close(); globalThis.window = previous.window; globalThis.document = previous.document; delete globalThis.IS_REACT_ACT_ENVIRONMENT })
  const nativeStore = () => instances.get(ctx.slots.entries('sidebar.settings')[0].store)
  return { ctx, client, root, layout, panelInfo, visits, commands, sections, locale, nativeStore, installNative, installProduct,
    get nativeFiber() { return nativeFiber }, get productFiber() { return productFiber }, get saves() { return saves }, get headerActions() { return headerActions },
    async click(text) { const button = [...document.querySelectorAll('button')].find(item => item.textContent.trim() === text); assert.ok(button, `missing ${text}`); await act(async () => button.click()) },
    async openSection(id) { await act(async () => nativeStore().actions.openSection(id)) },
  }
}

test('actual native shell keeps its modal fallback when no product presenter registers', async t => {
  const h = await fixture(t, { presenter: false })
  await h.openSection('models')
  assert.ok(document.querySelector('[role="dialog"][aria-modal="true"]'))
  assert.equal(document.querySelector('[data-seal-settings-page]'), null)
  assert.equal(h.panelInfo.getSnapshot().activePanelId, null)
})

test('native shortcut and section callbacks render the full page without modal ownership and retain every settings form/action', async t => {
  const h = await fixture(t)
  const command = h.commands.get('settings.open'); assert.ok(command)
  await act(async () => command.resolve({ modal: null }).run())
  assert.equal(h.panelInfo.getSnapshot().activePanelId, PANEL)
  assert.equal(document.querySelector('[role="dialog"],[aria-modal="true"],[inert]'), null)
  const nativeEntry = h.ctx.slots.entries('sidebar.settings')[0]
  assert.equal(h.ctx.slots.entries('sidebar.settings').length, 1, 'product must not clone the native declaration owner')
  assert.equal(Object.hasOwn(nativeEntry.options, 'store'), false)
  assert.ok(nativeEntry.store && nativeEntry.inject && nativeEntry.children)
  const ids = [...document.querySelectorAll('[data-settings-section]')].map(button => button.dataset.settingsSection)
  assert.equal(ids.length, 10)
  for (const id of ids) {
    await act(async () => document.querySelector(`[data-settings-section="${id}"]`).click())
    assert.equal(h.nativeStore().getSnapshot().activeId, id)
    assert.ok(document.querySelector(`[data-section-form="${id}"]`))
    await h.click('保存此项')
  }
  assert.equal(h.saves, ids.length)
  await h.click('原生设置操作'); assert.equal(h.headerActions, 1)
  await h.click('完成并关闭')
  assert.equal(h.nativeStore().getSnapshot().open, false)
  assert.equal(h.panelInfo.getSnapshot().activePanelId, null)
  assert.equal(document.querySelector('[data-seal-settings-page]'), null)
})

test('leaving settings closes native state once without stealing navigation; external openSection still selects its exact page', async t => {
  const h = await fixture(t)
  await h.openSection('computer-use')
  assert.ok(document.querySelector('[data-section-form="computer-use"]'))
  await act(async () => h.layout.selectPanel('remote-hosts'))
  assert.equal(h.panelInfo.getSnapshot().activePanelId, 'remote-hosts')
  assert.equal(h.nativeStore().getSnapshot().open, false)
  assert.equal(document.querySelector('[data-seal-settings-page]'), null)
  await h.openSection('models')
  assert.equal(h.panelInfo.getSnapshot().activePanelId, PANEL)
  assert.ok(document.querySelector('[data-section-form="models"]'))
  assert.equal(document.querySelector('[role="dialog"]'), null)
})

test('late native registration and native HMR retain public slot lifetimes and remove stale presentation callbacks', async t => {
  const h = await fixture(t, { nativeInitially: false })
  assert.equal(h.ctx.slots.entries('main').filter(entry => entry.options.key === PANEL).length, 1)
  assert.equal(h.ctx.slots.entries('settings.presentation').length, 0)
  await h.installNative(); await h.openSection('weknora')
  assert.ok(document.querySelector('[data-section-form="weknora"]'))
  await act(async () => h.nativeFiber.dispose())
  assert.equal(h.ctx.slots.entries('settings.presentation').length, 0)
  assert.equal(document.querySelector('[data-seal-settings-page]'), null)
  assert.equal(h.panelInfo.getSnapshot().activePanelId, null)
  await h.installNative(); await h.openSection('models')
  assert.equal(h.ctx.slots.entries('settings.presentation').length, 1)
  assert.ok(document.querySelector('[data-section-form="models"]'))
  await act(async () => h.productFiber.dispose())
  assert.equal(h.ctx.slots.entries('main').some(entry => entry.options.key === PANEL), false)
  assert.equal(h.ctx.slots.entries('settings.presentation').length, 0)
  assert.equal(h.panelInfo.getSnapshot().activePanelId, null)
})

test('native section registrations and locale-following labels remain live while settings is open', async t => {
  const h = await fixture(t)
  await h.openSection('models')
  let label = '新增设置项'
  let dispose
  await act(async () => { dispose = h.ctx.slots.register({ name: 'settings.section', id: 'late-feature', order: 900, label: () => label }, () => React.createElement('div', { 'data-section-form': 'late-feature' }, label)) })
  await h.openSection('late-feature')
  assert.ok(document.querySelector('[data-section-form="late-feature"]'))
  label = 'Updated section'
  await act(async () => h.locale.set({ revision: 2 }))
  assert.equal(document.querySelector('[data-settings-section="late-feature"]').textContent, label)
  await act(async () => dispose())
  assert.equal(document.querySelector('[data-settings-section="late-feature"]'), null)
  assert.ok(document.querySelector('[data-section-form="general"]'), 'removed active section falls back like native modal')
  assert.equal(h.panelInfo.getSnapshot().activePanelId, PANEL)
})
