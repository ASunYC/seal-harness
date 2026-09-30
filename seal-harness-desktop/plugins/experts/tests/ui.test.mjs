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
  const detail = { manifest, digest: 'a'.repeat(64), enabled: false, versions: [{ version: '1.0.0', active: false }], problems: [], files: ['expert.json'] }
  const api = async (endpoint, payload) => {
    calls.push({ endpoint, payload })
    if (endpoint === 'experts/list') return { items: [{ name: 'analyst', displayName: '分析专家', description: '分析资料', version: '1.0.0', tags: ['研究'], problems: [], enabled: false }] }
    if (endpoint === 'experts/detail') return detail
    if (endpoint === 'experts/models') return { items: [] }
    if (endpoint === 'experts/capabilities') throw new Error('候选服务离线')
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
  assert.match(document.querySelector('.resource-sync-state').textContent, /已同步/)
  assert(document.querySelector('button[aria-label="刷新专家目录"] [data-icon-name="refresh"]'))
  assert(document.querySelector('[aria-label="个人专家"]'))
  assert.equal(document.querySelector('[aria-label="公开专家"]'), null)
  assert.equal(document.querySelector('.zz-directory-search [data-icon-name="search"]').getAttribute('width'), '16')
  const scene = document.querySelector('.scene')
  assert.equal(scene.querySelector('svg').getAttribute('width'), '22')
  assert.equal(scene.querySelector('svg').getAttribute('stroke-width'), '1.65')
  await act(async () => scene.click())
  assert(scene.querySelector('[data-icon-name="check"]'))
  await act(async () => scene.click())
  assert(document.querySelector('.experts-installed__rail [data-icon-name="agents"]'))

  assert(document.querySelector('[aria-label="管理专家 分析专家"] [data-icon-name="more"]'))
  await act(async () => document.querySelector('[aria-label="管理专家 分析专家"]').click())
  assert.equal(calls.some(call => call.endpoint.startsWith('store/')), false)
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
  assert.equal('knowledgeGroupIds' in update, false)
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

})
