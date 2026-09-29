import React from 'react'
import { styles } from './styles.js'
import { resourceStyles } from './resource-styles.js'
import { AnimatedSidebarIcon } from './sidebar-icons.jsx'

export function capabilityApi(ctx) {
  return async (endpoint, payload = {}, signal) => {
    const result = await ctx.connection.rpc.call('/api', `seal-harness-capabilities/${endpoint}`, payload, signal)
    if (!result.ok) throw Object.assign(new Error(result.error.message), { code: result.error.code })
    return result.value
  }
}

export function registerPanel(ctx, { id, label, order, icon }, Panel) {
  ctx.effect(() => {
    const element = document.createElement('style')
    element.textContent = styles + resourceStyles
    document.head.append(element)
    return () => element.remove()
  }, `seal-harness-${id}: styles`)
  function SidebarIcon(props) { return <AnimatedSidebarIcon name={icon} {...props} /> }
  ctx.slots.inject('main', () => ctx.slots.register({ name: 'main', key: `seal-harness-${id}` }, Panel))
  ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({ name: 'sidebar.panellist', id: `seal-harness-${id}`, order, label: () => label }, SidebarIcon))
}
