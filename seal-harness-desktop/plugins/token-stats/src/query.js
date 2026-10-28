import { z } from 'zod'
import { TokenStatsError } from './errors.js'

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)
export const querySchema = z.strictObject({
  from: day, to: day, timeZone: z.string().min(1).max(100),
  view: z.enum(['summary', 'day', 'expert', 'model']).default('summary'),
  expert: z.string().max(300).default(''), model: z.string().max(2000).default(''),
})
export const metricKeys = ['inputTokens', 'outputTokens', 'totalTokens', 'cacheReadTokens', 'cacheWriteTokens', 'reasoningTokens']
const fields = ['input_tokens', 'output_tokens', 'total_tokens', 'cache_read_tokens', 'cache_write_tokens', 'reasoning_tokens']

export function dayAt(time, timeZone) {
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(time)
}

export function validateQuery(input) {
  const value = querySchema.parse(input)
  for (const date of [value.from, value.to]) {
    if (!Number.isFinite(Date.parse(`${date}T00:00:00Z`)) || new Date(`${date}T00:00:00Z`).toISOString().slice(0, 10) !== date)
      throw new TokenStatsError('invalidInput', '日期无效，请使用实际存在的日期。')
  }
  if (value.from > value.to || Date.parse(value.to) - Date.parse(value.from) > 366 * 86400000)
    throw new TokenStatsError('invalidInput', '请选择先后正确、最长 367 天的日期范围。')
  try { dayAt(Date.now(), value.timeZone) } catch { throw new TokenStatsError('invalidInput', '时区无效，请选择有效的 IANA 时区。') }
  return value
}

export const modelKey = row => JSON.stringify([row.provider, row.model])
export const modelLabel = row => row.provider && row.model ? `${row.provider} / ${row.model}` : '未提供模型归因'
export const expertLabel = id => id.startsWith('seal-harness-expert-') ? id.slice('seal-harness-expert-'.length) : (({ standard: '标准助手', minimal: '简洁助手', creator: '创建助手' }[id] ?? id) || '默认助手')

export function totals(rows) {
  const result = { turns: rows.length }
  metricKeys.forEach((key, index) => {
    result[key] = rows.some(row => row[fields[index]] === null) ? null : rows.reduce((sum, row) => sum + row[fields[index]], 0)
  })
  if (Object.values(result).some(value => value !== null && !Number.isSafeInteger(value))) throw new TokenStatsError('rangeTooLarge', '用量超过安全统计范围，请缩小日期区间。')
  return result
}

function group(rows, keyOf, labelOf) {
  const grouped = new Map()
  for (const row of rows) {
    const key = keyOf(row)
    if (!grouped.has(key)) grouped.set(key, { key, label: labelOf(row), values: [] })
    grouped.get(key).values.push(row)
  }
  return [...grouped.values()].map(({ key, label, values }) => ({ key, label, ...totals(values) }))
}

export function summarize(rows, query) {
  const known = rows.filter(row => row.status === 'recorded')
  const filtered = rows.filter(row => (!query.expert || row.preset_id === query.expert) && (!query.model || modelKey(row) === query.model))
  const records = filtered.filter(row => row.status === 'recorded')
  const summary = totals(records)
  const byDay = group(records, row => dayAt(row.completed_at, query.timeZone), row => dayAt(row.completed_at, query.timeZone)).sort((a, b) => a.key.localeCompare(b.key))
  const byExpert = group(records, row => row.preset_id, row => expertLabel(row.preset_id)).sort((a, b) => b.totalTokens - a.totalTokens)
  const byModel = group(records, modelKey, modelLabel).sort((a, b) => b.totalTokens - a.totalTokens)
  return {
    query, summary, byDay, byExpert, byModel,
    rows: query.view === 'day' ? byDay : query.view === 'expert' ? byExpert : query.view === 'model' ? byModel : [{ key: 'summary', label: '区间汇总', ...summary }],
    experts: [...new Map(known.map(row => [row.preset_id, { id: row.preset_id, label: expertLabel(row.preset_id) }])).values()],
    models: [...new Map(known.map(row => [modelKey(row), { id: modelKey(row), label: modelLabel(row) }])).values()],
    unavailableTurns: filtered.filter(row => row.status === 'unavailable').length,
    pendingTurns: filtered.filter(row => row.status === 'pending').length,
    scope: '当前本机账号，仅统计插件启用后在登录期间开始的轮次；历史未归属轮次不导入。辅助请求及未报告完整用量的轮次不计入总量，多模型轮次不拆分估算。',
  }
}
