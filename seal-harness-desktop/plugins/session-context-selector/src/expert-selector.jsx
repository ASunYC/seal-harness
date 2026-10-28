import React, { useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Button, IconAgentPresetOutlineRegular, IconChevronDownOutlineRegular } from '@deepseek-ai/dsh-client-ui-primitives'
import { directoryGroups } from '../../capability-shared/src/directory.js'
import { composerPopoverWidth, connectorPopoverPosition } from './position.js'

/** 直接管理当前会话专家；不离开输入页，也不发送用户草稿。 */
export function ExpertSelector({ api, sessionId }) {
  const root = useRef(null), popover = useRef(null), search = useRef(null)
  const [open, setOpen] = useState(false), [position, setPosition] = useState(null)
  const [query, setQuery] = useState(''), [snapshot, setSnapshot] = useState({ items: [], selectedIds: [] })
  const [loading, setLoading] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState('')
  const [retry, setRetry] = useState(0)
  const generation = useRef(0)
  const choiceGroup = useId()
  useEffect(() => {
    generation.current++
    setSnapshot({ items: [], selectedIds: [] }); setError(''); setBusy(false)
  }, [sessionId])
  useEffect(() => {
    if (!open) return
    const controller = new AbortController()
    setLoading(true); setError('')
    api('experts/sessionList', { sessionId }, controller.signal).then(value => {
      if (!controller.signal.aborted) setSnapshot(value)
    }).catch(cause => { if (!controller.signal.aborted) setError(cause.message ?? '专家加载失败，请重试。') })
      .finally(() => { if (!controller.signal.aborted) setLoading(false) })
    const outside = event => { if (!root.current?.contains(event.target) && !popover.current?.contains(event.target)) setOpen(false) }
    const escape = event => { if (event.key === 'Escape') setOpen(false) }
    document.addEventListener('pointerdown', outside); document.addEventListener('keydown', escape)
    const frame = requestAnimationFrame(() => search.current?.focus())
    return () => { controller.abort(); cancelAnimationFrame(frame); document.removeEventListener('pointerdown', outside); document.removeEventListener('keydown', escape) }
  }, [api, open, sessionId, retry])
  useLayoutEffect(() => {
    if (!open) { setPosition(null); return }
    const place = () => {
      const trigger = root.current?.getBoundingClientRect(), panel = popover.current
      if (!trigger || !panel) return
      const composer = root.current.closest('[data-composer-card]')?.getBoundingClientRect() ?? trigger
      const viewport = { width: window.innerWidth, height: window.innerHeight }
      const width = composerPopoverWidth({ composer, viewport })
      panel.style.width = `${width}px`
      const bounds = panel.getBoundingClientRect()
      setPosition({ ...connectorPopoverPosition({ trigger, composer, popover: { width, height: bounds.height }, viewport }), width })
    }
    place(); window.addEventListener('resize', place); window.addEventListener('scroll', place, true)
    return () => { window.removeEventListener('resize', place); window.removeEventListener('scroll', place, true) }
  }, [open, snapshot, loading, query, error])
  const selected = new Set(snapshot.selectedIds)
  const currentExpert = snapshot.items.find(item => selected.has(item.name))
  const visible = snapshot.items.filter(item => `${item.displayName ?? item.name} ${item.description ?? ''} ${(item.tags ?? []).join(' ')}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()))
  const choose = async (item, selected) => {
    const current = generation.current
    setBusy(true); setError('')
    try {
      const value = await api('experts/sessionSet', { sessionId, name: item.name, version: item.version, expectedDigest: item.digest, selected })
      if (generation.current === current) setSnapshot(value)
    } catch (cause) { if (generation.current === current) setError(cause.message ?? '专家选择失败，请重试。') }
    finally { if (generation.current === current) setBusy(false) }
  }
  return <div className="seal-harness-session-connector" ref={root}>
    <Button type="button" variant="toolbar" size="sm" className="seal-harness-session-context-selector-trigger" aria-label="选择专家" aria-haspopup="dialog" aria-expanded={open} title={currentExpert ? `当前专家：${currentExpert.displayName || currentExpert.name}` : '选择专家'} icon={<IconAgentPresetOutlineRegular size={15} />} onClick={() => setOpen(value => !value)}>
      <span>专家</span><IconChevronDownOutlineRegular size={13} aria-hidden="true" />
    </Button>
    {open ? createPortal(<div ref={popover} className="seal-harness-session-connector-popover" role="dialog" aria-label="专家选择器" style={position ?? { visibility: 'hidden', left: 0, top: 0 }}>
      <div className="seal-harness-session-connector-header"><strong>专家</strong><span>{currentExpert ? `当前：${currentExpert.displayName || currentExpert.name}` : '未选择专家'}</span></div>
      <input ref={search} className="seal-harness-session-connector-search" aria-label="搜索专家" placeholder="搜索专家名称、描述或标签" value={query} onChange={event => setQuery(event.target.value)} />
      <div className="seal-harness-session-connector-list" role="radiogroup" aria-label="当前会话专家" aria-busy={busy || loading}>
        {loading ? <div className="seal-harness-session-connector-empty" role="status">正在加载专家…</div> : null}
        {!loading && !error ? <label className="seal-harness-session-connector-row seal-harness-session-expert-option">
          <IconAgentPresetOutlineRegular size={17} />
          <span className="seal-harness-session-connector-copy"><strong>不使用专家</strong><span>沿用当前会话，从后续消息开始生效</span></span>
          <span className="seal-harness-session-connector-meta">{selected.size ? '移除当前专家' : '当前选择'}</span>
          <input type="radio" name={choiceGroup} aria-label="不使用专家" checked={!selected.size} disabled={busy} onChange={() => { if (currentExpert) void choose(currentExpert, false) }} />
        </label> : null}
        {!loading && !error && directoryGroups.map(group => {
          const items = visible.filter(item => (item.directory ?? 'personal') === group.id)
          return <section key={group.id} data-expert-directory={group.id} aria-label={`${group.title}专家`}>
            <div className="seal-harness-session-connector-section-title">{group.title}</div>
            {items.map(item => <label key={item.name} className="seal-harness-session-connector-row seal-harness-session-expert-option">
              <IconAgentPresetOutlineRegular size={17} />
              <span className="seal-harness-session-connector-copy"><strong>{item.displayName || item.name}</strong><span>{item.error || item.description}</span></span>
              <span className="seal-harness-session-connector-meta">{selected.has(item.name) ? '当前专家' : '使用此专家'}</span>
              <input type="radio" name={choiceGroup} aria-label={`在当前会话使用 ${item.displayName || item.name}`} checked={selected.has(item.name)} disabled={busy || !!item.error} onChange={() => void choose(item, true)} />
            </label>)}
            {!items.length ? <div className="seal-harness-session-connector-empty">{query ? '没有匹配的专家' : `暂无${group.title}专家`}</div> : null}
          </section>
        })}
      </div>
      {error ? <div className="seal-harness-session-connector-error" role="alert">{error}<button type="button" onClick={() => setRetry(value => value + 1)}>重试</button></div> : null}
    </div>, document.body) : null}
  </div>
}
