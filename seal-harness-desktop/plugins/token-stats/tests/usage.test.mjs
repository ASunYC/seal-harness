import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import AdmZip from 'adm-zip'
import { JSDOM } from 'jsdom'
import { openProductDatabase } from '../../local-data/src/index.js'
import { TokenStatsService } from '../src/service.js'
import { usageProjection, usageEvent } from '../src/projection.js'
import { validateQuery } from '../src/query.js'

const query = { from: '2026-10-01', to: '2026-10-31', timeZone: 'Asia/Shanghai', view: 'summary', expert: '', model: '' }
const normalUsage = { inputTokens: 100, outputTokens: 20, totalTokens: 170, cacheReadTokens: 50, cacheWriteTokens: 0, reasoningTokens: 5 }
const stream = usage => usage ? [{ type: 'chunk', time: 1, chunk: { type: 'usage', usage } }] : []
const event = (seq, type, data, time = Date.parse('2026-10-10T16:30:00Z')) => ({ seq, type, data, time })

function events(usage = normalUsage, turn = 1, preset = 'model-a') {
  return [
    event(0, 'turn/start', { turn }), event(1, 'step/start', { turn, step: 1 }),
    event(2, 'assistant/message', { turn, step: 1, usage, stream: stream({ ...normalUsage, inputTokens: 999, totalTokens: 1069 }), message: { source: { provider: 'provider', model: preset }, content: [{ text: 'private text' }] } }),
    event(3, 'step/end', { turn, step: 1 }), event(4, 'turn/end', { turn }),
  ]
}

function fixture(t) {
  const home = mkdtempSync(join(tmpdir(), 'seal-token-usage-'))
  let storage = openProductDatabase(home)
  const now = new Date().toISOString()
  for (const id of ['alice', 'bob']) storage.db.prepare('INSERT INTO users VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)').run(id, id, id, Buffer.alloc(16), Buffer.alloc(64), 'user', 'active', now, now)
  let owner = 'alice'
  const identity = { getSession: () => owner ? { accountId: owner } : null }
  const service = () => new TokenStatsService({ storage, identity })
  t.after(() => { storage.close(); rmSync(home, { recursive: true, force: true }) })
  return { get storage() { return storage }, service, identity, owner: value => { owner = value }, reopen() { storage.close(); storage = openProductDatabase(home) } }
}

function feed(service, list, session = { id: 'session-1', header: { agentPreset: 'seal-harness-expert-writer' } }, initial = usageProjection.init()) {
  let state = initial
  for (const item of list) { state = usageProjection.apply(state, item); service.capture(session, item, state) }
  return state
}

test('real provider totals include caches once, group by timezone/day/expert/model and export real Excel', t => {
  const f = fixture(t), service = f.service()
  feed(service, events())
  const snapshot = service.snapshot(query)
  assert.equal(snapshot.summary.totalTokens, 170)
  assert.equal(snapshot.summary.inputTokens, 100)
  assert.equal(snapshot.summary.cacheReadTokens, 50)
  assert.equal(snapshot.summary.reasoningTokens, 5)
  assert.equal(snapshot.byDay[0].label, '2026-10-11')
  assert.equal(snapshot.byExpert[0].label, 'writer')
  assert.equal(snapshot.byModel[0].label, 'provider / model-a')
  assert.equal(service.snapshot({ ...query, from: '2026-10-10', to: '2026-10-10' }).summary.totalTokens, 0)
  const file = service.export(query)
  assert.match(file.filename, /\.xlsx$/)
  const zip = new AdmZip(Buffer.from(file.base64, 'base64'))
  const workbook = new JSDOM(zip.readAsText('xl/workbook.xml'), { contentType: 'text/xml' }).window.document
  assert.deepEqual([...workbook.querySelectorAll('sheet')].map(item => item.getAttribute('name')), ['汇总', '每日', '专家', '模型'])
  for (let index = 1; index <= 4; index++) assert.ok(zip.getEntry(`xl/worksheets/sheet${index}.xml`))
  const sheet = new JSDOM(zip.readAsText('xl/worksheets/sheet1.xml'), { contentType: 'text/xml' }).window.document
  assert.equal(sheet.querySelector('c[r="E2"] v').textContent, '170')
  assert.equal(sheet.querySelectorAll('f').length, 0)
  assert.match(zip.readAsText('xl/worksheets/sheet2.xml'), /2026-10-11/)
})

test('unknown buckets stay unknown, partial lifecycle is not turned into invented zero usage', t => {
  const f = fixture(t), service = f.service()
  feed(service, events({ inputTokens: 10, outputTokens: 2, totalTokens: 20 }), { id: 'unknown-cache', header: {} })
  feed(service, [event(0, 'turn/start', { turn: 1 }), event(1, 'step/start', { turn: 1, step: 1 }), event(2, 'turn/end', { turn: 1 })], { id: 'incomplete', header: {} })
  const snapshot = service.snapshot(query)
  assert.equal(snapshot.summary.totalTokens, 20)
  assert.equal(snapshot.summary.cacheReadTokens, null)
  assert.equal(snapshot.summary.cacheWriteTokens, null)
  assert.equal(snapshot.unavailableTurns, 1)
  assert.equal(snapshot.summary.turns, 1)
})

test('retry attempts are included once, final usage wins and projection contains no conversation content', t => {
  const f = fixture(t), service = f.service()
  const first = { inputTokens: 10, outputTokens: 2, totalTokens: 17, cacheReadTokens: 5, cacheWriteTokens: 0 }
  const retry = [
    event(0, 'turn/start', { turn: 1 }), event(1, 'step/start', { turn: 1, step: 1 }),
    event(2, 'assistant/attempt', { turn: 1, step: 1, stream: stream(first) }),
    event(3, 'llm/retry', { turn: 1, step: 1 }), event(4, 'llm/retry-started', { turn: 1, step: 1 }),
    ...events().slice(2).map((item, i) => ({ ...item, seq: i + 5 })),
  ]
  feed(service, retry)
  service.capture({ id: 'session-1' }, retry.at(-1), { turn: 1, usage: { ...normalUsage, uncachedInputTokens: 5000 } })
  const snapshot = service.snapshot(query)
  assert.equal(snapshot.summary.totalTokens, 187)
  assert.equal(snapshot.summary.inputTokens, 110)
  assert.equal(snapshot.summary.cacheReadTokens, 55)
  assert.equal(snapshot.byModel[0].label, '未提供模型归因')
  const projection = usageEvent(events()[2])
  assert.doesNotMatch(JSON.stringify(projection), /private text|content/)
  const empty = usageProjection.init()
  assert.equal(usageProjection.apply(empty, { type: 'plugin:unrelated', data: null }), empty)
})

test('ownership survives restart, duplicate starts cannot reassign it and another account never receives its data', t => {
  const f = fixture(t)
  const list = events(), session = { id: 'owned', header: {} }
  const partial = feed(f.service(), list.slice(0, 3), session)
  f.reopen(); f.owner('bob')
  const service = f.service()
  service.capture(session, list[0], partial)
  feed(service, list.slice(3), session, usageProjection.stateSchema.parse(JSON.parse(JSON.stringify(partial))))
  assert.equal(service.snapshot(query).summary.totalTokens, 0)
  assert.equal(service.export(query).base64.includes('private text'), false)
  f.owner('alice')
  assert.equal(service.snapshot(query).summary.totalTokens, 170)
  const state = feed(service, list, session)
  assert.equal(service.snapshot(query).summary.turns, 1)
  assert.equal(state.usage.totalTokens, 170)
  f.owner(null)
  assert.throws(() => service.snapshot(query), /登录/)
  assert.throws(() => service.export(query), /登录/)
})

test('historical unowned turns are excluded and filters reject account forgery or invalid ranges', t => {
  const f = fixture(t), service = f.service()
  feed(service, events().slice(1), { id: 'historical', header: {} })
  assert.equal(service.snapshot(query).summary.turns, 0)
  feed(service, events(), { id: 'a', header: { agentPreset: 'seal-harness-expert-=SUM(A1)' } })
  feed(service, events(normalUsage, 1, 'model-b'), { id: 'b', header: { agentPreset: 'standard' } })
  assert.equal(service.snapshot({ ...query, expert: 'standard' }).summary.totalTokens, 170)
  assert.equal(service.snapshot({ ...query, model: JSON.stringify(['provider', 'model-b']) }).summary.totalTokens, 170)
  const zip = new AdmZip(Buffer.from(service.export(query).base64, 'base64'))
  const sheet = new JSDOM(zip.readAsText('xl/worksheets/sheet3.xml'), { contentType: 'text/xml' }).window.document
  assert.equal(sheet.querySelectorAll('f').length, 0)
  assert.match(sheet.documentElement.textContent, /=SUM\(A1\)/)
  assert.throws(() => service.snapshot({ ...query, userId: 'bob' }))
  assert.throws(() => validateQuery({ ...query, from: '2026-02-30' }), /日期无效/)
  assert.throws(() => validateQuery({ ...query, from: '2026-11-01' }), /日期范围/)
  assert.throws(() => validateQuery({ ...query, timeZone: 'Not/AZone' }), /时区/)
})
