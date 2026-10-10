import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { runInNewContext } from 'node:vm'

const require = createRequire(import.meta.url)
const React = require('react'), { act } = React

test('scheduled task content uses the existing rail and refreshes native sessions before opening results', async t => {
  const { JSDOM } = require('jsdom')
  const dom = new JSDOM('<!doctype html><html><head></head><body><main></main></body></html>')
  const previous = { window: globalThis.window, document: globalThis.document }
  Object.assign(globalThis, { window: dom.window, document: dom.window.document, IS_REACT_ACT_ENVIRONMENT: true })
  const disposers = [], events = []
  let entry
  const status = { user: { id: 'owner' }, accountId: 'owner', epoch: 1 }
  const workspaces = { items: [{ workspaceId: 'workspace', title: '项目' }] }
  const ctx = {
    effect(callback) { disposers.push(callback()) },
    sealHarnessAuthClient: { subscribe: () => () => {}, getStatus: () => status },
    workspaces: { list: { subscribe: () => () => {}, getSnapshot: () => workspaces } },
    sealHarnessNavigation: { register(value) { entry = value; return () => {} }, leaveDecision() { events.push('leaveDecision') } },
    sessions: { async refresh() { events.push('refresh') } },
    uiWorkspace: { openSession(id) { events.push(['open', id]) } },
    layout: { selectPanel(value) { events.push(['panel', value]) } },
    connection: { rpc: { async call(prefix, method) {
      assert.equal(prefix, '/api'); assert.equal(method, 'seal-harness-scheduled-tasks/list')
      return { ok: true, value: [{ id: 'task', name: '检查', prompt: '检查状态', workspaceId: 'workspace', enabled: false,
        schedule: { kind: 'interval', minutes: 60 }, lastRun: { status: 'completed', startedAt: Date.now(), sessionId: 'native-session' } }] }
    } } },
  }
  const loaded = {}
  runInNewContext(await readFile(new URL('../lib/client.js', import.meta.url), 'utf8'), {
    window: { __ModuleLoader__: { load({ id, factory }) { assert.equal(id, '@seal-harness/scheduled-tasks'); Object.assign(loaded, factory(require)) } } },
    document: dom.window.document, setInterval, clearInterval,
  })
  loaded.apply(ctx)
  assert.equal(entry.id, 'seal-harness-schedules')
  const root = require('react-dom/client').createRoot(document.querySelector('main'))
  t.after(async () => { await act(async () => root.unmount()); for (const dispose of disposers) dispose?.(); dom.window.close(); Object.assign(globalThis, previous); delete globalThis.IS_REACT_ACT_ENVIRONMENT })
  await act(async () => root.render(React.createElement(entry.Panel)))
  const open = [...document.querySelectorAll('button')].find(button => button.textContent === '打开最近会话')
  assert(open)
  await act(async () => open.click())
  assert.deepEqual(events, ['refresh', 'leaveDecision', ['open', 'native-session'], ['panel', null]])
})
