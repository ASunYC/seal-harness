import { randomUUID } from 'node:crypto'
import { mkdir, readFile, realpath, rename, stat, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { homedir } from 'node:os'
import { z } from 'zod'

const item = z.object({ id: z.string().uuid(), name: z.string(), cwd: z.string(), model: z.object({ connectionId: z.string(), remoteModelId: z.string() }).nullable(), preset: z.string().optional() })
export const nativeRequest = z.discriminatedUnion('action', [
  z.strictObject({ action: z.enum(['snapshot', 'local-catalog']) }),
  z.strictObject({ action: z.literal('create'), input: z.strictObject({ requestId: z.string().uuid(), name: z.string().trim().min(1).max(80), cwd: z.string().max(4096).default(''), model: item.shape.model.default(null), preset: z.string().optional() }) }),
  z.strictObject({ action: z.literal('rename'), id: z.string().uuid(), name: z.string().trim().min(1).max(80) }),
  z.strictObject({ action: z.enum(['start', 'stop', 'restart', 'delete', 'open']), id: z.string().uuid() }),
])

export async function createNativeAgents(ctx, path) {
  let records = []
  try { records = z.array(item.extend({ requestId: z.string().uuid() })).parse(JSON.parse(await readFile(path, 'utf8'))) } catch (error) { if (error.code !== 'ENOENT') throw error }
  let queue = Promise.resolve(), closed = false
  const save = async next => { await mkdir(dirname(path), { recursive: true }); const temp = `${path}.${randomUUID()}.tmp`; await writeFile(temp, JSON.stringify(next)); await rename(temp, path); records = next }
  const stop = id => ctx.agents.releaseInstance(id)
  const activate = async (record, resume) => {
    if (!(await stat(record.cwd)).isDirectory()) throw new Error('工作目录不存在，请恢复目录后重试。')
    const workspace = await ctx.workspaceRegistry.create(record.cwd)
    if (ctx.agents.get(record.id)) { await ctx.sessions.flush(ctx.sessions.get(record.id)); await workspace.attachSession(record.id); return }
    const options = record.model ? { provider: record.model.connectionId, model: record.model.remoteModelId } : ctx.get('agentDefaultModel')?.currentSelection()
    const handle = resume ? await ctx.agents.resume({ resumeSessionId: record.id, agentOptions: options }) : await ctx.agents.create({ sessionId: record.id, meta: { cwd: record.cwd, ...(record.preset ? { agentPreset: record.preset } : {}) }, agentOptions: options })
    try {
      await ctx.sessions.flush(ctx.sessions.get(record.id))
      await workspace.attachSession(record.id)
      if (closed) throw new Error('智能体插件已卸载。')
    } catch (error) { await handle.dispose(); throw error }
  }
  const catalog = () => ({ instances: records.map(record => ({ ...record, native: true, status: ctx.agents.get(record.id) ? 'running' : 'stopped', packageVersion: 'DSH', adminUrl: '', apiUrl: '' })) })
  const request = async raw => {
    if (closed) throw new Error('智能体插件已卸载。')
    const input = nativeRequest.parse(raw)
    if (input.action === 'snapshot' || input.action === 'local-catalog') return catalog()
    if (input.action === 'create') {
      const existing = records.find(row => row.requestId === input.input.requestId)
      if (existing) { await activate(existing, true); return catalog() }
      const cwd = await realpath(input.input.cwd || homedir())
      const record = { ...input.input, id: randomUUID(), cwd }
      await activate(record, false)
      try { await save([...records, record]) } catch (error) { await stop(record.id); throw error }
      return catalog()
    }
    const record = records.find(row => row.id === input.id)
    if (!record) throw new Error('智能体实例不存在。')
    if (input.action === 'rename') await save(records.map(row => row.id === record.id ? { ...row, name: input.name } : row))
    else if (input.action === 'delete') { await stop(record.id); await save(records.filter(row => row.id !== record.id)) }
    else if (input.action === 'stop') await stop(record.id)
    else { if (input.action === 'restart') await stop(record.id); await activate(record, true) }
    return input.action === 'open' ? { sessionId: record.id } : catalog()
  }
  return {
    request(input) { const next = queue.then(() => request(input)); queue = next.catch(() => {}); return next },
    async dispose() { closed = true; await queue; await Promise.all(records.map(record => stop(record.id))) },
  }
}
