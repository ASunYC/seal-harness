import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { runInNewContext } from 'node:vm'
import { JSDOM } from 'jsdom'
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'

const require = createRequire(import.meta.url)

test('home resources share the sidebar with native workspaces and sessions', async t => {
  const dom = new JSDOM('<!doctype html><html><head></head><body><main></main><div id="root"><div data-slot="sidebar"><button aria-label="自动化任务">上游入口</button><button class="dshMarketLauncher">旧市场入口</button></div></div><div data-slot="sidebar.settings"><button aria-haspopup="menu">上游账户菜单</button></div><button class="seal-harness-user-footer">原生账号</button></body></html>')
  const previous = { window: globalThis.window, document: globalThis.document }
  globalThis.window = dom.window; globalThis.document = dom.window.document
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  const root = createRoot(document.querySelector('main'))
  const entries = [
    { options: { name: 'sidebar.workspaces', priority: 0 }, component: () => React.createElement('span', null, '原生工作区与会话') },
    { options: { name: 'main', key: 'schedules' }, component: () => React.createElement('span', null, '原生自动化任务页面') },
    { options: { name: 'settings.launcher', priority: 0 }, component: () => React.createElement('button', { 'aria-haspopup': 'menu' }, '上游账户菜单') },
  ]
  const effects = [], listeners = new Set(), provided = new Map()
  const slotListeners = new Set()
  let activePanelId = null
  let sessionSnapshot = { byId: {} }
  const sessionListeners = new Set()
  let settingsClicks = 0, accountClicks = 0
  document.querySelector('.seal-harness-user-footer').addEventListener('click', () => accountClicks++)
  const ctx = {
    provide(name, value) { provided.set(name, value) },
    effect(callback) { effects.push(callback()) },
    slots: {
      inject(_name, callback) { return callback() },
      entries(name) { return entries.filter(entry => entry.options.name === name) },
      subscribe(name, listener) {
        assert.equal(name, 'settings.plugins.tab')
        slotListeners.add(listener)
        return () => slotListeners.delete(listener)
      },
      register(options, component) {
        const entry = { options, component, locale: options.locale, inject: options.inject, store: options.store }
        entries.push(entry)
        return () => { const index = entries.indexOf(entry); if (index >= 0) entries.splice(index, 1) }
      },
    },
    layout: {
      selectPanel(id) { activePanelId = id; for (const listener of listeners) listener() },
      toggleSidebar() { assert.fail('页面切换不能改写用户的侧栏收起偏好') },
    },
    sessions: { list: { subscribe(listener) { sessionListeners.add(listener); return () => sessionListeners.delete(listener) }, getSnapshot: () => sessionSnapshot } },
  }
  const loaded = {}
  runInNewContext(await readFile(new URL('../lib/client.js', import.meta.url), 'utf8'), {
    window: { __ModuleLoader__: { load({ id, factory }) { assert.equal(id, '@seal-harness/navigation'); Object.assign(loaded, factory(require)) } } },
    document: dom.window.document,
  })
  loaded.apply(ctx)
  const rail = entries.find(entry => entry.options.name === 'shell.overlay')?.component
  const home = entries.find(entry => entry.options.key === 'seal-harness-home')?.component
  const spaces = entries.find(entry => entry.options.key === 'seal-harness-spaces')?.component
  const nativeSchedules = entries.find(entry => entry.options.key === 'schedules')?.component
  assert(rail && home && spaces && nativeSchedules)
  const settingsLauncher = entries.filter(entry => entry.options.name === 'settings.launcher').sort((a, b) => a.options.priority - b.options.priority)[0]
  assert.equal(settingsLauncher.options.priority, -100)
  const registrations = name => entries.filter(entry => entry.options.name === name)
  const usePanelInfo = selector => React.useSyncExternalStore(listener => { listeners.add(listener); return () => listeners.delete(listener) }, () => selector({ activePanelId }))
  const click = async label => {
    const button = [...document.querySelectorAll('button')].find(item => item.getAttribute('aria-label') === label || item.textContent.trim() === label || item.textContent.includes(label))
    assert(button, `missing button ${label}`)
    await act(async () => button.click())
  }
  t.after(async () => {
    await act(async () => root.unmount())
    for (const dispose of effects) dispose?.()
    dom.window.close(); globalThis.window = previous.window; globalThis.document = previous.document
    delete globalThis.IS_REACT_ACT_ENVIRONMENT
  })
  await act(async () => root.render(React.createElement(React.Fragment, null,
    React.createElement(rail, { usePanelInfo }),
    React.createElement(settingsLauncher.component, { openSettings: () => settingsClicks++ }),
  )))
  assert.equal(dom.window.getComputedStyle(document.querySelector('[data-slot="sidebar"] button[aria-label="自动化任务"]')).display, 'none')
  assert.equal(dom.window.getComputedStyle(document.querySelector('.dshMarketLauncher')).display, 'none')
  assert.equal(document.querySelector('button[aria-label="对话"]'), null)
  assert.deepEqual([...document.querySelectorAll('.seal-nav-rail > button')].map(button => button.getAttribute('aria-label')), ['首页', '自动化任务', '空间'])
  assert.deepEqual([...document.querySelectorAll('.seal-nav-rail__footer button')].map(button => button.getAttribute('aria-label')), ['设置', '账户'])
  assert.equal(document.querySelector('[data-slot="sidebar.settings"] button[aria-haspopup="dialog"]'), null)
  await act(async () => document.querySelector('.seal-nav-rail__footer button[aria-label="设置"]').click())
  await act(async () => document.querySelector('.seal-nav-rail__footer button[aria-label="账户"]').click())
  assert.equal(settingsClicks, 1)
  assert.equal(accountClicks, 1)
  await act(async () => ctx.layout.selectPanel('seal-harness-user'))
  assert.equal(document.querySelector('.seal-nav-rail__footer button[aria-label="账户"]')?.getAttribute('aria-current'), 'page')
  assert.equal(entries.filter(entry => entry.options.name === 'sidebar.workspaces').length, 2)
  const homeButton = document.querySelector('button[aria-label="首页"]')
  homeButton.focus()
  assert.equal(document.activeElement, homeButton)
  await click('首页')
  assert.equal(activePanelId, null)
  assert.equal(document.querySelector('button[aria-label="首页"]')?.getAttribute('aria-current'), 'page')
  assert.equal(registrations('sidebar.workspaces').length, 1)
  const navigation = provided.get('sealHarnessNavigation')
  assert.deepEqual(Array.from(navigation.getSnapshot().entries, entry => entry.id), ['plugins'])
  assert.deepEqual(registrations('sidebar.panellist').map(entry => entry.options.id), ['plugins'])
  assert.equal(registrations('sidebar.panellist')[0].options.priority, -100)
  let release
  await act(async () => { release = navigation.register({ id: 'experts', label: '专家', order: 20, icon: 'experts', Panel: () => React.createElement('span', null, '专家内容') }) })
  let releaseDecision
  await act(async () => { releaseDecision = navigation.register({ id: 'ask-jev', label: '问问决策', order: 45, icon: 'plugins', Panel: () => React.createElement('span', null, '独立决策页面') }) })
  assert.deepEqual(registrations('sidebar.panellist').map(entry => entry.options.id).sort(), ['experts', 'plugins'])
  assert.deepEqual([...document.querySelectorAll('.seal-nav-rail > button')].map(button => button.getAttribute('aria-label')), ['首页', '问问决策', '自动化任务', '空间'])
  const expertMain = entries.find(entry => entry.options.name === 'main' && entry.options.key === 'experts')?.component
  const decisionMain = entries.find(entry => entry.options.name === 'main' && entry.options.key === 'ask-jev')?.component
  assert(expertMain)
  assert(decisionMain)
  await act(async () => root.render(React.createElement(React.Fragment, null,
    React.createElement(rail, { usePanelInfo }),
    React.createElement('aside', null, React.createElement(registrations('sidebar.workspaces')[0].component)),
    React.createElement('article', null, React.createElement(expertMain)),
  )))
  assert.match(document.querySelector('aside').textContent, /原生工作区与会话/)
  assert.match(document.querySelector('article').textContent, /专家内容/)
  await click('问问决策')
  assert.equal(activePanelId, 'ask-jev')
  assert.equal(document.querySelector('button[aria-label="问问决策"]')?.getAttribute('aria-current'), 'page')
  assert.equal(document.querySelector('button[aria-label="首页"]')?.getAttribute('aria-current'), null)
  assert.equal(registrations('sidebar.panellist').length, 0)
  assert.equal(registrations('sidebar.workspaces').length, 2)
  assert(registrations('main').some(entry => entry.options.key === 'ask-jev'))
  await act(async () => root.render(React.createElement(React.Fragment, null, React.createElement(rail, { usePanelInfo }), React.createElement(decisionMain))))
  assert.match(document.body.textContent, /独立决策页面/)
  await act(async () => {
    navigation.markDecisionSession('decision-1')
    sessionSnapshot = { byId: { 'decision-1': { id: 'decision-1', retainedBy: { mainView: 1 } } } }
    for (const listener of sessionListeners) listener()
    ctx.layout.selectPanel(null)
  })
  assert.equal(document.querySelector('button[aria-label="问问决策"]')?.getAttribute('aria-current'), 'page')
  assert.equal(document.querySelector('button[aria-label="首页"]')?.getAttribute('aria-current'), null)
  assert.equal(registrations('sidebar.workspaces').length, 2)
  await act(async () => {
    sessionSnapshot = { byId: { other: { id: 'other', retainedBy: { mainView: 1 } } } }
    for (const listener of sessionListeners) listener()
  })
  assert.equal(navigation.getSnapshot().decisionActive, false, 'switching to another conversation leaves Decision mode')
  assert.equal(document.querySelector('button[aria-label="首页"]')?.getAttribute('aria-current'), 'page')
  await click('首页')
  assert.equal(navigation.getSnapshot().decisionActive, false)
  assert.equal(registrations('sidebar.workspaces').length, 1)
  assert.deepEqual(registrations('sidebar.panellist').map(entry => entry.options.id).sort(), ['experts', 'plugins'])
  await act(async () => ctx.layout.selectPanel('experts'))
  assert.equal(registrations('sidebar.workspaces').length, 1)
  assert.equal(document.querySelector('button[aria-label="首页"]')?.getAttribute('aria-current'), 'page')
  await act(async () => ctx.layout.selectPanel('plugins'))
  assert.equal(activePanelId, 'plugins')
  assert.equal(navigation.getSnapshot().selectedId, 'plugins')
  assert.equal(document.querySelector('button[aria-label="首页"]')?.getAttribute('aria-current'), 'page')
  assert.equal(registrations('sidebar.workspaces').length, 1)
  await click('首页')
  assert.equal(activePanelId, null)
  assert.equal(navigation.getSnapshot().selectedId, null)
  await act(async () => { navigation.select('experts'); ctx.layout.selectPanel('seal-harness-home') })
  await act(async () => root.render(React.createElement(React.Fragment, null, React.createElement(rail, { usePanelInfo }), React.createElement(home))))
  assert.match(document.body.textContent, /专家内容/)
  assert.equal(registrations('sidebar.workspaces').length, 1)
  await click('空间')
  assert.equal(registrations('sidebar.panellist').length, 0)
  assert.equal(registrations('sidebar.workspaces').length, 2)
  await act(async () => root.render(React.createElement(React.Fragment, null, React.createElement(rail, { usePanelInfo }), React.createElement(spaces))))
  assert.match(document.body.textContent, /空间功能尚未开放/)
  assert.doesNotMatch(document.body.textContent, /添加空间|打开空间/)
  await act(async () => document.querySelector('.seal-nav-rail button[aria-label="自动化任务"]').click())
  assert.equal(activePanelId, 'schedules')
  assert.equal(document.querySelector('.seal-nav-rail button[aria-label="自动化任务"]')?.getAttribute('aria-current'), 'page')
  assert.equal(registrations('sidebar.workspaces').length, 2)
  await act(async () => root.render(React.createElement(React.Fragment, null, React.createElement(rail, { usePanelInfo }), React.createElement(nativeSchedules))))
  assert.match(document.body.textContent, /原生自动化任务页面/)
  let releaseSchedules
  await act(async () => { releaseSchedules = navigation.register({ id: 'seal-harness-schedules', label: '定时任务', order: 70, icon: 'schedules', Panel: () => React.createElement('span', null, '定时任务计划与记录') }) })
  assert.equal(registrations('main').filter(entry => entry.options.key === 'seal-harness-schedules').length, 1)
  assert.equal(document.querySelector('.seal-nav-rail button[aria-label="定时任务"]'), null)
  assert.equal(registrations('sidebar.panellist').some(entry => entry.options.id === 'seal-harness-schedules'), false)
  await click('首页')
  assert.equal(registrations('sidebar.panellist').some(entry => entry.options.id === 'seal-harness-schedules'), false)
  await act(async () => releaseSchedules())
  const primaryEntries = [
    ['token-stats', 'Token 统计', 'usage'], ['knowledge', '知识库', 'knowledge'],
    ['remote-desktop', '远程主机', 'desktop'], ['acp', 'ACP', 'acp'],
  ]
  const primaryDisposers = []
  await act(async () => {
    for (const [index, [id, label, icon]] of primaryEntries.entries()) primaryDisposers.push(navigation.register({
      id, label, icon, order: 100 + index * 10, primary: true, Panel: () => React.createElement('span', null, label),
    }))
  })
  assert.deepEqual([...document.querySelectorAll('.seal-nav-rail > button')].map(button => button.getAttribute('aria-label')), ['首页', '问问决策', '自动化任务', 'Token 统计', '知识库', '远程主机', 'ACP', '空间'])
  assert.equal(registrations('sidebar.panellist').some(entry => primaryEntries.some(([id]) => id === entry.options.id)), false)
  for (const [id, label] of primaryEntries) {
    await click(label)
    assert.equal(activePanelId, id)
    assert.equal(document.querySelector('.seal-nav-rail').dataset.homeActive, 'false')
    assert.equal(registrations('sidebar.workspaces').length, 2)
    assert(registrations('main').some(entry => entry.options.key === id))
  }
  await act(async () => primaryDisposers.forEach(dispose => dispose()))
  assert.equal(activePanelId, null, '当前一级插件卸载后回到首页')
  assert.equal(document.querySelector('.seal-nav-rail').dataset.homeActive, 'true')
  const marketEntry = {
    options: { name: 'settings.plugins.tab', id: 'community-market' },
    component: ({ readLocale }) => React.createElement('span', null, `市场内容 ${readLocale()}`),
    locale: 'community-market',
    inject: () => ({ readLocale: () => 'zh' }),
  }
  await act(async () => {
    entries.push(marketEntry)
    for (const listener of slotListeners) listener()
  })
  assert.deepEqual([...document.querySelectorAll('.seal-nav-rail > button')].map(button => button.getAttribute('aria-label')), ['首页', '问问决策', '自动化任务', '空间', '插件市场'])
  const marketMain = entries.find(entry => entry.options.name === 'main' && entry.options.key === 'seal-harness-market')
  assert(marketMain)
  assert.equal(marketMain.locale, marketEntry.locale)
  assert.equal(marketMain.inject, marketEntry.inject)
  await act(async () => document.querySelector('.seal-nav-rail button[aria-label="插件市场"]').click())
  assert.equal(activePanelId, 'seal-harness-market')
  assert.equal(document.querySelector('.seal-nav-rail').dataset.homeActive, 'false')
  assert.equal(document.querySelector('button[aria-label="插件市场"]').getAttribute('aria-current'), 'page')
  assert.equal(registrations('sidebar.workspaces').length, 2)
  await act(async () => root.render(React.createElement(React.Fragment, null,
    React.createElement(rail, { usePanelInfo }), React.createElement(marketMain.component, marketMain.inject()),
    React.createElement(settingsLauncher.component, { openSettings: () => settingsClicks++ }),
  )))
  assert.match(document.querySelector('[data-seal-nav-panel="market"]').textContent, /市场内容 zh/)
  await act(async () => document.querySelector('.seal-nav-rail__footer button[aria-label="设置"]').click())
  assert.equal(settingsClicks, 2, '非首页仍能打开原生设置')
  await click('首页')
  assert.equal(document.querySelector('.seal-nav-rail').dataset.homeActive, 'true')
  assert.equal(registrations('sidebar.workspaces').length, 1)
  await act(async () => document.querySelector('.seal-nav-rail button[aria-label="插件市场"]').click())
  await act(async () => {
    entries.splice(entries.indexOf(marketEntry), 1)
    for (const listener of slotListeners) listener()
  })
  assert.equal(activePanelId, null, '市场卸载后回到首页')
  assert.equal(entries.some(entry => entry.options.key === 'seal-harness-market'), false)
  assert.equal(document.querySelector('button[aria-label="插件市场"]'), null)
  await act(async () => release())
  await act(async () => releaseDecision())
})
