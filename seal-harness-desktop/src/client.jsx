import { createElement, useLayoutEffect, useRef } from 'react'
import { AnimatedSidebarIcon } from '../plugins/capability-shared/src/sidebar-icons.jsx'

const productName = __SEAL_HARNESS_NAME__
const brandIcon = __SEAL_HARNESS_ICON__

export const inject = ['slots']

function BrandMark({ size = 28 }) {
  return createElement('img', { src: brandIcon, alt: productName, width: size, height: size })
}

function BrandName() {
  return createElement('span', { style: { fontWeight: 600 } }, productName)
}

function overridePluginsMenuOrder(ctx) {
  let mounted = false
  let remove
  const mount = () => {
    if (mounted) return
    const source = ctx.slots.entries('sidebar.panellist')
      .find(entry => entry.options.id === 'plugins' && (entry.options.priority ?? 0) >= 0)
    if (!source) return
    mounted = true
    try {
      remove = ctx.slots.register({
        name: 'sidebar.panellist', id: 'plugins', order: 40, priority: -100,
        label: source.options.label,
        ...(source.locale ? { locale: source.locale } : {}),
      }, function PluginsMenuIcon(props) { return createElement(AnimatedSidebarIcon, { name: 'plugins', ...props }) })
    } catch (error) {
      mounted = false
      throw error
    }
  }
  const unsubscribe = ctx.slots.subscribe('sidebar.panellist', mount)
  mount()
  return () => { unsubscribe(); remove?.() }
}

function HeroMark() {
  const mark = useRef(null)
  useLayoutEffect(() => {
    // ponytail: 上游尚无标题 slot，通过现有品牌 slot 定位；有公开标题接口后改用接口。
    const headline = mark.current.closest('[data-slot="conversation.hero.brand.mark"]')
      ?.parentElement.nextElementSibling?.firstElementChild
    if (!headline) return
    const replacement = '今天，你为公司创造价值了吗？'
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
  ctx.slots.inject('sidebar.panellist', () =>
    overridePluginsMenuOrder(ctx))
}
