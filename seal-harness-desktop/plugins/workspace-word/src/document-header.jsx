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
        <button type="button" className="seal-workspace-word-save" disabled={!canSave} onClick={onSave}>{saving ? '保存中…' : '保存'}</button>
        <button type="button" disabled={!canExport} onClick={onExport}>导出</button>
        <button type="button" onClick={onClose}>关闭</button>
      </div>
    </div>
  </header>
}
