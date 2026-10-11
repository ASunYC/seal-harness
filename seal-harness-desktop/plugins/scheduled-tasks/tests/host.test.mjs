import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openProductDatabase } from '../../local-data/src/index.js'
import { apply } from '../src/index.js'

test('RPC validates the envelope and executes saved prompts in distinct native sessions', async t => {
  const home = mkdtempSync(join(tmpdir(), 'seal-schedule-rpc-')), storage = openProductDatabase(home)
  storage.db.prepare('INSERT INTO users VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .run('owner', 'owner', 'Owner', Buffer.alloc(16), Buffer.alloc(64), 'user', 'active', '', '')
  const routes = new Map(), effects = [], events = new Set(), calls = []
  let loggedIn = true
  const ctx = { sealHarnessDatabase: storage,
    sealHarnessIdentity: { getSession: () => loggedIn ? { accountId: 'owner' } : null, subscribe: () => () => {} },
    workspaceRegistry: { get: id => id === 'workspace' ? { id } : undefined },
    effect(callback) { effects.push(callback()) },
    on(_name, listener) { events.add(listener); return () => events.delete(listener) },
    connection: { fetch: { register(route) { routes.set(route.path, route) } } },
    sessionController: {
      async create(request) { calls.push(['create', request]) },
      async rename() {},
      async prompt(request) { calls.push(['prompt', request]); for (const listener of events) listener({ id: request.sessionId }, { type: 'turn/end', data: { reason: { kind: 'completed' } } }) },
      async resolveAgent() { return { agent: { async whenIdle() {} } } },
    },
  }
  apply(ctx)
  t.after(async () => { for (const dispose of effects) await dispose(); storage.close(); rmSync(home, { recursive: true, force: true }) })
  const request = (action, payload = {}, method = `seal-harness-scheduled-tasks/${action}`) => new Request(`http://localhost/api/${method}`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ type: 'client-request', rpcId: 'test', method, payload }),
  })
  const rpc = async (action, payload) => (await (await routes.get(`/api/seal-harness-scheduled-tasks/${action}`).fetch(request(action, payload))).json()).result
  loggedIn = false
  assert.equal((await rpc('list')).ok, false)
  loggedIn = true
  assert.equal((await rpc('save', { name: '', userId: 'other' })).ok, false)
  const task = (await rpc('save', { name: '状态检查', prompt: '报告项目状态', workspaceId: 'workspace', schedule: { kind: 'interval', minutes: 60 } })).value
  for (let count = 0; count < 2; count++) {
    assert.equal((await rpc('run', { id: task.id })).ok, true)
    await new Promise(resolve => setImmediate(resolve))
  }
  assert.equal(calls.filter(call => call[0] === 'create').length, 2)
  assert.notEqual(calls[0][1].sessionId, calls[2][1].sessionId)
  assert(calls.filter(call => call[0] === 'prompt').every(call => call[1].content[0].text === '报告项目状态'))
  assert.equal((await rpc('runs', { id: task.id })).value.length, 2)
  assert.equal((await routes.get('/api/seal-harness-scheduled-tasks/list').fetch(request('list', {}, 'wrong-method'))).status, 400)
})
