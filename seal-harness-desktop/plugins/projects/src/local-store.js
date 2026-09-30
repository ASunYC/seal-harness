import { randomUUID } from 'node:crypto'
import { stat, realpath } from 'node:fs/promises'
import { isAbsolute } from 'node:path'
import { z } from 'zod'

const projectInput = z.strictObject({ name: z.string().trim().min(1).max(100), rootPath: z.string().trim().min(1).max(4096), description: z.string().trim().max(4000).default('') })
const projectUpdate = projectInput.partial().extend({ id: z.string().uuid() })
const projectId = z.strictObject({ id: z.string().uuid() })

export class ProjectError extends Error {
  constructor(code, message) { super(message); this.code = code }
}
const rowProject = row => ({ id: row.id, name: row.name, rootPath: row.root_path, description: row.description, createdAt: row.created_at, updatedAt: row.updated_at })

async function workspacePath(value) {
  if (!isAbsolute(value)) throw new ProjectError('invalidPath', '工作目录必须是已存在的绝对路径。')
  try {
    const path = await realpath(value)
    if (!(await stat(path)).isDirectory()) throw new Error('not a directory')
    return path
  } catch { throw new ProjectError('invalidPath', '工作目录不存在或无法读取。') }
}

export function createLocalProjects(storage, identity) {
  const owner = () => {
    const session = identity.getSession()
    if (!session) throw new ProjectError('notSignedIn', '请先登录本机账号。')
    return session.accountId
  }
  const get = id => {
    const row = storage.db.prepare('SELECT * FROM projects WHERE id = ? AND user_id = ?').get(id, owner())
    if (!row) throw new ProjectError('notFound', '项目不存在或不属于当前用户。')
    return rowProject(row)
  }
  return Object.freeze({
    list() {
      return { items: storage.db.prepare('SELECT * FROM projects WHERE user_id = ? ORDER BY updated_at DESC').all(owner()).map(rowProject) }
    },
    detail(input) { return get(projectId.parse(input).id) },
    async create(input) {
      const parsed = projectInput.parse(input), rootPath = await workspacePath(parsed.rootPath)
      const userId = owner(), id = randomUUID(), now = new Date().toISOString()
      try {
        storage.db.prepare('INSERT INTO projects (id, user_id, name, root_path, description, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
          .run(id, userId, parsed.name, rootPath, parsed.description, now, now)
      } catch { throw new ProjectError('conflict', '当前账号已经登记了这个工作目录。') }
      return get(id)
    },
    async update(input) {
      const parsed = projectUpdate.parse(input), old = get(parsed.id)
      const rootPath = parsed.rootPath === undefined ? old.rootPath : await workspacePath(parsed.rootPath)
      const userId = owner(), now = new Date().toISOString()
      try {
        storage.db.prepare('UPDATE projects SET name = ?, root_path = ?, description = ?, updated_at = ? WHERE id = ? AND user_id = ?')
          .run(parsed.name ?? old.name, rootPath, parsed.description ?? old.description, now, old.id, userId)
      } catch { throw new ProjectError('conflict', '当前账号已经登记了这个工作目录。') }
      return get(old.id)
    },
    delete(input) {
      const id = projectId.parse(input).id, userId = owner()
      const result = storage.db.prepare('DELETE FROM projects WHERE id = ? AND user_id = ?').run(id, userId)
      if (!result.changes) throw new ProjectError('notFound', '项目不存在或不属于当前用户。')
      return { id, deleted: true }
    },
  })
}
