import test from 'node:test'
import assert from 'node:assert/strict'
import { mountPanel, act } from './ui-support.mjs'

test('公开和个人顶栏直接复用本地创建及导入，切回目录不重复打开', async t => {
  const calls = []
  const { click } = await mountPanel(t, 'skills', async (endpoint, payload) => {
    calls.push({ endpoint, payload })
    if (endpoint === 'store/list') return []
    if (endpoint === 'skills/list') return { revision: 4, skills: [] }
    if (endpoint === 'skills/sources') return { sources: [] }
    if (endpoint === 'skills/create') return {}
    throw new Error(endpoint)
  })
  await click('创建 Skill')
  assert(document.querySelector('dialog[open][aria-label="新建技能"] textarea'))
  await click('保存技能')
  assert.equal(calls.find(call => call.endpoint === 'skills/create').payload.expectedRevision, 4)
  await click('公开')
  await click('导入 Skill 包')
  assert(document.querySelector('dialog[open][aria-label="导入 Skill 包"] input[type="file"]'))
  await click('关闭导入 Skill 包')
  await click('Seal Harness·开发者平台 Skill')
  await click('创建 Skill')
  assert(document.querySelector('dialog[open][aria-label="新建技能"]'))
  await click('关闭新建技能')
  await click('公开')
  await click('个人')
  assert.equal(document.querySelector('dialog[open]'), null)
})

test('技能页默认公开目录，详情安装后可在个人本地管理，并可访问个人平台目录', async t => {
  const calls = []
  let installed = false, returns = 0
  const asset = { id: 'public-skill', name: '公开技能', summary: '目录说明', category: 'office', latestVersion: { version: '1.0.0', status: 'published' }, versions: [{ version: '1.0.0', status: 'published' }] }
  const { click } = await mountPanel(t, 'skills', async (endpoint, payload) => {
    calls.push({ endpoint, payload })
    if (endpoint === 'store/list') return [asset]
    if (endpoint === 'store/detail') return asset
    if (endpoint === 'skills/install') { installed = true; return {} }
    if (endpoint === 'skills/list') return { revision: 1, skills: installed ? [{ id: 'managed', name: asset.name, description: asset.summary, fileCount: 1, origin: { kind: 'store', assetId: asset.id, version: '1.0.0' } }] : [] }
    if (endpoint === 'skills/sources') return { sources: [] }
    throw new Error(endpoint)
  }, { onBack: () => returns++ })
  await click('返回会话，离开技能页')
  assert.equal(returns, 1)
  assert.equal(document.querySelector('h1').textContent, '技能')
  assert.equal(document.querySelector('[aria-label="能力类型"]'), null)
  assert.deepEqual(JSON.parse(JSON.stringify(calls.find(call => call.endpoint === 'store/list').payload)), { collection: 'skills', scope: 'published' })
  await click('查看 公开技能 详情')
  await click('安装此版本')
  assert.deepEqual(JSON.parse(JSON.stringify(calls.find(call => call.endpoint === 'skills/install').payload)), { id: asset.id, version: '1.0.0' })
  await click('个人')
  assert.equal(calls.filter(call => call.endpoint === 'store/list').at(-1).payload.scope, 'mine')
  await click('本地 Skill')
  assert.match(document.querySelector('.local-skill-list').textContent, /公开技能/)
  await click('返回会话，离开技能页')
  assert.equal(returns, 2)
  await click('Seal Harness·开发者平台 Skill')
  assert.equal(document.querySelectorAll('.skill-platform-row').length, 1)
})

test('未登录仍可从个人本地入口管理技能，保存校验与来源导入保留原 RPC', async t => {
  const calls = []
  const item = { id: 'local-1', name: 'local-skill', description: '本地说明', fileCount: 2, contentHash: 'a'.repeat(64), enabled: false, invocation: { modelInvocable: true, userInvocable: true }, files: [{ path: 'SKILL.md', size: 30 }, { path: 'refs/guide.md', size: 10 }] }
  const location = { sourceId: 'source-1', key: 'local-skill', sourceLabel: 'Codex', path: '/tmp/skills/local-skill' }
  const { click, dom } = await mountPanel(t, 'skills', async (endpoint, payload) => {
    calls.push({ endpoint, payload })
    if (endpoint === 'skills/list') return { revision: 4, skills: [item] }
    if (endpoint === 'skills/sources') return { sources: [{ id: 'source-1', label: 'Codex', standard: true, approved: true, status: 'ready', path: '/tmp/skills' }] }
    if (endpoint === 'skills/detail') return { ...item, filePath: payload.path, fileContent: '# 本地内容', rawContent: '# 本地内容', content: '# 本地内容\n<script>alert(1)</script>\n![远端](https://example.com/image)' }
    if (endpoint === 'skills/saveFile') return {}
    if (endpoint === 'skills/discover') return { skills: [{ ...item, locations: [location] }], diagnostics: [] }
    if (endpoint === 'skills/inspect') return { token: 'preview-token', candidates: [{ key: '.', name: item.name, description: '本地说明', fileCount: 2, instructionPreview: '正文' }] }
    if (endpoint === 'skills/import') return { skills: [item] }
    throw new Error(endpoint)
  }, { signedIn: false })
  assert.match(document.body.textContent, /登录后访问云端技能/)
  assert.equal(calls.length, 0)
  await click('个人')
  await click('本地 Skill')
  await click('local-skill本地说明')
  assert.equal(document.querySelector('.skill-markdown-document h1').textContent, '本地内容')
  assert.equal(document.querySelector('.skill-markdown-document script, .skill-markdown-document img'), null)
  await click('文件')
  assert(document.querySelector('.skill-file-tree details'))
  await click('编辑当前文件')
  const textarea = document.querySelector('textarea')
  await act(async () => {
    Object.getOwnPropertyDescriptor(dom.window.HTMLTextAreaElement.prototype, 'value').set.call(textarea, '# 修改后的内容')
    textarea.dispatchEvent(new dom.window.Event('input', { bubbles: true }))
  })
  await click('关闭local-skill')
  assert(document.querySelector('[aria-label="未保存的修改"]'))
  await click('继续编辑')
  await click('保存技能')
  const saved = calls.find(call => call.endpoint === 'skills/saveFile')
  assert.equal(saved.payload.expectedHash, item.contentHash)
  assert.equal(saved.payload.expectedRevision, 4)
  assert.equal(saved.payload.content, '# 修改后的内容')
  await click('关闭local-skill')
  await click('发现本地')
  await click('查看 local-skill')
  await click('预览此副本')
  await click('导入所选技能')
  assert.equal(calls.find(call => call.endpoint === 'skills/import').payload.token, 'preview-token')
  await click('扫描范围')
  assert.match(document.querySelector('[aria-label="扫描范围"]').textContent, /标准目录/)
})
