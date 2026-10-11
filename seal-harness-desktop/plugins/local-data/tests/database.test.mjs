import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { openProductDatabase } from '../src/index.js'

test('one database persists users, projects, experts and skills with user isolation', t => {
  const home = mkdtempSync(join(tmpdir(), 'seal-harness-db-'))
  t.after(() => rmSync(home, { recursive: true, force: true }))
  const storage = openProductDatabase(home)
  const first = randomUUID(), second = randomUUID(), now = new Date().toISOString()
  try {
    for (const [id, username] of [[first, 'alice'], [second, 'bob']]) {
      storage.db.prepare('INSERT INTO users VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
        .run(id, username, username, Buffer.alloc(16), Buffer.alloc(64), 'user', 'active', now, now)
    }
    storage.db.prepare('INSERT INTO projects VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(randomUUID(), first, 'First', '/workspace/first', '', now, now)
    storage.db.prepare('INSERT INTO experts VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run(randomUUID(), first, 'Writer', '0.1.0', '{}', Buffer.from('zip'), 1, now, now)
    storage.db.prepare('INSERT INTO skills VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .run(randomUUID(), second, 'Review', '{}', Buffer.from('zip'), 1, now, now)
    assert.equal(storage.db.prepare('SELECT COUNT(*) AS count FROM projects WHERE user_id = ?').get(first).count, 1)
    assert.equal(storage.db.prepare('SELECT COUNT(*) AS count FROM projects WHERE user_id = ?').get(second).count, 0)
    assert.throws(() => storage.db.prepare('INSERT INTO projects VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(randomUUID(), randomUUID(), 'Invalid', '/outside', '', now, now))
    assert.throws(() => storage.transaction(db => {
      db.prepare('INSERT INTO projects VALUES (?, ?, ?, ?, ?, ?, ?)').run(randomUUID(), first, 'Rollback', '/rollback', '', now, now)
      throw new Error('abort')
    }), /abort/)
    assert.equal(storage.db.prepare("SELECT COUNT(*) AS count FROM projects WHERE root_path = '/rollback'").get().count, 0)
  } finally { storage.close() }
  const reopened = openProductDatabase(home)
  try {
    assert.equal(reopened.db.prepare('SELECT COUNT(*) AS count FROM users').get().count, 2)
    assert.equal(reopened.db.prepare('SELECT COUNT(*) AS count FROM projects').get().count, 1)
    assert.equal(reopened.db.prepare('SELECT COUNT(*) AS count FROM experts').get().count, 1)
    assert.equal(reopened.db.prepare('SELECT COUNT(*) AS count FROM skills').get().count, 1)
    assert.equal(reopened.db.prepare('PRAGMA user_version').get().user_version, 3)
  } finally { reopened.close() }
})

test('v2 migration retains existing users and skills while adding scheduled task tables', t => {
  const home = mkdtempSync(join(tmpdir(), 'seal-harness-v2-db-'))
  t.after(() => rmSync(home, { recursive: true, force: true }))
  const old = openProductDatabase(home)
  const now = new Date().toISOString()
  old.db.prepare('INSERT INTO users VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .run('owner', 'owner', 'Owner', Buffer.alloc(16), Buffer.alloc(64), 'admin', 'active', now, now)
  old.db.prepare('INSERT INTO skills VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .run('skill', 'owner', 'Existing', '{}', Buffer.from('original-package'), 1, now, now)
  old.db.exec('DROP TABLE scheduled_runs; DROP TABLE scheduled_tasks; PRAGMA user_version = 2')
  old.close()
  const upgraded = openProductDatabase(home)
  try {
    assert.equal(upgraded.db.prepare('SELECT username FROM users').get().username, 'owner')
    assert.equal(Buffer.from(upgraded.db.prepare('SELECT archive_blob FROM skills').get().archive_blob).toString(), 'original-package')
    assert.equal(upgraded.db.prepare('SELECT count(*) AS n FROM scheduled_tasks').get().n, 0)
    assert.equal(upgraded.db.prepare('SELECT count(*) AS n FROM scheduled_runs').get().n, 0)
    assert.equal(upgraded.db.prepare('PRAGMA user_version').get().user_version, 3)
  } finally { upgraded.close() }
})
