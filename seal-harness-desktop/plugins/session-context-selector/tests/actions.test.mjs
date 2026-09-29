import assert from 'node:assert/strict'
import test from 'node:test'

import { createResourceActions } from '../src/actions.js'

test('能力选择器复用技能输入触发器并保留当前选择位置', () => {
  const calls = []
  const actions = createResourceActions({
    inputActions: {
      captureInsertion: () => ({ start: 4, end: 4, revision: 2 }),
      insertText: (text, span) => { calls.push({ text, span }); return true },
    },
    selectPanel: () => assert.fail('不应切换面板'),
  })

  assert.equal(actions.skill(), true)
  assert.deepEqual(calls, [
    { text: '/skill ', span: { start: 4, end: 4, revision: 2 } },
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

test('输入已锁定或草稿变化时透传插入失败', () => {
  const actions = createResourceActions({
    inputActions: {
      captureInsertion: () => ({ start: 0, end: 0, revision: 1 }),
      insertText: () => false,
    },
    selectPanel: () => {},
  })

  assert.equal(actions.skill(), false)
})
