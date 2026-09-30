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

test('公开连接器卡片按 Stratex 使用双列信息卡并在窄屏改单列', async () => {
  const css = await readFile(new URL('../src/styles.js', import.meta.url), 'utf8')
  const dialogCss = await readFile(new URL('../src/dialog.jsx', import.meta.url), 'utf8')
  assert.match(css, /\.mcp-public-grid\s*\{[^}]*grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\)/s)
  assert.match(css, /@media\s*\(max-width:\s*760px\)[\s\S]*?\.mcp-public-grid\s*\{[^}]*grid-template-columns:\s*1fr/s)
  assert.match(css, /\.mcp-public-card__tags/)
  assert.match(css, /\.mcp-public-card\s*\{[^}]*min-height:\s*190px/s)
  assert.doesNotMatch(css, /\.mcp-public-card\s*\{[^}]*grid-template-rows:[^}]*1fr/s)
  assert.match(dialogCss, /\.zz-installed-drawer\s*\{[^}]*width:\s*min\(440px,\s*92vw\)/s)
  assert.match(css, /\.zz-installed-drawer \.mcp-installed__list\s*\{[^}]*display:\s*grid/s)
  assert.match(css, /\.zz-installed-drawer \.mcp-installed-card\s*\{[^}]*width:\s*100%/s)
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
  let finishPackagePreview
  let item = {
    id: 'fixture', name: '测试连接器', transport: 'streamable-http', command: '', args: [], cwd: '', url: 'https://example.test/mcp',
    headers: ['Authorization'], headerEnvironment: {}, requiredHeaders: ['Authorization'], env: [], requiredEnv: [],
    enabled: true, enabledTools: null, toolCallTimeoutMs: 60000, revision: 3, status: 'active',
    tools: [{ name: 'lookup', description: '查询资料', inputSchema: { type: 'object', properties: { attachment: { type: 'string', format: 'file' } } } }],
  }
  const workspaces = [
    { workspaceId: 'workspace-a', title: '默认工作区', path: 'C:\\workspace\\default' },
    { workspaceId: 'workspace-b', title: 'CodeGraph 工程', path: 'C:\\workspace\\project' },
  ]
  let fail = true
  const api = async (endpoint, payload) => {
    calls.push({ endpoint, payload })
    if (endpoint === 'connectors/testTool') return { isError: false, value: { result: '真实工具响应' } }
    if (endpoint === 'connectors/checkConnection') return { status: 'ready', toolCount: 2, tools: [{ name: 'search' }, { name: 'read' }] }
    if (endpoint === 'connectors/inspectPackage') {
      if (packagePreviewFails) throw new Error('连接器包解析失败')
      return new Promise(resolve => { finishPackagePreview = () => resolve({ token: 'package-preview', name: '拖入的 MCP', summary: '本地 STDIO 包', version: '2.0.0', executable: 'bin/server.exe', args: ['--stdio'], environmentVariables: [{ name: 'PACKAGE_MODE', value: 'bundled' }], environmentPassthrough: ['PATH'], requiredEnv: ['ACCESS_TOKEN'], fileCount: 4, byteSize: 4096 }) })
    }
    if (endpoint === 'connectors/importPackage') {
      item = { ...item, id: 'm-local-package', name: payload.name, summary: payload.summary, category: payload.category, transport: 'stdio', command: 'C:\\packages\\server.exe', args: payload.args, cwd: 'C:\\packages', headers: [], headerEnvironment: {}, requiredHeaders: [], env: [], environmentPassthrough: payload.environmentPassthrough, requiredEnv: [], credentialSlots: [], authorization: null, workspaceBootstrap: true, workspacePath: '', enabled: payload.enabled, revision: 0, status: 'unconfigured', issue: '请先选择工作区并运行初始化。', tools: [] }
      return { items: [item], importedId: item.id }
    }
    if (endpoint === 'connectors/prepareWorkspace') {
      item = { ...item, workspacePath: payload.path, revision: item.revision + 1, status: 'active', issue: undefined }
      return { items: [item] }
    }
    if (endpoint === 'connectors/save') {
      if (fail) throw new Error('保存失败，请重试')
      item = { ...item, ...payload, headers: item.headers, env: item.env, revision: item.revision + 1 }
    }
    if (endpoint === 'store/list') throw new Error('请先登录')
    if (endpoint === 'store/center') throw new Error('请先登录')
    return { items: [item] }
  }
  const root = createRoot(document.querySelector('main'))
  t.after(async () => { await act(async () => root.unmount()); dom.window.close(); delete globalThis.window; delete globalThis.document; delete globalThis.IS_REACT_ACT_ENVIRONMENT })
  const click = async (text, scope = document) => {
    const button = [...scope.querySelectorAll('button')].find(button => button.textContent.trim() === text || button.getAttribute('aria-label') === text)
    assert(button, `missing ${text}`); await act(async () => button.click())
  }
  await act(async () => root.render(React.createElement(module.exports.ConnectorsPanel, { api, signedIn: true, workspaces })))
  assert.equal(document.querySelector('form'), null)
  assert.match(document.querySelector('.resource-sync-state').textContent, /未连接/)
  assert(document.querySelector('button[aria-label="刷新连接器目录"] [data-icon-name="refresh"]'))
  assert.equal(document.querySelector('.resource-page-nav [data-icon-name="check"]'), null)
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

  await click('已安装 1')
  const installedDrawer = document.querySelector('.zz-installed-drawer')
  assert(installedDrawer)
  assert.equal(installedDrawer.querySelector('h2').textContent, '已安装')
  assert.match(installedDrawer.textContent, /共 1 个已安装连接器/)
  assert.equal(installedDrawer.querySelector('input[type=search]').getAttribute('placeholder'), '搜索已安装连接器')
  assert([...installedDrawer.querySelectorAll('button')].some(button => button.textContent === '批量管理'))
  assert.equal(installedDrawer.querySelector('.mcp-installed__quick'), null)
  assert.equal(installedDrawer.querySelectorAll('.mcp-installed-card').length, 1)
  await act(async () => installedDrawer.dispatchEvent(new dom.window.Event('cancel', { cancelable: true })))

  assert.equal(calls.filter(call => call.endpoint === 'store/list').length, 1)
  await click('卸载连接器')
  assert.equal(document.querySelectorAll('dialog').length, 2)
  await act(async () => document.querySelectorAll('dialog')[1].dispatchEvent(new dom.window.Event('cancel', { cancelable: true })))
  await click('关闭连接器管理')
  await click('更多操作')
  assert.match(document.querySelector('dialog').textContent, /访问凭据/)
  assert.equal([...document.querySelector('dialog').querySelectorAll('button')].filter(button => button.textContent === '配置访问凭据').length, 1)
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
  await click('刷新连接器目录')
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
  assert.match(form.textContent, /其他请求头/)
  assert.match(form.textContent, /来自环境变量的请求头/)
  assert.match(form.textContent, /连接与工具/)
  assert.match(form.textContent, /浏览器 OAuth 会自动发现授权服务/)
  assert.equal([...form.querySelectorAll('button')].some(button => button.textContent === '取消'), false)
  assert.equal(form.textContent.includes('高级设置'), false)
  const staticHeaderName = form.querySelector('input[aria-label="其他请求头名称 1"]')
  const staticHeaderValue = form.querySelector('input[aria-label="其他请求头值 1"]')
  const environmentHeaderName = form.querySelector('input[aria-label="来自环境变量的请求头名称 1"]')
  const environmentHeaderValue = form.querySelector('input[aria-label="来自环境变量的请求头值 1"]')
  assert(staticHeaderName && staticHeaderValue && environmentHeaderName && environmentHeaderValue)
  await act(async () => Simulate.change(staticHeaderName, { target: { value: 'X-Tenant' } }))
  await act(async () => Simulate.change(form.querySelector('input[aria-label="其他请求头值 1"]'), { target: { value: 'private-tenant' } }))
  await act(async () => Simulate.change(environmentHeaderName, { target: { value: 'Authorization' } }))
  await act(async () => Simulate.change(form.querySelector('input[aria-label="来自环境变量的请求头值 1"]'), { target: { value: 'MCP_AUTHORIZATION' } }))
  await click('检查连接', form)
  await act(async () => new Promise(resolve => setTimeout(resolve, 0)))
  assert.match(form.textContent, /已连接 · 2 个工具/)
  const checkCall = calls.find(call => call.endpoint === 'connectors/checkConnection')
  assert.equal(checkCall.payload.transport, 'streamable-http')
  assert.equal(checkCall.payload.headerValues['X-Tenant'], 'private-tenant')
  assert.equal(checkCall.payload.headerEnvironment.Authorization, 'MCP_AUTHORIZATION')
  await act(async () => [...form.querySelectorAll('[role=radio]')].find(button => button.textContent === 'SSE').click())
  assert.match(form.textContent, /尚未检查/)
  await click('检查连接', form)
  await act(async () => new Promise(resolve => setTimeout(resolve, 0)))
  assert.equal(calls.filter(call => call.endpoint === 'connectors/checkConnection').at(-1).payload.transport, 'sse')
  await act(async () => [...form.querySelectorAll('[role=radio]')].find(button => button.textContent === '流式 HTTP').click())
  const submitter = [...form.querySelectorAll('button')].find(button => button.textContent === '保存')
  await act(async () => form.dispatchEvent(new dom.window.SubmitEvent('submit', { bubbles: true, cancelable: true, submitter })))
  assert.equal(calls.at(-1).payload.summary, '查询办公资料')
  assert.equal(calls.at(-1).payload.category, 'office')
  assert.equal(calls.at(-1).payload.enabled, false)
  assert.equal(calls.at(-1).payload.headerValues['X-Tenant'], 'private-tenant')
  assert.equal(calls.at(-1).payload.headerEnvironment.Authorization, 'MCP_AUTHORIZATION')
  assert.match(calls.at(-1).payload.id, /^local-[a-f0-9]{8}$/)
  await act(async () => document.querySelector('dialog').dispatchEvent(new dom.window.Event('cancel', { cancelable: true })))
  await click('创建连接器')
  let packageForm = document.querySelector('form')
  await act(async () => [...packageForm.querySelectorAll('[role=radio]')].find(button => button.textContent === 'STDIO').click())
  let dropzone = packageForm.querySelector('[aria-label="拖入 STDIO 连接器包"]')
  assert(dropzone, 'STDIO mode exposes the package drop flow')
  assert.match(dropzone.textContent, /canonical MCP ZIP/)
  assert.equal([...packageForm.querySelectorAll('button')].find(button => button.textContent === '保存并安装').disabled, true)
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
    await new Promise(resolve => setTimeout(resolve, 0))
  })
  assert(packageForm.querySelector('[role="progressbar"]'), 'package inspection exposes progress')
  assert.match(dropzone.textContent, /正在读取|正在解析/)
  assert.match(dropzone.textContent, /portable-mcp\.zip/)
  for (let attempt = 0; typeof finishPackagePreview !== 'function' && attempt < 20; attempt++) {
    await act(async () => new Promise(resolve => setTimeout(resolve, 5)))
  }
  assert.equal(typeof finishPackagePreview, 'function', 'package inspection request reaches the controlled Host response')
  await act(async () => {
    finishPackagePreview()
    await new Promise(resolve => setTimeout(resolve, 0))
  })
  assert(packageForm.querySelector('[aria-label="拖入 STDIO 连接器包"]'), 'dropzone remains available after package preview')
  assert.match(dropzone.textContent, /已就绪/)
  assert.match(dropzone.textContent, /portable-mcp\.zip/)
  const packageField = label => [...packageForm.querySelectorAll('label')].find(node => node.querySelector('span')?.textContent === label)?.querySelector('input,textarea,select')
  assert.equal(packageField('名称'), undefined, 'package identity stays out of the Stratex STDIO connection step')
  assert.equal(packageField('启动命令').value, 'bin/server.exe')
  assert.deepEqual([...packageForm.querySelectorAll('input[aria-label^="参数 "]')].map(input => input.value), ['--stdio'])
  assert.equal(packageForm.querySelector('input[aria-label="环境变量名称 1"]').value, 'PACKAGE_MODE')
  assert.equal(packageForm.querySelector('input[aria-label="环境变量值 1"]').value, 'bundled')
  assert.equal(packageForm.querySelector('input[aria-label="环境变量传递 1"]').value, 'PATH')
  await click('添加参数', packageForm)
  const argumentInputs = packageForm.querySelectorAll('input[aria-label^="参数 "]')
  await act(async () => Simulate.change(argumentInputs[1], { target: { value: '--verbose' } }))
  assert.equal([...packageForm.querySelectorAll('input')].some(input => input.value === 'ACCESS_TOKEN'), true)
  const installSubmitter = [...packageForm.querySelectorAll('button')].find(button => button.textContent === '保存并安装')
  assert.equal(installSubmitter.disabled, false)
  await act(async () => packageForm.dispatchEvent(new dom.window.SubmitEvent('submit', { bubbles: true, cancelable: true, submitter: installSubmitter })))
  const importCall = calls.find(call => call.endpoint === 'connectors/importPackage')
  assert(importCall)
  assert.equal(importCall.payload.token, 'package-preview')
  assert.equal(importCall.payload.name, '拖入的 MCP')
  assert.equal(importCall.payload.enabled, true)
  assert.equal(importCall.payload.command, 'bin/server.exe')
  assert.deepEqual(JSON.parse(JSON.stringify(importCall.payload.args)), ['--stdio', '--verbose'])
  assert.deepEqual(JSON.parse(JSON.stringify(importCall.payload.environmentPassthrough)), ['PATH'])
  assert.equal(importCall.payload.envValues.PACKAGE_MODE, 'bundled')
  const packageRuntime = document.querySelector('dialog')
  assert.match(packageRuntime.textContent, /工作区初始化/)
  assert.equal(packageRuntime.textContent.includes('配置访问凭据'), false)
  assert.equal([...packageRuntime.querySelectorAll('button')].filter(button => button.textContent === '初始化工作区').length, 1)
  await click('初始化工作区', packageRuntime)
  const workspaceDialog = document.querySelector('dialog')
  assert.match(workspaceDialog.textContent, /工作区初始化/)
  assert.equal(workspaceDialog.querySelector('input[placeholder="工作区绝对路径"]'), null)
  const workspaceSelect = [...workspaceDialog.querySelectorAll('label')].find(label => label.textContent.includes('选择工作区')).querySelector('select')
  const promptOption = workspaceSelect.options[0]
  assert.equal(promptOption.textContent, '请选择左侧已有工作区')
  assert.equal(promptOption.disabled, true)
  assert.equal(promptOption.hidden, true)
  assert.deepEqual([...workspaceSelect.options].filter(option => !option.hidden).map(option => option.textContent), ['默认工作区 — C:\\workspace\\default', 'CodeGraph 工程 — C:\\workspace\\project'])
  await act(async () => Simulate.change(workspaceSelect, { target: { value: 'workspace-b' } }))
  await click('初始化并绑定工作区', workspaceDialog)
  assert.equal(calls.filter(call => call.endpoint === 'connectors/prepareWorkspace').at(-1).payload.path, 'C:\\workspace\\project')
  await act(async () => document.querySelector('dialog').dispatchEvent(new dom.window.Event('cancel', { cancelable: true })))
  const asset = { id: 'public-connector', name: '公开连接器', summary: '公开数据工具', category: 'office', latestVersion: { version: '1.0.0', status: 'published' }, versions: [{ version: '1.0.0', status: 'published' }] }
  const centerAsset = { connectorId: 'itest', name: 'iTest 测试管理', summary: '连接 iTest 测试管理平台，查询和维护项目、需求、提测、测试项、测试计划、测试用例及缺陷。', category: 'office', tags: [], version: '1.0.1', clientAuthMode: 'none', toolCount: 50, iconRevision: 'icon-7' }
  const publicApi = async (endpoint, payload) => {
    if (endpoint === 'store/list') return [asset, { ...asset, id: 'center-duplicate', name: 'iTest测试管理' }]
    if (endpoint === 'store/center') return [centerAsset]
    if (endpoint === 'store/centerIcon') return { mimeType: 'image/png', data: 'iVBORw0KGgo=' }
    if (endpoint === 'store/detail') return asset
    if (endpoint === 'connectors/install') { calls.push({ endpoint, payload }); return { items: [item] } }
    if (endpoint === 'connectors/installCenter') { calls.push({ endpoint, payload }); return { items: [item] } }
    return api(endpoint, payload)
  }
  await act(async () => root.render(React.createElement(module.exports.ConnectorsPanel, { signedIn: true, api: publicApi, workspaces })))
  await click('公开')
  assert.equal(document.querySelectorAll('#zz-connector-public .mcp-public-card').length, 2)
  assert.match(document.querySelector('#zz-connector-public .mcp-public-card').textContent, /iTest 测试管理/, 'MCP Center cards stay ahead of platform-only entries')
  const centerCard = [...document.querySelectorAll('#zz-connector-public .mcp-public-card')].find(card => card.textContent.includes('iTest 测试管理'))
  await act(async () => new Promise(resolve => setTimeout(resolve, 0)))
  assert(centerCard.querySelector('img[src="data:image/png;base64,iVBORw0KGgo="]'))
  assert.match(centerCard.textContent, /连接 iTest 测试管理平台/)
  assert.match(centerCard.textContent, /办公类/)
  assert.match(centerCard.textContent, /HTTP/)
  assert.match(centerCard.textContent, /v1\.0\.1/)
  assert.match(centerCard.textContent, /50 个工具/)
  assert.match(centerCard.textContent, /MCP Center/)
  await click('查看 公开连接器 详情')
  assert.match(document.querySelector('dialog').textContent, /公开数据工具/)
  await click('安装连接器')
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
