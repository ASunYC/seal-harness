import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import { runInNewContext } from 'node:vm'
import { configurableModels, reasoningUpdate } from '../src/model-reasoning.js'

const requireFromDesktop = createRequire(new URL('../../dsh-plugin-desktop-beta/package.json', import.meta.url))
const namespace = () => ({ ns: 'llm-pi-ai', revision: 7, value: { providers: { custom: { models: [
  { id: 'think', name: 'Think', input: ['text'], contextWindow: 100000 },
  { id: 'plain', name: 'Plain', maxTokens: 2048 },
] } } } })

test('per-model reasoning update preserves every other model field and rejects invalid mapping', () => {
  const current = namespace()
  assert.deepEqual(configurableModels(current).map(item => item.id), ['think', 'plain'])
  const update = reasoningUpdate(current, 'custom', 'think', { kind: 'custom', values: { off: 'none', low: 'low', high: 'high' } })
  assert.equal(update.revision, 7)
  assert.deepEqual(update.operations[0].path, ['providers', 'custom', 'models'])
  assert.deepEqual(update.operations[0].value[0], { ...current.value.providers.custom.models[0], reasoningEfforts: { off: 'none', low: 'low', high: 'high' } })
  assert.deepEqual(update.operations[0].value[1], current.value.providers.custom.models[1])
  assert.equal(current.value.providers.custom.models[0].reasoningEfforts, undefined)
  assert.throws(() => reasoningUpdate(current, 'custom', 'think', { kind: 'custom', values: { off: '' } }), /至少选择/)
  assert.throws(() => reasoningUpdate(current, 'custom', 'think', { kind: 'custom', values: { high: '' } }), /不能为空/)
  assert.deepEqual(reasoningUpdate(current, 'custom', 'think', { kind: 'custom', values: { off: '', high: 'high' } }).operations[0].value[0].reasoningEfforts, { off: null, high: 'high' })
  assert.equal(reasoningUpdate(current, 'custom', 'think', { kind: 'disabled' }).operations[0].value[0].reasoningEfforts, false)
})

test('Models footer lets a user declare and save the actual wire value', async t => {
  const output = await mkdtemp(join(tmpdir(), 'seal-reasoning-ui-'))
  const { build } = await import(pathToFileURL(requireFromDesktop.resolve('tsdown')).href)
  await build({ config: false, entry: [new URL('../src/model-reasoning.jsx', import.meta.url).pathname.replace(/^\/(\w:)/, '$1')], outDir: output,
    format: 'cjs', platform: 'browser', dts: false, sourcemap: false, deps: { neverBundle: [/^react(?:-dom)?(?:\/|$)/], onlyBundle: false }, logLevel: 'silent' })
  const React = requireFromDesktop('react'), { act } = React
  const { createRoot } = requireFromDesktop('react-dom/client')
  const { Simulate } = requireFromDesktop('react-dom/test-utils')
  const { JSDOM, VirtualConsole } = requireFromDesktop('jsdom')
  const dom = new JSDOM('<main></main>', { virtualConsole: new VirtualConsole() })
  const previous = { document: globalThis.document, window: globalThis.window }
  globalThis.document = dom.window.document; globalThis.window = dom.window; globalThis.IS_REACT_ACT_ENVIRONMENT = true
  const module = { exports: {} }
  runInNewContext(await readFile(join(output, 'model-reasoning.js'), 'utf8'), { module, exports: module.exports, require: requireFromDesktop,
    document: dom.window.document, window: dom.window, console })
  let component, write, refuse = false, notify
  let activeNamespace = namespace()
  const ctx = { slots: { inject(_name, register) { return register() }, register(_meta, value) { component = value; return () => {} } },
    remote: { $on(_event, listener) { notify = listener; return () => {} }, settings: {
      async describe() { return { ok: true, value: { writable: true, namespaces: [activeNamespace] } } },
      async mutate(ns, ops, revision) {
        write = { ns, ops, revision }
        if (refuse) return { ok: false, error: { code: 'settings/conflict', message: 'stale' } }
        activeNamespace = { ...namespace(), revision: 8, value: { providers: { custom: { models: ops[0].value } } } }
        return { ok: true, value: activeNamespace }
      },
    } } }
  module.exports.registerModelReasoningSettings(ctx)
  const root = createRoot(document.querySelector('main'))
  t.after(async () => { await act(async () => root.unmount()); dom.window.close(); Object.assign(globalThis, previous); delete globalThis.IS_REACT_ACT_ENVIRONMENT; await rm(output, { recursive: true, force: true }) })
  await act(async () => root.render(React.createElement(component)))
  assert.match(document.body.textContent, /自定义模型推理档位/)
  const select = document.querySelector('select:not([aria-label])')
  await act(async () => { select.value = 'custom'; select.dispatchEvent(new dom.window.Event('change', { bubbles: true })) })
  const high = [...document.querySelectorAll('input[type=checkbox]')][4]
  await act(async () => high.click())
  const wire = document.querySelector('input[aria-label="high 请求值"]')
  await act(async () => Simulate.change(wire, { target: { value: 'high' } }))
  const save = [...document.querySelectorAll('button')].find(button => button.textContent === '保存推理档位')
  await act(async () => save.click())
  assert(write, document.body.textContent)
  assert.equal(write.ns, 'llm-pi-ai')
  assert.equal(write.revision, 7)
  assert.equal(write.ops[0].value[0].reasoningEfforts.high, 'high')
  refuse = true
  await act(async () => save.click())
  assert.match(document.querySelector('[role=alert]').textContent, /已变化/)
  activeNamespace = { ...activeNamespace, revision: 9, value: { providers: { ...activeNamespace.value.providers, newlyAdded: { models: [{ id: 'another-think' }] } } } }
  await act(async () => notify())
  assert([...document.querySelectorAll('select[aria-label="配置推理档位的模型"] option')].some(option => option.textContent.includes('another-think')))
})
