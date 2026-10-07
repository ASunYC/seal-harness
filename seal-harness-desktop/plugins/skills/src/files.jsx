import React, { useState } from 'react'
import { Icon } from '../../capability-shared/src/icons.jsx'
import { renderSkillMarkdown } from './markdown.js'

// 来源：Stratex SkillFileTree / SkillFileEditor，保留目录树与正文双栏。
export function FileTree({ files, selected, select, prefix = '' }) {
  const children = new Map()
  for (const file of files) {
    const part = file.path.slice(prefix.length).split('/')[0]
    if (!children.has(part)) children.set(part, [])
    children.get(part).push(file)
  }
  return <ul className="skill-file-tree">{[...children].map(([name, entries]) => {
    const path = prefix + name
    return <li key={path}>{entries.length === 1 && entries[0].path === path
      ? <button type="button" title={path} aria-pressed={selected === path} onClick={() => select(path)}><span className="skill-file-tree-spacer" aria-hidden="true" /><Icon name="skill-file" size={17} strokeWidth={1.35} /><span className="skill-file-tree-name">{name}</span></button>
      : <details open><summary title={path}><Icon className="skill-file-tree-chevron" name="skill-chevron" size={13} strokeWidth={1.35} /><Icon name="skill-folder" size={17} strokeWidth={1.35} /><span className="skill-file-tree-name">{name}</span></summary><FileTree files={entries} prefix={`${path}/`} selected={selected} select={select} /></details>}</li>
  })}</ul>
}

export function FileView({ files, path, content, message, loading, select, editing, value, change, actions }) {
  return <section className="skill-file-workbench" aria-label="Skill 文件工作台">
    <aside className="skill-file-sidebar"><div className="skill-pane-heading"><strong>文件结构</strong><span>{files.length}</span></div><FileTree files={files} selected={path} select={select} /></aside>
    <div className="skill-file-content"><div className="skill-pane-heading"><span>{path || '请选择文件'}</span><div className="skill-editor-actions">{actions}</div></div>
      <div className="skill-file-metadata">{files.find(file => file.path === path)?.size ?? 0} B</div>
      <div className="skill-code-surface">{loading ? <p role="status">正在读取文件…</p> : message ? <p role="alert">{message}</p> : editing ? <textarea aria-label="技能文件内容" spellCheck="false" value={value} onChange={event => change(event.target.value)} /> : content !== null && content !== undefined ? /\.(md|markdown)$/i.test(path)
        ? <div className="skill-markdown-document" dangerouslySetInnerHTML={{ __html: renderSkillMarkdown(content) }} />
        : <pre aria-label="文件正文">{content}</pre> : <p>选择文件以查看内容。</p>}</div>
    </div>
  </section>
}

export function DrawerResize() {
  const [width, setWidth] = useState(() => Math.min(560, window.innerWidth - 48))
  const resize = (element, value) => {
    const next = Math.max(Math.min(400, window.innerWidth - 48), Math.min(window.innerWidth - 48, value))
    element.closest('dialog').style.width = `${next}px`
    setWidth(next)
  }
  return <div className="skill-detail-resizer" role="separator" aria-label="调整详情抽屉宽度" aria-orientation="vertical" aria-valuemin={Math.min(400, window.innerWidth - 48)} aria-valuemax={window.innerWidth - 48} aria-valuenow={Math.round(width)} tabIndex={0}
    onPointerDown={event => event.currentTarget.setPointerCapture(event.pointerId)}
    onPointerMove={event => { if (event.currentTarget.hasPointerCapture(event.pointerId)) resize(event.currentTarget, event.currentTarget.closest('dialog').getBoundingClientRect().right - event.clientX) }}
    onPointerUp={event => event.currentTarget.releasePointerCapture(event.pointerId)}
    onKeyDown={event => { if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return; event.preventDefault(); resize(event.currentTarget, event.key === 'Home' ? 400 : event.key === 'End' ? window.innerWidth - 48 : width + (event.key === 'ArrowLeft' ? 20 : -20)) }} />
}
