import React, { useEffect, useState, useSyncExternalStore } from 'react'
import { AnimatedSidebarIcon } from '../../capability-shared/src/sidebar-icons.jsx'
import { Icon } from '../../capability-shared/src/icons.jsx'
import { resourceStyles } from '../../capability-shared/src/resource-styles.js'
import { styles } from './styles.js'

export const inject = ['slots', 'connection', 'layout', 'sessions', 'uiWorkspace', 'sealHarnessAuthClient']

export function ProjectPanel({ auth, request, createConversation, onBack }) {
  const status = useSyncExternalStore(auth.subscribe, auth.getStatus, auth.getStatus)
  const [items, setItems] = useState([])
  const [editing, setEditing] = useState(null)
  const [deleting, setDeleting] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const account = `${status?.accountId ?? ''}:${status?.epoch ?? 0}`
  const refresh = async signal => {
    const result = await request('list', {}, signal)
    if (!signal?.aborted) setItems(result.items)
  }
  useEffect(() => {
    setItems([]); setEditing(null); setDeleting(null); setError(''); setNotice('')
    if (!status?.user) return
    const lifetime = new AbortController()
    void refresh(lifetime.signal).catch(failure => { if (!lifetime.signal.aborted) setError(failure.message) })
    return () => lifetime.abort()
  }, [account])
  const run = async work => {
    setBusy(true); setError(''); setNotice('')
    try { await work() }
    catch (failure) { setError(failure.message) }
    finally { setBusy(false) }
  }
  const save = event => {
    event.preventDefault()
    const input = Object.fromEntries(new FormData(event.currentTarget))
    void run(async () => {
      await request(editing?.id ? 'update' : 'create', editing?.id ? { ...input, id: editing.id } : input)
      await refresh()
      setEditing(null)
      setNotice('项目已保存。')
    })
  }
  return <main className="zz-resource-page resource-page-shell seal-harness-local-projects">
    <style>{resourceStyles + styles}</style>
    <header className="resource-page-nav"><div className="resource-page-nav__path"><button className="resource-page-nav__back" type="button" onClick={onBack} aria-label="返回会话，离开项目页" title="返回会话，离开项目页"><Icon name="back" size={17} /></button><strong>项目</strong><span className="resource-page-nav__badge">RESOURCE</span></div>
      <button className="btn btn--primary" type="button" disabled={busy || !status?.user} onClick={() => setEditing({ name: '', rootPath: '', description: '' })}>新建项目</button></header>
    <div className="seal-harness-local-projects-content">
      <section className="resource-page-hero"><div><p className="resource-page-hero__eyebrow">WORKBENCH RESOURCE</p><h1>项目</h1><p className="resource-page-hero__subtitle">工作目录和项目资料保存在本机。</p></div></section>
    {!status?.user ? <section className="seal-harness-local-projects-empty"><p>登录本机账号后管理项目。</p><button type="button" onClick={() => auth.openLogin()}>去登录</button></section> : <>
      {error && <p role="alert" className="seal-harness-local-projects-error">{error}</p>}
      {notice && <p role="status" className="seal-harness-local-projects-notice">{notice}</p>}
      {editing && <form onSubmit={save} className="seal-harness-local-projects-form">
        <h2>{editing.id ? '编辑项目' : '新建项目'}</h2>
        <label>名称<input name="name" defaultValue={editing.name} maxLength={100} required disabled={busy} /></label>
        <label>工作目录<input name="rootPath" defaultValue={editing.rootPath} placeholder="输入已存在的绝对目录路径" required disabled={busy} /></label>
        <label>说明<textarea name="description" defaultValue={editing.description} maxLength={4000} disabled={busy} /></label>
        <div><button className="btn btn--secondary" type="button" onClick={() => setEditing(null)} disabled={busy}>取消</button><button className="btn btn--primary" type="submit" disabled={busy}>保存</button></div>
      </form>}
      {!editing && <section className="seal-harness-local-projects-list" aria-label="本地项目">
        {!items.length && <p className="seal-harness-local-projects-empty">还没有项目。创建项目并选择工作目录后即可开始对话。</p>}
        {items.map(project => <article key={project.id}>
          <div><h2>{project.name}</h2><p className="seal-harness-local-projects-path" title={project.rootPath}>{project.rootPath}</p>{project.description && <p>{project.description}</p>}</div>
          <div className="seal-harness-local-projects-actions">
            <button className="btn btn--primary" type="button" disabled={busy} onClick={() => void run(() => createConversation(project))}>开始对话</button>
            <button className="btn btn--secondary" type="button" disabled={busy} onClick={() => setEditing(project)}>编辑</button>
            <button className="btn btn--ghost" type="button" disabled={busy} onClick={() => setDeleting(project)}>删除</button>
          </div>
        </article>)}
      </section>}
      {deleting && <div className="seal-harness-local-projects-overlay" role="dialog" aria-label="删除项目"><div><h2>删除项目</h2><p>删除“{deleting.name}”的本地项目记录？工作目录和会话不会删除。</p><footer><button className="btn btn--secondary" type="button" disabled={busy} onClick={() => setDeleting(null)}>取消</button><button className="btn btn--primary btn--danger" type="button" disabled={busy} onClick={() => void run(async () => { await request('delete', { id: deleting.id }); setDeleting(null); await refresh() })}>确认删除</button></footer></div></div>}
    </>}
    </div>
  </main>
}

export function apply(ctx) {
  const auth = ctx.sealHarnessAuthClient
  const request = async (action, payload = {}, signal) => {
    const result = await ctx.connection.rpc.call('/api', `seal-harness-projects/${action}`, payload, signal)
    if (!result.ok) throw new Error(result.error.message)
    return result.value
  }
  const createConversation = async project => {
    const sessionId = await ctx.sessions.create({ cwd: project.rootPath })
    ctx.uiWorkspace.openSession(sessionId)
    ctx.layout.selectPanel(null)
  }
  function Panel() { return <ProjectPanel auth={auth} request={request} createConversation={createConversation} onBack={() => ctx.layout.selectPanel(null)} /> }
  function SidebarIcon(props) { return <AnimatedSidebarIcon name="projects" {...props} /> }
  ctx.slots.inject('main', () => ctx.slots.register({ name: 'main', key: 'seal-harness-projects' }, Panel))
  ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({ name: 'sidebar.panellist', id: 'seal-harness-projects', order: 10, label: () => '项目' }, SidebarIcon))
}
