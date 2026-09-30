import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { openProductDatabase } from '../../local-data/src/index.js'
import { LocalIdentityService } from '../src/local-service.js'

test('local administrator registration and login use the shared SQLite database', async t => {
  const home = mkdtempSync(join(tmpdir(), 'seal-harness-local-login-'))
  t.after(() => rmSync(home, { recursive: true, force: true }))
  const storage = openProductDatabase(home)
  try {
    const identity = new LocalIdentityService(storage)
    assert.equal(identity.getStatus().canRegister, true)
    await assert.rejects(identity.register({ username: 'a', password: 'short' }), { code: 'invalidInput' })
    const registered = await identity.register({ username: 'admin', password: 'first-password-123', displayName: '管理员' })
    assert.equal(registered.user.displayName, '管理员')
    assert.equal(registered.canRegister, false)
    assert.equal(identity.getSession().accountId, registered.user.id)
    const row = storage.db.prepare('SELECT * FROM users WHERE username = ?').get('admin')
    assert.equal(row.role, 'admin')
    assert.equal(row.password_salt.length, 16)
    assert.equal(row.password_hash.length, 64)
    assert.equal(String(row.password_hash).includes('first-password-123'), false)
    await assert.rejects(identity.register({ username: 'second', password: 'second-password-123' }), { code: 'accountExists' })
    identity.logout()
    assert.equal(identity.getSession(), null)
    await assert.rejects(identity.login({ username: 'missing', password: 'first-password-123' }), { code: 'invalidCredentials' })
    await assert.rejects(identity.login({ username: 'admin', password: 'wrong-password' }), { code: 'invalidCredentials' })
    const loggedIn = await identity.login({ username: 'ADMIN', password: 'first-password-123' })
    assert.equal(loggedIn.user.id, registered.user.id)
    await identity.changePassword({ currentPassword: 'first-password-123', newPassword: 'changed-password-123' })
    identity.dispose()
    const restarted = new LocalIdentityService(storage)
    assert.equal(restarted.getStatus().user, null)
    await assert.rejects(restarted.login({ username: 'admin', password: 'first-password-123' }), { code: 'invalidCredentials' })
    assert.equal((await restarted.login({ username: 'admin', password: 'changed-password-123' })).user.id, registered.user.id)
  } finally { storage.close() }
})
