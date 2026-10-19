import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { runInNewContext } from 'node:vm'
import { JSDOM } from 'jsdom'
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'

const require = createRequire(import.meta.url)
test('app card hides installation plus after install and restores it after uninstall', async t => {
  const dom = new JSDOM('<!doctype html><html><head></head><body><main></main></body></html>')
  const previous = { window: globalThis.window, document: globalThis.document }
  globalThis.window = dom.window; globalThis.document = dom.window.document; globalThis.IS_REACT_ACT_ENVIRONMENT = true
  const root = createRoot(document.querySelector('main'))
  const loaded = {}
  runInNewContext(await readFile(new URL('../lib/client.js', import.meta.url), 'utf8'), {
    window: { __ModuleLoader__: { load({ factory }) { Object.assign(loaded, factory(require)) } } },
    AbortController, document: dom.window.document, setTimeout, clearTimeout,
  })
  t.after(async () => { await act(async () => root.unmount()); dom.window.close(); Object.assign(globalThis, previous); delete globalThis.IS_REACT_ACT_ENVIRONMENT })
  let installed = false
  const calls = []
  const api = async action => {
    calls.push(action)
    if (action === 'install') installed = true
    if (action === 'uninstall') installed = false
    return { items: [{ id: 'dbx', name: 'DBX', installed, state: installed ? 'installed' : 'uninstalled', supported: true, mcpStatus: installed ? 'active' : 'uninstalled', toolCount: 20, version: '0.6.48', source: 'https://github.com/t8y2/dbx', description: '数据库工具', license: 'Apache-2.0' }] }
  }
  await act(async () => root.render(React.createElement(loaded.ApplicationsPage, { api, onBack() {} })))
  const button = text => [...document.querySelectorAll('button')].find(item => item.textContent.includes(text))
  assert(button('＋'))
  await act(async () => button('安装').click())
  assert.equal(button('＋'), undefined)
  assert(button('打开')); assert(button('卸载'))
  await act(async () => button('打开').click())
  assert(calls.includes('open'))
  await act(async () => button('卸载').click())
  assert(document.querySelector('[role="dialog"]'))
  await act(async () => button('确认卸载').click())
  assert(button('＋'))
  assert.equal(button('打开'), undefined)
  assert.equal(document.querySelector('[role="dialog"]'), null)
})
