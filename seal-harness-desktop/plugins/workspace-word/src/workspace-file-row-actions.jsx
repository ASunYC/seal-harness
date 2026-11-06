import React, { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'

const officeFile = /\.(?:docx|xlsx|pptx)$/iu

function Icon({ kind }) {
  if (kind === 'open') return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M4 7h16v12H4zM8 4h8M9 12l3 3 3-3" /></svg>
  if (kind === 'download') return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 3v12m-4-4 4 4 4-4M4 18v3h16v-3" /></svg>
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M4 7h16M9 7V4h6v3m3 0-1 14H7L6 7m4 4v6m4-6v6" /></svg>
}

function RowActions({ path, busy, onPreview, onOpen, run }) {
  const [menu, setMenu] = useState(false)
  const name = path.split(/[\\/]/u).at(-1)
  return <span className="seal-workspace-file-row-actions">
    <button type="button" aria-label={`打开方式 ${name}`} title="打开方式" disabled={busy} onClick={() => setMenu(value => !value)}><Icon kind="open" /></button>
    <button type="button" aria-label={`下载 ${name}`} title="下载文件" disabled={busy} onClick={() => void run('saveCopy', path)}><Icon kind="download" /></button>
    <button type="button" aria-label={`删除 ${name}`} title="移到回收站" disabled={busy} onClick={() => {
      if (window.confirm(`将“${name}”移到回收站？`)) void run('trash', path)
    }}><Icon kind="trash" /></button>
    {menu && <span className="seal-workspace-file-open-menu" role="menu" aria-label={`打开方式 ${name}`}>
      <button type="button" role="menuitem" onClick={() => { setMenu(false); if (officeFile.test(path)) onOpen(path); else onPreview(path) }}>{officeFile.test(path) ? '在右侧编辑' : '在右侧打开'}</button>
      <button type="button" role="menuitem" onClick={() => { setMenu(false); void run('openSystem', path) }}>用系统默认应用打开</button>
    </span>}
  </span>
}

// DSH 当前只公开文件树顶部工具栏 slot；在原生行节点旁挂载操作，不替换文件树。
export function WorkspaceFileRowActions({ hostRef, busy, onPreview, onOpen, run }) {
  const [rows, setRows] = useState([])
  useEffect(() => {
    const tree = hostRef.current?.closest('[data-files-state="tree"]')
    if (!tree) return
    const update = () => {
      const next = [...tree.querySelectorAll('li[data-files-entry="file"][data-files-path]')]
      setRows(previous => previous.length === next.length && previous.every((row, index) => row === next[index]) ? previous : next)
    }
    update()
    const observer = new MutationObserver(update)
    observer.observe(tree, { childList: true, subtree: true })
    return () => observer.disconnect()
  }, [hostRef])
  return rows.map(row => createPortal(<RowActions key={row.dataset.filesPath} path={row.dataset.filesPath} busy={busy} onPreview={onPreview} onOpen={onOpen} run={run} />, row))
}
