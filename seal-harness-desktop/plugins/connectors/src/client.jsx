import React, { useSyncExternalStore } from 'react'
import { ConnectorsPanel } from './panel.jsx'
import { capabilityApi, registerPanel } from '../../capability-shared/src/client.jsx'

export const inject = ['slots', 'connection', 'layout', 'sealHarnessAuthClient', 'workspaces']

export function apply(ctx) {
  const api = capabilityApi(ctx)
  const auth = ctx.sealHarnessAuthClient
  function Panel() {
    const status = useSyncExternalStore(auth.subscribe, auth.getStatus)
    const workspaces = useSyncExternalStore(listener => ctx.workspaces.list.subscribe(listener), () => ctx.workspaces.list.getSnapshot())
    return <ConnectorsPanel onBack={() => ctx.layout.selectPanel(null)} key={JSON.stringify([status?.accountId, status?.epoch, !!status?.user])} api={api} signedIn={!!status?.user} openLogin={() => auth.openLogin()} workspaces={workspaces.items} />
  }
  registerPanel(ctx, { id: 'connectors', label: '连接器', order: 50, icon: 'connectors' }, Panel)
}
