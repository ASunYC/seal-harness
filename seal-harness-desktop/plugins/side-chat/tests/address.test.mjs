import assert from 'node:assert/strict'
import test from 'node:test'
import { parseSideChatAddress, quotedSelection, sideChatAddress } from '../src/address.js'

test('侧聊地址保留父会话和独立会话，拒绝其他资源', () => {
  const address = sideChatAddress('main/甲', 'side-1')
  assert.deepEqual(parseSideChatAddress(address), { parentSessionId: 'main/甲', sideSessionId: 'side-1' })
  assert.equal(parseSideChatAddress('dsh-resource://file/session/a'), undefined)
  assert.equal(parseSideChatAddress('dsh-resource://seal-side-chat/session/a'), undefined)
})

test('选中文本只生成草稿引用，不触发提交', () => {
  assert.equal(quotedSelection(' 第一行\n第二行 '), '引用主对话：\n> 第一行\n> 第二行\n\n')
  assert.equal(quotedSelection('  '), '')
  assert.ok(quotedSelection('a'.repeat(20000)).length < 12100)
})
