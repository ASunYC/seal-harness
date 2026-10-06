import test from 'node:test'
import assert from 'node:assert/strict'
import { createSkillDraftConversation, skillCreationTemplate } from '../src/conversation.js'

test('skill creation opens native conversation with an editable unsent template', async () => {
  const events = []
  const ctx = {
    workspaces: { list: { getSnapshot: () => ({ items: [{ workspaceId: 'current', sessionIds: ['old'] }] }) } },
    sessions: { list: { getSnapshot: () => ({ byId: { old: { id: 'old', retainedBy: { mainView: 1 } } } }) },
      async create(input) { events.push(['create', input]); return 'new' },
      retain() { return { ready: Promise.resolve({ ctx: {} }), release() { events.push(['release']) } } } },
    conversation: { input: { for: () => ({ setDraft(value) { events.push(['draft', value]) } }) } },
    uiWorkspace: { openSession(id) { events.push(['open', id]) } },
  }
  await createSkillDraftConversation(ctx)
  assert.deepEqual(events.map(item => item[0]), ['create', 'draft', 'open', 'release'])
  assert.equal(events[0][1].workspaceId, 'current')
  assert.equal(events[1][1], skillCreationTemplate)
  assert.match(skillCreationTemplate, /create_skill/)
})
