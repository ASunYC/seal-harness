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

test('expert page has only system and personal tabs and creation enters a conversation', async t => {
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
  const calls = [], conversations = [], creations = []
  const manifest = { name: 'analyst', version: '1.0.0', displayName: { zh: '分析专家' }, profession: { zh: '分析师' }, description: { zh: '分析资料' }, personaInstructions: '认真分析', quickPrompts: [{ zh: '分析本周资料' }], model: 'model' }
  const detail = { manifest, digest: 'a'.repeat(64), enabled: false, versions: [{ version: '1.0.0', active: false }], problems: [], files: ['expert.json'] }
  const api = async (endpoint, payload) => {
    calls.push({ endpoint, payload })
    if (endpoint === 'experts/list') return { items: [{ name: 'analyst', displayName: '分析专家', description: '分析资料', version: '1.0.0', tags: ['研究'], problems: [], enabled: false }] }
    if (endpoint === 'experts/detail') return detail
    if (endpoint === 'experts/activate') return { presetId: 'seal-harness-expert-analyst' }
    throw new Error(`unexpected ${endpoint}`)
  }
  const root = createRoot(document.querySelector('main'))
  t.after(async () => { await act(async () => root.unmount()); dom.window.close(); delete globalThis.window; delete globalThis.document; delete globalThis.IS_REACT_ACT_ENVIRONMENT })
  const click = async label => {
    const button = [...document.querySelectorAll('button')].find(item => item.textContent.trim() === label || item.getAttribute('aria-label') === label)
    assert(button, `missing ${label}`)
    await act(async () => button.click())
  }
  await act(async () => root.render(React.createElement(module.exports.ExpertsPanel, {
    api, workspaces: [{ workspaceId: 'workspace-a', title: '研发' }],
    startConversation: async (...args) => conversations.push(args), startExpertCreation: async () => creations.push('opened'),
  })))
  assert.deepEqual([...document.querySelectorAll('.experts-directory-tabs [role=tab]')].map(tab => tab.textContent), ['系统', '个人'])
  assert.equal(document.querySelector('[aria-label="个人专家"] .personal-expert-card__identity h3')?.textContent, '分析专家')
  assert.equal(document.querySelector('.resource-sync-refresh, .my-experts-trigger, .experts-installed, .editor-page'), null)
  assert.doesNotMatch(document.body.textContent, /已安装|本地专家|导入专家包|我的专家/)
  await click('系统')
  assert.match(document.querySelector('[aria-label="系统专家"]').textContent, /暂无系统专家/)
  await click('个人')
  await click('创建专家')
  assert.deepEqual(creations, ['opened'])
  assert.equal(document.querySelector('.editor-page'), null)
  await click('导入专家')
  assert.equal(document.querySelector('.zz-expert-modal h2')?.textContent, '导入专家')
  await click('关闭导入专家')
  await click('查看专家')
  assert(document.querySelector('.expert-detail__panel'))
  await click('分析本周资料')
  assert.deepEqual(conversations, [['seal-harness-expert-analyst', '分析本周资料', 'workspace-a']])
  await click('管理专家')
  assert.equal([...document.querySelectorAll('.expert-manage-modal button')].some(button => button.textContent.trim() === '修改配置'), false)
  await click('版本历史')
  assert(document.querySelector('.expert-versions'))
  assert.doesNotMatch(document.querySelector('.expert-versions').textContent, /编辑为新版本/)
  assert(calls.some(call => call.endpoint === 'experts/list'))
})
