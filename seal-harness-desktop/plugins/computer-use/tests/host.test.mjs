import test from 'node:test'
import assert from 'node:assert/strict'
import { apply } from '../src/index.js'
import { harness } from './harness.mjs'

test('Host RPC validates envelopes and identity without opening the driver on snapshot', async t => {
  const h = harness(t), routes = new Map(), disposers = []
  let service
  apply({ ...h.ctx, provide(_key, value) { service = value }, effect(callback) { disposers.push(callback()) },
    connection: { fetch: { register(route) { routes.set(route.path, route) } } },
  })
  t.after(async () => { for (const dispose of disposers) await dispose?.() })
  service.runtime = h.runtime
  const call = (action, payload = {}, options = {}) => routes.get(`/api/seal-harness-computer-use/${action}`).fetch(new Request('http://host/api', {
    method: 'POST', headers: { 'content-type': 'application/json', ...options.headers },
    body: options.body ?? JSON.stringify({ type: 'client-request', rpcId: 'computer-rpc', method: `seal-harness-computer-use/${action}`, payload }),
  }))
  assert.equal(routes.size, 6)
  assert.equal((await call('snapshot', {}, { headers: { 'content-type': 'text/plain' } })).status, 415)
  assert.equal((await call('snapshot', {}, { body: '{' })).status, 400)
  assert.equal((await call('snapshot', {}, { body: JSON.stringify({ type: 'client-request', rpcId: 'x', method: 'other', payload: {} }) })).status, 400)
  const snapshot = await (await call('snapshot')).json()
  assert.equal(snapshot.rpcId, 'computer-rpc'); assert.equal(snapshot.result.ok, true)
  assert.equal(snapshot.result.value.defaultMode, 'local'); assert.equal(snapshot.result.value.backgroundOnly, true)
  assert.deepEqual(h.calls, [])
  assert.equal((await (await call('snapshot', { accountId: 'bob' })).json()).result.ok, false)
  h.switch(null)
  assert.equal((await (await call('snapshot')).json()).result.error.code, 'loginRequired')
  h.switch({ accountId: 'alice', epoch: 2 })
  service.runtime.inspect = async () => { throw Error('secret underlying diagnostic') }
  const failure = await (await call('check', { id: 'local' })).json()
  assert.equal(failure.result.ok, false); assert.equal(JSON.stringify(failure).includes('secret underlying diagnostic'), false)
})
