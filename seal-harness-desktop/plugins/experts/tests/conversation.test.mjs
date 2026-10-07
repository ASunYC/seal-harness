import test from 'node:test'
import assert from 'node:assert/strict'
import { createExpertDraftConversation, expertCreationTemplate } from '../src/conversation.js'

test('creating an expert opens a native conversation with an editable unsent template', async () => {
  const events = []
  const binding = { ctx: { session: 'new-session' } }
  const ctx = {
    workspaces: { list: { getSnapshot: () => ({ items: [] }) } },
    sessions: {
      list: { getSnapshot: () => ({ byId: {} }) },
      async create(input) { events.push(['create', input]); return 'new-session' },
      retain(id, owner) { events.push(['retain', id, owner]); return { ready: Promise.resolve(binding), release() { events.push(['release']) } } },
    },
    conversation: { input: { for(scope) { assert.equal(scope, binding.ctx); return { setDraft(text) { events.push(['draft', text]) } } } } },
    uiWorkspace: { openSession(id) { events.push(['open', id]) } },
  }
  await createExpertDraftConversation(ctx, 'workspace-a')
  assert.deepEqual(events.map(event => event[0]), ['create', 'retain', 'draft', 'open', 'release'])
  assert.deepEqual(events[0][1], { workspaceId: 'workspace-a' })
  assert.equal(events[2][1], expertCreationTemplate)
  assert.match(expertCreationTemplate, /创建专家工具保存/)
  assert.match(expertCreationTemplate, /需要的技能/)
  await assert.rejects(createExpertDraftConversation(ctx, undefined), /工作区/)
})

test('expert creation stays in the currently open workspace', async () => {
  let selected
  const ctx = {
    workspaces: { list: { getSnapshot: () => ({ items: [
      { workspaceId: 'default', sessionIds: [] },
      { workspaceId: 'current', sessionIds: ['s-current'] },
    ] }) } },
    sessions: {
      list: { getSnapshot: () => ({ byId: { 's-current': { id: 's-current', retainedBy: { mainView: 1 } } } }) },
      async create(input) { selected = input.workspaceId; return 'new-session' },
      retain() { return { ready: Promise.resolve({ ctx: {} }), release() {} } },
    },
    conversation: { input: { for: () => ({ setDraft() {} }) } },
    uiWorkspace: { openSession() {} },
  }
  await createExpertDraftConversation(ctx)
  assert.equal(selected, 'current')
})
