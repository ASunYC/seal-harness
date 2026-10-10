import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import { nextOccurrence, scheduleSchema } from './schedule.js'

const taskSchema = z.strictObject({
  id: z.string().optional(), name: z.string().trim().min(1).max(120), prompt: z.string().trim().min(1).max(30000),
  workspaceId: z.string().min(1), schedule: scheduleSchema, enabled: z.boolean().default(true),
})
const taskFromRow = row => ({ id: row.id, name: row.name, prompt: row.prompt, workspaceId: row.workspace_id,
  schedule: JSON.parse(row.schedule_json), enabled: !!row.enabled, nextRunAt: row.next_run_at,
  createdAt: row.created_at, updatedAt: row.updated_at })
const runFromRow = row => ({ id: row.id, taskId: row.task_id, taskName: row.task_name,
  sessionId: row.session_available ? row.session_id : null, status: row.status, startedAt: row.started_at,
  finishedAt: row.finished_at, error: row.error })

export class ScheduledTaskError extends Error {}

export class ScheduledTasksService {
  active = new Map()
  constructor({ storage, identity, workspaceRegistry, execute, now = Date.now, logger }) {
    Object.assign(this, { storage, identity, workspaceRegistry, execute, now, logger })
    this.db = storage.db
    this.db.prepare("UPDATE scheduled_runs SET status = 'interrupted', finished_at = ?, error = '应用关闭或插件重载，执行未确认完成。' WHERE status = 'running'").run(now())
    this.accountChanged()
    this.unsubscribe = identity.subscribe(() => this.accountChanged())
  }
  owner() {
    const session = this.identity.getSession()
    if (!session) throw new ScheduledTaskError('请先登录本地账号。')
    return session.accountId
  }
  task(id, owner = this.owner()) {
    const row = this.db.prepare('SELECT * FROM scheduled_tasks WHERE id = ? AND user_id = ?').get(id, owner)
    if (!row) throw new ScheduledTaskError('任务不存在或不属于当前账号。')
    return taskFromRow(row)
  }
  list() {
    return this.db.prepare('SELECT * FROM scheduled_tasks WHERE user_id = ? ORDER BY created_at DESC, id').all(this.owner()).map(row => ({
      ...taskFromRow(row), lastRun: this.latest(row.id),
    }))
  }
  latest(id) {
    const row = this.db.prepare('SELECT * FROM scheduled_runs WHERE task_id = ? ORDER BY started_at DESC, rowid DESC LIMIT 1').get(id)
    return row ? runFromRow(row) : null
  }
  runs(id) {
    this.task(id)
    return this.db.prepare('SELECT * FROM scheduled_runs WHERE task_id = ? ORDER BY started_at DESC, rowid DESC LIMIT 100').all(id).map(runFromRow)
  }
  save(input) {
    const value = taskSchema.parse(input), owner = this.owner(), now = this.now()
    if (value.id) this.task(value.id, owner)
    if (!this.workspaceRegistry.get(value.workspaceId)) throw new ScheduledTaskError('所选工作区不存在，请重新选择。')
    const next = nextOccurrence(value.schedule, now)
    if (value.enabled && next === null) throw new ScheduledTaskError('一次执行的时间必须在未来。')
    const id = value.id ?? randomUUID()
    this.db.prepare(`INSERT INTO scheduled_tasks (id, user_id, name, prompt, workspace_id, schedule_json, enabled, next_run_at, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET name=excluded.name, prompt=excluded.prompt,
      workspace_id=excluded.workspace_id, schedule_json=excluded.schedule_json, enabled=excluded.enabled,
      next_run_at=excluded.next_run_at, updated_at=excluded.updated_at`)
      .run(id, owner, value.name, value.prompt, value.workspaceId, JSON.stringify(value.schedule), Number(value.enabled), value.enabled ? next : null, now, now)
    return this.task(id)
  }
  toggle(id, enabled) {
    const task = this.task(id), next = enabled ? nextOccurrence(task.schedule, this.now()) : null
    if (enabled && next === null) throw new ScheduledTaskError('执行时间已过，请先编辑计划。')
    this.db.prepare('UPDATE scheduled_tasks SET enabled = ?, next_run_at = ?, updated_at = ? WHERE id = ?')
      .run(Number(enabled), next, this.now(), id)
    return this.task(id)
  }
  remove(id) {
    this.task(id)
    if (this.active.has(id)) throw new ScheduledTaskError('请先停止正在执行的任务，再删除计划。')
    this.db.prepare('DELETE FROM scheduled_tasks WHERE id = ?').run(id)
    return { deleted: true }
  }
  runNow(id) { return this.launch(this.task(id), `manual-${randomUUID()}`) }
  stop(id) {
    this.task(id)
    this.active.get(id)?.controller.abort()
    return { stopped: true }
  }
  accountChanged() {
    for (const active of this.active.values()) active.controller.abort()
    const owner = this.identity.getSession()?.accountId
    if (!owner) return
    const now = this.now()
    for (const row of this.db.prepare('SELECT * FROM scheduled_tasks WHERE user_id = ? AND enabled = 1 AND next_run_at <= ?').all(owner, now)) {
      const next = nextOccurrence(JSON.parse(row.schedule_json), now)
      this.db.prepare('UPDATE scheduled_tasks SET next_run_at = ?, enabled = ? WHERE id = ?').run(next, Number(next !== null), row.id)
    }
  }
  tick() {
    const owner = this.identity.getSession()?.accountId
    if (!owner) return
    const now = this.now()
    const due = this.db.prepare('SELECT * FROM scheduled_tasks WHERE user_id = ? AND enabled = 1 AND next_run_at <= ?').all(owner, now)
    for (const row of due) {
      const task = taskFromRow(row)
      const next = nextOccurrence(task.schedule, now)
      let run
      this.storage.transaction(() => {
        this.db.prepare('UPDATE scheduled_tasks SET next_run_at = ?, enabled = ? WHERE id = ?').run(next, Number(next !== null), task.id)
        // 关闭、休眠或长时间阻塞后的过期计划只推进，不集中补跑。
        if (now - row.next_run_at > 60000 || this.active.has(task.id)) return
        run = this.claim(task, `scheduled-${row.next_run_at}`)
      })
      if (run) this.start(task, run)
    }
  }
  launch(task, fireKey) {
    return this.start(task, this.claim(task, fireKey))
  }
  claim(task, fireKey) {
    if (this.active.has(task.id)) throw new ScheduledTaskError('此任务正在执行，请等待完成或先停止。')
    const run = { id: randomUUID(), sessionId: `session-scheduled-${randomUUID()}`, startedAt: this.now() }
    this.db.prepare(`INSERT INTO scheduled_runs (id, task_id, task_name, session_id, fire_key, status, started_at)
      VALUES (?, ?, ?, ?, ?, 'running', ?)`).run(run.id, task.id, task.name, run.sessionId, fireKey, run.startedAt)
    return run
  }
  start(task, run) {
    const controller = new AbortController()
    const active = { controller, promise: null }
    this.active.set(task.id, active)
    // 事务提交后才调用外部会话服务，失败仍留下可审阅的执行记录。
    active.promise = Promise.resolve().then(() => this.execute(task, run, controller.signal, () => {
      this.db.prepare('UPDATE scheduled_runs SET session_available = 1 WHERE id = ?').run(run.id)
    })).catch(error => ({ status: 'failed', error: error instanceof Error ? error.message : String(error) })).then(result => {
      this.db.prepare('UPDATE scheduled_runs SET status = ?, finished_at = ?, error = ? WHERE id = ?')
        .run(result.status, this.now(), result.error ?? '', run.id)
      this.logger?.info('定时任务执行结束：%s（%s）', task.name, result.status)
    }).finally(() => this.active.delete(task.id))
    this.logger?.info('定时任务开始执行：%s', task.name)
    return { id: run.id, taskId: task.id, taskName: task.name, sessionId: null, status: 'running', startedAt: run.startedAt, finishedAt: null, error: '' }
  }
  async dispose() {
    this.unsubscribe()
    for (const active of this.active.values()) active.controller.abort()
    await Promise.all([...this.active.values()].map(active => active.promise))
  }
}
