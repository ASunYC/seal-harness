import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import test from 'node:test'
import { runInNewContext } from 'node:vm'
import { JSDOM } from 'jsdom'
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'

const require = createRequire(import.meta.url)

test('构建后的客户端注册会话资源入口并复用现有动作', async t => {
  const dom = new JSDOM('<!doctype html><html><head></head><body><section data-composer-card><main></main></section></body></html>', { pretendToBeVisual: true })
  const oldWindow = globalThis.window
  const oldDocument = globalThis.document
  const oldNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator')
  globalThis.window = dom.window
  globalThis.document = dom.window.document
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: dom.window.navigator })
  globalThis.IS_REACT_ACT_ENVIRONMENT = true

  let plugin
  const primitives = {
    Button: ({ icon, children, ...props }) => React.createElement('button', props, icon, children),
    Menu: ({ open, anchor, items = [], onSelect }) => React.createElement(React.Fragment, null,
      anchor,
      open ? React.createElement('div', { role: 'menu' }, items.map(item => React.createElement('button', {
        key: item.id,
        role: 'menuitem',
        onClick: () => onSelect(item.id),
      }, item.icon, item.label))) : null),
    IconSkillOutlineRegular: () => React.createElement('span', null, 'skill-icon'),
    IconCordisPluginOutlineRegular: () => React.createElement('span', null, 'connector-icon'),
    IconAgentPresetOutlineRegular: () => React.createElement('span', null, 'assistant-icon'),
    IconChevronDownOutlineRegular: () => React.createElement('span', null, 'chevron-icon'),
  }
  const pluginRequire = id => id === '@deepseek-ai/dsh-client-ui-primitives' ? primitives : require(id)
  const browserWindow = dom.window
  browserWindow.__ModuleLoader__ = { load: ({ id, factory }) => {
    assert.equal(id, '@seal-harness/session-context-selector')
    plugin = factory(pluginRequire)
  } }
  runInNewContext(readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8'), {
    window: browserWindow,
    document: dom.window.document,
    DOMRect: dom.window.DOMRect,
    AbortController,
    requestAnimationFrame: dom.window.requestAnimationFrame.bind(dom.window),
    cancelAnimationFrame: dom.window.cancelAnimationFrame.bind(dom.window),
    setTimeout,
    clearTimeout,
  })

  const disposers = []
  const registered = []
  const panels = []
  const rpcCalls = []
  let selectedIds = []
  plugin.apply({
    effect(callback) { disposers.push(callback()) },
    slots: {
      inject(name, callback) { assert.equal(name, 'conversation.input.left'); callback() },
      register(meta, component) { registered.push({ meta, component }); return () => {} },
    },
    layout: { selectPanel(panel) { panels.push(panel) } },
    connection: { rpc: { async call(channel, endpoint, payload) {
      rpcCalls.push({ channel, endpoint, payload })
      const item = { id: 'codegraph-mcp', name: 'CodeGraph MCP', summary: '本地代码知识图谱 MCP，用于按符号、调用链和影响范围理解工程。', status: 'active', enabled: true, revision: 2, tools: [{ name: 'explore' }] }
      if (endpoint.endsWith('/sessionSet')) selectedIds = payload.selected ? [payload.id] : []
      return { ok: true, value: { items: [item], selectedIds } }
    } } },
  })

  assert.equal(document.querySelectorAll('style[data-plugin="@seal-harness/session-context-selector"]').length, 1)
  assert.deepEqual(JSON.parse(JSON.stringify(registered[0].meta)), {
    name: 'conversation.input.left',
    id: 'seal-harness-session-context-selector',
    order: 20,
    label: '会话资源',
  })

  const inserted = []
  const inputActions = {
    captureInsertion: () => ({ start: 0, end: 0, revision: 0 }),
    insertText: text => { inserted.push(text); return true },
  }
  const root = createRoot(document.querySelector('main'))
  t.after(async () => {
    await act(async () => root.unmount())
    for (const dispose of disposers) dispose?.()
    assert.equal(document.querySelectorAll('style[data-plugin="@seal-harness/session-context-selector"]').length, 0)
    dom.window.close()
    globalThis.window = oldWindow
    globalThis.document = oldDocument
    if (oldNavigator) Object.defineProperty(globalThis, 'navigator', oldNavigator)
    else delete globalThis.navigator
    delete globalThis.IS_REACT_ACT_ENVIRONMENT
  })

  await act(async () => root.render(React.createElement(registered[0].component, { inputActions, sessionId: 'session-a' })))
  const labels = [...document.querySelectorAll('button')].map(button => button.textContent)
  assert.deepEqual(labels, ['skill-icon能力chevron-icon', 'connector-icon连接器chevron-icon', 'assistant-icon智能助手chevron-icon'])
  assert.equal(document.querySelector('button[aria-label="会话资源"]'), null)
  await act(async () => document.querySelector('button[aria-label="选择能力"]').click())
  await act(async () => document.querySelector('button[aria-label="选择连接器"]').click())
  const connectorDialog = document.querySelector('[role="dialog"][aria-label="连接器选择器"]')
  assert(connectorDialog)
  assert.equal(connectorDialog.parentElement, document.body)
  assert.equal(dom.window.getComputedStyle(connectorDialog).position, 'fixed')
  assert.match(document.querySelector('[role="dialog"]').textContent, /CodeGraph MCP/)
  assert.equal(panels.length, 0, '打开选择器不得跳转管理页')
  await act(async () => document.querySelector('input[aria-label="在当前会话使用 CodeGraph MCP"]').click())
  assert.deepEqual(selectedIds, ['codegraph-mcp'])
  assert.match(document.querySelector('button[aria-label="选择连接器"]').textContent, /1/)
  await act(async () => [...document.querySelectorAll('button')].find(button => button.textContent === '管理连接器').click())
  await act(async () => document.querySelector('button[aria-label="选择智能助手"]').click())

  assert.deepEqual(inserted, ['/skill '])
  assert.deepEqual(panels, ['seal-harness-connectors', 'seal-harness-experts'])
  assert(rpcCalls.some(call => call.endpoint.endsWith('/sessionList') && call.payload.sessionId === 'session-a'))
  assert(rpcCalls.some(call => call.endpoint.endsWith('/sessionSet') && call.payload.selected === true))
})
