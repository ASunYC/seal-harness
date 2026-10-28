import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { runInNewContext } from 'node:vm'
import test from 'node:test'
import { setTimeout as delay } from 'node:timers/promises'
import { JSDOM } from 'jsdom'
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { Simulate } from 'react-dom/test-utils'
import { fixture } from './fixture.mjs'

const require = createRequire(import.meta.url)
const loadClient = document => {
  const loaded = {}
  runInNewContext(readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8'), {
    window: { __ModuleLoader__: { load({ id, factory }) { assert.equal(id, '@seal-harness/knowledge'); Object.assign(loaded, factory(require)) } } },
    document, AbortController, FileReader: document.defaultView.FileReader, URL,
  })
  return loaded
}

test('knowledge page performs library/text/search/preview/delete through controlled HTTP and shows real permission errors', async t => {
  const f = await fixture(t)
  await f.configure('ui-fixture-key')
  const dom = new JSDOM('<!doctype html><div id="root"></div>')
  const previous = { window: globalThis.window, document: globalThis.document }
  globalThis.window = dom.window; globalThis.document = dom.window.document; globalThis.IS_REACT_ACT_ENVIRONMENT = true
  const root = createRoot(document.getElementById('root'))
  t.after(async () => {
    await act(async () => root.unmount())
    dom.window.close(); Object.assign(globalThis, previous); delete globalThis.IS_REACT_ACT_ENVIRONMENT
  })
  const loaded = loadClient(document)
  const api = async (action, payload, signal) => {
    signal?.throwIfAborted()
    const result = await f.rpc(action, payload)
    signal?.throwIfAborted()
    if (!result.ok) throw new Error(result.error.message)
    return result.value
  }
  const waitFor = async predicate => {
    for (let i = 0; i < 100; i++) { if (predicate()) return; await act(async () => delay(10)) }
    assert.fail('界面未达到预期状态')
  }
  const click = async label => {
    const button = [...document.querySelectorAll('button')].find(item => item.textContent.trim() === label || item.getAttribute('aria-label') === label)
    assert(button, `missing ${label}`)
    await act(async () => button.click())
  }
  const change = async (element, value) => {
    assert(element)
    await act(async () => {
      const prototype = element.tagName === 'TEXTAREA' ? dom.window.HTMLTextAreaElement.prototype : dom.window.HTMLInputElement.prototype
      Object.getOwnPropertyDescriptor(prototype, 'value').set.call(element, value)
      Simulate.change(element, { target: { value } })
    })
  }
  const submit = async selector => { await act(async () => document.querySelector(selector).dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true }))) }
  let connectionClicks = 0
  await act(async () => root.render(React.createElement(loaded.KnowledgePanel, { api, openConnection: () => connectionClicks++ })))
  await waitFor(() => document.body.textContent.includes('当前 Key 可见范围内还没有知识库'))
  for (const label of ['刷新', '知识库设置']) {
    const button = document.querySelector(`.seal-kb-header button[aria-label="${label}"]`)
    assert.equal(button.title, label)
    assert.equal(button.textContent.trim(), '')
    assert(button.querySelector('svg[aria-hidden="true"]'))
  }
  await click('新建知识库')
  await change(document.querySelector('.seal-kb-editor input[required]'), '研发指南')
  await change(document.querySelector('.seal-kb-editor input[list]'), 'embed-1')
  await submit('.seal-kb-editor')
  await waitFor(() => document.querySelector('.seal-kb-workspace h2')?.textContent === '研发指南')
  await click('导入文本')
  await change(document.querySelector('.seal-kb-editor input'), '星图说明')
  await change(document.querySelector('.seal-kb-editor textarea'), '海豹在这里查找星图')
  await submit('.seal-kb-editor')
  await waitFor(() => document.querySelector('.seal-kb-document-list')?.textContent.includes('星图说明'))
  assert.match(document.querySelector('.seal-kb-document-list').textContent, /等待解析/u)
  await change(document.querySelector('[aria-label="检索知识库"]'), '星图')
  await submit('.seal-kb-search')
  await waitFor(() => document.querySelector('.seal-kb-results')?.textContent.includes('海豹在这里查找星图'))
  assert.match(document.querySelector('.seal-kb-results').textContent, /来源：指南/u)
  await click('查看来源文档')
  await waitFor(() => document.querySelector('.seal-kb-reader pre'))
  assert.match(document.querySelector('.seal-kb-reader').textContent, /海豹在这里查找星图/u)
  await click('关闭文档'); await click('返回文档'); await click('删除')
  assert(document.querySelector('[role="alertdialog"]'))
  assert.equal(f.requests.some(request => request.method === 'DELETE'), false, '打开确认框不能立即删除')
  await click('确认删除')
  await waitFor(() => document.querySelector('.seal-kb-document-list')?.textContent.includes('当前知识库还没有文档'))
  await click('知识库设置')
  assert.match(document.querySelector('[role="dialog"]').textContent, /不在本机重复下载 ONNX/u)
  assert.equal(document.querySelector('[role="dialog"] a').href, `${new URL(f.baseUrl).origin}/platform/settings?section=models`)
  await click('打开连接设置')
  assert.equal(connectionClicks, 1)
  assert.equal(document.querySelector('[role="dialog"]'), null)
  f.deny('readonly')
  await click('新建知识库')
  await waitFor(() => document.querySelector('.seal-kb-editor')?.textContent.includes('模型列表暂不可用'))
  assert.match(document.querySelector('[aria-label="知识库列表"]').textContent, /研发指南/u)
  assert.equal(document.querySelector('.seal-kb-header h1').textContent, '知识库')
  await click('取消')
  await change(document.querySelector('[aria-label="检索知识库"]'), '只读检索')
  await submit('.seal-kb-search')
  await waitFor(() => document.querySelector('.seal-kb-results')?.textContent.includes('海豹在这里查找星图'))
  f.deny(false)
  await click('删除知识库'); await click('确认删除')
  await waitFor(() => document.body.textContent.includes('当前 Key 可见范围内还没有知识库'))
  f.deny(true)
  await click('新建知识库')
  await change(document.querySelector('.seal-kb-editor input[required]'), '没有权限')
  await submit('.seal-kb-editor')
  await waitFor(() => document.querySelector('[role="alert"]')?.textContent.includes('manage_kbs'))
  assert(document.querySelector('.seal-kb-editor'), '失败时保留编辑内容')
  assert.equal(document.body.textContent.includes('ui-fixture-key'), false)
})

test('knowledge Client registers a primary panel through late navigation and cleans up with its injected lifecycle', () => {
  const dom = new JSDOM('<!doctype html><head></head><body></body>')
  const loaded = loadClient(dom.window.document)
  const effects = [], registrations = []
  let callback
  loaded.apply({
    connection: {},
    sealHarnessAuthClient: {},
    effect(effect) { effects.push(effect()) },
    inject(names, injected) { assert.deepEqual(Array.from(names), ['sealHarnessNavigation']); callback = injected },
  })
  assert.equal(registrations.length, 0)
  let disposed = false
  callback({ effect(effect) { effects.push(effect()) }, sealHarnessNavigation: { register(entry) { registrations.push(entry); return () => { disposed = true } } } })
  assert.equal(registrations[0].id, 'knowledge')
  assert.equal(registrations[0].primary, true)
  assert.equal(registrations[0].order, 110)
  for (const dispose of effects) dispose?.()
  assert.equal(disposed, true)
  assert.equal(dom.window.document.querySelector('style'), null)
  dom.window.close()
})

test('unconfigured or unreachable service is not presented as an empty connected library; late account results are discarded', async t => {
  const dom = new JSDOM('<!doctype html><div id="root"></div>')
  const previous = { window: globalThis.window, document: globalThis.document }
  globalThis.window = dom.window; globalThis.document = dom.window.document; globalThis.IS_REACT_ACT_ENVIRONMENT = true
  const root = createRoot(document.getElementById('root'))
  t.after(async () => { await act(async () => root.unmount()); dom.window.close(); Object.assign(globalThis, previous); delete globalThis.IS_REACT_ACT_ENVIRONMENT })
  const loaded = loadClient(document)
  const unconfigured = async action => { assert.equal(action, 'status'); return { configured: false, baseUrl: 'http://localhost:8080/api/v1' } }
  await act(async () => root.render(React.createElement(loaded.KnowledgePanel, { key: 'unconfigured', api: unconfigured })))
  assert.match(document.body.textContent, /连接你的知识库/u)
  assert.equal([...document.querySelectorAll('button')].find(item => item.textContent === '新建知识库').disabled, true)
  const unreachable = async action => { if (action === 'status') return { configured: true, baseUrl: 'http://localhost:8080/api/v1' }; throw new Error('无法连接 WeKnora') }
  await act(async () => root.render(React.createElement(loaded.KnowledgePanel, { key: 'unreachable', api: unreachable })))
  assert.match(document.querySelector('[role="alert"]').textContent, /无法连接/u)
  assert.doesNotMatch(document.body.textContent, /可见范围内还没有知识库/u)
  let release
  const stale = async action => { assert.equal(action, 'status'); return new Promise(resolve => { release = resolve }) }
  await act(async () => root.render(React.createElement(loaded.KnowledgePanel, { key: 'owner-1', api: stale })))
  await act(async () => root.render(React.createElement(loaded.KnowledgePanel, { key: 'owner-2', api: unconfigured })))
  await act(async () => release({ configured: true, baseUrl: 'http://old-account.invalid' }))
  assert.match(document.body.textContent, /连接你的知识库/u)
  assert.equal(document.body.textContent.includes('old-account'), false)
})
