import { clientRequestSchema } from '@deepseek-ai/dsh-client-connection'
import { createSideChatLifecycle } from './lifecycle.js'

export const name = 'seal-harness-side-chat'
export const inject = ['connection', 'agents', 'agentDefaultModel', 'sessionPersistence', 'workspaceRegistry']

export function apply(ctx) {
  const lifecycle = createSideChatLifecycle({
    agents: ctx.agents,
    agentDefaultModel: ctx.agentDefaultModel,
    agentPresets: ctx.get('agentPresets'),
    sessionPersistence: ctx.sessionPersistence,
    workspaceRegistry: ctx.workspaceRegistry,
    emit: (...args) => ctx.emit(...args),
  })
  const migration = lifecycle.migrateLegacy().catch(error => ctx.logger?.error('旧侧聊迁移失败：%s', String(error)))
  ctx.effect(() => () => lifecycle.dispose(), 'seal-side-chat: agent handles')

  for (const action of ['create', 'ensure', 'close', 'prune']) {
    const endpoint = `seal-harness-side-chat/${action}`
    ctx.connection.fetch.register({
      path: `/api/${endpoint}`, methods: ['POST'], requestBody: 'buffered',
      async fetch(request) {
        if (request.headers.get('content-type')?.split(';')[0].trim() !== 'application/json')
          return new Response('Expected JSON', { status: 415 })
        let message
        try { message = clientRequestSchema.parse(await request.json()) }
        catch { return new Response('Invalid RPC request', { status: 400 }) }
        if (message.method !== endpoint) return new Response('Invalid RPC method', { status: 400 })
        try {
          await migration
          const input = action === 'create' ? message.payload?.parentSessionId
            : action === 'prune' ? message.payload?.keepIds : message.payload?.sessionId
          const value = await lifecycle[action](input)
          return Response.json({ type: 'server-response', rpcId: message.rpcId, result: { ok: true, value } })
        } catch (error) {
          ctx.logger?.warn('侧聊 %s 失败：%s', action, error instanceof Error ? error.message : String(error))
          return Response.json({ type: 'server-response', rpcId: message.rpcId, result: {
            ok: false, error: { code: error?.code ?? 'sideChatFailed', message: error?.message ?? '侧聊操作失败。', details: {} },
          } })
        }
      },
    })
  }
}
