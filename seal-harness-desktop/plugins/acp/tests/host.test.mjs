import test from 'node:test'
import assert from 'node:assert/strict'
import { apply } from '../src/index.js'
import { harness } from './harness.mjs'

test('RPC validates envelopes and local identity; model tool executes the same actual ACP path', async t => {
  const h = harness(t), routes = new Map(), tools = new Map(), disposers = []
  let service
  apply({
    sealHarnessDatabase: h.storage, sealHarnessIdentity: h.identity, credentials: h.credentials, subprocess: h.subprocess,
    provide(name, value) { assert.equal(name, 'sealHarnessAcp'); service = value },
    effect(callback) { disposers.push(callback()) },
    connection: { fetch: { register(route) { routes.set(route.path, route) } } },
    tools: { register(tool) { tools.set(tool.name, tool) } },
  })
  t.after(async () => { for (const dispose of disposers) await dispose() })
  const call = (action, payload = {}, options = {}) => routes.get(`/api/seal-harness-acp/${action}`).fetch(new Request(`http://localhost/api/seal-harness-acp/${action}`, {
    method: 'POST', headers: { 'content-type': 'application/json', ...options.headers },
    body: options.body ?? JSON.stringify({ type: 'client-request', rpcId: 'acp-test', method: `seal-harness-acp/${action}`, payload }),
  }))
  assert.equal(routes.size, 7)
  assert.equal((await call('snapshot', {}, { headers: { 'content-type': 'text/plain' } })).status, 415)
  assert.equal((await call('snapshot', {}, { body: '{' })).status, 400)
  assert.equal((await call('snapshot', {}, { body: JSON.stringify({ type: 'client-request', rpcId: 'x', method: 'other', payload: {} }) })).status, 400)
  h.switch(null)
  const denied = await (await call('snapshot')).json()
  assert.equal(denied.result.error.code, 'notLoggedIn')
  h.switch({ accountId: 'alice', epoch: 2 })
  const invalid = await (await call('save', { name: 'Invalid', config: h.config(), owner: 'bob' })).json()
  assert.equal(invalid.result.ok, false)
  const saved = await (await call('save', { name: 'Fixture', config: h.config(), enabled: true })).json()
  assert.equal(saved.result.ok, true)
  const id = saved.result.value.id
  const listed = JSON.parse(await tools.get('list_acp_runners').execute({}))
  assert.equal(listed.length, 1); assert.equal(listed[0].id, id)
  const result = JSON.parse(await tools.get('acp_runner').execute({ id, prompt: 'tool-task' }, { signal: new AbortController().signal }))
  assert.equal(result.status, 'completed'); assert.equal(result.output, 'ACP:tool-task')
  const aborted = new AbortController(); aborted.abort()
  const cancelled = JSON.parse(await tools.get('acp_runner').execute({ id, prompt: 'wait' }, { signal: aborted.signal }))
  assert.equal(cancelled.status, 'cancelled')
  await service.dispose()
})
