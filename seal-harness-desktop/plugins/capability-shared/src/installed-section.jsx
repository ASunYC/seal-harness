import React from 'react'
import { Icon } from './icons.jsx'

const MAX_ICONS = 8

/** A compact installed-resource row that keeps the full list available on demand. */
export function InstalledSection({ label, icons, loading, children }) {
  const visible = icons.slice(0, MAX_ICONS)
  return <details className="resource-installed">
    <summary className="resource-installed__summary" title={`展开或收起已安装${label}`}>
      <h2>已安装 <small>{loading ? '…' : icons.length}</small></h2>
      <span className="resource-installed__icons" aria-hidden="true">
        {visible.map(item => <span className="resource-installed__icon" key={item.key} title={item.label}>{item.icon}</span>)}
        {icons.length > MAX_ICONS && <span className="resource-installed__more">+{icons.length - MAX_ICONS}</span>}
        {!loading && icons.length === 0 && <span className="resource-installed__none">暂无</span>}
        {loading && <span className="resource-installed__none">读取中</span>}
      </span>
      <Icon name="chevron-down" size={16} className="resource-installed__chevron" />
    </summary>
    <div className="resource-installed__body">{children}</div>
  </details>
}
