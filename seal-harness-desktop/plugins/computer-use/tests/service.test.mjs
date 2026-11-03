import test from 'node:test'
import assert from 'node:assert/strict'
import { ComputerUseService, computerUseCredentialKey } from '../src/service.js'
import { parseCredentialsDocument } from '@deepseek-ai/dsh-credentials-local'
import { stringify } from 'yaml'
import { harness, vmProfile, deferred } from './harness.mjs'

test('digit-leading account UUID persists keys admitted by the actual restart credentials parser', async t => {
  const h = harness(t)
  h.switch({ accountId: '5aeb780c-4509-49e0-9c5e-2097ed4c0696', epoch: 2 })
  const { profile } = await h.service.save({ profile: vmProfile() })
  const document = stringify({ version: 1, records: Object.fromEntries(h.records) })
  const reopened = parseCredentialsDocument(document, 'fixture-credentials.yaml')
  assert.equal(reopened.records.size, 1)
  assert.match(computerUseCredentialKey('5aeb780c-4509-49e0-9c5e-2097ed4c0696'), /^seal-harness-computer-use\/account-[a-f0-9]{64}$/)
  assert.notEqual(computerUseCredentialKey('alice'), computerUseCredentialKey('bob'))
  h.records.clear()
  for (const [key, record] of reopened.records) h.records.set(key, record)
  assert.equal((await h.service.snapshot()).profiles.find(item => item.id === profile.id).host, 'vm.example.test')
})

test('profiles default to local background without launching; persisted VM profiles stay account-scoped', async t => {
  const h = harness(t), value = await h.service.snapshot()
  assert.equal(value.defaultMode, 'local'); assert.equal(value.backgroundOnly, true)
  assert.equal(value.profiles.length, 1); assert.equal(value.profiles[0].id, 'local'); assert.equal(value.runtime, null)
  assert.deepEqual(h.calls, [])
  const { profile } = await h.service.save({ profile: vmProfile() })
  const restarted = new ComputerUseService(h.ctx, { runtime: h.runtime, mount: h.mount })
  try { assert.equal((await restarted.snapshot()).profiles.some(item => item.id === profile.id), true) } finally { await restarted.dispose() }
  h.switch({ accountId: 'bob', epoch: 2 })
  assert.deepEqual((await h.service.snapshot()).profiles.map(item => item.id), ['local'])
  for (const action of ['check', 'delete']) await assert.rejects(h.service[action]({ id: profile.id }), { code: 'targetNotFound' })
  await assert.rejects(h.service.save({ profile: { ...profile, name: 'forged' } }), { code: 'targetNotFound' })
  h.switch({ accountId: 'alice', epoch: 3 })
  await assert.rejects(h.service.delete({ id: 'local' }), { code: 'localRequired' })
  assert.equal((await h.service.delete({ id: profile.id })).deleted, true)
  h.switch(null)
  await assert.rejects(h.service.snapshot(), { code: 'loginRequired' })
})

test('local and VM start in exact sessions; one desktop cannot be shared and stopping one leaves the other alive', async t => {
  const h = harness(t)
  assert.equal((await h.service.start({ sessionId: 'session-a' })).runtime.mode, 'local')
  assert.equal(h.mounted[0].agent.id, 'session-a')
  h.mounted[0].options.assertActive()
  await assert.rejects(h.service.start({ sessionId: 'session-b' }), { code: 'targetBusy' })
  const { profile } = await h.service.save({ profile: vmProfile() })
  assert.equal((await h.service.start({ sessionId: 'session-b', id: profile.id })).runtime.targetId, profile.id)
  assert.equal((await h.service.snapshot({ sessionId: 'session-a' })).runtime.mode, 'local')
  assert.equal((await h.service.snapshot({ sessionId: 'session-b' })).runtime.mode, 'vm')
  await h.service.stop({ sessionId: 'session-a' })
  assert.equal(h.connections[0].closed, 1); assert.equal(h.mounted[0].disposed, 1)
  assert.equal(h.connections[1].closed, 0); h.mounted[1].options.assertActive()
  assert.throws(() => h.mounted[0].options.assertActive())
  await h.emit('agent/disposed', { agent: h.agents.get('session-b') })
  assert.equal(h.connections[1].closed, 1)
})

test('epoch change cancels authorization and late observation results do not reach a new account', async t => {
  const h = harness(t)
  await h.service.start({ sessionId: 'session-a' })
  const before = h.mounted[0].options
  const pending = deferred(), began = deferred()
  h.connections[0].callTool = async (_name, _args, signal) => { began.resolve(signal); return pending.promise }
  const call = before.call('get_window_state', { pid: 2, window_id: 3 }, new AbortController().signal)
  const activeSignal = await began.promise
  h.switch({ accountId: 'alice', epoch: 2 })
  assert.equal(activeSignal.aborted, true)
  pending.resolve({ content: [{ type: 'image', mimeType: 'image/png', data: 'old-account-image' }] })
  await assert.rejects(call)
  assert.throws(() => before.assertActive(), { code: 'accountChanged' })
  assert.equal((await h.service.snapshot({ sessionId: 'session-a' })).runtime, null)
})

test('saving an active profile stops it only after successful persistence; failed save preserves current authorization', async t => {
  const h = harness(t)
  const { profile } = await h.service.save({ profile: vmProfile() })
  await h.service.start({ sessionId: 'session-a', id: profile.id })
  h.failSave(true)
  await assert.rejects(h.service.save({ profile: { ...profile, name: 'unsaved' } }), /disk full/)
  assert.equal(h.connections[0].closed, 0); h.mounted[0].options.assertActive()
  h.failSave(false)
  await h.service.save({ profile: { ...profile, name: 'saved' } })
  assert.equal(h.connections[0].closed, 1)
  assert.equal((await h.service.snapshot({ sessionId: 'session-a' })).runtime, null)
})

test('busy or missing sessions and forged scope parameters never launch a runtime', async t => {
  const h = harness(t)
  h.agents.get('session-a').status = 'busy'
  await assert.rejects(h.service.start({ sessionId: 'session-a' }), { code: 'sessionBusy' })
  await assert.rejects(h.service.start({ sessionId: 'missing' }), { code: 'sessionUnavailable' })
  assert.throws(() => h.service.start({ sessionId: 'session-a', accountId: 'bob' }))
  await assert.rejects(h.service.snapshot({ accountId: 'bob' }))
  await assert.rejects(h.service.save({ profile: { ...vmProfile(), password: 'never-save' } }))
  assert.deepEqual(h.calls, [])
})

test('stop during a delayed launch closes a runtime that returns after cancellation', async t => {
  const launch = deferred(), began = deferred(), h = harness(t, { runtime: { async launch(_profile, options) { began.resolve(options.signal); return launch.promise } } })
  const start = h.service.start({ sessionId: 'session-a' }), signal = await began.promise
  await h.service.stop({ sessionId: 'session-a' })
  assert.equal(signal.aborted, true)
  const connection = h.connection(); launch.resolve(connection)
  await assert.rejects(start)
  assert.equal(connection.closed, 1, 'late process transport must be closed even if stop already completed')
  assert.equal(h.service.active.size, 0)
})

test('stop during delayed scope mounting releases a scope that returns after cancellation', async t => {
  const mounted = deferred(), began = deferred(), scope = { disposed: 0, async dispose() { this.disposed++ } }
  const h = harness(t, { async mount() { began.resolve(); return mounted.promise } })
  const start = h.service.start({ sessionId: 'session-a' }); await began.promise
  await h.service.stop({ sessionId: 'session-a' })
  mounted.resolve(scope); await assert.rejects(start)
  assert.equal(scope.disposed, 1, 'late tool scope must not survive user stop')
  assert.equal(h.connections[0].closed, 1)
})

test('a completed start survives its UI request cancellation, while explicit stop revokes calls queued behind a running one', async t => {
  const h = harness(t), request = new AbortController()
  await h.service.start({ sessionId: 'session-a' }, request.signal)
  request.abort()
  h.mounted[0].options.assertActive()
  assert.equal(h.connections[0].closed, 0, 'closing the popover must not implicitly stop the enabled session')
  const pending = deferred(), began = deferred(), delivered = []
  h.connections[0].callTool = async (name, _args, signal) => { delivered.push(name); began.resolve(signal); return pending.promise }
  const one = h.mounted[0].options.call('click', { pid: 1, window_id: 1 }, new AbortController().signal)
  const runningSignal = await began.promise
  const two = h.mounted[0].options.call('type_text', { pid: 1, window_id: 1, text: 'must not be sent' }, new AbortController().signal)
  await h.service.stop({ sessionId: 'session-a' })
  assert.equal(runningSignal.aborted, true)
  pending.resolve({ content: [{ type: 'text', text: 'late' }] })
  await assert.rejects(one); await assert.rejects(two)
  assert.deepEqual(delivered, ['click'])
})

test('diagnostics are cancelled on account changes and late check results stay private', async t => {
  const pending = deferred(), began = deferred()
  const h = harness(t, { runtime: { async inspect(_profile, signal) { began.resolve(signal); return pending.promise } } })
  const check = h.service.check({ id: 'local' })
  const signal = await began.promise
  h.switch({ accountId: 'bob', epoch: 2 })
  assert.equal(signal.aborted, true)
  pending.resolve({ available: true, command: 'previous account path' })
  await assert.rejects(check)
})
