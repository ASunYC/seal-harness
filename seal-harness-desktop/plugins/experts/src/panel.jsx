import React, { useEffect, useRef, useState } from 'react'
import { Icon } from '../../capability-shared/src/icons.jsx'
import { Dialog } from '../../connectors/src/dialog.jsx'
import { readZip } from '../../capability-shared/src/files.js'
import { ExpertDetail, ExpertManage, ExpertVersions, expertIdentity } from './details.jsx'
import { categoryForExpert } from './catalog-view.js'
import { styles } from './styles.js'

function PersonalCard({ item, busy, open, summon }) {
  const [menu, setMenu] = useState(false)
  return <article className="personal-expert-card" aria-busy={busy}>
    <header className="personal-expert-card__header">
      <span className="personal-expert-card__avatar" aria-hidden="true">{(item.displayName || item.name).slice(0, 1)}</span>
      <div className="personal-expert-card__identity"><h3>{item.displayName || item.name}</h3><p>{categoryForExpert(item)}</p></div>
      <div className="personal-expert-card__badges"><span className="expert-badge" data-badge={item.enabled ? 'usable' : 'local-only'}>{item.enabled ? '已启用' : '未启用'}</span></div>
      <button className="personal-expert-card__more" disabled={busy || !!item.error} aria-label={`管理专家 ${item.displayName || item.name}`} aria-expanded={menu} aria-haspopup="dialog" onClick={() => setMenu(true)}><Icon name={menu ? 'close' : 'more'} size={18} strokeWidth={1.65} /></button>
    </header>
    <p className="personal-expert-card__desc">{item.description || item.error}</p>
    <dl className="personal-expert-card__lineage"><div><dt>当前版本</dt><dd>{item.version || '无法读取'}</dd></div></dl>
    <div className="expert-card__tags">{item.tags?.slice(0, 3).map((tag, index) => <span key={index}>{tag}</span>)}</div>
    {!!item.problems?.length && <p className="editor-page__error">{item.problems.join(' ')}</p>}
    <footer className="expert-card__tools"><button className="expert-card__copy" disabled={busy || !!item.error} onClick={() => open(item.name, 'detail')}>查看专家</button><button className="expert-card__summon" disabled={busy || !!item.error || !!item.problems?.length} onClick={() => summon(item.name)}>召唤</button></footer>
    {menu && <Dialog title={`${item.displayName || item.name} · 专家操作`} className="zz-expert-menu" close={() => setMenu(false)}><div className="personal-expert-card__menu">{[['versions', '版本历史'], ['manage', '管理专家']].map(([kind, title]) => <button key={kind} onClick={() => { setMenu(false); open(item.name, kind) }}>{title}</button>)}</div></Dialog>}
  </article>
}

function ExpertDirectoryTabs({ value, onChange, disabled }) {
  const items = { system: '系统', personal: '个人' }
  const keys = Object.keys(items)
  return <nav className="experts-directory-tabs" role="tablist" aria-label="专家目录" onKeyDown={event => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
    event.preventDefault()
    const current = keys.indexOf(value)
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? keys.length - 1 : (current + (event.key === 'ArrowRight' ? 1 : -1) + keys.length) % keys.length
    onChange(keys[next])
    event.currentTarget.querySelectorAll('[role=tab]')[next]?.focus()
  }}>{Object.entries(items).map(([key, label]) => <button key={key} type="button" role="tab" aria-selected={value === key} aria-controls={`zz-expert-${key}`} tabIndex={value === key ? 0 : -1} disabled={disabled} onClick={() => onChange(key)}>{label}</button>)}</nav>
}

export function ExpertsPanel({ api, startConversation, startExpertCreation, workspaces = [], onBack }) {
  const [snapshot, setSnapshot] = useState({ items: [] }), [loading, setLoading] = useState(true)
  const [detail, setDetail] = useState(null), [modal, setModal] = useState(null)
  const [busy, setBusy] = useState(false), [error, setError] = useState('')
  const [query, setQuery] = useState(''), [directory, setDirectory] = useState('personal')
  const [workspaceId, setWorkspaceId] = useState(''), [path, setPath] = useState('')
  const detailRequest = useRef(null)
  const request = (action, payload = {}, signal) => api(`experts/${action}`, payload, signal)
  const refresh = async () => setSnapshot(await request('list'))

  useEffect(() => {
    const controller = new AbortController()
    request('list', {}, controller.signal).then(result => { if (!controller.signal.aborted) setSnapshot(result) }).catch(failure => { if (!controller.signal.aborted) setError(failure.message) }).finally(() => { if (!controller.signal.aborted) setLoading(false) })
    return () => { controller.abort(); detailRequest.current?.abort() }
  }, [api])

  async function run(action) {
    setBusy(true); setError('')
    try { await action(); return true }
    catch (failure) { setError(failure.message); return false }
    finally { setBusy(false) }
  }

  async function open(name, kind = 'detail', version) {
    detailRequest.current?.abort()
    const controller = new AbortController()
    detailRequest.current = controller
    setModal('loading'); setError('')
    try {
      const value = await request('detail', { name, ...(version ? { version } : {}) }, controller.signal)
      if (!controller.signal.aborted) { setDetail(value); setModal(kind) }
    } catch (failure) { if (!controller.signal.aborted) { setError(failure.message); setModal('load-error') } }
  }

  async function summon(value, prompt) {
    await run(async () => {
      const workspace = workspaceId || workspaces[0]?.workspaceId
      if (!workspace) throw new Error('请先在侧栏创建或选择工作区。')
      const active = await request('activate', expertIdentity(value))
      await startConversation(active.presetId, prompt, workspace)
      await refresh()
    })
  }

  async function summonName(name) {
    if (!workspaces.length) { await open(name); return }
    await run(async () => {
      const value = await request('detail', { name })
      const active = await request('activate', expertIdentity(value))
      await startConversation(active.presetId, value.manifest.initPrompt?.zh ?? '', workspaceId || workspaces[0]?.workspaceId)
      await refresh()
    })
  }

  const close = () => { detailRequest.current?.abort(); setModal(null); setError('') }
  const matches = item => `${item.displayName || item.name} ${item.description || ''} ${(item.tags ?? []).join(' ')}`.toLowerCase().includes(query.trim().toLowerCase())
  const personal = snapshot.items.filter(matches)
  return <div className="zz-resource-page zz-experts experts-page resource-page-shell" aria-busy={busy || loading}>
    <style>{styles}</style>
    <header className="resource-page-nav"><div className="resource-page-nav__path">{onBack && <button type="button" className="resource-page-nav__back" aria-label="返回会话，离开专家页" title="返回会话，离开专家页" onClick={onBack}><Icon name="back" size={17} /></button>}<strong>专家</strong><span className="resource-page-nav__badge">RESOURCE</span></div><div className="experts-actions"><button className="btn btn--primary" disabled={busy} onClick={() => { void run(async () => { if (!startExpertCreation) throw new Error('会话创建服务尚未就绪。'); await startExpertCreation() }) }}>创建专家</button><button className="btn btn--secondary" disabled={busy} onClick={() => { setModal('import'); setError('') }}>导入专家</button></div></header>
    <div className="experts-page__content">
      <section className="resource-page-hero"><div className="resource-page-hero__copy"><p className="resource-page-hero__eyebrow">WORKBENCH RESOURCE</p><h1>专家</h1><p className="resource-page-hero__subtitle">通过会话创建、导入和管理专家；已启用的专家可以在对话中使用。</p></div><label className="zz-directory-search"><span>搜索专家</span><Icon name="search" size={16} /><input type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder="搜索专家名称、描述或标签" />{query && <button type="button" className="zz-search-clear" aria-label="清除搜索" onClick={() => setQuery('')}><Icon name="close" size={15} /></button>}</label></section>
      {!modal && error && <div role="alert" className="editor-page__error">{error}<button className="btn btn--secondary" onClick={() => { void run(refresh) }}>重试</button></div>}
      <ExpertDirectoryTabs value={directory} onChange={setDirectory} disabled={busy} />
      {directory === 'system' && <section id="zz-expert-system" role="tabpanel" className="zz-directory-section" aria-label="系统专家"><div className="directory-state directory-state--slim"><strong>暂无系统专家</strong><span>系统专家会在后续版本中提供。</span></div></section>}
      {directory === 'personal' && <section id="zz-expert-personal" role="tabpanel" className="zz-directory-section" aria-label="个人专家">{loading ? <div className="directory-state" role="status">正在加载专家…</div> : error && !snapshot.items.length ? <div className="directory-state directory-state--error">专家暂时读不到，请重试。</div> : personal.length ? <div className="expert-grid">{personal.map(item => <PersonalCard key={item.name} item={item} busy={busy} open={open} summon={summonName} />)}</div> : <div className="directory-state directory-state--slim"><strong>{query ? '没有匹配的个人专家' : '你还没有创建过专家'}</strong><span>{query ? '试试更换关键词。' : '点右上「创建专家」，或导入专家。'}</span></div>}</section>}
    </div>
    {modal === 'import' && <Dialog title="导入专家" className="zz-expert-modal" busy={busy} close={close}><div className="zz-expert-dialog-body"><p>支持 Stratex 专家 ZIP 或本机目录。导入后可在“个人”中管理。</p>{error && <p role="alert" className="editor-page__error">{error}</p>}<label className="zz-expert-import"><strong>选择专家 ZIP 文件</strong><input type="file" accept=".zip,application/zip" disabled={busy} onChange={event => { const file = event.target.files?.[0]; event.target.value = ''; if (file) void run(async () => { const result = await request('import', { contentBase64: await readZip(file, 128) }); await refresh(); await open(result.name, 'manage', result.version) }) }} /></label><details><summary>从本机路径导入</summary><form className="zz-expert-stack" onSubmit={event => { event.preventDefault(); void run(async () => { const result = await request('import', { path }); await refresh(); setPath(''); await open(result.name, 'manage', result.version) }) }}><label className="zz-expert-field"><span>本机路径</span><input required value={path} onChange={event => setPath(event.target.value)} placeholder="专家 ZIP 或目录完整路径" /></label><button className="btn btn--primary" disabled={busy}>导入</button></form></details></div></Dialog>}
    {(modal === 'loading' || modal === 'load-error') && <Dialog title="专家详情" className="zz-expert-modal" close={close}><div className="zz-expert-dialog-body"><p role={modal === 'loading' ? 'status' : 'alert'}>{modal === 'loading' ? '正在读取专家…' : error}</p></div></Dialog>}
    {detail && modal === 'detail' && <ExpertDetail detail={detail} busy={busy} error={error} workspaceId={workspaceId} workspaces={workspaces} setWorkspaceId={setWorkspaceId} summon={summon} close={close} manage={() => setModal('manage')} />}
    {detail && modal === 'manage' && <ExpertManage key={detail.manifest.name} detail={detail} busy={busy} error={error} request={request} run={run} refresh={refresh} reload={async () => setDetail(await request('detail', { name: detail.manifest.name, version: detail.manifest.version }))} versions={() => setModal('versions')} close={close} view={() => setModal('detail')} removed={close} />}
    {detail && modal === 'versions' && <ExpertVersions detail={detail} busy={busy} error={error} close={() => setModal('manage')} load={version => open(detail.manifest.name, 'detail', version)} activate={version => run(async () => { const value = await request('detail', { name: detail.manifest.name, version }); await request('activate', expertIdentity(value)); await refresh(); setDetail(await request('detail', { name: detail.manifest.name, version })) })} />}
  </div>
}
