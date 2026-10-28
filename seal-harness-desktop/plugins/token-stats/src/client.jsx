import React, { useEffect, useState, useSyncExternalStore } from 'react'
import { styles } from './styles.js'

export const inject = ['slots', 'connection', 'sealHarnessAuthClient']
const tabs = [['summary', '汇总'], ['day', '按天'], ['expert', '按专家'], ['model', '按模型']]
const number = value => value === null || value === undefined ? '未提供' : value.toLocaleString('zh-CN')
const localDay = (time, timeZone) => new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(time)
function initialQuery() {
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Shanghai'
  return { from: localDay(Date.now() - 29 * 86400000, timeZone), to: localDay(Date.now(), timeZone), timeZone, view: 'summary', expert: '', model: '' }
}

function Bars({ title, rows, total }) {
  return <section className="seal-token-chart"><h2>{title}</h2>{rows.length ? <div className="seal-token-bars">{rows.map(row => <div key={row.key} className="seal-token-bar">
    <span title={row.label}>{row.label}</span><i style={{ width: `${total ? Math.max(1, row.totalTokens / total * 100) : 0}%` }} /><small>{number(row.totalTokens)}</small>
  </div>)}</div> : <div className="seal-token-empty">区间内无记录</div>}</section>
}

export function TokenStatsPanel({ api, onDownload = downloadWorkbook }) {
  const [query, setQuery] = useState(initialQuery)
  const [snapshot, setSnapshot] = useState(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [refresh, setRefresh] = useState(0)
  const [lifetime] = useState(() => new AbortController())
  useEffect(() => () => lifetime.abort(), [lifetime])
  useEffect(() => {
    const controller = new AbortController()
    setBusy(true); setError('')
    void api('snapshot', query, controller.signal).then(value => { if (!controller.signal.aborted) setSnapshot(value) })
      .catch(cause => { if (!controller.signal.aborted) { setError(cause.message); setSnapshot(null) } })
      .finally(() => { if (!controller.signal.aborted) setBusy(false) })
    return () => controller.abort()
  }, [api, query, refresh])
  const update = (key, value) => setQuery(current => ({ ...current, [key]: value }))
  const exportUsage = async () => {
    setExporting(true); setError('')
    try { const file = await api('export', query, lifetime.signal); if (!lifetime.signal.aborted) onDownload(file) }
    catch (cause) { if (!lifetime.signal.aborted) setError(cause.message) }
    finally { if (!lifetime.signal.aborted) setExporting(false) }
  }
  const summary = snapshot?.summary
  const zones = [...new Set([query.timeZone, 'Asia/Shanghai', 'UTC', 'America/New_York', 'Europe/London'])]
  return <main className="seal-token-page" data-seal-panel="token-stats">
    <header><h1>Token 统计</h1><p>当前本机账号的实际模型用量</p></header>
    <div className="seal-token-notice">{snapshot?.scope ?? '仅统计插件启用后、登录期间开始的轮次。历史未归属记录和辅助模型请求不计入，未知用量不估算。'}</div>
    <div className="seal-token-tabs" role="tablist" aria-label="统计维度">{tabs.map(([id, label]) => <button type="button" role="tab" key={id} aria-selected={query.view === id} onClick={() => update('view', id)}>{label}</button>)}</div>
    <div className="seal-token-filters">
      <label>从<input aria-label="开始日期" type="date" value={query.from} onChange={event => update('from', event.target.value)} /></label>
      <label>至<input aria-label="结束日期" type="date" value={query.to} onChange={event => update('to', event.target.value)} /></label>
      <label>时区<select aria-label="统计时区" value={query.timeZone} onChange={event => update('timeZone', event.target.value)}>{zones.map(zone => <option key={zone}>{zone}</option>)}</select></label>
      <select aria-label="筛选专家" value={query.expert} onChange={event => update('expert', event.target.value)}><option value="">全部专家</option>{snapshot?.experts.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}</select>
      <select aria-label="筛选模型" value={query.model} onChange={event => update('model', event.target.value)}><option value="">全部模型</option>{snapshot?.models.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}</select>
      <button type="button" onClick={() => setRefresh(value => value + 1)} disabled={busy}>刷新</button>
      <button type="button" onClick={() => void exportUsage()} disabled={busy || exporting || !snapshot}>导出 Excel</button>
    </div>
    {error && <p className="seal-token-error" role="alert">{error}</p>}
    {busy && <p role="status">正在读取用量…</p>}
    {snapshot && <>
      <div className="seal-token-cards">{[['totalTokens', '总 Tokens'], ['inputTokens', '未缓存输入'], ['outputTokens', '输出'], ['cacheReadTokens', '缓存读取']].map(([key, label]) => <div className="seal-token-card" key={key}><span>{label}</span><strong>{number(summary[key])}</strong></div>)}</div>
      <p>已计入 {snapshot.summary.turns} 轮 · 未返回完整用量 {snapshot.unavailableTurns} 轮 · 未结算 {snapshot.pendingTurns} 轮。总量已含缓存，不重复累加；推理量属于输出子集。</p>
      <div className="seal-token-charts"><Bars title="专家分布" rows={snapshot.byExpert} total={summary.totalTokens} /><Bars title="模型分布" rows={snapshot.byModel} total={summary.totalTokens} /></div>
      <Bars title="每日消耗趋势" rows={snapshot.byDay} total={summary.totalTokens} />
      <section className="seal-token-table"><h2>{tabs.find(([id]) => id === query.view)[1]}</h2>{summary.turns ? <table><thead><tr>{['分组', '完成轮次', '未缓存输入', '输出', '总 Tokens', '缓存读取', '缓存写入', '推理输出'].map(label => <th key={label}>{label}</th>)}</tr></thead><tbody>{snapshot.rows.map(row => <tr key={row.key}><td>{row.label}</td><td>{row.turns}</td>{['inputTokens', 'outputTokens', 'totalTokens', 'cacheReadTokens', 'cacheWriteTokens', 'reasoningTokens'].map(key => <td key={key}>{number(row[key])}</td>)}</tr>)}</tbody></table> : <div className="seal-token-empty">区间内无可核对的用量记录。完成一次已报告用量的对话后刷新查看。</div>}</section>
    </>}
  </main>
}

function downloadWorkbook(file) {
  const bytes = Uint8Array.from(atob(file.base64), character => character.charCodeAt(0))
  const url = URL.createObjectURL(new Blob([bytes], { type: file.mimeType }))
  const link = document.createElement('a')
  link.href = url; link.download = file.filename; link.click()
  setTimeout(() => URL.revokeObjectURL(url), 0)
}

export function apply(ctx) {
  const api = async (action, payload, signal) => {
    const result = await ctx.connection.rpc.call('/api', `seal-harness-token-stats/${action}`, payload, signal)
    if (!result.ok) throw new Error(result.error.message)
    return result.value
  }
  ctx.effect(() => {
    const element = document.createElement('style'); element.textContent = styles; document.head.append(element)
    return () => element.remove()
  }, 'token-stats: styles')
  function Panel() {
    const status = useSyncExternalStore(ctx.sealHarnessAuthClient.subscribe, ctx.sealHarnessAuthClient.getStatus)
    return status?.user ? <TokenStatsPanel key={`${status.accountId}:${status.epoch}`} api={api} /> : <main className="seal-token-page"><h1>Token 统计</h1><p>请先登录本机账号。</p></main>
  }
  ctx.inject(['sealHarnessNavigation'], inner => inner.effect(() => inner.sealHarnessNavigation.register({ id: 'token-stats', label: 'Token 统计', icon: 'usage', order: 100, primary: true, Panel }), 'token-stats: primary navigation'))
}
