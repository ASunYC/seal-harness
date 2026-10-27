import React, { useEffect, useState, useSyncExternalStore } from 'react'
import { leaveResource, registerPanel } from '../../capability-shared/src/client.jsx'
import { departmentPath, departmentPeople, descendantIds, matchingDirectory } from './model.js'
import { styles } from './styles.js'

export const inject = ['slots', 'layout', 'connection', 'sealHarnessAuthClient', 'sealHarnessNavigation']

const empty = { companyName: '我的组织', departments: [], people: [] }
const departmentDraft = (item, parentId = null) => ({
  ...(item?.id ? { id: item.id } : {}), name: item?.name ?? '', parentId: item?.parentId ?? parentId,
  sortOrder: item?.sortOrder ?? 0, enabled: item?.enabled ?? true,
})
const personDraft = (item, departmentId = null) => ({
  ...(item?.id ? { id: item.id } : {}), name: item?.name ?? '', departmentId: item?.departmentId ?? departmentId,
  jobTitle: item?.jobTitle ?? '', email: item?.email ?? '', phone: item?.phone ?? '', status: item?.status ?? 'active',
})

function DepartmentTree({ snapshot, selected, select }) {
  const render = parentId => snapshot.departments.filter(item => item.parentId === parentId).map(item => {
    const count = departmentPeople(snapshot, item.id).filter(person => person.status === 'active').length
    return <li key={item.id}><button type="button" aria-current={selected?.kind === 'department' && selected.id === item.id ? 'page' : undefined}
      onClick={() => select({ kind: 'department', id: item.id })}><span>▦ {item.name}{!item.enabled && '（已停用）'}</span><small>{count}</small></button>
      <ul>{render(item.id)}</ul></li>
  })
  return <ul className="seal-org-tree">{render(null)}</ul>
}

function Editor({ editor, form, setForm, snapshot, save, cancel }) {
  const update = (key, value) => setForm(current => ({ ...current, [key]: value }))
  const blocked = form.id && editor.kind === 'department' ? descendantIds(snapshot.departments, form.id) : new Set()
  const departmentOptions = snapshot.departments.filter(item => !blocked.has(item.id))
  const submit = event => { event.preventDefault(); void save(editor.kind, form) }
  return <form className="seal-org-editor" onSubmit={submit}>
    <h2>{editor.kind === 'company' ? '公司名称' : editor.kind === 'department' ? form.id ? '编辑部门' : '新建部门' : form.id ? '编辑人员' : '新增人员'}</h2>
    <label><span>{editor.kind === 'company' ? '名称' : editor.kind === 'department' ? '部门名称' : '姓名'}</span>
      <input required maxLength={editor.kind === 'company' ? 80 : 100} value={form.name} onChange={event => update('name', event.target.value)} /></label>
    {editor.kind === 'department' && <>
      <label><span>上级部门</span><select value={form.parentId ?? ''} onChange={event => update('parentId', event.target.value || null)}><option value="">公司直属</option>{departmentOptions.map(item => <option key={item.id} value={item.id}>{departmentPath(snapshot.departments, item.id).map(part => part.name).join(' / ')}</option>)}</select></label>
      <label><span>排序</span><input type="number" min="0" max="100000" value={form.sortOrder} onChange={event => update('sortOrder', Number(event.target.value))} /></label>
      <label className="seal-org-check"><input type="checkbox" checked={form.enabled} onChange={event => update('enabled', event.target.checked)} />启用部门</label>
    </>}
    {editor.kind === 'person' && <>
      <label><span>所属部门</span><select value={form.departmentId ?? ''} onChange={event => update('departmentId', event.target.value || null)}><option value="">未分配</option>{snapshot.departments.filter(item => item.enabled || item.id === form.departmentId).map(item => <option key={item.id} value={item.id}>{departmentPath(snapshot.departments, item.id).map(part => part.name).join(' / ')}</option>)}</select></label>
      <label><span>岗位</span><input maxLength="100" value={form.jobTitle} onChange={event => update('jobTitle', event.target.value)} /></label>
      <label><span>邮箱</span><input type="email" value={form.email} onChange={event => update('email', event.target.value)} /></label>
      <label><span>电话</span><input maxLength="64" value={form.phone} onChange={event => update('phone', event.target.value)} /></label>
      <label><span>状态</span><select value={form.status} onChange={event => update('status', event.target.value)}><option value="active">在职</option><option value="disabled">已停用</option></select></label>
    </>}
    <div className="seal-org-actions"><button type="button" onClick={cancel}>取消</button><button className="seal-org-primary" type="submit">保存</button></div>
  </form>
}

export function OrganizationPanel({ api, onBack }) {
  const [snapshot, setSnapshot] = useState(empty)
  const [loading, setLoading] = useState(true), [busy, setBusy] = useState(false), [error, setError] = useState('')
  const [query, setQuery] = useState(''), [selected, setSelected] = useState(null)
  const [editor, setEditor] = useState(null), [form, setForm] = useState(null), [deleting, setDeleting] = useState(null)
  useEffect(() => {
    const controller = new AbortController()
    api('snapshot', {}, controller.signal).then(value => { if (!controller.signal.aborted) setSnapshot(value) })
      .catch(cause => { if (!controller.signal.aborted) setError(cause.message) })
      .finally(() => { if (!controller.signal.aborted) setLoading(false) })
    return () => controller.abort()
  }, [api])
  const start = (kind, item, parentId = null) => {
    setError(''); setDeleting(null); setEditor({ kind })
    setForm(kind === 'company' ? { name: snapshot.companyName } : kind === 'department' ? departmentDraft(item, parentId) : personDraft(item, parentId))
  }
  const perform = async (action, payload) => {
    setBusy(true); setError('')
    try {
      const value = await api(action, payload)
      setSnapshot(value); setEditor(null); setDeleting(null)
      return value
    } catch (cause) { setError(cause.message); return null }
    finally { setBusy(false) }
  }
  const save = async (kind, payload) => {
    const value = await perform(`${kind}/save`, payload)
    if (value?.id) setSelected({ kind, id: value.id })
  }
  const remove = async () => {
    const value = await perform(`${deleting.kind}/delete`, { id: deleting.id })
    if (value) setSelected(null)
  }
  const search = matchingDirectory(snapshot, query)
  const department = selected?.kind === 'department' ? snapshot.departments.find(item => item.id === selected.id) : null
  const person = selected?.kind === 'person' ? snapshot.people.find(item => item.id === selected.id) : null
  const members = selected?.kind === 'unassigned' ? snapshot.people.filter(item => !item.departmentId)
    : department ? departmentPeople(snapshot, department.id) : snapshot.people
  return <main className="seal-org-page" aria-busy={busy || loading}>
    <header className="seal-org-header"><div>{onBack && <button type="button" aria-label="返回会话" onClick={onBack}>←</button>}<h1>组织架构</h1><small>本机目录</small></div><div className="seal-org-actions"><button type="button" onClick={() => start('company')}>公司名称</button><button type="button" onClick={() => start('department', null, department?.id ?? null)}>新建部门</button><button className="seal-org-primary" type="button" onClick={() => start('person', null, department?.id ?? null)}>新增人员</button></div></header>
    {error && <p className="seal-org-error" role="alert">{error}<button type="button" onClick={() => { setError(''); setLoading(true); api('snapshot').then(setSnapshot).catch(cause => setError(cause.message)).finally(() => setLoading(false)) }}>重试</button></p>}
    <div className="seal-org-columns">
      <aside className="seal-org-sidebar" aria-label="组织目录"><div className="seal-org-sidebar-head"><strong>{snapshot.companyName}</strong><span>{snapshot.people.filter(item => item.status === 'active').length} 人 · {snapshot.departments.filter(item => item.enabled).length} 部门</span></div>
        <label className="seal-org-search"><span className="sr-only">搜索人员或部门</span><input type="search" value={query} placeholder="搜索姓名、部门或岗位" onChange={event => setQuery(event.target.value)} /></label>
        {loading ? <p role="status">正在加载组织架构…</p> : search ? <div className="seal-org-results"><strong>部门</strong>{search.departments.map(item => <button key={item.id} type="button" onClick={() => setSelected({ kind: 'department', id: item.id })}>{item.name}</button>)}<strong>人员</strong>{search.people.map(item => <button key={item.id} type="button" onClick={() => setSelected({ kind: 'person', id: item.id })}>{item.name}<small>{item.jobTitle}</small></button>)}{!search.departments.length && !search.people.length && <p>没有找到匹配的人员或部门。</p>}</div> : <><button className="seal-org-root" type="button" aria-current={!selected ? 'page' : undefined} onClick={() => setSelected(null)}>全部人员</button><DepartmentTree snapshot={snapshot} selected={selected} select={setSelected} /><button className="seal-org-root" type="button" onClick={() => setSelected({ kind: 'unassigned' })}>未分配部门</button></>}
      </aside>
      <section className="seal-org-content" aria-label="组织详情">
        {editor ? <Editor editor={editor} form={form} setForm={setForm} snapshot={snapshot} save={save} cancel={() => setEditor(null)} /> : deleting ? <div className="seal-org-confirm"><h2>确认删除？</h2><p>将删除{deleting.kind === 'person' ? '人员资料' : '部门'}“{deleting.name}”。</p><div className="seal-org-actions"><button type="button" onClick={() => setDeleting(null)}>取消</button><button className="seal-org-danger" type="button" disabled={busy} onClick={() => void remove()}>删除</button></div></div> : person ? <><div className="seal-org-detail-head"><div><h2>{person.name}</h2><p>{person.jobTitle || '未填写岗位'} · {person.status === 'active' ? '在职' : '已停用'}</p></div><div className="seal-org-actions"><button type="button" onClick={() => start('person', person)}>编辑</button><button className="seal-org-danger" type="button" onClick={() => setDeleting({ kind: 'person', id: person.id, name: person.name })}>删除</button></div></div><dl className="seal-org-detail"><div><dt>部门</dt><dd>{departmentPath(snapshot.departments, person.departmentId).map(item => item.name).join(' / ') || '未分配'}</dd></div><div><dt>邮箱</dt><dd>{person.email || '未填写'}</dd></div><div><dt>电话</dt><dd>{person.phone || '未填写'}</dd></div></dl></> : <><div className="seal-org-detail-head"><div><h2>{department?.name ?? (selected?.kind === 'unassigned' ? '未分配部门' : snapshot.companyName)}</h2><p>{members.length} 位人员</p></div>{department && <div className="seal-org-actions"><button type="button" onClick={() => start('department', department)}>编辑部门</button><button className="seal-org-danger" type="button" onClick={() => setDeleting({ kind: 'department', id: department.id, name: department.name })}>删除部门</button></div>}</div><div className="seal-org-person-list">{members.map(item => <button type="button" key={item.id} onClick={() => setSelected({ kind: 'person', id: item.id })}><span className="seal-org-avatar" aria-hidden="true">{item.name.slice(0, 1)}</span><span><strong>{item.name}</strong><small>{item.jobTitle || departmentPath(snapshot.departments, item.departmentId).map(part => part.name).join(' / ') || '未分配部门'}</small></span><span>›</span></button>)}{!members.length && <p className="seal-org-empty">这里还没有人员。可以从右上角新增人员。</p>}</div></>}
      </section>
    </div>
  </main>
}

export function apply(ctx) {
  const api = async (action, payload = {}, signal) => {
    const result = await ctx.connection.rpc.call('/api', `seal-harness-organization/${action}`, payload, signal)
    if (!result.ok) throw new Error(result.error.message)
    return result.value
  }
  ctx.effect(() => {
    const element = document.createElement('style')
    element.textContent = styles
    document.head.append(element)
    return () => element.remove()
  }, 'seal-harness organization styles')
  function Panel() {
    const status = useSyncExternalStore(ctx.sealHarnessAuthClient.subscribe, ctx.sealHarnessAuthClient.getStatus)
    return status?.user ? <OrganizationPanel key={`${status.accountId}:${status.epoch}`} api={api} onBack={() => leaveResource(ctx)} />
      : <main className="seal-org-page"><h1>组织架构</h1><p>请先登录本地账号。</p></main>
  }
  registerPanel(ctx, { id: 'organization', label: '组织架构', order: 15, icon: 'organization', description: '管理本机部门与人员目录' }, Panel)
}
