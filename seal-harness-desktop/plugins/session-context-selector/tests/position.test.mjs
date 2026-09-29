import assert from 'node:assert/strict'
import test from 'node:test'
import { connectorPopoverPosition } from '../src/position.js'

test('连接器选择器横向对齐输入框并贴在触发器上方', () => {
  assert.deepEqual(connectorPopoverPosition({
    trigger: { left: 590, right: 680, top: 790, bottom: 816, width: 90, height: 26 },
    composer: { left: 348, right: 1488, top: 710, bottom: 830, width: 1140, height: 120 },
    popover: { width: 780, height: 200 },
    viewport: { width: 1564, height: 900 },
  }), { left: 348, top: 582 })
})

test('连接器选择器始终留在视口安全边距内', () => {
  assert.deepEqual(connectorPopoverPosition({
    trigger: { left: 6, right: 70, top: 120, bottom: 146, width: 64, height: 26 },
    composer: { left: 4, right: 996, top: 80, bottom: 180, width: 992, height: 100 },
    popover: { width: 980, height: 300 },
    viewport: { width: 1000, height: 700 },
  }), { left: 12, top: 12 })
})
