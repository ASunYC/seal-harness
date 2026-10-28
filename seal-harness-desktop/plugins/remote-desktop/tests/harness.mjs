import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openProductDatabase } from '../../local-data/src/index.js'
import { RemoteHostService } from '../src/service.js'

export function harness(t, overrides = {}) {
  const home = mkdtempSync(join(tmpdir(), 'seal-remote-hosts-')), storage = openProductDatabase(home)
  for (const id of ['alice', 'bob']) storage.db.prepare('INSERT INTO users VALUES (?,?,?,?,?,?,?,?,?)')
    .run(id, id, id, Buffer.alloc(16), Buffer.alloc(64), 'user', 'active', 'now', 'now')
  const listeners = new Set()
  let owner = { accountId: 'alice', epoch: 1 }
  const identity = { getSession: () => owner, subscribe(callback) { listeners.add(callback); return () => listeners.delete(callback) } }
  const calls = []
  const clients = { async inspect() { return { available: true, executable: '/client' } },
    async probe(config) { calls.push(['probe', config]); return { reachable: true } },
    async launch(config) { calls.push(['launch', config]); return { client: 'Native fixture' } }, ...overrides }
  const service = new RemoteHostService({ storage, identity, clients })
  t.after(() => { service.dispose(); storage.close(); rmSync(home, { recursive: true, force: true }) })
  return { home, storage, identity, clients, service, calls, switch(next) { owner = next; for (const callback of listeners) callback() } }
}
export const config = protocol => ({ protocol, host: 'example.test', port: { ssh: 22, rdp: 3389, vnc: 5900 }[protocol], username: '', identityFile: '', clientPath: '' })
