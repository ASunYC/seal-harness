import assert from 'node:assert/strict'
import { readFile, mkdtemp, rm } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { runInNewContext } from 'node:vm'
import test from 'node:test'
import { build } from 'tsdown'
import { JSDOM } from 'jsdom'
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'

test('local login page shows seal artwork and releases the workbench after registration', async t => {
  const output = await mkdtemp(join(tmpdir(), 'seal-harness-login-ui-'))
  t.after(() => rm(output, { recursive: true, force: true }))
  const brand = `data:image/png;base64,${(await readFile(new URL('../../../assets/icons/128x128.png', import.meta.url))).toString('base64')}`
  await build({ config: false, cwd: fileURLToPath(new URL('..', import.meta.url)), entry: { client: 'src/client.jsx' }, outDir: output,
    format: 'cjs', platform: 'browser', target: 'es2022', dts: false,
    deps: { neverBundle: [/^react(?:-dom)?(?:\/|$)/] },
    define: { 'process.env.NODE_ENV': JSON.stringify('production'), __SEAL_HARNESS_ICON__: JSON.stringify(brand) },
    outputOptions: { entryFileNames: 'client.cjs' },
  })
  const dom = new JSDOM('<!doctype html><html><head></head><body><div id="app"></div></body></html>')
  const oldWindow = globalThis.window, oldDocument = globalThis.document, oldFormData = globalThis.FormData
  globalThis.window = dom.window; globalThis.document = dom.window.document; globalThis.FormData = dom.window.FormData
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  const module = { exports: {} }, registrations = [], disposers = [], provided = new Map(), selected = []
  const root = createRoot(document.getElementById('app'))
  t.after(async () => {
    await act(async () => root.unmount())
    disposers.forEach(dispose => dispose?.())
    dom.window.close(); globalThis.window = oldWindow; globalThis.document = oldDocument; globalThis.FormData = oldFormData
    delete globalThis.IS_REACT_ACT_ENVIRONMENT
  })
  runInNewContext(await readFile(join(output, 'client.cjs'), 'utf8'), { module, exports: module.exports,
    require: createRequire(import.meta.url), document: dom.window.document, FormData: dom.window.FormData, AbortController })
  let status = { user: null, accountId: null, epoch: 0, canRegister: true }
  const context = {
    effect(callback) { disposers.push(callback()) }, provide(key, value) { provided.set(key, value) },
    slots: { inject(_name, callback) { callback() }, register(meta, component) {
      const entry = { meta, component, disposed: false }; registrations.push(entry)
      return () => { entry.disposed = true }
    } },
    layout: { selectPanel(panel) { selected.push(panel) } },
    connection: { rpc: { async call(_channel, method, payload) {
      if (method.endsWith('/status')) return { ok: true, value: status }
      if (method.endsWith('/register')) {
        assert.equal(payload.username, 'admin')
        status = { user: { id: 'user-1', username: 'admin', displayName: '管理员', role: 'admin' }, accountId: 'user-1', epoch: 1, canRegister: false }
        return { ok: true, value: status }
      }
      throw new Error(`Unexpected ${method}`)
    } } },
  }
  await act(async () => module.exports.apply(context))
  const gate = registrations.find(entry => entry.meta.name === 'root')
  assert(gate)
  await act(async () => root.render(React.createElement(gate.component)))
  assert.equal(document.querySelector('img[alt="Seal Harness 小海豹"]')?.getAttribute('src'), brand)
  assert.match(document.body.textContent, /创建本机管理员/)
  assert.doesNotMatch(document.body.textContent, /企业微信|统一认证|集团 SSO/)
  const inputs = document.querySelectorAll('input')
  await act(async () => {
    for (const [input, value] of [[inputs[0], 'admin'], [inputs[1], '管理员'], [inputs[2], 'valid-password-123']]) {
      input.value = value; input.dispatchEvent(new dom.window.Event('input', { bubbles: true }))
    }
    document.querySelector('form').dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true }))
    await Promise.resolve()
  })
  assert.equal(gate.disposed, true)
  assert.equal(provided.get('sealHarnessAuthClient').getStatus().user.id, 'user-1')
  assert.deepEqual(selected, [null])
})
