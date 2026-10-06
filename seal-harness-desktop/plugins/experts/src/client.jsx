import React, { useSyncExternalStore } from 'react'
import { conversationServices, createExpertConversation, createExpertDraftConversation } from './conversation.js'
import { ExpertsPanel } from './panel.jsx'
import { capabilityApi, leaveResource, registerPanel } from '../../capability-shared/src/client.jsx'

export const inject = ['slots', 'connection', 'layout', 'sealHarnessAuthClient', 'sealHarnessNavigation', ...conversationServices]

export function apply(ctx) {
  const api = capabilityApi(ctx)
  const auth = ctx.sealHarnessAuthClient
  function Panel() {
    const status = useSyncExternalStore(auth.subscribe, auth.getStatus)
    const workspaces = useSyncExternalStore(listener => ctx.workspaces.list.subscribe(listener), () => ctx.workspaces.list.getSnapshot())
    return <ExpertsPanel onBack={() => leaveResource(ctx)} key={JSON.stringify([status?.accountId, status?.epoch, !!status?.user])} api={api} workspaces={workspaces.items} startConversation={(presetId, prompt, workspaceId) => createExpertConversation(ctx, presetId, prompt, workspaceId)} startExpertCreation={() => createExpertDraftConversation(ctx)} />
  }
  registerPanel(ctx, { id: 'experts', label: '专家', order: 20, icon: 'agents', description: '配置专属专家，扩展对话方式' }, Panel)
}
