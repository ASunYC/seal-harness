import { createMcpToolDefinition } from '@deepseek-ai/dsh-mcp-client'
import { z } from 'zod'

export const adapterSchema = z.object({ schemaVersion: z.literal('stratex.http-adapter/v1'), sourceType: z.literal('http_adapter'), name: z.string().min(1).max(160), description: z.string().max(4000).default(''), tools: z.array(z.object({ name: z.string().regex(/^[A-Za-z_][A-Za-z0-9_-]*$/), description: z.string().default(''), riskLevel: z.enum(['safe', 'read', 'write', 'dangerous']).default('read'), enabled: z.boolean().default(true), inputSchema: z.record(z.string(), z.unknown()), request: z.object({ method: z.enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']), url: z.string().url().optional(), baseUrl: z.string().url().optional(), path: z.string().optional(), headers: z.record(z.string(), z.string()).default({}), auth: z.object({ type: z.enum(['none', 'bearer', 'basic', 'api_key']), credentialSlot: z.string().optional(), usernameCredentialSlot: z.string().optional(), passwordCredentialSlot: z.string().optional(), placement: z.enum(['query', 'header']).optional(), name: z.string().optional() }).default({ type: 'none' }), contentType: z.enum(['json', 'form', 'text']).default('json'), parameters: z.record(z.string(), z.object({ location: z.enum(['path', 'query', 'header', 'body']), name: z.string().optional() })).default({}) }), response: z.object({ format: z.enum(['auto', 'json', 'text']).default('auto'), dataPath: z.string().optional() }).default({ format: 'auto' }), timeoutMs: z.number().int().positive().max(30000).default(10000), retry: z.object({ maxRetries: z.number().int().min(0).max(2).default(0), backoffMs: z.number().int().min(0).max(2000).default(250) }).default({ maxRetries: 0, backoffMs: 250 }) })).min(1).max(100) })
export const name = 'seal-harness-http-adapter'
export const inject = ['tools']
const scalar = value => typeof value === 'string' ? value : JSON.stringify(value)

export async function execute(tool, args, values, signal) {
  const spec = tool.request, url = new URL(spec.url ?? spec.path ?? '', spec.baseUrl), headers = { ...spec.headers }, body = {}
  const credential = key => { const value = values[key]; if (!value) throw new Error(`请配置连接器凭据：${key}`); return value }
  const auth = spec.auth
  if (auth.type === 'bearer') headers.Authorization = `Bearer ${credential(auth.credentialSlot)}`
  if (auth.type === 'basic') headers.Authorization = `Basic ${Buffer.from(`${credential(auth.usernameCredentialSlot)}:${credential(auth.passwordCredentialSlot)}`).toString('base64')}`
  if (auth.type === 'api_key') {
    if (auth.placement === 'query') url.searchParams.set(auth.name, credential(auth.credentialSlot))
    else headers[auth.name] = credential(auth.credentialSlot)
  }
  for (const [key, value] of Object.entries(args)) {
    const mapping = spec.parameters[key] ?? { location: ['GET', 'DELETE'].includes(spec.method) ? 'query' : 'body' }, name = mapping.name ?? key
    if (mapping.location === 'query') url.searchParams.set(name, scalar(value))
    if (mapping.location === 'header') headers[name] = scalar(value)
    if (mapping.location === 'body') body[name] = value
    if (mapping.location === 'path') url.pathname = url.pathname.replaceAll(`%7B${name}%7D`, encodeURIComponent(scalar(value))).replaceAll(`{${name}}`, encodeURIComponent(scalar(value)))
  }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || /%7B|\{/i.test(url.pathname)) throw new Error('HTTP 连接器地址或路径参数无效。')
  let payload
  if (!['GET', 'DELETE'].includes(spec.method) && Object.keys(body).length) {
    if (spec.contentType === 'form') { headers['content-type'] = 'application/x-www-form-urlencoded'; payload = new URLSearchParams(Object.entries(body).map(([key, value]) => [key, scalar(value)])) }
    else if (spec.contentType === 'text') { headers['content-type'] = 'text/plain'; payload = scalar(body.body ?? body.text ?? Object.values(body)[0]) }
    else { headers['content-type'] = 'application/json'; payload = JSON.stringify(body) }
  }
  const requestSignal = signal ? AbortSignal.any([signal, AbortSignal.timeout(tool.timeoutMs)]) : AbortSignal.timeout(tool.timeoutMs)
  let response
  for (let attempt = 0; ; attempt++) {
    response = await fetch(url, { method: spec.method, headers, body: payload, signal: requestSignal })
    if (spec.method !== 'GET' || attempt >= tool.retry.maxRetries || ![429, 502, 503, 504].includes(response.status)) break
    await response.body?.cancel()
    await new Promise(resolve => setTimeout(resolve, tool.retry.backoffMs))
  }
  const chunks = []; let size = 0
  for await (const chunk of response.body ?? []) { size += chunk.length; if (size > 2 * 1024 * 1024) throw new Error('HTTP 连接器响应超过 2 MiB。'); chunks.push(chunk) }
  let text = Buffer.concat(chunks).toString('utf8')
  for (const secret of Object.values(values).filter(Boolean)) text = text.replaceAll(secret, '[redacted]')
  if (!response.ok) throw new Error(`HTTP 连接器返回状态 ${response.status}`)
  let value = tool.response.format === 'json' || tool.response.format === 'auto' && response.headers.get('content-type')?.includes('json') ? JSON.parse(text || 'null') : text
  for (const key of tool.response.dataPath?.split('.') ?? []) {
    if (!value || !Object.hasOwn(value, key)) throw new Error('HTTP 连接器响应缺少配置的数据路径。')
    value = value[key]
  }
  return { content: [{ type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value) }] }
}

export function apply(ctx, config) {
  const adapter = adapterSchema.parse(config.adapter)
  for (const tool of adapter.tools.filter(tool => tool.enabled)) ctx.effect(() => ctx.tools.register(createMcpToolDefinition(ctx, { name: `mcp__${config.serverName}__${tool.name}`, rawName: tool.name, description: tool.description, inputSchema: tool.inputSchema, call: (args, execution) => execute(tool, args, config.values ?? {}, execution.signal) })))
}
