import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { runInNewContext } from 'node:vm'
import { JSDOM } from 'jsdom'
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { createNavigationState } from '../../navigation/src/model.js'

const require = createRequire(import.meta.url)

test('专家和连接器内容容器保持统一留白', () => {
  for (const [name, path, className] of [
    ['专家', '../../experts/src/styles.js', 'experts-page__content'],
    ['连接器', '../../connectors/src/styles.js', 'capability-page__content'],
  ]) {
    const css = readFileSync(new URL(path, import.meta.url), 'utf8')
    const rule = css.match(new RegExp(`\\.${className}\\s*\\{([^}]*)\\}`))?.[1] ?? ''
    assert.match(rule, /max-width:\s*1740px/, name)
    assert.match(rule, /padding:\s*var\(--sp-5\) var\(--sp-6\) var\(--sp-7\)/, name)
  }
})

test('built resource clients contribute independent home pages and clean up on unload', async t => {
  const dom = new JSDOM('<!doctype html><html><head></head><body><main></main></body></html>')
  const oldWindow = globalThis.window, oldDocument = globalThis.document
  globalThis.window = dom.window; globalThis.document = dom.window.document; globalThis.IS_REACT_ACT_ENVIRONMENT = true
  dom.window.HTMLDialogElement.prototype.showModal = function () { this.open = true }
  dom.window.HTMLDialogElement.prototype.close = function () { this.open = false }
  const navigation = createNavigationState(), factories = new Map(), disposers = new Map(), calls = []
  const workspaceSnapshot = { items: [] }
  const authStatus = { user: null, epoch: 0 }
  for (const name of ['connectors', 'skills', 'experts']) {
    runInNewContext(readFileSync(new URL(`../../${name}/lib/client.js`, import.meta.url), 'utf8'), {
      window: { __ModuleLoader__: { load: ({ id, factory }) => { assert.equal(id, `@seal-harness/${name}`); factories.set(name, factory(require)) } } },
      document: dom.window.document, atob, AbortController, setTimeout, clearTimeout,
    })
  }
  function mount(name) {
    const cleanups = []
    disposers.set(name, cleanups)
    factories.get(name).apply({
      sealHarnessNavigation: navigation,
      sealHarnessAuthClient: { getStatus: () => authStatus, subscribe: () => () => {}, openLogin() {} },
      layout: { selectPanel() {} },
      workspaces: { list: { getSnapshot: () => workspaceSnapshot, subscribe: () => () => {} } },
      effect: callback => cleanups.push(callback()),
      slots: { inject() { throw new Error('resource must not register a first-level sidebar or main panel') } },
      connection: { rpc: { call: async (_channel, endpoint) => {
        endpoint = endpoint.replace('seal-harness-capabilities/', '')
        calls.push(endpoint)
        const value = endpoint === 'skills/list' ? { revision: 0, skills: [] }
          : endpoint === 'skills/sources' ? { sources: [] }
            : { items: [] }
        return { ok: true, value }
      } } },
    })
  }
  for (const name of factories.keys()) mount(name)
  const root = createRoot(document.querySelector('main'))
  t.after(async () => {
    await act(async () => root.unmount())
    for (const cleanups of disposers.values()) for (const dispose of cleanups) dispose?.()
    navigation.dispose(); dom.window.close(); globalThis.window = oldWindow; globalThis.document = oldDocument
    delete globalThis.IS_REACT_ACT_ENVIRONMENT
  })
  assert.deepEqual(navigation.getSnapshot().entries.map(entry => entry.id), ['experts', 'skills', 'connectors'])
  assert.equal(document.querySelectorAll('style').length, 3)
  for (const entry of navigation.getSnapshot().entries) {
    await act(async () => root.render(React.createElement(entry.Panel)))
    assert.equal(document.querySelector('[role=alert]'), null, entry.id)
  }
  assert(calls.includes('skills/list'))
  assert(calls.includes('experts/list'))
  assert(calls.includes('connectors/list'))
  await act(async () => root.render(null))
  navigation.select('skills')
  for (const dispose of disposers.get('skills')) dispose?.()
  disposers.delete('skills')
  assert.equal(navigation.getSnapshot().selectedId, null)
  assert.deepEqual(navigation.getSnapshot().entries.map(entry => entry.id), ['experts', 'connectors'])
  mount('skills')
  assert.deepEqual(navigation.getSnapshot().entries.map(entry => entry.id), ['experts', 'skills', 'connectors'])
})
