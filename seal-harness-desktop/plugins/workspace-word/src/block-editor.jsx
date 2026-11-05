import React, { useEffect, useRef, useState } from 'react'
import { DocumentHeader } from './document-header.jsx'

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
      setOpened(current => ({ ...current, view: result.view ?? current.view }))
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
  const dirty = Object.keys(changes).length > 0
  return <div className="seal-workspace-word-editor">
    <DocumentHeader title={opened?.displayName ?? '办公文档'} path={target.path} format={view?.kind ?? 'xlsx'}
      status={status} dirty={dirty} saving={saving} canSave={Boolean(opened) && dirty && !saving}
      canExport={Boolean(opened) && !dirty && !saving} onSave={() => void save()}
      onExport={() => void download()} onClose={leave} />
    {error && <p className="seal-workspace-word-error" role="alert">{error}</p>}
    {view && <div className="seal-workspace-word-blocks">
      <p className="seal-workspace-word-block-note">结构化编辑仅支持文字与单元格内容；复杂排版、公式与媒体请用外部 Office 编辑。</p>
      {view.readOnly && <p className="seal-workspace-word-block-note">{view.readOnlyReason ?? '此文档为只读'}</p>}
      {view.kind === 'xlsx' ? <>
        <nav className="seal-workspace-word-sheets" aria-label="工作表">{groups.map(group =>
          <button key={group.name} type="button" aria-current={group === activeSheet ? 'page' : undefined}
            onClick={() => setSelectedSheet(group.name)}>{group.name}</button>)}</nav>
        {activeSheet && <div className="seal-workspace-word-sheet-scroll"><table className="seal-workspace-word-sheet"><thead><tr><th scope="col">#</th>
          {sheetGrid(activeSheet.items).columns.map(column => <th scope="col" key={column}>{column}</th>)}</tr></thead><tbody>
          {sheetGrid(activeSheet.items).rows.map(([row, cells]) => <tr key={row}><th scope="row">{row}</th>
            {sheetGrid(activeSheet.items).columns.map(column => <td key={column}>{cells.has(column)
              ? <Cell block={cells.get(column)} changes={changes} setChanges={setChanges} disabled={view.readOnly || saving} /> : null}</td>)}
          </tr>)}
        </tbody></table><p className="seal-workspace-word-block-note">以 = 开头可编辑公式；仅显示已有单元格。</p></div>}
      </> : view.kind === 'pptx' ? groups.map(group => <section className="seal-workspace-word-slide" key={group.name}>
        <h2>第 {Number(group.name) + 1} 页</h2>
        {group.items.map(block => <label className="seal-workspace-word-block" key={block.id}><span>{block.label} · 文本框 {block.address}</span>
          <Cell block={block} changes={changes} setChanges={setChanges} disabled={view.readOnly || saving} /></label>)}
      </section>) : null}
      {view.truncated && <p className="seal-workspace-word-block-note">仅显示前 {view.blocks.length} 项，共 {view.totalBlocks} 项。</p>}
    </div>}
  </div>
}
