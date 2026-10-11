import { z } from 'zod'
import { clientRequestSchema } from '@deepseek-ai/dsh-client-connection'
import { ScheduledTaskError, ScheduledTasksService } from './service.js'
import { createSessionRunner } from './runner.js'

export const name = 'seal-harness-scheduled-tasks'
export const inject = ['connection', 'sealHarnessDatabase', 'sealHarnessIdentity', 'workspaceRegistry', 'sessionController']
const idSchema = z.strictObject({ id: z.string().min(1) })

export function apply(ctx) {
  const service = new ScheduledTasksService({ storage: ctx.sealHarnessDatabase, identity: ctx.sealHarnessIdentity,
    workspaceRegistry: ctx.workspaceRegistry, execute: createSessionRunner(ctx), logger: ctx.logger })
  ctx.effect(() => {
    const timer = setInterval(() => {
      try { service.tick() } catch (error) { ctx.logger?.warn('定时任务调度失败：%s', String(error)) }
    }, 10000)
    timer.unref?.()
    return () => { clearInterval(timer); return service.dispose() }
  }, 'seal-harness scheduled tasks')
  const handlers = {
    list: input => { z.strictObject({}).parse(input); return service.list() },
    save: input => service.save(input),
    runs: input => service.runs(idSchema.parse(input).id),
    toggle: input => { const value = z.strictObject({ id: z.string().min(1), enabled: z.boolean() }).parse(input); return service.toggle(value.id, value.enabled) },
    delete: input => service.remove(idSchema.parse(input).id),
    run: input => service.runNow(idSchema.parse(input).id),
    stop: input => service.stop(idSchema.parse(input).id),
  }
  for (const [action, handler] of Object.entries(handlers)) {
    const endpoint = `seal-harness-scheduled-tasks/${action}`
    ctx.connection.fetch.register({ path: `/api/${endpoint}`, methods: ['POST'], requestBody: 'buffered', async fetch(request) {
      if (request.headers.get('content-type')?.split(';')[0].trim() !== 'application/json') return new Response('Expected JSON', { status: 415 })
      let message
      try { message = clientRequestSchema.parse(await request.json()) } catch { return new Response('Invalid RPC request', { status: 400 }) }
      if (message.method !== endpoint) return new Response('Invalid RPC method', { status: 400 })
      let result
      try { result = { ok: true, value: await handler(message.payload ?? {}) } }
      catch (error) {
        ctx.logger?.warn('定时任务操作失败：%s（%s）', action, String(error))
        result = { ok: false, error: { code: 'scheduledTaskFailed', message: error instanceof ScheduledTaskError ? error.message
          : error instanceof z.ZodError ? '请检查任务名称、提示词、工作区和执行时间。' : '定时任务操作失败，请重试或查看插件日志。', details: {} } }
      }
      return Response.json({ type: 'server-response', rpcId: message.rpcId, result })
    } })
  }
}
