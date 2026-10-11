import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openProductDatabase } from '../../local-data/src/index.js'
import { ScheduledTasksService } from '../src/service.js'

function fixture(t, execute) {
  const home = mkdtempSync(join(tmpdir(), 'seal-scheduled-'))
  const storage = openProductDatabase(home)
  for (const id of ['alice', 'bob']) storage.db.prepare('INSERT INTO users VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .run(id, id, id, Buffer.alloc(16), Buffer.alloc(64), 'user', 'active', '', '')
  let user = 'alice', now = Date.parse('2026-10-09T00:00:00Z')
  const listeners = new Set()
  const identity = { getSession: () => user ? { accountId: user } : null, subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener) } }
  const options = { storage, identity, workspaceRegistry: { get: id => id === 'workspace' ? { id } : undefined }, execute, now: () => now }
  const service = new ScheduledTasksService(options)
  t.after(async () => { await service.dispose(); storage.close(); rmSync(home, { recursive: true, force: true }) })
  return { service, storage, options, home, advance(ms) { now += ms }, login(id) { user = id; for (const listener of listeners) listener() } }
}
const input = { name: '每日检查', prompt: '检查状态', workspaceId: 'workspace', enabled: true, schedule: { kind: 'interval', minutes: 1 } }
const drain = async service => { await Promise.all([...service.active.values()].map(run => run.promise)) }

test('tasks persist, CRUD is account isolated, invalid schedules/workspaces reject, deletion preserves execution session identity', async t => {
  const { service, storage, login } = fixture(t, async (_task, _run, _signal, created) => { created(); return { status: 'completed' } })
  const task = service.save(input)
  assert.equal(service.list().length, 1)
  assert.throws(() => service.save({ ...input, workspaceId: 'missing' }), /工作区/)
  assert.throws(() => service.save({ ...input, schedule: { kind: 'once', at: '2020-01-01T00:00:00Z' } }), /未来/)
  login('bob')
  assert.deepEqual(service.list(), [])
  for (const operation of [() => service.runs(task.id), () => service.toggle(task.id, false), () => service.remove(task.id), () => service.runNow(task.id), () => service.save({ ...input, id: task.id })]) assert.throws(operation, /不属于/)
  login('alice')
  service.runNow(task.id)
  await drain(service)
  const record = service.runs(task.id)[0]
  assert.equal(record.status, 'completed')
  assert.match(record.sessionId, /^session-scheduled-/)
  const reopened = openProductDatabase(service.storage.path.replace(/[\\/]seal-harness.sqlite$/, ''))
  assert.equal(reopened.db.prepare('SELECT name FROM scheduled_tasks WHERE id = ?').get(task.id).name, input.name)
  reopened.close()
  service.toggle(task.id, false)
  assert.equal(service.task(task.id).nextRunAt, null)
  service.remove(task.id)
  assert.equal(storage.db.prepare('SELECT count(*) AS n FROM scheduled_runs').get().n, 0)
  login(null)
  assert.throws(() => service.list(), /登录/)
})

test('automatic runs are unique, never overlap and missed schedules do not backfill', async t => {
  let settle, executions = 0
  const { service, storage, advance, login } = fixture(t, async (_task, _run, signal, created) => {
    executions++; created()
    return new Promise(resolve => { settle = resolve; signal.addEventListener('abort', () => resolve({ status: 'cancelled' }), { once: true }) })
  })
  const task = service.save(input)
  advance(60000); service.tick(); service.tick()
  await Promise.resolve()
  assert.equal(executions, 1)
  assert.equal(service.runs(task.id).length, 1)
  assert.throws(() => service.runNow(task.id), /正在执行/)
  advance(60000); service.tick()
  assert.equal(service.runs(task.id).length, 1)
  settle({ status: 'completed' }); await drain(service)
  advance(60000); service.tick(); await Promise.resolve()
  assert.equal(executions, 2)
  login(null); await drain(service)
  assert.equal(storage.db.prepare('SELECT status FROM scheduled_runs WHERE task_id = ? ORDER BY started_at DESC LIMIT 1').get(task.id).status, 'cancelled')
  advance(3600000); login('alice'); service.tick()
  assert.equal(executions, 2)
  advance(180000); service.tick()
  assert.equal(executions, 2)
})

test('restart marks orphaned executions interrupted and once schedules disable after firing', async t => {
  const { service, storage, options, advance } = fixture(t, async () => ({ status: 'failed', error: 'model unavailable' }))
  const task = service.save({ ...input, schedule: { kind: 'once', at: '2026-10-09T00:01:00Z' } })
  storage.db.prepare("INSERT INTO scheduled_runs (id, task_id, task_name, session_id, fire_key, status, started_at) VALUES ('orphan', ?, '旧执行', 'old-session', 'old', 'running', 1)").run(task.id)
  const restarted = new ScheduledTasksService(options)
  assert.equal(restarted.runs(task.id)[0].status, 'interrupted')
  await restarted.dispose()
  advance(60000); service.tick(); await drain(service)
  assert.equal(service.task(task.id).enabled, false)
  assert.equal(service.runs(task.id)[0].error, 'model unavailable')
})

test('a rolled-back schedule claim never starts an external session', async t => {
  let executed = 0
  const { service, storage, advance } = fixture(t, async () => { executed++; return { status: 'completed' } })
  const task = service.save(input)
  advance(60000)
  service.storage = { ...storage, transaction(operation) { storage.transaction(() => { operation(); throw new Error('commit rejected') }) } }
  assert.throws(() => service.tick(), /commit rejected/)
  await Promise.resolve()
  assert.equal(executed, 0)
  assert.equal(service.active.size, 0)
  assert.equal(service.runs(task.id).length, 0)
  service.storage = storage
  service.tick(); await drain(service)
  assert.equal(executed, 1)
})
