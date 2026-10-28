import React, { useEffect, useRef, useState } from 'react'
import { DeleteConfirmation, TextEditor } from './editors.jsx'

const statusLabels = { pending: '等待解析', processing: '解析中', running: '处理中', completed: '已完成', failed: '失败', draft: '草稿', stopped: '已停止' }
const documentName = item => item.title || item.file_name || item.name || item.id

export function BaseWorkspace({ base, api }) {
  const [documents, setDocuments] = useState([]), [page, setPage] = useState(1), [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true), [busy, setBusy] = useState(false), [error, setError] = useState('')
  const [listed, setListed] = useState(false)
  const [textEditor, setTextEditor] = useState(false), [deleting, setDeleting] = useState(null), [reading, setReading] = useState(null)
  const [query, setQuery] = useState(''), [results, setResults] = useState(null)
  const lifetime = useRef(new AbortController()), fileInput = useRef(null)
  useEffect(() => { const controller = new AbortController(); lifetime.current = controller; return () => controller.abort() }, [])
  const call = (action, payload) => api(action, payload, lifetime.current.signal)
  const refresh = async () => {
    const value = await call('documents', { baseId: base.id, page, pageSize: 20 })
    if (!lifetime.current.signal.aborted) { setDocuments(value.items); setTotal(value.total); setListed(true) }
  }
  useEffect(() => {
    const controller = new AbortController()
    setLoading(true); setError('')
    api('documents', { baseId: base.id, page, pageSize: 20 }, controller.signal)
      .then(value => { if (!controller.signal.aborted) { setDocuments(value.items); setTotal(value.total); setListed(true) } })
      .catch(cause => { if (!controller.signal.aborted) setError(cause.message) })
      .finally(() => { if (!controller.signal.aborted) setLoading(false) })
    return () => controller.abort()
  }, [api, base.id, page])
  async function operate(operation) {
    setBusy(true); setError('')
    try { await operation() } catch (cause) { if (!lifetime.current.signal.aborted) setError(cause.message) }
    finally { if (!lifetime.current.signal.aborted) setBusy(false) }
  }
  const importText = payload => operate(async () => { await call('importText', { baseId: base.id, ...payload }); setTextEditor(false); await refresh() })
  const remove = () => operate(async () => { await call('deleteDocument', { documentId: deleting.id }); setDeleting(null); setReading(null); await refresh() })
  const read = item => operate(async () => { const value = await call('readDocument', { documentId: item.id }); if (!lifetime.current.signal.aborted) setReading(value) })
  async function upload(file) {
    if (!file) return
    await operate(async () => {
      if (!file.size || file.size > 16 * 1024 * 1024) throw new Error('请选择大小为 1 字节至 16 MiB 的文件。')
      const data = await new Promise((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = () => resolve(String(reader.result).split(',')[1]); reader.onerror = () => reject(new Error('文件读取失败。'))
        reader.readAsDataURL(file)
      })
      await call('upload', { baseId: base.id, fileName: file.name, mimeType: file.type || 'application/octet-stream', data })
      await refresh()
    })
    if (fileInput.current) fileInput.current.value = ''
  }
  const search = event => {
    event.preventDefault()
    void operate(async () => { const value = await call('search', { baseId: base.id, query }); if (!lifetime.current.signal.aborted) setResults(value.items) })
  }
  return <section className="seal-kb-workspace" aria-label="知识库内容" aria-busy={busy || loading}>
    <header><div><h2>{base.name}</h2><p>{base.description || '暂无说明'}</p></div><div className="seal-kb-actions">
      <button disabled={busy} onClick={() => void operate(refresh)}>刷新文档</button><button disabled={busy} onClick={() => setTextEditor(true)}>导入文本</button>
      <button disabled={busy} onClick={() => fileInput.current.click()}>上传文件</button><input ref={fileInput} hidden type="file" aria-label="上传知识文件" onChange={event => void upload(event.target.files?.[0])} />
    </div></header>
    {error && <p className="seal-kb-error" role="alert">{error}</p>}
    <form className="seal-kb-search" onSubmit={search}><input type="search" required maxLength={4000} placeholder="在当前知识库检索" aria-label="检索知识库" value={query} onChange={event => setQuery(event.target.value)} /><button disabled={busy} type="submit">检索</button>{results !== null && <button type="button" onClick={() => setResults(null)}>返回文档</button>}</form>
    {textEditor ? <TextEditor busy={busy} save={importText} close={() => setTextEditor(false)} /> : deleting ? <DeleteConfirmation label={documentName(deleting)} busy={busy} remove={() => void remove()} close={() => setDeleting(null)} /> : reading ? <article className="seal-kb-reader"><button onClick={() => setReading(null)}>关闭文档</button><h3>{documentName(reading.item)}</h3>{reading.chunks.map((chunk, index) => <pre key={chunk.id ?? index}>{chunk.content}</pre>)}{!reading.chunks.length && <p>尚无已解析内容，请检查文档处理状态。</p>}{reading.total > reading.chunks.length && <p className="seal-kb-muted">预览前 {reading.chunks.length} 个片段，共 {reading.total} 个。</p>}</article> : results !== null ? <div className="seal-kb-results">
      <h3>检索结果 · {results.length}</h3>{results.map((result, index) => <article key={result.id ?? index}><h4>{result.knowledge_title || result.title || '文档片段'}</h4><p>{result.content}</p><small>来源：{result.knowledge_title || result.knowledge_id || '服务端文档'}{Number.isFinite(result.score) ? ` · 相关度 ${result.score.toFixed(3)}` : ''}</small>{result.knowledge_id && <button disabled={busy} onClick={() => void read({ id: result.knowledge_id })}>查看来源文档</button>}</article>)}{!results.length && <p>没有检索到匹配内容。请确认文档索引已完成。</p>}
    </div> : <><div className="seal-kb-document-list"><div className="seal-kb-document-head"><strong>文档 · {listed ? total : '—'}</strong><small>导入后可刷新查看解析及索引状态</small></div>{loading ? <p role="status">正在读取文档…</p> : documents.map(item => <article key={item.id}><div><strong>{documentName(item)}</strong><small>{statusLabels[item.parse_status] || item.parse_status || '状态未提供'}{item.file_type ? ` · ${item.file_type}` : ''}</small>{item.error_message && <p className="seal-kb-error">{item.error_message}</p>}</div><div className="seal-kb-actions"><button disabled={busy} onClick={() => void read(item)}>查看</button><button disabled={busy} onClick={() => void operate(async () => { await call('reparse', { documentId: item.id }); await refresh() })}>重新解析</button><button disabled={busy} className="danger" onClick={() => setDeleting(item)}>删除</button></div></article>)}{!loading && !documents.length && <p className="seal-kb-empty">{listed ? '当前知识库还没有文档。上传文件或导入文本后，等待服务端完成索引。' : '尚未取得文档列表，请刷新重试。'}</p>}</div>
      <div className="seal-kb-pagination"><button disabled={page === 1 || busy} onClick={() => setPage(value => value - 1)}>上一页</button><span>第 {page} 页</span><button disabled={page * 20 >= total || busy} onClick={() => setPage(value => value + 1)}>下一页</button></div></>}
  </section>
}
