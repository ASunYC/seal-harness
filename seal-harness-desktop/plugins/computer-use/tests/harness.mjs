import { ComputerUseService } from '../src/service.js'

export const vmProfile = overrides => ({ name: 'VM', mode: 'vm', host: 'vm.example.test', port: 22, username: 'user', guestOS: 'linux', driverPath: '', identityFile: '', socket: '/run/user/1000/cua-driver.sock', ...overrides })
export const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no }); return { promise, resolve, reject } }

export function harness(t, overrides = {}) {
  let owner = { accountId: 'alice', epoch: 1 }
  const listeners = new Set(), records = new Map(), events = new Map(), agents = new Map(), connections = [], mounted = [], calls = []
  let failSave = false
  const ctx = {
    sealHarnessIdentity: { getSession: () => owner, subscribe(callback) { listeners.add(callback); return () => listeners.delete(callback) } },
    credentials: { async readRecord(key) { return structuredClone(records.get(key)) }, async modifyRecord(key, mutate) {
      if (failSave) throw new Error('disk full')
      const record = await mutate(structuredClone(records.get(key))); records.set(key, structuredClone(record)); return record
    } },
    agents: { get: id => agents.get(id) },
    on(name, callback) { events.set(name, callback); return () => events.delete(name) }, logger: { warn() {} },
  }
  const createAgent = id => { const agent = { id, status: 'idle', ctx: {}, runMaintenance: callback => callback(new AbortController().signal) }; agents.set(id, agent); return agent }
  createAgent('session-a'); createAgent('session-b')
  const connection = () => {
    const value = { closed: 0, async listTools() { return [] }, async callTool(name, args) { calls.push({ name, args }); return { content: [{ type: 'text', text: 'native result' }] } }, async close() { this.closed++ } }
    connections.push(value); return value
  }
  const runtime = { async inspect(profile) { calls.push({ inspect: profile }); return { available: true } }, async launch(profile, options) { calls.push({ launch: profile, options }); return connection() }, ...overrides.runtime }
  const mount = overrides.mount ?? (async (agent, options) => { const scope = { agent, options, disposed: 0, async dispose() { this.disposed++ } }; mounted.push(scope); return scope })
  const service = new ComputerUseService(ctx, { runtime, mount })
  t.after(() => service.dispose())
  return { ctx, service, runtime, mount, mounted, calls, records, agents, connections, connection, createAgent,
    failSave(value) { failSave = value }, switch(next, notify = true) { owner = next; if (notify) for (const callback of listeners) callback() },
    async emit(name, payload) { await events.get(name)?.(payload) },
  }
}
