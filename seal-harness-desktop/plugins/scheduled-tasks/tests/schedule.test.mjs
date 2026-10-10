import test from 'node:test'
import assert from 'node:assert/strict'
import { nextOccurrence, scheduleSchema } from '../src/schedule.js'

test('daily, weekly, interval and once schedules preserve timezone and strict future semantics', () => {
  const now = Date.parse('2026-10-09T00:00:00Z')
  assert.equal(nextOccurrence({ kind: 'daily', time: '09:00', timeZone: 'Asia/Shanghai' }, now), Date.parse('2026-10-09T01:00:00Z'))
  assert.equal(nextOccurrence({ kind: 'daily', time: '08:00', timeZone: 'Asia/Shanghai' }, now), Date.parse('2026-10-10T00:00:00Z'))
  assert.equal(nextOccurrence({ kind: 'weekly', time: '09:00', timeZone: 'Asia/Shanghai', weekdays: [1] }, now), Date.parse('2026-10-12T01:00:00Z'))
  assert.equal(nextOccurrence({ kind: 'interval', minutes: 15 }, now), now + 900000)
  assert.equal(nextOccurrence({ kind: 'once', at: '2026-10-09T01:00:00Z' }, now), now + 3600000)
  assert.equal(nextOccurrence({ kind: 'once', at: '2026-10-08T01:00:00Z' }, now), null)
  for (const schedule of [{ kind: 'daily', time: '25:00', timeZone: 'UTC' }, { kind: 'daily', time: '09:00', timeZone: 'bad-zone' },
    { kind: 'weekly', time: '09:00', timeZone: 'UTC', weekdays: [] }, { kind: 'interval', minutes: 0 }]) assert.equal(scheduleSchema.safeParse(schedule).success, false)
})

test('DST spring gaps are skipped and fall repeated local minutes only run once', () => {
  const daily = { kind: 'daily', time: '02:30', timeZone: 'America/New_York' }
  assert.equal(nextOccurrence(daily, Date.parse('2026-03-08T05:00:00Z')), Date.parse('2026-03-09T06:30:00Z'))
  assert.equal(nextOccurrence({ ...daily, time: '01:30' }, Date.parse('2026-11-01T05:30:00Z')), Date.parse('2026-11-02T06:30:00Z'))
})
