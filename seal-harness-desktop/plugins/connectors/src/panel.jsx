import React, { useEffect, useState } from 'react'
import { Icon } from '../../capability-shared/src/icons.jsx'
import { ConnectorEditor } from './editor.jsx'
import { ConnectorRuntime, ConnectorCredentials, ConnectorWorkspace, ConnectorTools, statusLabels, statusTone } from './details.jsx'
import { Dialog } from './dialog.jsx'
import { CatalogIcon } from './catalog-icon.jsx'
import { styles } from './styles.js'

function InstalledCard({ item, open, api }) {
  return <article className="mcp-installed-card">
    <button className="mcp-installed-card__identity" onClick={() => open('runtime', item.id)} aria-label={`管理 ${item.name}`}>
      <span className="mcp-installed-card__icon">{item.source?.centerId ? <CatalogIcon api={api} connectorId={item.source.centerId} size={42} /> : item.name.slice(0, 1)}</span>
      <span className="mcp-installed-card__copy"><strong>{item.name}</strong><small>{item.summary || (item.transport === 'stdio' ? item.command : item.url)}</small></span>
    </button>
    <div className="mcp-installed-card__context"><span>{item.category === 'development' ? '开发类' : '办公类'}</span><span>{item.source ? `v${item.source.version}` : '本地'}</span><span>{item.tools.length} 个工具</span></div>
    <footer className="mcp-installed-card__footer"><span className="mcp-status" data-tone={statusTone(item.status)}>{statusLabels[item.status]}</span><div className="mcp-installed-card__actions"><button className="mcp-installed-card__icon-action" type="button" aria-label={`查看 ${item.name} 工具`} onClick={() => open('tools', item.id)}><Icon name="mcp-eye" size={18} /></button><button className="mcp-installed-card__icon-action" type="button" aria-label={`更多 ${item.name} 操作`} onClick={() => open('runtime', item.id)}><Icon name="mcp-more" size={18} /></button></div></footer>
  </article>
}

function DraftCard({ item, busy, install, remove }) {
  return <article className="mcp-installed-card mcp-draft-card"><div className="mcp-installed-card__identity"><span className="mcp-installed-card__icon">{item.name.slice(0, 1)}</span><span className="mcp-installed-card__copy"><strong>{item.name}</strong><small>{item.summary || (item.transport === 'stdio' ? item.command : item.url)}</small></span></div><footer className="mcp-installed-card__footer"><span className="mcp-status">未安装</span><div className="mcp-installed-card__actions"><button className="btn btn--primary" disabled={busy} onClick={() => install(item)}>安装</button><button className="btn btn--secondary" disabled={busy} onClick={() => remove(item)}>删除</button></div></footer></article>
}

export function ConnectorsPanel({ api, onBack, workspaces = [], startConnectorCreation }) {
  const [snapshot, setSnapshot] = useState({ items: [] })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [modalError, setModalError] = useState('')
  const [busy, setBusy] = useState(false)
  const [modal, setModal] = useState(null)
  const [tab, setTab] = useState('system')
  const [query, setQuery] = useState('')
  useEffect(() => {
    const abort = new AbortController()
    api('connectors/list', {}, abort.signal).then(value => { if (!abort.signal.aborted) setSnapshot(value) }).catch(failure => { if (!abort.signal.aborted) setError(failure.message) }).finally(() => { if (!abort.signal.aborted) setLoading(false) })
    return () => abort.abort()
  }, [api])
  async function run(action, payload = {}) {
    setBusy(true); setModalError(''); setError('')
    try { setSnapshot(await api(`connectors/${action}`, payload)); return true }
    catch (failure) { setModalError(failure.message); setError(failure.message); return false }
    finally { setBusy(false) }
  }
  async function request(action, payload) {
    setBusy(true); setModalError('')
    try { return await api(`connectors/${action}`, payload) }
    catch (failure) { setModalError(failure.message); throw failure }
    finally { setBusy(false) }
  }
  async function authorize(item) {
    setBusy(true); setModalError('')
    try { return await api('connectors/authorize', { id: item.id, revision: item.revision }) }
    catch (failure) { setModalError(failure.message) }
    finally { setBusy(false) }
  }
  function open(kind, id) { setModalError(''); setModal({ kind, id }) }
  const matches = item => `${item.name} ${item.summary ?? ''} ${item.url ?? ''} ${item.command ?? ''}`.toLowerCase().includes(query.trim().toLowerCase())
  const installed = snapshot.items.filter(item => item.installed !== false)
  const personal = snapshot.items.filter(item => !item.source && matches(item))
  const selected = snapshot.items.find(item => item.id === modal?.id)
  const install = item => run('installPersonal', { id: item.id, revision: item.revision })
  return <section className="zz-resource-page zz-connectors capability-page resource-page-shell" aria-label="连接器" aria-busy={busy || loading}>
    <style>{styles}</style>
    <header className="resource-page-nav"><div className="resource-page-nav__path">{onBack && <button type="button" className="resource-page-nav__back" aria-label="返回会话，离开连接器页" onClick={onBack}><Icon name="back" size={17} /></button>}<strong>连接器</strong><span className="resource-page-nav__badge">RESOURCE</span></div><div className="header-actions"><button className="btn btn--primary" disabled={busy} onClick={async () => { try { await startConnectorCreation() } catch (failure) { setError(failure.message) } }}>创建连接器</button><button className="btn btn--secondary" disabled={busy} onClick={() => open('import')}>导入连接器</button></div></header>
    <div className="capability-page__content"><section className="resource-page-hero"><div className="resource-page-hero__copy"><h1>连接器</h1><p className="resource-page-hero__subtitle">连接本机工具与服务，在会话中按需使用。</p></div></section>
      {error && <div className="mcp-alert" role="alert">{error}<button className="btn btn--secondary" onClick={async () => { setError(''); try { setSnapshot(await api('connectors/list')) } catch (failure) { setError(failure.message) } }}>重试</button></div>}{snapshot.issue && <p className="mcp-alert" role="status">{snapshot.issue}</p>}
      <section className="connector-installed-section" aria-label="已安装连接器"><header><h2>已安装 <small>{installed.length}</small></h2></header>{loading ? <p role="status">正在读取连接器…</p> : installed.length ? <div className="mcp-installed__list">{installed.map(item => <InstalledCard key={item.id} item={item} open={open} api={api} />)}</div> : <div className="mcp-empty-state"><strong>还没有安装连接器</strong><p>可以从个人连接器安装，或导入连接器包。</p></div>}</section>
      <section className="connector-library" aria-label="连接器分类"><nav className="connector-directory-tabs" role="tablist" aria-label="连接器分类"><button role="tab" aria-selected={tab === 'system'} onClick={() => setTab('system')}>系统</button><button role="tab" aria-selected={tab === 'personal'} onClick={() => setTab('personal')}>个人</button></nav>{tab === 'system' ? <div className="mcp-empty-state"><strong>暂无系统连接器</strong><p>系统连接器上线后将在这里显示。</p></div> : <><label className="zz-directory-search"><span>搜索个人连接器</span><Icon name="search" size={16} /><input type="search" placeholder="搜索连接器名称或地址" value={query} onChange={event => setQuery(event.target.value)} /></label>{personal.length ? <div className="mcp-installed__list">{personal.map(item => item.installed === false ? <DraftCard key={item.id} item={item} busy={busy} install={install} remove={entry => open('removeDraft', entry.id)} /> : <InstalledCard key={item.id} item={item} open={open} api={api} />)}</div> : <div className="mcp-empty-state"><strong>{query ? '没有匹配的个人连接器' : '还没有个人连接器'}</strong><p>点击右上角「创建连接器」，在会话中描述你需要的连接方式。</p></div>}</>}</section>
    </div>
    {modal?.kind === 'import' && <ConnectorEditor key="import" importOnly busy={busy} error={modalError} close={() => setModal(null)} inspectPackage={payload => request('inspectPackage', payload)} savePackage={async payload => { try { const value = await request('importPackage', payload); setSnapshot(value); setModal({ kind: 'runtime', id: value.importedId }) } catch { /* 表单展示错误。 */ } }} checkConnection={payload => request('checkConnection', payload)} save={async payload => { if (await run('save', payload)) setModal(null) }} />}
    {modal?.kind === 'edit' && selected && <ConnectorEditor key={selected.id} item={selected} busy={busy} error={modalError} close={() => setModal(null)} inspectPackage={payload => request('inspectPackage', payload)} savePackage={async payload => { try { const value = await request('importPackage', payload); setSnapshot(value); setModal({ kind: 'runtime', id: value.importedId }) } catch { /* 表单展示错误。 */ } }} checkConnection={payload => request('checkConnection', payload)} save={async payload => { if (await run('save', payload)) setModal({ kind: 'runtime', id: payload.id }) }} />}
    {selected && ['runtime', 'remove'].includes(modal.kind) && <ConnectorRuntime key={`${selected.id}-${modal.kind}`} confirmRemove={modal.kind === 'remove'} item={selected} api={api} busy={busy} error={modalError} run={run} open={kind => open(kind, selected.id)} close={() => setModal(null)} />}
    {selected && modal.kind === 'credentials' && <ConnectorCredentials key={selected.id} item={selected} busy={busy} error={modalError} run={run} authorize={authorize} close={() => open('runtime', selected.id)} />}
    {selected && modal.kind === 'workspace' && <ConnectorWorkspace key={selected.id} item={selected} workspaces={workspaces} busy={busy} error={modalError} run={run} close={() => open('runtime', selected.id)} />}
    {selected && modal.kind === 'tools' && <ConnectorTools key={selected.id} item={selected} busy={busy} error={modalError} run={run} api={api} close={() => open('runtime', selected.id)} />}
    {selected && modal.kind === 'removeDraft' && <Dialog title="删除连接器" className="mcp-dialog mcp-dialog--narrow" busy={busy} close={() => setModal(null)}><div className="mcp-dialog__body"><p>删除个人连接器「{selected.name}」？</p>{modalError && <p role="alert">{modalError}</p>}</div><footer className="mcp-dialog__footer"><button className="btn btn--secondary" onClick={() => setModal(null)}>取消</button><button className="btn btn--danger" disabled={busy} onClick={async () => { if (await run('remove', { id: selected.id, revision: selected.revision })) setModal(null) }}>确认删除</button></footer></Dialog>}
  </section>
}
