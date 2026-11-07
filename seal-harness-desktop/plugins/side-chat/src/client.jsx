import React from 'react'
import { createPortal } from 'react-dom'
import { parseSideChatAddress, quotedSelection, sideChatAddress, sideChatPrefix } from './address.js'
import { styles } from './styles.js'

export const inject = ['slots', 'sessions', 'resources', 'sidebarRight', 'sidebarRightTabs', 'connection']

const tabId = '@seal-harness/side-chat'
const tabKind = 'seal-side-chat'
const QuoteContext = React.createContext(null)

function FixedChatView({ renderSlot }) {
  return renderSlot('conversation.session', { view: 'chat' })
}

function Conversation({ useInput, inputActions, renderFactorySlot }) {
  const quote = React.useContext(QuoteContext)
  const applied = React.useRef(-1)
  const draft = useInput(state => state.draft)

  React.useEffect(() => {
    if (!quote?.text || applied.current === quote.revision) return
    applied.current = quote.revision
    inputActions.setDraft(`${draft ? `${draft}\n\n` : ''}${quotedSelection(quote.text)}`)
  }, [quote, draft, inputActions])

  return renderFactorySlot('conversation.content', {
    variant: 'embedded', phase: 'active', hero: false,
  }, { slots: { views: FixedChatView } })
}

function SideChatTab({ useResource, useTabInfo, SessionProvider, renderSlot }) {
  const { tab } = useTabInfo()
  const resource = useResource(tab.contentId)
  const params = tab.navigation.params
  const quote = React.useMemo(() => params?.quote
    ? { text: params.quote, revision: tab.navigation.revision } : null,
  [params?.quote, tab.navigation.revision])
  return <div className="seal-side-chat" data-sidebar-chat="seal">
    {resource.status === 'failed' && <p className="seal-side-chat-error" role="alert">{resource.failure?.message ?? '侧边聊天加载失败。'}</p>}
    {resource.value && <QuoteContext.Provider value={quote}>
      <SessionProvider session={resource.value.reference}>
        {renderSlot('seal.side-chat.conversation', {})}
      </SessionProvider>
    </QuoteContext.Provider>}
  </div>
}

function SelectionAction({ open }) {
  const [selection, setSelection] = React.useState(null)
  React.useEffect(() => {
    const update = () => {
      const selected = window.getSelection()
      if (!selected || selected.isCollapsed) return setSelection(null)
      const text = selected.toString().trim()
      const element = selected.anchorNode?.nodeType === Node.ELEMENT_NODE
        ? selected.anchorNode : selected.anchorNode?.parentElement
      const chat = element?.closest?.('[data-conversation-content]')
      if (!text || !chat || chat.closest('[data-sidebar-chat]') || element.closest('[data-composer-seat]'))
        return setSelection(null)
      const rect = selected.getRangeAt(0).getBoundingClientRect()
      if (rect.width === 0 && rect.height === 0) return setSelection(null)
      setSelection({ text, left: Math.max(12, Math.min(rect.left, window.innerWidth - 210)), top: Math.max(12, rect.top - 48) })
    }
    document.addEventListener('mouseup', update)
    document.addEventListener('keyup', update)
    const dismiss = () => setSelection(null)
    document.addEventListener('mousedown', dismiss)
    return () => {
      document.removeEventListener('mouseup', update)
      document.removeEventListener('keyup', update)
      document.removeEventListener('mousedown', dismiss)
    }
  }, [])
  if (!selection) return null
  return createPortal(<button type="button" className="seal-side-chat-selection"
    style={{ left: selection.left, top: selection.top }}
    onMouseDown={event => { event.preventDefault(); event.stopPropagation() }}
    onMouseUp={event => event.stopPropagation()}
    onClick={() => { void open(selection.text); setSelection(null); window.getSelection()?.removeAllRanges() }}>
    在侧边聊天中提问
  </button>, document.body)
}

export function apply(ctx) {
  const pending = new Map()
  const api = async (action, payload) => {
    const result = await ctx.connection.rpc.call('/api', `seal-harness-side-chat/${action}`, payload)
    if (!result.ok) throw Object.assign(new Error(result.error.message), { code: result.error.code })
    return result.value
  }
  ctx.effect(() => {
    const keepIds = ctx.sidebarRight.openTabs.getSnapshot()
      .filter(item => item.kind === tabKind)
      .map(item => parseSideChatAddress(item.contentId)?.sideSessionId)
      .filter(Boolean)
    void api('prune', { keepIds }).then(() => ctx.sessions.refresh())
      .catch(error => console.error('旧侧聊清理失败', error))
  }, 'seal-side-chat: orphan cleanup')
  ctx.effect(() => {
    const element = document.createElement('style')
    element.dataset.sealSideChat = ''
    element.textContent = styles
    document.head.append(element)
    return () => element.remove()
  }, 'seal-side-chat: styles')

  ctx.effect(() => ctx.resources.register({
    protocol: 'seal-side-chat',
    async *open(address, { signal }) {
      const target = parseSideChatAddress(address)
      if (!target) throw new Error(`无效的侧聊地址：${address}`)
      if (signal.aborted) return
      await api('ensure', { sessionId: target.sideSessionId })
      await ctx.sessions.refresh()
      if (signal.aborted) return
      const reference = ctx.sessions.retain(target.sideSessionId, { source: 'sidebarChat', signal })
      try {
        yield { ok: true, value: { reference } }
        if (!signal.aborted) await new Promise(resolve => signal.addEventListener('abort', resolve, { once: true }))
      } finally {
        reference.release()
      }
    },
  }), 'seal-side-chat: resource')
  ctx.effect(() => ctx.sidebarRightTabs.register({
    id: tabId, kind: tabKind, patterns: [`${sideChatPrefix}**`], priority: 'extension',
    canOpen: address => !!parseSideChatAddress(address),
    title: () => '侧边聊天',
  }), 'seal-side-chat: tab')
  ctx.effect(() => ctx.sidebarRight.registerCloseHandler(tabKind, (_parentSessionId, tab) => {
    const target = parseSideChatAddress(tab.contentId)
    if (!target) return
    queueMicrotask(() => { void (async () => {
      const source = ctx.sessions.retainInfo(target.sideSessionId)
      await new Promise((resolve, reject) => {
        let unsubscribe = () => {}
        const timeout = setTimeout(() => { unsubscribe(); reject(new Error('侧聊资源释放超时。')) }, 30000)
        const check = () => {
          if (source.getSnapshot().referenceCount !== 0) return
          clearTimeout(timeout)
          unsubscribe()
          resolve()
        }
        unsubscribe = source.subscribe(check)
        check()
      })
      if (ctx.sidebarRight.openTabs.getSnapshot().some(item => item.contentId === tab.contentId)) return
      await api('close', { sessionId: target.sideSessionId })
      await ctx.sessions.refresh()
    })().catch(error => {
      console.error('侧边聊天清理失败', error)
      window.alert(`侧边聊天清理失败：${error?.message ?? '请重试。'}`)
    }) })
  }), 'seal-side-chat: close cleanup')
  ctx.effect(() => ctx.slots.inject('sidebar.right.pane.tab', () => ctx.slots.register({
    name: 'sidebar.right.pane.tab', key: tabId,
    children: { 'seal.side-chat.conversation': { kind: 'single', scope: 'session' } },
  }, SideChatTab)), 'seal-side-chat: pane')
  ctx.effect(() => ctx.slots.inject('seal.side-chat.conversation', () => ctx.slots.register({
    name: 'seal.side-chat.conversation',
  }, Conversation)), 'seal-side-chat: conversation')

  const open = async (quote = '') => {
    const parentSessionId = ctx.sidebarRight.mounted.getSnapshot()
    if (!parentSessionId) return
    const existing = ctx.sidebarRight.openTabs.getSnapshot().find(item =>
      item.sessionId === parentSessionId && item.kind === tabKind)
    const target = parseSideChatAddress(existing?.contentId)
    const reusable = target?.parentSessionId === parentSessionId
    if (existing && !reusable) ctx.sidebarRight.closeIn(parentSessionId, existing.tabId)
    let address = reusable ? existing.contentId : undefined
    if (!address) {
      let creation = pending.get(parentSessionId)
      if (!creation) {
        creation = api('create', { parentSessionId }).then(async value => {
          await ctx.sessions.refresh()
          return value.sessionId
        })
        pending.set(parentSessionId, creation)
      }
      try { address = sideChatAddress(parentSessionId, await creation) }
      finally { pending.delete(parentSessionId) }
    }
    ctx.sidebarRight.openResourceIn(parentSessionId, address, { params: quote ? { quote } : undefined })
  }
  const launch = quote => open(quote).catch(error => {
    console.error('侧边聊天打开失败', error)
    window.alert(error?.message ?? '侧边聊天打开失败，请重试。')
  })
  ctx.slots.inject('conversation.session.header.utilities', () => ctx.slots.register({
    name: 'conversation.session.header.utilities', id: 'seal-side-chat-open', order: 90,
  }, () => <button type="button" className="seal-side-chat-launch" title="打开侧边聊天"
    aria-label="打开侧边聊天" onClick={() => { void launch() }}>
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
      <path d="M4 5h16v12H9l-5 3z" /><path d="M8 9h8M8 13h5" />
    </svg>
  </button>))
  ctx.slots.inject('shell.overlay', () => ctx.slots.register({
    name: 'shell.overlay', id: 'seal-side-chat-selection', label: '侧边聊天选中文本入口',
  }, () => <SelectionAction open={launch} />))
}
