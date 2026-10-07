import React from 'react'
import { styles } from './styles.js'
import { resourceStyles } from './resource-styles.js'

export function capabilityApi(ctx) {
  return async (endpoint, payload = {}, signal) => {
    const result = await ctx.connection.rpc.call('/api', `seal-harness-capabilities/${endpoint}`, payload, signal)
    if (!result.ok) throw Object.assign(new Error(result.error.message), { code: result.error.code })
    return result.value
  }
}

export function leaveResource(ctx) {
  const navigation = ctx.get?.('sealHarnessNavigation') ?? ctx.sealHarnessNavigation
  if (!navigation) throw new Error('首页导航服务未加载。')
  navigation.select(null)
  ctx.layout.selectPanel(null)
}

export function registerPanel(ctx, { id, label, order, icon, description }, Panel) {
  ctx.effect(() => {
    const element = document.createElement('style')
    element.textContent = styles + resourceStyles
    document.head.append(element)
    return () => element.remove()
  }, `seal-harness-${id}: styles`)
  const navigation = ctx.get?.('sealHarnessNavigation') ?? ctx.sealHarnessNavigation
  if (!navigation) throw new Error('首页导航服务未加载。')
  ctx.effect(() => navigation.register({ id, label, order, description, icon: { agents: 'experts', store: 'skills' }[icon] ?? icon, Panel }), `seal-harness-${id}: home navigation`)
}
