import assert from 'node:assert/strict'
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { test } from 'node:test'
import { tmpdir } from 'node:os'
import { mkdtemp, rm } from 'node:fs/promises'
import { createSessionDeletion, jsonlSessionDir } from '../src/deletion.js'

const sessionId = 'session-3d0f3552-b5d3-4c33-b04c-994d23fc0dac'

async function fixture({ archived = true } = {}) {
  const home = await mkdtemp(join(tmpdir(), 'seal-harness-session-delete-'))
  const cwd = join(home, 'workspace')
  const logDir = jsonlSessionDir(join(home, 'sessions'), cwd, sessionId)
  const projection = join(home, 'storages', 'session_projcache', 'sessions', `${sessionId}.json`)
  await mkdir(logDir, { recursive: true })
  await mkdir(join(projection, '..'), { recursive: true })
  await writeFile(join(logDir, 'session.v4.jsonl'), '{"type":"request/header"}\n')
  await writeFile(projection, '{"rows":{}}')

  const calls = []
  const workspace = {
    id: 'workspace-a',
    sessionIds: ['session-before', sessionId, 'session-after'],
    async detachSession(id) {
      calls.push(['detach', id])
      this.sessionIds = this.sessionIds.filter(candidate => candidate !== id)
    },
    async attachSession(id) {
      calls.push(['attach', id])
      if (!this.sessionIds.includes(id)) this.sessionIds.push(id)
    },
    async insertSessionBefore(id, beforeId) {
      calls.push(['insertBefore', id, beforeId])
      this.sessionIds = this.sessionIds.filter(candidate => candidate !== id)
      const index = beforeId === undefined ? this.sessionIds.length : this.sessionIds.indexOf(beforeId)
      this.sessionIds.splice(index < 0 ? this.sessionIds.length : index, 0, id)
    },
  }
  const workspaceRegistry = {
    archivedSessionIds: archived ? [sessionId] : [],
    list: () => [workspace],
    async unarchiveSession(id) {
      calls.push(['unarchive', id])
      this.archivedSessionIds = this.archivedSessionIds.filter(candidate => candidate !== id)
    },
    async archiveSession(id) {
      calls.push(['archive', id])
      if (!this.archivedSessionIds.includes(id)) this.archivedSessionIds.push(id)
    },
  }
  const emitted = []
  const deletion = createSessionDeletion({
    home,
    sessionPersistence: { async stat(id) {
      return id === sessionId ? { header: { id, cwd } } : undefined
    } },
    workspaceRegistry,
    emit: (...args) => emitted.push(args),
  })

  return { home, logDir, projection, workspace, workspaceRegistry, calls, emitted, deletion }
}

test('永久删除已归档会话并清除持久化、工作区引用和归档状态', async t => {
  const f = await fixture()
  t.after(() => rm(f.home, { recursive: true, force: true }))

  const result = await f.deletion.deleteArchivedSession(sessionId)

  assert.deepEqual(result, { sessionId })
  await assert.rejects(stat(f.logDir), { code: 'ENOENT' })
  await assert.rejects(stat(f.projection), { code: 'ENOENT' })
  assert.deepEqual(f.workspace.sessionIds, ['session-before', 'session-after'])
  assert.deepEqual(f.workspaceRegistry.archivedSessionIds, [])
  assert.deepEqual(f.emitted, [['api-session/removed', sessionId]])
})

test('拒绝删除未归档会话且不改动任何数据', async t => {
  const f = await fixture({ archived: false })
  t.after(() => rm(f.home, { recursive: true, force: true }))

  await assert.rejects(f.deletion.deleteArchivedSession(sessionId), error => error?.code === 'sessionNotArchived')

  assert.match(await readFile(join(f.logDir, 'session.v4.jsonl'), 'utf8'), /request\/header/)
  assert.deepEqual(f.workspace.sessionIds, ['session-before', sessionId, 'session-after'])
  assert.deepEqual(f.calls, [])
})

test('允许删除仍被 Host 加载但已经停止活动的归档会话', async t => {
  const f = await fixture()
  t.after(() => rm(f.home, { recursive: true, force: true }))
  const deletion = createSessionDeletion({
    home: f.home,
    sessionPersistence: { stat: async () => ({ header: { id: sessionId, cwd: join(f.home, 'workspace') } }) },
    workspaceRegistry: f.workspaceRegistry,
    getSessionActivity: async () => [],
    emit: (...args) => f.emitted.push(args),
  })

  await deletion.deleteArchivedSession(sessionId)

  await assert.rejects(stat(f.logDir), { code: 'ENOENT' })
  assert.deepEqual(f.emitted, [['api-session/removed', sessionId]])
})

test('拒绝删除仍有运行活动的归档会话', async t => {
  const f = await fixture()
  t.after(() => rm(f.home, { recursive: true, force: true }))
  const deletion = createSessionDeletion({
    home: f.home,
    sessionPersistence: { stat: async () => { throw new Error('不应读取磁盘') } },
    workspaceRegistry: f.workspaceRegistry,
    getSessionActivity: async () => [{ kind: 'agent', label: '正在生成' }],
  })

  await assert.rejects(deletion.deleteArchivedSession(sessionId), error => error?.code === 'sessionActive')
  assert.match(await readFile(join(f.logDir, 'session.v4.jsonl'), 'utf8'), /request\/header/)
  assert.deepEqual(f.calls, [])
})

test('删除没有投影缓存和工作区归属的归档会话', async t => {
  const f = await fixture()
  t.after(() => rm(f.home, { recursive: true, force: true }))
  await rm(f.projection)
  f.workspace.sessionIds = ['session-before', 'session-after']

  await f.deletion.deleteArchivedSession(sessionId)

  await assert.rejects(stat(f.logDir), { code: 'ENOENT' })
  assert.deepEqual(f.calls, [['unarchive', sessionId]])
  assert.deepEqual(f.emitted, [['api-session/removed', sessionId]])
})

test('拒绝格式错误或不存在的归档会话标识', async t => {
  const f = await fixture()
  t.after(() => rm(f.home, { recursive: true, force: true }))
  await assert.rejects(f.deletion.deleteArchivedSession('../session-a'), error => error?.code === 'invalidSessionId')
  f.workspaceRegistry.archivedSessionIds = ['session-14ab4e76-b642-4a6c-a7de-aeaefea7b153']
  await assert.rejects(f.deletion.deleteArchivedSession(f.workspaceRegistry.archivedSessionIds[0]), error => error?.code === 'sessionNotFound')
  assert.deepEqual(f.calls, [])
})

test('工作区状态更新失败时恢复会话目录、缓存、归档状态和原顺序', async t => {
  const f = await fixture()
  t.after(() => rm(f.home, { recursive: true, force: true }))
  const originalUnarchive = f.workspaceRegistry.unarchiveSession
  f.workspaceRegistry.unarchiveSession = async id => {
    await originalUnarchive.call(f.workspaceRegistry, id)
    throw new Error('registry write failed')
  }

  await assert.rejects(f.deletion.deleteArchivedSession(sessionId), /registry write failed/)

  assert.match(await readFile(join(f.logDir, 'session.v4.jsonl'), 'utf8'), /request\/header/)
  assert.equal(await readFile(f.projection, 'utf8'), '{"rows":{}}')
  assert.deepEqual(f.workspace.sessionIds, ['session-before', sessionId, 'session-after'])
  assert.deepEqual(f.workspaceRegistry.archivedSessionIds, [sessionId])
  assert.deepEqual(f.emitted, [])
})
