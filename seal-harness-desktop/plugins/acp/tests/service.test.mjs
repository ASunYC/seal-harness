import assert from 'node:assert/strict'
import test from 'node:test'
import { setTimeout as delay } from 'node:timers/promises'
import { harness } from './harness.mjs'

test('public LocalSubprocessRuntime drives real SDK runner without a fake spawn adapter', async t => {
  const { Context } = await import('@deepseek-ai/cordis')
  const { default: LocalSubprocessRuntime } = await import('@deepseek-ai/dsh-subprocess-local')
  const ctx = new Context()
  const fiber = await ctx.plugin(LocalSubprocessRuntime)
  const h = harness(t, { subprocess: ctx.subprocess })
  try {
    const { id } = await h.service.save({ name: 'Native fixture', config: h.config(), enabled: true })
    const checked = await h.service.check({ id })
    assert.equal(checked.ready, true)
    const result = await h.service.execute({ id, prompt: 'native' }, new AbortController().signal)
    assert.equal(result.status, 'completed'); assert.equal(result.output, 'ACP:native')
    const pending = h.service.run({ id, prompt: 'wait' })
    await until(() => h.service.runs.get(pending.id).output === 'partial')
    assert.equal((await h.service.cancel({ id: pending.id })).status, 'cancelled')
    assert.equal(h.service.jobs.size, 0)
  } finally { await h.service.dispose(); await fiber.dispose() }
})

const until = async predicate => { for (let i = 0; i < 100; i++) { if (await predicate()) return; await delay(20) } throw new Error('condition timed out') }

test('runner config is scoped, persists without secrets, and rejects invalid inputs', async t => {
  const h = harness(t)
  const { id } = await h.service.save({ name: 'Fixture', config: h.config(), enabled: true, environment: { ACP_EXPLICIT_KEY: 'fixture-key' } })
  const snapshot = await h.service.snapshot()
  const item = snapshot.items.find(item => item.id === id)
  assert.deepEqual(item.environmentNames, ['ACP_EXPLICIT_KEY'])
  assert.equal(JSON.stringify(snapshot).includes('fixture-key'), false)
  assert.equal(h.storage.db.prepare('SELECT config_json FROM acp_runners').get().config_json.includes('fixture-key'), false)
  assert.equal(item.check, null)
  h.switch({ accountId: 'bob', epoch: 2 })
  assert.equal((await h.service.snapshot()).items.some(item => item.id === id), false)
  await assert.rejects(h.service.toggle({ id, enabled: true }), { code: 'runnerNotFound' })
  await assert.rejects(h.service.check({ id }), { code: 'runnerNotFound' })
  await assert.rejects(h.service.save({ name: 'Invalid', config: h.config('normal', { cwd: 'relative' }) }))
  await assert.rejects(h.service.save({ name: 'Invalid', config: h.config(), environment: { NODE_OPTIONS: '--inspect' } }))
  h.switch(null)
  await assert.rejects(h.service.snapshot(), { code: 'notLoggedIn' })
})

test('real ACP subprocess initializes, creates a session, streams output and stops cleanly', async t => {
  const h = harness(t)
  const { id } = await h.service.save({ name: 'Fixture', config: h.config(), enabled: true })
  const facts = await h.service.check({ id })
  assert.equal(facts.ready, true); assert.equal(facts.agentName, 'Fixture ACP')
  const result = await h.service.execute({ id, prompt: 'hello' }, new AbortController().signal)
  assert.equal(result.status, 'completed'); assert.equal(result.output, 'ACP:hello'); assert.equal(result.stopReason, 'end_turn')
  assert.equal(result.kind, 'task')
  assert.equal(h.service.jobs.size, 0)
  assert(h.subprocess.children.every(child => child.exitCode !== null || child.signalCode !== null))
  await h.service.toggle({ id, enabled: false })
  assert.throws(() => h.service.run({ id, prompt: 'no' }), { code: 'runnerDisabled' })
})

test('ACP permission default rejects, optional policy chooses only allow_once, output is bounded', async t => {
  const h = harness(t)
  const { id } = await h.service.save({ name: 'Fixture', config: h.config(), enabled: true })
  const rejected = await h.service.execute({ id, prompt: 'permission' }, new AbortController().signal)
  assert.equal(rejected.output, 'rejected'); assert.equal(rejected.permissionDecision, 'rejected')
  await h.service.save({ id, name: 'Fixture', config: h.config('normal', { permission: 'allow-once' }), enabled: true })
  const once = await h.service.execute({ id, prompt: 'permission' }, new AbortController().signal)
  assert.equal(once.output, 'once'); assert.equal(once.permissionDecision, 'allowed-once')
  const large = await h.service.execute({ id, prompt: 'large' }, new AbortController().signal)
  assert.equal(large.output.length, 65536); assert.equal(large.truncated, true)
})

test('native subprocess seam scrubs ambient secrets while explicitly configured env reaches runner', async t => {
  const h = harness(t), previous = process.env.ACP_AMBIENT_SECRET
  process.env.ACP_AMBIENT_SECRET = 'never-forward'
  t.after(() => { if (previous === undefined) delete process.env.ACP_AMBIENT_SECRET; else process.env.ACP_AMBIENT_SECRET = previous })
  const { id } = await h.service.save({ name: 'Fixture', config: h.config(), enabled: true, environment: { ACP_EXPLICIT_KEY: 'fixture-key' } })
  const result = await h.service.execute({ id, prompt: 'environment' }, new AbortController().signal)
  assert.deepEqual(JSON.parse(result.output), { ambient: false, explicit: true })
})

test('cancel, timeout, disable and account switch reap real protocol processes', async t => {
  const h = harness(t)
  const { id } = await h.service.save({ name: 'Fixture', config: h.config(), enabled: true })
  const run = h.service.run({ id, prompt: 'wait' })
  await until(() => h.service.runs.get(run.id).output === 'partial')
  const cancelled = await h.service.cancel({ id: run.id })
  assert.equal(cancelled.status, 'cancelled'); assert.equal(cancelled.output, 'partial')
  assert.equal(h.service.jobs.size, 0)
  const next = h.service.run({ id, prompt: 'wait' })
  await until(() => h.service.runs.get(next.id).output === 'partial')
  await h.service.toggle({ id, enabled: false })
  assert.equal(h.service.runs.get(next.id).status, 'cancelled')
  await h.service.toggle({ id, enabled: true })
  const timeout = await h.service.execute({ id, prompt: 'wait' }, new AbortController().signal)
  assert.equal(timeout.status, 'timeout')
  const switched = h.service.run({ id, prompt: 'wait' })
  await until(() => h.service.runs.get(switched.id).output === 'partial')
  h.switch({ accountId: 'bob', epoch: 3 })
  await until(() => h.service.jobs.size === 0)
  assert.equal((await h.service.snapshot()).runs.length, 0)
  assert(h.subprocess.children.every(child => child.exitCode !== null || child.signalCode !== null))
})

test('malformed/non-ACP process and missing program never report ready', async t => {
  const h = harness(t)
  const { id } = await h.service.save({ name: 'Wrong', config: h.config('garbage'), enabled: true })
  await assert.rejects(h.service.check({ id }))
  assert.equal((await h.service.snapshot()).items.find(item => item.id === id).check.ready, false)
  await h.service.save({ id, name: 'Missing', config: h.config('normal', { command: 'missing-acp-program' }), enabled: true })
  const failed = await h.service.execute({ id, prompt: 'hello' }, new AbortController().signal)
  assert.equal(failed.status, 'failed'); assert.equal(failed.output, '')
  assert.equal(h.service.jobs.size, 0)
})

test('config mutation blocks interleaved run/check and keeps cleanup failures reserved', async t => {
  let release, waiting
  const gate = new Promise(resolve => { release = resolve })
  const h = harness(t)
  const { id } = await h.service.save({ name: 'Fixture', config: h.config(), enabled: true })
  const original = h.credentials.readRecord
  h.credentials.readRecord = async key => { waiting = true; await gate; return original(key) }
  const first = h.service.run({ id, prompt: 'wait' })
  await until(() => waiting)
  const disabling = h.service.toggle({ id, enabled: false })
  assert.throws(() => h.service.run({ id, prompt: 'interleaved' }), { code: 'runnerBusy' })
  await assert.rejects(h.service.check({ id }), { code: 'runnerBusy' })
  release(); await disabling
  assert.equal(h.service.runs.get(first.id).status, 'cancelled')
  const blocked = harness(t, { createProcess: () => ({ async open() { return {} }, async prompt() { return { stopReason: 'end_turn' } }, async close() { throw new Error('not stopped') } }) })
  const saved = await blocked.service.save({ name: 'Blocked', config: blocked.config(), enabled: true })
  const result = await blocked.service.execute({ id: saved.id, prompt: 'test' }, new AbortController().signal)
  assert.equal(result.status, 'blocked'); assert.equal(blocked.service.jobs.size, 1)
  assert.throws(() => blocked.service.run({ id: saved.id, prompt: 'again' }), { code: 'cleanupFailed' })
  await assert.rejects(blocked.service.delete({ id: saved.id }), { code: 'cleanupFailed' })
})

test('cancel exits a pending executable lookup without spawning or waiting for lookup completion', async t => {
  const h = harness(t)
  const { id } = await h.service.save({ name: 'Lookup', config: h.config(), enabled: true })
  let lookupStarted = false
  h.subprocess.resolveExecutable = async (_command, _environment, signal) => {
    lookupStarted = true
    assert(signal instanceof AbortSignal)
    return new Promise(() => {})
  }
  const run = h.service.run({ id, prompt: 'hello' })
  await until(() => lookupStarted)
  const result = await h.service.cancel({ id: run.id })
  assert.equal(result.status, 'cancelled')
  assert.equal(h.service.jobs.size, 0)
  assert.equal(h.subprocess.children.length, 0)
})

test('explicit runner PATH participates in discovery and transport resolution', async t => {
  const h = harness(t), seen = []
  const original = h.subprocess.resolveExecutable
  h.subprocess.resolveExecutable = async (command, environment, signal) => {
    if (command !== 'configured-runner') return original(command, environment, signal)
    seen.push(environment)
    assert.equal(environment.PATH, h.home)
    assert(signal instanceof AbortSignal)
    return process.execPath
  }
  const { id } = await h.service.save({ name: 'Path runner', config: h.config('normal', { command: 'configured-runner' }), enabled: true, environment: { PATH: h.home } })
  assert.equal((await h.service.snapshot()).items.find(item => item.id === id).discovery.found, true)
  const result = await h.service.execute({ id, prompt: 'from-path' }, new AbortController().signal)
  assert.equal(result.output, 'ACP:from-path')
  assert.equal(seen.length, 2)
})

test('stdout transport errors become task failure and still reap the child', async t => {
  const h = harness(t)
  const { id } = await h.service.save({ name: 'Read error', config: h.config(), enabled: true })
  const run = h.service.run({ id, prompt: 'wait' })
  await until(() => h.service.runs.get(run.id).output === 'partial')
  h.subprocess.children[0].stdout.emit('error', new Error('fixture read failure'))
  const result = await h.service.runs.get(run.id).done
  assert.equal(result.status, 'failed')
  assert.equal(result.output, 'partial')
  assert.equal(h.service.jobs.size, 0)
})
