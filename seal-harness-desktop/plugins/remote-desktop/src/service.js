import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import { hostConfig, idInput, saveInput, RemoteHostError } from './config.js'

export { RemoteHostError } from './config.js'
const publicHost = row => ({ id: row.id, name: row.name, config: hostConfig.parse(JSON.parse(row.config_json)), createdAt: row.created_at, updatedAt: row.updated_at })

export class RemoteHostService {
  constructor({ storage, identity, clients, platform = process.platform, now = Date.now }) {
    Object.assign(this, { storage, identity, clients, platform, now })
    this.closed = false; this.operations = new Set()
    this.unsubscribe = identity.subscribe(() => {
      const current = identity.getSession()
      for (const operation of this.operations) if (operation.owner.accountId !== current?.accountId || operation.owner.epoch !== current?.epoch) operation.controller.abort()
    })
  }
  account() {
    if (this.closed) throw new RemoteHostError('closed', '远程主机服务已关闭。')
    const owner = this.identity.getSession()
    if (!owner?.accountId) throw new RemoteHostError('loginRequired', '请先登录本地账号。')
    return owner
  }
  same(owner) {
    const current = this.account()
    if (current.accountId !== owner.accountId || current.epoch !== owner.epoch) throw new RemoteHostError('accountChanged', '账号已变化，请重新操作。')
  }
  record(owner, id) {
    const row = this.storage.db.prepare('SELECT * FROM remote_hosts WHERE user_id = ? AND id = ?').get(owner.accountId, id)
    if (!row) throw new RemoteHostError('hostNotFound', '主机不存在或已删除，请刷新列表。')
    return publicHost(row)
  }
  async snapshot(input = {}, signal) {
    z.strictObject({}).parse(input)
    const owner = this.account()
    const hosts = this.storage.db.prepare('SELECT * FROM remote_hosts WHERE user_id = ? ORDER BY created_at, id').all(owner.accountId).map(publicHost)
    const clients = Object.fromEntries(await Promise.all(['ssh', 'rdp', 'vnc'].map(async protocol => [protocol,
      await this.clients.inspect({ protocol, host: 'localhost', port: { ssh: 22, rdp: 3389, vnc: 5900 }[protocol], username: '', identityFile: '', clientPath: '' })])))
    signal?.throwIfAborted(); this.same(owner)
    return { hosts, clients, platform: this.platform }
  }
  save(input) {
    const parsed = saveInput.parse(input), owner = this.account(), time = this.now()
    if (parsed.id) this.record(owner, parsed.id)
    const id = parsed.id ?? randomUUID()
    for (const operation of this.operations) if (operation.id === id && operation.owner.accountId === owner.accountId) operation.controller.abort()
    this.storage.db.prepare(`INSERT INTO remote_hosts (user_id,id,name,config_json,created_at,updated_at) VALUES (?,?,?,?,?,?)
      ON CONFLICT(user_id,id) DO UPDATE SET name=excluded.name,config_json=excluded.config_json,updated_at=excluded.updated_at`)
      .run(owner.accountId, id, parsed.name, JSON.stringify(parsed.config), time, time)
    return { host: this.record(owner, id) }
  }
  delete(input) {
    const { id } = idInput.parse(input), owner = this.account()
    this.record(owner, id)
    for (const operation of this.operations) if (operation.id === id && operation.owner.accountId === owner.accountId) operation.controller.abort()
    this.storage.db.prepare('DELETE FROM remote_hosts WHERE user_id = ? AND id = ?').run(owner.accountId, id)
    return { deleted: true }
  }
  async perform(input, signal, operation) {
    const { id } = idInput.parse(input), owner = this.account(), host = this.record(owner, id)
    const controller = new AbortController(), pending = { id, owner, controller }
    const combined = AbortSignal.any([controller.signal, ...(signal ? [signal] : [])])
    combined.throwIfAborted()
    this.operations.add(pending)
    try {
      const result = await operation(host, combined)
      combined.throwIfAborted(); this.same(owner)
      const latest = this.record(owner, id)
      if (JSON.stringify(latest.config) !== JSON.stringify(host.config)) throw new RemoteHostError('hostChanged', '连接配置已修改，请重新操作。')
      return result
    } finally { this.operations.delete(pending) }
  }
  check(input, signal) {
    return this.perform(input, signal, async (host, active) => {
      const client = await this.clients.inspect(host.config)
      active.throwIfAborted()
      const network = await this.clients.probe(host.config, active)
      return { client, network, checkedAt: this.now() }
    })
  }
  connect(input, signal) {
    return this.perform(input, signal, async (host, active) => {
      const result = await this.clients.launch(host.config, active)
      return { launched: true, client: result.client, hostId: host.id, message: '客户端启动请求已发送，请在客户端完成登录。此状态不代表远端已连接。' }
    })
  }
  dispose() {
    if (this.closed) return
    this.closed = true; this.unsubscribe()
    for (const operation of this.operations) operation.controller.abort()
  }
}
