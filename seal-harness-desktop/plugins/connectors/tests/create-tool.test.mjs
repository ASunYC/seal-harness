import test from 'node:test'
import assert from 'node:assert/strict'
import { registerConnectorCreationTool } from '../src/create-tool.js'
import { createConnectorDraftConversation, connectorCreationTemplate } from '../src/conversation.js'

test('model tool saves an uninstalled connector for the signed-in account', async () => {
  const tools = new Map(), calls = []
  const ctx = { get: name => name === 'sealHarnessIdentity' ? { getSession: () => ({ accountId: 'owner' }) } : undefined,
    tools: { register(definition) { tools.set(definition.name, definition); return () => tools.delete(definition.name) } } }
  const connectors = { async call(action, payload) {
    calls.push({ action, payload })
    if (action === 'list') return { items: [] }
    if (action === 'createDraft') return { items: [{ id: payload.id, name: payload.name, installed: false }] }
    throw new Error(action)
  } }
  const release = registerConnectorCreationTool(ctx, connectors)
  const result = await tools.get('create_connector').execute({ name: '资料查询', summary: '查询资料', transport: 'streamable-http', url: 'https://example.test/mcp' }, { signal: new AbortController().signal })
  assert.equal(JSON.parse(result).installed, false)
  assert.deepEqual(calls.map(call => call.action), ['list', 'createDraft'])
  assert.match(calls[1].payload.id, /^local-[0-9a-f]{8}$/)
  assert.equal(calls[1].payload.url, 'https://example.test/mcp')
  release(); assert.equal(tools.size, 0)
})

test('connector creation opens a native conversation with an unsent editable template', async () => {
  const events = []
  const ctx = {
    workspaces: { list: { getSnapshot: () => ({ items: [{ workspaceId: 'current', sessionIds: ['old'] }] }) } },
    sessions: { list: { getSnapshot: () => ({ byId: { old: { id: 'old', retainedBy: { mainView: 1 } } } }) },
      async create(input) { events.push(['create', input]); return 'new' },
      retain() { return { ready: Promise.resolve({ ctx: {} }), release() { events.push(['release']) } } } },
    conversation: { input: { for: () => ({ setDraft(value) { events.push(['draft', value]) } }) } },
    uiWorkspace: { openSession(id) { events.push(['open', id]) } },
  }
  await createConnectorDraftConversation(ctx)
  assert.deepEqual(events.map(item => item[0]), ['create', 'draft', 'open', 'release'])
  assert.equal(events[0][1].workspaceId, 'current')
  assert.equal(events[1][1], connectorCreationTemplate)
  assert.match(connectorCreationTemplate, /create_connector/)
})
