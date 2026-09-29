import React, { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react'
import type { Context } from '@deepseek-ai/cordis'
import type { MainPanelId } from '@deepseek-ai/dsh-client-ui-layout/client'
import type { ConnectionHandle } from '@deepseek-ai/dsh-client-connection/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type {} from '@deepseek-ai/dsh-client-ui-workspace/client'
import { createPortal } from 'react-dom'
import { AnimatedSidebarIcon } from '../../capability-shared/src/sidebar-icons.jsx'
import type { PropsRenderSlots, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { mountProjectConversation, ProjectConversationContent, type ConversationMount } from './conversation'
import { z } from 'zod'
import { createProjectBridge } from './bridge'
import type { ProjectUIRuntime } from './ui/runtime'
import { mountProjects } from './ui/mount'
import { clearPendingJoinCode, stashPendingJoinCode } from '../stratex/renderer/src/composables/projectJoinLinkInbox'

declare const __SEAL_HARNESS_PROJECT_CSS__: string

export const inject = ['slots', 'connection', 'layout', 'uiWorkspace', 'sessions', 'conversation']
const eventSchema = z.object({ channel: z.string(), payload: z.unknown() })
const accountSchema = z.object({ accountId: z.string().nullable(), epoch: z.number() })
const projectsPanel = 'seal-harness-projects' as MainPanelId
const identityPanel = 'seal-harness-identity' as MainPanelId

function ConversationView({ mount, active, SessionProvider, renderSlot }: PropsRenderSlots<'seal-harness.project.conversation'> & { mount: ConversationMount, active: boolean }) {
  useLayoutEffect(() => mount.retainView(), [mount])
  // 隐藏的项目页保留会话引用，但让出原生编辑器的 DOM 挂载权。
  return active ? createPortal(
    <SessionProvider session={mount.reference}>{renderSlot('seal-harness.project.conversation', {})}</SessionProvider>,
    mount.target,
  ) : null
}

export function apply(ctx: Context): void {
  const connection: ConnectionHandle = ctx.get('connection', true)
  let snapshot: { api: ReturnType<typeof createProjectBridge> | null, accountId: string | null, notice: string, signedOut: boolean } = {
    api: null, accountId: null, notice: '正在连接项目…', signedOut: false,
  }
  const retainedHost = document.createElement('div')
  Object.assign(retainedHost.style, { display: 'flex', flex: '1', minWidth: '0', minHeight: '0' })
  const navigation: { projectId: string | null } = { projectId: null }
  let pendingProjectId: string | undefined
  const sidebarStates: ProjectUIRuntime['sidebarStates'] = new Map()
  const watchers = new Set<() => void>()
  const getSnapshot = () => snapshot
  const subscribe = (listener: () => void) => { watchers.add(listener); return () => { watchers.delete(listener) } }
  const publish = (next: typeof snapshot) => { snapshot = next; watchers.forEach(listener => listener()) }

  ctx.effect(() => {
    const listeners = new Map<string, Set<(payload: unknown) => void>>()
    const events = new EventSource(new URL('api/seal-harness-projects/events', document.baseURI))
    let account: string | undefined
    let controller = new AbortController()
    let stopNavigate = () => {}
    let stopJoin = () => {}
    const releaseAccount = () => {
      sidebarStates.clear()
      navigation.projectId = null
      controller.abort()
      stopNavigate()
      stopJoin()
      snapshot.api?.dispose()
      listeners.clear()
      clearPendingJoinCode()
      pendingProjectId = undefined
    }
    const changeAccount = (payload: unknown) => {
      const identity = accountSchema.parse(payload)
      const key = JSON.stringify(identity)
      if (account === key) return
      account = key
      releaseAccount()
      const { accountId } = identity
      if (accountId === null) {
        publish({ api: null, accountId, notice: '登录后查看和管理项目。', signedOut: true })
        return
      }
      controller = new AbortController()
      const signal = controller.signal
      const api = createProjectBridge({
        invoke: async (channel, payload) => {
          signal.throwIfAborted()
          const result = await connection.rpc.call('/api', 'seal-harness-projects/invoke', { channel, payload }, signal)
          signal.throwIfAborted()
          if (!result.ok) throw new Error(result.error.message)
          return result.value
        },
        subscribe: (channel, listener) => {
          const set = listeners.get(channel) ?? new Set()
          set.add(listener)
          listeners.set(channel, set)
          return () => { set.delete(listener) }
        },
      })
      stopNavigate = api.onProjectNotificationNavigate(({ projectId }) => {
        pendingProjectId = projectId
        ctx.layout.selectPanel(projectsPanel)
      })
      stopJoin = api.onProjectJoinLink(({ code }) => {
        navigation.projectId = null
        stashPendingJoinCode(code)
        pendingProjectId = undefined
        ctx.layout.selectPanel(projectsPanel)
      })
      publish({ api, accountId, notice: '', signedOut: false })
    }
    events.onmessage = event => {
      try {
        const { channel, payload } = eventSchema.parse(JSON.parse(event.data))
        if (channel === 'project:account-changed') changeAccount(payload)
        else for (const listener of listeners.get(channel) ?? []) listener(payload)
      } catch (error) {
        publish({ ...snapshot, notice: error instanceof Error ? error.message : '项目消息无法读取。' })
      }
    }
    events.onerror = () => { if (account === undefined) publish({ ...snapshot, notice: '项目连接中断，正在重连…' }) }
    return () => { events.close(); releaseAccount(); publish({ api: null, accountId: null, notice: '', signedOut: false }) }
  }, 'seal-harness-projects: connection')

  function Panel({ active, SessionProvider, renderSlot }: PropsRenderSlots<'seal-harness.project.conversation'> & { active: boolean }) {
    const state = useSyncExternalStore(subscribe, getSnapshot)
    const host = useRef<HTMLDivElement>(null)
    const [error, setError] = useState('')
    const [retry, setRetry] = useState(0)
    const [conversation, setConversation] = useState<ConversationMount | null>(null)
    useEffect(() => {
      setError('')
      if (!host.current || !state.api || !state.accountId) return
      const lifetime = new AbortController()
      const initialProjectId = pendingProjectId
      pendingProjectId = undefined
      void mountProjects(host.current, {
        api: state.api, accountId: state.accountId, sidebarStates, navigation, css: __SEAL_HARNESS_PROJECT_CSS__,
        ...(initialProjectId ? { initialProjectId } : {}), signal: lifetime.signal,
        returnToConversation: async () => { ctx.layout.selectPanel(null) },
        mountConversation: (host, sessionId, signal) => mountProjectConversation(ctx, host, sessionId, signal, mount => {
          setConversation(mount)
          return () => { setConversation(current => current === mount ? null : current) }
        }),
      }).catch(error => {
        if (!lifetime.signal.aborted) setError(error instanceof Error ? error.message : '项目暂时无法打开。')
      })
      return () => lifetime.abort()
    }, [state.api, state.accountId, retry])
    return <section style={{ display: 'flex', flex: 1, minWidth: 0, minHeight: 0, flexDirection: 'column' }}>
      {(error || state.notice) && <p role="status">{error || state.notice}</p>}
      {error && <button type="button" onClick={() => setRetry(value => value + 1)}>重新加载项目</button>}
      {state.signedOut && <button type="button" onClick={() => ctx.layout.selectPanel(identityPanel)}>去登录</button>}
      {conversation && <ConversationView mount={conversation} active={active} SessionProvider={SessionProvider} renderSlot={renderSlot} />}
      <div ref={host} style={{ display: 'flex', flex: 1, minWidth: 0, minHeight: 0 }} />
    </section>
  }
  // main 会随导航卸载；常驻插槽持有 portal，主区域只接回同一个 DOM。
  function RetainedPanel(props: PropsRuntime<'shell.overlay'> & PropsRenderSlots<'seal-harness.project.conversation'>) {
    const active = props.usePanelInfo(info => info.activePanelId === projectsPanel)
    const [visited, setVisited] = useState(false)
    if (active && !visited) setVisited(true)
    return visited || active ? createPortal(<Panel {...props} active={active} />, retainedHost) : null
  }
  function PanelSeat() {
    const seat = useRef<HTMLDivElement>(null)
    useLayoutEffect(() => {
      retainedHost.inert = false
      seat.current?.append(retainedHost)
      return () => {
        retainedHost.inert = true
        retainedHost.remove()
      }
    }, [])
    return <div ref={seat} style={{ display: 'flex', flex: 1, minWidth: 0, minHeight: 0 }} />
  }
  function SidebarIcon(props: { size?: number, active?: boolean }) { return <AnimatedSidebarIcon name="projects" {...props} /> }
  ctx.slots.inject('shell.overlay', () => ctx.slots.register({ name: 'shell.overlay', id: 'seal-harness-projects-retained', children: { 'seal-harness.project.conversation': { kind: 'single', scope: 'session' } } }, RetainedPanel))
  ctx.slots.inject('main', () => ctx.slots.register({ name: 'main', key: 'seal-harness-projects' }, PanelSeat))
  ctx.slots.inject('seal-harness.project.conversation', () => ctx.slots.register({ name: 'seal-harness.project.conversation' }, ProjectConversationContent))
  ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({ name: 'sidebar.panellist', id: 'seal-harness-projects', order: 10, label: () => '项目' }, SidebarIcon))
}
