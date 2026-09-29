import test from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { mkdtemp, mkdir, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import Agents from '../src/registry.js'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import Sessions from '@deepseek-ai/dsh-session'
import Projections from '@deepseek-ai/dsh-session-projection'
import Persistence from '@deepseek-ai/dsh-session-persistence-jsonl'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import Tools from '@deepseek-ai/dsh-tools'
import Storage from '@deepseek-ai/dsh-storage'
import * as StorageJson from '@deepseek-ai/dsh-storage-json'
import * as StorageDomain from '@deepseek-ai/dsh-storage-domain'
import Workspaces from '@deepseek-ai/dsh-workspace'
import Llm from '@deepseek-ai/dsh-llm'
import { createNativeAgents } from '../src/native.js'

async function fixture(t) {
  const home = await realpath(await mkdtemp(join(tmpdir(), 'seal-harness-native-workspace-')))
  const cwd = join(home, 'workspace'); await mkdir(cwd)
  const ctx = new Context()
  let service
  t.after(async () => { await service?.dispose(); await ctx.fiber.dispose(); await rm(home, { recursive: true, force: true }) })
  for (const plugin of [SystemPrompt, Projections, Sessions, Agents, Llm]) await ctx.plugin(plugin).await()
  await ctx.plugin(Tools, { mode: 'native' }).await()
  await ctx.plugin(Persistence, { root: join(home, 'sessions'), compression: 'none' }).await()
  await ctx.plugin(Storage).await()
  await ctx.plugin(StorageJson, { root: join(home, 'storage') }).await()
  await ctx.plugin(StorageDomain, { backend: 'json' }).await()
  await ctx.plugin(Workspaces).await()
  await ctx.plugin(AgentLoop, { agents: [] }).await()
  service = await createNativeAgents(ctx, join(home, 'instances.json'))
  return { ctx, home, cwd, get service() { return service }, set service(value) { service = value } }
}

test('real DSH Host binds native sessions to durable workspaces, repairs old instances and retains membership on resume', async t => {
  const f = await fixture(t), { ctx, home, cwd } = f
  let { service } = f
  const request = { action: 'create', input: { requestId: randomUUID(), name: '原生工作区验证', cwd, model: null } }
  const created = await service.request(request), id = created.instances[0].id
  const workspace = await ctx.workspaceRegistry.resolveByPath(cwd)
  assert.ok(workspace)
  assert.deepEqual(workspace.sessionIds, [id])
  assert.equal(ctx.sessions.get(id).header.cwd, cwd)
  assert.equal((await ctx.sessionPersistence.stat(id)).header.cwd, cwd)
  await workspace.detachSession(id)
  assert.deepEqual(workspace.sessionIds, [])
  assert.deepEqual(await service.request({ action: 'open', id }), { sessionId: id })
  assert.deepEqual(workspace.sessionIds, [id])
  await service.request({ action: 'stop', id })
  assert.equal(ctx.agents.get(id), undefined)
  await service.request({ action: 'open', id })
  assert.equal(ctx.sessions.get(id).header.cwd, cwd)
  assert.deepEqual(workspace.sessionIds, [id])
  await service.dispose()
  f.service = service = await createNativeAgents(ctx, join(home, 'instances.json'))
  await service.request(request)
  assert.equal(ctx.workspaceRegistry.list().length, 1)
  assert.deepEqual(workspace.sessionIds, [id])
  t.diagnostic(JSON.stringify({ sessionId: id, headerCwd: ctx.sessions.get(id).header.cwd, workspace: { id: workspace.id, path: workspace.path, sessionIds: workspace.sessionIds }, agentLive: Boolean(ctx.agents.get(id)) }))
})


test('native management releases history-owned instances, preserves history and leaves ordinary chat running', async t => {
  const { ctx, home, cwd, service } = await fixture(t)
  const created = await service.request({ action: 'create', input: { requestId: randomUUID(), name: '历史恢复', cwd, model: null } })
  const id = created.instances[0].id
  await service.request({ action: 'stop', id })
  let historyHandle
  const historyOwner = ctx.plugin({ inject: ['agents'], async apply(historyCtx) { historyHandle = await historyCtx.agents.resume({ resumeSessionId: id }) } })
  await historyOwner.await()
  const activity = historyHandle.agent.runMaintenance(signal => new Promise(resolve => signal.addEventListener('abort', resolve, { once: true })))
  await service.request({ action: 'stop', id })
  await activity
  assert.equal(ctx.agents.get(id), undefined)
  assert.equal((await service.request({ action: 'snapshot' })).instances[0].status, 'stopped')
  assert.equal((await ctx.sessionPersistence.stat(id)).header.cwd, cwd)
  assert.deepEqual((await ctx.workspaceRegistry.resolveByPath(cwd)).sessionIds, [id])
  await service.request({ action: 'restart', id })
  const restarted = ctx.agents.get(id)
  await historyOwner.dispose()
  assert.equal(ctx.agents.get(id), restarted)
  await service.request({ action: 'stop', id })
  await ctx.agents.resume({ resumeSessionId: id })
  const ordinary = await ctx.agents.create({ sessionId: randomUUID(), meta: { cwd } })
  await ctx.sessions.flush(ordinary.agent.session)
  await service.dispose()
  assert.equal(ctx.agents.get(id), undefined)
  assert.equal(ctx.agents.get(ordinary.agent.id), ordinary.agent)
  const restored = await createNativeAgents(ctx, join(home, 'instances.json'))
  await ctx.agents.resume({ resumeSessionId: id })
  await restored.request({ action: 'delete', id })
  assert.equal(ctx.agents.get(id), undefined)
  assert.equal((await restored.request({ action: 'snapshot' })).instances.length, 0)
  assert.equal((await ctx.sessionPersistence.stat(id)).header.cwd, cwd)
  assert.equal(ctx.agents.get(ordinary.agent.id), ordinary.agent)
  await restored.dispose()
})

test('stop cancels pending create/resume and a subsequent resume remains usable', async t => {
  const { ctx, cwd, service } = await fixture(t)
  const created = await service.request({ action: 'create', input: { requestId: randomUUID(), name: 'pending resume', cwd, model: null } })
  const id = created.instances[0].id
  await service.request({ action: 'stop', id })
  const entered = Promise.withResolvers(), gate = Promise.withResolvers()
  const pending = ctx.agents.resume({ resumeSessionId: id, setup: async () => { entered.resolve(); await gate.promise } })
  const rejected = assert.rejects(pending)
  await entered.promise
  const duplicate = ctx.agents.resume({ resumeSessionId: id })
  const duplicateRejected = assert.rejects(duplicate)
  await service.request({ action: 'stop', id })
  await Promise.all([rejected, duplicateRejected])
  gate.resolve()
  assert.equal(ctx.agents.get(id), undefined)
  await service.request({ action: 'start', id })
  assert.ok(ctx.agents.get(id))

  const newId = randomUUID(), creating = Promise.withResolvers(), createGate = Promise.withResolvers()
  const createRejected = assert.rejects(ctx.agents.create({ sessionId: newId, meta: { cwd }, setup: async () => { creating.resolve(); await createGate.promise } }))
  await creating.promise
  const firstClose = ctx.agents.releaseInstance(newId)
  const secondClose = ctx.agents.releaseInstance(newId)
  await Promise.all([firstClose, secondClose, createRejected])
  createGate.resolve()
  assert.equal(ctx.agents.get(newId), undefined)
  assert.equal(ctx.agents.pendingInstances.size, 0)
})

test('close during announcement cancels publication and owner disposal clears the exact generation', async t => {
  const { ctx, cwd } = await fixture(t)
  const id = randomUUID(), announced = Promise.withResolvers()
  ctx.on('agent/created', async ({ agent, signal }) => {
    if (agent.id !== id) return
    announced.resolve()
    await new Promise(resolve => { if (signal.aborted) resolve(); else signal.addEventListener('abort', resolve, { once: true }) })
  })
  const rejected = assert.rejects(ctx.agents.create({ sessionId: id, meta: { cwd } }))
  await announced.promise
  await ctx.agents.releaseInstance(id)
  await rejected
  assert.equal(ctx.agents.get(id), undefined)
  assert.equal(ctx.agents.instanceHandles.size, 0)
  let handle
  const owner = ctx.plugin({ inject: ['agents'], async apply(ownerCtx) { handle = await ownerCtx.agents.create({ sessionId: randomUUID(), meta: { cwd } }) } })
  await owner.await()
  await ctx.sessions.flush(handle.agent.session)
  await owner.dispose()
  assert.equal(ctx.agents.get(handle.agent.id), undefined)
  assert.equal(ctx.agents.instanceHandles.size, 0)
})
