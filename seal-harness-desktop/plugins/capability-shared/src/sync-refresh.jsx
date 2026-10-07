import React from 'react'
import { Icon } from './icons.jsx'

const labels = {
  ready: '已同步',
  loading: '同步中',
  error: '未连接',
  offline: '未连接',
  warning: '待同步',
}

export function SyncRefresh({ state = 'ready', onRefresh, disabled = false, label = '刷新目录' }) {
  const loading = state === 'loading'
  return <div className="resource-sync-refresh">
    <span className="resource-sync-state" role="status">
      <span className="resource-sync-state__dot" data-state={state} aria-hidden="true" />
      {labels[state] ?? labels.ready}
    </span>
    <button
      className="resource-sync-button"
      type="button"
      aria-label={label}
      title={label}
      data-loading={loading ? 'true' : undefined}
      disabled={disabled || loading}
      onClick={onRefresh}
    >
      <Icon name="refresh" size={18} strokeWidth={1.65} />
    </button>
  </div>
}
