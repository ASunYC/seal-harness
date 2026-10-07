import { homedir } from 'node:os'
import { join } from 'node:path'
import { z } from 'zod'
import { clientRequestSchema } from '@deepseek-ai/dsh-client-connection'
import { resolveDshHome } from '@deepseek-ai/dsh-home-paths'
import { createSessionDeletion } from './deletion.js'

export const Config = z.object({}).default({})
export const inject = ['connection', 'sessionPersistence', 'workspaceRegistry']

const endpoint = 'seal-harness-capabilities/sessions/delete'

function failure(error) {
  const knownCodes = new Set(['invalidSessionId', 'sessionNotArchived', 'sessionActive', 'sessionNotFound', 'unsafeSessionPath', 'invalidSessionStorage'])
  if (knownCodes.has(error?.code)) return { ok: false, error: { code: error.code, message: error.message, details: {} } }
  return { ok: false, error: { code: 'sessionDeleteFailed', message: '永久删除失败，会话数据已尽可能恢复，请重试或查看插件日志。', details: {} } }
}

export function apply(ctx) {
  const home = resolveDshHome(process.env.DSH_HOME || join(homedir(), '.seal-harness'))
  const deletion = createSessionDeletion({
    home,
    sessionPersistence: ctx.sessionPersistence,
    workspaceRegistry: ctx.workspaceRegistry,
    getSessionActivity: sessionId => ctx.waterfall('workspace/session-activity', { sessionId }, () => Promise.resolve([])),
    emit: (...args) => ctx.emit(...args),
  })

  ctx.connection.fetch.register({
    path: `/api/${endpoint}`,
    methods: ['POST'],
    requestBody: 'buffered',
    async fetch(request) {
      if (request.headers.get('content-type')?.split(';')[0].trim() !== 'application/json') return new Response('Expected JSON', { status: 415 })
      let message
      try { message = clientRequestSchema.parse(await request.json()) }
      catch { return new Response('Invalid RPC request', { status: 400 }) }
      if (message.method !== endpoint) return new Response('Invalid RPC method', { status: 400 })
      try {
        const value = await deletion.deleteArchivedSession(z.object({ sessionId: z.string() }).parse(message.payload).sessionId)
        return Response.json({ type: 'server-response', rpcId: message.rpcId, result: { ok: true, value } })
      } catch (error) {
        ctx.logger?.warn('永久删除会话失败：%s', error instanceof Error ? error.message : String(error))
        return Response.json({ type: 'server-response', rpcId: message.rpcId, result: failure(error) })
      }
    },
  })
}
