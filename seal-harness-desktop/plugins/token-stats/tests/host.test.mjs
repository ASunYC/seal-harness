import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { Context } from '@deepseek-ai/cordis'
import SessionStore from '@deepseek-ai/dsh-session'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import { openProductDatabase } from '../../local-data/src/index.js'
import * as plugin from '../src/index.js'

test('actual Cordis Session events drive the public projection and account-scoped RPC', async t => {
  const home = mkdtempSync(join(tmpdir(), 'seal-token-host-'))
  const storage = openProductDatabase(home)
  const now = new Date().toISOString()
  storage.db.prepare('INSERT INTO users VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)').run('owner', 'owner', 'Owner', Buffer.alloc(16), Buffer.alloc(64), 'user', 'active', now, now)
  let user = { accountId: 'owner' }
  const routes = new Map(), ctx = new Context()
  t.after(async () => { await ctx.fiber.dispose(); storage.close(); rmSync(home, { recursive: true, force: true }) })
  await ctx.plugin(SessionStore)
  await ctx.plugin(SessionProjectionRegistry)
  ctx.provide('sealHarnessDatabase', storage)
  ctx.provide('sealHarnessIdentity', { getSession: () => user })
  ctx.provide('connection', { fetch: { register(route) { routes.set(route.path, route) } } })
  const pluginFiber = await ctx.plugin(plugin)
  const session = ctx.sessions.create()
  session.append('turn/start', { turn: 1 })
  session.append('step/start', { turn: 1, step: 1 })
  session.append('assistant/attempt', { turn: 1, step: 1, stream: [{ type: 'chunk', time: 1, chunk: { type: 'usage', usage: { inputTokens: 10, outputTokens: 5, totalTokens: 18, cacheReadTokens: 3, cacheWriteTokens: 0 } } }] })
  session.append('step/end', { turn: 1, step: 1 })
  session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
  const day = new Date().toISOString().slice(0, 10)
  const query = { from: day, to: day, timeZone: 'UTC', view: 'summary' }
  const rpc = async (action, payload, override = {}) => {
    const method = `seal-harness-token-stats/${action}`
    return routes.get(`/api/${method}`).fetch(new Request(`http://localhost/api/${method}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ type: 'client-request', rpcId: 'test', method, payload, ...override }) }))
  }
  const result = (await (await rpc('snapshot', query)).json()).result
  assert.equal(result.ok, true)
  assert.equal(result.value.summary.totalTokens, 18)
  assert.equal(result.value.summary.cacheReadTokens, 3)
  await pluginFiber.dispose()
  await ctx.plugin(plugin)
  session.append('turn/start', { turn: 2 })
  session.append('step/start', { turn: 2, step: 1 })
  session.append('assistant/attempt', { turn: 2, step: 1, stream: [{ type: 'chunk', time: 1, chunk: { type: 'usage', usage: { inputTokens: 4, outputTokens: 1, totalTokens: 5, cacheReadTokens: 0, cacheWriteTokens: 0 } } }] })
  session.append('step/end', { turn: 2, step: 1 })
  session.append('turn/end', { turn: 2, reason: { kind: 'completed' } })
  const reloaded = (await (await rpc('snapshot', query)).json()).result
  assert.equal(reloaded.value.summary.totalTokens, 23, '热重载释放旧投影和事件订阅，不重复计算')
  assert.equal((await (await rpc('snapshot', { ...query, userId: 'another' })).json()).result.ok, false)
  assert.equal((await rpc('snapshot', query, { method: 'forged' })).status, 400)
  const route = routes.get('/api/seal-harness-token-stats/snapshot')
  assert.equal((await route.fetch(new Request('http://localhost', { method: 'POST', body: 'invalid' }))).status, 415)
  user = null
  assert.equal((await (await rpc('export', query)).json()).result.ok, false)
})
