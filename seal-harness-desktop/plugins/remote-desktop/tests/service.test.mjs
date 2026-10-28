import test from 'node:test'
import assert from 'node:assert/strict'
import { openProductDatabase } from '../../local-data/src/index.js'
import { hostConfig } from '../src/config.js'
import { harness, config } from './harness.mjs'

test('multiple protocols persist per account, edit in place, and delete without touching other users', async t => {
  const h = harness(t), ids = []
  for (const protocol of ['ssh', 'rdp', 'vnc']) ids.push(h.service.save({ name: protocol, config: config(protocol) }).host.id)
  assert.equal((await h.service.snapshot()).hosts.length, 3)
  assert.deepEqual(h.calls, [], 'snapshot must not probe or launch remote connections')
  const reopened = openProductDatabase(h.home)
  assert.equal(reopened.db.prepare('SELECT count(*) AS n FROM remote_hosts').get().n, 3)
  reopened.close()
  const original = h.service.record(h.identity.getSession(), ids[0])
  const edited = h.service.save({ id: ids[0], name: 'renamed', config: { ...config('ssh'), port: 2222 } }).host
  assert.equal(edited.id, original.id); assert.equal(edited.createdAt, original.createdAt)
  h.switch({ accountId: 'bob', epoch: 2 })
  assert.equal((await h.service.snapshot()).hosts.length, 0)
  for (const action of ['check', 'connect']) await assert.rejects(h.service[action]({ id: ids[0] }), { code: 'hostNotFound' })
  for (const action of ['save', 'delete']) assert.throws(() => h.service[action]({ id: ids[0], ...(action === 'save' ? { name: 'bad', config: config('ssh') } : {}) }), { code: 'hostNotFound' })
  h.switch({ accountId: 'alice', epoch: 3 })
  assert.deepEqual(h.service.delete({ id: ids[0] }), { deleted: true })
  assert.equal((await h.service.snapshot()).hosts.length, 2)
  h.switch(null)
  await assert.rejects(h.service.snapshot(), { code: 'loginRequired' })
})

test('strict profiles reject shell input, URL and credential fields; accept IPv6 and absolute key files', () => {
  for (const host of ['-oProxyCommand=bad', 'user@server', 'https://server', 'server:22', 'a\nb', 'server;echo', 'server x', 'bad..host'])
    assert.equal(hostConfig.safeParse({ ...config('ssh'), host }).success, false, host)
  for (const extra of [{ password: 'secret' }, { args: ['-o', 'bad'] }, { port: 0 }, { port: 65536 }, { identityFile: 'relative' }, { clientPath: 'cmd.exe' }])
    assert.equal(hostConfig.safeParse({ ...config('ssh'), ...extra }).success, false)
  assert.equal(hostConfig.safeParse({ ...config('ssh'), host: '2001:db8::1', identityFile: 'C:\\Keys with spaces\\id_ed25519' }).success, true)
  assert.equal(hostConfig.safeParse({ ...config('rdp'), identityFile: '/key' }).success, false)
})

test('checks report connectivity separately and connections only report client launch', async t => {
  const h = harness(t, { async probe() { return { reachable: false, reason: '连接被拒绝' } } })
  const { host } = h.service.save({ name: 'SSH', config: config('ssh') })
  const checked = await h.service.check({ id: host.id })
  assert.equal(checked.client.available, true); assert.equal(checked.network.reachable, false)
  const connected = await h.service.connect({ id: host.id })
  assert.equal(connected.launched, true); assert.equal(connected.hostId, host.id)
  assert.equal(Object.hasOwn(connected, 'connected'), false)
  assert.match(connected.message, /不代表远端已连接/)
  assert.throws(() => h.service.save({ userId: 'bob', name: 'bad', config: config('ssh') }))
})

test('account switch, logout, edits, deletion, request abort and dispose discard pending results', async t => {
  const h = harness(t)
  for (const change of ['epoch', 'logout', 'edit', 'delete', 'request', 'dispose']) {
    h.switch({ accountId: 'alice', epoch: 1 })
    const { host } = h.service.save({ name: change, config: config('ssh') })
    let finish, started
    const ready = new Promise(resolve => { started = resolve })
    let capturedSignal
    h.clients.probe = async (_config, signal) => { capturedSignal = signal; started(); await new Promise(resolve => { finish = resolve }); return { reachable: true } }
    const controller = new AbortController(), promise = h.service.check({ id: host.id }, controller.signal)
    await ready
    if (change === 'epoch') h.switch({ accountId: 'alice', epoch: 2 })
    if (change === 'logout') h.switch(null)
    if (change === 'edit') h.service.save({ id: host.id, name: 'changed', config: { ...host.config, port: 23 } })
    if (change === 'delete') h.service.delete({ id: host.id })
    if (change === 'request') controller.abort()
    if (change === 'dispose') h.service.dispose()
    assert.equal(capturedSignal.aborted, true, change)
    finish(); await assert.rejects(promise)
    assert.equal(h.service.operations.size, 0)
  }
})
