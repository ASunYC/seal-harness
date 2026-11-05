import assert from 'node:assert/strict'
import test from 'node:test'
import { changedOfficePath, completedTurnFromChange, generatedOfficePath, workspaceOfficePath } from '../src/generated-office.js'

test('a completed live turn selects its last Office file from DSH deliverables', () => {
  const turn = { data: new Map([['deliverables', {
    produced: [{ seq: 4, path: 'notes.txt' }, { seq: 5, path: 'report.docx' }],
    presented: [{ seq: 6, path: 'summary.xlsx' }, { seq: 9, path: 'later.pptx' }],
  }]]) }
  assert.equal(generatedOfficePath(turn, 8, 'C:\\work'), 'C:\\work\\report.docx')
  assert.equal(generatedOfficePath(turn, 6, 'C:\\work'), 'C:\\work\\report.docx')
  assert.equal(generatedOfficePath({ data: new Map([['deliverables', {
    produced: [], presented: [{ seq: 6, path: 'summary.xlsx' }],
  }]]) }, 8, 'C:\\work'), 'C:\\work\\summary.xlsx')
  assert.equal(generatedOfficePath({ data: new Map([['deliverables', {
    produced: [{ seq: 10, path: 'new-report.docx' }],
    presented: [{ seq: 3, path: 'old-report.docx' }],
  }]]) }, 11, 'C:\\work'), 'C:\\work\\new-report.docx')
  assert.equal(workspaceOfficePath('C:\\other\\report.docx', 'C:\\work'), 'C:\\other\\report.docx')
  assert.equal(workspaceOfficePath('report.docx', undefined), null)
})

test('only an appended successful turn end triggers automatic opening', () => {
  const end = { type: 'event', event: { type: 'turn/end', data: { turn: 3, reason: { kind: 'completed' } } } }
  assert.equal(completedTurnFromChange({ kind: 'append', entries: [end] }, 3), true)
  assert.equal(completedTurnFromChange({ kind: 'replace', entries: [end] }, 3), false)
  assert.equal(completedTurnFromChange({ kind: 'append', entries: [end] }, 2), false)
  assert.equal(completedTurnFromChange({ kind: 'append', entries: [{ ...end, event: { ...end.event, data: { turn: 3, reason: { kind: 'error' } } } }] }, 3), false)
})

test('binary Office files reported by DSH workspace changes open after tool based generation', async () => {
  const turn = { turn: 3, data: new Map([['deliverables', { produced: [], changes: { seq: 12 } }]]) }
  const path = await changedOfficePath(turn, 'session-a', '/work', async url => {
    assert.equal(url, 'api/changes.summary?sessionId=session-a&seq=12')
    return { ok: true, json: async () => ({ turn: 3, files: [{ path: 'report.docx' }] }) }
  })
  assert.equal(path, '/work/report.docx')
  assert.equal(await changedOfficePath(turn, 'session-a', '/work', async () => ({ ok: true, json: async () => ({ turn: 2, files: [{ path: 'old.docx' }] }) })), null)
})
