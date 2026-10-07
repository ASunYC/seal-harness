import React, { useEffect, useState } from 'react'
import { styles } from './styles.js'
import { DecisionSettings } from './settings.jsx'
import { openDecisionConversation } from './conversation.js'

export const inject = ['slots', 'layout', 'connection', 'sessions', 'workspaces', 'uiWorkspace']

const modeLabels = { yes_no: '是非判断', choice: '候选选择', score: '行动评分' }
const percentages = value => `${Math.round(value * 100)}%`

function Result({ value }) {
  if (!value) return null
  return <section className="ask-jev-result" aria-label="决策结果" role="status">
    <p className="ask-jev-eyebrow">结构化决策 · {value.provider === 'jev' ? 'TypeSafe Jev' : '阿里百炼'}</p>
    <h2>{value.summary}</h2>
    <p className="ask-jev-result-model">模型：{value.model}{value.requestId ? ` · 请求 ${value.requestId}` : ''}</p>
    {value.mode === 'yes_no' && <div className="ask-jev-result-metric"><span>值得行动的概率</span><strong>{percentages(value.yesProbability)}</strong><div className="ask-jev-meter"><span style={{ width: percentages(value.yesProbability) }} /></div></div>}
    {value.mode === 'choice' && <div className="ask-jev-result-metric"><span>模型置信度：{percentages(value.confidence)}</span><ul>{Object.entries(value.probabilities).map(([name, probability]) => <li key={name}><span>{name}</span><strong>{percentages(probability)}</strong></li>)}</ul></div>}
    {value.mode === 'score' && <div className="ask-jev-result-metric"><span>模型置信度：{percentages(value.confidence)}</span><p>评分范围：0–{value.max}；数值越高，越倾向行动。</p></div>}
    <p className="ask-jev-result-note">决策模型返回结构化数值；上方短句由插件按结果生成，不是模型生成的解释。</p>
  </section>
}

export function DecisionPanel({ api, onBack }) {
  const [status, setStatus] = useState(null)
  const [mode, setMode] = useState('yes_no')
  const [question, setQuestion] = useState('')
  const [context, setContext] = useState('')
  const [options, setOptions] = useState('')
  const [apiKey, setApiKey] = useState('')
  const [result, setResult] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  useEffect(() => {
    const controller = new AbortController()
    api('status', {}, controller.signal).then(setStatus).catch(cause => {
      if (!controller.signal.aborted) setError(cause.message)
    })
    return () => controller.abort()
  }, [api])

  async function run(work) {
    setBusy(true); setError(''); setNotice('')
    try { await work() }
    catch (cause) { setError(cause.message) }
    finally { setBusy(false) }
  }

  const provider = status?.provider ?? 'jev'
  const configured = status?.configured?.[provider] ?? false
  const save = event => {
    event.preventDefault()
    const data = new FormData(event.currentTarget)
    void run(async () => {
      const next = await api('configure', {
        provider,
        region: data.get('region') || status.region,
        workspaceId: data.get('workspaceId') || status.workspaceId,
        ...(apiKey.trim() ? { apiKey: apiKey.trim() } : {}),
      })
      setStatus(next); setApiKey(''); setNotice('配置已保存在当前 DSH Host。')
    })
  }
  const selectProvider = value => void run(async () => {
    setStatus(await api('configure', { provider: value })); setResult(null)
  })
  const submit = event => {
    event.preventDefault()
    void run(async () => {
      setResult(await api('decide', { question, mode, context,
        ...(mode === 'choice' ? { options: options.split(/\r?\n/).map(value => value.trim()).filter(Boolean) } : {}) }))
    })
  }

  return <main className="ask-jev-page">
    <header className="ask-jev-nav"><button type="button" className="ask-jev-back" aria-label="返回会话" onClick={onBack}>←</button><strong>问问决策</strong><span>DSH PLUGIN</span></header>
    <div className="ask-jev-content">
      <div className="ask-jev-intro"><p className="ask-jev-eyebrow">DECISION WORKSPACE</p><h1>把犹豫交给结构化判断</h1><p>输入问题和背景，选择 TypeSafe Jev 或阿里百炼决策模型。结果会标明真实来源和概率。</p></div>
      {error && <p className="ask-jev-message ask-jev-error" role="alert">{error}</p>}
      {notice && <p className="ask-jev-message" role="status">{notice}</p>}
      <section className="ask-jev-card" aria-label="决策模型设置"><div className="ask-jev-section-title"><div><h2>决策模型</h2><p>API Key 仅发送到当前 DSH Host 保存，不会在页面重新显示。</p></div><span>{configured ? '已配置' : '待配置'}</span></div>
        <div className="ask-jev-provider-choices" role="group" aria-label="选择决策模型">
          {Object.entries(status?.providers ?? { jev: { label: 'TypeSafe Jev' }, alibaba: { label: '阿里百炼决策模型' } }).map(([id, info]) => <button key={id} type="button" disabled={busy || !status} aria-pressed={provider === id} onClick={() => selectProvider(id)}>{info.label}<small>{id === 'jev' ? 'jev-latest' : 'decision-model-preview'}</small></button>)}
        </div>
        <form onSubmit={save} className="ask-jev-settings-form">
          {provider === 'alibaba' && <><label>地域<select name="region" key={`region-${status?.region}`} defaultValue={status?.region ?? 'cn-beijing'} disabled={busy}>{Object.entries(status?.regions ?? { 'cn-beijing': '华北2（北京）', 'ap-southeast-1': '新加坡' }).map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select></label><label>WorkspaceId<input name="workspaceId" key={`workspace-${status?.workspaceId}`} defaultValue={status?.workspaceId ?? ''} placeholder="例如 llm-xxxx" disabled={busy} /></label></>}
          <label>{provider === 'jev' ? 'TypeSafe API Key' : '百炼 API Key'}<input name="apiKey" type="password" autoComplete="off" value={apiKey} onChange={event => setApiKey(event.target.value)} placeholder={configured ? '已保存；留空则保持原密钥' : '填写 API Key'} disabled={busy} /></label>
          <button type="submit" disabled={busy || !status}>保存配置</button>
        </form>
      </section>
      <form onSubmit={submit} className="ask-jev-card ask-jev-decision-form"><div className="ask-jev-section-title"><div><h2>发起决策</h2><p>模型输出结构化判断，不生成聊天回复。</p></div></div>
        <div className="ask-jev-mode-choices" role="group" aria-label="决策模式">{Object.entries(modeLabels).map(([id, label]) => <button key={id} type="button" disabled={busy} aria-pressed={mode === id} onClick={() => { setMode(id); setResult(null) }}>{label}</button>)}</div>
        <label>问题<textarea required maxLength={2000} value={question} onChange={event => setQuestion(event.target.value)} placeholder="例如：这个方案值得现在启动吗？" disabled={busy} /></label>
        <label>背景或限制条件（可选）<textarea maxLength={4000} value={context} onChange={event => setContext(event.target.value)} placeholder="补充时间、成本、目标和风险" disabled={busy} /></label>
        {mode === 'choice' && <label>候选项（每行一个，至少两项）<textarea value={options} onChange={event => setOptions(event.target.value)} placeholder={'先小范围试点\n直接全面上线'} disabled={busy} /></label>}
        <button className="ask-jev-submit" type="submit" disabled={busy || !status || !configured}>{busy ? '正在判断…' : '获取决策'}</button>
        {!configured && <p className="ask-jev-hint">请先配置当前模型的 API Key。</p>}
      </form>
      <Result value={result} />
      <p className="ask-jev-attribution">独立 DSH 插件 · 决策流程参考 <a href="https://github.com/kuhung/ask-jev" target="_blank" rel="noreferrer">ask-jev</a>；模型接口分别由 TypeSafe 和阿里云百炼提供。</p>
    </div>
  </main>
}

export function apply(ctx) {
  const api = async (action, payload = {}, signal) => {
    const response = await ctx.connection.rpc.call('/api', `ask-jev/${action}`, payload, signal)
    if (!response.ok) throw new Error(response.error.message)
    return response.value
  }
  const navigation = ctx.get?.('sealHarnessNavigation')
  const leave = () => { navigation?.select(null); ctx.layout.selectPanel(null) }
  function DecisionConversationLauncher() {
    const [error, setError] = useState('')
    const [attempt, retry] = useState(0)
    useEffect(() => {
      let cancelled = false
      openDecisionConversation(ctx, navigation, navigation.getSnapshot().decisionSessionId)
        .catch(cause => { if (!cancelled) setError(cause.message) })
      return () => { cancelled = true }
    }, [attempt])
    return <main className="ask-jev-launcher" role="status">{error ? <><p>{error}</p><button type="button" onClick={() => { setError(''); retry(value => value + 1) }}>重试</button></> : '正在打开决策会话…'}</main>
  }
  function Panel() { return <DecisionPanel api={api} onBack={leave} /> }
  ctx.effect(() => {
    const element = document.createElement('style')
    element.dataset.plugin = 'dsh-plugin-ask-jev'
    element.textContent = styles
    document.head.append(element)
    return () => element.remove()
  }, 'ask-jev: styles')
  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section', id: 'ask-jev', order: 15, label: () => '问问决策',
  }, () => <DecisionSettings api={api} />))
  if (navigation) ctx.effect(() => navigation.register({ id: 'ask-jev', label: '问问决策', description: '与助手对话，需要时调用结构化决策模型', order: 45, icon: 'plugins', Panel: DecisionConversationLauncher }), 'ask-jev: home navigation')
  else {
    ctx.slots.inject('main', () => ctx.slots.register({ name: 'main', key: 'ask-jev' }, Panel))
    ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({ name: 'sidebar.panellist', id: 'ask-jev', order: 45, label: () => '问问决策' }, () => <span aria-hidden="true">◇</span>))
  }
}
