import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { runInNewContext } from 'node:vm'
import test from 'node:test'
import { JSDOM } from 'jsdom'
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'

test('local project page uses SQLite RPC and opens a native session in the selected directory', async t => {
  const dom = new JSDOM('<!doctype html><html><head></head><body><div id="app"></div></body></html>')
  const oldWindow = globalThis.window, oldDocument = globalThis.document, oldFormData = globalThis.FormData
  globalThis.window = dom.window; globalThis.document = dom.window.document; globalThis.FormData = dom.window.FormData
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  const root = createRoot(document.getElementById('app'))
  t.after(async () => {
    await act(async () => root.unmount())
    dom.window.close(); globalThis.window = oldWindow; globalThis.document = oldDocument; globalThis.FormData = oldFormData
    delete globalThis.IS_REACT_ACT_ENVIRONMENT
  })
  const module = { exports: {} }
  runInNewContext(await readFile(new URL('../lib/client.js', import.meta.url), 'utf8'), {
    window: { __ModuleLoader__: { load({ id, factory }) { assert.equal(id, '@seal-harness/projects'); Object.assign(module.exports, factory(createRequire(import.meta.url))) } } },
    document: dom.window.document, AbortController,
  })
  const account = { user: { id: 'alice' }, accountId: 'alice', epoch: 1 }
  const auth = { getStatus: () => account, subscribe: () => () => {}, openLogin() {} }
  const projects = [{ id: 'one', name: '文档项目', rootPath: 'D:/workspace/project', description: '' }]
  const calls = [], conversations = []
  const request = async (action, payload) => {
    calls.push({ action, payload })
    if (action === 'list') return { items: [...projects] }
    if (action === 'delete') { projects.splice(0, projects.length); return { deleted: true } }
    return { id: 'new' }
  }
  await act(async () => root.render(React.createElement(module.exports.ProjectPanel, {
    auth, request, createConversation: async project => conversations.push(project.rootPath), onBack() {},
  })))
  await act(async () => { await Promise.resolve(); await Promise.resolve() })
  assert(document.querySelector('.seal-harness-local-projects.resource-page-shell .resource-page-nav__back'))
  assert.equal(document.querySelector('.resource-page-nav__path strong')?.textContent, '项目')
  assert.equal(document.querySelector('.resource-page-hero h1')?.textContent, '项目')
  assert.match(document.body.textContent, /文档项目/)
  assert.equal(calls[0].action, 'list')
  await act(async () => [...document.querySelectorAll('button')].find(button => button.textContent === '开始对话').click())
  assert.deepEqual(conversations, ['D:/workspace/project'])
  await act(async () => [...document.querySelectorAll('button')].find(button => button.textContent === '删除').click())
  assert(document.querySelector('[role=dialog]'))
  await act(async () => [...document.querySelectorAll('[role=dialog] button')].find(button => button.textContent === '确认删除').click())
  assert(calls.some(call => call.action === 'delete' && call.payload.id === 'one'))
})
