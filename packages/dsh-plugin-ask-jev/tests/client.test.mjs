import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { runInNewContext } from 'node:vm'
import { JSDOM } from 'jsdom'

const require = createRequire(new URL('../../../dsh-plugin-desktop-beta/package.json', import.meta.url))
const React = require('react'), { act } = React
const { createRoot } = require('react-dom/client')

async function clientModule(document) {
  const registered = []
  const source = await readFile(new URL('../lib/client.js', import.meta.url), 'utf8')
  runInNewContext(source, { window: { __ModuleLoader__: { load: value => registered.push(value) } }, document, AbortController, FormData: document.defaultView.FormData })
  assert.equal(registered.length, 1)
  assert.equal(registered[0].id, 'dsh-plugin-ask-jev')
  return registered[0].factory(require)
}

test('standalone DSH Client registers a sidebar panel; Seal Harness uses its home navigation', async () => {
  const dom = new JSDOM('<!doctype html><html><head></head><body><main></main></body></html>')
  const module = await clientModule(dom.window.document)
  const previousDocument = globalThis.document, previousWindow = globalThis.window, previousFormData = globalThis.FormData
  globalThis.document = dom.window.document; globalThis.window = dom.window; globalThis.FormData = dom.window.FormData
  try {
    const slots = [], effects = [], calls = []
    const ctx = {
      get: () => undefined,
      effect: callback => { effects.push(callback()) },
      slots: { inject: (name, register) => slots.push({ name, register }),
        register: (meta, component) => registry.push({ meta, component }) },
      layout: { selectPanel: value => calls.push(value) },
      connection: { rpc: { call: async () => ({ ok: true, value: {} }) } },
    }
    module.apply(ctx)
    assert.deepEqual(slots.map(item => item.name), ['main', 'sidebar.panellist'])
    const registry = []
    slots[0].register()
    assert.equal(registry[0].meta.key, 'ask-jev')
    for (const dispose of effects) dispose?.()

    const navigation = { select: value => calls.push(value), register: input => { registry.push(input); return () => {} } }
    module.apply({ ...ctx, get: name => name === 'sealHarnessNavigation' ? navigation : undefined })
    assert.equal(registry.at(-1).label, '问问决策')
    assert.equal(registry.at(-1).id, 'ask-jev')
    const root = createRoot(dom.window.document.querySelector('main'))
    globalThis.IS_REACT_ACT_ENVIRONMENT = true
    try {
      await act(async () => root.render(React.createElement(registry.at(-1).Panel)))
      assert.equal(dom.window.document.querySelector('.ask-jev-intro h1')?.textContent, '把犹豫交给结构化判断')
    } finally { await act(async () => root.unmount()); delete globalThis.IS_REACT_ACT_ENVIRONMENT }
  } finally { globalThis.document = previousDocument; globalThis.window = previousWindow; globalThis.FormData = previousFormData; dom.window.close() }
})

test('decision panel switches providers and sends the selected mode without exposing a saved Key', async t => {
  const dom = new JSDOM('<!doctype html><html><head></head><body><div id="root"></div></body></html>')
  const module = await clientModule(dom.window.document)
  const previous = { window: globalThis.window, document: globalThis.document, FormData: globalThis.FormData }
  globalThis.window = dom.window; globalThis.document = dom.window.document; globalThis.FormData = dom.window.FormData
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  const root = createRoot(document.getElementById('root'))
  t.after(async () => {
    await act(async () => root.unmount())
    dom.window.close(); globalThis.window = previous.window; globalThis.document = previous.document; globalThis.FormData = previous.FormData
    delete globalThis.IS_REACT_ACT_ENVIRONMENT
  })
  let status = { provider: 'jev', region: 'cn-beijing', workspaceId: '', configured: { jev: true, alibaba: true },
    providers: { jev: { label: 'TypeSafe Jev' }, alibaba: { label: '阿里百炼决策模型' } },
    regions: { 'cn-beijing': '华北2（北京）', 'ap-southeast-1': '新加坡' } }
  const calls = []
  const api = async (action, payload) => {
    calls.push({ action, payload })
    if (action === 'status') return status
    if (action === 'configure') { status = { ...status, provider: payload.provider }; return status }
    if (action === 'decide') return { provider: status.provider, model: 'decision-model-preview', mode: 'choice',
      summary: '首选：先试点', choice: '先试点', confidence: .8, probabilities: { '先试点': .85, '直接上线': .15 } }
    throw new Error(action)
  }
  await act(async () => root.render(React.createElement(module.DecisionPanel, { api, onBack() {} })))
  await act(async () => { await Promise.resolve() })
  assert.equal(document.querySelector('input[type="password"]').value, '', 'saved Key is never rendered')
  await act(async () => [...document.querySelectorAll('button')].find(button => button.textContent.includes('阿里百炼决策模型')).click())
  assert.equal(calls.find(call => call.action === 'configure').payload.provider, 'alibaba')
  await act(async () => [...document.querySelectorAll('.ask-jev-mode-choices button')].find(button => button.textContent === '候选选择').click())
  const textareas = document.querySelectorAll('.ask-jev-decision-form textarea')
  const { Simulate } = require('react-dom/test-utils')
  for (const [input, value] of [[textareas[0], '先试点还是直接上线？'], [textareas[2], '先试点\n直接上线']]) {
    await act(async () => {
      Object.getOwnPropertyDescriptor(dom.window.HTMLTextAreaElement.prototype, 'value').set.call(input, value)
      Simulate.change(input, { target: { value } })
    })
  }
  await act(async () => document.querySelector('.ask-jev-decision-form').dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true })))
  const decision = calls.find(call => call.action === 'decide')
  assert.equal(decision.payload.mode, 'choice')
  assert.deepEqual([...decision.payload.options], ['先试点', '直接上线'])
  assert.match(document.querySelector('.ask-jev-result').textContent, /decision-model-preview/)
  assert.match(document.querySelector('.ask-jev-result').textContent, /85%/)
})
