import React, { useSyncExternalStore } from 'react'
import { SkillsPanel } from './panel.jsx'
import { capabilityApi, leaveResource, registerPanel } from '../../capability-shared/src/client.jsx'

export const inject = ['slots', 'connection', 'layout', 'sealHarnessAuthClient', 'sealHarnessNavigation']

export function apply(ctx) {
  const api = capabilityApi(ctx)
  const auth = ctx.sealHarnessAuthClient
  function Panel() {
    const status = useSyncExternalStore(auth.subscribe, auth.getStatus)
    return <SkillsPanel key={JSON.stringify([status?.accountId, status?.epoch])} api={api} signedIn={Boolean(status?.user)} openLogin={() => auth.openLogin()} onBack={() => leaveResource(ctx)} />
  }
  registerPanel(ctx, { id: 'skills', label: '技能', order: 30, icon: 'store', description: '管理本地技能与指令' }, Panel)
}
