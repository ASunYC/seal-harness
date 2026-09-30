import React, { useEffect, useRef, useState } from 'react'
import { Icon } from '../../capability-shared/src/icons.jsx'
import { SyncRefresh } from '../../capability-shared/src/sync-refresh.jsx'
import { ConnectorEditor } from './editor.jsx'
import { ConnectorRuntime, ConnectorCredentials, ConnectorWorkspace, ConnectorTools, statusLabels, statusTone } from './details.jsx'
import { Dialog } from './dialog.jsx'
import { CatalogIcon } from './catalog-icon.jsx'
import { styles } from './styles.js'

function InstalledCard({ item, open, api, compact = false }) {
  return <article className={`mcp-installed-card${compact ? ' mcp-installed-card--drawer' : ''}`}><button className="mcp-installed-card__identity" onClick={() => open('runtime', item.id)} aria-label={`管理 ${item.name}`}><span className="mcp-installed-card__icon">{item.source?.centerId ? <CatalogIcon api={api} connectorId={item.source.centerId} size={42} /> : item.name.slice(0, 1)}</span><span className="mcp-installed-card__copy"><strong>{item.name}</strong><small>{item.summary || (item.transport === 'stdio' ? item.command : item.url)}</small></span></button><div className="mcp-installed-card__context"><span>{item.category === 'development' ? '开发类' : '办公类'}</span><span>{item.source ? `v${item.source.version}` : '本地'}</span><span>{item.tools.length} 个工具</span><span>{item.checkedAt ? `最近检查 ${new Date(item.checkedAt).toLocaleString()}` : '尚未完成连接检查'}</span></div><footer className="mcp-installed-card__footer"><span className="mcp-status" data-tone={statusTone(item.status)}>{statusLabels[item.status]}</span><div className="mcp-installed-card__actions"><button className="mcp-installed-card__icon-action" type="button" aria-label="查看工具" title={`查看${item.name}的工具`} onClick={() => open('tools', item.id)}><Icon name="mcp-eye" size={18} strokeWidth={1.7} /></button><button className="mcp-installed-card__icon-action mcp-installed-card__icon-action--danger" type="button" aria-label="卸载连接器" title={`卸载${item.name}`} onClick={() => open('remove', item.id)}><Icon name="mcp-trash" size={18} strokeWidth={1.7} /></button><button className="mcp-installed-card__icon-action" type="button" aria-label="更多操作" title={`更多${item.name}设置`} onClick={() => open('runtime', item.id)}><Icon name="mcp-more" size={18} strokeWidth={1.7} /></button></div></footer></article>
}

function PublicCard({ item, api, installed, busy, open, install }) {
  const center = item.catalogProvider === 'mcp_center'
  const version = item.latestVersion?.version ?? item.version
  const toolCount = item.toolCount ?? item.metadata?.toolCount
  return <article className="mcp-public-card">
    <button className="mcp-public-card__identity" type="button" onClick={() => open(item)} aria-label={`查看 ${item.name} 详情`}>
      {center ? <CatalogIcon api={api} connectorId={item.connectorId} iconRevision={item.iconRevision} size={40} /> : <span className="mcp-public-card__fallback"><Icon name="connectors" size={22} /></span>}
      <strong>{item.name}</strong>
    </button>
    <p className="mcp-public-card__summary" title={item.summary}>{item.summary || '暂无描述'}</p>
    <div className="mcp-public-card__tags"><span>{item.category === 'development' ? '开发类' : '办公类'}</span><span>HTTP</span>{version && <span>v{version}</span>}<span>{toolCount ?? 0} 个工具</span></div>
    <footer><span>{center ? 'MCP Center' : item.publisherTeam || '公开目录'}</span><button className="btn btn--primary" disabled={busy} onClick={() => installed ? open(item) : install(item)}>{installed ? '查看' : '安装'}</button></footer>
  </article>
}

function DirectoryTabs({ value, disabled, onChange }) {
  const items = { public: '公开', personal: '个人', authorized: '被授权' }
  return <nav className="connector-directory-tabs" aria-label="连接器目录范围" role="tablist" onKeyDown={event => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
    const buttons = [...event.currentTarget.querySelectorAll('[role=tab]')]
    const index = buttons.indexOf(event.target)
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : (index + (event.key === 'ArrowRight' ? 1 : -1) + buttons.length) % buttons.length
    event.preventDefault(); buttons[next]?.click(); buttons[next]?.focus()
  }}>{Object.entries(items).map(([key, label]) => <button key={key} type="button" role="tab" aria-selected={value === key} aria-controls={`zz-connector-${key}`} tabIndex={value === key ? 0 : -1} disabled={disabled} onClick={() => onChange(key)}>{label}</button>)}</nav>
}

function mergeCatalogItems(published, center) {
  const keyOf = item => item.name.normalize('NFKC').replace(/\s+/g, '').toLocaleLowerCase()
  const merged = new Map(center.map(item => [keyOf(item), { ...item, id: `mcp-center:${item.connectorId}`, catalogProvider: 'mcp_center', latestVersion: { version: item.version, status: 'published' }, versions: [{ version: item.version, status: 'published' }] }]))
  for (const item of published) if (!merged.has(keyOf(item))) merged.set(keyOf(item), { ...item, catalogProvider: 'store' })
  return [...merged.values()]
}

export function ConnectorsPanel({ api, signedIn = false, openLogin, onBack, workspaces = [] }) {
  const [snapshot, setSnapshot] = useState({ items: [] }), [loading, setLoading] = useState(true)
  const [pageError, setPageError] = useState(''), [modalError, setModalError] = useState('')
  const [busy, setBusy] = useState(false), [modal, setModal] = useState(null)
  const [category, setCategory] = useState('all')
  const [directory, setDirectory] = useState('public')
  const [query, setQuery] = useState(''), [installedQuery, setInstalledQuery] = useState('')
  const [catalog, setCatalog] = useState({ state: signedIn ? 'loading' : 'signed-out', items: [] }), [asset, setAsset] = useState(null)
  const controller = useRef(null), catalogRequest = useRef(null)
  useEffect(() => {
    const abort = new AbortController()
    api('connectors/list', {}, abort.signal).then(value => { if (!abort.signal.aborted) setSnapshot(value) }).catch(failure => { if (!abort.signal.aborted) setPageError(failure.message) }).finally(() => { if (!abort.signal.aborted) setLoading(false) })
    if (signedIn) void loadCatalog()
    else setCatalog({ state: 'signed-out', items: [] })
    return () => { abort.abort(); controller.current?.abort(); catalogRequest.current?.abort() }
  }, [api, signedIn])
  async function run(action, payload = {}, scope = 'modal') {
    const setError = scope === 'page' ? setPageError : setModalError
    setBusy(true); setError('')
    try { setSnapshot(await api(`connectors/${action}`, payload)); return true } catch (failure) { setError(failure.message); return false } finally { setBusy(false) }
  }
  async function request(action, payload) {
    setBusy(true); setModalError('')
    try { return await api(`connectors/${action}`, payload) } catch (failure) { setModalError(failure.message); throw failure } finally { setBusy(false) }
  }
  async function authorize(item) {
    setBusy(true); setModalError('')
    try { return await api('connectors/authorize', { id: item.id, revision: item.revision }) } catch (failure) { setModalError(failure.message) } finally { setBusy(false) }
  }
  function open(kind, id) { setModalError(''); setModal({ kind, id }) }
  async function loadCatalog() {
    if (!signedIn) return
    catalogRequest.current?.abort(); const abort = new AbortController(); catalogRequest.current = abort
    setCatalog(current => ({ ...current, state: 'loading' }))
    try {
      const [published, center] = await Promise.allSettled([
        api('store/list', { collection: 'mcps', scope: 'published' }, abort.signal),
        api('store/center', {}, abort.signal),
      ])
      if (abort.signal.aborted) return
      if (published.status === 'rejected' && center.status === 'rejected') throw published.reason
      const items = mergeCatalogItems(
        published.status === 'fulfilled' ? published.value : [],
        center.status === 'fulfilled' ? center.value : [],
      )
      setCatalog({ state: 'ready', items })
    } catch (failure) { if (!abort.signal.aborted) setCatalog(current => ({ ...current, state: 'error', error: failure.message })) }
  }
  async function openAsset(item) {
    controller.current?.abort(); const abort = new AbortController(); controller.current = abort
    setAsset({ state: 'loading', name: item.name }); setModalError('')
    if (item.catalogProvider === 'mcp_center') { setAsset({ state: 'ready', ...item }); return }
    try { const value = await api('store/detail', { collection: 'mcps', id: item.id }, abort.signal); if (!abort.signal.aborted) setAsset({ state: 'ready', ...value }) } catch (failure) { if (!abort.signal.aborted) setAsset({ state: 'error', name: item.name, error: failure.message }) }
  }
  const installAsset = item => item.catalogProvider === 'mcp_center'
    ? run('installCenter', { connectorId: item.connectorId })
    : run('install', { id: item.id, version: item.latestVersion.version })
  const matches = (item, text = query) => `${item.name} ${item.url ?? ''} ${item.command ?? ''} ${item.summary ?? ''}`.toLowerCase().includes(text.trim().toLowerCase())
  const selected = snapshot.items.find(item => item.id === modal?.id)
  const local = snapshot.items.filter(item => !item.source && matches(item) && (category === 'all' || item.category === category))
  const publicItems = catalog.items.filter(item => matches(item) && (category === 'all' || item.category === category))
  const installed = snapshot.items.filter(item => matches(item, installedQuery))
  return <section className="zz-resource-page zz-connectors capability-page resource-page-shell" aria-label="连接器" aria-busy={busy || loading}>
    <style>{styles}</style>
    <header className="resource-page-nav"><div className="resource-page-nav__path">{onBack && <button type="button" className="resource-page-nav__back" aria-label="返回会话，离开连接器页" title="返回会话，离开连接器页" onClick={onBack}><Icon name="back" size={17} /></button>}<strong>连接器</strong><span className="resource-page-nav__badge">RESOURCE</span></div><div className="header-actions"><SyncRefresh state={loading || catalog.state === 'loading' ? 'loading' : pageError || catalog.state === 'error' ? 'error' : catalog.state === 'signed-out' ? 'offline' : 'ready'} label="刷新连接器目录" disabled={busy} onRefresh={() => { void run('list', {}, 'page'); void loadCatalog() }} /><button className="btn btn--primary" onClick={() => open('create')}>创建连接器</button><button className="btn btn--secondary" aria-haspopup="dialog" aria-expanded={modal?.kind === 'installed'} onClick={() => open('installed')}>已安装 <span>{snapshot.items.length}</span></button></div></header>
    <div className="capability-page__content"><section className="resource-page-hero"><div className="resource-page-hero__copy"><p className="resource-page-hero__eyebrow">WORKBENCH RESOURCE</p><h1>连接器</h1><p className="resource-page-hero__subtitle">添加团队数据和工具，让专家在你的授权下安全使用。</p></div><label className="zz-directory-search"><span>搜索连接器</span><Icon name="search" size={16} /><input type="search" placeholder="搜索连接器名称、描述或地址" value={query} onChange={event => setQuery(event.target.value)} />{query && <button type="button" className="zz-search-clear" aria-label="清除搜索" onClick={() => setQuery('')}><Icon name="close" size={15} /></button>}</label></section>
      {!modal && !asset && pageError && <div className="mcp-alert" role="alert">{pageError}<button className="btn btn--secondary" onClick={() => run('list', {}, 'page')}>重试</button></div>}{snapshot.issue && <p className="mcp-alert" role="status">{snapshot.issue}</p>}
      <section className="capability-featured-scenes"><header className="capability-featured-scenes__header"><h2>精选场景</h2><p>从工作方式出发，快速找到合适的能力。</p></header><div className="capability-featured-scenes__grid">{[['office', '办公类', '文档、表格、演示与日常协作'], ['development', '开发类', '编码、调试、评审与自动化']].map(([id, title, description]) => <button key={id} className={`capability-featured-scene ${category === id ? 'is-selected' : ''}`} aria-pressed={category === id} onClick={() => setCategory(category === id ? 'all' : id)}><span className="capability-featured-scene__icon" aria-hidden="true"><Icon name={category === id ? 'check' : id === 'office' ? 'scene-office' : 'scene-development'} size={22} strokeWidth={1.65} /></span><span className="capability-featured-scene__copy"><strong>{title}</strong><span>{description}</span></span><span className="capability-featured-scene__count">{catalog.items.filter(item => item.category === id).length}</span></button>)}</div></section>
      <section className="capability-installed"><header className="capability-installed__header"><h2>已安装</h2><span>{snapshot.items.length}</span></header><div className="capability-installed__rail">{snapshot.items.map(item => <button key={item.id} title={item.name} aria-label={`管理已安装连接器 ${item.name}`} onClick={() => open('runtime', item.id)}><Icon name="connectors" size={20} /></button>)}{!snapshot.items.length && <button className="capability-installed__empty" onClick={() => open('installed')}>{loading ? '正在读取…' : '暂无已安装连接器'}</button>}</div></section>
      <DirectoryTabs value={directory} disabled={busy} onChange={setDirectory} />
      {directory === 'personal' && <section id="zz-connector-personal" role="tabpanel" className="zz-directory-section"><header><div><h2>个人 <span>{local.length}</span></h2><p>管理你在本机创建的连接器。</p></div></header>{loading ? <p className="mcp-empty-state" role="status">正在加载连接器…</p> : pageError && !snapshot.items.length ? <p className="mcp-empty-state">连接器暂时读不到，请重试。</p> : local.length ? <div className="mcp-installed__list">{local.map(item => <InstalledCard key={item.id} item={item} open={open} api={api} />)}</div> : <div className="mcp-empty-state"><strong>{query ? '没有匹配的个人连接器' : '你还没有创建连接器'}</strong><p>{query ? '试试更换关键词。' : '创建一个 MCP 连接器，接入你的数据和工具。'}</p><button className="btn btn--secondary" onClick={() => query ? setQuery('') : open('create')}>{query ? '清除搜索' : '创建连接器'}</button></div>}</section>}
      {directory === 'authorized' && <section id="zz-connector-authorized" role="tabpanel" className="zz-directory-section"><header><div><h2>被授权</h2><p>查看通过用户或部门分享给你的连接器。</p></div></header><div className="zz-directory-placeholder"><strong>被授权连接器即将开放</strong><p>当前版本暂无可用数据。</p></div></section>}
      {directory === 'public' && <section id="zz-connector-public" role="tabpanel" className="zz-directory-section"><header><div><h2>公开 <span>{catalog.state === 'ready' ? publicItems.length : ''}</span></h2><p>浏览公开的连接器，了解用途后即可安装。</p></div></header>
        {catalog.state === 'signed-out' && <div className="zz-directory-placeholder"><p>登录后浏览公开目录，本地资源仍可使用。</p>{openLogin && <button className="btn btn--secondary" onClick={openLogin}>去登录</button>}</div>}{catalog.state === 'loading' && <p role="status" className="mcp-empty-state">正在读取公开目录…</p>}{catalog.state === 'error' && <div role="alert" className="mcp-alert"><strong>公开目录暂时读不到</strong><p>{catalog.error}</p><button className="btn btn--secondary" onClick={loadCatalog}>重试</button></div>}
        {catalog.state === 'ready' && !publicItems.length && <div className="mcp-empty-state">{query ? '没有匹配的公开连接器' : '公开目录暂时为空'}</div>}
        <div className="mcp-public-grid">{publicItems.map(item => <PublicCard key={item.id} item={item} api={api} busy={busy} open={openAsset} install={installAsset} installed={snapshot.items.some(local => item.catalogProvider === 'mcp_center' ? local.source?.centerId === item.connectorId : local.source?.id === item.id)} />)}</div>
      </section>}
    </div>
    {modal?.kind === 'installed' && <Dialog closeIconName="mcp-close-small" closeIconStrokeWidth={1.6} title="已安装" className="zz-installed-drawer" busy={busy} close={() => setModal(null)} renderHeader={titleId => <header className="zz-installed-drawer__header"><div><h2 id={titleId}>已安装</h2><p>共 {snapshot.items.length} 个已安装连接器</p></div><button type="button" className="btn btn--secondary zz-installed-drawer__close" aria-label="关闭已安装" onClick={() => setModal(null)}><Icon name="mcp-close-small" size={18} strokeWidth={1.6} /></button></header>}><div className="mcp-installed-drawer__body"><label className="zz-directory-search"><span>搜索已安装连接器</span><Icon name="mcp-search" size={18} strokeWidth={1.6} /><input type="search" placeholder="搜索已安装连接器" value={installedQuery} onChange={event => setInstalledQuery(event.target.value)} /></label><div className="zz-installed-drawer__toolbar"><button type="button" className="btn btn--secondary" onClick={() => { setDirectory('personal'); setModal(null) }}>批量管理</button></div><div className="mcp-installed__list">{installed.map(item => <InstalledCard compact key={item.id} item={item} open={open} api={api} />)}</div>{!installed.length && <p className="mcp-empty-state">{snapshot.items.length ? '没有符合条件的连接器。' : '还没有安装连接器。创建一个，或在公开目录选择适合的连接器。'}</p>}</div><footer className="zz-installed-drawer__footer">是否用于对话，请在会话窗口的“连接器”菜单中选择。</footer></Dialog>}
    {(modal?.kind === 'create' || modal?.kind === 'edit' && selected) && <ConnectorEditor key={selected?.id ?? 'new'} item={selected} busy={busy} error={modalError} close={() => setModal(null)} inspectPackage={payload => request('inspectPackage', payload)} savePackage={async payload => {
      try { const value = await request('importPackage', payload); setSnapshot(value); setModal({ kind: 'runtime', id: value.importedId }) } catch { /* 错误保留在当前安装表单中。 */ }
    }} checkConnection={payload => request('checkConnection', payload)} save={async payload => { if (await run('save', payload)) setModal({ kind: 'runtime', id: payload.id }) }} />}
    {selected && ['runtime', 'remove'].includes(modal.kind) && <ConnectorRuntime key={`${selected.id}-${modal.kind}`} confirmRemove={modal.kind === 'remove'} item={selected} api={api} busy={busy} error={modalError} run={run} open={kind => open(kind, selected.id)} close={() => setModal(null)} />}
    {selected && modal.kind === 'credentials' && <ConnectorCredentials key={selected.id} item={selected} busy={busy} error={modalError} run={run} authorize={authorize} close={() => open('runtime', selected.id)} />}
    {selected && modal.kind === 'workspace' && <ConnectorWorkspace key={selected.id} item={selected} workspaces={workspaces} busy={busy} error={modalError} run={run} close={() => open('runtime', selected.id)} />}
    {selected && modal.kind === 'tools' && <ConnectorTools key={selected.id} item={selected} busy={busy} error={modalError} run={run} api={api} close={() => open('runtime', selected.id)} />}
    {asset && <Dialog title={asset.name || '连接器详情'} className="mcp-dialog mcp-dialog--narrow" busy={busy} close={() => { controller.current?.abort(); setAsset(null); setModalError('') }}><div className="mcp-dialog__body mcp-stack">{asset.state === 'loading' ? <p role="status">正在读取详情…</p> : asset.state === 'error' ? <p role="alert">{asset.error}</p> : <><div className="mcp-public-detail__identity">{asset.catalogProvider === 'mcp_center' ? <CatalogIcon api={api} connectorId={asset.connectorId} iconRevision={asset.iconRevision} size={48} /> : <span className="mcp-public-card__fallback"><Icon name="connectors" size={24} /></span>}<div><small>{asset.catalogProvider === 'mcp_center' ? 'MCP Center' : asset.publisherTeam || '公开连接器'}</small><h3>{asset.name}</h3></div></div><p>{asset.summary}</p><div className="mcp-public-card__tags"><span>{asset.category === 'development' ? '开发类' : '办公类'}</span><span>HTTP</span><span>v{asset.latestVersion?.version ?? asset.version}</span><span>{asset.toolCount ?? asset.metadata?.toolCount ?? 0} 个工具</span></div>{modalError && <p role="alert" className="mcp-alert">{modalError}</p>}<button className="btn btn--primary" disabled={busy || snapshot.items.some(item => asset.catalogProvider === 'mcp_center' ? item.source?.centerId === asset.connectorId : item.source?.id === asset.id)} onClick={() => installAsset(asset)}>安装连接器</button></>}</div></Dialog>}
  </section>
}
