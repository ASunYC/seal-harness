import React, { useSyncExternalStore } from 'react'
import { ConnectorsPanel } from './panel.jsx'
import { capabilityApi, leaveResource, registerPanel } from '../../capability-shared/src/client.jsx'

export const inject = ['slots', 'connection', 'layout', 'sealHarnessAuthClient', 'sealHarnessNavigation', 'workspaces']

export function apply(ctx) {
  const api = capabilityApi(ctx)
  const auth = ctx.sealHarnessAuthClient
  function Panel() {
    const status = useSyncExternalStore(auth.subscribe, auth.getStatus)
    const workspaces = useSyncExternalStore(listener => ctx.workspaces.list.subscribe(listener), () => ctx.workspaces.list.getSnapshot())
    return <ConnectorsPanel onBack={() => leaveResource(ctx)} key={JSON.stringify([status?.accountId, status?.epoch, !!status?.user])} api={api} signedIn={!!status?.user} openLogin={() => auth.openLogin()} workspaces={workspaces.items} />
  }
  registerPanel(ctx, { id: 'connectors', label: '连接器', order: 50, icon: 'connectors', description: '接入 MCP 工具与服务' }, Panel)
}
