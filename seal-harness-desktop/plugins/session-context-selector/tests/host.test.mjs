import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { apply } from '../src/index.js'
import { jsonlSessionDir } from '../src/deletion.js'

const endpoint = 'seal-harness-capabilities/sessions/delete'
const sessionId = 'session-3d0f3552-b5d3-4c33-b04c-994d23fc0dac'

test('Host 注册永久删除 RPC，并在边界拒绝未归档会话', async () => {
  let route
  apply({
    connection: { fetch: { register(value) { route = value } } },
    sessionPersistence: { stat: async () => undefined },
    workspaceRegistry: { archivedSessionIds: [], list: () => [] },
    sessions: { get: () => undefined },
    emit() {},
    logger: { warn() {} },
  })

  assert.equal(route.path, `/api/${endpoint}`)
  const response = await route.fetch(new Request(`http://host/api/${endpoint}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ type: 'client-request', rpcId: 'delete-1', method: endpoint, payload: { sessionId } }),
  }))
  assert.equal(response.status, 200)
  assert.deepEqual(await response.json(), {
    type: 'server-response',
    rpcId: 'delete-1',
    result: {
      ok: false,
      error: { code: 'sessionNotArchived', message: '请先归档会话，再执行永久删除。', details: {} },
    },
  })
})

test('真实 RPC 完成归档记录、工作区引用、会话日志和投影缓存删除', async t => {
  const home = await mkdtemp(join(tmpdir(), 'seal-harness-delete-rpc-'))
  t.after(() => rm(home, { recursive: true, force: true }))
  const oldHome = process.env.DSH_HOME
  process.env.DSH_HOME = home
  t.after(() => {
    if (oldHome === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = oldHome
  })
  const cwd = join(home, 'workspace')
  const sessionPath = jsonlSessionDir(join(home, 'sessions'), cwd, sessionId)
  const projectionPath = join(home, 'storages', 'session_projcache', 'sessions', `${sessionId}.json`)
  await mkdir(sessionPath, { recursive: true })
  await mkdir(join(projectionPath, '..'), { recursive: true })
  await writeFile(join(sessionPath, 'session.v4.jsonl'), '{}\n')
  await writeFile(projectionPath, '{}')
  const workspace = {
    sessionIds: [sessionId],
    async detachSession(id) { this.sessionIds = this.sessionIds.filter(candidate => candidate !== id) },
    async attachSession(id) { this.sessionIds.push(id) },
    async insertSessionBefore() {},
  }
  const workspaceRegistry = {
    archivedSessionIds: [sessionId],
    list: () => [workspace],
    async unarchiveSession(id) { this.archivedSessionIds = this.archivedSessionIds.filter(candidate => candidate !== id) },
    async archiveSession(id) { this.archivedSessionIds.push(id) },
  }
  let route
  const emitted = []
  apply({
    connection: { fetch: { register(value) { route = value } } },
    sessionPersistence: { stat: async () => ({ header: { id: sessionId, cwd } }) },
    workspaceRegistry,
    waterfall: async () => [],
    emit: (...args) => emitted.push(args),
    logger: { warn() {} },
  })
  const response = await route.fetch(new Request(`http://host/api/${endpoint}`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ type: 'client-request', rpcId: 'delete-success', method: endpoint, payload: { sessionId } }),
  }))
  assert.equal(response.status, 200)
  assert.deepEqual((await response.json()).result, { ok: true, value: { sessionId } })
  await assert.rejects(stat(sessionPath), { code: 'ENOENT' })
  await assert.rejects(stat(projectionPath), { code: 'ENOENT' })
  assert.deepEqual(workspace.sessionIds, [])
  assert.deepEqual(workspaceRegistry.archivedSessionIds, [])
  assert.deepEqual(emitted, [['api-session/removed', sessionId]])
})
