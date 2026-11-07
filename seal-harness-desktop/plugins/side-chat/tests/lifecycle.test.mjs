import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { mkdtemp, mkdir, stat, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { jsonlSessionDir } from '../../session-context-selector/src/deletion.js'
import { createSideChatLifecycle, isSideChatId } from '../src/lifecycle.js'

async function fixture(t, { agentPresets } = {}) {
  const home = await mkdtemp(join(tmpdir(), 'seal-side-chat-'))
  t.after(() => rm(home, { recursive: true, force: true }))
  const cwd = join(home, 'workspace')
  await mkdir(cwd)
  const parentSessionId = `session-${randomUUID()}`
  const workspace = {
    id: 'workspace-1', path: cwd, sessionIds: [parentSessionId],
    async detachSession(id) { this.sessionIds = this.sessionIds.filter(item => item !== id) },
  }
  const stored = new Map()
  const live = new Map()
  const disposed = []
  const removed = []
  const agents = {
    get: id => live.get(id),
    async create(options) {
      if (options.setup) assert.equal(await options.setup({}), undefined)
      const id = options.sessionId
      live.set(id, { id })
      stored.set(id, { header: { id, cwd: options.meta.cwd } })
      await mkdir(jsonlSessionDir(join(home, 'sessions'), options.meta.cwd, id), { recursive: true })
      return { agent: live.get(id), async dispose() { disposed.push(id); live.delete(id) } }
    },
    async resume(options) {
      if (options.setup) assert.equal(await options.setup({}), undefined)
      const id = options.resumeSessionId
      live.set(id, { id })
      return { agent: live.get(id), async dispose() { disposed.push(id); live.delete(id) } }
    },
  }
  const lifecycle = createSideChatLifecycle({
    agents,
    agentDefaultModel: { currentSelection: () => ({ provider: 'fake', model: 'fake' }) },
    agentPresets,
    sessionPersistence: { stat: async id => stored.get(id), list: async () => [...stored.values()] },
    workspaceRegistry: { list: () => [workspace], archivedSessionIds: [], unarchiveSession: async () => {} },
    emit: (_event, id) => removed.push(id), home,
  })
  return { home, cwd, parentSessionId, workspace, stored, disposed, removed, lifecycle }
}

test('侧聊不进入工作区会话列表，页签关闭后停止 Agent 并删除记录', async t => {
  const f = await fixture(t)
  const { sessionId } = await f.lifecycle.create(f.parentSessionId)
  assert.equal(isSideChatId(sessionId), true)
  assert.equal(f.workspace.sessionIds.includes(sessionId), false)
  const path = jsonlSessionDir(join(f.home, 'sessions'), f.cwd, sessionId)
  assert.equal((await stat(path)).isDirectory(), true)
  await f.lifecycle.close(sessionId)
  assert.deepEqual(f.disposed, [sessionId])
  assert.deepEqual(f.removed, [sessionId])
  await assert.rejects(stat(path), { code: 'ENOENT' })
})

test('旧版侧聊先从工作区移除，保留打开页签的记录并清理孤儿', async t => {
  const f = await fixture(t)
  const kept = (await f.lifecycle.create(f.parentSessionId)).sessionId
  const orphan = (await f.lifecycle.create(f.parentSessionId)).sessionId
  assert.deepEqual(await f.lifecycle.prune([]), { removed: 0, orphanCaches: 0 })
  f.workspace.sessionIds.push(kept, orphan)
  await f.lifecycle.migrateLegacy()
  assert.deepEqual(f.workspace.sessionIds, [f.parentSessionId])
  await f.lifecycle.dispose()
  assert.deepEqual(await f.lifecycle.prune([kept]), { removed: 1, orphanCaches: 0 })
  assert.equal(f.disposed.includes(orphan), true)
  assert.equal(f.disposed.includes(kept), true)
  await assert.rejects(stat(jsonlSessionDir(join(f.home, 'sessions'), f.cwd, orphan)), { code: 'ENOENT' })
  assert.equal((await stat(jsonlSessionDir(join(f.home, 'sessions'), f.cwd, kept))).isDirectory(), true)
})

test('清理接口拒绝普通会话标识', async t => {
  const f = await fixture(t)
  await assert.rejects(f.lifecycle.close(f.parentSessionId), { code: 'invalidSideChatId' })
  await assert.rejects(f.lifecycle.prune([f.parentSessionId]), { code: 'invalidSideChatId' })
})

test('启动清理会删除没有会话日志的遗留侧聊投影缓存', async t => {
  const f = await fixture(t)
  const sessionId = `seal-side-chat-${randomUUID()}`
  const directory = join(f.home, 'storages', 'session_projcache', 'sessions')
  const cache = join(directory, `${sessionId}.json`)
  await mkdir(directory, { recursive: true })
  await writeFile(cache, '{}')
  assert.deepEqual(await f.lifecycle.prune([]), { removed: 0, orphanCaches: 1 })
  await assert.rejects(stat(cache), { code: 'ENOENT' })
})

test('预设挂载的返回值不会误作 Agent 提交钩子', async t => {
  let mounted = false
  const f = await fixture(t, { agentPresets: {
    resolve: async () => ({ id: 'default' }),
    mount: async () => { mounted = true; return { unrelated: true } },
  } })
  await f.lifecycle.create(f.parentSessionId)
  assert.equal(mounted, true)
})
