import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { runInNewContext } from 'node:vm'
import { JSDOM } from 'jsdom'
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'

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

test('built local resource clients register and unload independent panels', async t => {
  const dom = new JSDOM('<main></main>')
  const oldWindow = globalThis.window, oldDocument = globalThis.document
  globalThis.window = dom.window; globalThis.document = dom.window.document; globalThis.IS_REACT_ACT_ENVIRONMENT = true
  dom.window.HTMLDialogElement.prototype.showModal = function () { this.open = true }
  dom.window.HTMLDialogElement.prototype.close = function () { this.open = false }
  const factories = new Map(), registered = [], disposers = new Map(), calls = []
  for (const name of ['store', 'connectors', 'skills', 'experts']) {
    runInNewContext(readFileSync(new URL(`../../${name}/lib/client.js`, import.meta.url), 'utf8'), {
      window: { __ModuleLoader__: { load: ({ id, factory }) => { assert.equal(id, `@seal-harness/${name}`); factories.set(name, factory(require)) } } },
      document: dom.window.document, atob, AbortController, setTimeout, clearTimeout,
    })
  }
  const status = { user: { name: '本地用户' }, accountId: 'local-user', epoch: 1 }
  const workspaceSnapshot = { items: [] }
  function mount(name) {
    const cleanups = []
    disposers.set(name, cleanups)
    factories.get(name).apply({
      sealHarnessAuthClient: { getStatus: () => status, subscribe: () => () => {}, openLogin: () => {} },
      layout: { selectPanel: () => {} },
      workspaces: { list: { getSnapshot: () => workspaceSnapshot, subscribe: () => () => {} } },
      effect: callback => cleanups.push(callback()),
      slots: { inject: (_, callback) => callback(), register: (slot, component) => {
        const item = { slot, component, owner: name }
        registered.push(item)
        cleanups.push(() => registered.splice(registered.indexOf(item), 1))
      } },
      connection: { rpc: { call: async (_channel, endpoint) => {
        endpoint = endpoint.replace('seal-harness-capabilities/', '')
        calls.push(endpoint)
        const value = endpoint === 'skills/list' ? { revision: 0, skills: [] }
          : endpoint === 'skills/sources' ? { sources: [] }
            : endpoint === 'experts/list' ? { items: [] }
              : endpoint === 'connectors/list' ? { items: [] }
                : []
        return { ok: true, value }
      } } },
    })
  }
  for (const name of factories.keys()) mount(name)
  const panels = registered.filter(item => item.slot.name === 'main')
  assert.deepEqual(panels.map(item => item.slot.key), ['seal-harness-connectors', 'seal-harness-skills', 'seal-harness-experts'])
  assert.equal(document.querySelectorAll('style').length, 3)
  const root = createRoot(document.querySelector('main'))
  t.after(async () => {
    await act(async () => root.unmount())
    for (const cleanups of disposers.values()) for (const dispose of cleanups) dispose?.()
    dom.window.close(); globalThis.window = oldWindow; globalThis.document = oldDocument
    delete globalThis.IS_REACT_ACT_ENVIRONMENT
  })
  for (const panel of panels) {
    const before = calls.length
    await act(async () => root.render(React.createElement(panel.component)))
    assert.equal(document.querySelector('[role=alert]'), null, panel.owner)
    if (panel.owner === 'skills' || panel.owner === 'experts')
      assert.equal(calls.slice(before).some(endpoint => endpoint.startsWith('store/')), false, `${panel.owner} stays local`)
  }
  assert(calls.includes('skills/list'))
  assert(calls.includes('experts/list'))
  assert(calls.includes('connectors/list'))
  await act(async () => root.render(null))
  for (const name of ['skills', 'experts', 'connectors']) {
    for (const dispose of disposers.get(name)) dispose?.()
    disposers.delete(name)
    assert.equal(registered.filter(item => item.slot.name === 'main').length, 2)
    mount(name)
    assert.equal(registered.filter(item => item.slot.name === 'main').length, 3)
  }
})
