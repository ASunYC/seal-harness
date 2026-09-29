import React, { useSyncExternalStore } from 'react'
import { SkillsPanel } from './panel.jsx'
import { capabilityApi, registerPanel } from '../../capability-shared/src/client.jsx'

export const inject = ['slots', 'connection', 'layout', 'sealHarnessAuthClient']

export function apply(ctx) {
  const api = capabilityApi(ctx)
  const auth = ctx.sealHarnessAuthClient
  function Panel() {
    const status = useSyncExternalStore(auth.subscribe, auth.getStatus)
    return <SkillsPanel key={JSON.stringify([status?.accountId, status?.epoch])} api={api} signedIn={Boolean(status?.user)} openLogin={() => auth.openLogin()} onBack={() => ctx.layout.selectPanel(null)} />
  }
  registerPanel(ctx, { id: 'skills', label: '技能', order: 30, icon: 'store' }, Panel)
}
