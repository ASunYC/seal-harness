import test from 'node:test'
import assert from 'node:assert/strict'
import { mountPanel, act } from '../../skills/tests/ui-support.mjs'

test('目录筛选、详情文件和版本安装使用真实组件及既有 RPC', async t => {
  const calls = []
  const asset = { id: 'skill-1', name: '文档技能', summary: '处理文档', category: 'office', latestVersion: { version: '1.2.3', status: 'published' }, versions: [{ version: '1.2.3', status: 'published' }], tags: [] }
  const { click, dom } = await mountPanel(t, 'store', async (endpoint, payload) => {
    calls.push({ endpoint, payload })
    if (endpoint === 'skills/list') return { skills: [] }
    if (endpoint === 'store/list') return [asset]
    if (endpoint === 'store/detail') return asset
    if (endpoint === 'store/artifactFiles') return { files: [{ path: 'SKILL.md', size: 20 }], path: 'SKILL.md', content: '# 使用说明\n<script>alert(1)</script>\n![远端](https://example.com/image)' }
    if (endpoint === 'skills/install') return { skills: [] }
    throw new Error(endpoint)
  })
  assert.match(document.querySelector('.resource-sync-state').textContent, /已同步/)
  assert(document.querySelector('.resource-sync-button [data-icon-name="refresh"]'))
  assert.equal(document.querySelectorAll('.skill-platform-row').length, 1)
  await click('查看 文档技能 详情')
  assert(document.querySelector('dialog[open][aria-label="能力详情"]'))
  await click('文件')
  assert.match(document.querySelector('.skill-markdown-document').textContent, /使用说明/)
  assert.equal(document.querySelector('.skill-markdown-document script, .skill-markdown-document img'), null)
  await click('版本记录')
  await click('安装此版本')
  assert.deepEqual(JSON.parse(JSON.stringify(calls.find(call => call.endpoint === 'skills/install').payload)), { id: 'skill-1', version: '1.2.3' })
  await click('个人')
  assert.equal(calls.filter(call => call.endpoint === 'store/list').at(-1).payload.scope, 'mine')
  await click('新建能力')
  assert(document.querySelector('dialog[open][aria-label="新建云端能力"] form'))
  const name = document.querySelector('dialog form input')
  await act(async () => {
    Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, 'value').set.call(name, '未保存名称')
    name.dispatchEvent(new dom.window.Event('input', { bubbles: true }))
  })
  await click('关闭新建云端能力')
  assert(document.querySelector('[aria-label="未保存的修改"]'))
  await click('放弃修改')
  const filter = document.querySelector('[aria-label="安装状态筛选"]')
  await act(async () => { filter.value = 'installed'; filter.dispatchEvent(new dom.window.Event('change', { bubbles: true })) })
  assert.equal(document.querySelectorAll('.skill-platform-row').length, 0)
})
