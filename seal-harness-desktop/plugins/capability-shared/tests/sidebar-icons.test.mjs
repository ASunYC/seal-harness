import test, { after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { build } from 'tsdown'
import { JSDOM } from 'jsdom'
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'

const directory = dirname(fileURLToPath(import.meta.url))

async function compile() {
  const outDir = mkdtempSync(join(directory, '.sidebar-icons-'))
  await build({
    config: false,
    cwd: join(directory, '..'),
    entry: { index: 'src/sidebar-icons.jsx' },
    outDir,
    clean: false,
    dts: false,
    format: 'esm',
    platform: 'browser',
    target: 'es2022',
    deps: { neverBundle: [/^react(?:-dom)?(?:\/|$)/] },
  })
  return { module: await import(`${pathToFileURL(join(outDir, 'index.js')).href}?t=${Date.now()}`), outDir }
}

const compiled = await compile()
after(() => rmSync(compiled.outDir, { recursive: true, force: true }))

async function withDom(reducedMotion, run) {
  const dom = new JSDOM('<!doctype html><html><body><main></main></body></html>', { pretendToBeVisual: true })
  const previous = { window: globalThis.window, document: globalThis.document, navigator: globalThis.navigator, requestAnimationFrame: globalThis.requestAnimationFrame, cancelAnimationFrame: globalThis.cancelAnimationFrame }
  globalThis.window = dom.window
  globalThis.document = dom.window.document
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: dom.window.navigator })
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  globalThis.requestAnimationFrame = dom.window.requestAnimationFrame.bind(dom.window)
  globalThis.cancelAnimationFrame = dom.window.cancelAnimationFrame.bind(dom.window)
  dom.window.matchMedia = () => ({ matches: reducedMotion, addEventListener() {}, removeEventListener() {} })
  globalThis.matchMedia = dom.window.matchMedia
  try { await run(dom) } finally {
    dom.window.close()
    globalThis.window = previous.window
    globalThis.document = previous.document
    Object.defineProperty(globalThis, 'navigator', { configurable: true, value: previous.navigator })
    globalThis.requestAnimationFrame = previous.requestAnimationFrame
    globalThis.cancelAnimationFrame = previous.cancelAnimationFrame
    delete globalThis.matchMedia
    delete globalThis.IS_REACT_ACT_ENVIRONMENT
  }
}

test('menu icon morphs on row hover and focus, then returns to idle', async () => {
  await withDom(false, async dom => {
    const host = dom.window.document.querySelector('main')
    const root = createRoot(host)
    try {
      await act(async () => root.render(React.createElement('button', null,
        React.createElement(compiled.module.AnimatedSidebarIcon, { name: 'store', size: 18 }))))
      const button = host.querySelector('button')
      const icon = () => host.querySelector('[data-sidebar-icon-state]')
      assert.equal(icon().dataset.sidebarIconState, 'idle')
      await act(async () => button.dispatchEvent(new dom.window.MouseEvent('mouseenter')))
      assert.equal(icon().dataset.sidebarIconState, 'emphasized')
      await act(async () => button.dispatchEvent(new dom.window.MouseEvent('mouseleave')))
      assert.equal(icon().dataset.sidebarIconState, 'idle')
      await act(async () => button.dispatchEvent(new dom.window.FocusEvent('focusin', { bubbles: true })))
      assert.equal(icon().dataset.sidebarIconState, 'emphasized')
    } finally { await act(async () => root.unmount()) }
  })
})

test('selected icons stay emphasized and reduced motion disables wrapper movement', async () => {
  await withDom(true, async dom => {
    const host = dom.window.document.querySelector('main')
    const root = createRoot(host)
    try {
      await act(async () => root.render(React.createElement('button', null,
        React.createElement(compiled.module.AnimatedSidebarIcon, { name: 'connectors', size: 18, active: true }))))
      const icon = host.querySelector('[data-sidebar-icon-state]')
      assert.equal(icon.dataset.sidebarIconState, 'emphasized')
      assert.equal(icon.dataset.reducedMotion, 'true')
      assert.equal(icon.style.transition, 'none')
    } finally { await act(async () => root.unmount()) }
  })
})

test('every product navigation icon renders in idle and emphasized states', async () => {
  await withDom(false, async dom => {
    const host = dom.window.document.querySelector('main')
    const root = createRoot(host)
    try {
      for (const name of ['projects', 'agents', 'store', 'plugins', 'connectors', 'library']) {
        await act(async () => root.render(React.createElement('button', null,
          React.createElement(compiled.module.AnimatedSidebarIcon, { name, size: 18, active: false }))))
        assert.equal(host.querySelector('[data-sidebar-icon-name]')?.getAttribute('data-sidebar-icon-name'), name)
        await act(async () => root.render(React.createElement('button', null,
          React.createElement(compiled.module.AnimatedSidebarIcon, { name, size: 18, active: true }))))
        assert.equal(host.querySelector('[data-sidebar-icon-state]')?.getAttribute('data-sidebar-icon-state'), 'emphasized')
      }
    } finally { await act(async () => root.unmount()) }
  })
})
