import React, { useEffect, useRef, useState } from 'react'
import { BaseEditor, DeleteConfirmation, KnowledgeSettings } from './editors.jsx'
import { BaseWorkspace } from './workspace.jsx'

function ActionIcon({ settings = false }) {
  return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {settings ? <><circle cx="12" cy="12" r="3" /><path d="M9 3h6l1 3 3 1 2 5-2 5-3 1-1 3H9l-1-3-3-1-2-5 2-5 3-1 1-3Z" /></> : <><path d="M20 8a8 8 0 1 0 0 8M20 3v5h-5" /></>}
  </svg>
}

export function KnowledgePanel({ api, openConnection }) {
  const [status, setStatus] = useState(null), [bases, setBases] = useState([]), [selected, setSelected] = useState(null)
  const [loading, setLoading] = useState(true), [busy, setBusy] = useState(false), [error, setError] = useState('')
  const [listed, setListed] = useState(false)
  const [editor, setEditor] = useState(null), [deleting, setDeleting] = useState(null), [settings, setSettings] = useState(false)
  const [models, setModels] = useState([]), [modelError, setModelError] = useState('')
  const lifetime = useRef(new AbortController())
  useEffect(() => { const controller = new AbortController(); lifetime.current = controller; return () => controller.abort() }, [])
  const call = (action, payload = {}) => api(action, payload, lifetime.current.signal)
  const receiveBases = items => {
    setBases(items)
    setSelected(current => items.some(item => item.id === current) ? current : items[0]?.id ?? null)
  }
  const refresh = async () => {
    setListed(false)
    const connection = await call('status')
    if (lifetime.current.signal.aborted) return
    setStatus(connection)
    if (connection.configured) {
      const value = await call('bases')
      if (!lifetime.current.signal.aborted) { receiveBases(value.items); setListed(true) }
    } else { setBases([]); setSelected(null) }
  }
  useEffect(() => {
    let active = true
    refresh().catch(cause => { if (active) setError(cause.message) }).finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [api])
  async function operate(operation) {
    setBusy(true); setError('')
    try { await operation() } catch (cause) { if (!lifetime.current.signal.aborted) setError(cause.message) }
    finally { if (!lifetime.current.signal.aborted) setBusy(false) }
  }
  const start = item => {
    setEditor({ item }); setDeleting(null); setModelError('')
    if (!item) void call('models').then(value => { if (!lifetime.current.signal.aborted) setModels(value.items) }).catch(cause => { if (!lifetime.current.signal.aborted) setModelError(cause.message) })
  }
  const save = payload => operate(async () => {
    const value = await call('saveBase', payload)
    if (lifetime.current.signal.aborted) return
    setEditor(null); await refresh()
    if (value.item?.id && !lifetime.current.signal.aborted) setSelected(value.item.id)
  })
  const remove = () => operate(async () => {
    await call('deleteBase', { baseId: deleting.id })
    if (lifetime.current.signal.aborted) return
    setDeleting(null); await refresh()
  })
  const base = bases.find(item => item.id === selected)
  return <main className="seal-kb-page" aria-busy={loading || busy}>
    <header className="seal-kb-header"><div><h1>知识库</h1><p>管理文档与索引，在对话中检索引用</p></div><div className="seal-kb-actions"><button type="button" className="seal-kb-icon-button" aria-label="刷新" title="刷新" disabled={busy || loading} onClick={() => void operate(refresh)}><ActionIcon /></button><button type="button" className="seal-kb-icon-button" aria-label="知识库设置" title="知识库设置" onClick={() => setSettings(true)}><ActionIcon settings /></button><button className="primary" disabled={busy || !status?.configured} onClick={() => start(null)}>新建知识库</button></div></header>
    {error && <p className="seal-kb-error" role="alert">{error}<button onClick={() => void operate(refresh)} disabled={busy}>重试</button></p>}
    {loading ? <p className="seal-kb-empty" role="status">正在读取知识库连接…</p> : !status?.configured ? <section className="seal-kb-empty"><h2>连接你的知识库</h2><p>先在设置 → WeKnora 中填写 API 地址和 Key。已有检索工具与此页面共用当前本地账号的连接。</p><button onClick={openConnection}>打开连接设置</button></section> : <div className="seal-kb-columns">
      <aside className="seal-kb-bases" aria-label="知识库列表">{bases.map(item => <button key={item.id} disabled={busy} aria-current={item.id === selected ? 'page' : undefined} onClick={() => { setSelected(item.id); setEditor(null); setDeleting(null) }}><strong>{item.name}</strong><small>{item.description || '文档知识库'}</small></button>)}{!bases.length && <p>{listed ? '当前 Key 可见范围内还没有知识库。' : '尚未取得知识库列表。'}</p>}</aside>
      <div className="seal-kb-body">{editor ? <BaseEditor key={editor.item?.id ?? 'new'} item={editor.item} models={models} modelError={modelError} busy={busy} save={save} close={() => setEditor(null)} /> : deleting ? <DeleteConfirmation base label={deleting.name} busy={busy} remove={() => void remove()} close={() => setDeleting(null)} /> : base ? <><div className="seal-kb-base-actions"><button disabled={busy} onClick={() => start(base)}>编辑知识库</button><button className="danger" disabled={busy} onClick={() => setDeleting(base)}>删除知识库</button></div><BaseWorkspace key={base.id} base={base} api={api} /></> : <section className="seal-kb-empty"><h2>{listed ? '开始积累知识' : '等待知识库连接'}</h2><p>{listed ? '新建知识库，选择服务端向量模型，再上传文件或导入文本。' : '未能取得服务端列表。请检查连接和权限后刷新。'}</p></section>}</div>
    </div>}
    {settings && <div className="seal-kb-settings-mask"><KnowledgeSettings status={status} close={() => setSettings(false)} openConnection={() => { setSettings(false); openConnection() }} /></div>}
  </main>
}
