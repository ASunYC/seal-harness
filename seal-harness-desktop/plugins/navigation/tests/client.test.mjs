import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { runInNewContext } from 'node:vm'
import { JSDOM } from 'jsdom'
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'

const require = createRequire(import.meta.url)

test('top rail and home subnavigation switch without replacing native conversation', async t => {
  const dom = new JSDOM('<!doctype html><html><head></head><body><main></main></body></html>')
  const previous = { window: globalThis.window, document: globalThis.document }
  globalThis.window = dom.window; globalThis.document = dom.window.document
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  const root = createRoot(document.querySelector('main'))
  const entries = [], effects = [], listeners = new Set(), provided = new Map()
  const workspaceSnapshot = { items: [{ workspaceId: 'w1', title: '研发空间', path: 'D:/work' }] }
  let activePanelId = null, openedWorkspace = null, createdPath = null
  const ctx = {
    provide(name, value) { provided.set(name, value) },
    effect(callback) { effects.push(callback()) },
    slots: {
      inject(_name, callback) { return callback() },
      register(options, component) {
        const entry = { options, component }
        entries.push(entry)
        return () => { const index = entries.indexOf(entry); if (index >= 0) entries.splice(index, 1) }
      },
    },
    layout: { selectPanel(id) { activePanelId = id; for (const listener of listeners) listener() } },
    workspaces: { list: { subscribe: () => () => {}, getSnapshot: () => workspaceSnapshot }, create: async ({ path }) => { createdPath = path; return { workspaceId: 'w1' } } },
    uiWorkspace: { openWorkspace: async id => { openedWorkspace = id }, pickDirectory: async () => 'D:/new-space' },
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
  const schedules = entries.find(entry => entry.options.key === 'seal-harness-schedules')?.component
  assert(rail && home && spaces && schedules)
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
  await act(async () => root.render(React.createElement(rail, { usePanelInfo })))
  assert.equal(document.querySelector('button[aria-label="对话"]'), null)
  assert.deepEqual([...document.querySelectorAll('.seal-nav-rail button')].map(button => button.getAttribute('aria-label')), ['首页', '空间', '定时任务'])
  const homeButton = document.querySelector('button[aria-label="首页"]')
  homeButton.focus()
  assert.equal(document.activeElement, homeButton)
  await click('首页')
  assert.equal(activePanelId, null)
  assert.equal(document.querySelector('button[aria-label="首页"]')?.getAttribute('aria-current'), 'page')
  const homeMenu = entries.find(entry => entry.options.name === 'sidebar.workspaces')?.component
  assert(homeMenu)
  const navigation = provided.get('sealHarnessNavigation')
  assert.deepEqual(Array.from(navigation.getSnapshot().entries, entry => entry.id), ['plugins'])
  let release
  await act(async () => { release = navigation.register({ id: 'experts', label: '专家', order: 20, icon: 'experts', Panel: () => React.createElement('span', null, '专家内容') }) })
  await act(async () => root.render(React.createElement(React.Fragment, null,
    React.createElement(rail, { usePanelInfo }),
    React.createElement('aside', null, React.createElement(homeMenu)),
    React.createElement('article', null, React.createElement(home)),
  )))
  assert.match(document.querySelector('aside').textContent, /专家.*插件/)
  assert.equal(document.querySelector('aside').textContent.includes('会话'), false)
  assert.equal(document.querySelector('aside .seal-nav-secondary header'), null)
  assert.doesNotMatch(document.body.textContent, /概览|从这里，连接你的智能工作流/)
  assert.match(document.querySelector('aside').textContent, /插件/)
  await click('专家')
  assert.equal(activePanelId, 'seal-harness-home')
  assert.match(document.querySelector('article').textContent, /专家内容/)
  await act(async () => release())
  assert.equal(navigation.getSnapshot().selectedId, null)
  await click('插件')
  assert.equal(activePanelId, 'plugins')
  assert.equal(navigation.getSnapshot().selectedId, 'plugins')
  assert.equal(document.querySelector('button[aria-label="首页"]')?.getAttribute('aria-current'), 'page')
  assert.equal(document.querySelector('.seal-nav-plugin-tabs button[aria-current="page"]')?.textContent, '插件')
  await click('首页')
  assert.equal(activePanelId, null)
  assert.equal(navigation.getSnapshot().selectedId, null)
  await click('插件')
  assert.equal(navigation.getSnapshot().selectedId, 'plugins')
  await click('空间')
  assert.equal(entries.some(entry => entry.options.name === 'sidebar.workspaces'), false)
  await act(async () => root.render(React.createElement(React.Fragment, null, React.createElement(rail, { usePanelInfo }), React.createElement(spaces))))
  await click('研发空间')
  assert.equal(openedWorkspace, 'w1')
  assert.equal(navigation.getSnapshot().selectedId, null)
  await click('添加空间')
  assert.equal(createdPath, 'D:/new-space')
  await act(async () => root.render(React.createElement(React.Fragment, null, React.createElement(rail, { usePanelInfo }), React.createElement(schedules))))
  assert.match(document.body.textContent, /当前没有定时任务/)
})
