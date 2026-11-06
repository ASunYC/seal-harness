import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { runInNewContext } from 'node:vm'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { build } from 'tsdown'
import { JSDOM } from 'jsdom'
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { Simulate } from 'react-dom/test-utils'

test('workspace file actions create and import Office files in the selected directory', async t => {
  const temporary = await mkdtemp(join(tmpdir(), 'seal-office-file-actions-'))
  t.after(() => rm(temporary, { recursive: true, force: true }))
  await build({
    config: false, cwd: fileURLToPath(new URL('..', import.meta.url)),
    entry: { actions: 'src/workspace-file-actions.jsx' }, outDir: temporary,
    format: 'cjs', platform: 'browser', target: 'es2022', dts: false,
    deps: { neverBundle: [/^react(?:-dom)?(?:\/|$)/] },
  })
  const dom = new JSDOM('<!doctype html><html><body><div data-files-state="tree"><div id="root"></div><button data-files-reload>刷新</button><ul><li data-files-entry="file" data-files-path="C:\\work\\reports\\example.docx"><button>example.docx</button></li><li data-files-entry="file" data-files-path="C:\\work\\reports\\notes.txt"><button>notes.txt</button></li></ul></div></body></html>', { url: 'http://localhost' })
  const previous = { window: globalThis.window, document: globalThis.document }
  globalThis.window = dom.window
  globalThis.document = dom.window.document
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  const root = createRoot(document.getElementById('root'))
  t.after(async () => {
    await act(async () => root.unmount())
    dom.window.close()
    globalThis.window = previous.window
    globalThis.document = previous.document
    delete globalThis.IS_REACT_ACT_ENVIRONMENT
  })
  const module = { exports: {} }
  runInNewContext(await readFile(join(temporary, 'actions.cjs'), 'utf8'), {
    module, exports: module.exports, require: createRequire(import.meta.url),
    window: dom.window, document: dom.window.document, MutationObserver: dom.window.MutationObserver, btoa,
  })
  const calls = [], opened = [], previewed = []
  const api = async (action, payload) => { calls.push({ action, payload }); return action === 'saveCopy' ? { path: 'C:\\Users\\test\\Downloads\\example.docx' } : { kind: 'xlsx' } }
  await act(async () => root.render(React.createElement(module.exports.WorkspaceFileActions, {
    sessionId: 'session-one', absolutePath: 'C:\\work\\reports', api, onOpen: target => opened.push(target), onPreview: target => previewed.push(target),
  })))
  const createButton = document.querySelector('button[aria-label="新建 Office 文档"]')
  const importButton = document.querySelector('button[aria-label="导入 Office 文档"]')
  assert(createButton && importButton)
  assert.equal(createButton.textContent, '')
  assert.equal(importButton.textContent, '')
  assert.match(createButton.title, /Word、Excel、PPT/u)
  assert.match(importButton.title, /DOCX、XLSX、PPTX/u)
  assert.equal(createButton.querySelector('svg')?.getAttribute('aria-hidden'), 'true')
  assert.equal(importButton.querySelector('svg')?.getAttribute('aria-hidden'), 'true')
  await act(async () => createButton.click())
  const name = document.querySelector('input[maxlength="120"]')
  const kind = document.querySelector('select')
  await act(async () => Simulate.change(name, { target: { value: '预算' } }))
  await act(async () => Simulate.change(kind, { target: { value: 'xlsx' } }))
  await act(async () => [...document.querySelectorAll('button')].find(button => button.textContent === '创建').click())
  assert.deepEqual(JSON.parse(JSON.stringify(calls[0])), { action: 'create', payload: { sessionId: 'session-one', path: 'C:\\work\\reports\\预算.xlsx', content: '' } })
  assert.deepEqual(JSON.parse(JSON.stringify(opened[0])), { sessionId: 'session-one', path: 'C:\\work\\reports\\预算.xlsx' })

  const fileInput = document.querySelector('input[type=file]')
  let pickerOpened = 0
  fileInput.click = () => { pickerOpened++ }
  await act(async () => importButton.click())
  assert.equal(pickerOpened, 1)
  const bytes = Uint8Array.of(1, 2, 3)
  Object.defineProperty(fileInput, 'files', { configurable: true, value: [{
    name: 'existing.pptx', size: bytes.length,
    arrayBuffer: async () => bytes.buffer,
  }] })
  await act(async () => Simulate.change(fileInput, { target: fileInput }))
  assert.deepEqual(JSON.parse(JSON.stringify(calls[1])), { action: 'import', payload: { sessionId: 'session-one', path: 'C:\\work\\reports\\existing.pptx', data: 'AQID' } })
  assert.deepEqual(JSON.parse(JSON.stringify(opened[1])), { sessionId: 'session-one', path: 'C:\\work\\reports\\existing.pptx' })

  assert.equal(document.querySelectorAll('.seal-workspace-file-row-actions').length, 2)
  await act(async () => document.querySelector('button[aria-label="打开方式 example.docx"]').click())
  await act(async () => [...document.querySelectorAll('[role="menuitem"]')].find(button => button.textContent === '在右侧编辑').click())
  assert.deepEqual(JSON.parse(JSON.stringify(opened.at(-1))), { sessionId: 'session-one', path: 'C:\\work\\reports\\example.docx' })
  await act(async () => document.querySelector('button[aria-label="打开方式 notes.txt"]').click())
  await act(async () => [...document.querySelectorAll('[role="menuitem"]')].find(button => button.textContent === '在右侧打开').click())
  assert.deepEqual(JSON.parse(JSON.stringify(previewed.at(-1))), { sessionId: 'session-one', path: 'C:\\work\\reports\\notes.txt' })
  await act(async () => document.querySelector('button[aria-label="下载 example.docx"]').click())
  assert.deepEqual(JSON.parse(JSON.stringify(calls.at(-1))), { action: 'saveCopy', payload: { sessionId: 'session-one', path: 'C:\\work\\reports\\example.docx' } })
  let refreshes = 0
  document.querySelector('[data-files-reload]').addEventListener('click', () => refreshes++)
  dom.window.confirm = () => false
  const beforeCancel = calls.length
  await act(async () => document.querySelector('button[aria-label="删除 notes.txt"]').click())
  assert.equal(calls.length, beforeCancel)
  dom.window.confirm = () => true
  await act(async () => document.querySelector('button[aria-label="删除 notes.txt"]').click())
  assert.deepEqual(JSON.parse(JSON.stringify(calls.at(-1))), { action: 'trash', payload: { sessionId: 'session-one', path: 'C:\\work\\reports\\notes.txt' } })
  assert.equal(refreshes, 1)
})
