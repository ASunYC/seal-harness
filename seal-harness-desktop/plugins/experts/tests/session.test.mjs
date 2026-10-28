import assert from 'node:assert/strict'
import test from 'node:test'
import { Context } from '@deepseek-ai/cordis'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import Skills from '@deepseek-ai/dsh-skill'
import { createScope, scopeTarget } from '@deepseek-ai/dsh-scope'
import { createSessionExperts } from '../src/session.js'

async function fixture(t) {
  const ctx = new Context(), records = new Map(), listeners = new Set(), agents = new Map(), connectorCalls = []
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(Skills)
  let identity = { accountId: 'a', epoch: 1 }, failSave = false, failLoad = ''
  ctx.provide('sealHarnessIdentity', { getSession: () => identity, subscribe: fn => { listeners.add(fn); return () => listeners.delete(fn) } })
  ctx.provide('credentials', {
    readRecord: async key => records.get(key),
    modifyRecord: async (key, fn) => { if (failSave) throw new Error('disk full'); const value = await fn(records.get(key)); records.set(key, value); return value },
  })
  ctx.provide('agents', { get: id => agents.get(id) })
  ctx.provide('sealHarnessConnectors', { async call(action, payload) {
    connectorCalls.push({ action, payload })
    if (action === 'list') return { items: [{ id: 'docs', enabled: true, status: 'active', tools: [{ name: 'read' }] }] }
    return {}
  } })
  ctx.provide('sealHarnessSkills', { async call() { return {
    name: 'review', description: 'Review', content: 'Skill {{literal}}', source: 'runtime', invocation: { userInvocable: true, modelInvocable: true },
  } } })
  const load = async ref => {
    if (failLoad === ref.name) throw new Error('missing dependency')
    return { name: ref.name, version: '1.0.0', state: {}, pkg: {
      digest: 'a'.repeat(64), portableDependencies: [], files: new Map(),
      manifest: { displayName: { zh: ref.name }, personaInstructions: `Persona ${ref.name} {{literal}}`,
        capabilities: ref.name === 'writer' ? [{ kind: 'skill', sourceId: 'review' }, { kind: 'mcp', sourceId: 'docs' }] : [] },
    } }
  }
  const options = { home: '.', owner: () => identity.accountId, load, list: async () => ({ items: [{ name: 'writer' }, { name: 'reader' }] }) }
  let manager = createSessionExperts(ctx, options)
  const makeAgent = id => {
    const agent = { id, status: 'idle', session: { history: ['already sent'], draft: 'keep draft' }, runMaintenance: fn => fn(new AbortController().signal) }
    agent.ctx = createScope(ctx, agent).ctx
    agents.set(id, agent)
    return agent
  }
  const a = makeAgent('session-a'), b = makeAgent('session-b')
  const contexts = async agent => JSON.stringify((await ctx.get('systemPrompt').assemble({ scope: agent })).contexts)
  const set = (name, selected = true, sessionId = a.id) => manager.sessionSet({ sessionId, name, selected, version: '1.0.0', expectedDigest: 'a'.repeat(64) })
  t.after(async () => { await manager.dispose(); await ctx.fiber.dispose() })
  return { ctx, a, b, records, connectorCalls, contexts, set, manager: () => manager,
    failSave: value => { failSave = value }, failLoad: value => { failLoad = value },
    async restart() { await manager.dispose(); manager = createSessionExperts(ctx, options) },
    switchAccount(value, notify = true) { identity = value; if (notify) for (const fn of listeners) fn() },
  }
}

test('已发言会话只有一个当前专家，切换与移除保留原草稿和历史并释放原能力', async t => {
  const f = await fixture(t)
  await f.set('writer')
  await assert.rejects(f.manager().assertRemovable('writer'), /先从会话中移除/)
  assert.deepEqual((await f.manager().sessionList({ sessionId: f.a.id })).selectedIds, ['writer'])
  assert.match(await f.contexts(f.a), /Persona writer \{\{literal\}\}/)
  assert.match(await f.contexts(f.a), /Skill \{\{literal\}\}/)
  assert.doesNotMatch(await f.contexts(f.b), /Persona|Skill/)
  assert.deepEqual(f.a.session, { history: ['already sent'], draft: 'keep draft' })
  assert.deepEqual(f.connectorCalls.filter(item => item.action === 'setSessionExperts').at(-1).payload.ids, ['docs'])
  await f.set('reader')
  await f.manager().assertRemovable('writer')
  assert.deepEqual((await f.manager().sessionList({ sessionId: f.a.id })).selectedIds, ['reader'])
  assert.doesNotMatch(await f.contexts(f.a), /Persona writer|Skill/)
  assert.match(await f.contexts(f.a), /Persona reader/)
  assert.deepEqual(f.connectorCalls.at(-1).payload.ids, [])
  await f.set('writer', false)
  assert.deepEqual((await f.manager().sessionList({ sessionId: f.a.id })).selectedIds, ['reader'], '过期的移除请求不能清除新专家')
  await f.set('reader', false)
  assert.doesNotMatch(await f.contexts(f.a), /Persona/)
  assert.deepEqual((await f.manager().sessionList({ sessionId: f.a.id })).selectedIds, [])
  assert.deepEqual(f.a.session, { history: ['already sent'], draft: 'keep draft' })
})

test('原型多选记录恢复时只启用最后选择的专家，不混合多个人设', async t => {
  const f = await fixture(t)
  await f.set('writer')
  const record = [...f.records.values()][0]
  record.payload.rows[0].experts.push({ name: 'reader', version: '1.0.0', digest: 'a'.repeat(64) })
  await f.restart()
  await f.ctx.serial(scopeTarget(f.a, f.a), 'agent/created', { agent: f.a })
  assert.deepEqual((await f.manager().sessionList({ sessionId: f.a.id })).selectedIds, ['reader'])
  assert.match(await f.contexts(f.a), /Persona reader/)
  assert.doesNotMatch(await f.contexts(f.a), /Persona writer|Skill/)
})

test('选择持久恢复、按账号隔离；账号退出后原会话请求不能继续使用专家', async t => {
  const f = await fixture(t)
  await f.set('writer'); await f.restart()
  assert.doesNotMatch(await f.contexts(f.a), /Persona/)
  await f.ctx.serial(scopeTarget(f.a, f.a), 'agent/created', { agent: f.a })
  assert.match(await f.contexts(f.a), /Persona writer/)
  f.switchAccount({ accountId: 'b', epoch: 2 }, false)
  let requests = 0
  await assert.rejects(f.ctx.waterfall(scopeTarget(f.ctx, f.a), 'agent/request', {}, async () => { requests++; return {} }), /账号已变化/)
  assert.equal(requests, 0)
  f.switchAccount({ accountId: 'b', epoch: 2 })
  assert.deepEqual((await f.manager().sessionList({ sessionId: f.b.id })).selectedIds, [])
  assert.doesNotMatch(await f.contexts(f.a), /Persona/)
  f.switchAccount({ accountId: 'a', epoch: 3 })
  await f.manager().sessionList({ sessionId: f.a.id })
  assert.match(await f.contexts(f.a), /Persona writer/)
})

test('添加失败或持久化失败恢复旧专家，忙碌与过期摘要明确拒绝且不改变已选状态', async t => {
  const f = await fixture(t)
  await f.set('writer')
  f.failSave(true)
  await assert.rejects(f.set('reader'), /disk full/)
  assert.match(await f.contexts(f.a), /Persona writer/)
  assert.doesNotMatch(await f.contexts(f.a), /Persona reader/)
  f.failSave(false); f.failLoad('reader')
  await assert.rejects(f.set('reader'), /missing dependency/)
  f.a.status = 'running'
  await assert.rejects(f.set('writer', false), /等待当前回复/)
  f.a.status = 'idle'
  await assert.rejects(f.manager().sessionSet({ sessionId: f.a.id, name: 'writer', selected: true, expectedDigest: 'b'.repeat(64) }), /已更新/)
  assert.deepEqual((await f.manager().sessionList({ sessionId: f.a.id })).selectedIds, ['writer'])
})
