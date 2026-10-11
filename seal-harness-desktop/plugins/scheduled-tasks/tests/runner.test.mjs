import test from 'node:test'
import assert from 'node:assert/strict'
import { createSessionRunner } from '../src/runner.js'

function fixture(reason) {
  const calls = [], listeners = new Set()
  const ctx = {
    on(name, listener) { assert.equal(name, 'session/event'); listeners.add(listener); return () => listeners.delete(listener) },
    sessionController: {
      async create(input) { calls.push(['create', input]) },
      async rename(input) { calls.push(['rename', input]) },
      async prompt(input) {
        calls.push(['prompt', input])
        if (reason) for (const listener of listeners) listener({ id: input.sessionId }, { type: 'turn/end', data: { reason } })
      },
      async cancel(input) { calls.push(['cancel', input]) },
      async resolveAgent() { return { agent: { async whenIdle() {} } } },
    },
  }
  return { ctx, calls, listeners }
}
const task = { name: '检查', workspaceId: 'workspace', prompt: '检查状态', schedule: { timeZone: 'Asia/Shanghai' } }
const run = { id: 'run-1', sessionId: 'session-1' }

test('a fresh native session receives the actual prompt and settles only on its own turn end', async () => {
  const { ctx, calls, listeners } = fixture({ kind: 'completed' })
  let created = 0
  const result = await createSessionRunner(ctx)(task, run, new AbortController().signal, () => created++)
  assert.equal(result.status, 'completed')
  assert.equal(created, 1)
  assert.deepEqual(calls.map(call => call[0]), ['create', 'rename', 'prompt'])
  assert.deepEqual(calls[0][1], { sessionId: run.sessionId, workspaceId: task.workspaceId })
  assert.deepEqual(calls[2][1].content, [{ type: 'text', text: task.prompt }])
  assert.equal(calls[2][1].clientTimeZone, 'Asia/Shanghai')
  assert.equal(listeners.size, 0)
})

test('model failure, cancellation and timeout have distinct outcomes and release observers', async () => {
  const failed = fixture({ kind: 'error', error: { message: '模型失败' } })
  assert.deepEqual(await createSessionRunner(failed.ctx)(task, run, new AbortController().signal, () => {}), { status: 'failed', error: '模型失败' })
  const cancelled = fixture(), controller = new AbortController()
  const promise = createSessionRunner(cancelled.ctx)(task, run, controller.signal, () => {})
  await new Promise(resolve => setImmediate(resolve)); controller.abort()
  assert.equal((await promise).status, 'cancelled')
  assert.equal(cancelled.calls.filter(call => call[0] === 'cancel').length, 1)
  const timed = fixture()
  const keepAlive = setTimeout(() => {}, 1000)
  try { assert.equal((await createSessionRunner(timed.ctx, 5)(task, run, new AbortController().signal, () => {})).status, 'timeout') }
  finally { clearTimeout(keepAlive) }
  assert.equal(timed.calls.filter(call => call[0] === 'cancel').length, 1)
  assert.equal(timed.listeners.size, 0)
})

test('cancel before creation prevents prompting, and late creation after logout is cancelled', async () => {
  const aborted = fixture(), controller = new AbortController(); controller.abort()
  assert.equal((await createSessionRunner(aborted.ctx)(task, run, controller.signal, () => {})).status, 'cancelled')
  assert.deepEqual(aborted.calls, [])
  const late = fixture(), pending = new AbortController()
  let createDone
  late.ctx.sessionController.create = () => new Promise(resolve => { createDone = resolve })
  const result = createSessionRunner(late.ctx)(task, run, pending.signal, () => {})
  pending.abort(); createDone()
  assert.equal((await result).status, 'cancelled')
  assert.equal(late.calls.some(call => call[0] === 'prompt'), false)
  assert.equal(late.calls.some(call => call[0] === 'cancel'), true)
})

test('cancellation does not finish the run before native agent cleanup is idle', async () => {
  const { ctx } = fixture(), controller = new AbortController()
  let idle, finished = false
  ctx.sessionController.resolveAgent = async () => ({ agent: { whenIdle: () => new Promise(resolve => { idle = resolve }) } })
  const result = createSessionRunner(ctx)(task, run, controller.signal, () => {}).then(value => { finished = true; return value })
  await new Promise(resolve => setImmediate(resolve)); controller.abort()
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(finished, false)
  idle()
  assert.equal((await result).status, 'cancelled')
})
