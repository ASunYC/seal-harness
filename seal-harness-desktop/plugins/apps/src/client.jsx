import React, { useEffect, useState } from 'react'
import { registerPanel, leaveResource } from '../../capability-shared/src/client.jsx'
import { styles } from './styles.js'

export const inject = ['slots', 'layout', 'connection', 'sealHarnessNavigation']

export function ApplicationsPage({ api, onBack }) {
  const [items, setItems] = useState([]), [error, setError] = useState(''), [busy, setBusy] = useState(false), [confirm, setConfirm] = useState(false)
  const [loadError, setLoadError] = useState('')
  useEffect(() => {
    const controller = new AbortController()
    let timer
    const refresh = async () => {
      try {
        const value = await api('list', {}, controller.signal)
        if (!controller.signal.aborted) { setItems(value.items); setLoadError('') }
      } catch (cause) { if (!controller.signal.aborted) setLoadError(cause.message) }
      if (!controller.signal.aborted) timer = setTimeout(refresh, 1500)
    }
    void refresh()
    return () => { controller.abort(); clearTimeout(timer) }
  }, [api])
  async function act(action) {
    setBusy(true); setError(''); setConfirm(false)
    try {
      await api(action, { id: 'dbx' })
      setItems((await api('list')).items)
    } catch (cause) { setError(cause.message) }
    finally { setBusy(false) }
  }
  return <main className="seal-apps-page">
    <header className="seal-apps-nav"><button type="button" aria-label="返回会话" onClick={onBack}>←</button><strong>应用</strong><span>APPS</span></header>
    <div className="seal-apps-content">
      {(error || loadError) && <p role="alert" className="seal-apps-error">{error || loadError}</p>}
      {!items.length && !error && !loadError && <p role="status">正在读取应用…</p>}
      <div className="seal-apps-grid">{items.map(item => {
        const processing = ['install', 'uninstall', 'connect'].includes(item.state)
        const disabled = busy || processing
        const percent = item.progress?.total ? Math.min(100, Math.round(item.progress.received / item.progress.total * 100)) : null
        return <article className="seal-app-card" key={item.id} aria-label="DBX 应用">
          <div className="seal-app-card-header"><span className="seal-app-logo" aria-hidden="true"><svg viewBox="0 0 32 32" fill="none" stroke="currentColor" strokeWidth="1.7"><ellipse cx="16" cy="7" rx="10" ry="4"/><path d="M6 7v18c0 5 20 5 20 0V7M6 16c0 5 20 5 20 0"/></svg></span><div><h2>DBX</h2><p>数据库工作台</p></div><span className="seal-app-platform">Windows</span></div>
          <p className="seal-app-description">{item.description}</p>
          <div className="seal-app-meta"><span>v{item.version}</span><a href={item.source} target="_blank" rel="noreferrer">GitHub ↗</a><span>{item.license}</span></div>
          {item.installed && <p className="seal-app-mcp">{item.mcpStatus === 'active' ? `MCP 已连接 · ${item.toolCount} 个工具` : 'MCP 尚未连接'}</p>}
          {processing && <div role="status" className="seal-app-progress"><p>{item.state === 'uninstall' ? '正在卸载…' : item.state === 'connect' ? '正在连接 MCP…' : item.progress?.phase ?? '正在准备安装…'}{percent !== null ? ` ${percent}%` : ''}</p><progress max="100" {...(percent !== null ? { value: percent } : {})}/></div>}
          {item.error && <p role="alert" className="seal-apps-error">{item.error}</p>}
          {!item.supported && <p className="seal-apps-error">首版仅支持 Windows x64 / ARM64。</p>}
          <footer>{item.installed ? <><button className="seal-app-primary" disabled={disabled} onClick={() => void act('open')}>打开</button>{item.mcpStatus !== 'active' && <button disabled={disabled} onClick={() => void act('reconnect')}>连接 MCP</button>}<button className="seal-app-uninstall" disabled={disabled} onClick={() => setConfirm(true)}>卸载</button></> : <button className="seal-app-primary" disabled={disabled || !item.supported} onClick={() => void act('install')}>{processing ? '正在安装…' : <><span aria-hidden="true">＋</span> 安装</>}</button>}</footer>
        </article>
      })}</div>
      <p className="seal-apps-help">安装后打开 DBX，添加数据库连接，并在「设置 → MCP」中选择允许访问的连接。随后在会话输入框的「连接器」中选中 DBX，即可让助手查询数据。</p>
    </div>
    {confirm && <div className="seal-app-dialog-backdrop"><section className="seal-app-dialog" role="dialog" aria-modal="true" aria-labelledby="seal-app-uninstall-title"><h2 id="seal-app-uninstall-title">卸载 DBX？</h2><p>将移除应用程序及关联的 MCP 连接器，保留 DBX 的连接配置。请先退出 DBX（包括托盘）。</p><footer><button autoFocus onClick={() => setConfirm(false)}>取消</button><button className="seal-app-primary" onClick={() => void act('uninstall')}>确认卸载</button></footer></section></div>}
  </main>
}

export function apply(ctx) {
  const api = async (action, payload = {}, signal) => {
    const result = await ctx.connection.rpc.call('/api', `seal-harness-apps/${action}`, payload, signal)
    if (!result.ok) throw new Error(result.error.message)
    return result.value
  }
  ctx.effect(() => { const element = document.createElement('style'); element.textContent = styles; document.head.append(element); return () => element.remove() }, 'seal-harness apps styles')
  function Panel() { return <ApplicationsPage api={api} onBack={() => leaveResource(ctx)} /> }
  registerPanel(ctx, { id: 'apps', label: '应用', order: 55, icon: 'apps', description: '安装和使用本机应用' }, Panel)
}
