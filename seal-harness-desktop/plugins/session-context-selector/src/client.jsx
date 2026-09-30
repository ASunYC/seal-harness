import React, { useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { createPortal } from 'react-dom'
import {
  Button,
  MenuItemButton,
  Modal,
  IconAgentPresetOutlineRegular,
  IconChevronDownOutlineRegular,
  IconCordisPluginOutlineRegular,
  IconSkillOutlineRegular,
  IconTrashOutlineRegular,
} from '@deepseek-ai/dsh-client-ui-primitives'
import { createResourceActions } from './actions.js'
import { styles } from './styles.js'
import { capabilityApi } from '../../capability-shared/src/client.jsx'
import { composerPopoverWidth, connectorPopoverPosition } from './position.js'

export const inject = ['slots', 'layout', 'connection', 'remote', 'remote.skills', 'workspaces']

const controls = [
  { id: 'skill', label: '能力', ariaLabel: '选择能力', Icon: IconSkillOutlineRegular },
  { id: 'connector', label: '连接器', ariaLabel: '选择连接器', Icon: IconCordisPluginOutlineRegular },
  { id: 'expert', label: '智能助手', ariaLabel: '选择智能助手', Icon: IconAgentPresetOutlineRegular },
]

function skillSource(skill, managedByName) {
  return managedByName.get(skill.name)?.origin?.kind === 'store' ? 'platform' : 'local'
}

function SkillSelector({ api, inputActions, remoteSkills, selectPanel, sessionId }) {
  const rootRef = useRef(null)
  const popoverRef = useRef(null)
  const searchRef = useRef(null)
  const [open, setOpen] = useState(false)
  const [position, setPosition] = useState(null)
  const [query, setQuery] = useState('')
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const actions = useMemo(() => createResourceActions({ inputActions, selectPanel }), [inputActions, selectPanel])

  useEffect(() => {
    if (!open) return
    const controller = new AbortController()
    setLoading(true)
    setError('')
    Promise.all([
      remoteSkills.list({ sessionId }, controller.signal),
      api('skills/list', {}, controller.signal).catch(() => ({ skills: [] })),
    ]).then(([catalog, managed]) => {
      if (!catalog.ok) throw new Error(catalog.error?.message ?? '技能目录加载失败')
      const managedByName = new Map((managed.skills ?? []).filter(skill => skill.enabled && skill.active).map(skill => [skill.name, skill]))
      setItems(catalog.value.skills.map(skill => ({ ...skill, source: skillSource(skill, managedByName) })))
    }).catch(cause => {
      if (!controller.signal.aborted) setError(cause?.message ?? '技能目录加载失败，请重试。')
    }).finally(() => {
      if (!controller.signal.aborted) setLoading(false)
    })
    const onPointerDown = event => {
      if (!rootRef.current?.contains(event.target) && !popoverRef.current?.contains(event.target)) setOpen(false)
    }
    const onKeyDown = event => {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    requestAnimationFrame(() => searchRef.current?.focus())
    return () => {
      controller.abort()
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [api, open, remoteSkills, sessionId])

  useLayoutEffect(() => {
    if (!open) {
      setPosition(null)
      return
    }
    const place = () => {
      const trigger = rootRef.current?.getBoundingClientRect()
      const popover = popoverRef.current
      if (!trigger || !popover) return
      const composer = rootRef.current.closest('[data-composer-card]')?.getBoundingClientRect() ?? trigger
      const viewport = { width: window.innerWidth, height: window.innerHeight }
      const width = composerPopoverWidth({ composer, viewport })
      popover.style.width = `${width}px`
      const bounds = popover.getBoundingClientRect()
      setPosition({ ...connectorPopoverPosition({
        trigger,
        composer,
        popover: { width: bounds.width || width, height: bounds.height },
        viewport,
      }), width })
    }
    place()
    window.addEventListener('scroll', place, true)
    window.addEventListener('resize', place)
    return () => {
      window.removeEventListener('scroll', place, true)
      window.removeEventListener('resize', place)
    }
  }, [error, items, loading, open, query])

  const needle = query.trim().toLocaleLowerCase()
  const visible = items.filter(skill => `${skill.name} ${skill.description ?? ''} ${skill.whenToUse ?? ''}`.toLocaleLowerCase().includes(needle))
  const groups = [
    { id: 'platform', title: '平台 Skill', items: visible.filter(skill => skill.source === 'platform') },
    { id: 'local', title: '本地 Skill', items: visible.filter(skill => skill.source === 'local') },
  ]
  const choose = skill => {
    if (actions.skill(skill.name)) setOpen(false)
  }

  return <div className="seal-harness-session-skill" ref={rootRef}>
    <Button
      type="button"
      variant="toolbar"
      size="sm"
      className="seal-harness-session-context-selector-trigger"
      aria-label="选择能力"
      aria-haspopup="dialog"
      aria-expanded={open}
      title="选择能力"
      icon={<IconSkillOutlineRegular size={15} />}
      onClick={() => setOpen(value => !value)}
    >
      <span>能力</span>
      <IconChevronDownOutlineRegular size={13} aria-hidden="true" />
    </Button>
    {open ? createPortal(<div ref={popoverRef} className="seal-harness-session-skill-popover" style={position ?? { visibility: 'hidden', left: 0, top: 0 }} role="dialog" aria-label="技能选择器">
      <div className="seal-harness-session-skill-header">
        <strong>技能</strong>
        <span>{items.length} 个可用</span>
      </div>
      <input
        ref={searchRef}
        className="seal-harness-session-skill-search"
        aria-label="搜索技能"
        placeholder="搜索名称、用途或描述"
        value={query}
        onChange={event => setQuery(event.target.value)}
      />
      <div className="seal-harness-session-skill-list">
        {loading ? <div className="seal-harness-session-skill-state" role="status">正在读取技能…</div> : null}
        {!loading && error ? <div className="seal-harness-session-skill-state is-error" role="alert">{error}</div> : null}
        {!loading && !error && groups.map(group => <React.Fragment key={group.id}>
          <div className="seal-harness-session-skill-group">{group.title}</div>
          {group.items.map(skill => <button
            key={`${group.id}:${skill.name}`}
            type="button"
            className="seal-harness-session-skill-row"
            data-skill-candidate
            data-skill-name={skill.name}
            onClick={() => choose(skill)}
          >
            <IconSkillOutlineRegular size={17} aria-hidden="true" />
            <span className="seal-harness-session-skill-copy">
              <strong>{skill.name}</strong>
              {skill.description ? <small>{skill.description}</small> : null}
            </span>
            <span className="seal-harness-session-skill-add" aria-hidden="true">＋</span>
          </button>)}
        </React.Fragment>)}
        {!loading && !error && !visible.length ? <div className="seal-harness-session-skill-state">{needle ? '没有找到匹配的 Skill。' : '你还没有安装任何可运行的技能。去技能页安装后即可在会话中选用。'}</div> : null}
      </div>
      <div className="seal-harness-session-skill-divider" />
      <button type="button" className="seal-harness-session-skill-manage" onClick={() => { setOpen(false); selectPanel('seal-harness-skills') }}>打开技能页</button>
    </div>, document.body) : null}
  </div>
}

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
      const width = composerPopoverWidth({ composer, viewport: { width: window.innerWidth, height: window.innerHeight } })
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

function SelectorGroup({ api, inputActions, remoteSkills, selectPanel, sessionId }) {
  const actions = useMemo(() => createResourceActions({ inputActions, selectPanel }), [inputActions, selectPanel])
  return <div className="seal-harness-session-context-selectors" aria-label="会话资源选择器">
    {controls.map(({ id, label, ariaLabel, Icon }) => id === 'skill'
      ? <SkillSelector key={id} api={api} inputActions={inputActions} remoteSkills={remoteSkills} selectPanel={selectPanel} sessionId={sessionId} />
      : id === 'connector'
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

function createDeleteSessionDialog() {
  let request = null
  const listeners = new Set()
  const publish = next => {
    request = next
    for (const listener of listeners) listener()
  }
  return {
    open: next => publish(next),
    close: () => publish(null),
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener) },
    getSnapshot: () => request,
  }
}

function DeleteArchivedSessionMenuItem({ deleteDialog, displayTitle, sessionId, useMenuOpenState, workspaces }) {
  const [, setMenuOpen] = useMenuOpenState()
  const archived = workspaces.list.getSnapshot().archivedSessionIds.includes(sessionId)
  if (!archived) return null

  return <MenuItemButton
    danger
    separatorBefore
    icon={<IconTrashOutlineRegular size={14} />}
    onSelect={() => {
      deleteDialog.open({ sessionId, displayTitle: displayTitle || sessionId })
      setMenuOpen(false)
    }}
  >永久删除</MenuItemButton>
}

function DeleteSessionConfirmation({ api, deleteDialog }) {
  const request = useSyncExternalStore(deleteDialog.subscribe, deleteDialog.getSnapshot)
  const [deleting, setDeleting] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    setDeleting(false)
    setError('')
  }, [request?.sessionId])

  if (!request) return null

  const remove = async () => {
    setDeleting(true)
    setError('')
    try {
      await api('sessions/delete', { sessionId: request.sessionId })
      deleteDialog.close()
    } catch (cause) {
      setError(cause?.message ?? '永久删除失败，请重试。')
    } finally {
      setDeleting(false)
    }
  }

  return <Modal
      open
      onClose={() => { if (!deleting) deleteDialog.close() }}
      title="永久删除会话"
      closeLabel="关闭"
      description="此操作会永久删除本地会话记录，且无法恢复。"
      footer={<>
        <Button type="button" variant="outline" disabled={deleting} onClick={() => deleteDialog.close()}>取消</Button>
        <Button type="button" className="seal-harness-session-delete-confirm" disabled={deleting} onClick={() => void remove()}>{deleting ? '正在删除…' : '永久删除'}</Button>
      </>}
    >
      <p className="seal-harness-session-delete-copy">确定永久删除“{request.displayTitle}”吗？</p>
      {error ? <p className="seal-harness-session-delete-error" role="alert">{error}</p> : null}
    </Modal>
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
  const deleteDialog = createDeleteSessionDialog()
  function SessionContextSelectors({ inputActions, sessionId }) {
    return <SelectorGroup api={api} inputActions={inputActions} remoteSkills={ctx.remote.skills} selectPanel={selectPanel} sessionId={sessionId} />
  }
  ctx.slots.inject('conversation.input.left', () => ctx.slots.register({
    name: 'conversation.input.left',
    id: 'seal-harness-session-context-selector',
    order: 20,
    label: '会话资源',
  }, SessionContextSelectors))

  function DeleteSessionMenuItem(props) {
    return <DeleteArchivedSessionMenuItem deleteDialog={deleteDialog} workspaces={ctx.workspaces} {...props} />
  }
  ctx.slots.inject('sidebar.workspaces.session.menu.item', () => ctx.slots.register({
    name: 'sidebar.workspaces.session.menu.item',
    id: 'seal-harness-delete-session',
    order: 500,
    label: '永久删除会话',
  }, DeleteSessionMenuItem))

  function DeleteSessionOverlay() {
    return <DeleteSessionConfirmation api={api} deleteDialog={deleteDialog} />
  }
  ctx.slots.inject('shell.overlay', () => ctx.slots.register({
    name: 'shell.overlay',
    id: 'seal-harness-delete-session-confirmation',
    label: '永久删除会话确认',
  }, DeleteSessionOverlay))
}
