import { z } from 'zod'

const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/)
const timeZone = z.string().max(100).refine(value => {
  try { new Intl.DateTimeFormat('en', { timeZone: value }); return true } catch { return false }
}, '时区无效')
export const scheduleSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('daily'), time, timeZone }),
  z.strictObject({ kind: z.literal('weekly'), time, timeZone, weekdays: z.array(z.number().int().min(0).max(6)).min(1).max(7) }),
  z.strictObject({ kind: z.literal('interval'), minutes: z.number().int().min(1).max(10080) }),
  z.strictObject({ kind: z.literal('once'), at: z.iso.datetime() }),
])

// 用已保存的时区判断当地日期，夏令时不存在的分钟跳过，重复分钟只执行一次。
export function nextOccurrence(schedule, after) {
  if (schedule.kind === 'once') return Date.parse(schedule.at) > after ? Date.parse(schedule.at) : null
  if (schedule.kind === 'interval') return after + schedule.minutes * 60000
  const formatter = new Intl.DateTimeFormat('en-GB', {
    timeZone: schedule.timeZone, hourCycle: 'h23', hour: '2-digit', minute: '2-digit', weekday: 'short',
    year: 'numeric', month: '2-digit', day: '2-digit',
  })
  const weekdays = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
  const current = Object.fromEntries(formatter.formatToParts(after).map(part => [part.type, part.value]))
  const currentDate = `${current.year}-${current.month}-${current.day}`
  const first = Math.floor(after / 60000) * 60000 + 60000
  for (let minute = first; minute <= first + 8 * 86400000; minute += 60000) {
    const parts = Object.fromEntries(formatter.formatToParts(minute).map(part => [part.type, part.value]))
    if (`${parts.hour}:${parts.minute}` !== schedule.time) continue
    if (`${parts.year}-${parts.month}-${parts.day}` === currentDate && `${current.hour}:${current.minute}` >= schedule.time) continue
    if (schedule.kind === 'weekly' && !schedule.weekdays.includes(weekdays.indexOf(parts.weekday))) continue
    return minute
  }
  throw new Error('无法计算下次执行时间，请调整计划。')
}
