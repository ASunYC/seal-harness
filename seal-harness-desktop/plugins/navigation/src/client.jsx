import React, { useEffect, useState, useSyncExternalStore } from 'react'
import { createNavigationState } from './model.js'
import { styles } from './styles.js'

export const inject = ['slots', 'layout', 'workspaces', 'uiWorkspace']

const HOME = 'seal-harness-home'
const SPACES = 'seal-harness-spaces'
const SCHEDULES = 'seal-harness-schedules'

function NavGlyph({ name, size = 20 }) {
  const paths = {
    home: <><path d="m3 10 9-7 9 7v10H3V10Z" /><path d="M9 20v-7h6v7" /></>,
    conversation: <><path d="M4 4h16v13H8l-4 3V4Z" /><path d="M8 9h8M8 13h5" /></>,
    spaces: <><path d="M3 7V5h7l2 2h9v12a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Z" /></>,
    schedules: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>,
    experts: <><rect x="4" y="7" width="16" height="13" rx="2" /><path d="M9 7V4h6v3M9 12h.01M15 12h.01M9 16h6" /></>,
    skills: <><path d="m12 2 9 5v10l-9 5-9-5V7l9-5Z" /><path d="m3 7 9 5 9-5M12 12v10" /></>,
    connectors: <><path d="M8 3v5m8-5v5M6 8h12v5a6 6 0 0 1-12 0V8Zm6 11v3" /></>,
    plugins: <><path d="M9 3h6v4a2 2 0 1 0 2 2h4v6h-4a2 2 0 1 0-2 2v4H9v-4a2 2 0 1 0-2-2H3V9h4a2 2 0 1 0 2-2V3Z" /></>,
  }
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>
}

export function apply(ctx) {
  const resources = createNavigationState()
  ctx.provide('sealHarnessNavigation', resources)
  ctx.effect(() => () => resources.dispose(), 'seal-harness: navigation state')
  ctx.effect(() => resources.register({ id: 'plugins', label: '插件', order: 60, icon: 'plugins', description: '管理桌面插件和扩展', Panel() { return null } }), 'seal-harness: plugin manager home entry')
  ctx.effect(() => {
    const element = document.createElement('style')
    element.dataset.plugin = '@seal-harness/navigation'
    element.textContent = styles
    document.head.append(element)
    return () => element.remove()
  }, 'seal-harness: navigation styles')

  function HomeMenu() {
    const { entries, selectedId } = useSyncExternalStore(resources.subscribe, resources.getSnapshot)
    const open = id => { resources.select(id); ctx.layout.selectPanel(id === null ? null : id === 'plugins' ? 'plugins' : HOME) }
    return <nav className="seal-nav-secondary" aria-label="首页二级菜单">
      <header><span>SEAL HARNESS</span><h2>首页</h2></header>
      <button type="button" aria-current={selectedId === null ? 'page' : undefined} onClick={() => open(null)}><NavGlyph name="conversation" size={18} />会话</button>
      {entries.map(entry => <button key={entry.id} type="button" aria-current={selectedId === entry.id ? 'page' : undefined} onClick={() => open(entry.id)}><NavGlyph name={entry.icon} size={18} />{entry.label}</button>)}
    </nav>
  }

  function TasksMenu() {
    return <nav className="seal-nav-secondary" aria-label="定时任务二级菜单"><header><span>SEAL HARNESS</span><h2>定时任务</h2></header><p className="seal-nav-secondary__empty">定时任务尚未开放。</p></nav>
  }

  function ResourceTabs({ className }) {
    const { entries, selectedId } = useSyncExternalStore(resources.subscribe, resources.getSnapshot)
    const open = id => { resources.select(id); ctx.layout.selectPanel(id === null ? null : id === 'plugins' ? 'plugins' : HOME) }
    return <nav className={className} aria-label="首页资源导航"><button type="button" aria-current={selectedId === null ? 'page' : undefined} onClick={() => open(null)}>会话</button>{entries.map(entry => <button key={entry.id} type="button" aria-current={selectedId === entry.id ? 'page' : undefined} onClick={() => open(entry.id)}>{entry.label}</button>)}</nav>
  }

  function Rail({ usePanelInfo }) {
    const activePanelId = usePanelInfo(info => info.activePanelId)
    useEffect(() => { if (activePanelId === null) resources.select(null) }, [activePanelId])
    useEffect(() => {
      if (activePanelId !== null && activePanelId !== HOME && activePanelId !== 'plugins' && activePanelId !== SCHEDULES) return
      const Component = activePanelId === SCHEDULES ? TasksMenu : HomeMenu
      return ctx.slots.inject('sidebar.workspaces', () => ctx.slots.register({ name: 'sidebar.workspaces', priority: -100 }, Component))
    }, [activePanelId])
    const items = [
      { id: HOME, label: '首页', icon: 'home' },
      { id: SPACES, label: '空间', icon: 'spaces' },
      { id: SCHEDULES, label: '定时任务', icon: 'schedules' },
    ]
    return <><nav className="seal-nav-rail" aria-label="一级导航">
      {items.map(item => <button key={item.label} type="button" title={item.label} aria-label={item.label} aria-current={activePanelId === item.id || item.id === HOME && (activePanelId === null || activePanelId === 'plugins') ? 'page' : undefined} onClick={() => { if (item.id === HOME) resources.select(null); ctx.layout.selectPanel(item.id === HOME ? null : item.id) }}><NavGlyph name={item.icon} /></button>)}
    </nav>{activePanelId === 'plugins' && <ResourceTabs className="seal-nav-plugin-tabs" />}</>
  }

  function HomePanel() {
    const { entries, selectedId } = useSyncExternalStore(resources.subscribe, resources.getSnapshot)
    const selected = entries.find(entry => entry.id === selectedId)
    useEffect(() => { if (!selected) ctx.layout.selectPanel(null) }, [selected])
    return <div className="seal-nav-content" data-seal-nav-panel="home">
      <ResourceTabs className="seal-nav-compact-tabs" />
      {selected && <selected.Panel />}
    </div>
  }

  function SpacesPanel() {
    const snapshot = useSyncExternalStore(listener => ctx.workspaces.list.subscribe(listener), () => ctx.workspaces.list.getSnapshot())
    const [busy, setBusy] = useState(false), [error, setError] = useState('')
    const open = async workspaceId => {
      setBusy(true); setError('')
      try { await ctx.uiWorkspace.openWorkspace(workspaceId); ctx.layout.selectPanel(null) }
      catch (cause) { setError(cause.message) }
      finally { setBusy(false) }
    }
    const create = async () => {
      setBusy(true); setError('')
      try {
        const path = await ctx.uiWorkspace.pickDirectory()
        if (!path) return
        const workspace = await ctx.workspaces.create({ path })
        await ctx.uiWorkspace.openWorkspace(workspace.workspaceId)
        ctx.layout.selectPanel(null)
      } catch (cause) { setError(cause.message) }
      finally { setBusy(false) }
    }
    return <main className="seal-nav-page" data-seal-nav-panel="spaces"><p className="seal-nav-page__eyebrow">SEAL HARNESS / SPACES</p><div className="seal-nav-page__heading"><div><h1>空间</h1><p>沿用现有工作区和会话，不迁移目录或聊天记录。</p></div><button type="button" disabled={busy} onClick={create}>添加空间</button></div>{error && <p role="alert" className="seal-nav-page__error">{error}</p>}<div className="seal-nav-spaces-grid">{snapshot.items.map(item => <button key={item.workspaceId} type="button" disabled={busy} onClick={() => open(item.workspaceId)}><NavGlyph name="spaces" size={22} /><strong>{item.title || item.path}</strong><small>{item.path}</small><span>打开空间 →</span></button>)}{snapshot.items.length === 0 && <p className="seal-nav-page__empty">还没有空间。选择一个已有目录即可添加。</p>}</div></main>
  }

  function SchedulesPanel() {
    return <main className="seal-nav-page" data-seal-nav-panel="schedules"><p className="seal-nav-page__eyebrow">SEAL HARNESS / AUTOMATIONS</p><h1>定时任务</h1><p>让重复的工作有固定的节奏。</p><section className="seal-nav-page__empty"><NavGlyph name="schedules" size={30} /><h2>当前没有定时任务</h2><p>定时任务功能尚未开放，当前无法创建或执行任务。</p></section></main>
  }

  ctx.slots.inject('shell.overlay', () => ctx.slots.register({ name: 'shell.overlay', id: 'seal-harness-navigation', label: '一级导航' }, Rail))
  for (const [key, Component] of [[HOME, HomePanel], [SPACES, SpacesPanel], [SCHEDULES, SchedulesPanel]])
    ctx.slots.inject('main', () => ctx.slots.register({ name: 'main', key }, Component))
}
