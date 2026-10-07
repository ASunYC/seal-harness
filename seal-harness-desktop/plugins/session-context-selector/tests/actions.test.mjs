import assert from 'node:assert/strict'
import test from 'node:test'

import { createPanelSelector, createResourceActions } from '../src/actions.js'

test('能力选择器插入精确技能命令并保留当前选择位置', () => {
  const calls = []
  const actions = createResourceActions({
    inputActions: {
      captureInsertion: () => ({ start: 4, end: 4, revision: 2 }),
      insertText: (text, span) => { calls.push({ text, span }); return true },
    },
    selectPanel: () => assert.fail('不应切换面板'),
  })

  assert.equal(actions.skill('codegraph-explore'), true)
  assert.deepEqual(calls, [
    { text: '/codegraph-explore ', span: { start: 4, end: 4, revision: 2 } },
  ])
})

test('专家进入现有管理面板，连接器由会话选择器独立处理', () => {
  const panels = []
  const actions = createResourceActions({
    inputActions: { captureInsertion: () => assert.fail('不应写输入框') },
    selectPanel: panel => panels.push(panel),
  })

  actions.expert()
  assert.equal(actions.connector, undefined)
  assert.deepEqual(panels, ['seal-harness-experts'])
})

test('会话资源快捷入口打开首页内对应的二级页面', () => {
  const panels = [], resources = []
  const select = createPanelSelector({ selectPanel: panel => panels.push(panel) }, { select: id => resources.push(id) })
  for (const panel of ['seal-harness-skills', 'seal-harness-connectors', 'seal-harness-experts']) select(panel)
  assert.deepEqual(resources, ['skills', 'connectors', 'experts'])
  assert.deepEqual(panels, ['seal-harness-home', 'seal-harness-home', 'seal-harness-home'])
})

test('输入已锁定或草稿变化时透传插入失败', () => {
  const actions = createResourceActions({
    inputActions: {
      captureInsertion: () => ({ start: 0, end: 0, revision: 1 }),
      insertText: () => false,
    },
    selectPanel: () => {},
  })

  assert.equal(actions.skill('codegraph-explore'), false)
})

test('能力选择器拒绝无效技能名', () => {
  const actions = createResourceActions({
    inputActions: { captureInsertion: () => assert.fail('无效名称不应写输入框') },
    selectPanel: () => {},
  })

  assert.equal(actions.skill('../bad'), false)
})
