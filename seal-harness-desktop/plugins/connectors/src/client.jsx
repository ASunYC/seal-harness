import React, { useSyncExternalStore } from 'react'
import { ConnectorsPanel } from './panel.jsx'
import { capabilityApi, registerPanel } from '../../capability-shared/src/client.jsx'

export const inject = ['slots', 'connection', 'layout', 'sealHarnessAuthClient']

export function apply(ctx) {
  const api = capabilityApi(ctx)
  const auth = ctx.sealHarnessAuthClient
  function Panel() {
    const status = useSyncExternalStore(auth.subscribe, auth.getStatus)
    return <ConnectorsPanel onBack={() => ctx.layout.selectPanel(null)} key={JSON.stringify([status?.accountId, status?.epoch, !!status?.user])} api={api} signedIn={!!status?.user} openLogin={() => auth.openLogin()} />
  }
  registerPanel(ctx, { id: 'connectors', label: '连接器', order: 50, icon: 'connectors' }, Panel)
}
