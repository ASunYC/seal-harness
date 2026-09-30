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

test('expert directory opens full-page editing, preserves unavailable bindings, and routes versioned prompts to native conversation', async t => {
  const outDir = await mkdtemp(join(tmpdir(), 'seal-harness-experts-ui-'))
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
  runInNewContext(await readFile(join(outDir, 'panel.cjs'), 'utf8'), { exports, module, require, AbortController, document, console })
  const calls = [], conversations = []
  const manifest = { schemaVersion: 'stratex.expert/v1', name: 'analyst', version: '1.0.0', entryAgent: 'analyst', agents: ['agents/analyst.md'], displayName: { zh: '分析专家' }, profession: { zh: '分析师' }, description: { zh: '分析资料' }, personaInstructions: '认真分析', model: 'test-model', capabilities: [{ kind: 'skill', sourceId: 'missing-skill' }], tags: [{ zh: '研究' }], quickPrompts: [{ zh: '分析本周资料' }] }
  const detail = { manifest, digest: 'a'.repeat(64), enabled: false, versions: [{ version: '1.0.0', active: false }], problems: [], files: ['expert.json'], knowledgeGroupIds: ['missing-knowledge'] }
  const api = async (endpoint, payload) => {
    calls.push({ endpoint, payload })
    if (endpoint === 'store/list') throw new Error('请先登录')
    if (endpoint === 'experts/list') return { items: [{ name: 'analyst', displayName: '分析专家', description: '分析资料', version: '1.0.0', tags: ['研究'], problems: [], enabled: false }] }
    if (endpoint === 'experts/detail') return detail
    if (endpoint === 'experts/models') return { items: [] }
    if (endpoint === 'experts/capabilities' || endpoint === 'experts/knowledge') throw new Error('候选服务离线')
    if (endpoint === 'experts/update') throw new Error('版本保存失败')
    if (endpoint === 'experts/activate') return { presetId: 'seal-harness-expert-analyst' }
    throw new Error(`unexpected ${endpoint}`)
  }
  const root = createRoot(document.querySelector('main'))
  t.after(async () => { await act(async () => root.unmount()); dom.window.close(); delete globalThis.window; delete globalThis.document; delete globalThis.IS_REACT_ACT_ENVIRONMENT })
  const click = async text => {
    const button = [...document.querySelectorAll('button')].find(button => button.textContent.trim() === text || button.getAttribute('aria-label') === text)
    assert(button, `missing ${text}`); await act(async () => button.click())
  }
  await act(async () => root.render(React.createElement(module.exports.ExpertsPanel, { api, signedIn: true, workspaces: [{ workspaceId: 'workspace-a', title: '研发' }], startConversation: async (...args) => conversations.push(args) })))
  assert.equal(document.querySelector('form'), null)
  assert.match(document.querySelector('.resource-sync-state').textContent, /未连接/)
  assert(document.querySelector('button[aria-label="刷新专家目录"] [data-icon-name="refresh"]'))
  const directoryTabs = document.querySelector('[role=tablist][aria-label="专家目录范围"]')
  assert(directoryTabs)
  assert.deepEqual([...directoryTabs.querySelectorAll('[role=tab]')].map(tab => [tab.textContent, tab.getAttribute('aria-selected')]), [['公开', 'true'], ['个人', 'false'], ['被授权', 'false']])
  assert(document.querySelector('[aria-label="公开专家"]'))
  assert.equal(document.querySelector('[aria-label="个人专家"]'), null)
  await act(async () => {
    directoryTabs.querySelector('[role=tab]').focus()
    directoryTabs.querySelector('[role=tab]').dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }))
  })
  assert(document.querySelector('[aria-label="个人专家"]'))
  await click('公开')
  assert.equal(document.querySelector('.zz-directory-search [data-icon-name="search"]').getAttribute('width'), '16')
  const scene = document.querySelector('.scene')
  assert.equal(scene.querySelector('svg').getAttribute('width'), '22')
  assert.equal(scene.querySelector('svg').getAttribute('stroke-width'), '1.65')
  await act(async () => scene.click())
  assert(scene.querySelector('[data-icon-name="check"]'))
  await act(async () => scene.click())
  assert(document.querySelector('.experts-installed__rail [data-icon-name="agents"]'))

  assert.match(document.querySelector('[aria-label="公开专家"]').textContent, /请先登录/)
  await click('个人')
  assert(document.querySelector('[aria-label="管理专家 分析专家"] [data-icon-name="more"]'))
  await act(async () => document.querySelector('[aria-label="管理专家 分析专家"]').click())
  assert.equal(calls.filter(call => call.endpoint === 'store/list').length, 1)
  await click('修改专家')
  assert(document.querySelector('[aria-label="专家编辑器"]'))
  assert.equal(document.querySelector('.resource-page-hero'), null, 'editor replaces the directory')
  assert.match(document.body.textContent, /missing-skill/)
  assert.doesNotMatch(document.body.textContent, /本机未找到该技能/, 'failed pool is not a stale binding')
  await act(async () => document.querySelector('#zz-expert-form').dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true })))
  const update = calls.find(call => call.endpoint === 'experts/update').payload
  assert.equal(update.expectedDigest, 'a'.repeat(64))
  assert.equal(update.manifest.version, '1.0.1')
  assert.equal(update.manifest.capabilities[0].sourceId, 'missing-skill')
  assert.equal(update.knowledgeGroupIds[0], 'missing-knowledge')
  assert.match(document.body.textContent, /版本保存失败/)
  await click('返回我的专家')
  await click('查看专家')
  assert(document.querySelector('.expert-detail__panel'))
  await click('分析本周资料')
  assert.deepEqual(conversations, [['seal-harness-expert-analyst', '分析本周资料', 'workspace-a']])
  await click('管理专家')
  await click('版本历史')
  assert(document.querySelector('.expert-versions'))
  assert.match(document.querySelector('.expert-versions').textContent, /1.0.0/)
  await act(async () => root.render(React.createElement(module.exports.ExpertsPanel, { signedIn: true, api: async (endpoint, payload) => endpoint === 'experts/list' ? { items: [] } : api(endpoint, payload), workspaces: [], startConversation: async () => {} })))
  const personal = document.querySelector('[aria-label="个人专家"]')
  assert(personal.querySelector('.directory-state--slim'))
  assert.equal(personal.querySelector('.directory-state--empty, .directory-state__symbol'), null)

  while (document.querySelector('dialog')) await act(async () => document.querySelector('dialog').dispatchEvent(new dom.window.Event('cancel', { cancelable: true })))
  const asset = { id: 'public-expert', name: '后端 API 专家', category: 'office', summary: '设计清晰易用的接口', tags: ['界面', '设计'], versions: [{ version: '1.0.0', status: 'published' }, { version: '2.0.0', status: 'published' }] }
  const publicApi = async (endpoint, payload) => {
    if (endpoint === 'store/list') return [asset]
    if (endpoint === 'store/detail') return asset
    if (endpoint === 'experts/install') { calls.push({ endpoint, payload }); return { name: 'analyst', version: payload.version } }
    return api(endpoint, payload)
  }
  await act(async () => root.render(React.createElement(module.exports.ExpertsPanel, { signedIn: true, api: publicApi, workspaces: [], startConversation: async () => {} })))
  await click('公开')
  assert.match(document.querySelector('[aria-label="公开专家"] .expert-card__identity').textContent, /开发类/)
  const sceneButtons = [...document.querySelectorAll('.scene')]
  assert.equal(sceneButtons[0].querySelector('.scene__count').textContent, '0', 'local experts are not counted in public scenes')
  assert.equal(sceneButtons[1].querySelector('.scene__count').textContent, '1', 'development hints override the stored office category')
  await act(async () => sceneButtons[0].click())
  assert.equal(document.querySelector('[aria-label="公开专家"] .expert-card'), null)
  await click('个人')
  assert(document.querySelector('[aria-label="个人专家"] .personal-expert-card'), 'scene filters only the public catalog')
  await click('公开')
  await act(async () => sceneButtons[1].click())
  await click('查看与安装')
  const drawer = document.querySelector('.expert-detail__panel')
  assert.equal(drawer.querySelector('.expert-detail__avatar').textContent, '后')
  assert.match(drawer.querySelector('.expert-detail__identity').textContent, /公开 · 开发类/)
  assert.equal(drawer.querySelector('.expert-detail__desc').textContent, asset.summary)
  assert.match(drawer.querySelector('[aria-label="能力标签"]').textContent, /界面设计/)
  assert.match(drawer.querySelector('.expert-detail__prompts').textContent, /可以这样问.*安装该专家后/)
  await act(async () => require('react-dom/test-utils').Simulate.change(drawer.querySelector('select'), { target: { value: '2.0.0' } }))
  await click('安装到本机')
  assert.equal(calls.find(call => call.endpoint === 'experts/install').payload.version, '2.0.0')
  assert(document.querySelector('.expert-manage-modal'))

  let cloudRequested = false, loginOpened = false
  const signedOutApi = async (endpoint, payload) => {
    if (endpoint.startsWith('store/')) { cloudRequested = true; throw new Error('signed-out cloud request') }
    return api(endpoint, payload)
  }
  await act(async () => root.render(React.createElement(module.exports.ExpertsPanel, { key: 'signed-out', api: signedOutApi, openLogin: () => { loginOpened = true } })))
  assert.equal(cloudRequested, false)
  assert.equal(document.querySelector('dialog'), null, 'identity remount clears the old detail')
  assert.match(document.body.textContent, /登录后浏览公开目录，本地资源仍可使用/)
  await click('去登录')
  assert.equal(loginOpened, true)

})
