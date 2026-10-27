import { WeknoraClient } from '../upstream/client.js'
import { resolveConfig } from '../upstream/config.js'
import { createTools } from '../upstream/tools.js'

export const name = '@seal-harness/weknora'
export const inject = ['tools', 'credentials', 'connection', 'sealHarnessIdentity']
const credentialKey = accountId => `seal-harness-weknora/connection-${accountId}`

async function account(identity) {
  const session = await identity.getSession()
  if (!session?.accountId) throw new Error('请先登录 Seal 本机账号。')
  return session
}

async function sameAccount(identity, session) {
  const current = await identity.getSession()
  if (current?.accountId !== session.accountId || current.epoch !== session.epoch)
    throw new Error('Seal 登录账号已变化，请重新操作。')
}

async function connection(credentials, fallback, identity) {
  const session = await account(identity)
  const record = await credentials.readRecord(credentialKey(session.accountId))
  await sameAccount(identity, session)
  const saved = record?.kind === 'grant' && record.payload && typeof record.payload === 'object' ? record.payload : {}
  const config = resolveConfig({
    ...fallback,
    baseUrl: saved.baseUrl ?? fallback.baseUrl,
    apiKey: Object.hasOwn(saved, 'apiKey') ? saved.apiKey : fallback.apiKey,
  })
  return { config, session }
}

function publicStatus(config) {
  return { baseUrl: config.baseUrl, configured: Boolean(config.apiKey) }
}

function clientMessage(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || value.type !== 'client-request' || typeof value.rpcId !== 'string' || !value.rpcId
    || typeof value.method !== 'string') throw new Error('Invalid RPC request')
  return value
}

function serviceUrl(raw) {
  if (typeof raw !== 'string') throw new Error('请输入 WeKnora API 地址。')
  const url = new URL(raw.trim())
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash)
    throw new Error('WeKnora API 地址必须是无凭据的 http:// 或 https:// 地址。')
  return resolveConfig({ baseUrl: url.toString() }).baseUrl
}

export function apply(ctx, raw) {
  const fallback = resolveConfig(raw)
  const credentials = ctx.get('credentials')
  const identity = ctx.get('sealHarnessIdentity')
  const lifetime = new AbortController()
  ctx.effect(() => () => lifetime.abort(), 'seal-harness-weknora: requests')

  const configured = async () => {
    const value = await connection(credentials, fallback, identity)
    if (!value.config.apiKey) throw new Error('请先在 Seal 设置的 WeKnora 项中填写 API Key。')
    return value
  }
  const handlers = {
    'weknora/status': async () => publicStatus((await connection(credentials, fallback, identity)).config),
    'weknora/configure': async payload => {
      if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new Error('配置格式无效。')
      const baseUrl = serviceUrl(payload.baseUrl)
      const session = await account(identity)
      await credentials.modifyRecord(credentialKey(session.accountId), record => {
        const previous = record?.kind === 'grant' && record.payload && typeof record.payload === 'object' ? record.payload : {}
        const oldBaseUrl = previous.baseUrl ?? fallback.baseUrl
        const apiKey = typeof payload.apiKey === 'string' && payload.apiKey.trim() ? payload.apiKey.trim()
          : payload.clearKey === true || baseUrl !== oldBaseUrl ? null
            : Object.hasOwn(previous, 'apiKey') ? previous.apiKey : fallback.apiKey
        return { kind: 'grant', payload: { version: 1, baseUrl, apiKey } }
      })
      await sameAccount(identity, session)
      return publicStatus((await connection(credentials, fallback, identity)).config)
    },
    'weknora/test': async () => {
      const { config, session } = await configured()
      const client = new WeknoraClient(config)
      const bases = await client.listKnowledgeBases(lifetime.signal)
      await sameAccount(identity, session)
      return { knowledgeBaseCount: bases.length }
    },
  }
  for (const [endpoint, handler] of Object.entries(handlers)) {
    ctx.connection.fetch.register({
      path: `/api/${endpoint}`, methods: ['POST'], requestBody: 'buffered',
      async fetch(request) {
        if (request.headers.get('content-type')?.split(';')[0].trim() !== 'application/json')
          return new Response('Expected JSON', { status: 415 })
        let message
        try { message = clientMessage(await request.json()) }
        catch { return new Response('Invalid RPC request', { status: 400 }) }
        if (message.method !== endpoint) return new Response('Invalid RPC method', { status: 400 })
        let result
        try { result = { ok: true, value: await handler(message.payload ?? {}) } }
        catch (error) { result = { ok: false, error: { code: 'operationFailed', message: error?.message ?? '操作失败', details: {} } } }
        return Response.json({ type: 'server-response', rpcId: message.rpcId, result })
      },
    })
  }

  // 每次执行重新创建上游定义，避免其知识库范围缓存跨凭据复用。
  for (const definition of createTools(new WeknoraClient(fallback), fallback)) {
    ctx.tools.register({
      ...definition,
      async execute(args, exec) {
        const { config, session } = await configured()
        const fresh = createTools(new WeknoraClient(config), config)
          .find(candidate => candidate.name === definition.name)
        const result = await fresh.execute(args, exec)
        await sameAccount(identity, session)
        return result
      },
    })
  }
  ctx.logger?.info(`seal-harness-weknora: registered tools against ${fallback.baseUrl}`)
}
