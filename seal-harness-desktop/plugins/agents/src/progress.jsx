// 来源：Stratex RuntimeProgress.vue；阶段只使用 Host 返回的事件。
import React, { useEffect, useState } from 'react'
import { Icon } from '../../capability-shared/src/icons.jsx'

export function RuntimeProgress({ operation, title, name }) {
  const [now, setNow] = useState(Date.now())
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(timer) }, [])
  const seconds = Math.max(0, Math.floor((now - (operation.startedAt ?? now)) / 1000))
  const events = operation.progress ?? [], failed = operation.state === 'failed'
  return <div className="za-progress"><section className="runtime-progress" aria-label="运行操作进度" aria-busy={operation.state === 'running'}>
    <div className="progress-heading"><span className="progress-orbit"><Icon name="automation" size={27} /></span><div><h3>{title}</h3>{name && <p className="instance-name">{name}</p>}</div><span className="progress-pill">{failed ? '未完成' : operation.state === 'succeeded' ? '已完成' : '处理中'}</span></div>
    <div className="current-stage" role="status" aria-live="polite"><div className="stage-copy"><span className="stage-label">当前步骤</span><p className="stage-detail">{operation.error || operation.stage}</p>{!failed && <p className="stage-guidance"><strong>操作正在进行，请稍候。</strong>{operation.target === 'platform' ? '任务由智枢异步执行，状态会自动更新。' : '请保持工作台与运行环境连接，无需重复操作。'}</p>}</div>{operation.startedAt && <div className="stage-timing"><span>已等待 <strong>{String(Math.floor(seconds / 60)).padStart(2, '0')}:{String(seconds % 60).padStart(2, '0')}</strong></span></div>}</div>
    {events.length > 0 ? <div className="actual-progress"><div className="progress-summary"><span>实际执行进度</span><strong>{events.filter(event => event.state === 'succeeded').length} 项已完成</strong></div><ol className="actual-steps" aria-label="真实执行阶段">{events.map((event, index) => <li key={`${event.stage}-${index}`} className={`is-${event.state}`} aria-current={event.state === 'running' ? 'step' : undefined}><span className="step-marker">{event.state === 'succeeded' ? <Icon name="check" size={12} /> : event.state === 'failed' ? <Icon name="close" size={12} /> : null}</span><span className="step-copy"><strong>{event.message}</strong></span><span className="step-state">{{ succeeded: '已完成', running: '进行中', failed: '未完成' }[event.state] ?? '等待中'}</span></li>)}</ol></div> : <p className="progress-footer">正在等待运行环境返回执行结果。</p>}
  </section></div>
}
