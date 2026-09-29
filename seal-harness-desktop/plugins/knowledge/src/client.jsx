import { Icon } from '../../capability-shared/src/icons.jsx'
import { AnimatedSidebarIcon } from '../../capability-shared/src/sidebar-icons.jsx'
import React, { useEffect, useState } from 'react'
import { KnowledgePanel } from './panel.jsx'
import { styles } from './styles.js'

export const inject = ['slots', 'connection', 'sessions', 'conversation', 'uiWorkspace', 'layout', 'sealHarnessAuthClient']
export function apply(ctx) {
  const api = async (action, payload = {}, signal) => {
    const result = await ctx.connection.rpc.call('/api', `seal-harness-knowledge/${action}`, payload, signal)
    if (!result.ok) throw new Error(result.error.message)
    return result.value
  }
  const sessions = () => {
    const snapshot = ctx.sessions.list.getSnapshot()
    return snapshot.ids.map(id => ({ id, name: snapshot.byId[id].displayTitle }))
  }
  function Panel() {
    const accountKey = () => { const status = ctx.sealHarnessAuthClient.getStatus(); return `${status?.accountId ?? ''}:${status?.epoch ?? 0}` }
    const [epoch, setEpoch] = useState(accountKey)
    useEffect(() => ctx.sealHarnessAuthClient.subscribe(() => setEpoch(accountKey())), [])
    return <KnowledgePanel key={epoch} api={api} sessions={sessions} attach={(sessionId, text) => appendKnowledgeReference(ctx, sessionId, text)} refreshSessions={() => ctx.sessions.refresh()} back={() => ctx.layout.selectPanel(null)} />
  }
  function SidebarIcon(props) { return <AnimatedSidebarIcon name="library" {...props} /> }
  ctx.effect(() => { const element = document.createElement('style'); element.textContent = styles; document.head.append(element); return () => element.remove() }, 'knowledge styles')
  ctx.slots.inject('main', () => ctx.slots.register({ name: 'main', key: 'seal-harness-knowledge' }, Panel))
  ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({ name: 'sidebar.panellist', id: 'seal-harness-knowledge', order: 60, label: () => '知识库' }, SidebarIcon))
}

export async function appendKnowledgeReference(ctx, sessionId, text) {
    const reference = ctx.sessions.retain(sessionId, { source: 'sealHarnessKnowledge' })
    try {
      const binding = await reference.ready
      const input = ctx.conversation.input.for(binding.ctx)
      const { draft, draftRev } = input.state.getSnapshot()
      if (!binding.ctx.bail('slash/input-insert-text', { text: draft ? `\n\n${text}` : text, span: { start: draft.length, end: draft.length, draftRev } })) throw new Error('输入框正在提交，请稍后重试。')
      ctx.uiWorkspace.openSession(sessionId)
    } finally { reference.release() }
  }
