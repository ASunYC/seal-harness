import test from 'node:test'
import assert from 'node:assert/strict'
import { registerSkillCreationTool } from '../src/create-tool.js'
import { capabilityOptions } from '../../experts/src/capabilities.js'

test('model tool saves a personal skill without installing it', async () => {
  const tools = new Map(), calls = []
  const ctx = { get: name => name === 'sealHarnessIdentity' ? { getSession: () => ({ accountId: 'local-user' }) } : undefined,
    tools: { register(definition) { tools.set(definition.name, definition); return () => tools.delete(definition.name) } } }
  const skills = { async call(action, payload) {
    calls.push({ action, payload })
    if (action === 'list') return { revision: 4, skills: [] }
    if (action === 'create') return { skills: [{ name: 'research-summary' }] }
    throw new Error(action)
  } }
  const release = registerSkillCreationTool(ctx, skills)
  const result = await tools.get('create_skill').execute({ name: 'research-summary', description: '需要总结研究资料时使用', instructions: '先核实资料，再输出结论和依据。' }, { signal: new AbortController().signal })
  assert.equal(JSON.parse(result).installed, false)
  assert.deepEqual(calls.map(call => call.action), ['list', 'create'])
  assert.equal(calls[1].payload.draft, true)
  assert.match(calls[1].payload.content, /name: research-summary/)
  release(); assert.equal(tools.size, 0)
})

test('model tool rejects duplicate names before saving', async () => {
  const tools = new Map()
  const ctx = { get: () => ({ getSession: () => ({ accountId: 'local-user' }) }), tools: { register(definition) { tools.set(definition.name, definition); return () => {} } } }
  registerSkillCreationTool(ctx, { async call() { return { revision: 1, skills: [{ name: 'existing-skill' }] } } })
  await assert.rejects(tools.get('create_skill').execute({ name: 'existing-skill', description: '用途', instructions: '指令' }, { signal: new AbortController().signal }), /同名/)
})

test('uninstalled personal skill is absent from expert capability choices', async () => {
  const ctx = { get(name) { if (name === 'sealHarnessSkills') return { call: async () => ({ skills: [
    { id: 'draft', name: 'draft-skill', installed: false, enabled: false },
    { id: 'ready', name: 'ready-skill', installed: true, enabled: true },
  ] }) } } }
  const result = await capabilityOptions(ctx)
  assert.deepEqual(result.items.map(item => item.sourceId), ['ready'])
})
