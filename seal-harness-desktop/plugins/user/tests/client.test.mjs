import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { runInNewContext } from 'node:vm'
import { fileURLToPath } from 'node:url'
import { build } from 'tsdown'
import { JSDOM } from 'jsdom'
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'

test('user plugin provides a signed-in footer action and opens account detail', async t => {
  const cwd = fileURLToPath(new URL('..', import.meta.url))
  await build({ config: false, cwd, entry: { client: 'src/client.jsx' }, outDir: '.build', format: 'cjs', platform: 'browser', target: 'es2022', dts: false,
    deps: { neverBundle: [/^react(?:-dom)?(?:\/|$)/] }, define: { 'process.env.NODE_ENV': JSON.stringify('production') },
    outputOptions: { entryFileNames: 'client.js' },
  })
  const dom = new JSDOM('<!doctype html><html><head></head><body><main></main><div class="footArea"><div class="footerActions"><aside data-slot="sidebar.footer.action"><button class="market">市场</button><div class="userMount"></div></aside></div><div class="settingsArea"><div data-slot="sidebar.settings"></div></div></div></body></html>')
  const oldWindow = globalThis.window, oldDocument = globalThis.document
  globalThis.window = dom.window; globalThis.document = dom.window.document
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  const module = { exports: {} }
  runInNewContext(await readFile(new URL('../.build/client.js', import.meta.url), 'utf8'), {
    module, exports: module.exports, require: createRequire(import.meta.url), document, window, setInterval, clearInterval,
  })
  const entries = [], disposers = [], navigated = [], calls = [], listeners = new Set()
  let status = { user: { id: 'user-1', username: 'alice', displayName: 'Alice', role: 'guest', status: 'active' }, accountId: 'account-1', persisted: true,
    services: { entries: [{ key: 'identityBaseUrl', value: 'https://agent.geovisearth.com/' }] } }
  const originalUser = status.user
  const auth = {
    getStatus: () => status,
    openLogin: () => navigated.push('seal-harness-identity'),
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener) },
    async call(action) {
      calls.push(action)
      if (action === 'logout') { status = { ...status, user: null, accountId: null }; for (const listener of listeners) listener(status); return { remoteRevoked: true } }
      return status
    },
  }
  module.exports.apply({ effect: callback => disposers.push(callback()), get: key => key === 'sealHarnessAuthClient' ? auth : undefined,
    sealHarnessAuthClient: auth, layout: { selectPanel: panel => navigated.push(panel) },
    slots: { inject: (_, callback) => callback(), register: (slot, component) => { entries.push({ slot, component }); return () => {} } },
  })
  const footer = entries.find(entry => entry.slot.name === 'sidebar.footer.action')
  const detail = entries.find(entry => entry.slot.name === 'main')
  assert.equal(footer.slot.id, 'seal-harness-user')
  assert.equal(detail.slot.key, 'seal-harness-user')
  assert.doesNotMatch(document.querySelector('style').textContent, /display:contents\s*!important/, 'product styles must not flatten Desktop footer seats')
  const footerRoot = createRoot(document.querySelector('.userMount'))
  const detailRoot = createRoot(document.querySelector('main'))
  t.after(async () => {
    await act(async () => { footerRoot.unmount(); detailRoot.unmount() })
    disposers.forEach(dispose => dispose())
    dom.window.close(); globalThis.window = oldWindow; globalThis.document = oldDocument
    delete globalThis.IS_REACT_ACT_ENVIRONMENT
  })
  await act(async () => footerRoot.render(React.createElement(footer.component, { wide: true })))
  const userButton = document.querySelector('.seal-harness-user-footer')
  assert.match(userButton.textContent, /Alice/)
  assert.equal(window.getComputedStyle(userButton).marginLeft, '-2px', 'user action uses the same left edge as the Settings trigger row')
  assert.equal(userButton.querySelector('svg').getAttribute('width'), '16', 'wide user icon matches the Settings icon size')
  assert.equal(userButton.closest('.footArea').lastElementChild.contains(userButton), true, 'user action follows Settings rather than sharing the market seat')
  assert.equal(document.querySelector('[data-slot="sidebar.footer.action"] .market').textContent, '市场', 'market launcher remains in the original Desktop footer seat')
  await act(async () => userButton.click())
  assert.deepEqual(navigated, ['seal-harness-user'])
  await act(async () => detailRoot.render(React.createElement(detail.component)))
  assert.match(document.querySelector('main').textContent, /用户详情/)
  assert.match(document.querySelector('main').textContent, /user-1/)
  await act(async () => [...document.querySelectorAll('main button')].find(button => button.textContent === '退出登录').click())
  assert.deepEqual(calls, ['logout'])
  assert.match(document.querySelector('.seal-harness-user-footer').textContent, /未登录/)
  assert(document.querySelector('.seal-harness-user-footer-seat'), 'signed-out users retain the identity entry')
  await act(async () => document.querySelector('.seal-harness-user-footer').click())
  assert.equal(navigated.at(-1), 'seal-harness-identity')
  await act(async () => { status = { ...status, user: originalUser }; for (const listener of listeners) listener(status) })
  assert.equal(document.querySelector('.footArea').lastElementChild.contains(document.querySelector('.seal-harness-user-footer')), true, 'login restores the action after Settings')
})
