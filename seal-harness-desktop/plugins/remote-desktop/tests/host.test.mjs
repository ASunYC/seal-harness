import test from 'node:test'
import assert from 'node:assert/strict'
import { apply } from '../src/index.js'
import { harness, config } from './harness.mjs'

test('RPC validates envelopes, owns identity, and removes screenshot/control endpoints', async t => {
  const h = harness(t), routes = new Map(), disposers = []
  let service
  apply({ sealHarnessIdentity: h.identity, sealHarnessDatabase: h.storage,
    provide(_name, value) { service = value }, effect(callback) { disposers.push(callback()) },
    connection: { fetch: { register(route) { routes.set(route.path, route) } } }, logger: { warn() {} } })
  t.after(() => { for (const dispose of disposers) dispose?.() })
  service.clients = h.clients
  const call = (action, payload = {}, options = {}) => routes.get(`/api/seal-harness-remote-desktop/${action}`).fetch(new Request('http://host/api', {
    method: 'POST', headers: { 'content-type': 'application/json', ...options.headers },
    body: options.body ?? JSON.stringify({ type: 'client-request', rpcId: 'remote-1', method: `seal-harness-remote-desktop/${action}`, payload }),
  }))
  assert.equal(routes.size, 5)
  for (const old of ['frame', 'input', 'disconnect', 'status']) assert.equal(routes.has(`/api/seal-harness-remote-desktop/${old}`), false)
  assert.equal((await call('snapshot', {}, { headers: { 'content-type': 'text/plain' } })).status, 415)
  assert.equal((await call('snapshot', {}, { body: '{' })).status, 400)
  assert.equal((await call('snapshot', {}, { body: JSON.stringify({ type: 'client-request', rpcId: 'x', method: 'other', payload: {} }) })).status, 400)
  const save = await (await call('save', { name: 'SSH', config: config('ssh') })).json()
  assert.equal(save.result.ok, true); assert.equal(save.rpcId, 'remote-1')
  assert.equal((await (await call('snapshot', { userId: 'bob' })).json()).result.ok, false)
  h.switch(null)
  assert.equal((await (await call('snapshot')).json()).result.error.code, 'loginRequired')
  h.switch({ accountId: 'alice', epoch: 2 })
  service.clients.inspect = async () => { throw Error('secret internal details') }
  const failure = await (await call('snapshot')).json()
  assert.equal(JSON.stringify(failure).includes('secret internal'), false)
})
