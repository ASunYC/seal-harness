import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { join, resolve } from 'node:path'
import { runInNewContext } from 'node:vm'

const require = createRequire(resolve(process.env.SEAL_HARNESS_TOOLS_ROOT || fileURLToPath(new URL('../../../../', import.meta.url)), 'dsh-plugin-desktop-beta/package.json'))
const React = require('react'), { act } = React
const { createRoot } = require('react-dom/client'), { JSDOM } = require('jsdom')
const { Simulate } = require('react-dom/test-utils')

test('公开连接器卡片在桌面宽度使用紧凑三列并按窄屏降列', async () => {
  const css = await readFile(new URL('../src/styles.js', import.meta.url), 'utf8')
  assert.match(css, /#zz-connector-public \.mcp-installed__list\s*\{[^}]*grid-template-columns:\s*repeat\(3,\s*minmax\(0,\s*1fr\)\)/s)
  assert.match(css, /@media\s*\(max-width:\s*1180px\)[^{]*\{[^}]*#zz-connector-public \.mcp-installed__list\s*\{[^}]*repeat\(2,/s)
  assert.match(css, /#zz-connector-public \.mcp-installed-card\s*\{[^}]*padding:\s*12px/s)
})

test('connector dialogs preserve secrets, tool restrictions and failure retry without flattening the directory', async t => {
  const outDir = await mkdtemp(join(tmpdir(), 'seal-harness-connectors-ui-'))
  t.after(() => rm(outDir, { recursive: true, force: true }))
  const { build } = await import(pathToFileURL(require.resolve('tsdown')).href)
  await build({ config: false, cwd: fileURLToPath(new URL('..', import.meta.url)), entry: { panel: 'src/panel.jsx' }, outDir,
    format: 'cjs', platform: 'browser', target: 'es2022', dts: false, sourcemap: false,
    deps: { neverBundle: [/^react(?:-dom)?(?:\/|$)/] }, outputOptions: { entryFileNames: 'panel.cjs' }, logLevel: 'silent' })
  const dom = new JSDOM('<main></main>', { url: 'https://local.test' })
  globalThis.window = dom.window; globalThis.document = dom.window.document; globalThis.IS_REACT_ACT_ENVIRONMENT = true
  dom.window.HTMLDialogElement.prototype.showModal = function () { this.open = true }
  dom.window.HTMLDialogElement.prototype.close = function () { this.open = false }
  const exports = {}, module = { exports }
  runInNewContext(await readFile(join(outDir, 'panel.cjs'), 'utf8'), { exports, module, require, AbortController, document, FileReader: dom.window.FileReader, console, crypto: require('node:crypto').webcrypto })
  const calls = []
  let packagePreviewFails = true
  let item = { id: 'fixture', name: '测试连接器', transport: 'streamable-http', command: '', args: [], cwd: '', url: 'https://example.test/mcp', headers: ['Authorization'], requiredHeaders: ['Authorization'], env: [], requiredEnv: [], enabled: true, enabledTools: null, toolCallTimeoutMs: 60000, revision: 3, status: 'active', tools: [{ name: 'lookup', description: '查询资料', inputSchema: { type: 'object', properties: { attachment: { type: 'string', format: 'file' } } } }] }
  let fail = true
  const api = async (endpoint, payload) => {
    calls.push({ endpoint, payload })
    if (endpoint === 'connectors/testTool') return { isError: false, value: { result: '真实工具响应' } }
    if (endpoint === 'connectors/inspectPackage') {
      if (packagePreviewFails) throw new Error('连接器包解析失败')
      return { token: 'package-preview', name: '拖入的 MCP', summary: '本地 STDIO 包', version: '2.0.0', executable: 'bin/server.exe', args: ['--stdio'], requiredEnv: ['ACCESS_TOKEN'], fileCount: 4, byteSize: 4096 }
    }
    if (endpoint === 'connectors/importPackage') {
      item = { ...item, id: 'm-local-package', name: payload.name, summary: payload.summary, category: payload.category, transport: 'stdio', command: 'C:\\packages\\server.exe', args: ['--stdio'], cwd: 'C:\\packages', env: ['ACCESS_TOKEN'], requiredEnv: ['ACCESS_TOKEN'], enabled: payload.enabled, revision: 0 }
      return { items: [item], importedId: item.id }
    }
    if (endpoint === 'connectors/save') {
      if (fail) throw new Error('保存失败，请重试')
      item = { ...item, ...payload, headers: item.headers, env: item.env, revision: item.revision + 1 }
    }
    if (endpoint === 'store/list') throw new Error('请先登录')
    return { items: [item] }
  }
  const root = createRoot(document.querySelector('main'))
  t.after(async () => { await act(async () => root.unmount()); dom.window.close(); delete globalThis.window; delete globalThis.document; delete globalThis.IS_REACT_ACT_ENVIRONMENT })
  const click = async (text, scope = document) => {
    const button = [...scope.querySelectorAll('button')].find(button => button.textContent.trim() === text || button.getAttribute('aria-label') === text)
    assert(button, `missing ${text}`); await act(async () => button.click())
  }
  await act(async () => root.render(React.createElement(module.exports.ConnectorsPanel, { api, signedIn: true })))
  assert.equal(document.querySelector('form'), null)
  const directoryTabs = document.querySelector('[role=tablist][aria-label="连接器目录范围"]')
  assert(directoryTabs)
  assert.deepEqual([...directoryTabs.querySelectorAll('[role=tab]')].map(tab => [tab.textContent, tab.getAttribute('aria-selected')]), [['公开', 'true'], ['个人', 'false'], ['被授权', 'false']])
  assert(document.querySelector('#zz-connector-public'))
  assert.equal(document.querySelector('#zz-connector-personal'), null)
  assert.equal(document.querySelector('#zz-connector-authorized'), null)
  assert.match(document.querySelector('#zz-connector-public').textContent, /请先登录/)
  await act(async () => {
    directoryTabs.querySelector('[role=tab]').focus()
    directoryTabs.querySelector('[role=tab]').dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }))
  })
  assert(document.querySelector('#zz-connector-personal'))
  assert.equal(document.querySelector('#zz-connector-public'), null)
  assert.equal(document.querySelector('.zz-directory-search [data-icon-name="search"]').getAttribute('width'), '16')
  const scene = document.querySelector('.capability-featured-scene')
  assert.equal(scene.querySelector('svg').getAttribute('width'), '22')
  assert.equal(scene.querySelector('svg').getAttribute('stroke-width'), '1.65')
  await act(async () => scene.click())
  assert(scene.querySelector('[data-icon-name="check"]'))
  await act(async () => scene.click())
  assert(document.querySelector('[aria-label="查看工具"] [data-icon-name="mcp-eye"]'))
  assert(document.querySelector('[aria-label="卸载连接器"] [data-icon-name="mcp-trash"]'))

  assert.equal(calls.filter(call => call.endpoint === 'store/list').length, 1)
  await click('卸载连接器')
  assert.equal(document.querySelectorAll('dialog').length, 2)
  await act(async () => document.querySelectorAll('dialog')[1].dispatchEvent(new dom.window.Event('cancel', { cancelable: true })))
  await click('关闭连接器管理')
  await click('更多操作')
  assert.match(document.querySelector('dialog').textContent, /连接设置/)
  await click('删除连接器')
  assert.equal(document.querySelectorAll('dialog').length, 2)
  await act(async () => document.querySelectorAll('dialog')[1].dispatchEvent(new dom.window.Event('cancel', { cancelable: true })))
  assert.equal(document.querySelectorAll('dialog').length, 1, 'Escape closes only the top confirmation')
  await click('配置访问凭据', document.querySelector('dialog'))
  assert.equal(document.querySelector('input[type=password]').value, '')
  await act(async () => document.querySelector('form').dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true })))
  assert.match(document.querySelector('dialog').textContent, /保存失败/)
  assert.equal(calls.at(-1).payload.headerValues, undefined)
  assert.equal(calls.at(-1).payload.headers, undefined)
  fail = false
  await act(async () => document.querySelector('form').dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true })))
  await click('查看工具', document.querySelector('dialog'))
  assert(document.querySelector('[role=note] [data-icon-name="info"]'))
  await click('运行工具')
  assert.match(document.querySelector('[aria-label="运行结果"]').textContent, /真实工具响应/)
  assert.equal(calls.at(-1).payload.tool, 'lookup')
  await act(async () => document.querySelector('input[type=checkbox]').click())
  await click('保存工具选择')
  assert.deepEqual(JSON.parse(JSON.stringify(calls.at(-1).payload.enabledTools)), [])
  assert.equal(calls.at(-1).payload.revision, 4)
  await act(async () => document.querySelector('dialog').dispatchEvent(new dom.window.Event('cancel', { cancelable: true })))
  assert.equal(document.querySelector('dialog'), null)
  await click('公开')
  await click('刷新公开目录')
  assert.match(document.querySelector('#zz-connector-public').textContent, /请先登录/)
  await click('被授权')
  assert.match(document.querySelector('#zz-connector-authorized').textContent, /被授权连接器即将开放/)
  await click('个人')
  assert.match(document.querySelector('#zz-connector-personal').textContent, /测试连接器/)
  await click('创建连接器')
  const form = document.querySelector('form')
  const input = label => [...form.querySelectorAll('label')].find(node => node.querySelector('span')?.textContent === label).querySelector('input,textarea,select')
  await act(async () => {
    Simulate.change(input('名称'), { target: { value: '办公数据' } })
    Simulate.change(input('描述'), { target: { value: '查询办公资料' } })
    Simulate.change(input('分类'), { target: { value: 'office' } })
    Simulate.change(input('URL'), { target: { value: 'https://example.test/new' } })
  })
  const submitter = [...form.querySelectorAll('button')].find(button => button.textContent === '保存')
  await act(async () => form.dispatchEvent(new dom.window.SubmitEvent('submit', { bubbles: true, cancelable: true, submitter })))
  assert.equal(calls.at(-1).payload.summary, '查询办公资料')
  assert.equal(calls.at(-1).payload.category, 'office')
  assert.equal(calls.at(-1).payload.enabled, false)
  assert.match(calls.at(-1).payload.id, /^local-[a-f0-9]{8}$/)
  await act(async () => document.querySelector('dialog').dispatchEvent(new dom.window.Event('cancel', { cancelable: true })))
  await click('创建连接器')
  let packageForm = document.querySelector('form')
  await act(async () => [...packageForm.querySelectorAll('[role=radio]')].find(button => button.textContent === 'STDIO').click())
  let dropzone = packageForm.querySelector('[aria-label="拖入 STDIO 连接器包"]')
  assert(dropzone, 'STDIO mode exposes the package drop flow')
  assert.match(dropzone.textContent, /最大 200 MiB/)
  const packageFile = new dom.window.File(['package'], 'portable-mcp.zip', { type: 'application/zip' })
  await act(async () => {
    dropzone.dispatchEvent(Object.assign(new dom.window.Event('drop', { bubbles: true, cancelable: true }), { dataTransfer: { files: [packageFile] } }))
    await new Promise(resolve => setTimeout(resolve, 10))
  })
  assert.match(document.querySelector('dialog').textContent, /连接器包解析失败/)
  await act(async () => document.querySelector('dialog').dispatchEvent(new dom.window.Event('cancel', { cancelable: true })))
  await click('放弃修改')
  assert.equal(document.querySelector('.capability-page__content > [role=alert]'), null, 'dialog errors must not leak into the directory page')
  packagePreviewFails = false
  await click('创建连接器')
  packageForm = document.querySelector('form')
  await act(async () => [...packageForm.querySelectorAll('[role=radio]')].find(button => button.textContent === 'STDIO').click())
  dropzone = packageForm.querySelector('[aria-label="拖入 STDIO 连接器包"]')
  await act(async () => {
    dropzone.dispatchEvent(Object.assign(new dom.window.Event('drop', { bubbles: true, cancelable: true }), { dataTransfer: { files: [packageFile] } }))
    await new Promise(resolve => setTimeout(resolve, 10))
  })
  assert.match(packageForm.textContent, /拖入的 MCP/)
  assert.match(packageForm.textContent, /2\.0\.0/)
  assert.match(packageForm.textContent, /4 个文件/)
  assert.equal([...packageForm.querySelectorAll('input')].some(input => input.value === 'ACCESS_TOKEN'), true)
  const installSubmitter = [...packageForm.querySelectorAll('button')].find(button => button.textContent === '保存并启用')
  await act(async () => packageForm.dispatchEvent(new dom.window.SubmitEvent('submit', { bubbles: true, cancelable: true, submitter: installSubmitter })))
  const importCall = calls.find(call => call.endpoint === 'connectors/importPackage')
  assert(importCall)
  assert.equal(importCall.payload.token, 'package-preview')
  assert.equal(importCall.payload.enabled, true)
  assert.equal(document.querySelector('dialog').textContent.includes('连接设置'), true)
  await act(async () => document.querySelector('dialog').dispatchEvent(new dom.window.Event('cancel', { cancelable: true })))
  const asset = { id: 'public-connector', name: '公开连接器', summary: '公开数据工具', category: 'office', versions: [{ version: '1.0.0', status: 'published' }] }
  const publicApi = async (endpoint, payload) => {
    if (endpoint === 'store/list') return [asset]
    if (endpoint === 'store/detail') return asset
    if (endpoint === 'connectors/install') { calls.push({ endpoint, payload }); return { items: [item] } }
    return api(endpoint, payload)
  }
  await act(async () => root.render(React.createElement(module.exports.ConnectorsPanel, { signedIn: true, api: publicApi })))
  await click('公开')
  assert.match(document.querySelector('#zz-connector-public .mcp-installed-card__context').textContent, /办公类/)
  await click('查看详情')
  assert.match(document.querySelector('dialog').textContent, /公开数据工具/)
  await click('安装此版本')
  assert.equal(calls.find(call => call.endpoint === 'connectors/install').payload.version, '1.0.0')

  let cloudRequested = false, loginOpened = false
  const signedOutApi = async (endpoint, payload) => {
    if (endpoint.startsWith('store/')) { cloudRequested = true; throw new Error('signed-out cloud request') }
    return api(endpoint, payload)
  }
  await act(async () => root.render(React.createElement(module.exports.ConnectorsPanel, { key: 'signed-out', api: signedOutApi, openLogin: () => { loginOpened = true } })))
  assert.equal(cloudRequested, false)
  assert.equal(document.querySelector('dialog'), null, 'identity remount clears the old detail')
  assert.match(document.body.textContent, /登录后浏览公开目录，本地资源仍可使用/)
  await click('去登录')
  assert.equal(loginOpened, true)

})
