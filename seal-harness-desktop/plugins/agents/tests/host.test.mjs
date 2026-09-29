import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { HostConnectionService } from '@deepseek-ai/dsh-client-connection'
import LocalCredentials from '@deepseek-ai/dsh-credentials-local'
import * as Agents from '../src/index.js'

test('standard Cordis plugin validates RPC envelopes, unloads routes and restores native instance records', async t => {
  const home = await mkdtemp(join(tmpdir(), 'seal-harness-agents-host-')), previous = process.env.DSH_HOME
  process.env.DSH_HOME = home
  const ctx = new Context(), live = new Map()
  t.after(async () => { await ctx.fiber.dispose(); if (previous === undefined) delete process.env.DSH_HOME; else process.env.DSH_HOME = previous; await rm(home, { recursive: true, force: true }) })
  ctx.provide('sealHarnessServices', { getConfig: () => ({ terminalBaseUrl: 'https://platform.example/' }) })
  ctx.provide('sealHarnessIdentity', { getSession: () => null })
  ctx.provide('sessions', { get: id => live.get(id), flush: async session => assert.ok(session) })
  ctx.provide('workspaceRegistry', { create: async () => ({ attachSession: async id => assert.ok(live.has(id)) }) })
  ctx.provide('settings', { describe: () => [] })
  ctx.provide('llm', { listModels: async () => [] })
  ctx.provide('webServer', { register: () => () => {} })
  const attach = async id => { const agent = { id }; live.set(id, agent); return { agent, dispose: async () => live.delete(id) } }
  ctx.provide('agents', { get: id => live.get(id), create: input => attach(input.sessionId), resume: input => attach(input.resumeSessionId), releaseInstance: async id => live.delete(id) })
  await ctx.plugin(LocalCredentials, { dshHome: home, watch: false }).await()
  const connection = new HostConnectionService(ctx, [], { isAuthenticated: () => true })
  const handler = connection.createSharedFetchHandler('/api')
  const rpc = (action, payload = {}, method = `seal-harness-agents/${action}`, contentType = 'application/json') => handler.fetch(new Request(`http://host/api/seal-harness-agents/${action}`, { method: 'POST', headers: { 'content-type': contentType }, body: JSON.stringify({ type: 'client-request', rpcId: 'fixture', method, payload }) }))
  const value = async (action, payload) => { const response = await rpc(action, payload); assert.equal(response.status, 200); const result = (await response.json()).result; assert.equal(result.ok, true, result.error?.message); return result.value }
  let plugin = ctx.plugin(Agents); await plugin.await()
  assert.equal((await rpc('catalog', {}, 'wrong')).status, 400)
  assert.equal((await rpc('catalog', {}, undefined, 'text/plain')).status, 415)
  const invalid = await rpc('request', { kind: 'unknown', target: 'local', request: {} }); assert.equal((await invalid.json()).result.ok, false)
  const created = await value('request', { kind: 'autonomous', target: 'local', request: { action: 'create', input: { requestId: crypto.randomUUID(), name: '持久实例', cwd: home, model: null } } })
  assert.equal(created.instances.length, 1)
  await plugin.dispose()
  assert.equal((await rpc('catalog')).status, 404)
  assert.equal(live.size, 0)
  plugin = ctx.plugin(Agents); await plugin.await()
  const catalog = await value('catalog')
  assert.equal(catalog.instances[0].name, '持久实例')
})
