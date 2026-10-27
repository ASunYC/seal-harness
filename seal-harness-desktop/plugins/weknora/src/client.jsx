import React, { useEffect, useState } from 'react'
import { apiKeySettingsUrl, modelSettingsUrl } from './model-settings-url.js'

export const inject = ['slots', 'connection']

const styles = `
.sh-weknora-settings{padding:24px 32px;max-width:620px;color:var(--text-primary,inherit)}
.sh-weknora-settings h2{font-size:16px;margin:0 0 8px}
.sh-weknora-settings p{font-size:13px;line-height:1.65;color:var(--text-secondary,#888)}
.sh-weknora-settings label{display:flex;flex-direction:column;gap:6px;margin:18px 0 12px;font-size:13px}
.sh-weknora-settings input{height:36px;padding:0 10px;border:1px solid var(--border-color,rgba(128,128,128,.3));border-radius:8px;background:var(--bg-input,transparent);color:inherit;font:inherit}
.sh-weknora-settings a{display:inline-block;padding:8px 14px;border-radius:8px;background:var(--color-primary,#4d89e8);color:#fff;text-decoration:none;font-size:13px}
.sh-weknora-settings button{padding:8px 14px;border:1px solid var(--border-color,rgba(128,128,128,.3));border-radius:8px;background:var(--bg-secondary,transparent);color:inherit;font:inherit;cursor:pointer}
.sh-weknora-settings button:disabled{opacity:.5;cursor:not-allowed}
.sh-weknora-settings .actions{display:flex;align-items:center;gap:8px;margin:16px 0}
.sh-weknora-settings .error{color:#c43}
`

function WeKnoraSettings({ api }) {
  const [status, setStatus] = useState(null)
  const [baseUrl, setBaseUrl] = useState('http://localhost:8080/api/v1')
  const [apiKey, setApiKey] = useState('')
  const [origin, setOrigin] = useState('http://localhost')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState(null)
  useEffect(() => {
    const controller = new AbortController()
    api('status', {}, controller.signal).then(value => {
      setStatus(value)
      setBaseUrl(value.baseUrl)
    }).catch(cause => { if (!controller.signal.aborted) setMessage({ text: cause.message, error: true }) })
    return () => controller.abort()
  }, [api])

  async function save(event) {
    event.preventDefault()
    setBusy(true); setMessage(null)
    try {
      const next = await api('configure', { baseUrl, ...(apiKey.trim() ? { apiKey: apiKey.trim() } : {}) })
      setStatus(next); setBaseUrl(next.baseUrl); setApiKey('')
      setMessage({ text: next.configured ? '连接配置已保存。' : '地址已保存，请填写 API Key。', error: false })
    } catch (cause) { setMessage({ text: cause.message, error: true }) }
    finally { setBusy(false) }
  }

  async function testConnection() {
    setBusy(true); setMessage(null)
    try {
      const result = await api('test')
      setMessage({ text: `连接成功，可访问 ${result.knowledgeBaseCount} 个知识库。`, error: false })
    } catch (cause) { setMessage({ text: cause.message, error: true }) }
    finally { setBusy(false) }
  }

  async function clearKey() {
    setBusy(true); setMessage(null)
    try {
      const next = await api('configure', { baseUrl: status.baseUrl, clearKey: true })
      setStatus(next); setApiKey('')
      setMessage({ text: 'API Key 已清除。', error: false })
    } catch (cause) { setMessage({ text: cause.message, error: true }) }
    finally { setBusy(false) }
  }

  let link
  let apiKeyLink
  let error
  try { link = modelSettingsUrl(origin); apiKeyLink = apiKeySettingsUrl(origin) }
  catch (cause) { error = cause.message }

  return <div className="sh-weknora-settings">
    <h2>WeKnora 知识库</h2>
    <p>Seal 使用 WeKnora 官方检索插件访问知识库。请填写 WeKnora API 地址及具有检索权限的 API Key。</p>
    <p>{status === null ? '正在读取连接配置…' : status.configured ? '✓ 已配置访问令牌' : '✗ 尚未配置访问令牌'}</p>
    <form onSubmit={save}>
      <label>WeKnora API 地址
        <input type="url" value={baseUrl} onChange={event => setBaseUrl(event.target.value)} disabled={busy} required />
      </label>
      <label>API Key
        <input type="password" autoComplete="off" value={apiKey} onChange={event => setApiKey(event.target.value)}
          placeholder={status?.configured ? '已保存；留空保持原密钥' : '在 WeKnora 中创建并粘贴'} disabled={busy} />
      </label>
      <div className="actions">
        <button type="submit" disabled={busy || status === null}>保存连接</button>
        <button type="button" onClick={testConnection} disabled={busy || !status?.configured}>测试连接</button>
        {status?.configured && <button type="button" onClick={clearKey} disabled={busy}>清除 Key</button>}
      </div>
    </form>
    {message && <p className={message.error ? 'error' : ''}>{message.text}</p>}
    <p>API Key 只保存在本机 Host 凭据存储中。更换 API 地址时，请一并填写该服务的 Key。</p>
    {apiKeyLink && <p><a href={apiKeyLink} target="_blank" rel="noopener noreferrer">打开 WeKnora API Key 管理</a></p>}
    <h2>WeKnora 模型配置</h2>
    <p>Embedding 向量模型和外部问答 LLM 在 WeKnora 原生页面配置，然后在知识库中选择。</p>
    <label>WeKnora 管理页面地址
      <input type="url" value={origin} onChange={event => setOrigin(event.target.value)} placeholder="https://kb.example.com" />
    </label>
    {error ? <p className="error">{error}</p> : <a href={link} target="_blank" rel="noopener noreferrer">打开 WeKnora 模型配置</a>}
  </div>
}

export function apply(ctx) {
  const api = async (action, payload = {}, signal) => {
    const response = await ctx.connection.rpc.call('/api', `weknora/${action}`, payload, signal)
    if (!response.ok) throw new Error(response.error?.message ?? '操作失败')
    return response.value
  }
  ctx.effect(() => {
    const element = document.createElement('style')
    element.dataset.plugin = '@seal-harness/weknora'
    element.textContent = styles
    document.head.append(element)
    return () => element.remove()
  }, 'seal-harness-weknora: styles')

  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section',
    id: 'weknora',
    order: 56,
    label: () => 'WeKnora',
  }, () => <WeKnoraSettings api={api} />))
}
