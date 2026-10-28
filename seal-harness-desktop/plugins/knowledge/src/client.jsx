import React, { useSyncExternalStore } from 'react'
import { KnowledgePanel } from './panel.jsx'
import { styles } from './styles.js'

export { KnowledgePanel } from './panel.jsx'
export const inject = ['slots', 'connection', 'sealHarnessAuthClient']

export function apply(ctx) {
  const api = async (action, payload = {}, signal) => {
    const result = await ctx.connection.rpc.call('/api', `seal-harness-knowledge/${action}`, payload, signal)
    if (!result.ok) throw Object.assign(new Error(result.error.message), { code: result.error.code })
    return result.value
  }
  const openConnection = () => {
    const button = document.querySelector('.seal-nav-rail button[aria-label="设置"]')
    if (!button) throw new Error('设置入口尚未加载，请稍后重试。')
    button.click()
  }
  function Panel() {
    const status = useSyncExternalStore(ctx.sealHarnessAuthClient.subscribe, ctx.sealHarnessAuthClient.getStatus)
    return status?.user ? <KnowledgePanel key={`${status.accountId}:${status.epoch}`} api={api} openConnection={openConnection} />
      : <main className="seal-kb-page"><h1>知识库</h1><p>请先登录本地账号。</p></main>
  }
  ctx.effect(() => {
    const element = document.createElement('style')
    element.dataset.plugin = '@seal-harness/knowledge'; element.textContent = styles
    document.head.append(element)
    return () => element.remove()
  }, 'knowledge: styles')
  ctx.inject(['sealHarnessNavigation'], navigation => navigation.effect(() => navigation.sealHarnessNavigation.register({
    id: 'knowledge', label: '知识库', icon: 'knowledge', order: 110, primary: true, Panel,
  }), 'knowledge: primary navigation'))
}
