import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import {
  Button,
  IconAgentPresetOutlineRegular,
  IconChevronDownOutlineRegular,
  IconCordisPluginOutlineRegular,
  IconSkillOutlineRegular,
} from '@deepseek-ai/dsh-client-ui-primitives'
import { createResourceActions } from './actions.js'
import { styles } from './styles.js'
import { capabilityApi } from '../../capability-shared/src/client.jsx'
import { connectorPopoverPosition } from './position.js'

export const inject = ['slots', 'layout', 'connection']

const controls = [
  { id: 'skill', label: '能力', ariaLabel: '选择能力', Icon: IconSkillOutlineRegular },
  { id: 'connector', label: '连接器', ariaLabel: '选择连接器', Icon: IconCordisPluginOutlineRegular },
  { id: 'expert', label: '智能助手', ariaLabel: '选择智能助手', Icon: IconAgentPresetOutlineRegular },
]

function ConnectorSelector({ api, selectPanel, sessionId }) {
  const rootRef = useRef(null)
  const popoverRef = useRef(null)
  const [open, setOpen] = useState(false)
  const [popoverPosition, setPopoverPosition] = useState(null)
  const [query, setQuery] = useState('')
  const [snapshot, setSnapshot] = useState({ items: [], selectedIds: [] })
  const [loading, setLoading] = useState(false)
  const [busyId, setBusyId] = useState(null)
  const [error, setError] = useState('')

  const refresh = async () => {
    setLoading(true)
    setError('')
    try { setSnapshot(await api('connectors/sessionList', { sessionId })) }
    catch (cause) { setError(cause?.message ?? '连接器加载失败，请重试。') }
    finally { setLoading(false) }
  }

  useEffect(() => {
    if (!open) return
    void refresh()
    const onPointerDown = event => {
      if (!rootRef.current?.contains(event.target) && !popoverRef.current?.contains(event.target)) setOpen(false)
    }
    const onKeyDown = event => {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open, sessionId])

  useLayoutEffect(() => {
    if (!open) {
      setPopoverPosition(null)
      return
    }
    const place = () => {
      const trigger = rootRef.current?.getBoundingClientRect()
      const popover = popoverRef.current
      if (!trigger || !popover) return
      const composer = rootRef.current.closest('[data-composer-card]')?.getBoundingClientRect() ?? trigger
      const width = Math.min(780, composer.width || 780, window.innerWidth - 24)
      popover.style.width = `${width}px`
      const bounds = popover.getBoundingClientRect()
      setPopoverPosition({ ...connectorPopoverPosition({
        trigger,
        composer,
        popover: { width: bounds.width || width, height: bounds.height },
        viewport: { width: window.innerWidth, height: window.innerHeight },
      }), width })
    }
    place()
    window.addEventListener('scroll', place, true)
    window.addEventListener('resize', place)
    return () => {
      window.removeEventListener('scroll', place, true)
      window.removeEventListener('resize', place)
    }
  }, [open, snapshot, loading, error, query])

  const selected = new Set(snapshot.selectedIds)
  const items = snapshot.items.filter(item => `${item.name} ${item.summary ?? ''}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()))
  const toggle = async item => {
    setBusyId(item.id)
    setError('')
    try {
      setSnapshot(await api('connectors/sessionSet', {
        sessionId,
        id: item.id,
        revision: item.revision,
        selected: !selected.has(item.id),
      }))
    } catch (cause) { setError(cause?.message ?? '连接器选择失败，请重试。') }
    finally { setBusyId(null) }
  }

  return <div className="seal-harness-session-connector" ref={rootRef}>
    <Button
      type="button"
      variant="toolbar"
      size="sm"
      className="seal-harness-session-context-selector-trigger"
      aria-label="选择连接器"
      aria-haspopup="dialog"
      aria-expanded={open}
      title="选择连接器"
      icon={<IconCordisPluginOutlineRegular size={15} />}
      onClick={() => setOpen(value => !value)}
    >
      <span>连接器{snapshot.selectedIds.length ? ` ${snapshot.selectedIds.length}` : ''}</span>
      <IconChevronDownOutlineRegular size={13} aria-hidden="true" />
    </Button>
    {open ? createPortal(<div ref={popoverRef} className="seal-harness-session-connector-popover" style={popoverPosition ?? { visibility: 'hidden', left: 0, top: 0 }} role="dialog" aria-label="连接器选择器">
      <div className="seal-harness-session-connector-header">
        <strong>连接器</strong>
        <span>已选择 {snapshot.selectedIds.length} 个</span>
      </div>
      <input
        className="seal-harness-session-connector-search"
        aria-label="搜索连接器"
        placeholder="搜索名称、用途或相对路径"
        value={query}
        onChange={event => setQuery(event.target.value)}
      />
      <div className="seal-harness-session-connector-section-title">连接器</div>
      <div className="seal-harness-session-connector-list">
        {loading ? <div className="seal-harness-session-connector-empty">正在加载连接器…</div> : null}
        {!loading && !items.length ? <div className="seal-harness-session-connector-empty">{query ? '没有匹配的连接器' : '还没有安装连接器'}</div> : null}
        {!loading && items.map(item => {
          const checked = selected.has(item.id)
          const status = item.status === 'active' ? '已就绪' : item.status === 'error' ? '连接失败' : item.status === 'unconfigured' ? '待配置' : '待初始化'
          return <label className="seal-harness-session-connector-row" key={item.id}>
            <IconCordisPluginOutlineRegular size={17} />
            <span className="seal-harness-session-connector-copy">
              <strong>{item.name}</strong>
              {item.summary ? <span>{item.summary}</span> : null}
            </span>
            <span className="seal-harness-session-connector-meta">{status} · {item.tools?.length ?? 0} 个工具</span>
            <input
              type="checkbox"
              role="switch"
              aria-label={`在当前会话使用 ${item.name}`}
              checked={checked}
              disabled={busyId === item.id}
              onChange={() => void toggle(item)}
            />
          </label>
        })}
      </div>
      {error ? <div className="seal-harness-session-connector-error" role="alert">{error}</div> : null}
      <button type="button" className="seal-harness-session-connector-manage" onClick={() => { setOpen(false); selectPanel('seal-harness-connectors') }}>管理连接器</button>
    </div>, document.body) : null}
  </div>
}

function SelectorGroup({ api, inputActions, selectPanel, sessionId }) {
  const actions = useMemo(() => createResourceActions({ inputActions, selectPanel }), [inputActions, selectPanel])
  return <div className="seal-harness-session-context-selectors" aria-label="会话资源选择器">
    {controls.map(({ id, label, ariaLabel, Icon }) => id === 'connector'
      ? <ConnectorSelector key={id} api={api} selectPanel={selectPanel} sessionId={sessionId} />
      : <Button
      key={id}
      type="button"
      variant="toolbar"
      size="sm"
      className="seal-harness-session-context-selector-trigger"
      aria-label={ariaLabel}
      aria-haspopup="dialog"
      title={ariaLabel}
      icon={<Icon size={15} />}
      onClick={() => actions[id]()}
    >
      <span>{label}</span>
      <IconChevronDownOutlineRegular size={13} aria-hidden="true" />
    </Button>)}
  </div>
}

export function apply(ctx) {
  ctx.effect(() => {
    const element = document.createElement('style')
    element.dataset.plugin = '@seal-harness/session-context-selector'
    element.textContent = styles
    document.head.append(element)
    return () => element.remove()
  }, 'seal-harness-session-context-selector: styles')

  const selectPanel = panel => ctx.layout.selectPanel(panel)
  const api = capabilityApi(ctx)
  function SessionContextSelectors({ inputActions, sessionId }) {
    return <SelectorGroup api={api} inputActions={inputActions} selectPanel={selectPanel} sessionId={sessionId} />
  }
  ctx.slots.inject('conversation.input.left', () => ctx.slots.register({
    name: 'conversation.input.left',
    id: 'seal-harness-session-context-selector',
    order: 20,
    label: '会话资源',
  }, SessionContextSelectors))
}
