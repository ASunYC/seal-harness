import React, { useEffect, useState } from 'react'

/** 原生设置页中的决策配置；凭据仍只经 Host RPC 保存。 */
export function DecisionSettings({ api }) {
  const [status, setStatus] = useState(null)
  const [apiKey, setApiKey] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  useEffect(() => {
    const controller = new AbortController()
    api('status', {}, controller.signal).then(value => {
      if (!controller.signal.aborted) setStatus(value)
    }).catch(cause => { if (!controller.signal.aborted) setError(cause.message) })
    return () => controller.abort()
  }, [api])
  async function run(action) {
    setBusy(true); setError(''); setNotice('')
    try { await action() } catch (cause) { setError(cause.message) } finally { setBusy(false) }
  }
  const provider = status?.provider ?? 'jev'
  const configured = Boolean(status?.configured?.[provider])
  function save(event) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    void run(async () => {
      const next = await api('configure', {
        provider,
        region: form.get('region') || status.region,
        workspaceId: form.get('workspaceId') || status.workspaceId,
        ...(apiKey.trim() ? { apiKey: apiKey.trim() } : {}),
      })
      setStatus(next); setApiKey(''); setNotice('配置已保存到本机 Host。')
    })
  }
  return <section className="ask-jev-page ask-jev-settings-page" aria-label="问问决策设置">
    <h2>问问决策</h2><p className="ask-jev-hint">在这里统一配置决策模型和访问凭据。对话入口位于左侧一级菜单。</p>
    {error && <p className="ask-jev-message ask-jev-error" role="alert">{error}</p>}
    {notice && <p className="ask-jev-message" role="status">{notice}</p>}
    <div className="ask-jev-card"><div className="ask-jev-section-title"><div><h3>决策模型</h3><p>API Key 仅发送到本机 Host 保存，不会在页面重新显示。</p></div><span>{configured ? '已配置' : '待配置'}</span></div>
      <div className="ask-jev-provider-choices" role="group" aria-label="选择决策模型">
        {Object.entries(status?.providers ?? { jev: { label: 'TypeSafe Jev' }, alibaba: { label: '阿里百炼决策模型' } }).map(([id, info]) => <button key={id} type="button" disabled={busy || !status} aria-pressed={provider === id} onClick={() => void run(async () => setStatus(await api('configure', { provider: id })))}>{info.label}<small>{id === 'jev' ? 'jev-latest' : 'decision-model-preview'}</small></button>)}
      </div>
      <form onSubmit={save} className="ask-jev-settings-form">
        {provider === 'alibaba' && <><label>地域<select name="region" key={`region-${status?.region}`} defaultValue={status?.region ?? 'cn-beijing'} disabled={busy}>{Object.entries(status?.regions ?? { 'cn-beijing': '华北2（北京）', 'ap-southeast-1': '新加坡' }).map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select></label><label>WorkspaceId<input name="workspaceId" key={`workspace-${status?.workspaceId}`} defaultValue={status?.workspaceId ?? ''} placeholder="例如 llm-xxxx" disabled={busy} /></label></>}
        <label>{provider === 'jev' ? 'TypeSafe API Key' : '百炼 API Key'}<input name="apiKey" type="password" autoComplete="off" value={apiKey} onChange={event => setApiKey(event.target.value)} placeholder={configured ? '已保存；留空则保持原密钥' : '填写 API Key'} disabled={busy} /></label>
        <button type="submit" disabled={busy || !status}>保存配置</button>
      </form>
    </div>
  </section>
}
