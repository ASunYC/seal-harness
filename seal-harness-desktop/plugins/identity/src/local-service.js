import { randomBytes, randomUUID, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto'
import { promisify } from 'node:util'
import { z } from 'zod'

const scrypt = promisify(scryptCallback)
const usernameSchema = z.string().trim().min(3).max(64).regex(/^[\p{L}\p{N}._-]+$/u)
const passwordSchema = z.string().min(10).max(256)
const registerSchema = z.strictObject({ username: usernameSchema, password: passwordSchema, displayName: z.string().trim().min(1).max(128).optional() })
const loginSchema = z.strictObject({ username: usernameSchema, password: z.string() })
const changePasswordSchema = z.strictObject({ currentPassword: z.string(), newPassword: passwordSchema })
const dummySalt = Buffer.alloc(16)

const messages = {
  invalidInput: '请检查用户名和密码格式。', invalidCredentials: '用户名或密码错误。',
  accountExists: '本机管理员已创建，请登录。', accountDisabled: '此账号已停用。', sessionExpired: '请先登录。',
}
export class LocalIdentityError extends Error {
  constructor(code) { super(messages[code] ?? '本地登录操作失败。'); this.code = code }
}
const publicUser = row => ({ id: row.id, username: row.username, displayName: row.display_name, role: row.role, status: row.status })
const derive = (password, salt) => scrypt(password, salt, 64)

export class LocalIdentityService {
  #current = null
  #epoch = 0
  #listeners = new Set()
  constructor(storage) { this.storage = storage }
  getSession() { return this.#current ? Object.freeze({ accountId: this.#current.user.id, subject: this.#current.user.id, epoch: this.#epoch, accessToken: this.#current.token, local: true }) : null }
  getStatus() { return { user: this.#current ? { ...this.#current.user } : null, accountId: this.#current?.user.id ?? null, epoch: this.#epoch,
    canRegister: this.storage.db.prepare('SELECT 1 AS found FROM users LIMIT 1').get() === undefined } }
  subscribe(listener) { this.#listeners.add(listener); return () => this.#listeners.delete(listener) }
  #publish(user) {
    this.#epoch++
    this.#current = user ? { user, token: randomBytes(32).toString('base64url') } : null
    for (const listener of this.#listeners) {
      try { listener() } catch { /* 一个界面订阅失败不能撤销已经完成的登录。 */ }
    }
    return this.getStatus()
  }
  async register(input) {
    const parsed = registerSchema.safeParse(input)
    if (!parsed.success) throw new LocalIdentityError('invalidInput')
    if (!this.getStatus().canRegister) throw new LocalIdentityError('accountExists')
    const now = new Date().toISOString(), id = randomUUID(), salt = randomBytes(16)
    const hash = await derive(parsed.data.password, salt)
    this.storage.transaction(db => {
      if (db.prepare('SELECT 1 AS found FROM users LIMIT 1').get()) throw new LocalIdentityError('accountExists')
      db.prepare('INSERT INTO users (id, username, display_name, password_salt, password_hash, role, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
        .run(id, parsed.data.username, parsed.data.displayName ?? parsed.data.username, salt, hash, 'admin', 'active', now, now)
    })
    return this.#publish({ id, username: parsed.data.username, displayName: parsed.data.displayName ?? parsed.data.username, role: 'admin', status: 'active' })
  }
  async login(input) {
    const parsed = loginSchema.safeParse(input)
    if (!parsed.success) throw new LocalIdentityError('invalidCredentials')
    const row = this.storage.db.prepare('SELECT * FROM users WHERE username = ?').get(parsed.data.username)
    const actual = await derive(parsed.data.password, row?.password_salt ?? dummySalt)
    if (!timingSafeEqual(actual, row?.password_hash ?? Buffer.alloc(64))) throw new LocalIdentityError('invalidCredentials')
    if (row.status !== 'active') throw new LocalIdentityError('accountDisabled')
    return this.#publish(publicUser(row))
  }
  logout() { return this.#publish(null) }
  async getAccessToken() {
    const session = this.getSession()
    if (!session) throw new LocalIdentityError('sessionExpired')
    return session.accessToken
  }
  async refreshSession() { if (!this.#current) throw new LocalIdentityError('sessionExpired') }
  async changePassword(input) {
    if (!this.#current) throw new LocalIdentityError('sessionExpired')
    const parsed = changePasswordSchema.safeParse(input)
    if (!parsed.success) throw new LocalIdentityError('invalidInput')
    const row = this.storage.db.prepare('SELECT password_salt, password_hash FROM users WHERE id = ?').get(this.#current.user.id)
    if (!row || !timingSafeEqual(await derive(parsed.data.currentPassword, row.password_salt), row.password_hash)) throw new LocalIdentityError('invalidCredentials')
    const salt = randomBytes(16), hash = await derive(parsed.data.newPassword, salt)
    this.storage.db.prepare('UPDATE users SET password_salt = ?, password_hash = ?, updated_at = ? WHERE id = ?')
      .run(salt, hash, new Date().toISOString(), this.#current.user.id)
    return { changed: true }
  }
  dispose() { this.#listeners.clear(); this.#current = null }
}
