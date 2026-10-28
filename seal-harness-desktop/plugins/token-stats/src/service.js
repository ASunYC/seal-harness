import { dayAt, summarize, validateQuery } from './query.js'
import { workbookExport } from './export.js'
import { TokenStatsError } from './errors.js'

export class TokenStatsService {
  constructor({ storage, identity, readPreset = session => session.header?.agentPreset ?? '' }) {
    this.storage = storage
    this.identity = identity
    this.readPreset = readPreset
  }

  capture(session, event, projection) {
    if (event.type === 'turn/start') {
      const userId = this.identity.getSession()?.accountId
      if (!userId) return
      this.storage.db.prepare(`INSERT OR IGNORE INTO token_usage_turns
        (session_id, turn, user_id, start_seq, preset_id, started_at) VALUES (?, ?, ?, ?, ?, ?)`)
        .run(session.id, event.data.turn, userId, event.seq, this.readPreset(session) ?? '', event.time)
      return
    }
    if (event.type !== 'turn/end') return
    const row = this.storage.db.prepare('SELECT status FROM token_usage_turns WHERE session_id = ? AND turn = ?').get(session.id, event.data.turn)
    if (!row || row.status !== 'pending') return
    const usage = projection?.turn === event.data.turn ? projection.usage : null
    const routes = usage?.routes
    const route = routes?.length === 1 ? routes[0] : routes?.length > 1 ? { provider: '多模型轮次', model: routes.map(item => `${item.provider}/${item.model}`).join(' + ') } : null
    this.storage.db.prepare(`UPDATE token_usage_turns SET end_seq = ?, completed_at = ?, status = ?, provider = ?, model = ?,
      input_tokens = ?, output_tokens = ?, total_tokens = ?, cache_read_tokens = ?, cache_write_tokens = ?, reasoning_tokens = ?
      WHERE session_id = ? AND turn = ? AND status = 'pending'`)
      .run(event.seq, event.time, usage ? 'recorded' : 'unavailable', route?.provider ?? '', route?.model ?? '',
        usage?.uncachedInputTokens ?? null, usage?.outputTokens ?? null, usage?.totalTokens ?? null,
        usage?.cacheReadTokens ?? null, usage?.cacheWriteTokens ?? null, usage?.reasoningTokens ?? null, session.id, event.data.turn)
  }

  snapshot(input) {
    const userId = this.identity.getSession()?.accountId
    if (!userId) throw new TokenStatsError('sessionExpired', '请先登录本机账号。')
    const query = validateQuery(input)
    // 时区可能跨过 UTC 日期；先用宽界限缩小 SQL 范围，再按所选时区精确筛选。
    const start = Date.parse(`${query.from}T00:00:00Z`) - 86400000
    const end = Date.parse(`${query.to}T00:00:00Z`) + 2 * 86400000
    const rows = this.storage.db.prepare(`SELECT * FROM token_usage_turns WHERE user_id = ?
      AND COALESCE(completed_at, started_at) >= ? AND COALESCE(completed_at, started_at) < ?
      ORDER BY COALESCE(completed_at, started_at), session_id, turn`).all(userId, start, end)
      .filter(row => { const day = dayAt(row.completed_at ?? row.started_at, query.timeZone); return day >= query.from && day <= query.to })
    return summarize(rows, query)
  }

  export(input) { return workbookExport(this.snapshot(input)) }
}
