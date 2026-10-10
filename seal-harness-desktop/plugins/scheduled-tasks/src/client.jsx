import React, { useSyncExternalStore } from 'react'
import { ScheduledTasksPanel } from './panel.jsx'
import { styles } from './styles.js'

export const inject = ['slots', 'connection', 'layout', 'sealHarnessAuthClient', 'sealHarnessNavigation', 'workspaces', 'sessions', 'uiWorkspace']

export function apply(ctx) {
  const api = async (action, payload = {}) => {
    const result = await ctx.connection.rpc.call('/api', `seal-harness-scheduled-tasks/${action}`, payload)
    if (!result.ok) throw new Error(result.error.message)
    return result.value
  }
  const openSession = async sessionId => {
    // 先更新原生目录，使后台创建的会话也能被 Client 的会话管理器接管。
    await ctx.sessions.refresh()
    ctx.sealHarnessNavigation.leaveDecision()
    ctx.uiWorkspace.openSession(sessionId)
    ctx.layout.selectPanel(null)
  }
  function Panel() {
    const status = useSyncExternalStore(ctx.sealHarnessAuthClient.subscribe, ctx.sealHarnessAuthClient.getStatus)
    const workspaces = useSyncExternalStore(listener => ctx.workspaces.list.subscribe(listener), () => ctx.workspaces.list.getSnapshot())
    return status?.user ? <ScheduledTasksPanel key={`${status.accountId}:${status.epoch}`} api={api} workspaces={workspaces.items} openSession={openSession} /> : <main className="seal-schedules"><h1>定时任务</h1><p>请先登录本地账号。</p></main>
  }
  ctx.effect(() => {
    const element = document.createElement('style')
    element.textContent = styles
    document.head.append(element)
    return () => element.remove()
  }, 'seal-harness scheduled tasks styles')
  ctx.effect(() => ctx.sealHarnessNavigation.register({ id: 'seal-harness-schedules', label: '定时任务', order: 70, icon: 'schedules', Panel }), 'seal-harness scheduled tasks page')
}
