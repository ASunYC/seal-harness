import test from 'node:test'
import assert from 'node:assert/strict'
import { JSDOM } from 'jsdom'
import { pageStyles } from '../src/page-styles.js'
import { styles as remoteStyles } from '../../remote-desktop/src/styles.js'

test('native automation task list stays left with or without a selected detail', () => {
  const dom = new JSDOM('<html><head></head><body><div id="root"><section data-testid="task-manager-page"><div id="list"><div><div><div><h1>自动化任务</h1></div></div></div></div></section></div></body></html>')
  const { document } = dom.window
  const style = document.createElement('style')
  style.textContent = pageStyles
  document.head.append(style)
  const page = document.querySelector('[data-testid="task-manager-page"]')
  const list = document.querySelector('#list')
  assert.equal(dom.window.getComputedStyle(list).flex, '0 0 260px')
  assert.equal(dom.window.getComputedStyle(list).display, 'flex')
  assert(page.matches(':not(:has(> aside))'))
  const detail = document.createElement('aside')
  page.append(detail)
  assert.equal(dom.window.getComputedStyle(detail).flex, '1 1 auto')
  assert.equal(page.matches(':not(:has(> aside))'), false)
  dom.window.close()
})

test('remote host sidebar starts at the rail edge while detail owns the page inset', () => {
  const dom = new JSDOM('<html><head></head><body><div id="root"><main class="seal-remote-page"><aside class="seal-remote-sidebar"></aside><section class="seal-remote-content"></section></main></div></body></html>')
  const { document } = dom.window
  const style = document.createElement('style')
  style.textContent = `${remoteStyles}\n${pageStyles}`
  document.head.append(style)
  const page = document.querySelector('.seal-remote-page')
  assert.equal(dom.window.getComputedStyle(page).gridTemplateColumns, '260px minmax(0,1fr)')
  assert.equal(dom.window.getComputedStyle(page).padding, '0')
  assert.equal(dom.window.getComputedStyle(document.querySelector('.seal-remote-sidebar')).display, 'flex')
  page.classList.add('seal-remote-page--login')
  assert.equal(dom.window.getComputedStyle(page).display, 'block')
  dom.window.close()
})
