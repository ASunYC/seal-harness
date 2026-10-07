import { createRequire } from 'node:module'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL, fileURLToPath } from 'node:url'
import { runInNewContext } from 'node:vm'

const root = fileURLToPath(new URL('../../../../', import.meta.url))
const toolRoot = process.env.SEAL_HARNESS_TEST_TOOLS_ROOT ?? root
export const require = createRequire(join(toolRoot, 'dsh-plugin-desktop-beta/package.json'))
const rootRequire = createRequire(join(toolRoot, 'package.json'))
export const React = require('react')
export const { act } = React

export async function mountPanel(t, plugin, api, props = {}) {
  const output = await mkdtemp(join(tmpdir(), `seal-harness-${plugin}-ui-`))
  const { build } = await import(pathToFileURL(require.resolve('tsdown')).href)
  await build({ config: false, entry: [resolve(root, `seal-harness-desktop/plugins/${plugin}/src/panel.jsx`)], outDir: output,
    format: 'cjs', platform: 'browser', dts: false, sourcemap: false,
    deps: { neverBundle: [/^react(?:-dom)?(?:\/|$)/], onlyBundle: false },
    alias: { 'markdown-it': rootRequire.resolve('markdown-it') }, logLevel: 'silent' })
  const { JSDOM, VirtualConsole } = require('jsdom')
  const dom = new JSDOM('<!doctype html><main></main>', { virtualConsole: new VirtualConsole() })
  const previous = { window: globalThis.window, document: globalThis.document }
  globalThis.window = dom.window; globalThis.document = dom.window.document
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  dom.window.HTMLDialogElement.prototype.showModal = function () { this.open = true }
  dom.window.HTMLDialogElement.prototype.close = function () { this.open = false }
  const module = { exports: {} }
  runInNewContext(await readFile(join(output, 'panel.js'), 'utf8'), { module, exports: module.exports, require,
    atob, AbortController, TextDecoder, setTimeout, clearTimeout, document: dom.window.document, window: dom.window })
  const { createRoot } = require('react-dom/client')
  const panel = module.exports[plugin === 'store' ? 'StorePanel' : 'SkillsPanel']
  const render = createRoot(document.querySelector('main'))
  t.after(async () => { await act(async () => render.unmount()); dom.window.close(); Object.assign(globalThis, previous); delete globalThis.IS_REACT_ACT_ENVIRONMENT; await rm(output, { recursive: true, force: true }) })
  await act(async () => render.render(React.createElement(panel, { api, ...props })))
  const click = async text => {
    const button = [...document.querySelectorAll('button')].find(button => button.textContent.trim() === text || button.getAttribute('aria-label') === text)
    if (!button) throw new Error(`没有按钮：${text}`)
    await act(async () => button.click())
  }
  return { dom, click }
}
