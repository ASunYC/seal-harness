import React, { useEffect, useRef, useState } from 'react'
import { Icon } from '../../capability-shared/src/icons.jsx'
import { Dialog, SkillWorkbench } from './workbench.jsx'
import { styles } from './styles.js'
import { downloadZip, readZip } from '../../capability-shared/src/files.js'
import { StorePanel } from '../../store/src/panel.jsx'
import { Tabs } from '../../store/src/catalog.jsx'
import { styles as storeStyles } from '../../store/src/styles.js'

// 来源：Stratex LocalSkillCatalog / SkillCatalogExperience，070ba39e82。
export function SkillsPanel({ api, signedIn = true, openLogin, onBack }) {
  const [scope, setScope] = useState('published')
  const [source, setSource] = useState('platform')
  const [initialAction, setInitialAction] = useState(null)
  const openLocalAction = action => { setInitialAction(action); setScope('mine'); setSource('local') }
  const navigation = busy => <>
    <Tabs label="Skill 目录范围" items={{ published: '公开', mine: '个人' }} value={scope} disabled={busy} onChange={value => { setInitialAction(null); setScope(value) }} />
    {scope === 'mine' && <Tabs label="个人 Skill 来源" items={{ platform: 'Seal Harness·开发者平台 Skill', local: '本地 Skill' }} value={source} disabled={busy} onChange={value => { setInitialAction(null); setSource(value) }} className="skill-catalog-secondary-tabs" />}
  </>
  return scope === 'mine' && source === 'local'
    ? <LocalSkillsPanel api={api} navigation={navigation} onBack={onBack} initialAction={initialAction} />
    : <StorePanel api={api} collection="skills" scope={scope} navigation={navigation} signedIn={signedIn} openLogin={openLogin} onBack={onBack} onCreateSkill={() => openLocalAction('create')} onImportSkill={() => openLocalAction('import')} />
}

function LocalSkillsPanel({ api, navigation, onBack, initialAction }) {
  const [snapshot, setSnapshot] = useState({ revision: 0, skills: [] })
  const [sources, setSources] = useState([])
  const [discovery, setDiscovery] = useState(null)
  const [tab, setTab] = useState('installed')
  const [source, setSource] = useState('all')
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState('all')
  const [busy, setBusy] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [dialog, setDialog] = useState(initialAction === 'import' ? { kind: 'import' } : null)
  const [preview, setPreview] = useState(null)
  const [selected, setSelected] = useState([])
  const [path, setPath] = useState('')
  const [checked, setChecked] = useState([])
  const [workbench, setWorkbench] = useState(initialAction === 'create' ? { id: null } : null)
  const scanRequest = useRef(null)
  const request = (action, payload = {}, signal) => api(`skills/${action}`, payload, signal)

  async function refresh(signal) {
    const [next, roots] = await Promise.all([request('list', {}, signal), request('sources', {}, signal)])
    if (signal?.aborted) return
    setSnapshot(next); setSources(roots.sources)
    setChecked(current => current.filter(id => next.skills.some(item => item.id === id)))
  }
  useEffect(() => {
    const controller = new AbortController()
    setLoading(true)
    refresh(controller.signal).catch(error => { if (!controller.signal.aborted) setError(error.message) }).finally(() => { if (!controller.signal.aborted) setLoading(false) })
    return () => { controller.abort(); scanRequest.current?.abort() }
  }, [api])
  async function run(work) {
    setBusy(true); setError(''); setNotice('')
    try { await work() } catch (error) { setError(error.message) } finally { setBusy(false) }
  }
  async function scan() {
    scanRequest.current?.abort()
    const controller = new AbortController()
    scanRequest.current = controller
    await run(async () => {
      const result = await request('discover', {}, controller.signal)
      if (!controller.signal.aborted) { setDiscovery(result); await refresh(controller.signal) }
    })
  }
  function switchTab(value) {
    setTab(value); setSearch(''); setFilter('all'); setSource('all'); setChecked([])
    if (value === 'discovered' && !discovery) void scan()
  }
  function openDialog(value) { setError(''); setPreview(null); setDialog(value) }
  async function inspect(payload) {
    const result = await request('inspect', payload)
    setPreview(result); setSelected(result.candidates.filter(item => !item.error).map(item => item.key))
  }
  async function importSelected() {
    const result = await request('import', { token: preview.token, entries: selected, expectedRevision: snapshot.revision })
    setPreview(null); setDialog(null); await refresh(); setNotice(`已导入 ${result.skills.length} 个技能，当前未启用。`)
  }
  const visible = snapshot.skills.filter(item => (filter === 'all' || (filter === 'enabled' ? item.enabled : !item.enabled)) && `${item.name} ${item.description}`.toLowerCase().includes(search.toLowerCase()))
  const found = (discovery?.skills ?? []).filter(item => (source === 'all' || item.locations.some(location => location.sourceId === source)) && `${item.name} ${item.description} ${item.locations.map(location => location.sourceLabel).join(' ')}`.toLowerCase().includes(search.toLowerCase()) && (filter === 'all' || (filter === 'ready' ? !item.error : Boolean(item.error))))
  const foundGroups = [...Map.groupBy(found, item => item.name).values()].map(variants => ({ ...variants[0], variants }))
  const availableSources = sources.filter(item => item.status !== 'missing' || !item.standard)
  const feedback = <>{error && <div role="alert" className="state-banner is-error"><strong>操作未完成</strong><span>{error}</span></div>}{notice && <p role="status" className="state-banner">{notice}</p>}</>
  return <main className="zz-resource-page zz-store zz-skills resource-page-shell" aria-label="技能" aria-busy={busy}>
    <style>{storeStyles + styles}</style>
    <header className="resource-page-nav"><div className="resource-page-nav__path">{onBack && <button type="button" className="resource-page-nav__back" aria-label="返回会话，离开技能页" title="返回会话，离开技能页" onClick={onBack}><Icon name="back" size={17} /></button>}<strong>技能</strong><span className="resource-page-nav__badge">RESOURCE</span></div><div className="skills-actions">
      <button className="primary" disabled={busy} onClick={() => setWorkbench({ id: null })}>创建 Skill</button><button disabled={busy} onClick={() => openDialog({ kind: 'import' })}>导入 Skill 包</button>
      {tab === 'discovered' ? <><button disabled={busy} onClick={() => openDialog({ kind: 'scope' })}>扫描范围</button><button disabled={busy} onClick={scan}>{busy ? '正在扫描…' : '重新扫描'}</button></> : <button disabled={busy} onClick={() => run(() => refresh())}>刷新</button>}
    </div></header>
    <div className="skills-page-content"><section className="skills-hero"><h1>技能</h1><p>发现、管理并使用你的技能。</p></section>
      {navigation(busy)}
      <nav className="skills-primary-tabs" aria-label="技能来源">{Object.entries({ installed: '已安装', discovered: '发现本地' }).map(([key, label]) => <button key={key} aria-pressed={tab === key} disabled={busy} onClick={() => switchTab(key)}>{label}</button>)}</nav>
      {!dialog && feedback}
      {snapshot.pendingReports > 0 && <p className="state-banner">有 {snapshot.pendingReports} 条安装结果尚未同步。<button disabled={busy} onClick={() => run(async () => { const result = await request('retryReports'); await refresh(); setNotice(result.reported ? '安装结果已同步。' : '暂时无法同步，请稍后重试。') })}>重试同步</button></p>}
      <section className="local-skill-catalog">
        <div className="local-skill-toolbar"><label className="local-skill-search"><Icon name="search" size={15} /><input type="search" aria-label="搜索技能" placeholder="搜索名称、描述或来源" value={search} onChange={event => setSearch(event.target.value)} />{search && <button aria-label="清除搜索" onClick={() => setSearch('')}><Icon name="close" size={15} /></button>}</label><label className="local-skill-status-filter"><Icon name="filter" size={15} /><select aria-label="技能状态筛选" value={filter} onChange={event => setFilter(event.target.value)}><option value="all">全部状态</option>{tab === 'installed' ? <><option value="enabled">已启用</option><option value="disabled">未启用</option></> : <><option value="ready">可使用</option><option value="check">需检查</option></>}</select></label></div>
        {tab === 'discovered' && <><nav className="local-skill-sources" aria-label="来源工具"><span className="local-skill-sources__caption">来源工具</span><button aria-pressed={source === 'all'} className={source === 'all' ? 'is-active' : ''} onClick={() => setSource('all')}><Icon name="store" size={13} />全部 <span>{discovery?.skills.length ?? 0}</span></button>{availableSources.map(item => <button key={item.id} aria-pressed={source === item.id} className={source === item.id ? 'is-active' : ''} onClick={() => setSource(item.id)}><Icon name={item.standard ? 'store' : 'folder'} size={13} />{item.label}<span>{discovery?.skills.filter(skill => skill.locations.some(location => location.sourceId === item.id)).length ?? 0}</span></button>)}</nav><p className="local-skill-note"><Icon name="info" size={13} /><span>本地使用不上传；原文件保持不变。</span></p>{discovery?.diagnostics.map((item, index) => <p role="status" className="state-banner" key={index}>{item.path ? `${item.path}：` : ''}{item.message}</p>)}</>}
        {loading || tab === 'discovered' && busy && !discovery ? <div className="loading-state" role="status">{tab === 'discovered' ? '正在扫描本地 Skill…' : '正在读取技能…'}</div> : <>
          {tab === 'installed' && visible.length > 0 && <div className="skills-batch"><label><input type="checkbox" checked={visible.every(item => checked.includes(item.id))} onChange={event => setChecked(event.target.checked ? visible.map(item => item.id) : [])} />全选</label><span>{checked.length ? `已选择 ${checked.length} 个` : `${visible.length} 个技能`}</span>{[true, false].map(enabled => <button key={String(enabled)} disabled={busy || !checked.length} onClick={() => run(async () => { let completed = 0; try { for (const id of checked) { await request('setEnabled', { id, enabled }); completed++ } } finally { await refresh(); setChecked([]); setNotice(`已处理 ${completed} 个技能。`) } })}>{enabled ? '批量启用' : '批量停用'}</button>)}</div>}
          <div className="local-skill-results"><div className="local-skill-table-heading" aria-hidden="true"><span>名称</span><span>{tab === 'installed' ? '来源' : '发现于'}</span><span>本地状态</span><span /></div>
            <div className="local-skill-list">{(tab === 'installed' ? visible : foundGroups).map(item => <article className="local-skill-row" key={item.id ?? item.contentHash ?? `${item.sourceId}/${item.key}`}>
              <div className="local-skill-row__main">{tab === 'installed' && <input type="checkbox" aria-label={`选择 ${item.name}`} checked={checked.includes(item.id)} onChange={event => setChecked(event.target.checked ? [...checked, item.id] : checked.filter(id => id !== item.id))} />}<span className="local-skill-row__icon" aria-hidden="true"><Icon name="folder" size={17} /></span><button className="local-skill-row__copy" onClick={() => tab === 'installed' ? setWorkbench({ id: item.id }) : openDialog({ kind: item.variants.length > 1 ? 'variants' : 'sourceDetail', item })}><strong>{item.name}</strong><small>{item.description || item.error || '未提供描述'}</small></button></div>
              <span className="local-skill-row__source">{tab === 'installed' ? <><span>{item.origin?.kind === 'store' ? '能力商店' : '本地导入'}</span><small>{item.fileCount} 个文件{item.origin?.version ? ` · ${item.origin.version}` : ''}</small></> : <><span>{[...new Set(item.locations.map(location => location.sourceLabel))].join(' · ')}</span><small>{item.locations.length} 个位置{item.variants.length > 1 ? ` · ${item.variants.length} 种内容` : ''}</small></>}</span>
              <span className={`local-skill-row__status ${item.enabled || item.defaultLocation ? 'is-default' : ''}`}>{tab === 'installed' ? item.enabled ? item.active ? '已启用' : '已启用 · 未进入目录' : '未启用' : item.variants.length > 1 ? '需选择副本' : item.defaultLocation ? '默认副本' : item.error ? '需检查' : '可使用'}</span>
              {tab === 'installed' ? <details className="skills-row-menu"><summary aria-label={`管理 ${item.name}`}><Icon name="more" size={16} /></summary><div><button disabled={busy} onClick={() => run(async () => { await request('setEnabled', { id: item.id, enabled: !item.enabled, expectedRevision: snapshot.revision }); await refresh() })}>{item.enabled ? '停用' : '启用'}</button><button disabled={busy} onClick={() => run(async () => { const result = await request('export', { id: item.id }); downloadZip({ fileName: result.fileName, contentBase64: result.zipBase64 }) }) }>导出</button><button disabled={busy} onClick={() => openDialog({ kind: 'remove', item })}>移除</button></div></details> : <button aria-label={`查看 ${item.name}`} onClick={() => openDialog({ kind: item.variants.length > 1 ? 'variants' : 'sourceDetail', item })}><Icon name="forward" size={15} /></button>}
            </article>)}</div>
          </div>
          {(tab === 'installed' ? visible : foundGroups).length === 0 && <div className="empty-state"><strong>{search || filter !== 'all' ? '没有符合条件的技能' : tab === 'installed' ? '还没有安装技能' : '还没有发现本地 Skill'}</strong><span>{tab === 'installed' ? '导入技能包，或从能力商店安装。' : '可以调整筛选条件，或在扫描范围中添加目录。'}</span>{(search || filter !== 'all' || source !== 'all') && <button onClick={() => { setSearch(''); setFilter('all'); setSource('all') }}>清除筛选</button>}</div>}
          <p className="local-skill-results__count">{tab === 'installed' ? `共 ${visible.length} 个已安装技能` : `已发现 ${foundGroups.length} 个本地 Skill`}</p>
        </>}
      </section>
    </div>
    {workbench && <SkillWorkbench key={workbench.id ?? 'new'} api={api} id={workbench.id} revision={snapshot.revision} close={() => setWorkbench(null)} saved={refresh} />}
    {dialog && <Dialog title={{ scope: '扫描范围', import: '导入 Skill 包', variants: '选择技能副本', sourceDetail: dialog.item?.name, remove: '移除技能' }[dialog.kind]} drawer={dialog.kind === 'sourceDetail'} close={() => { setDialog(null); setPreview(null); setError('') }} busy={busy}>
      <div className="skills-dialog-body">{feedback}
        {dialog.kind === 'scope' && <><p>标准目录、项目目录和你添加的目录都在这里管理。</p>{[['standard', '标准目录'], ['project', '项目目录'], ['custom', '自定义目录']].map(([key, title]) => {
          const group = availableSources.filter(item => key === 'project' ? item.projectRoot : key === 'standard' ? item.standard && !item.projectRoot : !item.standard)
          return group.length > 0 && <section className="local-skill-scope-group" key={key}><h4>{title}</h4><div className="local-skill-scope-group__list">{group.map(item => <article key={item.id}><span className="local-skill-scope-group__icon" aria-hidden="true"><Icon name={item.standard ? 'store' : 'folder'} size={16} /></span><span className="local-skill-scope-group__copy"><strong>{item.label}</strong><small>{item.path}</small><small>{item.status === 'ready' ? '可用' : item.status === 'missing' ? '目录不存在' : '无法读取'}</small></span>{!item.standard && <button disabled={busy} onClick={() => run(async () => { await request('revokeSource', { id: item.id, expectedRevision: snapshot.revision }); setDiscovery(null); await refresh() })}>移除来源</button>}</article>)}</div></section>
        })}<form onSubmit={event => { event.preventDefault(); run(async () => { await request('approveSource', { path, expectedRevision: snapshot.revision }); setPath(''); await refresh() }) }} className="skills-path-form"><label>添加目录<input required aria-label="技能来源目录" value={path} onChange={event => setPath(event.target.value)} placeholder="本机或项目的技能目录绝对路径" /></label><button disabled={busy || !path.trim()}>添加来源</button></form><footer><button disabled={busy} onClick={() => { setDialog(null); void scan() }}>重新扫描</button></footer></>}
        {dialog.kind === 'import' && <><p>选择包含 SKILL.md 的目录或 ZIP。导入后可单独启用。</p><label className="skills-import-drop" onDragOver={event => event.preventDefault()} onDrop={event => { event.preventDefault(); const file = event.dataTransfer.files[0]; if (file) run(async () => inspect({ zipBase64: await readZip(file) })) }}><span aria-hidden="true"><Icon name="upload" size={28} /></span><strong>选择或拖入 Skill ZIP 包</strong><small>支持包含一个或多个技能的 ZIP，最大 64 MiB</small><input type="file" accept=".zip,application/zip" disabled={busy} onChange={event => { const file = event.target.files?.[0]; if (file) run(async () => inspect({ zipBase64: await readZip(file) })); event.target.value = '' }} /></label><form className="skills-path-form" onSubmit={event => { event.preventDefault(); run(() => inspect({ path })) }}><label>或从目录导入<input aria-label="技能目录或 ZIP 的绝对路径" value={path} onChange={event => setPath(event.target.value)} placeholder="技能目录或 ZIP 的绝对路径" /></label><button disabled={busy || !path.trim()}>预览导入</button></form></>}
        {dialog.kind === 'variants' && <><p>发现多个同名技能，请选择要使用的内容。</p>{dialog.item.variants.map(item => <button className="skills-variant" key={item.contentHash} onClick={() => openDialog({ kind: 'sourceDetail', item })}><strong>{item.name}</strong><span>{item.description}</span><small>{item.contentHash?.slice(0, 12)} · {item.locations.map(location => location.sourceLabel).join(' · ')}</small></button>)}</>}
        {dialog.kind === 'sourceDetail' && <><p>{dialog.item.description}</p><section className="local-skill-detail__section"><h4>基本信息</h4><dl><div><dt>类型</dt><dd>本地 Skill</dd></div><div><dt>包内文件</dt><dd>{dialog.item.fileCount}</dd></div><div><dt>内容摘要</dt><dd>{dialog.item.contentHash?.slice(0, 16)}</dd></div></dl></section><section className="local-skill-detail__section"><h4>来源位置</h4>{dialog.item.locations.map(location => <div className="skills-copy" key={location.path}><strong>{location.sourceLabel}</strong><small>{location.path}</small><div className="skills-actions"><button disabled={busy} onClick={() => run(() => inspect({ sourceId: location.sourceId, key: location.key }))}>预览此副本</button><button disabled={busy || dialog.item.defaultLocation?.path === location.path} onClick={() => run(async () => { const next = await request('setDefaultCopy', { contentHash: dialog.item.contentHash, sourceId: location.sourceId, key: location.key }); setDiscovery(next); setDialog(current => ({ ...current, item: next.skills.find(item => item.contentHash === current.item.contentHash) })); await refresh() })}>{dialog.item.defaultLocation?.path === location.path ? '默认使用此位置' : '设为默认位置'}</button></div></div>)}</section></>}
        {preview && <section className="skills-import-preview"><h3>确认导入内容</h3>{preview.candidates.map(item => <article key={item.key}><label><input type="checkbox" disabled={busy || Boolean(item.error)} checked={selected.includes(item.key)} onChange={event => setSelected(event.target.checked ? [...selected, item.key] : selected.filter(key => key !== item.key))} /><strong>{item.name}</strong></label><p>{item.error || item.description}</p><small>{item.fileCount} 个文件 · {Math.ceil((item.byteSize ?? 0) / 1024)} KiB</small>{item.instructionPreview && <details><summary>SKILL.md 预览</summary><pre>{item.instructionPreview}</pre></details>}</article>)}<footer><button className="primary" disabled={busy || !selected.length} onClick={() => run(importSelected)}>导入所选技能</button><button disabled={busy} onClick={() => setPreview(null)}>取消预览</button></footer></section>}
        {dialog.kind === 'remove' && <><p>移除“{dialog.item.name}”的Seal Harness副本？原始技能目录会保留。</p><footer><button disabled={busy} onClick={() => setDialog(null)}>取消</button><button disabled={busy} onClick={() => run(async () => { await request('remove', { id: dialog.item.id, expectedRevision: snapshot.revision }); setDialog(null); await refresh() })}>确认移除</button></footer></>}
      </div>
    </Dialog>}
  </main>
}
