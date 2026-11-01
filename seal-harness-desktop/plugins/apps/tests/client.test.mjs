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
  assert.equal(document.querySelector('.seal-apps-heading h1')?.textContent, '应用')
  assert.equal(document.querySelector('.seal-apps-heading p')?.textContent, '浏览、安装和管理本机应用。')
  assert.equal(document.querySelector('.seal-apps-nav button, .seal-apps-nav span'), null)
  assert.deepEqual([...document.querySelectorAll('.seal-apps-tabs button')].map(item => item.textContent), ['系统', '个人'])
  assert.equal(document.querySelector('[aria-label="已安装应用"] details').open, false)
  assert.match(document.querySelector('[aria-label="已安装应用"] summary').textContent, /已安装\s*0/)
  assert(button('＋'))
  await act(async () => button('安装').click())
  assert.equal(button('＋'), undefined)
  assert.match(document.querySelector('[aria-label="已安装应用"] summary').textContent, /已安装\s*1/)
  assert.equal(document.querySelector('[aria-label="已安装应用"] .resource-installed__icon')?.title, 'DBX')
  await act(async () => button('个人').click())
  assert.equal(document.querySelector('[aria-label="已安装应用"] details').open, false)
  assert.match(document.querySelector('[aria-label="已安装应用"] summary').textContent, /已安装\s*0/)
  await act(async () => button('系统').click())
  assert.equal(document.querySelector('[aria-label="已安装应用"] details').open, false)
  assert(button('打开')); assert(button('卸载'))
  await act(async () => button('打开').click())
  assert(calls.includes('open'))
  await act(async () => button('卸载').click())
  assert(document.querySelector('[role="dialog"]'))
  await act(async () => button('确认卸载').click())
  assert(button('＋'))
  assert.match(document.querySelector('[aria-label="已安装应用"] summary').textContent, /已安装\s*0/)
  assert.equal(button('打开'), undefined)
  assert.equal(document.querySelector('[role="dialog"]'), null)
})
