import React, { useEffect, useState } from 'react'
import { Icon } from '../../capability-shared/src/icons.jsx'
import { downloadZip, readZip } from '../../capability-shared/src/files.js'
import { styles as storeStyles } from '../../store/src/styles.js'
import { Dialog, SkillWorkbench } from './workbench.jsx'
import { styles } from './styles.js'
import { CatalogGrid } from '../../capability-shared/src/catalog-grid.jsx'

export function SkillsPanel({ api, onBack, startSkillCreation }) {
  const [snapshot, setSnapshot] = useState({ revision: 0, skills: [] })
  const [tab, setTab] = useState('system')
  const [search, setSearch] = useState('')
  const [busy, setBusy] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [dialog, setDialog] = useState(null)
  const [preview, setPreview] = useState(null)
  const [selected, setSelected] = useState([])
  const [path, setPath] = useState('')
  const [workbench, setWorkbench] = useState(null)
  const request = (action, payload = {}, signal) => api(`skills/${action}`, payload, signal)
  async function refresh(signal) {
    const next = await request('list', {}, signal)
    if (!signal?.aborted) setSnapshot(next)
  }
  useEffect(() => {
    const controller = new AbortController()
    setLoading(true)
    refresh(controller.signal).catch(error => { if (!controller.signal.aborted) setError(error.message) }).finally(() => { if (!controller.signal.aborted) setLoading(false) })
    return () => controller.abort()
  }, [api])
  async function run(work) {
    setBusy(true); setError(''); setNotice('')
    try { await work(); return true } catch (error) { setError(error.message); return false } finally { setBusy(false) }
  }
  async function inspect(payload) {
    const next = await request('inspect', payload)
    setPreview(next); setSelected(next.candidates.filter(item => !item.error).map(item => item.key))
  }
  async function importSelected() {
    const result = await request('import', { token: preview.token, entries: selected, expectedRevision: snapshot.revision })
    setPreview(null); setDialog(null); setTab('personal')
    await refresh(); setNotice(`已导入 ${result.skills.length} 个技能，当前未启用。`)
  }
  const matches = item => `${item.name} ${item.description}`.toLowerCase().includes(search.toLowerCase())
  const installed = snapshot.skills.filter(item => item.installed !== false && matches(item))
  const personal = snapshot.skills.filter(item => !['store', 'system'].includes(item.origin?.kind) && matches(item))
  const feedback = <>{error && <div role="alert" className="state-banner is-error"><strong>操作未完成</strong><span>{error}</span></div>}{notice && <p role="status" className="state-banner">{notice}</p>}</>
  const row = (item, context) => <article className="local-skill-row" key={item.id}>
    <div className="local-skill-row__main"><span className="local-skill-row__icon" aria-hidden="true"><Icon name="folder" size={17} /></span><button className="local-skill-row__copy" onClick={() => setWorkbench({ id: item.id })}><strong>{item.name}</strong><small>{item.description || '未提供描述'}</small></button></div>
    <span className="local-skill-row__source"><span>{item.origin?.kind === 'store' ? '技能市场' : '个人技能'}</span><small>{item.fileCount} 个文件</small></span>
    <span className={`local-skill-row__status ${item.enabled ? 'is-default' : ''}`}>{item.installed === false ? '未安装' : item.enabled ? item.active ? '已启用' : '已启用 · 未进入目录' : '未启用'}</span>
    {context === 'personal' && item.installed === false ? <button className="skills-install-button" disabled={busy} onClick={() => run(async () => { await request('installPersonal', { id: item.id, expectedRevision: snapshot.revision }); await refresh(); setNotice(`“${item.name}”已安装并启用。`) })}>安装</button> : <details className="skills-row-menu"><summary aria-label={`管理 ${item.name}`}><Icon name="more" size={16} /></summary><div>{item.installed !== false && <button disabled={busy} onClick={() => run(async () => { await request('setEnabled', { id: item.id, enabled: !item.enabled, expectedRevision: snapshot.revision }); await refresh() })}>{item.enabled ? '停用' : '启用'}</button>}<button disabled={busy} onClick={() => run(async () => { const result = await request('export', { id: item.id }); downloadZip({ fileName: result.fileName, contentBase64: result.zipBase64 }) })}>导出</button><button disabled={busy} onClick={() => setDialog({ kind: 'remove', item })}>移除</button></div></details>}
  </article>
  return <main className="zz-resource-page zz-store zz-skills resource-page-shell" aria-label="技能" aria-busy={busy}>
    <style>{storeStyles + styles}</style>
    <header className="resource-page-nav"><div className="resource-page-nav__path">{onBack && <button type="button" className="resource-page-nav__back" aria-label="返回会话，离开技能页" title="返回会话，离开技能页" onClick={onBack}><Icon name="back" size={17} /></button>}<strong>技能</strong><span className="resource-page-nav__badge">RESOURCE</span></div><div className="skills-actions"><button className="primary" disabled={busy} onClick={() => run(startSkillCreation)}>创建技能</button><button disabled={busy} onClick={() => { setError(''); setPreview(null); setDialog({ kind: 'import' }) }}>导入技能</button></div></header>
    <div className="skills-page-content"><section className="skills-hero"><h1>技能</h1><p>创建、安装并使用你的技能。</p></section>{feedback}
      <section className="local-skill-catalog" aria-label="已安装技能"><h2>已安装 <small>{installed.length}</small></h2>{loading ? <p role="status">正在读取技能…</p> : installed.length ? <div className="local-skill-list">{installed.map(item => row(item, 'installed'))}</div> : <div className="empty-state"><strong>还没有安装技能</strong><span>可以从个人技能安装，或导入技能。</span></div>}</section>
      <section className="local-skill-catalog skills-library" aria-label="技能库"><nav className="skills-primary-tabs" aria-label="技能分类"><button aria-pressed={tab === 'system'} onClick={() => setTab('system')}>系统</button><button aria-pressed={tab === 'personal'} onClick={() => setTab('personal')}>个人</button></nav><div className="local-skill-toolbar"><label className="local-skill-search"><Icon name="search" size={15} /><input type="search" aria-label="搜索技能" placeholder="搜索名称或描述" value={search} onChange={event => setSearch(event.target.value)} /></label></div>{tab === 'system' ? <CatalogGrid items={snapshot.catalog ?? []} label="系统技能" busy={busy} install={item => run(async () => { setSnapshot(await request('installCatalog', { id: item.id, expectedRevision: snapshot.revision })); setNotice(`${item.name} 已安装。`) })} empty={<div className="empty-state"><strong>暂无系统技能</strong><span>系统技能上线后将在这里显示。</span></div>} /> : personal.length ? <div className="local-skill-list">{personal.map(item => row(item, 'personal'))}</div> : <div className="empty-state"><strong>{search ? '没有符合条件的技能' : '还没有个人技能'}</strong><span>点击右上角「创建技能」，在会话中描述你需要的技能。</span></div>}</section>
    </div>
    {workbench && <SkillWorkbench key={workbench.id} api={api} id={workbench.id} revision={snapshot.revision} close={() => setWorkbench(null)} saved={refresh} />}
    {dialog && <Dialog title={dialog.kind === 'import' ? '导入技能' : '移除技能'} close={() => { setDialog(null); setPreview(null); setError('') }} busy={busy}><div className="skills-dialog-body">{feedback}{dialog.kind === 'import' ? <><p>选择包含 SKILL.md 的目录或 ZIP。导入后可单独启用。</p><label className="skills-import-drop" onDragOver={event => event.preventDefault()} onDrop={event => { event.preventDefault(); const file = event.dataTransfer.files[0]; if (file) run(async () => inspect({ zipBase64: await readZip(file) })) }}><span aria-hidden="true"><Icon name="upload" size={28} /></span><strong>选择或拖入技能 ZIP 包</strong><small>支持包含一个或多个技能的 ZIP，最大 64 MiB</small><input type="file" accept=".zip,application/zip" disabled={busy} onChange={event => { const file = event.target.files?.[0]; if (file) run(async () => inspect({ zipBase64: await readZip(file) })); event.target.value = '' }} /></label><form className="skills-path-form" onSubmit={event => { event.preventDefault(); run(() => inspect({ path })) }}><label>或从目录导入<input aria-label="技能目录或 ZIP 的绝对路径" value={path} onChange={event => setPath(event.target.value)} placeholder="技能目录或 ZIP 的绝对路径" /></label><button disabled={busy || !path.trim()}>预览导入</button></form>{preview && <section className="skills-import-preview"><h3>确认导入内容</h3>{preview.candidates.map(item => <article key={item.key}><label><input type="checkbox" disabled={busy || Boolean(item.error)} checked={selected.includes(item.key)} onChange={event => setSelected(event.target.checked ? [...selected, item.key] : selected.filter(key => key !== item.key))} /><strong>{item.name}</strong></label><p>{item.error || item.description}</p><small>{item.fileCount} 个文件</small></article>)}<footer><button className="primary" disabled={busy || !selected.length} onClick={() => run(importSelected)}>导入所选技能</button><button disabled={busy} onClick={() => setPreview(null)}>取消预览</button></footer></section>}</> : <><p>移除“{dialog.item.name}”的 Seal Harness 副本？原始技能目录会保留。</p><footer><button disabled={busy} onClick={() => setDialog(null)}>取消</button><button disabled={busy} onClick={() => run(async () => { await request('remove', { id: dialog.item.id, expectedRevision: snapshot.revision }); setDialog(null); await refresh() })}>确认移除</button></footer></>}</div></Dialog>}
  </main>
}
