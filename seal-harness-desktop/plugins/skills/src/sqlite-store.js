import { mkdir, readdir, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { createArchive, readArchive, readBoundedFile, readDirectory, safeRelative, SkillError } from './package.js'

export function createSkillPersistence(storage, home, packages) {
  const legacy = join(home, 'capabilities', 'skills')
  const marker = userId => `skills-v1:${userId}`

  async function importLegacy(userId) {
    if (storage.db.prepare('SELECT 1 FROM import_journal WHERE source = ?').get(marker(userId))) return
    let state
    try { state = JSON.parse((await readBoundedFile(join(legacy, 'state.json'), 16 * 1024 * 1024)).bytes.toString('utf8')) }
    catch (error) { if (error.code !== 'ENOENT') throw error }
    const copies = []
    if (state) {
      if (!Array.isArray(state.skills)) throw new SkillError('旧技能状态无效，未导入。')
      for (const item of state.skills) {
        const files = await readDirectory(join(legacy, 'packages', item.id))
        copies.push({ item: { ...item, origin: item.origin?.kind === 'store' ? { ...item.origin, accountId: userId } : item.origin }, archive: createArchive(files) })
      }
      state.skills = copies.map(copy => copy.item)
      state.defaultCopies = Object.fromEntries(Object.entries(state.defaultCopies ?? {}).map(([key, value]) => [key, value.accountId ? { ...value, accountId: userId } : value]))
    }
    const now = new Date().toISOString()
    storage.transaction(db => {
      if (state && !db.prepare('SELECT 1 FROM skill_state WHERE user_id = ?').get(userId)) {
        db.prepare('INSERT INTO skill_state (user_id, state_json) VALUES (?, ?)').run(userId, JSON.stringify(state))
        for (const { item, archive } of copies) {
          db.prepare('INSERT INTO skills (id, user_id, name, metadata_json, archive_blob, enabled, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
            .run(item.id, userId, item.name, JSON.stringify(item), archive, Number(item.enabled), item.importedAt ?? now, now)
        }
      }
      db.prepare('INSERT INTO import_journal (source, imported_at) VALUES (?, ?)').run(marker(userId), now)
    })
  }

  async function materialize(userId) {
    await mkdir(packages, { recursive: true })
    for (const entry of await readdir(packages)) await rm(join(packages, entry), { recursive: true, force: true })
    for (const row of storage.db.prepare('SELECT id, archive_blob FROM skills WHERE user_id = ?').all(userId)) {
      for (const file of readArchive(Buffer.from(row.archive_blob))) {
        const path = join(packages, row.id, ...safeRelative(file.path).split('/'))
        await mkdir(dirname(path), { recursive: true })
        await writeFile(path, file.bytes, { flag: 'wx', mode: file.mode })
      }
    }
  }

  return Object.freeze({
    async load(userId) {
      await importLegacy(userId)
      await materialize(userId)
      const row = storage.db.prepare('SELECT state_json FROM skill_state WHERE user_id = ?').get(userId)
      return row ? JSON.parse(row.state_json) : null
    },
    async clear() {
      await mkdir(packages, { recursive: true })
      for (const entry of await readdir(packages)) await rm(join(packages, entry), { recursive: true, force: true })
    },
    async save(userId, state) {
      const archives = []
      for (const item of state.skills) archives.push({ item, archive: createArchive(await readDirectory(join(packages, item.id))) })
      const now = new Date().toISOString(), retained = new Set(state.skills.map(item => item.id))
      storage.transaction(db => {
        for (const row of db.prepare('SELECT id FROM skills WHERE user_id = ?').all(userId)) {
          if (!retained.has(row.id)) db.prepare('DELETE FROM skills WHERE id = ? AND user_id = ?').run(row.id, userId)
        }
        for (const { item, archive } of archives) {
          const existing = db.prepare('SELECT 1 FROM skills WHERE id = ? AND user_id = ?').get(item.id, userId)
          if (existing) db.prepare('UPDATE skills SET name = ?, metadata_json = ?, archive_blob = ?, enabled = ?, updated_at = ? WHERE id = ? AND user_id = ?')
            .run(item.name, JSON.stringify(item), archive, Number(item.enabled), now, item.id, userId)
          else db.prepare('INSERT INTO skills (id, user_id, name, metadata_json, archive_blob, enabled, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
            .run(item.id, userId, item.name, JSON.stringify(item), archive, Number(item.enabled), item.importedAt ?? now, now)
        }
        db.prepare('INSERT INTO skill_state (user_id, state_json) VALUES (?, ?) ON CONFLICT(user_id) DO UPDATE SET state_json = excluded.state_json')
          .run(userId, JSON.stringify(state))
      })
    },
  })
}
