// 来源：Stratex AgentInstanceCenter.vue，保留两种实例卡的独立层级。
import React, { useState } from 'react'
import { Icon } from '../../capability-shared/src/icons.jsx'

export const kinds = { autonomous: '自主型', flow: '流程型' }
export const targets = { local: '本机运行', remote: '固定主机', platform: '智枢托管' }
export const statuses = { running: '运行中', ready: '运行中', stopped: '已停止', checking: '检测中', starting: '启动中', stopping: '停止中', restarting: '重启中', unavailable: '暂不可用', incomplete: '部署未完成' }
export const transitioning = status => ['checking', 'starting', 'stopping', 'restarting'].includes(status)
export const targetIcon = target => ({ local: 'device', remote: 'server', platform: 'cloud' })[target]
export const isRunning = item => ['ready', 'running'].includes(item.status)
export const instanceKey = item => `${item.kind}:${item.target}:${item.id}`
const access = item => item.target === 'platform' ? '平台统一管理' : item.target === 'remote' || item.access === 'lan' ? '局域网' : '仅限本机'

export function IconButton({ label, icon, size = 17, ...props }) {
  return <button type="button" aria-label={label} title={label} {...props}><Icon name={icon} size={size} /></button>
}

export function InstanceCard({ item, busy, onAction, onDelete, onRename, onManage }) {
  const [editing, setEditing] = useState(false), [draft, setDraft] = useState(''), [error, setError] = useState('')
  const autonomous = item.kind === 'autonomous', running = isRunning(item), disabled = busy || transitioning(item.status)
  const statusClass = running ? 'running' : transitioning(item.status) ? 'checking' : item.status === 'incomplete' ? 'attention' : item.status
  const openLabel = item.native ? '打开对话' : autonomous ? '打开管理页' : '打开流程编辑器'
  const primaryLabel = transitioning(item.status) ? '处理中' : item.status === 'incomplete' ? '继续部署' : '启动'
  const rename = async event => {
    event.preventDefault()
    if (!draft.trim()) { setError('请输入实例名称。'); return }
    try { await onRename(item, draft.trim()); setEditing(false) } catch (cause) { setError(cause.message) }
  }
  const shortcuts = <div className="card-shortcuts" role="group" aria-label={`${item.name}实例操作`}>
    {autonomous && (running ? <IconButton disabled={disabled} label={openLabel} icon="external" onClick={() => onAction(item, 'open')} /> : <button className="primary compact-primary-action" disabled={disabled} onClick={() => onAction(item, 'start')}>{primaryLabel}</button>)}
    {running && <><IconButton disabled={disabled} label="重启" icon="restart" size={16} onClick={() => onAction(item, 'restart')} /><IconButton disabled={disabled} label="停止" icon="stop" size={16} onClick={() => onAction(item, 'stop')} /></>}
    {autonomous && running && <span className="card-shortcut-separator" aria-hidden="true" />}
    <IconButton disabled={disabled} className="instance-delete-trigger" label="删除实例" icon="delete" onClick={() => onDelete(item)} />
  </div>
  return <article className={`center-card${autonomous ? ' center-card--autonomous' : ''} center-card--${item.target}`} data-target={item.target}>
    <div className="card-top"><div className="card-title"><span className={`type-icon ${item.kind}`}><Icon name={autonomous ? 'thinking' : 'automation'} size={20} /></span><div className="card-title-text">
      {editing ? <><form className="center-card-name-editor" onSubmit={rename}><input autoFocus aria-label={`修改${item.name}的名称`} maxLength={80} value={draft} disabled={busy} onChange={event => { setDraft(event.target.value); setError('') }} onKeyDown={event => { if (event.key === 'Escape' && !busy) setEditing(false) }} /><button type="submit" aria-label="保存实例名称" disabled={busy || !draft.trim()}><Icon name="check" size={15} /></button><IconButton label="取消修改实例名称" icon="close" size={15} disabled={busy} onClick={() => setEditing(false)} /></form>{error && <p className="center-card-name-error" role="alert">{error}</p>}</> : <div className="center-card-name-row"><h3 title={item.name}>{item.name}</h3>{autonomous && item.target !== 'platform' && <IconButton label={`修改${item.name}的名称`} className="center-card-name-edit" disabled={disabled} icon="edit" size={14} onClick={() => { setDraft(item.name); setError(''); setEditing(true) }} />}</div>}
      {autonomous && <p className="card-subtitle card-location"><Icon name={targetIcon(item.target)} />{targets[item.target]}{item.host ? ` · ${item.host}` : ''}</p>}
    </div></div><span className={`status ${statusClass}`}><Icon name={targetIcon(item.target)} size={13} />{statuses[item.status] ?? item.status}</span></div>
    {!autonomous && <><p className="card-subtitle">{targets[item.target]}{item.host ? ` · ${item.host}` : ''} · {access(item)} · {item.activeVersionId ? `流程版本 ${item.activeVersionId}` : '尚未配置版本'}</p><div className="card-meta"><span>端口 {item.target === 'platform' ? '自动分配' : item.port ?? '—'}</span><span>{access(item)}</span></div></>}
    {item.statusReason && <p className="za-error" role="status">{item.statusReason}</p>}
    {autonomous ? <div className="autonomous-card-footer"><div className="card-meta autonomous-card-meta"><span className="card-meta-item"><Icon name={item.native ? 'device' : 'server-stack'} size={21} /><span className="za-workspace" title={item.cwd}>{item.native ? item.cwd || '原生对话' : `服务端口 ${item.target === 'platform' ? '自动分配' : item.port ?? '—'}`}</span></span><span className="card-meta-divider" /><span className="card-meta-item"><Icon name="shield" size={21} />{access(item)}</span></div>{shortcuts}</div> : <div className="card-actions"><button className="primary" disabled={disabled} onClick={() => onAction(item, running ? 'open' : 'start')}>{running ? openLabel : primaryLabel}</button>{item.target === 'local' && <button className="za-resource-button" disabled={busy} onClick={() => onManage(item)}>管理实例</button>}{shortcuts}</div>}
  </article>
}
