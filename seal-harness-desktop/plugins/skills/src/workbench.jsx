import React, { useEffect, useRef, useState } from 'react'
import { Icon } from '../../capability-shared/src/icons.jsx'
import { DrawerResize, FileView } from './files.jsx'
import { renderSkillMarkdown } from './markdown.js'

// 原生 dialog 提供焦点约束、Escape 和还焦，视觉结构来自 SkillWorkbench / OverlaySurface。
export function Dialog({ title, close, busy, children, drawer = false, wide = false }) {
  const ref = useRef(null)
  useEffect(() => { const dialog = ref.current; dialog.showModal(); return () => dialog.close() }, [])
  return <dialog ref={ref} className={`skills-dialog ${drawer ? 'is-drawer' : ''} ${wide ? 'is-editor' : ''}`} aria-label={title} onCancel={event => { event.preventDefault(); if (!busy) close() }}>
    {drawer && <DrawerResize />}
    <header className="skills-dialog-header"><strong>{title}</strong><button type="button" disabled={busy} aria-label={`关闭${title}`} onClick={close}><Icon name="close" size={16} /></button></header>{children}
  </dialog>
}

export function SkillWorkbench({ api, id, revision, close, saved }) {
  const [detail, setDetail] = useState(null)
  const [tab, setTab] = useState(id ? 'overview' : 'files')
  const [path, setPath] = useState('SKILL.md')
  const [editing, setEditing] = useState(!id)
  const [value, setValue] = useState('---\nname: new-skill\ndescription: 技能用途\n---\n\n在这里编写技能指令。\n')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(Boolean(id))
  const [busy, setBusy] = useState(false)
  const [pending, setPending] = useState(null)
  const original = useRef(value)
  const [reload, setReload] = useState(0)
  useEffect(() => {
    if (!id) return
    const controller = new AbortController()
    setLoading(true); setError('')
    api('skills/detail', { id, path, edit: true }, controller.signal).then(next => {
      if (controller.signal.aborted) return
      setDetail(next); setValue(next.fileContent ?? next.rawContent); original.current = next.fileContent ?? next.rawContent
    }).catch(error => { if (!controller.signal.aborted) setError(error.message) }).finally(() => { if (!controller.signal.aborted) setLoading(false) })
    return () => controller.abort()
  }, [api, id, path, reload])
  const leave = action => { if (editing && value !== original.current) setPending(() => action); else action() }
  async function save() {
    setBusy(true); setError('')
    try {
      await api(id ? 'skills/saveFile' : 'skills/create', { ...(id ? { id, path, expectedHash: detail.contentHash } : {}), content: value, expectedRevision: revision })
      original.current = value; setEditing(false); await saved()
      if (id) setReload(current => current + 1)
      else close()
    } catch (error) { setError(error.message) } finally { setBusy(false) }
  }
  return <Dialog title={id ? detail?.name ?? '技能详情' : '新建技能'} close={() => leave(close)} busy={busy} drawer={!editing} wide={editing}>
    <div className="skills-workbench-content">
      {error && <p role="alert" className="state-banner is-error">{error} <button disabled={busy} onClick={() => leave(() => setReload(value => value + 1))}>重新读取</button></p>}
      {detail && <p className="skills-description">{detail.description}</p>}
      <nav className="skills-detail-tabs" aria-label="技能详情页签">{['overview', 'files'].map(key => <button key={key} disabled={!id && key === 'overview'} aria-pressed={tab === key} onClick={() => leave(() => { setTab(key); setEditing(false) })}>{key === 'overview' ? '概览' : '文件'}</button>)}</nav>
      {tab === 'overview' ? loading ? <p role="status">正在读取技能…</p> : detail && <section className="local-skill-detail__section"><h4>基本信息</h4><dl><div><dt>类型</dt><dd>本地 Skill</dd></div><div><dt>包内文件</dt><dd>{detail.fileCount}</dd></div><div><dt>模型调用</dt><dd>{detail.invocation.modelInvocable ? '允许' : '禁止'}</dd></div><div><dt>手动调用</dt><dd>{detail.invocation.userInvocable ? '允许' : '禁止'}</dd></div><div><dt>内容摘要</dt><dd title={detail.contentHash}>{detail.contentHash.slice(0, 16)}</dd></div></dl><h4>SKILL.md</h4><div className="skill-markdown-document" dangerouslySetInnerHTML={{ __html: renderSkillMarkdown(detail.content) }} />{detail.origin?.permissions?.length > 0 && <details><summary>商店声明的权限</summary><pre>{JSON.stringify(detail.origin.permissions, null, 2)}</pre></details>}</section>
        : <FileView files={detail?.files ?? [{ path: 'SKILL.md', size: 0 }]} path={path} content={value} loading={loading} message={error} select={next => leave(() => { setPath(next); setEditing(false) })} editing={editing} value={value} change={setValue} actions={editing ? <><button disabled={busy} onClick={() => leave(() => { setValue(original.current); setEditing(false) })}>取消编辑</button><button className="primary" disabled={busy || !value.trim()} onClick={save}>{busy ? '正在保存…' : '保存技能'}</button></> : <button disabled={loading || Boolean(error)} onClick={() => setEditing(true)}>编辑当前文件</button>} />}
    </div>
    {pending && <Dialog title="未保存的修改" close={() => setPending(null)}><div className="skills-dialog-body"><p>当前文件有未保存的修改，离开将丢弃这些修改。</p><footer><button onClick={() => setPending(null)}>继续编辑</button><button onClick={() => { const action = pending; setPending(null); setValue(original.current); setEditing(false); action() }}>放弃修改</button></footer></div></Dialog>}
  </Dialog>
}
