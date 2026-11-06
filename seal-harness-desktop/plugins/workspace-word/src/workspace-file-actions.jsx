import React, { useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { WorkspaceFileRowActions } from './workspace-file-row-actions.jsx'

const formats = [
  { kind: 'docx', label: 'Word 文档' },
  { kind: 'xlsx', label: 'Excel 表格' },
  { kind: 'pptx', label: 'PowerPoint 演示' },
]

function destination(directory, name) {
  if (!name || name === '.' || name === '..' || /[\\/:*?"<>|\x00-\x1f]/u.test(name))
    throw new Error('请输入不含路径或特殊字符的文件名。')
  const separator = directory.includes('\\') ? '\\' : '/'
  return directory.replace(/[\\/]$/u, '') + separator + name
}

function encode(bytes) {
  let binary = ''
  for (let offset = 0; offset < bytes.length; offset += 16384)
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 16384))
  return btoa(binary)
}

export function WorkspaceFileActions({ sessionId, absolutePath, api, onOpen, onPreview }) {
  const [creating, setCreating] = useState(false)
  const [kind, setKind] = useState('docx')
  const [name, setName] = useState('新建文档')
  const [content, setContent] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const fileInput = useRef(null)
  const hostRef = useRef(null)

  if (!sessionId || !absolutePath) return null

  async function create(event) {
    event.preventDefault()
    if (busy) return
    setBusy(true)
    setError('')
    try {
      const fileName = name.trim().replace(/\.(docx|xlsx|pptx)$/iu, '') + '.' + kind
      const path = destination(absolutePath, fileName)
      const result = await api('create', { sessionId, path, content })
      setCreating(false)
      setContent('')
      setNotice(result.status === 'createdNotOpened'
        ? `已在工作区创建 ${fileName}，请从文件树重新打开。`
        : `已在工作区创建 ${fileName}。`)
      if (result.status !== 'createdNotOpened') onOpen({ sessionId, path })
    } catch (cause) { setError(cause.message) }
    finally { setBusy(false) }
  }

  async function importFile(event) {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file || busy) return
    if (!/\.(docx|xlsx|pptx)$/iu.test(file.name)) { setError('请选择 DOCX、XLSX 或 PPTX 文件。'); return }
    if (file.size > 64 * 1024 * 1024) { setError('文件不得超过 64 MiB。'); return }
    setBusy(true)
    setError('')
    try {
      const path = destination(absolutePath, file.name)
      const result = await api('import', { sessionId, path, data: encode(new Uint8Array(await file.arrayBuffer())) })
      setNotice(result.status === 'createdNotOpened'
        ? `已导入 ${file.name}，请从文件树重新打开。`
        : `已导入 ${file.name} 到工作区。`)
      if (result.status !== 'createdNotOpened') onOpen({ sessionId, path })
    } catch (cause) { setError(cause.message) }
    finally { setBusy(false) }
  }

  async function runFileAction(action, path) {
    if (busy) return
    setBusy(true)
    setError('')
    try {
      const result = await api(action, { sessionId, path })
      if (action === 'saveCopy' && !result.cancelled) setNotice(`已保存到 ${result.path}`)
      if (action === 'trash') {
        setNotice('文件已移到回收站。')
        hostRef.current?.closest('[data-files-state="tree"]')?.querySelector('[data-files-reload]')?.click()
      }
    } catch (cause) { setError(cause.message) }
    finally { setBusy(false) }
  }

  return <div ref={hostRef} className="seal-workspace-office-file-actions">
    <WorkspaceFileRowActions hostRef={hostRef} busy={busy} onPreview={path => onPreview({ sessionId, path })} onOpen={path => onOpen({ sessionId, path })} run={runFileAction} />
    <button type="button" className="seal-workspace-office-file-action" aria-label="新建 Office 文档" title="新建 Office 文档（Word、Excel、PPT）" disabled={busy} onClick={() => { setError(''); setCreating(true) }}>
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M13 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V10l-7-7Z" /><path d="M13 3v7h7M12 13v6M9 16h6" /></svg>
    </button>
    <button type="button" className="seal-workspace-office-file-action" aria-label="导入 Office 文档" title="导入 Office 文档（DOCX、XLSX、PPTX）" disabled={busy} onClick={() => fileInput.current?.click()}>
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 3v12m-4-4 4 4 4-4M4 17v3h16v-3" /></svg>
    </button>
    <input ref={fileInput} type="file" accept=".docx,.xlsx,.pptx" hidden onChange={event => void importFile(event)} />
    {notice && <span role="status" className="seal-workspace-office-file-notice">{notice}</span>}
    {(creating || error) && createPortal(<div className="seal-workspace-office-dialog-backdrop" onMouseDown={event => {
      if (event.target === event.currentTarget && !busy) { setCreating(false); setError('') }
    }}>
      <section role="dialog" aria-modal="true" aria-label={creating ? '在工作区新建 Office 文档' : 'Office 文件操作'} className="seal-workspace-office-dialog">
        <header><h2>{creating ? '在工作区新建 Office 文档' : 'Office 文件操作'}</h2><button type="button" aria-label="关闭" disabled={busy} onClick={() => { setCreating(false); setError('') }}>×</button></header>
        {error && <p role="alert" className="seal-workspace-office-dialog-error">{error}</p>}
        {creating && <form onSubmit={event => void create(event)}>
          <label>格式<select value={kind} disabled={busy} onChange={event => setKind(event.target.value)}>{formats.map(item => <option key={item.kind} value={item.kind}>{item.label}</option>)}</select></label>
          <label>文件名<input required maxLength={120} value={name} disabled={busy} onChange={event => setName(event.target.value)} /></label>
          <label>初始内容（选填）<textarea rows={5} value={content} disabled={busy} onChange={event => setContent(event.target.value)} /></label>
          <p>文件将创建在当前工作区目录；同名文件不会被覆盖。</p>
          <footer><button type="button" disabled={busy} onClick={() => setCreating(false)}>取消</button><button type="submit" disabled={busy || !name.trim()}>{busy ? '创建中…' : '创建'}</button></footer>
        </form>}
      </section>
    </div>, document.body)}
  </div>
}
