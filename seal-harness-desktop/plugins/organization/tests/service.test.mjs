import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { openProductDatabase } from '../../local-data/src/index.js'
import { OrganizationService } from '../src/service.js'

const member = (name, departmentId = null, extra = {}) => ({
  name, departmentId, jobTitle: '', email: '', phone: '', status: 'active', ...extra,
})
const department = (name, parentId = null, extra = {}) => ({
  name, parentId, sortOrder: 0, enabled: true, ...extra,
})

test('organization Host persists a scoped hierarchy and rejects cycles and cross-account references', t => {
  const home = mkdtempSync(join(tmpdir(), 'seal-organization-'))
  t.after(() => rmSync(home, { recursive: true, force: true }))
  const storage = openProductDatabase(home)
  const now = new Date().toISOString()
  for (const id of ['alice', 'bob']) {
    storage.db.prepare('INSERT INTO users VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run(id, id, id, Buffer.alloc(16), Buffer.alloc(64), 'admin', 'active', now, now)
  }
  let current = 'alice'
  const identity = { getSession: () => current ? { accountId: current } : null }
  const service = new OrganizationService({ storage, identity })
  try {
    assert.equal(service.snapshot().companyName, '我的组织')
    assert.equal(service.saveCompany({ name: '示例公司' }).companyName, '示例公司')
    const engineering = service.saveDepartment(department('研发部')).id
    const platform = service.saveDepartment(department('平台组', engineering)).id
    const person = service.savePerson(member('张三', platform, { jobTitle: '工程师', email: 'zhang@example.com' })).id
    assert.equal(service.snapshot().people[0].departmentId, platform)
    assert.throws(() => service.saveDepartment(department('研发部')), { code: 'duplicateDepartment' })
    assert.throws(() => service.saveDepartment(department('研发部', platform, { id: engineering })), { code: 'departmentCycle' })
    assert.throws(() => service.deleteDepartment({ id: engineering }), { code: 'departmentNotEmpty' })
    service.savePerson(member('张三', engineering, { id: person, jobTitle: '主管', status: 'disabled' }))
    service.saveDepartment(department('平台组', null, { id: platform, enabled: false }))
    assert.equal(service.snapshot().people[0].jobTitle, '主管')
    assert.equal(service.snapshot().departments.find(item => item.id === platform).enabled, false)
    current = 'bob'
    assert.deepEqual(service.snapshot().people, [])
    assert.equal(service.snapshot().companyName, '我的组织')
    assert.throws(() => service.savePerson(member('李四', platform)), { code: 'departmentNotFound' })
    assert.throws(() => service.saveDepartment(department('跨账号部门', engineering)), { code: 'departmentNotFound' })
    assert.throws(() => service.deletePerson({ id: person }), { code: 'personNotFound' })
    current = null
    assert.throws(() => service.snapshot(), { code: 'sessionExpired' })
    assert.throws(() => service.saveCompany({ name: '错误修改' }), { code: 'sessionExpired' })
    current = 'alice'
    service.deletePerson({ id: person })
    service.deleteDepartment({ id: platform })
    service.deleteDepartment({ id: engineering })
    assert.deepEqual(service.snapshot().departments, [])
  } finally { storage.close() }
  const reopened = openProductDatabase(home)
  try {
    assert.equal(reopened.db.prepare('SELECT company_name FROM organization_settings WHERE user_id = ?').get('alice').company_name, '示例公司')
    assert.equal(reopened.db.prepare('PRAGMA user_version').get().user_version, 8)
  } finally { reopened.close() }
})

test('v5 database upgrades without changing existing account and remembered login data', t => {
  const home = mkdtempSync(join(tmpdir(), 'seal-organization-v5-'))
  t.after(() => rmSync(home, { recursive: true, force: true }))
  const old = openProductDatabase(home)
  const now = new Date().toISOString()
  old.db.prepare('INSERT INTO users VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .run('owner', 'owner', 'Owner', Buffer.alloc(16), Buffer.alloc(64), 'admin', 'active', now, now)
  old.db.prepare('INSERT INTO remembered_logins VALUES (?, ?, ?, ?)')
    .run('owner', Buffer.alloc(32), Date.now() + 60000, Date.now())
  old.db.exec('DROP TABLE remote_hosts; DROP TABLE token_usage_turns; DROP TABLE acp_runners; DROP TABLE organization_people; DROP TABLE organization_departments; DROP TABLE organization_settings; PRAGMA user_version = 5')
  old.close()
  const upgraded = openProductDatabase(home)
  try {
    assert.equal(upgraded.db.prepare('SELECT display_name FROM users WHERE id = ?').get('owner').display_name, 'Owner')
    assert.equal(upgraded.db.prepare('SELECT count(*) AS n FROM remembered_logins').get().n, 1)
    assert.equal(upgraded.db.prepare('SELECT count(*) AS n FROM organization_departments').get().n, 0)
    assert.equal(upgraded.db.prepare('PRAGMA user_version').get().user_version, 8)
  } finally { upgraded.close() }
})
