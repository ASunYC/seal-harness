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

test('remembered local login resumes once, rotates credentials, and is revoked by logout or password change', async t => {
  const home = mkdtempSync(join(tmpdir(), 'seal-harness-remember-login-'))
  t.after(() => rmSync(home, { recursive: true, force: true }))
  let storage = openProductDatabase(home)
  let identity = new LocalIdentityService(storage)
  try {
    const registered = await identity.register({ username: 'admin', password: 'first-password-123' })
    assert.equal(registered.rememberToken, undefined)
    identity.logout()
    const signedIn = await identity.login({ username: 'admin', password: 'first-password-123', remember: true })
    assert.equal(signedIn.remembered, true)
    assert.match(signedIn.rememberToken, /^[A-Za-z0-9_-]{43}$/u)
    const row = storage.db.prepare('SELECT token_hash, expires_at FROM remembered_logins').get()
    assert.equal(row.token_hash.length, 32)
    assert.equal(Buffer.from(row.token_hash).includes(Buffer.from(signedIn.rememberToken)), false)
    assert.ok(row.expires_at > Date.now())
    identity.dispose()
    storage.close()
    storage = openProductDatabase(home)
    identity = new LocalIdentityService(storage)
    assert.equal(identity.getStatus().user, null)
    const resumed = identity.resume({ token: signedIn.rememberToken })
    assert.equal(resumed.user.id, registered.user.id)
    assert.notEqual(resumed.rememberToken, signedIn.rememberToken)
    assert.throws(() => identity.resume({ token: signedIn.rememberToken }), { code: 'sessionExpired' })
    identity.logout()
    assert.throws(() => identity.resume({ token: resumed.rememberToken }), { code: 'sessionExpired' })

    const rememberedAgain = await identity.login({ username: 'admin', password: 'first-password-123', remember: true })
    await identity.changePassword({ currentPassword: 'first-password-123', newPassword: 'second-password-123' })
    assert.equal(identity.getStatus().remembered, false)
    assert.throws(() => identity.resume({ token: rememberedAgain.rememberToken }), { code: 'sessionExpired' })
    identity.logout()
    const temporary = await identity.login({ username: 'admin', password: 'second-password-123' })
    assert.equal(temporary.rememberToken, undefined)
    assert.equal(temporary.remembered, false)
    assert.equal(storage.db.prepare('SELECT count(*) AS count FROM remembered_logins').get().count, 0)
  } finally { identity.dispose(); storage.close() }
})

test('expired or disabled remembered login cannot restore a session', async t => {
  const home = mkdtempSync(join(tmpdir(), 'seal-harness-expired-login-'))
  t.after(() => rmSync(home, { recursive: true, force: true }))
  const storage = openProductDatabase(home)
  const identity = new LocalIdentityService(storage)
  try {
    const first = await identity.register({ username: 'admin', password: 'first-password-123', remember: true })
    storage.db.prepare('UPDATE remembered_logins SET expires_at = ?').run(Date.now() - 1)
    identity.dispose()
    const restarted = new LocalIdentityService(storage)
    assert.throws(() => restarted.resume({ token: first.rememberToken }), { code: 'sessionExpired' })
    const second = await restarted.login({ username: 'admin', password: 'first-password-123', remember: true })
    storage.db.prepare("UPDATE users SET status = 'disabled' WHERE username = 'admin'").run()
    restarted.dispose()
    const disabled = new LocalIdentityService(storage)
    assert.throws(() => disabled.resume({ token: second.rememberToken }), { code: 'sessionExpired' })
    disabled.dispose()
  } finally { storage.close() }
})
