import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { runInNewContext } from 'node:vm'
import test from 'node:test'
import { JSDOM } from 'jsdom'
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'

const require = createRequire(import.meta.url)

test('WeKnora appears in Seal settings and opens native embedding model configuration', async t => {
  const dom = new JSDOM('<!doctype html><html><head></head><body><main></main></body></html>')
  const previous = { document: globalThis.document, window: globalThis.window }
  globalThis.document = dom.window.document
  globalThis.window = dom.window
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  const root = createRoot(document.querySelector('main'))
  const entries = []
  const effects = []
  const ctx = {
    effect(callback) { effects.push(callback()) },
    connection: { rpc: { async call() { return { ok: true, value: { baseUrl: 'http://localhost:8080/api/v1', configured: false } } } } },
    slots: {
      inject(_name, callback) { callback() },
      register(options, component) { entries.push({ options, component }) },
    },
  }
  const loaded = {}
  runInNewContext(await readFile(new URL('../lib/settings-client.js', import.meta.url), 'utf8'), {
    window: { __ModuleLoader__: { load({ id, factory }) {
      assert.equal(id, '@seal-harness/weknora')
      Object.assign(loaded, factory(require))
    } } },
    document: dom.window.document,
    URL,
    AbortController,
  })

  t.after(async () => {
    await act(async () => root.unmount())
    for (const dispose of effects) dispose?.()
    dom.window.close()
    globalThis.document = previous.document
    globalThis.window = previous.window
    delete globalThis.IS_REACT_ACT_ENVIRONMENT
  })

  loaded.apply(ctx)
  const section = entries.find(entry => entry.options.id === 'weknora')
  assert.equal(section.options.name, 'settings.section')
  assert.equal(section.options.label(), 'WeKnora')
  await act(async () => root.render(React.createElement(section.component)))
  const links = [...document.querySelectorAll('a')].map(link => link.href)
  assert.ok(links.includes('http://localhost/platform/settings?section=models'))
  assert.ok(links.includes('http://localhost/platform/settings?section=integration-api'))
  assert.match(document.querySelector('main').textContent, /尚未配置访问令牌/)
  assert.equal(document.querySelector('input[type="password"]').value, '')
  assert.equal(document.querySelector('input[type="url"]').value, 'http://localhost:8080/api/v1')
  assert.match(document.querySelector('main').textContent, /Embedding/)
  assert.match(document.querySelector('main').textContent, /外部问答 LLM/)
})
