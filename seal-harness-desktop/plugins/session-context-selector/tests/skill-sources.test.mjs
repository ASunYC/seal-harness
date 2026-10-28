import assert from 'node:assert/strict'
import test from 'node:test'
import { registerSkillSources } from '../src/skill-sources.js'

test('session provenance uses public scoped registries and releases cold observations without reading skill bodies', async () => {
  let route, live = { id: 'session' }, user = { accountId: 'owner', epoch: 1 }, disposed = 0, leases = 0
  const registry = { async list({ scope, cwd }) {
    assert.equal(cwd, '/workspace'); assert.equal(scope, live ?? 'cold-scope')
    return [{ name: 'native', source: 'bundled', path: '/package/SKILL.md', invocation: { userInvocable: true }, content: 'never returned' },
      { name: 'hidden', source: 'runtime', invocation: { userInvocable: false } }]
  } }
  const effects = []
  registerSkillSources({ effect(callback) { effects.push(callback()) }, connection: { fetch: { register(value) { route = value } } },
    sealHarnessIdentity: { getSession: () => user }, agents: { get: () => live }, skills: registry,
    workingDirectory: { ensure: async () => '/workspace', defaultDirectory: '/default' },
    sessionQuery: { async observeSession() { return { projections: { values: { workingDirectory: '/workspace', agentPreset: 'standard' } }, header: {}, [Symbol.dispose]() { disposed++ } } } },
    agentPresets: { serviceFor: () => registry, async acquireScope(id) { assert.equal(id, 'standard'); return { key: 'cold-scope', async [Symbol.asyncDispose]() { leases++ } } } },
  })
  const request = (payload = { sessionId: 'session' }) => route.fetch(new Request('http://host'+route.path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ type: 'client-request', rpcId: 'test', method: 'seal-harness-capabilities/skills/sessionSources', payload }) }))
  const first = (await (await request()).json()).result
  assert.deepEqual(first, { ok: true, value: { items: [{ name: 'native', path: '/package/SKILL.md', source: 'bundled' }] } })
  live = undefined
  assert.equal((await (await request()).json()).result.ok, true)
  assert.equal(disposed, 1); assert.equal(leases, 1)
  assert.equal((await (await request({ sessionId: 'session', userId: 'other' })).json()).result.ok, false)
  registry.list = async () => { user = { accountId: 'other', epoch: 2 }; return [] }
  assert.equal((await (await request()).json()).result.ok, false)
  assert.equal(disposed, 2); assert.equal(leases, 2)
  user = null
  assert.equal((await (await request()).json()).result.ok, false)
  for (const dispose of effects) dispose?.()
})
