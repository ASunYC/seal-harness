import React, { useSyncExternalStore } from 'react'
import { conversationServices, createExpertConversation } from './conversation.js'
import { ExpertsPanel } from './panel.jsx'
import { capabilityApi, registerPanel } from '../../capability-shared/src/client.jsx'

export const inject = ['slots', 'connection', 'layout', 'sealHarnessAuthClient', ...conversationServices]

export function apply(ctx) {
  const api = capabilityApi(ctx)
  const auth = ctx.sealHarnessAuthClient
  function Panel() {
    const status = useSyncExternalStore(auth.subscribe, auth.getStatus)
    const workspaces = useSyncExternalStore(listener => ctx.workspaces.list.subscribe(listener), () => ctx.workspaces.list.getSnapshot())
    return <ExpertsPanel onBack={() => ctx.layout.selectPanel(null)} key={JSON.stringify([status?.accountId, status?.epoch, !!status?.user])} api={api} signedIn={!!status?.user} openLogin={() => auth.openLogin()} workspaces={workspaces.items} startConversation={(presetId, prompt, workspaceId) => createExpertConversation(ctx, presetId, prompt, workspaceId)} />
  }
  registerPanel(ctx, { id: 'experts', label: '专家', order: 20, icon: 'agents' }, Panel)
}
