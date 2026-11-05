import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { runInNewContext } from 'node:vm'
import { openProductDatabase } from '../../local-data/src/index.js'
import { ScheduledTasksService } from '../src/service.js'

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
  t.after(async () => { await act(async () => root.unmount()); Object.assign(globalThis, previous); delete globalThis.IS_REACT_ACT_ENVIRONMENT; dom.window.close(); await service.dispose(); storage.close(); await rm(output, { recursive: true, force: true }) })
  const calls = [], opened = [], executions = []
  const storage = openProductDatabase(join(output, 'data'))
  storage.db.prepare('INSERT INTO users VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)').run('owner', 'owner', 'owner', Buffer.alloc(16), Buffer.alloc(64), 'user', 'active', '', '')
  let now = Date.parse('2026-11-05T00:00:00Z')
  const service = new ScheduledTasksService({ storage, identity: { getSession: () => ({ accountId: 'owner' }), subscribe: () => () => {} },
    workspaceRegistry: { get: id => id === 'workspace' ? { id } : undefined }, now: () => now,
    execute: async (task, run, signal, created) => { executions.push(task.id); created(); return { status: 'completed' } } })
  const api = async (action, payload = {}) => {
    calls.push({ action, payload })
    if (action === 'list') return service.list()
    if (action === 'save') return service.save(payload)
    if (action === 'run') { const result = service.runNow(payload.id); await Promise.all([...service.active.values()].map(run => run.promise)); return result }
    if (action === 'runs') return service.runs(payload.id)
    if (action === 'toggle') return service.toggle(payload.id, payload.enabled)
    if (action === 'delete') return service.remove(payload.id)
    throw new Error(action)
  }
  const click = async label => {
    const button = [...document.querySelectorAll('button')].find(item => item.textContent === label)
    assert(button, `missing ${label}`)
    await act(async () => button.click())
  }
  await act(async () => root.render(React.createElement(module.exports.ScheduledTasksPanel, { api, workspaces: [{ workspaceId: 'workspace', title: '项目' }], openSession: id => opened.push(id) })))
  assert.match(document.body.textContent, /还没有自动化任务/)
  await click('新建自动化任务')
  assert.equal(opened.length, 0)
  await click('取消')
  assert.equal(document.querySelector('form'), null)
  assert.equal(calls.some(call => call.action === 'save'), false)
  await click('＋ 新建')
  let form = document.querySelector('form')
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
  assert.equal(opened.length, 0, 'saving a plan stays on the management page')
  assert.match(document.querySelector('.seal-schedules__row').textContent, /每日检查/)
  await click('立即运行')
  await click('执行记录')
  assert.match(document.querySelector('[aria-label="每日检查执行记录"]').textContent, /已完成/)
  await click('打开会话')
  assert.match(opened[0], /^session-scheduled-/)
  await click('暂停')
  assert.equal(calls.find(call => call.action === 'toggle').payload.enabled, false)
  await click('删除')
  assert.equal(calls.some(call => call.action === 'delete'), false)
  await click('确认删除')
  assert.match(document.body.textContent, /还没有自动化任务/)
  assert.equal(document.querySelector('[role="alert"]'), null)
  executions.length = 0
  for (const kind of ['once', 'weekly', 'interval', 'daily']) {
    await click('＋ 新建')
    form = document.querySelector('form')
    await input('input:not([type])', `计划 ${kind}`)
    await input('textarea', '执行保存的提示词')
    await act(async () => require('react-dom/test-utils').Simulate.change(form.querySelectorAll('select')[1], { target: { value: kind } }))
    if (kind === 'once') await input('input[type="datetime-local"]', '2026-11-06T12:00')
    await act(async () => form.dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true })))
    assert.equal(document.querySelector('form'), null)
    const task = service.list().find(task => task.name === `计划 ${kind}`)
    assert.equal(task.schedule.kind, kind)
    assert.ok(task.nextRunAt > now)
    assert.match(document.querySelector('.seal-schedules__task').textContent, new RegExp(`计划 ${kind}`))
  }
  assert.deepEqual(executions, [], 'saving and selecting plans must not execute them or open a session')
  const interval = service.list().find(task => task.schedule.kind === 'interval')
  now = interval.nextRunAt
  service.tick()
  await Promise.all([...service.active.values()].map(run => run.promise))
  assert.ok(executions.includes(interval.id), 'a plan created from the form is picked up by the actual scheduler')
  assert.equal(service.runs(interval.id)[0].status, 'completed')
})
