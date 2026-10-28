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
  dom.window.HTMLElement.prototype.attachEvent = () => {}
  dom.window.HTMLElement.prototype.detachEvent = () => {}
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
    MenuItemButton: ({ children, onSelect, danger: _danger, separatorBefore: _separatorBefore, ...props }) => React.createElement('button', { ...props, role: 'menuitem', onClick: onSelect }, children),
    Modal: ({ open, title, description, children, footer }) => open ? React.createElement('div', { role: 'dialog', 'aria-label': title },
      React.createElement('p', null, description), children, footer) : null,
    IconSkillOutlineRegular: () => React.createElement('span', null, 'skill-icon'),
    IconCordisPluginOutlineRegular: () => React.createElement('span', null, 'connector-icon'),
    IconAgentPresetOutlineRegular: () => React.createElement('span', null, 'assistant-icon'),
    IconChevronDownOutlineRegular: () => React.createElement('span', null, 'chevron-icon'),
    IconTrashOutlineRegular: () => React.createElement('span', null, 'trash-icon'),
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
  const resources = []
  const rpcCalls = []
  let selectedIds = []
  let expertIds = [], rejectExpert = false
  plugin.apply({
    effect(callback) { disposers.push(callback()) },
    slots: {
      inject(name, callback) {
        assert(['conversation.input.left', 'sidebar.workspaces.session.menu.item', 'shell.overlay'].includes(name))
        callback()
      },
      register(meta, component) { registered.push({ meta, component }); return () => {} },
    },
    layout: { selectPanel(panel) { panels.push(panel) } },
    sealHarnessNavigation: { select(id) { resources.push(id) } },
    remote: { skills: { async list(payload) {
      assert.equal(payload.sessionId, 'session-a')
      return { ok: true, value: { skills: [
        { name: 'codegraph-explore', description: '按符号和调用链理解当前工程', path: 'C:/Users/Lenovo/.seal-harness/capabilities/skills/packages/a/SKILL.md', modelInvocable: true },
        { name: 'local-review', description: '本地代码审查流程', path: 'C:/repo/.agents/skills/local-review/SKILL.md', modelInvocable: true },
        { name: 'native-diagnostic', description: '内置诊断', modelInvocable: true },
      ] } }
    } } },
    connection: { rpc: { async call(channel, endpoint, payload) {
      rpcCalls.push({ channel, endpoint, payload })
      if (endpoint.includes('/experts/session')) {
        if (endpoint.endsWith('/sessionSet')) {
          if (rejectExpert) return { ok: false, error: { message: '请等待当前回复完成后再调整专家。' } }
          expertIds = payload.selected ? [payload.name] : expertIds.filter(name => name !== payload.name)
        }
        return { ok: true, value: { selectedIds: expertIds, items: [
          { name: 'writer', displayName: '写作专家', description: '整理文稿', version: '1.0.0', digest: 'a'.repeat(64) },
          { name: 'reader', displayName: '阅读专家', description: '分析资料', version: '1.0.0', digest: 'b'.repeat(64) },
        ] } }
      }
      if (endpoint.endsWith('/skills/sessionSources')) return { ok: true, value: { items: [
        { name: 'native-diagnostic', source: 'bundled' },
        { name: 'codegraph-explore', path: 'C:/Users/Lenovo/.seal-harness/capabilities/skills/packages/a/SKILL.md', source: 'custom' },
        { name: 'local-review', path: 'C:/repo/.agents/skills/local-review/SKILL.md', source: 'project-agents' },
      ] } }
      if (endpoint.endsWith('/skills/list')) return { ok: true, value: { skills: [
        { id: 'skill-a', name: 'codegraph-explore', description: '按符号和调用链理解当前工程', enabled: true, active: true, origin: { kind: 'store' } },
      ] } }
      const item = { id: 'codegraph-mcp', name: 'CodeGraph MCP', summary: '本地代码知识图谱 MCP，用于按符号、调用链和影响范围理解工程。', status: 'active', enabled: true, revision: 2, tools: [{ name: 'explore' }] }
      const system = { id: 'system-docs', name: '系统文档', catalogId: 'system-docs', status: 'active', enabled: true, revision: 1, tools: [] }
      if (endpoint.endsWith('/sessionSet')) selectedIds = payload.selected ? [payload.id] : []
      return { ok: true, value: { items: [item, system], selectedIds } }
    } } },
    workspaces: { list: { getSnapshot: () => ({ archivedSessionIds: ['session-a'] }) } },
  })

  assert.equal(document.querySelectorAll('style[data-plugin="@seal-harness/session-context-selector"]').length, 1)
  assert.deepEqual(JSON.parse(JSON.stringify(registered[0].meta)), {
    name: 'conversation.input.left',
    id: 'seal-harness-session-context-selector',
    order: 20,
    label: '会话资源',
  })
  assert.deepEqual(JSON.parse(JSON.stringify(registered[1].meta)), {
    name: 'sidebar.workspaces.session.menu.item',
    id: 'seal-harness-delete-session',
    order: 500,
    label: '永久删除会话',
  })
  assert.deepEqual(JSON.parse(JSON.stringify(registered[2].meta)), {
    name: 'shell.overlay',
    id: 'seal-harness-delete-session-confirmation',
    label: '永久删除会话确认',
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
  assert.deepEqual(labels, ['assistant-icon专家chevron-icon', 'skill-icon技能chevron-icon', 'connector-icon连接器chevron-icon'])
  assert.equal(document.querySelector('button[aria-label="会话资源"]'), null)
  await act(async () => document.querySelector('button[aria-label="选择技能"]').click())
  const skillDialog = document.querySelector('[role="dialog"][aria-label="技能选择器"]')
  assert(skillDialog)
  assert.equal(skillDialog.parentElement, document.body)
  assert.deepEqual([...skillDialog.querySelectorAll('.seal-harness-session-skill-group')].map(item => item.textContent), ['系统', '个人'])
  assert.doesNotMatch(skillDialog.textContent, /平台 Skill|本地 Skill/)
  assert.equal(skillDialog.querySelector('[data-skill-name="native-diagnostic"]').dataset.skillDirectory, 'system')
  assert.equal(skillDialog.querySelector('[data-skill-name="codegraph-explore"]').dataset.skillDirectory, 'system')
  assert.equal(skillDialog.querySelector('[data-skill-name="local-review"]').dataset.skillDirectory, 'personal')
  assert.match(skillDialog.textContent, /codegraph-explore/)
  assert.match(skillDialog.textContent, /local-review/)
  assert.equal(skillDialog.querySelectorAll('[data-skill-candidate]').length, 3)
  await act(async () => skillDialog.querySelector('[data-skill-name="codegraph-explore"]').click())
  await act(async () => document.querySelector('button[aria-label="选择技能"]').click())
  await act(async () => [...document.querySelectorAll('button')].find(button => button.textContent === '打开技能页').click())
  await act(async () => document.querySelector('button[aria-label="选择连接器"]').click())
  const connectorDialog = document.querySelector('[role="dialog"][aria-label="连接器选择器"]')
  assert(connectorDialog)
  assert.equal(connectorDialog.parentElement, document.body)
  assert.equal(dom.window.getComputedStyle(connectorDialog).position, 'fixed')
  assert.deepEqual([...connectorDialog.querySelectorAll('.seal-harness-session-connector-section-title')].map(item => item.textContent), ['系统', '个人'])
  const skillGroupStyle = dom.window.getComputedStyle(skillDialog.querySelector('.seal-harness-session-skill-group'))
  const connectorGroupStyle = dom.window.getComputedStyle(connectorDialog.querySelector('.seal-harness-session-connector-section-title'))
  for (const property of ['marginTop', 'marginBottom', 'marginLeft', 'fontSize', 'fontWeight', 'letterSpacing']) {
    assert.equal(connectorGroupStyle[property], skillGroupStyle[property], `连接器分组 ${property} 与技能保持一致`)
  }
  assert.equal(dom.window.getComputedStyle(connectorDialog.querySelector('.seal-harness-session-connector-list')).display, 'flex')
  assert.equal(dom.window.getComputedStyle(connectorDialog.querySelector('section')).display, 'flow-root', '阻止分组标题的上下外边距折叠')
  assert.match(connectorDialog.querySelector('[data-connector-directory="system"]').textContent, /系统文档/)
  assert.doesNotMatch(connectorDialog.querySelector('[data-connector-directory="system"]').textContent, /CodeGraph MCP/)
  assert.match(connectorDialog.querySelector('[data-connector-directory="personal"]').textContent, /CodeGraph MCP/)
  assert.match(document.querySelector('[role="dialog"]').textContent, /CodeGraph MCP/)
  assert.deepEqual(panels, ['seal-harness-home'], '打开连接器选择器不得额外跳转管理页')
  await act(async () => document.querySelector('input[aria-label="在当前会话使用 CodeGraph MCP"]').click())
  assert.deepEqual(selectedIds, ['codegraph-mcp'])
  assert.match(document.querySelector('button[aria-label="选择连接器"]').textContent, /1/)
  await act(async () => [...document.querySelectorAll('button')].find(button => button.textContent === '管理连接器').click())
  await act(async () => document.querySelector('button[aria-label="选择专家"]').click())
  let expertDialog = document.querySelector('[role="dialog"][aria-label="专家选择器"]')
  assert(expertDialog)
  assert.equal(expertDialog.parentElement, document.body)
  assert.match(expertDialog.querySelector('[data-expert-directory="system"]').textContent, /暂无系统专家/)
  assert.match(expertDialog.querySelector('[data-expert-directory="personal"]').textContent, /写作专家/)
  assert.equal(expertDialog.querySelector('[aria-label="不使用专家"]').checked, true)
  const { Simulate } = require('react-dom/test-utils')
  await act(async () => Simulate.change(expertDialog.querySelector('[aria-label="搜索专家"]'), { target: { value: '阅读' } }))
  assert.equal(expertDialog.querySelector('[aria-label="在当前会话使用 写作专家"]'), null)
  assert(expertDialog.querySelector('[aria-label="在当前会话使用 阅读专家"]'))
  await act(async () => Simulate.change(expertDialog.querySelector('[aria-label="搜索专家"]'), { target: { value: '' } }))
  await act(async () => expertDialog.querySelector('[aria-label="在当前会话使用 写作专家"]').click())
  await act(async () => expertDialog.querySelector('[aria-label="在当前会话使用 阅读专家"]').click())
  assert.deepEqual(expertIds, ['reader'])
  assert.equal(expertDialog.querySelector('[aria-label="在当前会话使用 写作专家"]').checked, false)
  assert.equal(expertDialog.querySelectorAll('input[type="radio"]:checked').length, 1)
  assert.match(document.querySelector('[aria-label="选择专家"]').title, /阅读专家/)
  await act(async () => document.querySelector('[aria-label="选择专家"]').click())
  await act(async () => document.querySelector('[aria-label="选择专家"]').click())
  expertDialog = document.querySelector('[aria-label="专家选择器"]')
  assert.equal(expertDialog.querySelector('[aria-label="在当前会话使用 阅读专家"]').checked, true)
  await act(async () => expertDialog.querySelector('[aria-label="不使用专家"]').click())
  assert.deepEqual(expertIds, [])
  assert.equal(expertDialog.querySelector('[aria-label="不使用专家"]').checked, true)
  await act(async () => expertDialog.querySelector('[aria-label="在当前会话使用 阅读专家"]').click())
  assert.deepEqual(expertIds, ['reader'])
  rejectExpert = true
  await act(async () => expertDialog.querySelector('[aria-label="在当前会话使用 写作专家"]').click())
  assert.match(expertDialog.querySelector('[role="alert"]').textContent, /等待当前回复/)
  assert.deepEqual(expertIds, ['reader'])
  await act(async () => document.querySelector('[aria-label="选择专家"]').click())

  assert.deepEqual(inserted, ['/codegraph-explore '])
  assert.deepEqual(panels, ['seal-harness-home', 'seal-harness-home'])
  assert.deepEqual(resources, ['skills', 'connectors'])
  assert(rpcCalls.some(call => call.endpoint.endsWith('/experts/sessionSet') && call.payload.sessionId === 'session-a' && call.payload.expectedDigest === 'a'.repeat(64)))
  assert(rpcCalls.some(call => call.endpoint.endsWith('/sessionList') && call.payload.sessionId === 'session-a'))
  assert(rpcCalls.some(call => call.endpoint.endsWith('/sessionSet') && call.payload.selected === true))

  const deleteHost = document.createElement('aside')
  const overlayHost = document.createElement('aside')
  document.body.append(deleteHost)
  document.body.append(overlayHost)
  const deleteRoot = createRoot(deleteHost)
  const overlayRoot = createRoot(overlayHost)
  await act(async () => overlayRoot.render(React.createElement(registered[2].component)))
  let menuOpen = true
  await act(async () => deleteRoot.render(React.createElement(registered[1].component, {
    sessionId: 'session-a',
    displayTitle: '待删除会话',
    useMenuOpenState: () => [menuOpen, value => { menuOpen = value }],
  })))
  await act(async () => deleteHost.querySelector('button[role="menuitem"]').click())
  assert.equal(menuOpen, false)
  await act(async () => deleteRoot.unmount())
  deleteHost.remove()
  const confirmation = document.querySelector('[role="dialog"][aria-label="永久删除会话"]')
  assert(confirmation)
  assert.match(confirmation.textContent, /待删除会话/)
  assert.match(confirmation.textContent, /无法恢复/)
  await act(async () => [...confirmation.querySelectorAll('button')].find(button => button.textContent === '永久删除').click())
  assert(rpcCalls.some(call => call.endpoint.endsWith('/sessions/delete') && call.payload.sessionId === 'session-a'))
  await act(async () => overlayRoot.unmount())
  overlayHost.remove()
})

test('技能候选优先显示完整名称，由描述承担省略', () => {
  const css = readFileSync(new URL('../src/styles.js', import.meta.url), 'utf8')
  const shared = css.match(/\.seal-harness-session-skill-copy > strong,\s*\.seal-harness-session-skill-copy > small \{[^}]*\}/s)?.[0]
  assert(shared, '技能名称与描述必须共用单行省略规则')
  assert.match(shared, /overflow:\s*hidden/)
  assert.match(shared, /text-overflow:\s*ellipsis/)
  assert.match(css, /\.seal-harness-session-skill-copy > strong \{[^}]*?flex:\s*0 0 auto/s, '技能名称不得被描述挤压缩短')
  assert.match(css, /\.seal-harness-session-skill-copy > small \{[^}]*?min-width:\s*0/s, '描述必须能收缩到省略')
})
