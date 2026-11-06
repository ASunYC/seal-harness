import test from 'node:test'
import assert from 'node:assert/strict'
import { JSDOM } from 'jsdom'
import { styles } from '../src/styles.js'

test('navigation rail leaves both DSH resize handles on their visible dividers', () => {
  const dom = new JSDOM(`<!doctype html><html><head></head><body><div id="root"><div class="frame">
    <div data-shell-overlay></div>
    <div data-side="sidebar"></div>
    <div data-side="rightbar"></div>
  </div></div></body></html>`)
  const { document } = dom.window
  const style = document.createElement('style')
  style.textContent = styles
  document.head.append(style)

  const frame = document.querySelector('.frame')
  const sidebarHandle = document.querySelector('[data-side="sidebar"]')
  const rightbarHandle = document.querySelector('[data-side="rightbar"]')
  const railWidth = parseFloat(dom.window.getComputedStyle(frame).paddingLeft)
  const sidebarShift = dom.window.getComputedStyle(sidebarHandle).transform
  const rightbarShift = dom.window.getComputedStyle(rightbarHandle).transform

  // DSH's absolute grid handles start after frame padding. The left handle
  // already follows its grid column; the right one must cancel the rail inset.
  assert.equal(railWidth, 56)
  assert.equal(sidebarShift, 'none')
  assert.equal(rightbarShift, `translateX(-${railWidth}px)`)
  dom.window.close()
})
