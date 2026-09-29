import React, { useEffect, useRef, useState } from 'react'
import { Icon } from '../../capability-shared/src/icons.jsx'
import { ExpertEditor } from './editor.jsx'
import { ExpertDetail, ExpertManage, ExpertVersions, PublicExpertDetail, expertIdentity } from './details.jsx'
import { Dialog } from '../../connectors/src/dialog.jsx'
import { readZip } from '../../capability-shared/src/files.js'
import { styles } from './styles.js'
import { categoryForExpert, expertCategory } from './catalog-view.js'

const bilingual = zh => ({ zh, en: '' })
const newManifest = () => ({ schemaVersion: 'stratex.expert/v1', name: '', version: '0.1.0', entryAgent: '', agents: [], displayName: bilingual(''), profession: bilingual(''), description: bilingual(''), personaInstructions: '', model: '' })

function PersonalCard({ item, busy, open, summon }) {
  const [menu, setMenu] = useState(false)
  return <article className="personal-expert-card" aria-busy={busy}><header className="personal-expert-card__header"><span className="personal-expert-card__avatar" aria-hidden="true">{(item.displayName || item.name).slice(0, 1)}</span><div className="personal-expert-card__identity"><h3>{item.displayName || item.name}</h3><p>{categoryForExpert(item)}</p></div><div className="personal-expert-card__badges"><span className="expert-badge" data-badge={item.enabled ? 'usable' : 'local-only'}>{item.enabled ? '已启用' : '仅本机'}</span></div><button className="personal-expert-card__more" disabled={busy || !!item.error} aria-label={`管理专家 ${item.displayName || item.name}`} aria-expanded={menu} aria-haspopup="dialog" onClick={() => setMenu(true)}><Icon name={menu ? 'close' : 'more'} size={18} strokeWidth={1.65} /></button></header>
    <p className="personal-expert-card__desc">{item.description || item.error}</p><dl className="personal-expert-card__lineage"><div><dt>当前版本</dt><dd>{item.version || '无法读取'}</dd></div></dl><div className="expert-card__tags">{item.tags?.slice(0, 3).map((tag, index) => <span key={index}>{tag}</span>)}</div>{!!item.problems?.length && <p className="editor-page__error">{item.problems.join(' ')}</p>}
    <footer className="expert-card__tools"><button className="expert-card__copy" disabled={busy || !!item.error} onClick={() => open(item.name, 'detail')}>查看专家</button><button className="expert-card__summon" disabled={busy || !!item.error || !!item.problems?.length} onClick={() => summon(item.name)}>召唤</button></footer>
    {menu && <Dialog title={`${item.displayName || item.name} · 专家操作`} className="zz-expert-menu" close={() => setMenu(false)}><div className="personal-expert-card__menu">{[['edit', '修改专家'], ['versions', '版本历史'], ['manage', '管理与云端']].map(([kind, title]) => <button key={kind} onClick={() => { setMenu(false); open(item.name, kind) }}>{title}</button>)}</div></Dialog>}
  </article>
}

function ExpertDirectoryTabs({ value, onChange, disabled }) {
  const items = { public: '公开', personal: '个人', authorized: '被授权' }
  const keys = Object.keys(items)
  return <nav className="experts-directory-tabs" role="tablist" aria-label="专家目录范围" onKeyDown={event => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
    event.preventDefault()
    const current = keys.indexOf(value)
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? keys.length - 1 : (current + (event.key === 'ArrowRight' ? 1 : -1) + keys.length) % keys.length
    onChange(keys[next])
    event.currentTarget.querySelectorAll('[role=tab]')[next]?.focus()
  }}>{Object.entries(items).map(([key, label]) => <button key={key} type="button" role="tab" aria-selected={value === key} aria-controls={`zz-expert-${key}`} tabIndex={value === key ? 0 : -1} disabled={disabled} onClick={() => onChange(key)}>{label}</button>)}</nav>
}

export function ExpertsPanel({ api, startConversation, workspaces = [], signedIn = false, openLogin, onBack }) {
  const [snapshot, setSnapshot] = useState({ items: [] }), [loading, setLoading] = useState(true)
  const [detail, setDetail] = useState(null), [modal, setModal] = useState(null), [editor, setEditor] = useState(null)
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState('')
  const [query, setQuery] = useState(''), [category, setCategory] = useState('all'), [drawerQuery, setDrawerQuery] = useState('')
  const [directory, setDirectory] = useState('public')
  const [workspaceId, setWorkspaceId] = useState(''), [path, setPath] = useState('')
  const [catalog, setCatalog] = useState({ state: signedIn ? 'loading' : 'signed-out', items: [] }), [asset, setAsset] = useState(null)
  const detailRequest = useRef(null), catalogRequest = useRef(null)
  const request = (action, payload = {}, signal) => api(`experts/${action}`, payload, signal)
  const refresh = async () => setSnapshot(await request('list'))
  useEffect(() => {
    const controller = new AbortController()
    request('list', {}, controller.signal).then(result => { if (!controller.signal.aborted) setSnapshot(result) }).catch(failure => { if (!controller.signal.aborted) setError(failure.message) }).finally(() => { if (!controller.signal.aborted) setLoading(false) })
    if (signedIn) void loadCatalog()
    else setCatalog({ state: 'signed-out', items: [] })
    return () => { controller.abort(); detailRequest.current?.abort(); catalogRequest.current?.abort() }
  }, [api, signedIn])
  async function run(action) {
    setBusy(true); setError(''); setNotice('')
    try { await action(); return true } catch (failure) { setError(failure.message); return false } finally { setBusy(false) }
  }
  function edit(value) {
    const parts = value.manifest.version.split(/[.+-]/).slice(0, 3).map(Number)
    setEditor({ manifest: { ...value.manifest, version: `${parts[0]}.${parts[1]}.${parts[2] + 1}` }, source: expertIdentity(value), knowledgeGroupIds: value.knowledgeGroupIds })
    setModal(null)
  }
  async function open(name, kind = 'detail', version) {
    detailRequest.current?.abort(); const controller = new AbortController(); detailRequest.current = controller
    setModal('loading'); setError(''); setNotice('')
    try {
      const value = await request('detail', { name, ...(version ? { version } : {}) }, controller.signal)
      if (controller.signal.aborted) return
      setDetail(value); if (kind === 'edit') edit(value); else setModal(kind)
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
  async function loadCatalog() {
    if (!signedIn) return
    catalogRequest.current?.abort(); const controller = new AbortController(); catalogRequest.current = controller
    setCatalog(current => ({ ...current, state: 'loading' }))
    try { const items = await api('store/list', { collection: 'experts', scope: 'published' }, controller.signal); if (!controller.signal.aborted) setCatalog({ state: 'ready', items }) } catch (failure) { if (!controller.signal.aborted) setCatalog(current => ({ ...current, state: 'error', error: failure.message })) }
  }
  async function openAsset(item) {
    detailRequest.current?.abort(); const controller = new AbortController(); detailRequest.current = controller
    setAsset({ state: 'loading', name: item.name }); setError('')
    try { const value = await api('store/detail', { collection: 'experts', id: item.id }, controller.signal); if (!controller.signal.aborted) setAsset({ state: 'ready', ...value }) } catch (failure) { if (!controller.signal.aborted) setAsset({ state: 'error', name: item.name, error: failure.message }) }
  }
  const close = () => { detailRequest.current?.abort(); setModal(null); setError(''); setNotice('') }
  const save = (manifest, knowledgeGroupIds) => run(async () => {
    const result = await request(editor.source ? 'update' : 'create', { ...editor.source, manifest: editor.source ? manifest : { ...manifest, entryAgent: manifest.name, agents: [`agents/${manifest.name}.md`] }, knowledgeGroupIds })
    await refresh(); setEditor(null); await open(result.name, 'manage', result.version); setNotice('专家已保存。')
  })
  if (editor) return <div className="zz-resource-page zz-experts"><style>{styles}</style><ExpertEditor editor={editor} busy={busy} error={error} api={api} save={save} close={() => { setEditor(null); setError('') }} /></div>
  const matches = (item, search = query) => `${item.displayName || item.name} ${item.description || item.summary || ''} ${(item.tags ?? []).join(' ')}`.toLowerCase().includes(search.trim().toLowerCase())
  const items = snapshot.items.filter(item => matches(item))
  const publicItems = catalog.items.filter(item => matches(item) && (category === 'all' || categoryForExpert(item) === expertCategory(category)))
  const scenes = ['office', 'development']
  return <div className="zz-resource-page zz-experts experts-page resource-page-shell" aria-busy={busy || loading}>
    <style>{styles}</style><header className="resource-page-nav"><div className="resource-page-nav__path">{onBack && <button type="button" className="resource-page-nav__back" aria-label="返回会话，离开专家页" title="返回会话，离开专家页" onClick={onBack}><Icon name="back" size={17} /></button>}<strong>专家</strong><span className="resource-page-nav__badge">RESOURCE</span></div><div className="experts-actions"><button className="btn btn--primary" disabled={busy} onClick={() => { setEditor({ manifest: newManifest(), source: null }); setError('') }}>创建专家</button><button className="btn btn--secondary" disabled={busy} onClick={() => { setModal('import'); setError('') }}>导入专家包</button><button className="my-experts-trigger" aria-haspopup="dialog" aria-expanded={modal === 'installed'} onClick={() => setModal('installed')}><span>我的专家</span><span className="my-experts-trigger__count">{snapshot.items.length}</span></button><button className="btn btn--ghost" disabled={busy} onClick={() => { void run(refresh); void loadCatalog() }}>刷新</button></div></header>
    <div className="experts-page__content"><section className="resource-page-hero"><div className="resource-page-hero__copy"><p className="resource-page-hero__eyebrow">WORKBENCH RESOURCE</p><h1>专家</h1><p className="resource-page-hero__subtitle">按个人与公开目录浏览专家；本机已安装可在“我的专家”里快速召唤。</p></div><label className="zz-directory-search"><span>搜索专家</span><Icon name="search" size={16} /><input type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder="搜索专家名称、描述或标签" />{query && <button type="button" className="zz-search-clear" aria-label="清除搜索" onClick={() => setQuery('')}><Icon name="close" size={15} /></button>}</label></section>
      {!modal && error && <div role="alert" className="editor-page__error">{error}<button className="btn btn--secondary" onClick={() => run(refresh)}>重试</button></div>}
      <section className="featured experts-featured-scenes"><header className="featured__header"><h2>精选场景</h2><p>从工作方式出发，快速找到合适的专家。</p></header><div className="featured__rail">{scenes.map(scene => <button className={`scene ${category === scene ? 'is-selected' : ''}`} key={scene} aria-pressed={category === scene} onClick={() => setCategory(category === scene ? 'all' : scene)}><span className="scene__icon" aria-hidden="true"><Icon name={category === scene ? 'check' : ['development', '开发'].includes(scene) ? 'scene-development' : 'scene-office'} size={22} strokeWidth={1.65} /></span><strong>{expertCategory(scene)}</strong><span className="scene__description">{['development', '开发'].includes(scene) ? '编码、调试、评审与自动化' : '文档、表格、演示与日常协作'}</span><span className="scene__count">{catalog.items.filter(item => categoryForExpert(item) === expertCategory(scene)).length}</span></button>)}</div></section>
      <section className="experts-installed"><header className="experts-installed__header"><h2>已安装</h2><span>{snapshot.items.length}</span></header><div className="experts-installed__rail">{snapshot.items.map(item => <button key={item.name} disabled={!!item.error || busy} title={item.displayName || item.name} aria-label={`管理已安装专家 ${item.displayName || item.name}`} onClick={() => open(item.name, 'manage')}><Icon name="agents" size={20} /></button>)}{!snapshot.items.length && <button className="experts-installed__empty" onClick={() => setModal('installed')}>{loading ? '正在读取…' : '暂无已安装专家'}</button>}</div></section>
      <ExpertDirectoryTabs value={directory} onChange={setDirectory} disabled={busy} />
      {directory === 'personal' && <section id="zz-expert-personal" role="tabpanel" className="zz-directory-section" aria-label="个人专家"><header><div><h2>个人 <span>{items.length}</span></h2><p>管理本机创建、导入和安装的专家。</p></div></header>{loading ? <div className="directory-state" role="status">正在加载专家…</div> : error && !snapshot.items.length ? <div className="directory-state directory-state--error">专家暂时读不到，请重试。</div> : items.length ? <div className="expert-grid">{items.map(item => <PersonalCard key={item.name} item={item} busy={busy} open={open} summon={summonName} />)}</div> : <div className="directory-state directory-state--slim"><strong>{query ? '没有匹配的个人专家' : '你还没有创建过专家'}</strong><span>{query ? '试试更换关键词。' : '点右上「创建专家」，或导入一个专家包。'}</span></div>}</section>}
      {directory === 'authorized' && <section id="zz-expert-authorized" role="tabpanel" className="zz-directory-section"><header><div><h2>被授权</h2><p>他人通过用户或部门分享给你的专家。</p></div></header><div className="zz-directory-placeholder"><strong>被授权专家即将开放</strong><p>当前版本暂无可用数据。</p></div></section>}
      {directory === 'public' && <section id="zz-expert-public" role="tabpanel" className="zz-directory-section" aria-label="公开专家"><header><div><h2>公开 <span>{catalog.state === 'ready' ? publicItems.length : ''}</span></h2><p>浏览公开版本，安装到本机后即可召唤。</p></div>{signedIn && <button className="btn btn--secondary" disabled={catalog.state === 'loading'} onClick={loadCatalog}>刷新公开目录</button>}</header>{catalog.state === 'signed-out' && <div className="zz-directory-placeholder"><p>登录后浏览公开目录，本地资源仍可使用。</p>{openLogin && <button className="btn btn--secondary" onClick={openLogin}>去登录</button>}</div>}{catalog.state === 'loading' && <p className="directory-state" role="status">正在读取公开目录…</p>}{catalog.state === 'error' && <div className="editor-page__error" role="alert"><strong>公开目录暂时读不到</strong><p>{catalog.error}</p><button className="btn btn--secondary" onClick={loadCatalog}>重试</button></div>}{catalog.state === 'ready' && !publicItems.length && <div className="directory-state">{query || category !== 'all' ? '没有匹配的公开专家' : '公开目录暂时为空'}</div>}
        <div className="expert-grid">{publicItems.map(item => <article className="expert-card" key={item.id}><header className="expert-card__head"><span className="expert-card__avatar">{item.name.slice(0, 1)}</span><button className="expert-card__identity" onClick={() => openAsset(item)}><h3>{item.name}</h3><p>{categoryForExpert(item)}</p></button></header><p className="expert-card__desc">{item.summary}</p><div className="expert-card__tags">{item.tags?.slice(0, 3).map((tag, index) => <span key={index}>{tag}</span>)}</div><footer className="expert-card__tools"><button className="expert-card__install" onClick={() => openAsset(item)}>查看与安装</button></footer></article>)}</div>
      </section>}
    </div>
    {modal === 'installed' && <Dialog title="我的专家" closeIconSize={16} className="zz-installed-drawer" busy={busy} close={close}><div className="zz-expert-dialog-body"><label className="zz-directory-search"><span>搜索已安装专家</span><Icon name="search" size={16} /><input type="search" value={drawerQuery} onChange={event => setDrawerQuery(event.target.value)} /></label><div className="zz-my-expert-list">{snapshot.items.filter(item => matches(item, drawerQuery)).map(item => <article key={item.name}><span className="expert-card__avatar">{(item.displayName || item.name).slice(0, 1)}</span><div><strong>{item.displayName || item.name}</strong><p>{item.version} · {item.enabled ? '已启用' : '未启用'}</p></div><button className="btn btn--ghost" disabled={busy || !!item.error} onClick={() => open(item.name, 'manage')}>管理</button><button className="btn btn--primary" disabled={busy || !!item.error} onClick={() => summonName(item.name)}>召唤</button></article>)}</div>{!snapshot.items.filter(item => matches(item, drawerQuery)).length && <p className="directory-state">{snapshot.items.length ? '没有匹配的专家。' : '暂无已安装专家。'}</p>}</div></Dialog>}
    {modal === 'import' && <Dialog title="导入专家包" className="zz-expert-modal" busy={busy} close={close}><div className="zz-expert-dialog-body"><p>支持 Stratex 专家 ZIP 或本机目录。导入后可在我的专家中管理。</p>{error && <p role="alert" className="editor-page__error">{error}</p>}<label className="zz-expert-import"><strong>选择专家 ZIP 文件</strong><input type="file" accept=".zip,application/zip" disabled={busy} onChange={event => { const file = event.target.files?.[0]; event.target.value = ''; if (file) run(async () => { const result = await request('import', { contentBase64: await readZip(file, 128) }); await refresh(); await open(result.name, 'manage', result.version) }) }} /></label><details><summary>从本机路径导入</summary><form className="zz-expert-stack" onSubmit={event => { event.preventDefault(); run(async () => { const result = await request('import', { path }); await refresh(); setPath(''); await open(result.name, 'manage', result.version) }) }}><label className="zz-expert-field"><span>本机路径</span><input required value={path} onChange={event => setPath(event.target.value)} placeholder="专家 ZIP 或目录完整路径" /></label><button className="btn btn--primary" disabled={busy}>导入</button></form></details></div></Dialog>}
    {(modal === 'loading' || modal === 'load-error') && <Dialog title="专家详情" className="zz-expert-modal" close={close}><div className="zz-expert-dialog-body"><p role={modal === 'loading' ? 'status' : 'alert'}>{modal === 'loading' ? '正在读取专家…' : error}</p></div></Dialog>}
    {detail && modal === 'detail' && <ExpertDetail detail={detail} busy={busy} error={error} workspaceId={workspaceId} workspaces={workspaces} setWorkspaceId={setWorkspaceId} summon={summon} close={close} manage={() => setModal('manage')} />}
    {detail && modal === 'manage' && <ExpertManage key={detail.manifest.name} detail={detail} busy={busy} error={error} notice={notice} request={request} run={run} refresh={refresh} reload={async () => setDetail(await request('detail', { name: detail.manifest.name, version: detail.manifest.version }))} edit={() => edit(detail)} versions={() => setModal('versions')} close={close} view={() => setModal('detail')} removed={close} />}
    {detail && modal === 'versions' && <ExpertVersions detail={detail} busy={busy} error={error} close={() => setModal('manage')} edit={() => edit(detail)} load={version => open(detail.manifest.name, 'detail', version)} activate={version => run(async () => { const value = await request('detail', { name: detail.manifest.name, version }); await request('activate', expertIdentity(value)); await refresh(); setDetail(await request('detail', { name: detail.manifest.name, version })) })} />}
    {asset && <PublicExpertDetail key={asset.id || asset.name} asset={asset} busy={busy} error={error} close={() => { detailRequest.current?.abort(); setAsset(null) }} install={version => run(async () => { const result = await request('install', { id: asset.id, version }); await refresh(); setAsset(null); await open(result.name, 'manage', result.version) })} />}

  </div>
}
