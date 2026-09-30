import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { openProductDatabase } from '../../local-data/src/index.js'
import { createLocalProjects } from '../src/local-store.js'

test('local projects use the same database and never expose another user records', async t => {
  const home = mkdtempSync(join(tmpdir(), 'seal-harness-local-projects-'))
  t.after(() => rmSync(home, { recursive: true, force: true }))
  const firstPath = join(home, 'first'), secondPath = join(home, 'second')
  mkdirSync(firstPath); mkdirSync(secondPath)
  const storage = openProductDatabase(home), alice = randomUUID(), bob = randomUUID(), now = new Date().toISOString()
  let current = alice
  const identity = { getSession: () => current ? { accountId: current } : null }
  try {
    for (const [id, username] of [[alice, 'alice'], [bob, 'bob']]) {
      storage.db.prepare('INSERT INTO users VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
        .run(id, username, username, Buffer.alloc(16), Buffer.alloc(64), 'user', 'active', now, now)
    }
    const projects = createLocalProjects(storage, identity)
    await assert.rejects(projects.create({ name: 'Bad', rootPath: 'relative' }), { code: 'invalidPath' })
    const first = await projects.create({ name: 'First', rootPath: firstPath })
    assert.equal(first.name, 'First')
    assert.equal(projects.list().items.length, 1)
    const updated = await projects.update({ id: first.id, name: 'Renamed', description: '本地工作区' })
    assert.equal(updated.description, '本地工作区')
    await assert.rejects(projects.create({ name: 'Duplicate', rootPath: firstPath }), { code: 'conflict' })
    current = bob
    assert.deepEqual(projects.list().items, [])
    assert.throws(() => projects.detail({ id: first.id }), { code: 'notFound' })
    assert.throws(() => projects.delete({ id: first.id }), { code: 'notFound' })
    const other = await projects.create({ name: 'Other', rootPath: secondPath })
    assert.equal(projects.list().items[0].id, other.id)
    current = alice
    assert.equal(projects.list().items[0].id, first.id)
    assert.equal(projects.delete({ id: first.id }).deleted, true)
    assert.deepEqual(projects.list().items, [])
    current = null
    assert.throws(() => projects.list(), { code: 'notSignedIn' })
  } finally { storage.close() }
})
