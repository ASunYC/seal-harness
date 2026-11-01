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
    if (endpoint === 'skills/installCatalog') return { revision: 2, skills: [{ id: 'frontend', name: 'frontend-design', description: '前端界面设计', fileCount: 1, installed: true, origin: { kind: 'store' } }], catalog: catalog.map(item => ({ ...item, installed: item.id === payload.id })) }
    throw new Error(endpoint)
  })
  const emptyInstalled = document.querySelector('[aria-label="已安装技能"] details')
  assert.equal(emptyInstalled.open, false)
  assert.match(emptyInstalled.querySelector('summary').textContent, /已安装\s*0\s*暂无/)
  assert.equal(document.querySelectorAll('input[type="search"]').length, 1)
  assert.equal(document.querySelectorAll('.cap-catalog__card').length, 407)
  await click('安装 前端界面设计')
  const dialog = document.querySelector('[role="dialog"][aria-label="前端界面设计"]')
  assert(dialog)
  assert.match(document.querySelector('[aria-label="已安装技能"] summary').textContent, /已安装\s*0/)
  assert.match(dialog.textContent, /许可|使用要求/)
  await click('安装')
  const installed = calls.find(call => call.endpoint === 'skills/installCatalog')
  assert.equal(installed.payload.id, 'bundle:frontend-design')
  assert.equal(installed.payload.expectedRevision, 1)
  assert.equal(document.querySelector('[role="dialog"]'), null)
  assert.match(document.body.textContent, /前端界面设计 已安装/)
  assert.match(document.querySelector('[aria-label="已安装技能"] summary').textContent, /已安装\s*1/)
  assert.equal(document.querySelector('[aria-label="已安装技能"] .resource-installed__icon')?.title, 'frontend-design')
  assert.equal(document.querySelector('[aria-label="已安装技能"] details').open, false)
})

test('技能页保留已安装区块，系统个人为页签，创建进入会话', async t => {
  const calls = []
  let started = 0
  let personalInstalled = false
  const { click } = await mountPanel(t, 'skills', async (endpoint, payload) => {
    calls.push({ endpoint, payload })
    if (endpoint === 'skills/list') return { revision: 4, skills: [
      { id: 'old', name: 'old-skill', description: '旧技能', fileCount: 1, enabled: false, origin: { kind: 'local' } },
      { id: 'new', name: 'new-skill', description: '新技能', fileCount: 1, installed: personalInstalled, enabled: personalInstalled, origin: { kind: 'local' } },
    ] }
    if (endpoint === 'skills/installPersonal') { personalInstalled = true; return {} }
    throw new Error(endpoint)
  }, { startSkillCreation: async () => { started++ } })
  const installedFold = document.querySelector('[aria-label="已安装技能"] details')
  assert.equal(installedFold.open, false)
  assert.match(installedFold.querySelector('summary').textContent, /已安装\s*0/)
  assert.doesNotMatch(document.querySelector('[aria-label="已安装技能"]').textContent, /old-skill/)
  assert.doesNotMatch(document.querySelector('[aria-label="已安装技能"]').textContent, /new-skill/)
  assert.equal(document.querySelectorAll('input[type="search"]').length, 0)
  assert(document.querySelector('[aria-label="技能分类"]'))
  assert.equal(document.querySelector('dialog[open]'), null)
  await click('创建技能')
  assert.equal(started, 1)
  assert.equal(document.querySelector('dialog[open]'), null)
  await click('个人')
  const personalFold = document.querySelector('[aria-label="已安装技能"] details')
  assert.equal(personalFold.open, false)
  assert.match(personalFold.querySelector('summary').textContent, /已安装\s*1/)
  assert.equal(personalFold.querySelector('.resource-installed__icon')?.title, 'old-skill')
  assert.doesNotMatch(personalFold.textContent, /new-skill/)
  assert.equal(document.querySelectorAll('input[type="search"]').length, 1)
  assert.match(document.querySelector('[aria-label="技能库"]').textContent, /new-skill/)
  await click('安装')
  assert.equal(calls.find(call => call.endpoint === 'skills/installPersonal').payload.id, 'new')
  assert.match(document.querySelector('[aria-label="已安装技能"] summary').textContent, /已安装\s*2/)
  assert.equal(document.querySelector('[aria-label="已安装技能"] .resource-installed__icon[title="new-skill"]')?.title, 'new-skill')
  await click('导入技能')
  assert(document.querySelector('dialog[open][aria-label="导入技能"] input[type="file"]'))
  assert.equal(calls.some(call => call.endpoint === 'skills/create'), false)
})

test('技能页标题展示说明且无返回按钮和英文标记，并可查看已安装技能', async t => {
  const item = { id: 'managed', name: 'local-skill', description: '说明', fileCount: 1, contentHash: 'a'.repeat(64), enabled: false, origin: { kind: 'local' }, invocation: { modelInvocable: true, userInvocable: true } }
  const { click } = await mountPanel(t, 'skills', async endpoint => {
    if (endpoint === 'skills/list') return { revision: 1, skills: [item] }
    if (endpoint === 'skills/detail') return { ...item, rawContent: '---\nname: local-skill\ndescription: 说明\n---\n正文', content: '# 正文', files: [{ path: 'SKILL.md', size: 30 }] }
    throw new Error(endpoint)
  })
  assert.equal(document.querySelector('.skills-page-heading h1')?.textContent, '技能')
  assert.equal(document.querySelector('.skills-page-heading p')?.textContent, '浏览、安装和管理系统与个人技能。')
  assert.equal(document.querySelector('.resource-page-nav__back'), null)
  assert.equal(document.querySelector('.resource-page-nav__badge'), null)
  await click('个人')
  document.querySelector('[aria-label="已安装技能"] summary').click()
  await click('local-skill说明')
  assert(document.querySelector('dialog[open][aria-label="local-skill"]'))
})
