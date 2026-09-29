import React, { useEffect, useRef } from 'react'
import { Icon } from '../../capability-shared/src/icons.jsx'

export const stateNames = {
  queued: '排队中',
  processing: '处理中',
  ready: '已就绪',
  failed: '处理失败',
  stale: '等待重新整理',
  archived: '已归档',
  pending: '等待整理',
  running: '整理中',
  active: '已安装',
  updating: '正在更新',
  revoked: '权限已撤销'
}
export const formatSize = (value) =>
  value < 1024
    ? `${value} B`
    : value < 1024 ** 2
      ? `${(value / 1024).toFixed(1)} KB`
      : `${(value / 1024 ** 2).toFixed(1)} MB`
export const description = (group) =>
  group.description?.trim() || group.analysis?.summary.trim() || '该资料集暂未填写描述。'
// 沿用 Stratex 的单分类投影：开发类优先，其余（含空分类）归办公类。
export const collectionCategory = (group) => group.categories.includes('development') ? 'development' : 'office'
export const canManage = (group) => group.lifecycle !== 'archived' && ['owner', 'editor'].includes(group.access)
export const canShare = (group) => group.lifecycle !== 'archived' && group.access === 'owner'
// Stratex VaultDialogShell 的布局；原生 dialog 负责模态焦点、Esc 和还焦。
export function Modal({ title, description, close, children, footer, wide, drawer = false }) {
  const ref = useRef(null)
  useEffect(() => {
    const dialog = ref.current
    dialog.showModal()
    return () => dialog.close()
  }, [])
  return (
    <dialog
      className={`zz-knowledge-dialog ${drawer ? 'preview-panel' : `vault-modal__panel ${wide ? 'vault-modal__panel--wide' : ''}`}`}
      ref={ref}
      onCancel={(event) => {
        event.preventDefault()
        close()
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) {
          const rect = event.currentTarget.getBoundingClientRect()
          if (
            event.clientX < rect.left ||
            event.clientX > rect.right ||
            event.clientY < rect.top ||
            event.clientY > rect.bottom
          )
            close()
        }
      }}
      aria-label={title}
    >
      <header className={drawer ? '' : 'vault-modal__header'}>
        <div>
          <h2>{title}</h2>
          {description && <p>{description}</p>}
        </div>
        <button className="vault-modal__close" type="button" onClick={close} aria-label="关闭">
          <Icon name="close" size={18} />
        </button>
      </header>
      {drawer ? <article>{children}</article> : <div className="vault-modal__body">{children}</div>}
      {footer && <footer className="vault-modal__footer">{footer}</footer>}
    </dialog>
  )
}

export function DropZone({ disabled, choose, drop }) {
  const ref = useRef(null)
  return (
    <button
      ref={ref}
      className="upload-zone"
      type="button"
      disabled={disabled}
      onClick={choose}
      onDragOver={(event) => {
        event.preventDefault()
        if (!disabled) ref.current.classList.add('is-dragging')
      }}
      onDragLeave={() => ref.current.classList.remove('is-dragging')}
      onDrop={(event) => {
        event.preventDefault()
        event.stopPropagation()
        ref.current.classList.remove('is-dragging')
        if (!disabled) drop([...event.dataTransfer.files])
      }}
    >
      <span className="upload-zone__icon" aria-hidden="true">
        <Icon name="arrow-up" size={22} />
      </span>
      <strong>拖入文件或选择文件</strong>
      <small>支持 Word、Excel、PowerPoint、PDF、图片、网页与文本资料；音频和视频暂不支持。</small>
    </button>
  )
}
