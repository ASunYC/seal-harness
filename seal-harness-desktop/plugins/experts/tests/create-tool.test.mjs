import test from 'node:test'
import assert from 'node:assert/strict'
import { registerExpertCreationTools } from '../src/create-tool.js'

test('model tool saves one expert for the current account with real capability references', async () => {
  const tools = new Map(), calls = []
  const session = { accountId: 'local-user' }
  const ctx = {
    get(name) {
      if (name === 'sealHarnessIdentity') return { getSession: () => session }
      if (name === 'agentDefaultModel') return { currentSelection: () => ({ provider: 'configured', model: 'default-model' }) }
    },
    tools: { register(definition) { tools.set(definition.name, definition); return () => tools.delete(definition.name) } },
  }
  const experts = { async call(action, payload) {
    calls.push({ action, payload })
    if (action === 'list') return { items: [] }
    if (action === 'capabilities') return { items: [
      { kind: 'skill', sourceId: 'skill-1', name: '文档写作', enabled: true },
      { kind: 'mcp', sourceId: 'connector-1', name: '资料库', enabled: true, status: 'active' },
    ] }
    if (action === 'create') return { name: payload.manifest.name, version: payload.manifest.version }
    throw new Error(`unexpected action ${action}`)
  } }
  const dispose = registerExpertCreationTools(ctx, experts)
  assert.deepEqual([...tools.keys()], ['list_available_expert_capabilities', 'create_expert'])
  const execution = { signal: new AbortController().signal }
  const available = await tools.get('list_available_expert_capabilities').execute({}, execution)
  assert.match(available, /skill-1/)
  const result = await tools.get('create_expert').execute({
    displayName: '研究专家', profession: '研究顾问', description: '整理资料并给出建议',
    personaInstructions: '先核实资料，再按结论、依据和风险输出。',
    skills: ['文档写作'], connectors: ['connector-1'], tags: ['研究'],
  }, execution)
  assert.equal(JSON.parse(result).status, 'created')
  const manifest = calls.find(call => call.action === 'create').payload.manifest
  assert.match(manifest.name, /^expert-[0-9a-f]{8}$/)
  assert.equal(manifest.model, 'default-model')
  assert.deepEqual(manifest.capabilities, [
    { kind: 'skill', sourceId: 'skill-1' },
    { kind: 'mcp', sourceId: 'connector-1' },
  ])
  dispose()
  assert.equal(tools.size, 0)
})

test('model tool rejects unknown capabilities before saving', async () => {
  const tools = new Map()
  const ctx = {
    get(name) {
      if (name === 'sealHarnessIdentity') return { getSession: () => ({ accountId: 'local-user' }) }
      if (name === 'agentDefaultModel') return { currentSelection: () => ({ provider: 'configured', model: 'model' }) }
    },
    tools: { register(definition) { tools.set(definition.name, definition); return () => {} } },
  }
  let created = false
  const experts = { async call(action) {
    if (action === 'list') return { items: [] }
    if (action === 'capabilities') return { items: [] }
    if (action === 'create') { created = true; return {} }
  } }
  registerExpertCreationTools(ctx, experts)
  await assert.rejects(tools.get('create_expert').execute({
    displayName: '研究专家', profession: '顾问', description: '研究', personaInstructions: '核实信息', skills: ['不存在'],
  }, { signal: new AbortController().signal }), /未找到/)
  assert.equal(created, false)
})

test('model tool requires a signed-in account and configured default model', async () => {
  const tools = new Map()
  let account = null, selection = null, calls = 0
  const ctx = {
    get(name) {
      if (name === 'sealHarnessIdentity') return { getSession: () => account }
      if (name === 'agentDefaultModel') return { currentSelection: () => selection }
    },
    tools: { register(definition) { tools.set(definition.name, definition); return () => {} } },
  }
  registerExpertCreationTools(ctx, { async call() { calls++; return { items: [] } } })
  const args = { displayName: '研究专家', profession: '顾问', description: '研究', personaInstructions: '核实信息' }
  const execution = { signal: new AbortController().signal }
  await assert.rejects(tools.get('create_expert').execute(args, execution), /登录/)
  account = { accountId: 'local-user' }
  await assert.rejects(tools.get('create_expert').execute(args, execution), /默认模型/)
  assert.equal(calls, 0)
})
