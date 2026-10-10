import React, { useEffect, useState } from 'react'

export const inject = ['slots', 'connection']

const styles = `
.sh-imggen-settings{padding:24px 32px;max-width:600px;color:var(--text-primary,inherit)}
.sh-imggen-settings h2{font-size:16px;font-weight:600;margin:0 0 4px}
.sh-imggen-settings p{font-size:13px;color:var(--text-secondary,#888);margin:0 0 20px}
.sh-imggen-settings-status{display:inline-flex;align-items:center;gap:6px;font-size:12px;padding:3px 10px;border-radius:999px;margin-bottom:20px;background:var(--bg-secondary,rgba(128,128,128,.12))}
.sh-imggen-settings-status[data-ok=true]{color:#2a9d5c}
.sh-imggen-settings-status[data-ok=false]{color:#c43}
.sh-imggen-settings-form{display:flex;flex-direction:column;gap:14px}
.sh-imggen-settings-form label{display:flex;flex-direction:column;gap:5px;font-size:13px;font-weight:500}
.sh-imggen-settings-form input{height:36px;padding:0 10px;border:1px solid var(--border-color,rgba(128,128,128,.3));border-radius:8px;background:var(--bg-input,transparent);color:inherit;font:inherit;outline:none}
.sh-imggen-settings-form input:focus{border-color:var(--color-primary,#4d89e8)}
.sh-imggen-settings-form input:disabled{opacity:.5;cursor:not-allowed}
.sh-imggen-settings-row{display:flex;gap:10px}
.sh-imggen-settings-row label{flex:1}
.sh-imggen-settings-actions{display:flex;align-items:center;gap:12px;margin-top:4px}
.sh-imggen-settings-save{height:36px;padding:0 18px;border:0;border-radius:8px;background:var(--color-primary,#4d89e8);color:#fff;font:inherit;font-size:13px;font-weight:500;cursor:pointer}
.sh-imggen-settings-save:disabled{opacity:.5;cursor:not-allowed}
.sh-imggen-settings-msg{font-size:12px}
.sh-imggen-settings-msg[data-error=true]{color:#c43}
.sh-imggen-settings-msg[data-error=false]{color:#2a9d5c}
.sh-imggen-settings-hint{font-size:12px;color:var(--text-secondary,#888);margin-top:16px;line-height:1.6}
`

function ImageGenSettingsSection({ api }) {
  const [status, setStatus] = useState(null)
  const [baseURL, setBaseURL] = useState('')
  const [model, setModel] = useState('')
  const [apiKey, setApiKey] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState(null) // { text, error }

  useEffect(() => {
    const controller = new AbortController()
    api('status', {}, controller.signal).then(s => {
      setStatus(s)
      setBaseURL(s.baseURL ?? 'https://api.openai.com/v1')
      setModel(s.model ?? 'dall-e-3')
    }).catch(err => {
      if (!controller.signal.aborted) setMsg({ text: err.message, error: true })
    })
    return () => controller.abort()
  }, [api])

  async function save(event) {
    event.preventDefault()
    setBusy(true); setMsg(null)
    try {
      const next = await api('configure', {
        baseURL: baseURL.trim() || 'https://api.openai.com/v1',
        model: model.trim() || 'dall-e-3',
        ...(apiKey.trim() ? { apiKey: apiKey.trim() } : {}),
      })
      setStatus(next); setApiKey('')
      setMsg({ text: '配置已保存。', error: false })
    } catch (err) {
      setMsg({ text: err.message, error: true })
    } finally {
      setBusy(false)
    }
  }

  async function clearKey() {
    setBusy(true); setMsg(null)
    try {
      const next = await api('configure', { clearKey: true })
      setStatus(next)
      setMsg({ text: 'API Key 已清除。', error: false })
    } catch (err) {
      setMsg({ text: err.message, error: true })
    } finally {
      setBusy(false)
    }
  }

  return <div className="sh-imggen-settings">
    <h2>图片生成</h2>
    <p>配置 OpenAI Images API 兼容接口。支持 OpenAI、通义万相、ApiSmart 等兼容服务。</p>
    {status !== null && (
      <div className="sh-imggen-settings-status" data-ok={status.configured}>
        {status.configured ? '✓ 已配置' : '✗ 未配置'}
      </div>
    )}
    <form className="sh-imggen-settings-form" onSubmit={save}>
      <label>
        Base URL
        <input
          type="url"
          value={baseURL}
          onChange={e => setBaseURL(e.target.value)}
          placeholder="https://api.openai.com/v1"
          disabled={busy}
        />
      </label>
      <div className="sh-imggen-settings-row">
        <label>
          默认模型
          <input
            type="text"
            value={model}
            onChange={e => setModel(e.target.value)}
            placeholder="dall-e-3"
            disabled={busy}
          />
        </label>
      </div>
      <label>
        API Key
        <input
          type="password"
          autoComplete="off"
          value={apiKey}
          onChange={e => setApiKey(e.target.value)}
          placeholder={status?.configured ? '已保存；留空则保持原密钥' : '填写 API Key'}
          disabled={busy}
        />
      </label>
      <div className="sh-imggen-settings-actions">
        <button className="sh-imggen-settings-save" type="submit" disabled={busy || status === null}>
          {busy ? '保存中…' : '保存配置'}
        </button>
        {status?.configured && (
          <button type="button" onClick={clearKey} disabled={busy}
            style={{ height: 36, padding: '0 14px', border: '1px solid var(--border-color,rgba(128,128,128,.3))', borderRadius: 8, background: 'transparent', color: 'inherit', font: 'inherit', fontSize: 13, cursor: 'pointer' }}>
            清除 Key
          </button>
        )}
        {msg && <span className="sh-imggen-settings-msg" data-error={msg.error}>{msg.text}</span>}
      </div>
    </form>
    <p className="sh-imggen-settings-hint">
      API Key 仅保存在本机 DSH Host 凭据存储中，不会发送到其他服务器。<br />
      配置完成后，模型可使用 <code>ImageGen</code> 和 <code>ImageEdit</code> 工具生成和编辑图片。
    </p>
  </div>
}

export function apply(ctx) {
  const api = async (action, payload = {}, signal) => {
    const response = await ctx.connection.rpc.call('/api', `image-generation/${action}`, payload, signal)
    if (!response.ok) throw new Error(response.error?.message ?? '操作失败')
    return response.value
  }

  ctx.effect(() => {
    const el = document.createElement('style')
    el.dataset.plugin = '@seal-harness/image-generation'
    el.textContent = styles
    document.head.append(el)
    return () => el.remove()
  }, 'seal-harness-image-generation: styles')

  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section',
    id: 'image-generation',
    order: 55,
    label: () => '图片生成',
  }, () => <ImageGenSettingsSection api={api} />))
}
