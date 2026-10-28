import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { runInNewContext } from 'node:vm'
import test from 'node:test'
import { Context } from '@deepseek-ai/cordis'
import { JSDOM } from 'jsdom'
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { Simulate } from 'react-dom/test-utils'
import { summarize } from '../src/query.js'

const require = createRequire(import.meta.url)
const { build } = await import(pathToFileURL(require.resolve('tsdown')).href)
await build({ config: false, cwd: fileURLToPath(new URL('..', import.meta.url)), entry: { client: 'src/client.jsx' }, outDir: 'lib', clean: false, dts: false,
  format: 'cjs', platform: 'browser', target: 'es2022', deps: { neverBundle: [/^react(?:-dom)?(?:\/|$)/] },
  define: { 'process.env.NODE_ENV': '"production"' },
  outputOptions: { entryFileNames: 'client.js', banner: 'window.__ModuleLoader__.load({ id: "@seal-harness/token-stats", factory: (require) => {', footer: 'return module.exports; } });', intro: 'var module = { exports: {} }; var exports = module.exports;' },
})

function browser(t) {
  const dom = new JSDOM('<!doctype html><html><head></head><body><div id="root"></div></body></html>')
  const previous = { window: globalThis.window, document: globalThis.document }
  globalThis.window = dom.window; globalThis.document = dom.window.document; globalThis.IS_REACT_ACT_ENVIRONMENT = true
  const loaded = {}
  runInNewContext(readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8'), {
    window: { __ModuleLoader__: { load({ id, factory }) { assert.equal(id, '@seal-harness/token-stats'); Object.assign(loaded, factory(require)) } } },
    document: dom.window.document, AbortController, setTimeout,
  })
  const root = createRoot(document.getElementById('root'))
  t.after(async () => { await act(async () => root.unmount()); dom.window.close(); globalThis.window = previous.window; globalThis.document = previous.document; delete globalThis.IS_REACT_ACT_ENVIRONMENT })
  return { loaded, dom, root }
}

test('token page switches dimensions and filters, exports Excel and handles real empty/error responses', async t => {
  const { loaded, root } = browser(t)
  const records = [
    { status: 'recorded', provider: 'p', model: 'model-a', preset_id: 'standard', completed_at: Date.now(), input_tokens: 100, output_tokens: 20, total_tokens: 170, cache_read_tokens: 50, cache_write_tokens: 0, reasoning_tokens: 5 },
    { status: 'recorded', provider: 'p', model: 'model-b', preset_id: 'seal-harness-expert-writer', completed_at: Date.now(), input_tokens: 5, output_tokens: 5, total_tokens: 10, cache_read_tokens: 0, cache_write_tokens: 0, reasoning_tokens: null },
  ]
  const requests = [], downloads = []
  const api = async (action, query) => {
    requests.push({ action, query })
    if (action === 'export') return { filename: 'usage.xlsx', base64: 'UEs=', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }
    if (query.expert === 'missing') return summarize([], query)
    return summarize(records, query)
  }
  await act(async () => root.render(React.createElement(loaded.TokenStatsPanel, { api, onDownload: file => downloads.push(file) })))
  assert.match(document.querySelector('.seal-token-cards').textContent, /180/)
  const click = async text => { const button = [...document.querySelectorAll('button')].find(item => item.textContent === text); assert(button); await act(async () => button.click()) }
  await click('按模型')
  assert.equal(requests.at(-1).query.view, 'model')
  assert.equal(document.querySelectorAll('tbody tr').length, 2)
  const select = document.querySelector('select[aria-label="筛选专家"]')
  await act(async () => Simulate.change(select, { target: { value: 'standard' } }))
  assert.equal(document.querySelectorAll('tbody tr').length, 1)
  assert.match(document.querySelector('.seal-token-cards').textContent, /170/)
  await click('导出 Excel')
  assert.equal(requests.at(-1).query.expert, 'standard')
  assert.equal(downloads[0].filename, 'usage.xlsx')
  await act(async () => Simulate.change(select, { target: { value: 'missing' } }))
  assert.match(document.body.textContent, /区间内无可核对/)
  const failure = async () => { throw new Error('统计服务暂不可用') }
  await act(async () => root.render(React.createElement(loaded.TokenStatsPanel, { api: failure })))
  assert.match(document.querySelector('[role="alert"]').textContent, /暂不可用/)
  assert.equal(document.querySelector('.seal-token-cards'), null)
})

test('Client registers one primary menu when navigation arrives late and cleans it on disposal', async t => {
  const { loaded } = browser(t)
  const ctx = new Context(), registrations = []
  t.after(() => ctx.fiber.dispose())
  ctx.provide('slots', {})
  ctx.provide('connection', {})
  ctx.provide('sealHarnessAuthClient', { getStatus: () => ({ user: null }), subscribe: () => () => {} })
  const fiber = await ctx.plugin(loaded)
  assert.equal(registrations.length, 0)
  ctx.provide('sealHarnessNavigation', { register(entry) { registrations.push(entry); return () => registrations.splice(registrations.indexOf(entry), 1) } })
  await new Promise(resolve => setTimeout(resolve, 0))
  assert.equal(registrations.length, 1)
  assert.equal(registrations[0].id, 'token-stats')
  assert.equal(registrations[0].primary, true)
  assert.equal(registrations[0].order, 100)
  await fiber.dispose()
  assert.equal(registrations.length, 0)
})
