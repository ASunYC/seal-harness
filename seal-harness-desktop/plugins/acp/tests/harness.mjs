import { spawn } from 'node:child_process'
import assert from 'node:assert/strict'
import { access } from 'node:fs/promises'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, isAbsolute } from 'node:path'
import { fileURLToPath } from 'node:url'
import { scrubbedParentEnv } from '@deepseek-ai/dsh-subprocess'
import { openProductDatabase } from '../../local-data/src/index.js'
import { AcpService } from '../src/service.js'

export const fixturePath = fileURLToPath(new URL('./fixture-runner.mjs', import.meta.url))
export function makeSubprocess() {
  const children = []
  return {
    children,
    async resolveExecutable(command) { if (!isAbsolute(command)) throw new Error('not found'); await access(command); return command },
    spawn(spec) {
      assert.deepEqual(spec.stdio, { stdin: 'pipe', stdout: 'pipe', stderr: { maxBytes: 4096 } })
      const child = spawn(spec.argv[0], spec.argv.slice(1), { cwd: spec.cwd, env: { ...scrubbedParentEnv(), ...spec.env }, stdio: ['pipe', 'pipe', 'ignore'], windowsHide: true })
      children.push(child)
      let ended = false
      const done = new Promise((resolve, reject) => { child.once('error', reject); child.once('close', (exitCode, signal) => { ended = true; resolve({ exitCode, signal }) }) })
      return {
        stdin: child.stdin, stdout: child.stdout, done,
        terminate() { child.kill() },
        async waitForExit(signal) {
          if (ended) return true
          if (signal?.aborted) return false
          let onAbort
          const aborted = new Promise(resolve => { onAbort = () => resolve(false); signal?.addEventListener('abort', onAbort, { once: true }) })
          try { return await Promise.race([done.then(() => true), aborted]) } finally { signal?.removeEventListener('abort', onAbort) }
        },
      }
    },
  }
}
export function harness(t, options = {}) {
  const home = mkdtempSync(join(tmpdir(), 'seal-acp-'))
  const storage = openProductDatabase(home), listeners = new Set(), records = new Map(), subprocess = makeSubprocess()
  let session = { accountId: 'alice', epoch: 1 }
  for (const id of ['alice', 'bob']) storage.db.prepare('INSERT INTO users VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)').run(id, id, id, Buffer.alloc(16), Buffer.alloc(64), 'user', 'active', '', '')
  const identity = { getSession: () => session, subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener) } }
  const credentials = { async readRecord(key) { return records.get(key) }, async modifyRecord(key, update) { records.set(key, update(records.get(key))) } }
  const service = new AcpService({ storage, identity, credentials, subprocess, ...options })
  t.after(async () => { await service.dispose().catch(() => {}); for (const child of subprocess.children) child.kill(); storage.close(); rmSync(home, { recursive: true, force: true }) })
  return { home, service, storage, credentials, records, subprocess, identity,
    switch(next) { session = next; for (const listener of listeners) listener() },
    config(mode = 'normal', extra = {}) { return { command: process.execPath, args: [fixturePath, mode], cwd: home, timeoutSeconds: 5, permission: 'reject', ...extra } },
  }
}
