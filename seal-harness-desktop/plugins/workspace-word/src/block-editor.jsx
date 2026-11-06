import React, { useEffect, useRef, useState } from 'react'
import { DocumentHeader } from './document-header.jsx'
import { PptxPreview } from './pptx-preview.jsx'
import { XlsxPreview } from './xlsx-preview.jsx'

function downloadFile(name, base64) {
  const bytes = Uint8Array.from(atob(base64), character => character.charCodeAt(0))
  const url = URL.createObjectURL(new Blob([bytes], { type: 'application/octet-stream' }))
  const link = document.createElement('a')
  link.href = url
  link.download = name
  link.click()
  setTimeout(() => URL.revokeObjectURL(url), 0)
}

function groupedBlocks(blocks) {
  const groups = new Map()
  for (const block of blocks ?? []) {
    let location
    try { location = JSON.parse(block.id) } catch { location = [] }
    const group = String(location[0] ?? '其他')
    if (!groups.has(group)) groups.set(group, [])
    groups.get(group).push({ ...block, address: String(location[1] ?? '') })
  }
  return [...groups].map(([name, items]) => ({ name, items }))
}

function sheetGrid(items) {
  const columns = [...new Set(items.map(item => /^([A-Z]+)([1-9]\d*)$/iu.exec(item.address)?.[1] ?? item.address))]
    .sort((left, right) => left.length - right.length || left.localeCompare(right))
  const rows = new Map()
  for (const item of items) {
    const match = /^([A-Z]+)([1-9]\d*)$/iu.exec(item.address)
    const row = match?.[2] ?? '其他'
    if (!rows.has(row)) rows.set(row, new Map())
    rows.get(row).set(match?.[1] ?? item.address, item)
  }
  return { columns, rows: [...rows].sort(([left], [right]) => Number(left) - Number(right)) }
}

function Cell({ block, changes, setChanges, disabled }) {
  return <textarea aria-label={block.label} value={changes[block.id] ?? block.text} disabled={disabled || !block.editable}
    onChange={event => setChanges(current => ({ ...current, [block.id]: event.target.value }))} />
}

export function BlockEditor({ target, api, close, setDirty }) {
  const [opened, setOpened] = useState(null)
  const [changes, setChanges] = useState({})
  const [status, setStatus] = useState('正在读取文档…')
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const [selectedSheet, setSelectedSheet] = useState('')
  const [selectedSlide, setSelectedSlide] = useState(0)
  const [editingSheet, setEditingSheet] = useState(false)
  const lease = useRef(null)
  const changesRef = useRef(changes)
  changesRef.current = changes
  useEffect(() => setDirty(Object.keys(changes).length > 0), [changes, setDirty])

  useEffect(() => {
    const controller = new AbortController()
    void api('open', target, controller.signal).then(value => {
      lease.current = value.leaseId
      if (controller.signal.aborted) { void api('close', { leaseId: value.leaseId }).catch(() => {}); return }
      setOpened(value)
      setSelectedSlide(0)
      setStatus('已装载 · 修改仅保存在本机工作区')
    }).catch(cause => { if (!controller.signal.aborted) { setError(cause.message); setStatus('装载失败') } })
    return () => {
      controller.abort()
      const leaseId = lease.current
      lease.current = null
      if (leaseId) void api('close', { leaseId }).catch(() => {})
    }
  }, [target.sessionId, target.path, api])

  const save = async () => {
    if (!lease.current || !opened || saving) return
    const updates = Object.entries(changesRef.current).map(([id, text]) => ({ id, text }))
    if (!updates.length) return
    setSaving(true)
    setError('')
    try {
      const result = await api('edit', { leaseId: lease.current, updates })
      setOpened(current => ({ ...current, view: result.view ?? current.view, data: result.data ?? current.data }))
      setChanges(current => {
        const next = { ...current }
        for (const { id, text } of updates) if (next[id] === text) delete next[id]
        return next
      })
      setStatus('已保存到工作区')
    } catch (cause) { setError(cause.message) }
    finally { setSaving(false) }
  }
  const leave = () => {
    if (Object.keys(changes).length && !window.confirm('当前文档尚未保存。要放弃修改并关闭吗？')) return
    close()
  }
  const download = async () => {
    if (!lease.current) return
    setError('')
    try {
      const result = await api('download', { leaseId: lease.current })
      downloadFile(result.name, result.base64)
    } catch (cause) { setError(cause.message) }
  }
  const view = opened?.view
  const groups = groupedBlocks(view?.blocks)
  const activeSheet = groups.find(group => group.name === selectedSheet) ?? groups[0]
  const grid = editingSheet && activeSheet ? sheetGrid(activeSheet.items) : null
  const activeSlide = groups.find(group => Number(group.name) === selectedSlide)
  const dirty = Object.keys(changes).length > 0
  return <div className="seal-workspace-word-editor">
    <DocumentHeader title={opened?.displayName ?? '办公文档'} path={target.path} format={view?.kind ?? 'xlsx'}
      status={status} dirty={dirty} saving={saving} canSave={Boolean(opened) && dirty && !saving}
      canExport={Boolean(opened) && !dirty && !saving} onSave={() => void save()}
      onExport={() => void download()} onClose={leave} />
    {error && <p className="seal-workspace-word-error" role="alert">{error}</p>}
    {view && <div className={`seal-workspace-word-blocks${view.kind === 'pptx' ? ' seal-workspace-word-blocks--pptx' : ''}${view.kind === 'xlsx' ? ' seal-xlsx-workspace' : ''}`}>
      {view.kind === 'xlsx' && <div className="seal-xlsx-actions">
        <span>{editingSheet ? '编辑已有单元格' : dirty ? '预览 · 已保存版本' : '表格预览'}</span>
        <button type="button" disabled={saving || view.readOnly} title={view.readOnlyReason} onClick={() => setEditingSheet(value => !value)}>
          {editingSheet ? '返回预览' : '编辑单元格'}
        </button>
      </div>}
      {view.readOnly && <p className="seal-workspace-word-block-note">{view.readOnlyReason ?? '此文档为只读'}</p>}
      {view.kind === 'xlsx' ? editingSheet ? <div className="seal-xlsx-edit">
        <p className="seal-workspace-word-block-note">以 = 开头可编辑公式。保存后可返回预览查看结果。</p>
        <nav className="seal-workspace-word-sheets" aria-label="工作表">{groups.map(group =>
          <button key={group.name} type="button" aria-current={group === activeSheet ? 'page' : undefined}
            onClick={() => setSelectedSheet(group.name)}>{group.name}</button>)}</nav>
        {grid && <div className="seal-workspace-word-sheet-scroll"><table className="seal-workspace-word-sheet"><thead><tr><th scope="col">#</th>
          {grid.columns.map(column => <th scope="col" key={column}>{column}</th>)}</tr></thead><tbody>
          {grid.rows.map(([row, cells]) => <tr key={row}><th scope="row">{row}</th>
            {grid.columns.map(column => <td key={column}>{cells.has(column)
              ? <Cell block={cells.get(column)} changes={changes} setChanges={setChanges} disabled={view.readOnly || saving} /> : null}</td>)}
          </tr>)}
        </tbody></table></div>}
        {!grid && <p className="seal-workspace-word-block-note">工作簿中没有已有单元格可编辑。</p>}
      </div> : <XlsxPreview base64={opened.data} selectedSheet={selectedSheet} onSheetChange={setSelectedSheet} /> : view.kind === 'pptx' ? <>
        <PptxPreview base64={opened.data} index={selectedSlide} onSelect={setSelectedSlide} />
        <details className="seal-pptx-edit-pane">
          <summary>编辑第 {selectedSlide + 1} 页文字</summary>
          <div className="seal-pptx-edit-content">
            <p className="seal-workspace-word-block-note">修改文字后点击右上角保存；复杂排版和媒体将保留原样。</p>
            {activeSlide?.items.map(block => <label className="seal-workspace-word-block" key={block.id}><span>{block.label} · 文本框 {block.address}</span>
              <Cell block={block} changes={changes} setChanges={setChanges} disabled={view.readOnly || saving} /></label>)}
            {!activeSlide?.items.length && <p className="seal-workspace-word-block-note">这一页没有可编辑的文字。</p>}
          </div>
        </details>
      </> : null}
      {view.truncated && (view.kind !== 'xlsx' || editingSheet) && <p className="seal-workspace-word-block-note">仅显示前 {view.blocks.length} 项，共 {view.totalBlocks} 项。</p>}
    </div>}
  </div>
}
