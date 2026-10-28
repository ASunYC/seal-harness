import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { runInNewContext } from 'node:vm'
import { JSDOM } from 'jsdom'
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { Simulate } from 'react-dom/test-utils'

const require = createRequire(import.meta.url)
async function load(document) {
  const loaded = {}
  runInNewContext(await readFile(new URL('../lib/client.js', import.meta.url), 'utf8'), {
    window: { __ModuleLoader__: { load({ factory }) { Object.assign(loaded, factory(require)) } } }, document, AbortController, setInterval, clearInterval,
  })
  return loaded
}

test('ACP page configures, checks, starts, stops and explicitly deletes a runner without revealing old env', async () => {
  const dom = new JSDOM('<html><head></head><body><div id="app"></div></body></html>')
  const previous = { window: globalThis.window, document: globalThis.document }
  globalThis.window = dom.window; globalThis.document = dom.window.document; globalThis.IS_REACT_ACT_ENVIRONMENT = true
  const loaded = await load(document), calls = []
  let items = [], runs = []
  const api = async (action, payload) => {
    calls.push({ action, payload })
    if (action === 'snapshot') return { items, runs, note: '启用不等于协议就绪。' }
    if (action === 'save') { items = [{ id: 'custom', name: payload.name, note: '自定义', configured: true, enabled: true, config: payload.config, environmentNames: ['API_KEY'], discovery: { found: true, message: '待检查' }, check: null }]; return { id: 'custom' } }
    if (action === 'check') { items[0].check = { ready: true }; return { ready: true } }
    if (action === 'run') { runs = [{ id: 'job', kind: 'task', runnerName: 'Test', startedAt: Date.now(), status: 'running', output: 'partial' }]; return runs[0] }
    if (action === 'cancel') { runs = [{ ...runs[0], status: 'cancelled' }]; return runs[0] }
    if (action === 'delete') { items = []; return { deleted: true } }
    return {}
  }
  const root = createRoot(document.querySelector('#app'))
  const click = async text => {
    const button = [...document.querySelectorAll('button')].find(item => item.textContent === text)
    assert(button, text); await act(async () => button.click())
  }
  const input = async (label, value) => {
    const element = document.querySelector(`[aria-label="${label}"]`)
    assert(element, label)
    await act(async () => { element.value = value; Simulate.change(element, { target: { value } }) })
  }
  try {
    await act(async () => root.render(React.createElement(loaded.AcpPanel, { api })))
    assert.match(document.body.textContent, /暂无操作记录/)
    await click('添加 Runner')
    await input('Runner 名称', 'Test')
    await input('可执行程序', 'node')
    await input('工作目录', 'C:\\project')
    await input('环境变量', '{"API_KEY":"new-key"}')
    await act(async () => document.querySelector('form').dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true })))
    assert.equal(calls.find(item => item.action === 'save').payload.environment.API_KEY, 'new-key')
    await click('配置')
    assert.equal(document.querySelector('[aria-label="环境变量"]').value, '')
    assert.match(document.querySelector('[role="dialog"]').textContent, /API_KEY/)
    await click('取消')
    await click('检查 Test')
    assert.match(document.body.textContent, /ACP 检查通过/)
    await click('运行 Test')
    await input('ACP 任务', 'inspect project')
    await act(async () => document.querySelector('form').dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true })))
    assert.match(document.body.textContent, /partial/)
    await click('停止任务')
    assert.match(document.body.textContent, /已取消/)
    await click('删除配置')
    assert.equal(calls.some(item => item.action === 'delete'), false)
    await click('确认删除')
    assert.equal(calls.filter(item => item.action === 'delete').length, 1)
  } finally {
    await act(async () => root.unmount()); dom.window.close()
    globalThis.window = previous.window; globalThis.document = previous.document; delete globalThis.IS_REACT_ACT_ENVIRONMENT
  }
})

test('client joins late navigation as a primary ACP page and unregisters cleanly', async () => {
  const dom = new JSDOM('<html><head></head><body></body></html>'), loaded = await load(dom.window.document), entries = [], effects = []
  let attach
  loaded.apply({ connection: {}, effect(callback) { effects.push(callback()) }, inject(names, callback) { assert.deepEqual(Array.from(names), ['sealHarnessNavigation']); attach = callback } })
  attach({ effect(callback) { effects.push(callback()) }, sealHarnessNavigation: { register(entry) { entries.push(entry); return () => entries.pop() } } })
  assert.equal(entries[0].id, 'acp'); assert.equal(entries[0].primary, true); assert.equal(entries[0].order, 130)
  for (const dispose of effects) dispose?.()
  assert.equal(entries.length, 0); dom.window.close()
})
