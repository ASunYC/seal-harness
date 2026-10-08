import React, { useEffect, useSyncExternalStore } from 'react'
import { createNavigationState } from './model.js'
import { styles } from './styles.js'

export const inject = ['slots', 'layout', 'sessions']

const HOME = 'seal-harness-home'
const DECISION = 'ask-jev'
const SPACES = 'seal-harness-spaces'
const SCHEDULES = 'seal-harness-schedules'

function NavGlyph({ name, size = 20 }) {
  const paths = {
    home: <><path d="m3 10 9-7 9 7v10H3V10Z" /><path d="M9 20v-7h6v7" /></>,
    decision: <><path d="M12 21v-8M12 13 6 7m6 6 6-6" /><circle cx="5" cy="6" r="1.5" /><circle cx="19" cy="6" r="1.5" /></>,
    spaces: <><path d="M3 7V5h7l2 2h9v12a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Z" /></>,
    schedules: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>,
    experts: <><rect x="4" y="7" width="16" height="13" rx="2" /><path d="M9 7V4h6v3M9 12h.01M15 12h.01M9 16h6" /></>,
    skills: <><path d="m12 2 9 5v10l-9 5-9-5V7l9-5Z" /><path d="m3 7 9 5 9-5M12 12v10" /></>,
    connectors: <><path d="M8 3v5m8-5v5M6 8h12v5a6 6 0 0 1-12 0V8Zm6 11v3" /></>,
    plugins: <><path d="M9 3h6v4a2 2 0 1 0 2 2h4v6h-4a2 2 0 1 0-2 2v4H9v-4a2 2 0 1 0-2-2H3V9h4a2 2 0 1 0 2-2V3Z" /></>,
    settings: <><circle cx="12" cy="12" r="3" /><path d="M10 2h4l.6 2.3 1.7 1 2.3-.7 2 3.4-1.7 1.7v2l1.7 1.7-2 3.4-2.3-.7-1.7 1L14 20h-4l-.6-2.3-1.7-1-2.3.7-2-3.4 1.7-1.7v-2L3.4 8.6l2-3.4 2.3.7 1.7-1L10 2Z" /></>,
    account: <><circle cx="12" cy="7" r="4" /><path d="M4 22v-3a8 8 0 0 1 16 0v3" /></>,
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

  function EmptyMenu() { return null }

  function TasksMenu() {
    return <nav className="seal-nav-secondary" aria-label="定时任务二级菜单"><header><span>SEAL HARNESS</span><h2>定时任务</h2></header><p className="seal-nav-secondary__empty">定时任务尚未开放。</p></nav>
  }

  function Rail({ usePanelInfo }) {
    const activePanelId = usePanelInfo(info => info.activePanelId)
    const { entries, decisionSessionId, decisionActive } = useSyncExternalStore(resources.subscribe, resources.getSnapshot)
    const sessions = useSyncExternalStore(ctx.sessions.list.subscribe, ctx.sessions.list.getSnapshot)
    const mainSessionId = Object.values(sessions.byId).find(session => (session.retainedBy?.mainView ?? 0) > 0)?.id
    const inDecisionConversation = activePanelId === null && decisionActive && mainSessionId === decisionSessionId
    const homeEntries = entries.filter(entry => entry.id !== DECISION)
    const decision = entries.find(entry => entry.id === DECISION)
    const homeActive = (activePanelId === null && !inDecisionConversation) || activePanelId === HOME || activePanelId === 'plugins' || homeEntries.some(entry => entry.id === activePanelId)
    const resourceIds = entries.map(entry => entry.id).join('|')
    useEffect(() => {
      if (activePanelId === null) resources.select(null)
      else if (entries.some(entry => entry.id === activePanelId)) resources.select(activePanelId)
    }, [activePanelId, entries])
    useEffect(() => { if (activePanelId === DECISION && !decision) ctx.layout.selectPanel(null) }, [activePanelId, decision])
    useEffect(() => {
      if (activePanelId === null && decisionActive && mainSessionId && mainSessionId !== decisionSessionId) resources.leaveDecision()
    }, [activePanelId, decisionActive, decisionSessionId, mainSessionId])
    useEffect(() => {
      const releases = entries.filter(entry => entry.id !== 'plugins').map(entry => ctx.slots.inject('main', () => ctx.slots.register(
        { name: 'main', key: entry.id },
        () => <div className="seal-nav-content"><entry.Panel /></div>,
      )))
      return () => releases.forEach(release => release?.())
    }, [resourceIds])
    useEffect(() => {
      if (!homeActive) return
      const releases = homeEntries.map(entry => ctx.slots.inject('sidebar.panellist', () => ctx.slots.register(
          { name: 'sidebar.panellist', id: entry.id, order: entry.order, label: entry.label, priority: -100 },
          ({ size }) => <NavGlyph name={entry.icon} size={size} />,
      )))
      return () => releases.forEach(release => release?.())
    }, [homeActive, resourceIds])
    useEffect(() => {
      if (activePanelId !== DECISION && !inDecisionConversation && activePanelId !== SPACES && activePanelId !== SCHEDULES && activePanelId !== 'seal-harness-user') return
      const Component = activePanelId === SCHEDULES ? TasksMenu : EmptyMenu
      return ctx.slots.inject('sidebar.workspaces', () => ctx.slots.register({ name: 'sidebar.workspaces', priority: -100 }, Component))
    }, [activePanelId, inDecisionConversation])
    const items = [
      { id: HOME, label: '首页', icon: 'home' },
      ...(decision ? [{ id: DECISION, label: '问问决策', icon: 'decision' }] : []),
      { id: SPACES, label: '空间', icon: 'spaces' },
      { id: SCHEDULES, label: '定时任务', icon: 'schedules' },
    ]
    const activateExisting = (selector, label) => {
      const button = document.querySelector(selector)
      if (!button) throw new Error(`${label}入口未加载。`)
      button.click()
    }
    return <nav className="seal-nav-rail" aria-label="一级导航" data-home-active={homeActive}>
      {items.map(item => <button key={item.label} type="button" title={item.label} aria-label={item.label} aria-current={item.id === HOME ? homeActive ? 'page' : undefined : activePanelId === item.id || (item.id === DECISION && inDecisionConversation) ? 'page' : undefined} onClick={() => { if (item.id !== DECISION) resources.leaveDecision(); if (item.id === HOME) resources.select(null); else if (item.id === DECISION) resources.select(DECISION); ctx.layout.selectPanel(item.id === HOME ? null : item.id) }}><NavGlyph name={item.icon} /></button>)}
      <div className="seal-nav-rail__footer">
        <button type="button" title="设置" aria-label="设置" onClick={() => activateExisting('[data-slot="sidebar.settings"] button[aria-haspopup="dialog"]', '设置')}><NavGlyph name="settings" /></button>
        <button type="button" title="账户" aria-label="账户" aria-current={activePanelId === 'seal-harness-user' ? 'page' : undefined} onClick={() => activateExisting('.seal-harness-user-footer', '账户')}><NavGlyph name="account" /></button>
      </div>
    </nav>
  }

  function HomePanel() {
    const { entries, selectedId } = useSyncExternalStore(resources.subscribe, resources.getSnapshot)
    const selected = entries.find(entry => entry.id === selectedId)
    useEffect(() => { if (!selected) ctx.layout.selectPanel(null) }, [selected])
    return <div className="seal-nav-content" data-seal-nav-panel="home">
      {selected && <selected.Panel />}
    </div>
  }

  function SpacesPanel() {
    return <main className="seal-nav-page" data-seal-nav-panel="spaces"><h1>空间</h1><p>空间功能尚未开放。工作区和会话请在首页管理。</p></main>
  }

  function SchedulesPanel() {
    return <main className="seal-nav-page" data-seal-nav-panel="schedules"><p className="seal-nav-page__eyebrow">SEAL HARNESS / AUTOMATIONS</p><h1>定时任务</h1><p>让重复的工作有固定的节奏。</p><section className="seal-nav-page__empty"><NavGlyph name="schedules" size={30} /><h2>当前没有定时任务</h2><p>定时任务功能尚未开放，当前无法创建或执行任务。</p></section></main>
  }

  ctx.slots.inject('shell.overlay', () => ctx.slots.register({ name: 'shell.overlay', id: 'seal-harness-navigation', label: '一级导航' }, Rail))
  for (const [key, Component] of [[HOME, HomePanel], [SPACES, SpacesPanel], [SCHEDULES, SchedulesPanel]])
    ctx.slots.inject('main', () => ctx.slots.register({ name: 'main', key }, Component))
}
