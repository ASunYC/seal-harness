import React, { useEffect, useState } from 'react'

const statusNames = { running: '执行中', completed: '已完成', failed: '失败', cancelled: '已取消', timeout: '超时', interrupted: '已中断' }
const date = value => value ? new Date(value).toLocaleString('zh-CN') : '—'
const zone = () => Intl.DateTimeFormat().resolvedOptions().timeZone
const days = ['日', '一', '二', '三', '四', '五', '六']
function describe(schedule) {
  if (schedule.kind === 'interval') return `每隔 ${schedule.minutes} 分钟`
  if (schedule.kind === 'once') return `一次执行 · ${date(schedule.at)}`
  return `${schedule.kind === 'daily' ? '每天' : `每周${schedule.weekdays.map(day => days[day]).join('、')}`} ${schedule.time} · ${schedule.timeZone}`
}
const blank = workspaces => ({ name: '', prompt: '', workspaceId: workspaces[0]?.workspaceId ?? '', enabled: true,
  kind: 'daily', time: '09:00', timeZone: zone(), weekdays: [1, 2, 3, 4, 5], minutes: 60, at: '' })
function editing(task) {
  const at = task.schedule.at ? new Date(task.schedule.at) : null
  const local = at ? new Date(at.getTime() - at.getTimezoneOffset() * 60000).toISOString().slice(0, 16) : ''
  return { ...blank([]), ...task, ...task.schedule, at: local }
}
function payload(form) {
  const schedule = form.kind === 'interval' ? { kind: form.kind, minutes: Number(form.minutes) }
    : form.kind === 'once' ? { kind: form.kind, at: new Date(form.at).toISOString() }
      : { kind: form.kind, time: form.time, timeZone: form.timeZone, ...(form.kind === 'weekly' ? { weekdays: form.weekdays } : {}) }
  return { ...(form.id ? { id: form.id } : {}), name: form.name, prompt: form.prompt,
    workspaceId: form.workspaceId, enabled: form.enabled, schedule }
}

export function ScheduledTasksPanel({ api, workspaces, openSession }) {
  const [tasks, setTasks] = useState([]), [loading, setLoading] = useState(true)
  const [form, setForm] = useState(null), [busy, setBusy] = useState(false), [error, setError] = useState('')
  const [historyId, setHistoryId] = useState(null), [runs, setRuns] = useState([]), [deleteId, setDeleteId] = useState(null)
  const refresh = async () => {
    const result = await api('list')
    setTasks(result)
    if (historyId && result.some(task => task.id === historyId)) setRuns(await api('runs', { id: historyId }))
    else setRuns([])
  }
  useEffect(() => {
    let alive = true
    const load = async () => {
      try {
        const result = await api('list')
        const history = historyId && result.some(task => task.id === historyId) ? await api('runs', { id: historyId }) : []
        if (alive) { setTasks(result); setRuns(history); setLoading(false) }
      } catch (cause) { if (alive) { setError(cause.message); setLoading(false) } }
    }
    void load()
    const timer = setInterval(load, 10000)
    return () => { alive = false; clearInterval(timer) }
  }, [api, historyId])
  const action = async operation => {
    if (busy) return
    setBusy(true); setError('')
    try { await operation(); await refresh() } catch (cause) { setError(cause.message) }
    finally { setBusy(false) }
  }
  const change = (key, value) => setForm(previous => ({ ...previous, [key]: value }))
  const submit = event => {
    event.preventDefault()
    void action(async () => {
      if (form.kind === 'weekly' && !form.weekdays.length) throw new Error('请至少选择一天。')
      await api('save', payload(form)); setForm(null)
    })
  }
  return <main className="seal-schedules" data-seal-nav-panel="schedules">
    <header className="seal-schedules__header"><div><p>SEAL HARNESS / AUTOMATIONS</p><h1>定时任务</h1><span>把重复的工作交给计划，每次执行都会创建独立会话。</span></div>
      <button className="seal-schedules__primary" disabled={busy || !workspaces.length} onClick={() => { setForm(blank(workspaces)); setDeleteId(null) }}>创建任务</button></header>
    <p className="seal-schedules__hint">应用运行且账号已登录时执行；关闭、休眠或退出登录期间错过的计划不会补跑。使用当前默认模型与权限策略，超过 30 分钟将请求停止。</p>
    {!workspaces.length && <p role="status">请先在首页创建工作区，再创建定时任务。</p>}
    {error && <div className="seal-schedules__error" role="alert">{error}<button disabled={busy} onClick={() => action(refresh)}>重试</button></div>}
    {form && <section className="seal-schedules__editor" role="dialog" aria-label={form.id ? '编辑定时任务' : '创建定时任务'}>
      <h2>{form.id ? '编辑任务' : '创建任务'}</h2><form onSubmit={submit}>
        <label>任务名称<input required maxLength={120} value={form.name} onChange={event => change('name', event.target.value)} placeholder="例如：每天检查项目状态" /></label>
        <label>工作区<select required value={form.workspaceId} onChange={event => change('workspaceId', event.target.value)}><option value="">选择工作区</option>{workspaces.map(workspace => <option key={workspace.workspaceId} value={workspace.workspaceId}>{workspace.title || workspace.path}</option>)}</select></label>
        <label className="seal-schedules__wide">执行内容<textarea required rows={5} maxLength={30000} value={form.prompt} onChange={event => change('prompt', event.target.value)} placeholder="描述每次执行时要完成的工作，以及期望输出。" /></label>
        <label>执行频率<select value={form.kind} onChange={event => change('kind', event.target.value)}><option value="daily">每天</option><option value="weekly">每周</option><option value="interval">每隔若干分钟</option><option value="once">指定时间执行一次</option></select></label>
        {['daily', 'weekly'].includes(form.kind) && <><label>执行时间<input required type="time" value={form.time} onChange={event => change('time', event.target.value)} /></label><label>时区<input required value={form.timeZone} onChange={event => change('timeZone', event.target.value)} /></label></>}
        {form.kind === 'weekly' && <fieldset className="seal-schedules__wide"><legend>执行日期</legend>{days.map((day, index) => <label key={day} className="seal-schedules__check"><input type="checkbox" checked={form.weekdays.includes(index)} onChange={event => change('weekdays', event.target.checked ? [...form.weekdays, index].sort() : form.weekdays.filter(value => value !== index))} />周{day}</label>)}</fieldset>}
        {form.kind === 'interval' && <label>间隔（分钟）<input required type="number" min={1} max={10080} value={form.minutes} onChange={event => change('minutes', event.target.value)} /></label>}
        {form.kind === 'once' && <label>本地执行时间<input required type="datetime-local" value={form.at} onChange={event => change('at', event.target.value)} /></label>}
        <label className="seal-schedules__check seal-schedules__wide"><input type="checkbox" checked={form.enabled} onChange={event => change('enabled', event.target.checked)} />保存后启用计划</label>
        <div className="seal-schedules__actions seal-schedules__wide"><button type="button" disabled={busy} onClick={() => setForm(null)}>取消</button><button className="seal-schedules__primary" disabled={busy} type="submit">{busy ? '保存中…' : '保存任务'}</button></div>
      </form></section>}
    {loading ? <p role="status">正在读取任务…</p> : !tasks.length ? <section className="seal-schedules__empty"><h2>当前没有定时任务</h2><p>创建一个计划，指定工作区和执行内容。</p></section> :
      <div className="seal-schedules__list">{tasks.map(task => <article key={task.id} className="seal-schedules__task"><div className="seal-schedules__task-title"><h2>{task.name}</h2><span className="seal-schedules__badge">{task.enabled ? '已启用' : '已暂停'}</span></div>
        <p>{describe(task.schedule)}</p><p className="seal-schedules__muted">工作区：{workspaces.find(workspace => workspace.workspaceId === task.workspaceId)?.title || '工作区已移除'} · 下次执行：{task.enabled ? date(task.nextRunAt) : '—'}</p>
        <p className="seal-schedules__prompt">{task.prompt}</p>
        {task.lastRun && <p className="seal-schedules__muted">最近执行：{statusNames[task.lastRun.status]} · {date(task.lastRun.startedAt)} {task.lastRun.error && <span>{task.lastRun.error}</span>}</p>}
        <div className="seal-schedules__actions"><button disabled={busy || task.lastRun?.status === 'running'} onClick={() => action(() => api('run', { id: task.id }))}>立即运行</button>
          {task.lastRun?.status === 'running' && <button disabled={busy} onClick={() => action(() => api('stop', { id: task.id }))}>停止执行</button>}
          <button disabled={busy} onClick={() => action(() => api('toggle', { id: task.id, enabled: !task.enabled }))}>{task.enabled ? '暂停' : '启用'}</button>
          <button disabled={busy} onClick={() => { setForm(editing(task)); setDeleteId(null) }}>编辑</button>
          <button disabled={busy} onClick={() => setHistoryId(historyId === task.id ? null : task.id)}>{historyId === task.id ? '收起记录' : '执行记录'}</button>
          {task.lastRun?.sessionId && <button disabled={busy} onClick={() => action(() => openSession(task.lastRun.sessionId))}>打开最近会话</button>}
          <button disabled={busy || task.lastRun?.status === 'running'} onClick={() => setDeleteId(task.id)}>删除</button>
        </div>
        {deleteId === task.id && <div role="alert"><p>删除计划与执行记录，已创建的会话仍会保留。</p><button disabled={busy} onClick={() => action(async () => { await api('delete', { id: task.id }); setDeleteId(null); if (historyId === task.id) { setHistoryId(null); setRuns([]) } })}>确认删除</button><button onClick={() => setDeleteId(null)}>取消删除</button></div>}
        {historyId === task.id && <section className="seal-schedules__history" aria-label={`${task.name}执行记录`}><h3>执行记录</h3>{!runs.length ? <p>尚无执行记录。</p> : runs.map(run => <div className="seal-schedules__run" key={run.id}><div><strong>{statusNames[run.status]}</strong><span>{date(run.startedAt)}{run.finishedAt ? ` → ${date(run.finishedAt)}` : ''}</span>{run.error && <p>{run.error}</p>}</div>{run.sessionId && <button disabled={busy} onClick={() => action(() => openSession(run.sessionId))}>打开会话</button>}</div>)}</section>}
      </article>)}</div>}
  </main>
}
