import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import test from 'node:test'
import { runInNewContext } from 'node:vm'
import { JSDOM } from 'jsdom'
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { Simulate } from 'react-dom/test-utils'

const require = createRequire(import.meta.url)

class StubWorker {
  onmessage
  postMessage(request) {
    if (request.kind === 'parse') queueMicrotask(() => this.onmessage({ data: {
      id: request.id, kind: 'parsed', document: { pageSettings: { pageWidth: 10000, pageHeight: 16000, marginTop: 800, marginRight: 900, marginBottom: 1000, marginLeft: 1100 }, blocks: [{
        type: 'paragraph', docxIndex: 0, runs: [{ text: '工作区 Word 内容' }],
        originalXml: '<w:p/>', format: {},
      }] },
    } }))
    else queueMicrotask(() => this.onmessage({ data: { id: request.id, kind: 'serialized', bytes: Uint8Array.of(1, 2, 3) } }))
  }
  terminate() {}
}

test('Office preview edit opens a session right tab and saves spreadsheet cell updates', async t => {
  const dom = new JSDOM('<!doctype html><html><head></head><body><div id="root"></div></body></html>')
  const previous = { window: globalThis.window, document: globalThis.document, navigator: globalThis.navigator,
    HTMLElement: globalThis.HTMLElement, Element: globalThis.Element, Node: globalThis.Node,
    MutationObserver: globalThis.MutationObserver, getComputedStyle: globalThis.getComputedStyle }
  globalThis.window = dom.window
  globalThis.document = dom.window.document
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: dom.window.navigator })
  globalThis.HTMLElement = dom.window.HTMLElement
  globalThis.Element = dom.window.Element
  globalThis.Node = dom.window.Node
  globalThis.MutationObserver = dom.window.MutationObserver
  globalThis.getComputedStyle = dom.window.getComputedStyle
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  const root = createRoot(document.getElementById('root'))
  t.after(async () => {
    await act(async () => root.unmount())
    dom.window.close()
    for (const [key, value] of Object.entries(previous)) {
      if (key === 'navigator') Object.defineProperty(globalThis, key, { configurable: true, value })
      else globalThis[key] = value
    }
    delete globalThis.IS_REACT_ACT_ENVIRONMENT
  })
  const loaded = {}
  dom.window.__ModuleLoader__ = { load({ id, factory }) {
    assert.equal(id, '@seal-harness/workspace-word')
    Object.assign(loaded, factory(id => {
      assert.match(id, /^react(?:-dom)?(?:\/|$)/u, 'browser bundle must not require a Node-only dependency')
      return require(id)
    }))
  } }
  runInNewContext(readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8'), {
    window: dom.window, self: dom.window, document: dom.window.document, navigator: dom.window.navigator,
    AbortController, Blob, Uint8Array,
    URL: { createObjectURL: () => 'blob:seal-test', revokeObjectURL() {} }, URLSearchParams, Worker: StubWorker,
    atob, btoa, queueMicrotask, fetch: async url => {
      assert.equal(url, 'api/changes.summary?sessionId=one&seq=19')
      return { ok: true, json: async () => ({ turn: 8, files: [{ path: 'generated-from-shell.docx' }] }) }
    }, requestAnimationFrame: callback => setTimeout(callback, 0),
    setTimeout, clearTimeout,
  })
  const entries = []
  const openedTabs = []
  const tabTypes = []
  const calls = []
  let closeHandler
  let change = { kind: 'replace', entries: [] }
  const eventListeners = new Set()
  const eventSource = {
    getSnapshot: () => ({ change }),
    subscribe(listener) { eventListeners.add(listener); return () => eventListeners.delete(listener) },
  }
  loaded.apply({
    slots: { inject: (_name, callback) => callback(), register: (meta, component) => {
      entries.push({ meta, component })
      return () => {}
    } },
    connection: { rpc: { call: async (_path, method, payload) => { calls.push({ method, payload }); return method.endsWith('/open')
      ? payload.path.endsWith('.docx') ? { ok: true, value: { leaseId: 'word-lease', kind: 'docx', displayName: 'memo.docx', data: 'AQID' } }
        : { ok: true, value: { leaseId: 'test-lease', kind: 'xlsx', displayName: 'memo.xlsx', view: { kind: 'xlsx', readOnly: false, blocks: [{ id: '["Sheet1","A1"]', label: 'Sheet1!A1', text: '旧值', editable: true }], totalBlocks: 1, truncated: false } } }
      : method.endsWith('/snapshot') ? { ok: true, value: { documents: [] } }
        : method.endsWith('/edit') ? { ok: true, value: { saved: true, view: { kind: 'xlsx', readOnly: false, blocks: [{ id: '["Sheet1","A1"]', label: 'Sheet1!A1', text: '新值', editable: true }], totalBlocks: 1, truncated: false } } }
          : { ok: true, value: { saved: true } } } } },
    sessions: { binding: () => ({ eventSource }), list: { getSnapshot: () => ({ byId: { one: { cwd: 'C:\\workspace' } } }) } },
    sidebarRight: { mounted: { getSnapshot: () => 'one' }, openResourceIn: (sessionId, address) => openedTabs.push({ sessionId, address }), registerCloseHandler: (_kind, handler) => { closeHandler = handler; return () => {} } },
    sidebarRightTabs: { register: definition => { tabTypes.push(definition); return () => {} } },
    effect: callback => callback(),
  })
  const action = entries.find(entry => entry.meta.id === 'seal-workspace-word-edit')
  const editorTab = entries.find(entry => entry.meta.name === 'sidebar.right.pane.tab')
  const autoOpen = entries.find(entry => entry.meta.id === 'seal-workspace-office-auto-open')
  assert(action)
  assert(editorTab)
  assert(autoOpen)
  assert.deepEqual(tabTypes.map(item => item.kind), ['seal-workspace-office'])
  assert.equal(tabTypes[0].keepMounted, true)
  const definition = tabTypes[0]
  assert.equal(definition.priority, 'extension')
  for (const name of ['memo.docx', 'sheet.XLSX', 'deck.pptx', 'report%20%23%3F.docx']) {
    const address = `dsh-resource://file/session/one/C:/workspace/${name}`
    assert.equal(definition.canOpen(address), true)
  }
  assert.equal(definition.title('dsh-resource://file/session/one/C:/workspace/report%20%23%3F.docx'), 'report #?.docx')
  for (const address of ['dsh-resource://file/session/one/C:/workspace/plain.txt', 'dsh-resource://file/absolute/C:/workspace/memo.docx', 'https://example.com/memo.docx'])
    assert.equal(definition.canOpen(address), false)

  await act(async () => root.render(React.createElement(autoOpen.component, {
    sessionId: 'one', turn: { turn: 7, data: new Map([['deliverables', { produced: [{ seq: 5, path: 'generated.docx' }] }]]) }, seq: 8,
  })))
  assert.equal(openedTabs.length, 0)
  await act(async () => {
    change = { kind: 'append', entries: [{ type: 'event', event: { type: 'turn/end', data: { turn: 7, reason: { kind: 'completed' } } } }] }
    for (const listener of eventListeners) listener()
    await Promise.resolve()
  })
  assert.equal(JSON.stringify(openedTabs[0]), JSON.stringify({ sessionId: 'one', address: 'dsh-resource://file/session/one/C:/workspace/generated.docx' }))
  assert.equal(openedTabs.length, 1)
  change = { kind: 'replace', entries: [] }
  await act(async () => root.render(React.createElement(autoOpen.component, {
    sessionId: 'one', turn: { turn: 8, data: new Map([['deliverables', { produced: [], changes: { seq: 19 } }]]) }, seq: 20,
  })))
  assert.equal(openedTabs.length, 1)
  await act(async () => {
    change = { kind: 'append', entries: [{ type: 'event', event: { type: 'turn/end', data: { turn: 8, reason: { kind: 'completed' } } } }] }
    for (const listener of eventListeners) listener()
    await new Promise(resolve => setTimeout(resolve, 0))
  })
  assert.equal(openedTabs[1]?.address, 'dsh-resource://file/session/one/C:/workspace/generated-from-shell.docx')
  await act(async () => root.render(React.createElement(action.component, { absolutePath: 'C:\\workspace\\memo.xlsx', sessionId: 'one' })))
  const button = document.querySelector('button')
  assert.equal(button?.textContent, '编辑')
  await act(async () => button.click())
  assert.equal(JSON.stringify(openedTabs[2]), JSON.stringify({ sessionId: 'one', address: 'dsh-resource://file/session/one/C:/workspace/memo.xlsx' }))
  await act(async () => root.render(React.createElement(action.component, { absolutePath: 'C:\\workspace\\plain.txt', sessionId: 'one' })))
  assert.equal(document.querySelector('button'), null)
  await act(async () => root.render(React.createElement(action.component, { absolutePath: 'C:\\workspace\\memo.xlsx' })))
  assert.equal(document.querySelector('button'), null)
  let closed = false
  await act(async () => root.render(React.createElement(editorTab.component, {
    sessionId: 'one', useTabInfo: () => ({ tab: { id: 'office-tab-1', navigation: { params: { path: 'C:\\workspace\\memo.xlsx' } }, actions: { close: () => { closed = true } } } }),
  })))
  assert.match(document.body.textContent, /Sheet1/u)
  const cell = document.querySelector('textarea[aria-label="Sheet1!A1"]')
  assert.equal(cell?.value, '旧值')
  await act(async () => Simulate.change(cell, { target: { value: '新值' } }))
  dom.window.confirm = () => false
  assert.throws(() => closeHandler('one', { id: 'office-tab-1' }), /已取消关闭/u)
  assert.equal([...document.querySelectorAll('button')].find(item => item.textContent === '保存').disabled, false)
  assert.equal([...document.querySelectorAll('button')].find(item => item.textContent === '导出').disabled, true)
  await act(async () => [...document.querySelectorAll('button')].find(item => item.textContent === '保存').click())
  assert.equal([...document.querySelectorAll('button')].find(item => item.textContent === '导出').disabled, false)
  assert.equal(JSON.stringify(calls.find(item => item.method.endsWith('/edit'))?.payload), JSON.stringify({ leaseId: 'test-lease', updates: [{ id: '["Sheet1","A1"]', text: '新值' }] }))
  await act(async () => [...document.querySelectorAll('button')].find(item => item.textContent === '关闭').click())
  assert.equal(closed, true)
  await act(async () => root.render(React.createElement(editorTab.component, {
    sessionId: 'one', useTabInfo: () => ({ tab: { id: 'office-tab-2', contentId: 'dsh-resource://file/session/one/C:/workspace/memo.docx', navigation: {} , actions: { close: () => { closed = true } } } }),
  })))
  assert.match(document.body.textContent, /工作区 Word 内容/u)
  assert.equal(document.querySelector('.seal-workspace-word-paper .tiptap')?.getAttribute('contenteditable'), 'true')
  assert.equal(document.querySelector('.seal-workspace-word-paper')?.style.getPropertyValue('--page-width'), '500pt')
  assert.equal(document.querySelector('.seal-workspace-word-paper')?.style.getPropertyValue('--margin-left'), '55pt')
  await act(async () => document.querySelector('.tiptap').editor.commands.insertContent(' 已修改'))
  assert.equal([...document.querySelectorAll('button')].find(item => item.textContent === '保存').disabled, false)
  await act(async () => [...document.querySelectorAll('button')].find(item => item.textContent === '保存').click())
  await act(async () => new Promise(resolve => setTimeout(resolve, 0)))
  assert.equal(calls.find(item => item.method.endsWith('/save'))?.payload?.leaseId, 'word-lease')
  assert.equal(calls.find(item => item.method.endsWith('/save'))?.payload?.data, 'AQID')
  assert.equal(document.querySelector('.seal-workspace-word-tools').open, false)
  assert.equal(document.querySelector('.seal-workspace-word-tools > summary').textContent, '格式与插入')
  const opensBeforeForeignFile = calls.filter(item => item.method.endsWith('/open')).length
  await act(async () => root.render(React.createElement(editorTab.component, {
    sessionId: 'one', useTabInfo: () => ({ tab: { id: 'foreign', contentId: 'dsh-resource://file/session/two/C:/workspace/memo.docx', navigation: {} } }),
  })))
  assert.match(document.querySelector('[role="alert"]').textContent, /文档地址不可用/u)
  assert.equal(calls.filter(item => item.method.endsWith('/open')).length, opensBeforeForeignFile)
})
