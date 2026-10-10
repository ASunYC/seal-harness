import React, { useEffect, useState } from 'react'
import { Dialog } from './dialog.jsx'

export function NativeAuthorization({ item, busy, error, authorize, api, run, close }) {
  const [state, setState] = useState({ phase: 'idle', url: null, error: '' }), [started, setStarted] = useState(false)
  useEffect(() => {
    if (!started) return
    const controller = new AbortController()
    const poll = async () => {
      try { const value = await api('connectors/nativeStatus', { id: item.id }, controller.signal); if (!controller.signal.aborted) setState(value) }
      catch (failure) { if (!controller.signal.aborted) setState(previous => ({ ...previous, error: failure.message })) }
    }
    void poll(); const timer = setInterval(poll, 1000)
    return () => { controller.abort(); clearInterval(timer) }
  }, [api, started, item.id])
  return <Dialog title={`${item.name} · 官方账号授权`} className="mcp-dialog mcp-dialog--narrow" busy={busy} close={close}>
    <div className="mcp-dialog__body mcp-stack"><p>通过官方 CLI 完成账号和应用授权。飞书与企业微信可能复用本机官方 CLI 的已有授权；钉钉使用当前账号独立配置。</p>
      {(error || state.error) && <p className="mcp-alert" role="alert">{error || state.error}</p>}
      {state.url && <a href={state.url} target="_blank" rel="noreferrer">打开官方授权页面</a>}
      <p role="status">{state.phase === 'ready' ? '授权已确认，连接器已启用。' : state.phase === 'idle' ? '点击开始后，按官方页面完成授权。' : state.phase === 'cancelled' ? '授权已取消。' : state.phase === 'error' ? '授权未完成。' : '正在等待官方授权…'}</p>
      <button className="btn btn--primary" disabled={busy || started && !['ready', 'error', 'cancelled'].includes(state.phase)} onClick={async () => { const result = await authorize(item); if (result) { setState(result); setStarted(true) } }}>开始授权</button>
      {started && <button className="btn btn--secondary" disabled={busy} onClick={async () => { await api('connectors/nativeCancel', { id: item.id }); setState(previous => ({ ...previous, phase: 'cancelled' })) }}>取消授权</button>}
    </div><footer className="mcp-dialog__footer"><button className="btn btn--primary" disabled={busy} onClick={async () => { if (await run('list')) close() }}>完成并刷新</button></footer>
  </Dialog>
}
