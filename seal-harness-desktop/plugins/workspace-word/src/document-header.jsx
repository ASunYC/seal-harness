import React from 'react'

const formats = {
  docx: { symbol: 'W', label: 'Word 文档' },
  xlsx: { symbol: 'X', label: 'Excel 表格' },
  pptx: { symbol: 'P', label: '演示文档' },
}

export function DocumentHeader({ title, path, format, status, dirty, saving, canSave, canExport, onSave, onExport, onClose }) {
  const documentFormat = formats[format] ?? formats.docx
  return <header className="seal-workspace-word-header">
    <div className="seal-workspace-word-identity">
      <span className="seal-workspace-word-format" aria-hidden="true">{documentFormat.symbol}</span>
      <div className="seal-workspace-word-title"><span>{documentFormat.label}</span><h1 title={title}>{title}</h1></div>
    </div>
    <p className="seal-workspace-word-path" title={path}>{path}</p>
    <div className="seal-workspace-word-header-actions">
      <span className="seal-workspace-word-status" data-dirty={dirty || undefined} role="status">
        <span className="seal-workspace-word-status-dot" aria-hidden="true" />{dirty ? '未保存' : status}
      </span>
      <div className="seal-workspace-word-buttons">
        <span title={saving ? '正在保存文档' : canSave ? '保存修改' : '暂无待保存的修改'}>
          <button type="button" className="seal-workspace-word-save" aria-label={saving ? '保存中' : '保存文档'} disabled={!canSave} onClick={onSave}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M4 4h13l3 3v13H4zM8 4v6h8V4M7 20v-7h10v7" /></svg>
          </button>
        </span>
        <span title={canExport ? '导出文档副本' : '请先保存修改，再导出文档'}>
          <button type="button" aria-label="导出文档" disabled={!canExport} onClick={onExport}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 3v12m-4-4 4 4 4-4M4 18v3h16v-3" /></svg>
          </button>
        </span>
        <span title="关闭文档">
          <button type="button" className="seal-workspace-word-close" aria-label="关闭文档" onClick={onClose}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" aria-hidden="true"><path d="M5 5l14 14M19 5 5 19" /></svg>
          </button>
        </span>
      </div>
    </div>
  </header>
}
