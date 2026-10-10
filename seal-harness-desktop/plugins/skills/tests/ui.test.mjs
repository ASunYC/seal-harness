import test from 'node:test'
import assert from 'node:assert/strict'
import { mountPanel } from './ui-support.mjs'
import { skillCatalog } from '../../capability-shared/src/catalog.js'

test('系统技能显示完整目录，查看许可和安装要求后接入既有安装动作', async t => {
  const calls = []
  const catalog = skillCatalog.map(item => ({ ...item, installed: false, skillCount: 1 }))
  const { click } = await mountPanel(t, 'skills', async (endpoint, payload) => {
    calls.push({ endpoint, payload })
    if (endpoint === 'skills/list') return { revision: 1, skills: [], catalog }
    if (endpoint === 'skills/installCatalog') return { revision: 2, skills: [], catalog: catalog.map(item => ({ ...item, installed: item.id === payload.id })) }
    throw new Error(endpoint)
  })
  assert.equal(document.querySelectorAll('.cap-catalog__card').length, 407)
  await click('查看 前端界面设计')
  const dialog = document.querySelector('[role="dialog"][aria-label="前端界面设计"]')
  assert(dialog)
  assert.match(dialog.textContent, /许可|使用要求/)
  await click('安装')
  const installed = calls.find(call => call.endpoint === 'skills/installCatalog')
  assert.equal(installed.payload.id, 'bundle:frontend-design')
  assert.equal(installed.payload.expectedRevision, 1)
  assert.equal(document.querySelector('[role="dialog"]'), null)
  assert.match(document.body.textContent, /前端界面设计 已安装/)
})

test('技能页保留已安装区块，系统个人为页签，创建进入会话', async t => {
  const calls = []
  let started = 0
  const { click } = await mountPanel(t, 'skills', async (endpoint, payload) => {
    calls.push({ endpoint, payload })
    if (endpoint === 'skills/list') return { revision: 4, skills: [
      { id: 'old', name: 'old-skill', description: '旧技能', fileCount: 1, enabled: false, origin: { kind: 'local' } },
      { id: 'new', name: 'new-skill', description: '新技能', fileCount: 1, installed: false, enabled: false, origin: { kind: 'local' } },
    ] }
    if (endpoint === 'skills/installPersonal') return {}
    throw new Error(endpoint)
  }, { startSkillCreation: async () => { started++ } })
  assert.match(document.querySelector('[aria-label="已安装技能"]').textContent, /old-skill/)
  assert.doesNotMatch(document.querySelector('[aria-label="已安装技能"]').textContent, /new-skill/)
  assert(document.querySelector('[aria-label="技能分类"]'))
  assert.equal(document.querySelector('dialog[open]'), null)
  await click('创建技能')
  assert.equal(started, 1)
  assert.equal(document.querySelector('dialog[open]'), null)
  await click('个人')
  assert.match(document.querySelector('[aria-label="技能库"]').textContent, /new-skill/)
  await click('安装')
  assert.equal(calls.find(call => call.endpoint === 'skills/installPersonal').payload.id, 'new')
  await click('导入技能')
  assert(document.querySelector('dialog[open][aria-label="导入技能"] input[type="file"]'))
  assert.equal(calls.some(call => call.endpoint === 'skills/create'), false)
})

test('技能页返回会话并可查看已安装技能', async t => {
  let returns = 0
  const item = { id: 'managed', name: 'local-skill', description: '说明', fileCount: 1, contentHash: 'a'.repeat(64), enabled: false, origin: { kind: 'local' }, invocation: { modelInvocable: true, userInvocable: true } }
  const { click } = await mountPanel(t, 'skills', async endpoint => {
    if (endpoint === 'skills/list') return { revision: 1, skills: [item] }
    if (endpoint === 'skills/detail') return { ...item, rawContent: '---\nname: local-skill\ndescription: 说明\n---\n正文', content: '# 正文', files: [{ path: 'SKILL.md', size: 30 }] }
    throw new Error(endpoint)
  }, { onBack: () => returns++ })
  await click('返回会话，离开技能页')
  assert.equal(returns, 1)
  await click('local-skill说明')
  assert(document.querySelector('dialog[open][aria-label="local-skill"]'))
})
