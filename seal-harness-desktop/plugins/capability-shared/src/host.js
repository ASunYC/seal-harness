import { homedir } from 'node:os'
import { join } from 'node:path'
import { z } from 'zod'
import { clientRequestSchema } from '@deepseek-ai/dsh-client-connection'
import { resolveDshHome } from '@deepseek-ai/dsh-home-paths'
import { CapabilityBackend, BackendError } from './backend.js'

export const Config = z.object({}).default({})

/** 每个调用方拥有独立的模块、RPC 路由和销毁作用域。共享源码在构建时内联。 */
export async function mountCapability(ctx, module, createModule) {
  const home = resolveDshHome(process.env.DSH_HOME || join(homedir(), '.seal-harness'))
  const services = ctx.sealHarnessServices.getConfig()
  const backend = new CapabilityBackend({
    backendUrl: services.storeBaseUrl,
    mcpCenterUrl: services.mcpCenterBaseUrl,
    getIdentity: () => ctx.get('sealHarnessIdentity'),
  })
  const instance = await createModule(ctx, { home, backend })
  ctx.effect(() => () => instance.dispose?.(), `seal-harness-${module}: module`)
  const lifetime = new AbortController()
  ctx.effect(() => () => lifetime.abort(), `seal-harness-${module}: requests`)
  const call = (action, payload = {}, signal) => {
    const handler = instance.hostHandlers?.[action] ?? instance.handlers[action]
    if (typeof handler !== 'function') throw new Error(`未知能力操作：${module}/${action}`)
    return handler(payload, signal ? AbortSignal.any([signal, lifetime.signal]) : lifetime.signal)
  }
  ctx.provide(`sealHarness${module[0].toUpperCase()}${module.slice(1)}`, { call,
    ...(instance.catalogStatus ? { catalogStatus: accountId => instance.catalogStatus(accountId) } : {}) })
  const dispatch = async (action, payload, signal) => {
    try {
      const value = await call(action, payload, signal)
      return { ok: true, value }
    } catch (error) {
      if (error instanceof z.ZodError) return { ok: false, error: { code: 'invalidRequest', message: '输入不符合要求，请检查必填项和格式。', details: {} } }
      if (error instanceof BackendError) return { ok: false, error: { code: error.code, message: error.message, details: {} } }
      if (['skillRejected', 'connectorRejected', 'expertRejected'].includes(error?.code)) return { ok: false, error: { code: error.code, message: error.message, details: {} } }
      ctx.logger?.warn('能力操作失败：%s/%s', module, action)
      return { ok: false, error: { code: 'operationFailed', message: '操作失败，请重试或查看插件日志。', details: {} } }
    }
  }
  for (const action of Object.keys(instance.handlers)) {
    // 延续已使用的协议地址，插件生命周期由各自的注册作用域管理。
    const endpoint = `seal-harness-capabilities/${module}/${action}`
    ctx.connection.fetch.register({
      path: `/api/${endpoint}`, methods: ['POST'], requestBody: 'buffered',
      async fetch(request) {
        if (request.headers.get('content-type')?.split(';')[0].trim() !== 'application/json') return new Response('Expected JSON', { status: 415 })
        let message
        try { message = clientRequestSchema.parse(await request.json()) }
        catch { return new Response('Invalid RPC request', { status: 400 }) }
        if (message.method !== endpoint) return new Response('Invalid RPC method', { status: 400 })
        return Response.json({ type: 'server-response', rpcId: message.rpcId, result: await dispatch(action, message.payload, request.signal) })
      },
    })
  }
}
