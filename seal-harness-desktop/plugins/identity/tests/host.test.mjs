import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { openProductDatabase } from '../../local-data/src/index.js'
import { apply } from '../src/index.js'

test('local identity RPC registers, logs in and logs out without WeCom routes', async t => {
  const home = mkdtempSync(join(tmpdir(), 'seal-harness-login-rpc-'))
  t.after(() => rmSync(home, { recursive: true, force: true }))
  const storage = openProductDatabase(home)
  const routes = new Map(), provided = new Map(), disposers = []
  const ctx = { sealHarnessDatabase: storage,
    provide(key, service) { provided.set(key, service) },
    effect(callback) { disposers.push(callback()) },
    connection: { fetch: { register(route) { routes.set(route.path, route) } } },
  }
  try {
    await apply(ctx)
    const rpc = async (action, payload = {}) => {
      const method = `seal-harness-identity/${action}`
      const route = routes.get(`/api/${method}`)
      assert(route, method)
      const response = await route.fetch(new Request(`http://localhost/api/${method}`, { method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ type: 'client-request', rpcId: 'test', method, payload }) }))
      assert.equal(response.status, 200)
      return (await response.json()).result
    }
    assert.equal(routes.has('/api/seal-harness-identity/wecom/start'), false)
    assert.equal(routes.has('/api/seal-harness-identity/sso/start'), false)
    assert.equal((await rpc('status')).value.canRegister, true)
    const created = await rpc('register', { username: 'admin', password: 'local-password-123' })
    assert.equal(created.ok, true)
    assert.equal(provided.get('sealHarnessIdentity').getSession().accountId, created.value.user.id)
    assert.equal((await rpc('logout')).value.user, null)
    assert.equal((await rpc('login', { username: 'admin', password: 'bad' })).error.code, 'invalidCredentials')
    assert.equal((await rpc('login', { username: 'admin', password: 'local-password-123' })).ok, true)
    assert.equal(provided.get('sealHarnessServices').getConfig().identityBaseUrl, '')
  } finally { disposers.forEach(dispose => dispose?.()); storage.close() }
})
