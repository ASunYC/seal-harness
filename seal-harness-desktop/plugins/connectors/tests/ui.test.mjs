import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { join, resolve } from 'node:path'
import { runInNewContext } from 'node:vm'

const repo = fileURLToPath(new URL('../../../../', import.meta.url))
const require = createRequire(resolve(process.env.SEAL_HARNESS_TOOLS_ROOT || repo, 'dsh-plugin-desktop-beta/package.json'))
const React = require('react'), { act } = React
const { createRoot } = require('react-dom/client'), { JSDOM, VirtualConsole } = require('jsdom')

async function mount(t, api, props = {}) {
  const outDir = await mkdtemp(join(tmpdir(), 'seal-harness-connectors-ui-'))
  const { build } = await import(pathToFileURL(require.resolve('tsdown')).href)
  await build({ config: false, entry: [resolve(repo, 'seal-harness-desktop/plugins/connectors/src/panel.jsx')], outDir,
    format: 'cjs', platform: 'browser', dts: false, sourcemap: false,
    deps: { neverBundle: [/^react(?:-dom)?(?:\/|$)/], onlyBundle: false }, logLevel: 'silent' })
  const dom = new JSDOM('<!doctype html><main></main>', { virtualConsole: new VirtualConsole(), url: 'https://local.test' })
  const previous = { window: globalThis.window, document: globalThis.document }
  globalThis.window = dom.window; globalThis.document = dom.window.document
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  dom.window.HTMLDialogElement.prototype.showModal = function () { this.open = true }
  dom.window.HTMLDialogElement.prototype.close = function () { this.open = false }
  const module = { exports: {} }
  runInNewContext(await readFile(join(outDir, 'panel.js'), 'utf8'), { module, exports: module.exports, require,
    AbortController, document: dom.window.document, window: dom.window, FileReader: dom.window.FileReader, crypto: require('node:crypto').webcrypto, console })
  const root = createRoot(document.querySelector('main'))
  t.after(async () => { await act(async () => root.unmount()); dom.window.close(); Object.assign(globalThis, previous); delete globalThis.IS_REACT_ACT_ENVIRONMENT; await rm(outDir, { recursive: true, force: true }) })
  await act(async () => root.render(React.createElement(module.exports.ConnectorsPanel, { api, ...props })))
  const click = async label => {
    const button = [...document.querySelectorAll('button')].find(item => item.textContent.trim() === label || item.getAttribute('aria-label') === label)
    assert(button, `missing button ${label}`)
    await act(async () => button.click())
  }
  return { click, dom }
}

test('connector page separates installed items from system and personal tabs', async t => {
  const calls = []
  let started = 0
  const installed = { id: 'legacy', name: '旧连接器', summary: '原有配置', transport: 'streamable-http', url: 'https://example.test/mcp', category: 'office', tools: [], enabled: false, status: 'disabled', revision: 1, headers: [], env: [], requiredHeaders: [], requiredEnv: [] }
  const draft = { ...installed, id: 'local-draft', name: '新连接器', summary: '待安装', installed: false, status: 'uninstalled', revision: 0 }
  const api = async (endpoint, payload) => {
    calls.push({ endpoint, payload })
    if (endpoint === 'connectors/list') return { items: [installed, draft] }
    if (endpoint === 'connectors/installPersonal') return { items: [installed, { ...draft, installed: true, status: 'disabled', revision: 1 }] }
    throw new Error(endpoint)
  }
  const { click } = await mount(t, api, { startConnectorCreation: async () => { started++ } })
  assert.match(document.querySelector('[aria-label="已安装连接器"]').textContent, /旧连接器/)
  assert.doesNotMatch(document.querySelector('[aria-label="已安装连接器"]').textContent, /新连接器/)
  assert.deepEqual([...document.querySelectorAll('[aria-label="连接器分类"] [role="tab"]')].map(tab => tab.textContent), ['系统', '个人'])
  assert.equal(document.querySelector('.resource-sync-state, .zz-installed-drawer, .capability-featured-scenes, #zz-connector-public'), null)
  await click('创建连接器')
  assert.equal(started, 1)
  assert.equal(document.querySelector('dialog[open]'), null)
  await click('个人')
  assert.match(document.querySelector('.connector-library').textContent, /新连接器/)
  await click('安装')
  assert.equal(calls.find(call => call.endpoint === 'connectors/installPersonal').payload.id, 'local-draft')
  await click('导入连接器')
  assert.match(document.querySelector('dialog[open]').textContent, /导入连接器/)
  assert(document.querySelector('dialog[open] [aria-label="拖入 STDIO 连接器包"]'))
})

test('installed connector still opens runtime and local credential management', async t => {
  const item = { id: 'ready', name: '工具连接器', summary: '查询数据', category: 'office', transport: 'streamable-http', command: '', args: [], cwd: '', url: 'https://example.test/mcp', headers: ['Authorization'], env: [], requiredHeaders: [], requiredEnv: [], enabled: true, status: 'active', tools: [{ name: 'lookup', description: '查询', inputSchema: { type: 'object' } }], revision: 2 }
  const calls = []
  const { click } = await mount(t, async (endpoint, payload) => {
    calls.push({ endpoint, payload })
    if (endpoint === 'connectors/list' || endpoint === 'connectors/save') return { items: [item] }
    throw new Error(endpoint)
  })
  await click('管理 工具连接器')
  assert.match(document.querySelector('dialog[open]').textContent, /访问凭据/)
  await click('配置访问凭据')
  assert(document.querySelector('dialog[open] input[type="password"]'))
  assert.equal(calls.some(call => call.endpoint.startsWith('store/')), false)
})
