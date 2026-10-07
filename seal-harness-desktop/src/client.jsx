import { createElement, useLayoutEffect, useRef } from 'react'

const productName = __SEAL_HARNESS_NAME__
const brandIcon = __SEAL_HARNESS_ICON__

export const inject = ['slots']

function BrandMark({ size = 28 }) {
  return createElement('img', { src: brandIcon, alt: productName, width: size, height: size })
}

function BrandName() {
  return createElement('span', { style: { fontWeight: 600 } }, productName)
}

function enhancePluginManagerSync() {
  const update = () => {
    const panel = document.querySelector('[data-plugin-panel]')
    const header = panel?.querySelector('[data-plugin-page-header="list"]')
    const refresh = header?.querySelector('button[aria-label="刷新"], button[aria-label="Refresh"]')
    if (!panel || !refresh) return
    refresh.classList.add('resource-sync-button')
    let state = header.querySelector('[data-seal-harness-plugin-sync-state]')
    if (!state) {
      state = document.createElement('span')
      state.className = 'resource-sync-state'
      state.dataset.sealHarnessPluginSyncState = ''
      state.setAttribute('role', 'status')
      state.innerHTML = '<span class="resource-sync-state__dot" aria-hidden="true"></span><span data-sync-label></span>'
      refresh.before(state)
    }
    const nativeStatus = [...panel.querySelectorAll('[role="status"]')]
      .find(element => !element.hasAttribute('data-seal-harness-plugin-sync-state'))?.textContent ?? ''
    const loading = panel.getAttribute('aria-busy') === 'true' || /加载|读取|loading/i.test(nativeStatus)
    const failed = !loading && (Boolean(panel.querySelector('[role="alert"]')) || /不可用|失败|错误|unavailable|error/i.test(nativeStatus))
    const status = loading ? 'loading' : failed ? 'error' : 'ready'
    const label = loading ? '同步中' : failed ? '未连接' : '已同步'
    const dot = state.querySelector('.resource-sync-state__dot')
    const text = state.querySelector('[data-sync-label]')
    if (dot.dataset.state !== status) dot.dataset.state = status
    if (text.textContent !== label) text.textContent = label
    refresh.dataset.loading = loading ? 'true' : ''
  }
  const observer = new MutationObserver(update)
  observer.observe(document.documentElement, { subtree: true, childList: true, attributes: true, attributeFilter: ['aria-busy'] })
  update()
  return () => {
    observer.disconnect()
    document.querySelectorAll('[data-seal-harness-plugin-sync-state]').forEach(element => element.remove())
    document.querySelectorAll('[data-plugin-panel] .resource-sync-button').forEach(element => {
      element.classList.remove('resource-sync-button')
      delete element.dataset.loading
    })
  }
}

function HeroMark() {
  const mark = useRef(null)
  useLayoutEffect(() => {
    // ponytail: 上游尚无标题 slot，通过现有品牌 slot 定位；有公开标题接口后改用接口。
    const headline = mark.current.closest('[data-slot="conversation.hero.brand.mark"]')
      ?.parentElement.nextElementSibling?.firstElementChild
    if (!headline) return
    const replacement = '今天，让未来从这里发生。'
    let original = headline.textContent
    const update = () => {
      if (headline.textContent === replacement) return
      original = headline.textContent
      headline.textContent = replacement
    }
    const observer = new MutationObserver(update)
    observer.observe(headline, { childList: true, characterData: true, subtree: true })
    update()
    return () => {
      observer.disconnect()
      headline.textContent = original
    }
  }, [])
  return createElement('span', { ref: mark }, createElement(BrandMark, { size: 64 }))
}

export function apply(ctx) {
  ctx.effect(enhancePluginManagerSync, 'seal-harness: plugin manager sync status')
  ctx.effect(() => {
    const title = document.querySelector('title')
    if (!title) return
    let upstreamTitle
    let brandedTitle
    const update = () => {
      const current = document.title
      const suffix = ' — DeepSeek Harness'
      const next = current === 'DeepSeek Harness' ? productName
        : current.endsWith(suffix) ? `${current.slice(0, -suffix.length)} — ${productName}` : current
      if (next === current) return
      upstreamTitle = current
      brandedTitle = next
      document.title = next
    }
    // ponytail: 已发布的上游布局会重写标题且没有标题服务，只观察这个节点；有公开接口后改用接口。
    const observer = new MutationObserver(update)
    observer.observe(title, { childList: true, characterData: true, subtree: true })
    update()
    return () => {
      observer.disconnect()
      if (document.title === brandedTitle) document.title = upstreamTitle
    }
  }, 'seal-harness: window title')
  ctx.slots.inject('sidebar.brand.mark', () =>
    ctx.slots.inject('sidebar.brand.name', function* () {
      yield ctx.slots.register({ name: 'sidebar.brand.mark' }, BrandMark)
      yield ctx.slots.register({ name: 'sidebar.brand.name' }, BrandName)
    }))
  ctx.slots.inject('conversation.hero.brand.mark', () =>
    ctx.slots.register({ name: 'conversation.hero.brand.mark' }, HeroMark))
}
