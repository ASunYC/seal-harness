import { randomUUID } from 'node:crypto'
import { z } from 'zod'

const idSchema = z.uuid()
const nameSchema = z.string().trim().min(1).max(100)
const companySchema = z.strictObject({ name: z.string().trim().min(1).max(80) })
const departmentSchema = z.strictObject({
  id: idSchema.optional(), name: nameSchema, parentId: idSchema.nullable(),
  sortOrder: z.number().int().min(0).max(100000), enabled: z.boolean(),
})
const personSchema = z.strictObject({
  id: idSchema.optional(), name: nameSchema, departmentId: idSchema.nullable(),
  jobTitle: z.string().trim().max(100), email: z.union([z.email(), z.literal('')]),
  phone: z.string().trim().max(64), status: z.enum(['active', 'disabled']),
})

const departmentFromRow = row => ({
  id: row.id, name: row.name, parentId: row.parent_id, sortOrder: row.sort_order,
  enabled: !!row.enabled, createdAt: row.created_at, updatedAt: row.updated_at,
})
const personFromRow = row => ({
  id: row.id, name: row.name, departmentId: row.department_id, jobTitle: row.job_title,
  email: row.email, phone: row.phone, status: row.status,
  createdAt: row.created_at, updatedAt: row.updated_at,
})

export class OrganizationError extends Error {
  constructor(code, message) { super(message); this.code = code }
}

export class OrganizationService {
  constructor({ storage, identity, now = () => new Date().toISOString() }) {
    this.storage = storage
    this.db = storage.db
    this.identity = identity
    this.now = now
  }

  owner() {
    const owner = this.identity.getSession()?.accountId
    if (!owner) throw new OrganizationError('sessionExpired', '请先登录本地账号。')
    return owner
  }

  snapshot() {
    const owner = this.owner()
    return {
      companyName: this.db.prepare('SELECT company_name FROM organization_settings WHERE user_id = ?').get(owner)?.company_name ?? '我的组织',
      departments: this.db.prepare('SELECT * FROM organization_departments WHERE user_id = ? ORDER BY sort_order, name, id').all(owner).map(departmentFromRow),
      people: this.db.prepare('SELECT * FROM organization_people WHERE user_id = ? ORDER BY name, id').all(owner).map(personFromRow),
    }
  }

  saveCompany(input) {
    const { name } = companySchema.parse(input)
    const owner = this.owner(), now = this.now()
    this.db.prepare(`INSERT INTO organization_settings (user_id, company_name, updated_at) VALUES (?, ?, ?)
      ON CONFLICT(user_id) DO UPDATE SET company_name = excluded.company_name, updated_at = excluded.updated_at`).run(owner, name, now)
    return this.snapshot()
  }

  department(id, owner) {
    const row = this.db.prepare('SELECT * FROM organization_departments WHERE id = ? AND user_id = ?').get(id, owner)
    if (!row) throw new OrganizationError('departmentNotFound', '部门不存在或不属于当前账号。')
    return row
  }

  person(id, owner) {
    const row = this.db.prepare('SELECT * FROM organization_people WHERE id = ? AND user_id = ?').get(id, owner)
    if (!row) throw new OrganizationError('personNotFound', '人员不存在或不属于当前账号。')
    return row
  }

  saveDepartment(input) {
    const value = departmentSchema.parse(input), owner = this.owner(), now = this.now()
    const id = value.id ?? randomUUID()
    this.storage.transaction(() => {
      if (value.id) this.department(id, owner)
      let parentId = value.parentId
      while (parentId) {
        if (parentId === id) throw new OrganizationError('departmentCycle', '部门不能放到自身或下级部门中。')
        parentId = this.department(parentId, owner).parent_id
      }
      const duplicate = this.db.prepare('SELECT 1 FROM organization_departments WHERE user_id = ? AND parent_id IS ? AND name = ? AND id <> ?')
        .get(owner, value.parentId, value.name, id)
      if (duplicate) throw new OrganizationError('duplicateDepartment', '同一层级已有同名部门。')
      if (value.id) {
        this.db.prepare('UPDATE organization_departments SET name = ?, parent_id = ?, sort_order = ?, enabled = ?, updated_at = ? WHERE id = ? AND user_id = ?')
          .run(value.name, value.parentId, value.sortOrder, Number(value.enabled), now, id, owner)
      } else {
        this.db.prepare(`INSERT INTO organization_departments
          (id, user_id, name, parent_id, sort_order, enabled, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
          .run(id, owner, value.name, value.parentId, value.sortOrder, Number(value.enabled), now, now)
      }
    })
    return { id, ...this.snapshot() }
  }

  deleteDepartment(input) {
    const { id } = z.strictObject({ id: idSchema }).parse(input), owner = this.owner()
    this.storage.transaction(() => {
      this.department(id, owner)
      const child = this.db.prepare('SELECT 1 FROM organization_departments WHERE user_id = ? AND parent_id = ?').get(owner, id)
      const member = this.db.prepare('SELECT 1 FROM organization_people WHERE user_id = ? AND department_id = ?').get(owner, id)
      if (child || member) throw new OrganizationError('departmentNotEmpty', '请先移动或删除下级部门和人员。')
      this.db.prepare('DELETE FROM organization_departments WHERE id = ? AND user_id = ?').run(id, owner)
    })
    return this.snapshot()
  }

  savePerson(input) {
    const value = personSchema.parse(input), owner = this.owner(), now = this.now()
    const id = value.id ?? randomUUID()
    this.storage.transaction(() => {
      if (value.id) this.person(id, owner)
      if (value.departmentId) this.department(value.departmentId, owner)
      if (value.id) {
        this.db.prepare(`UPDATE organization_people SET name = ?, department_id = ?, job_title = ?, email = ?, phone = ?, status = ?, updated_at = ?
          WHERE id = ? AND user_id = ?`).run(value.name, value.departmentId, value.jobTitle, value.email, value.phone, value.status, now, id, owner)
      } else {
        this.db.prepare(`INSERT INTO organization_people
          (id, user_id, name, department_id, job_title, email, phone, status, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(id, owner, value.name, value.departmentId, value.jobTitle, value.email, value.phone, value.status, now, now)
      }
    })
    return { id, ...this.snapshot() }
  }

  deletePerson(input) {
    const { id } = z.strictObject({ id: idSchema }).parse(input), owner = this.owner()
    this.person(id, owner)
    this.db.prepare('DELETE FROM organization_people WHERE id = ? AND user_id = ?').run(id, owner)
    return this.snapshot()
  }
}
