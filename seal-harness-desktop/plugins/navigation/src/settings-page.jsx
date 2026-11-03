import React, { useCallback, useLayoutEffect, useRef, useSyncExternalStore } from 'react'
import { settingsPageStyles } from './settings-page-styles.js'

export const SETTINGS_PANEL_ID = 'seal-harness-settings'

/** 原生设置仍拥有分类及表单；这里只暂存其授权的呈现回调。 */
export function createSettingsPresentationStore() {
  let current = null
  const listeners = new Set()
  const publish = () => { for (const listener of listeners) listener() }
  return {
    getSnapshot: () => current,
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener) },
    update(owner, presentation) { current = { ...presentation, owner }; publish() },
    clear(owner) {
      if (current === null || owner !== undefined && current.owner !== owner) return
      current = null; publish()
    },
  }
}

function selectedPanel(layout) { return layout.panelInfo.getSnapshot().activePanelId }

export function SettingsPageBridge({ channel, layout, usePanelInfo, ...presentation }) {
  const activePanelId = usePanelInfo(value => value.activePanelId)
  const owner = useRef({}).current
  const entered = useRef(false)
  const latest = useRef(presentation)
  latest.current = presentation
  const close = useCallback(() => {
    latest.current.onClose()
    if (selectedPanel(layout) === SETTINGS_PANEL_ID) layout.selectPanel(null)
  }, [layout])

  useLayoutEffect(() => {
    channel.update(owner, { ...presentation, close })
  }, [channel, owner, presentation.rows, presentation.activeId, presentation.onSelect, presentation.onClose,
    presentation.renderHeader, presentation.renderActions, presentation.renderSection, close])

  useLayoutEffect(() => {
    // 打开设置只导航一次；随后点击其他一级菜单时结束本次设置呈现。
    if (!entered.current) {
      entered.current = true
      if (selectedPanel(layout) !== SETTINGS_PANEL_ID) layout.selectPanel(SETTINGS_PANEL_ID)
    } else if (activePanelId !== SETTINGS_PANEL_ID) latest.current.onClose()
  }, [activePanelId, layout])

  useLayoutEffect(() => () => {
    channel.clear(owner)
    if (selectedPanel(layout) === SETTINGS_PANEL_ID) layout.selectPanel(null)
  }, [channel, layout, owner])
  return null
}

function SectionGlyph({ id }) {
  const monitor = id === 'computer-use' || id === 'desktop'
  return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {monitor ? <><rect x="3" y="4" width="18" height="13" rx="2" /><path d="M8 21h8m-4-4v4" /></> : <><circle cx="12" cy="12" r="3" /><path d="m9 3-.7 2.3-2 .9-2.3-.5-2 3.5 1.6 1.8v2l-1.6 1.8 2 3.5 2.3-.5 2 .9L9 21h6l.7-2.3 2-.9 2.3.5 2-3.5-1.6-1.8v-2L22 9.2l-2-3.5-2.3.5-2-.9L15 3Z" /></>}
  </svg>
}

export function SettingsMainPage({ channel }) {
  const presenter = useSyncExternalStore(channel.subscribe, channel.getSnapshot)
  const content = useRef(null)
  const ready = presenter !== null
  useLayoutEffect(() => {
    const element = content.current
    if (!element) return
    const update = width => {
      element.dataset.settingsWidth = width < 440 ? 'tight' : width < 720 ? 'narrow' : 'wide'
    }
    const style = element.ownerDocument.defaultView?.getComputedStyle(element)
    update(element.clientWidth - (parseFloat(style?.paddingLeft) || 0) - (parseFloat(style?.paddingRight) || 0))
    const Observer = element.ownerDocument.defaultView?.ResizeObserver
    if (!Observer) return
    const observer = new Observer(entries => {
      const entry = entries.find(item => item.target === element)
      if (entry) update(entry.contentRect.width)
    })
    observer.observe(element)
    return () => observer.disconnect()
  }, [ready])
  if (!presenter) return <main className="seal-settings-page" data-seal-settings-page><p role="status">正在打开设置…</p></main>
  const { rows, activeId, onSelect, renderHeader, renderActions, renderSection, close } = presenter
  const active = rows.find(row => row.id === activeId) ?? rows[0]
  return <main className="seal-settings-page" data-seal-settings-page>
    <header className="seal-settings-header"><h1>{renderHeader()}</h1><div className="seal-settings-actions">{renderActions()}</div></header>
    <div className="seal-settings-body">
      <nav className="seal-settings-nav" aria-label="设置分类">
        {rows.map(row => <button key={row.id} type="button" data-settings-section={row.id} aria-current={row.id === active?.id ? 'page' : undefined} onClick={() => onSelect(row.id)}><SectionGlyph id={row.id} /><span>{row.label}</span></button>)}
      </nav>
      <section ref={content} className="seal-settings-content" aria-label={active?.label ?? '设置内容'} data-settings-active={active?.id}>
        {active ? renderSection(active.id, close) : <p role="status">暂无可用的设置项。</p>}
      </section>
    </div>
  </main>
}

/** 公开 presentation 插槽由原生 shell 提供，回调保留其子 slot 的呈现权限。 */
export function registerSettingsPage(ctx) {
  const channel = createSettingsPresentationStore()
  function MainPage() { return <SettingsMainPage channel={channel} /> }
  function Bridge(props) { return <SettingsPageBridge {...props} channel={channel} layout={ctx.layout} /> }
  ctx.slots.inject('main', () => ctx.slots.register({ name: 'main', key: SETTINGS_PANEL_ID }, MainPage))
  ctx.slots.inject('settings.presentation', () => ctx.slots.register({ name: 'settings.presentation', priority: -100 }, Bridge))
  ctx.effect(() => {
    const element = document.createElement('style')
    element.dataset.plugin = 'seal-harness-settings-page'
    element.textContent = settingsPageStyles
    document.head.append(element)
    return () => element.remove()
  }, 'seal-harness: settings page styles')
  ctx.effect(() => () => {
    channel.getSnapshot()?.onClose()
    channel.clear()
    if (selectedPanel(ctx.layout) === SETTINGS_PANEL_ID) ctx.layout.selectPanel(null)
  }, 'seal-harness: settings page lifetime')
  return channel
}
