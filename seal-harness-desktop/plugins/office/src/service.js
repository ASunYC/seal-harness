import { createHash, randomUUID } from 'node:crypto'
import { mkdirSync, lstatSync, existsSync, readdirSync, openSync, fstatSync, readFileSync, closeSync, writeFileSync, unlinkSync, constants } from 'node:fs'
import { join } from 'node:path'
import { Worker } from 'node:worker_threads'
import { z } from 'zod'

const MAX_FILE = 8 * 1024 * 1024
const kind = z.enum(['docx','xlsx','pptx'])
const name = z.string().trim().min(1).max(120).refine(s => !/[\\/\x00-\x1f]/u.test(s))
const id = z.string().uuid()
const schemas = {
  snapshot: z.strictObject({}),
  create: z.strictObject({ kind, name, content: z.string().max(64000).default('') }),
  import: z.strictObject({ name, base64: z.string().min(1).max(Math.ceil(MAX_FILE / 3) * 4) }),
  inspect: z.strictObject({ id }),
  download: z.strictObject({ id }),
  edit: z.strictObject({ id, hash: z.string().regex(/^[a-f0-9]{64}$/u), updates: z.array(z.strictObject({ id: z.string().max(500), text: z.string().max(20000) })).min(1).max(300) }),
}
const hash = bytes => createHash('sha256').update(bytes).digest('hex')
export class OfficeError extends Error {
  constructor(code, message) { super(message); this.code = code }
}

export class OfficeService {
  constructor({ root, identity, timeoutMs = 20000 }) {
    Object.assign(this, { root, identity, timeoutMs }); this.closed = false; this.operations = new Set()
    this.unsubscribe = identity.subscribe(() => {
      const owner = identity.getSession()
      for (const op of this.operations) if (owner?.accountId !== op.owner.accountId || owner?.epoch !== op.owner.epoch) op.controller.abort()
    })
  }
  account() {
    const owner = this.identity.getSession()
    if (this.closed) throw new OfficeError('closed', '文档服务已关闭。')
    if (!owner?.accountId) throw new OfficeError('loginRequired', '请先登录本地账号。')
    return { accountId: owner.accountId, epoch: owner.epoch }
  }
  same(owner) {
    const current = this.account()
    if (current.accountId !== owner.accountId || current.epoch !== owner.epoch) throw new OfficeError('accountChanged', '账号已变化，请重新操作。')
  }
  folder(owner) {
    const path = join(this.root, hash(owner.accountId))
    for (const folder of [this.root, path]) {
      if (!existsSync(folder)) mkdirSync(folder, { recursive: true, mode: 0o700 })
      const stat = lstatSync(folder)
      if (stat.isSymbolicLink() || !stat.isDirectory()) throw new OfficeError('unsafeStorage', '文档目录必须是本机普通目录。')
    }
    return path
  }
  read(path, max) {
    if (lstatSync(path).isSymbolicLink()) throw new OfficeError('unsafeStorage', '拒绝链接文件。')
    const fd = openSync(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0))
    try {
      const st = fstatSync(fd)
      if (!st.isFile() || st.nlink !== 1 || st.size > max) throw new OfficeError('unsafeStorage', '文件类型或大小不符合限制。')
      return readFileSync(fd)
    } finally { closeSync(fd) }
  }
  document(owner, documentId) {
    const folder = this.folder(owner)
    const path = join(folder, `${documentId}.json`)
    if (!existsSync(path)) throw new OfficeError('notFound', '文档不存在。')
    const meta = JSON.parse(this.read(path, 4096))
    if (meta.id !== documentId || meta.accountId !== owner.accountId || !['docx','xlsx','pptx'].includes(meta.kind)) throw new OfficeError('unsafeStorage', '文档元数据无效。')
    const bytes = this.read(join(folder, `${documentId}.${meta.kind}`), MAX_FILE)
    if (hash(bytes) !== meta.hash) throw new OfficeError('fileChanged', '文件已被其他程序修改，请重新导入。')
    return { meta, bytes }
  }
  public(meta) {
    const { accountId, ...document } = meta
    return document
  }
  async process(owner, data, signal) {
    if (this.operations.size >= 2) throw new OfficeError('busy', '已有文档正在处理，请稍后再试。')
    const controller = new AbortController(), op = { owner, controller }; this.operations.add(op)
    const active = AbortSignal.any([controller.signal, ...(signal ? [signal] : [])])
    try {
      active.throwIfAborted()
      const result = await new Promise((resolve, reject) => {
        const worker = new Worker(new URL('./worker.js', import.meta.url), { workerData: data, resourceLimits: { maxOldGenerationSizeMb: 256 } })
        let settled = false
        const finish = (error, value) => {
          if (settled) return; settled = true; clearTimeout(timer); active.removeEventListener('abort', abort)
          void worker.terminate(); error ? reject(error) : resolve(value)
        }
        const abort = () => finish(new OfficeError('cancelled', '文档操作已取消。'))
        const timer = setTimeout(() => finish(new OfficeError('timeout', '文档处理超时，原文件未改动。')), this.timeoutMs)
        active.addEventListener('abort', abort, { once: true })
        worker.once('message', result => finish(result.ok ? null : new OfficeError(result.code === 'readOnlyDocument' ? 'readOnlyDocument' : 'invalidDocument', result.message), result))
        worker.once('error', () => finish(new OfficeError('invalidDocument', '文档无法处理或超出内存限制，原文件未改动。')))
        worker.once('exit', () => { if (!settled) finish(new OfficeError('invalidDocument', '文档处理器提前退出。')) })
        if (active.aborted) abort()
      })
      this.same(owner); return result
    } finally { this.operations.delete(op) }
  }
  store(owner, bytes, details, view) {
    this.same(owner); bytes = Buffer.from(bytes)
    if (bytes.length > MAX_FILE) throw new OfficeError('tooLarge', '文件超过 8 MB 限制。')
    const folder = this.folder(owner), documentId = randomUUID()
    const meta = { ...details, id: documentId, accountId: owner.accountId, hash: hash(bytes), size: bytes.length, createdAt: new Date().toISOString() }
    const path = join(folder, `${documentId}.${meta.kind}`)
    writeFileSync(path, bytes, { flag: 'wx', mode: 0o600 })
    try { writeFileSync(join(folder, `${documentId}.json`), JSON.stringify(meta), { flag: 'wx', mode: 0o600 }) }
    catch (error) { unlinkSync(path); throw error }
    return { document: this.public(meta), view }
  }
  snapshot(input) {
    schemas.snapshot.parse(input); const owner = this.account(), folder = this.folder(owner)
    const documents = readdirSync(folder).filter(file => /^[a-f0-9-]{36}\.json$/u.test(file)).map(file => this.public(this.document(owner, file.slice(0,-5)).meta))
    return { documents: documents.sort((a,b) => b.createdAt.localeCompare(a.createdAt)), capabilities: { formats: ['docx','xlsx','pptx'], structuredEditing: true, formulaRecalculation: false, pixelRendering: false, aiProvider: false, enterprise: false, maxFileBytes: MAX_FILE } }
  }
  async create(input, signal) {
    const parsed = schemas.create.parse(input), owner = this.account()
    const result = await this.process(owner, { action: 'create', kind: parsed.kind, content: parsed.content }, signal)
    return this.store(owner, result.bytes, { kind: parsed.kind, name: parsed.name.replace(/\.(docx|xlsx|pptx)$/iu, '') + '.' + parsed.kind, revision: 1 }, result.view)
  }
  async import(input, signal) {
    const parsed = schemas.import.parse(input), owner = this.account(), extension = parsed.name.split('.').at(-1).toLowerCase()
    kind.parse(extension)
    const bytes = Buffer.from(parsed.base64, 'base64')
    if (bytes.toString('base64') !== parsed.base64 || bytes.length > MAX_FILE) throw new OfficeError('invalidDocument', '文件编码或大小无效。')
    const result = await this.process(owner, { action: 'inspect', kind: extension, bytes }, signal)
    return this.store(owner, bytes, { kind: extension, name: parsed.name, revision: 1 }, result.view)
  }
  async inspect(input, signal) {
    const parsed = schemas.inspect.parse(input), owner = this.account(), { meta, bytes } = this.document(owner, parsed.id)
    const result = await this.process(owner, { action: 'inspect', kind: meta.kind, bytes }, signal)
    return { document: this.public(meta), view: result.view }
  }
  async edit(input, signal) {
    const parsed = schemas.edit.parse(input), owner = this.account(), { meta, bytes } = this.document(owner, parsed.id)
    if (meta.hash !== parsed.hash) throw new OfficeError('fileChanged', '文档版本已变化，请重新打开。')
    const result = await this.process(owner, { action: 'edit', kind: meta.kind, bytes, updates: parsed.updates }, signal)
    return this.store(owner, result.bytes, { kind: meta.kind, name: meta.name, revision: meta.revision + 1, parentId: meta.id }, result.view)
  }
  download(input) {
    const parsed = schemas.download.parse(input), owner = this.account(), { meta, bytes } = this.document(owner, parsed.id)
    this.same(owner); return { name: meta.name, base64: bytes.toString('base64') }
  }
  dispose() { this.closed = true; this.unsubscribe(); for (const op of this.operations) op.controller.abort() }
}
