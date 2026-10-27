import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { openProductDatabase } from '../../local-data/src/index.js'
import { apply } from '../src/index.js'

test('organization RPC writes through the Host and rejects unauthenticated or forged requests', async t => {
  const home = mkdtempSync(join(tmpdir(), 'seal-organization-rpc-'))
  t.after(() => rmSync(home, { recursive: true, force: true }))
  const storage = openProductDatabase(home)
  const now = new Date().toISOString()
  storage.db.prepare('INSERT INTO users VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .run('owner', 'owner', 'Owner', Buffer.alloc(16), Buffer.alloc(64), 'admin', 'active', now, now)
  let session = { accountId: 'owner' }
  const routes = new Map(), provided = new Map()
  apply({ sealHarnessDatabase: storage, sealHarnessIdentity: { getSession: () => session },
    provide(name, value) { provided.set(name, value) }, logger: { error() {} },
    connection: { fetch: { register(route) { routes.set(route.path, route) } } },
  })
  const rpc = async (action, payload = {}) => {
    const method = `seal-harness-organization/${action}`
    const response = await routes.get(`/api/${method}`).fetch(new Request(`http://localhost/api/${method}`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'client-request', rpcId: 'test', method, payload }),
    }))
    return (await response.json()).result
  }
  try {
    assert(provided.has('sealHarnessOrganization'))
    const created = await rpc('department/save', { name: '研发部', parentId: null, sortOrder: 0, enabled: true })
    assert.equal(created.ok, true)
    assert.equal((await rpc('snapshot')).value.departments[0].name, '研发部')
    assert.equal((await rpc('person/save', { name: '张三', departmentId: created.value.id, jobTitle: '工程师', email: '', phone: '', status: 'active', userId: 'other' })).ok, false)
    session = null
    assert.equal((await rpc('snapshot')).error.code, 'sessionExpired')
    assert.equal((await rpc('department/delete', { id: created.value.id })).error.code, 'sessionExpired')
    assert.equal(storage.db.prepare('SELECT count(*) AS n FROM organization_departments').get().n, 1)
  } finally { storage.close() }
})
