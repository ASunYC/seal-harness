import React, { useEffect, useRef } from 'react'
import { Icon } from '../../capability-shared/src/icons.jsx'
import { DrawerResize } from '../../skills/src/files.jsx'

// 来源：Stratex SkillCatalogExperience / SkillPlatformCatalog，070ba39e82。
export function Tabs({ label, items, value, onChange, className = 'skill-catalog-primary-tabs', disabled }) {
  return <nav className={className} aria-label={label} role="tablist" onKeyDown={event => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
    const buttons = [...event.currentTarget.querySelectorAll('button')]
    const index = buttons.indexOf(event.target)
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : (index + (event.key === 'ArrowRight' ? 1 : -1) + buttons.length) % buttons.length
    event.preventDefault(); buttons[next]?.click(); buttons[next]?.focus()
  }}>{Object.entries(items).map(([key, text]) => <button key={key} type="button" role="tab" aria-selected={key === value} tabIndex={key === value ? 0 : -1} className={key === value ? 'is-active' : ''} disabled={disabled} onClick={() => onChange(key)}>{text}</button>)}</nav>
}

export function Overlay({ title, children, close, busy, drawer = false, onChange }) {
  const ref = useRef(null)
  useEffect(() => {
    const dialog = ref.current
    dialog.showModal()
    return () => dialog.close()
  }, [])
  return <dialog ref={ref} className={`store-overlay ${drawer ? 'is-drawer' : ''}`} aria-label={title} onChangeCapture={onChange} onCancel={event => { event.preventDefault(); if (!busy) close() }}>
    {drawer && <DrawerResize />}
    <header className="store-overlay-header"><strong>{title}</strong><button type="button" aria-label={`关闭${title}`} disabled={busy} onClick={close}><Icon name="close" size={16} /></button></header>
    {drawer ? <div className="store-drawer-body">{children}</div> : children}
  </dialog>
}

export function Catalog({ items, collection, scope, installed, busy, open, install }) {
  const groups = [['office', '办公类', '文档、数据与日常协作'], ['development', '开发类', '代码、测试与工程效率'], ['other', '其他', '更多团队能力']]
  const hasInstalled = item => installed.some(local => local.assetId === item.id || local.id === item.id || collection === 'center' && local.centerId === item.connectorId)
  return <div className="skill-platform-catalog">{groups.map(([category, title, description]) => {
    const group = items.filter(item => category === 'other' ? !['office', 'development'].includes(item.category) : item.category === category)
    return group.length > 0 && <section key={category} className="skill-platform-section" aria-label={title}>
      <header className="skill-platform-section__header"><h2>{title}</h2><span>{description}</span></header>
      <div className="skill-platform-grid">{group.map(item => {
        const installed = hasInstalled(item)
        const canInstall = collection === 'center' || scope !== 'mine' && !installed && item.latestVersion
        return <article className="skill-platform-row" key={item.id ?? item.connectorId}>
          <span className="skill-platform-row__icon"><Icon name="store" size={19} /></span>
          <button aria-label={`查看 ${item.name} 详情`} className="skill-platform-row__copy" disabled={busy} onClick={() => open(item)}>
            <span className="skill-platform-row__title"><strong>{item.name}</strong><span className={`skill-installation-label ${installed ? 'is-installed' : ''}`}>{installed && <Icon name="check" size={12} />}{installed ? '已安装' : '未安装'}</span></span>
            <span className="skill-platform-row__summary" title={item.summary}>{item.summary || '暂无描述'}</span>
          </button>
          <button className="skill-platform-row__action" disabled={busy || collection === 'center' && installed} aria-label={`${canInstall ? '安装' : '管理'} ${item.name}`} onClick={() => canInstall ? install(item) : open(item)}><Icon name={canInstall ? 'plus' : 'more'} size={16} /></button>
        </article>
      })}</div>
    </section>
  })}</div>
}
