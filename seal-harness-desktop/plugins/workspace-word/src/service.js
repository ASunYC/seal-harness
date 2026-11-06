import { createHash, randomUUID } from 'node:crypto'
import { mkdir, lstat, open, realpath, rename, rm } from 'node:fs/promises'
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { z } from 'zod'
import { loadDocxZip } from './vendor/office/docx-engine/zip-load.ts'

// Match the Office ZIP expansion budget; the older 8 MiB compressed-file gate was arbitrary.
export const MAX_FILE_BYTES = 64 * 1024 * 1024
const kind = z.enum(['docx', 'xlsx', 'pptx'])
const openInput = z.strictObject({ sessionId: z.string().min(1), path: z.string().min(1).max(4096) })
const saveInput = z.strictObject({ leaseId: z.string().uuid(), data: z.string().min(1) })
const editInput = z.strictObject({ leaseId: z.string().uuid(), updates: z.array(z.strictObject({ id: z.string().max(500), text: z.string().max(20000) })).min(1).max(300) })
const createInput = openInput.extend({ content: z.string().max(64000).default('') })
const importInput = openInput.extend({ data: z.string().min(1) })
const closeInput = z.strictObject({ leaseId: z.string().uuid() })
const formatOf = path => kind.safeParse(path.split('.').at(-1)?.toLowerCase()).data
const hash = bytes => createHash('sha256').update(bytes).digest('hex')
const inside = (root, path) => {
  const part = relative(root, path)
  return part !== '' && part !== '..' && !part.startsWith(`..${sep}`) && !isAbsolute(part)
}

export class OfficeError extends Error {
  constructor(code, message) { super(message); this.code = code }
}

export class OfficeService {
  #leases = new Map()
  #queues = new Map()

  constructor({ sessions, sandboxPolicy, fs, identity, home, transform }) {
    this.sessions = sessions
    this.sandboxPolicy = sandboxPolicy
    this.fs = fs
    this.identity = identity
    this.home = home
    this.transform = transform
  }

  #account() {
    const account = this.identity.getSession()
    if (!account) throw new OfficeError('loginRequired', '请先登录本地账号。')
    return account
  }

  async #workspace(sessionId) {
    const header = this.sessions.get(sessionId)?.header
    if (!header) throw new OfficeError('sessionUnavailable', '原会话已关闭，请从工作区重新打开文档。')
    const workspace = header.cwd ?? this.sandboxPolicy.workspaceRoot
    if (!isAbsolute(workspace) || !this.fs.processPathFromHostPath(workspace))
      throw new OfficeError('workspaceUnavailable', '此工作区没有本机文件映射，暂不能编辑。')
    return realpath(workspace)
  }

  async #target(sessionId, path) {
    if (!isAbsolute(path) || !formatOf(path) || path.includes('\0'))
      throw new OfficeError('invalidPath', '请选择工作区内的 DOCX、XLSX 或 PPTX 文件。')
    const root = await this.#workspace(sessionId)
    const entry = await lstat(path)
    if (!entry.isFile() || entry.isSymbolicLink() || entry.nlink !== 1)
      throw new OfficeError('invalidPath', '仅能编辑工作区内的普通 Office 文件。')
    const target = await realpath(path)
    if (!inside(root, target)) throw new OfficeError('outsideWorkspace', '文档不在此会话的工作区内。')
    return { root, target }
  }

  async #newTarget(sessionId, path) {
    if (!isAbsolute(path) || !formatOf(path) || path.includes('\0'))
      throw new OfficeError('invalidPath', '请选择工作区内的 DOCX、XLSX 或 PPTX 路径。')
    const root = await this.#workspace(sessionId)
    const target = resolve(path)
    if (!inside(root, target)) throw new OfficeError('outsideWorkspace', '目标不在此会话的工作区内。')
    const parent = dirname(target)
    const parts = relative(root, parent).split(sep).filter(Boolean)
    let cursor = root
    for (const part of parts) {
      cursor = join(cursor, part)
      const entry = await lstat(cursor)
      if (!entry.isDirectory() || entry.isSymbolicLink())
        throw new OfficeError('invalidPath', '目标目录必须是工作区内的普通目录。')
    }
    try { await lstat(target); throw new OfficeError('targetExists', '目标文件已存在，请使用其他文件名。') }
    catch (error) { if (error.code !== 'ENOENT') throw error }
    return { root, target }
  }

  async #read(sessionId, path) {
    const { root, target } = await this.#target(sessionId, path)
    const file = await open(target, 'r')
    try {
      const before = await file.stat()
      if (!before.isFile() || before.nlink !== 1) throw new OfficeError('invalidPath', '仅能编辑工作区内的普通 Office 文件。')
      if (before.size > MAX_FILE_BYTES) throw new OfficeError('tooLarge', 'Office 文件超过 64 MiB，暂不能编辑。')
      // Allocate for the observed file, not the full admission budget on every open.
      const buffer = Buffer.allocUnsafe(before.size + 1)
      let length = 0
      while (length < buffer.length) {
        const { bytesRead } = await file.read(buffer, length, buffer.length - length, length)
        if (!bytesRead) break
        length += bytesRead
      }
      if (length > MAX_FILE_BYTES) throw new OfficeError('tooLarge', 'Office 文件超过 64 MiB，暂不能编辑。')
      const after = await file.stat()
      if (length !== before.size || before.size !== after.size || before.mtimeMs !== after.mtimeMs || before.ctimeMs !== after.ctimeMs)
        throw new OfficeError('sourceChanged', '读取期间文档发生变化，请重试。')
      if (await realpath(path) !== target)
        throw new OfficeError('sourceChanged', '读取期间文档路径发生变化，请重试。')
      return { root, target, bytes: buffer.subarray(0, length), mode: before.mode }
    } finally { await file.close() }
  }

  async open(input) {
    const { sessionId, path } = openInput.parse(input)
    const account = this.#account()
    const source = await this.#read(sessionId, path)
    const documentKind = formatOf(path)
    const view = await this.#validate(documentKind, source.bytes, account)
    this.#same(account)
    const leaseId = randomUUID()
    this.#leases.set(leaseId, {
      sessionId, path: resolve(path), root: source.root, target: source.target,
      kind: documentKind,
      accountId: account.accountId, epoch: account.epoch, digest: hash(source.bytes),
    })
    return { leaseId, kind: documentKind, displayName: basename(path), data: source.bytes.toString('base64'), view }
  }

  #same(owner) {
    const current = this.identity.getSession()
    if (!current || owner.accountId !== current.accountId || owner.epoch !== current.epoch)
      throw new OfficeError('accountChanged', '本地账号已变化，请重新打开文档。')
  }

  async #runTransform(input, owner) {
    try {
      const result = await this.transform(input)
      this.#same(owner)
      return result
    } catch (error) {
      this.#same(owner)
      throw error
    }
  }

  async #validate(documentKind, bytes, owner) {
    if (!bytes.length || bytes.length > MAX_FILE_BYTES)
      throw new OfficeError('tooLarge', 'Office 文件超过 64 MiB，暂不能处理。')
    if (documentKind !== 'docx') {
      const result = await this.#runTransform({ action: 'inspect', kind: documentKind, bytes }, owner)
      return result.view
    }
    try {
      const zip = await loadDocxZip(bytes)
      if (!zip.file('[Content_Types].xml') || !zip.file('word/document.xml')) throw new Error('missing DOCX parts')
    } catch {
      throw new OfficeError('invalidDocument', '文档不是可安全编辑的 DOCX 文件。')
    }
    return null
  }

  async #queued(target, action) {
    const prior = this.#queues.get(target) ?? Promise.resolve()
    const running = prior.catch(() => {}).then(action)
    this.#queues.set(target, running)
    try { return await running }
    finally { if (this.#queues.get(target) === running) this.#queues.delete(target) }
  }

  #bytes(data) {
    if (data.length > Math.ceil(MAX_FILE_BYTES / 3) * 4)
      throw new OfficeError('invalidDocument', '文件数据无效或超过 64 MiB。')
    const candidate = Buffer.from(data, 'base64')
    if (!candidate.length || candidate.length > MAX_FILE_BYTES || candidate.toString('base64') !== data)
      throw new OfficeError('invalidDocument', '文件数据无效或超过 64 MiB。')
    return candidate
  }

  #lease(leaseId) {
    const lease = this.#leases.get(leaseId)
    if (!lease) throw new OfficeError('leaseExpired', '编辑授权已失效，请重新打开文档。')
    this.#same(lease)
    return lease
  }

  async save(input) {
    const { leaseId, data } = saveInput.parse(input)
    const lease = this.#lease(leaseId)
    const candidate = this.#bytes(data)
    await this.#validate(lease.kind, candidate, lease)
    return this.#commit(leaseId, lease, candidate)
  }

  async #commit(leaseId, lease, candidate) {
    if (!candidate.length || candidate.length > MAX_FILE_BYTES)
      throw new OfficeError('tooLarge', '保存数据超过 64 MiB，原文件未改动。')
    return this.#queued(lease.target, async () => {
      this.#same(lease)
      const source = await this.#read(lease.sessionId, lease.path)
      if (source.root !== lease.root || source.target !== lease.target || hash(source.bytes) !== lease.digest)
        throw new OfficeError('sourceChanged', '磁盘上的文档已变化，请保留当前修改并重新打开。')
      const backupDir = join(this.home, 'office', 'preimages')
      await mkdir(backupDir, { recursive: true })
      const backup = join(backupDir, `${leaseId}.${lease.kind}`)
      const temporary = join(dirname(lease.target), `.seal-office-${randomUUID()}.tmp`)
      let published = false
      try {
        const preimage = await open(backup, 'wx', 0o600)
        try { await preimage.writeFile(source.bytes); await preimage.sync() } finally { await preimage.close() }
        const output = await open(temporary, 'wx', source.mode & 0o777)
        try { await output.writeFile(candidate); await output.sync() } finally { await output.close() }
        const latest = await this.#read(lease.sessionId, lease.path)
        if (hash(latest.bytes) !== lease.digest || latest.target !== lease.target)
          throw new OfficeError('sourceChanged', '磁盘上的文档已变化，保存已取消。')
        this.#same(lease)
        await rename(temporary, lease.target)
        published = true
        const committed = await this.#read(lease.sessionId, lease.path)
        if (hash(committed.bytes) !== hash(candidate))
          throw new OfficeError('commitUncertain', '保存结果无法核实，已保留恢复副本。')
        lease.digest = hash(candidate)
        await rm(backup, { force: true })
        return { saved: true }
      } catch (error) {
        if (!published) await rm(backup, { force: true }).catch(() => {})
        throw error
      } finally {
        await rm(temporary, { force: true }).catch(() => {})
      }
    })
  }

  async edit(input) {
    const { leaseId, updates } = editInput.parse(input)
    const lease = this.#lease(leaseId)
    const source = await this.#read(lease.sessionId, lease.path)
    if (source.root !== lease.root || source.target !== lease.target || hash(source.bytes) !== lease.digest)
      throw new OfficeError('sourceChanged', '磁盘上的文档已变化，请重新打开。')
    const result = await this.#runTransform({ action: 'edit', kind: lease.kind, bytes: source.bytes, updates }, lease)
    this.#same(lease)
    const candidate = Buffer.from(result.bytes)
    await this.#validate(lease.kind, candidate, lease)
    await this.#commit(leaseId, lease, candidate)
    return { saved: true, view: result.view, data: candidate.toString('base64') }
  }

  async #publishNew(sessionId, path, candidate, owner) {
    const { target } = await this.#newTarget(sessionId, path)
    return this.#queued(target, async () => {
      this.#same(owner)
      await this.#newTarget(sessionId, path)
      const handle = await open(target, 'wx', 0o600)
      let written = false
      let closeError
      try {
        await handle.writeFile(candidate)
        await handle.sync()
        written = true
      } finally {
        try { await handle.close() } catch (error) { closeError = error }
        if (!written) await rm(target, { force: true }).catch(() => {})
      }
      if (closeError) return { status: 'createdNotOpened', kind: formatOf(path), displayName: basename(path), path }
      let opened
      try {
        this.#same(owner)
        opened = await this.open({ sessionId, path })
        this.#same(owner)
        return { status: 'created', ...opened }
      } catch {
        if (opened) this.#leases.delete(opened.leaseId)
        return { status: 'createdNotOpened', kind: formatOf(path), displayName: basename(path), path }
      }
    })
  }

  async create(input) {
    const { sessionId, path, content } = createInput.parse(input)
    const documentKind = formatOf(path)
    await this.#newTarget(sessionId, path)
    const owner = this.#account()
    const result = await this.#runTransform({ action: 'create', kind: documentKind, content }, owner)
    this.#same(owner)
    const candidate = Buffer.from(result.bytes)
    if (!candidate.length || candidate.length > MAX_FILE_BYTES)
      throw new OfficeError('tooLarge', '新文档超过 64 MiB，未创建文件。')
    await this.#validate(documentKind, candidate, owner)
    this.#same(owner)
    return this.#publishNew(sessionId, path, candidate, owner)
  }

  async import(input) {
    const { sessionId, path, data } = importInput.parse(input)
    const documentKind = formatOf(path)
    await this.#newTarget(sessionId, path)
    const owner = this.#account()
    const candidate = this.#bytes(data)
    await this.#validate(documentKind, candidate, owner)
    this.#same(owner)
    return this.#publishNew(sessionId, path, candidate, owner)
  }

  async download(input) {
    const { leaseId } = closeInput.parse(input)
    const lease = this.#lease(leaseId)
    const source = await this.#read(lease.sessionId, lease.path)
    if (source.root !== lease.root || source.target !== lease.target || hash(source.bytes) !== lease.digest)
      throw new OfficeError('sourceChanged', '磁盘上的文档已变化，请重新打开后导出。')
    this.#same(lease)
    return { name: basename(lease.path), base64: source.bytes.toString('base64') }
  }

  close(input) {
    const { leaseId } = closeInput.parse(input)
    this.#leases.delete(leaseId)
    return { closed: true }
  }

  dispose() { this.#leases.clear() }
}
