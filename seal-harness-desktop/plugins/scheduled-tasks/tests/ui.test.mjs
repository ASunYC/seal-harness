import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { runInNewContext } from 'node:vm'

const require = createRequire(new URL('../../../../dsh-plugin-desktop-beta/package.json', import.meta.url))
const React = require('react'), { act } = React

test('the page creates a schedule, runs it, opens history, pauses and deletes with confirmation', async t => {
  const output = await mkdtemp(join(tmpdir(), 'seal-schedules-ui-'))
  const { build } = await import(pathToFileURL(require.resolve('tsdown')))
  await build({ config: false, entry: [new URL('../src/panel.jsx', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')],
    outDir: output, format: 'cjs', platform: 'browser', dts: false, sourcemap: false,
    deps: { neverBundle: [/^react(?:-dom)?(?:\/|$)/] }, logLevel: 'silent' })
  const { JSDOM } = require('jsdom')
  const dom = new JSDOM('<!doctype html><main></main>')
  const previous = { window: globalThis.window, document: globalThis.document }
  Object.assign(globalThis, { window: dom.window, document: dom.window.document, IS_REACT_ACT_ENVIRONMENT: true })
  const module = { exports: {} }
  runInNewContext(await readFile(join(output, 'panel.js'), 'utf8'), { module, exports: module.exports, require, setInterval, clearInterval })
  const root = require('react-dom/client').createRoot(document.querySelector('main'))
  t.after(async () => { await act(async () => root.unmount()); Object.assign(globalThis, previous); delete globalThis.IS_REACT_ACT_ENVIRONMENT; dom.window.close(); await rm(output, { recursive: true, force: true }) })
  const calls = [], opened = []
  let tasks = []
  const api = async (action, payload = {}) => {
    calls.push({ action, payload })
    if (action === 'list') return tasks
    if (action === 'save') { tasks = [{ ...payload, id: 'task', nextRunAt: Date.now() + 3600000 }]; return tasks[0] }
    if (action === 'run') { tasks = [{ ...tasks[0], lastRun: { id: 'run', status: 'completed', startedAt: Date.now(), sessionId: 'session' } }]; return {} }
    if (action === 'runs') return [{ id: 'run', status: 'completed', startedAt: Date.now(), sessionId: 'session' }]
    if (action === 'toggle') { tasks = [{ ...tasks[0], enabled: payload.enabled }]; return tasks[0] }
    if (action === 'delete') { tasks = []; return { deleted: true } }
    throw new Error(action)
  }
  const click = async label => {
    const button = [...document.querySelectorAll('button')].find(item => item.textContent === label)
    assert(button, `missing ${label}`)
    await act(async () => button.click())
  }
  await act(async () => root.render(React.createElement(module.exports.ScheduledTasksPanel, { api, workspaces: [{ workspaceId: 'workspace', title: '项目' }], openSession: id => opened.push(id) })))
  assert.match(document.body.textContent, /当前没有定时任务/)
  await click('创建任务')
  const form = document.querySelector('form')
  const input = async (selector, value) => {
    const node = form.querySelector(selector)
    await act(async () => {
      const prototype = node.tagName === 'TEXTAREA' ? dom.window.HTMLTextAreaElement.prototype : dom.window.HTMLInputElement.prototype
      Object.getOwnPropertyDescriptor(prototype, 'value').set.call(node, value)
      node.dispatchEvent(new dom.window.Event('input', { bubbles: true }))
    })
  }
  await input('input:not([type])', '每日检查')
  await input('textarea', '检查项目状态')
  await act(async () => form.dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true })))
  const saved = calls.find(call => call.action === 'save')
  assert(saved)
  assert.equal(saved.payload.workspaceId, 'workspace')
  assert.equal(saved.payload.schedule.kind, 'daily')
  assert.equal(saved.payload.name, '每日检查')
  assert.equal(saved.payload.prompt, '检查项目状态')
  await click('立即运行')
  await click('执行记录')
  assert.match(document.querySelector('[aria-label="每日检查执行记录"]').textContent, /已完成/)
  await click('打开会话')
  assert.deepEqual(opened, ['session'])
  await click('暂停')
  assert.equal(calls.find(call => call.action === 'toggle').payload.enabled, false)
  await click('删除')
  assert.equal(calls.some(call => call.action === 'delete'), false)
  await click('确认删除')
  assert.match(document.body.textContent, /当前没有定时任务/)
  assert.equal(document.querySelector('[role="alert"]'), null)
})
