import React, { useEffect, useRef, useState } from 'react'
import { Dialog } from './dialog.jsx'
import { openNativeSession } from './native-client.js'
import { styles } from './styles.js'
import { AgentForm } from './form.jsx'
import { WorkflowDetail } from './workflow-detail.jsx'
import { RuntimeProgress } from './progress.jsx'
import { Icon } from '../../capability-shared/src/icons.jsx'
import { SyncRefresh } from '../../capability-shared/src/sync-refresh.jsx'
import { AnimatedSidebarIcon } from '../../capability-shared/src/sidebar-icons.jsx'
import { InstanceCard, IconButton, kinds, targets, isRunning, instanceKey } from './instance-card.jsx'
import { flowArtwork, autonomousArtwork } from './artwork.js'

export const inject = ['slots', 'connection', 'sessions', 'uiWorkspace']
const prefix = target => target === 'local' ? '' : `${target}-`

function TypeChooser({ onClose, onSelect }) {
  const [kind, setKind] = useState(null)
  return <Dialog onClose={onClose} initialFocus=".create-types button"><section className="create-dialog" role="dialog" aria-modal="true" aria-labelledby="za-type-title">
    <header><div><h2 id="za-type-title">新建智能体</h2><p>选择类型后进入对应配置流程</p></div><IconButton label="关闭" icon="close" onClick={onClose} /></header>
    <div className="create-types">{[['flow', flowArtwork, '按步骤编排，适合稳定复用的业务流程。'], ['autonomous', autonomousArtwork, '围绕目标自主规划，适合持续推进的复杂任务。']].map(([value, artwork, description]) => <button key={value} type="button" className={kind === value ? 'selected' : ''} aria-pressed={kind === value} onClick={() => setKind(value)}><img src={artwork} alt="" /><strong>{kinds[value]}智能体</strong><span>{description}</span></button>)}</div>
    <footer><button onClick={onClose}>取消</button><button className="primary" disabled={!kind} onClick={() => onSelect(kind)}>继续</button></footer>
  </section></Dialog>
}

export function AgentsPanel({ api }) {
  const [catalog, setCatalog] = useState(null), [error, setError] = useState(''), [pending, setPending] = useState(false)
  const [filter, setFilter] = useState('all'), [query, setQuery] = useState(''), [creating, setCreating] = useState(null)
  const [selected, setSelected] = useState(null), [deleting, setDeleting] = useState(null), [settings, setSettings] = useState(false)
  const controller = useRef(null), generation = useRef(0)
  const refresh = async () => {
    const current = ++generation.current
    try {
      const value = await api('catalog', {}, controller.current?.signal)
      if (current === generation.current) { setCatalog(value); setError('') }
    } catch (cause) { if (!controller.current?.signal.aborted && current === generation.current) setError(cause.message) }
  }
  useEffect(() => {
    const lifetime = new AbortController(); controller.current = lifetime
    void refresh()
    const timer = setInterval(() => void refresh(), 15000)
    return () => { lifetime.abort(); clearInterval(timer); generation.current++ }
  }, [])
  const run = async task => {
    setPending(true); setError('')
    try { await task(); if (task !== refresh) await refresh() } catch (cause) { setError(cause.message) } finally { setPending(false) }
  }
  const request = (item, action, extra = {}) => api('request', { kind: item.kind, target: item.target, request: { action: `${prefix(item.target)}${action}`, id: item.id, ...extra } })
  const act = (item, action) => void run(async () => {
    if (action === 'open') await api('open', { kind: item.kind, target: item.target, id: item.id })
    else if (action === 'chat' || action === 'api') await api('request', { kind: 'flow', target: 'local', request: { action: 'open', id: item.id, target: action } })
    else {
      const result = await request(item, action)
      if (result.operation?.state === 'failed') throw new Error(result.operation.error ?? result.operation.stage)
    }
    if (action === 'delete') { setDeleting(null); if (selected && instanceKey(selected) === instanceKey(item)) setSelected(null) }
  })
  const rename = async (item, name) => {
    setPending(true)
    try { await request(item, 'rename', { name }); await refresh() } finally { setPending(false) }
  }
  const instances = catalog?.instances ?? [], notices = catalog?.notices ?? []
  const count = value => !catalog ? '—' : notices.length ? `${value}+` : value
  const visible = kind => instances.filter(item => item.kind === kind && `${item.name} ${item.host ?? ''} ${targets[item.target]}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()))
  const summary = [['total', 'agents', '全部智能体', instances.length], ['running', 'play-circle', '运行中', instances.filter(isRunning).length], ['stopped', 'stop', '已停止', instances.filter(item => item.status === 'stopped').length], ['attention', 'info', '需要处理', instances.filter(item => ['unavailable', 'incomplete'].includes(item.status)).length]]
  const detail = selected && instances.find(item => instanceKey(item) === instanceKey(selected))
  return <main className="zz-agents zz-resource-page">
    {detail && <WorkflowDetail api={api} instance={detail} instances={instances.filter(item => item.kind === 'flow' && item.target === 'local')} busy={pending} error={error} onSelect={setSelected} onBack={() => setSelected(null)} onAction={act} onDelete={setDeleting} onRefresh={() => void run(refresh)} />}
    <div className="instance-center" aria-busy={pending} hidden={!!detail}>
    <header className="feature-page-header"><div className="feature-page-header__copy"><h1>我的智能体</h1><p>统一管理流程型与自主型智能体，按类型查看实例并进入对应管理页面继续配置。</p></div><div className="center-actions"><SyncRefresh state={pending || !catalog && !error ? 'loading' : error ? 'error' : notices.length ? 'warning' : 'ready'} label="刷新智能体状态" disabled={pending} onRefresh={() => void run(refresh)} /><IconButton label="设置" icon="settings" className="center-icon-button" onClick={() => setSettings(true)} /><button className="primary" onClick={() => setCreating('type')}>新建智能体</button></div></header>
    <section className="center-status-summary" aria-label="智能体运行状态"><h2>运行概览</h2><dl className="overview-stats">{summary.map(([style, icon, label, value]) => <div className="overview-stat" key={style}><span className={`overview-icon ${style}`}><Icon name={icon} size={24} /></span><div><dt>{label}</dt><dd>{count(value)}</dd></div></div>)}</dl></section>
    {error && <div className="center-alert" role="alert"><Icon name="info" size={16} /><span>{error}</span><button disabled={pending} onClick={() => void run(refresh)}>重试</button></div>}
    {notices.map(notice => <p className="center-sync-note" key={`${notice.kind}-${notice.target}`} role="status"><Icon name={notice.target === 'platform' ? 'cloud' : 'info'} size={14} />{kinds[notice.kind]} · {targets[notice.target]}：{notice.message}</p>)}
    {(catalog?.operations ?? []).filter(operation => operation.state !== 'succeeded').map(operation => <RuntimeProgress key={`${operation.kind}-${operation.target}`} operation={operation} title={`${kinds[operation.kind]} · ${targets[operation.target]}`} />)}
    <section className="center-toolbar" aria-label="筛选智能体"><div className="center-tabs" aria-label="智能体类型">{[['all', '全部'], ['flow', '流程型'], ['autonomous', '自主型']].map(([value, label]) => <button key={value} aria-pressed={filter === value} onClick={() => setFilter(value)}>{label} <span className="tab-count">{count(value === 'all' ? instances.length : instances.filter(item => item.kind === value).length)}</span></button>)}</div>{(instances.length >= 5 || query) && <label className="center-search"><span className="sr-only">搜索智能体</span><input type="search" placeholder="搜索名称或用途" value={query} onChange={event => setQuery(event.target.value)} /></label>}</section>
    {['flow', 'autonomous'].filter(kind => filter === 'all' || filter === kind).map(kind => <section className="center-group" key={kind} aria-labelledby={`za-group-${kind}`}><header><div><h2 id={`za-group-${kind}`}><span className={`type-dot ${kind}`} />{kinds[kind]}智能体</h2><p>{kind === 'flow' ? '按步骤编排，适合稳定复用的业务流程' : '围绕目标自主规划，适合持续推进的复杂任务'}</p></div><span>{catalog ? `${visible(kind).length} 个实例` : '正在读取…'}</span></header>
      {!catalog ? <div className="group-loading" role="status"><Icon name={kind === 'flow' ? 'automation' : 'thinking'} />{error ? '实例目录读取失败，请重试。' : `正在读取${kinds[kind]}实例…`}</div> : visible(kind).length ? <div className={`center-cards${kind === 'autonomous' ? ' center-cards--autonomous' : ''}`}>{visible(kind).map(item => <InstanceCard key={instanceKey(item)} item={item} busy={pending} onAction={act} onDelete={setDeleting} onRename={rename} onManage={setSelected} />)}</div> : <div className="center-empty">{query ? `没有匹配的${kinds[kind]}智能体` : notices.some(notice => notice.kind === kind) ? '部分实例目录暂时无法读取，请刷新状态重试。' : `还没有${kinds[kind]}智能体`}</div>}
    </section>)}
    </div>
    {creating === 'type' && <TypeChooser onClose={() => setCreating(null)} onSelect={setCreating} />}
    {creating && creating !== 'type' && <AgentForm api={api} initialKind={creating} instances={instances} onClose={() => setCreating(null)} onCreated={() => { setCreating(null); void refresh() }} />}
    {deleting && <Dialog onClose={() => setDeleting(null)} busy={pending}><div className="agent-local-ui"><section role="alertdialog" aria-modal="true" aria-labelledby="za-delete-title" className="za-dialog delete-confirmation"><h3 id="za-delete-title">{deleting.native ? '删除' : '永久删除'}「{deleting.name}」？</h3><p>{deleting.native ? '移除实例记录，原生对话历史保留。' : '实例运行服务、专属网络、工作台记录以及全部实例数据都会被永久删除。'}</p><div className="delete-warning"><strong>此操作无法撤销</strong><span>{deleting.native ? '删除后需重新创建智能体实例。' : '删除后不能恢复智能体配置、历史记录和运行数据。'}</span></div>{error && <p role="alert" className="za-error">{error}</p>}<div className="delete-actions"><button disabled={pending} onClick={() => setDeleting(null)}>取消</button><button disabled={pending} className="danger-button" onClick={() => act(deleting, 'delete')}>{pending ? '正在删除…' : '删除实例'}</button></div></section></div></Dialog>}
    {settings && <Dialog onClose={() => setSettings(false)}><section className="settings-dialog" role="dialog" aria-modal="true" aria-labelledby="za-settings-title"><header><h2 id="za-settings-title">设置</h2><IconButton label="关闭" icon="close" onClick={() => setSettings(false)} /></header><div className="settings-dialog-body"><section className="settings-local-runtime"><div><h3>本机运行组件</h3><p>自主型智能体使用原生对话；流程型使用应用运行组件。</p><code>{catalog?.services.workflowRuntimePackDirectory || '应用随附组件'}</code></div></section><h3>智枢托管地址</h3><code>{catalog?.services.terminalBaseUrl || '未配置'}</code><p>服务地址与流程运行组件目录由统一 services.yml 管理。</p></div><footer><button onClick={() => setSettings(false)}>完成</button></footer></section></Dialog>}
  </main>
}

export function apply(ctx) {
  const api = async (action, payload = {}, signal) => {
    const result = await ctx.connection.rpc.call('/api', `seal-harness-agents/${action}`, payload, signal)
    if (!result.ok) throw Object.assign(new Error(result.error.message), { code: result.error.code })
    if (result.value?.sessionId) await openNativeSession(ctx, result.value.sessionId, signal)
    return result.value
  }
  ctx.effect(() => { const style = document.createElement('style'); style.textContent = styles; document.head.append(style); return () => style.remove() }, 'seal-harness-agents styles')
  function Panel() { return <AgentsPanel api={api} /> }
  function SidebarIcon(props) { return <AnimatedSidebarIcon name="agents" {...props} /> }
  ctx.slots.inject('main', () => ctx.slots.register({ name: 'main', key: 'seal-harness-agents' }, Panel))
  ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({ name: 'sidebar.panellist', id: 'seal-harness-agents', order: 70, label: () => '智能体' }, SidebarIcon))
}
