import { adapterSchema } from './http-adapter.js'
import { z } from 'zod'
import { isAbsolute, join } from 'node:path'
import { lstat } from 'node:fs/promises'
import { safeRelative } from '../../skills/src/package.js'
import { createHash } from 'node:crypto'

export class ConnectorError extends Error {
  code = 'connectorRejected'
}

const text = z.string().max(2_000).regex(/^[^\x00-\x1f\x7f]*$/u)
export const idSchema = z.string().regex(/^[a-z][a-z0-9-]{1,27}$/u)
const environmentName = z.string().regex(/^[A-Za-z_][A-Za-z0-9_]{0,127}$/u)
const headerName = z.string().regex(/^[!#$%&'*+.^_`|~0-9A-Za-z-]{1,128}$/u)
const secrets = (key) => z.record(key, text).refine(value => Object.keys(value).length <= 100)
export const configSchema = z.strictObject({
  id: idSchema,
  name: text.min(1).max(160),
  summary: z.string().max(300).default(''),
  category: z.enum(['office', 'development']).default('office'),
  transport: z.enum(['stdio', 'streamable-http', 'sse']),
  command: text.default(''),
  args: z.array(text).max(100).default([]),
  cwd: text.default(''),
  url: text.default(''),
  headers: secrets(headerName).default({}),
  headerPrefixes: secrets(headerName).default({}),
  queryParameters: secrets(environmentName).default({}),
  queryCredentials: secrets(environmentName).default({}),
  requiredQuery: z.array(environmentName).max(100).default([]),
  catalogId: z.string().max(80).optional(),
  nativeCli: z.boolean().optional(),
  headerEnvironment: z.record(headerName, environmentName).refine(value => Object.keys(value).length <= 100).default({}),
  env: secrets(environmentName).default({}),
  environmentPassthrough: z.array(environmentName).max(100).default([]),
  requiredHeaders: z.array(headerName).max(100).default([]),
  requiredEnv: z.array(environmentName).max(100).default([]),
  adapter: adapterSchema.optional(),
  workspacePath: z.string().optional(),
  bootstrap: z.object({ directory: z.string(), completionMarker: z.string(), executable: z.string(), entrypoint: z.string(), args: z.array(z.string()).default([]), timeoutMs: z.number().int().min(1000).max(900000).default(600000), instructions: z.object({ blockId: z.string(), content: z.string() }) }).optional(),
  credentialValues: z.record(z.string(), text).default({}),
  credentialSlots: z.array(z.object({ name: z.string(), required: z.boolean().default(true) })).default([]),
  tokenExchange: z.object({ tokenEndpoint: z.string().url(), audience: z.string(), scope: z.string().optional() }).optional(),
  toolCallTimeoutMs: z.number().int().min(1_000).max(300_000).default(60_000),
  enabledTools: z.array(z.string().regex(/^[A-Za-z0-9_.-]{1,160}$/u)).max(500).nullable().default(null),
  enabled: z.boolean().default(false),
  installed: z.boolean().default(true),
  ownerAccountId: text.min(1).optional(),
  revision: z.number().int().nonnegative().default(0),
  oauth: z.object({ scopes: z.array(z.string()).default([]), tokens: z.record(z.string(), z.unknown()).optional(), clientInformation: z.record(z.string(), z.unknown()).optional(), discovery: z.record(z.string(), z.unknown()).optional(), expiresAt: z.number().optional(), redirectUrl: z.string().optional() }).optional(),
  source: z.strictObject({ id: z.string().uuid(), version: text.min(1).max(64), accountId: text.min(1), centerId: text.optional() }).optional(),
})
export const stateSchema = z.strictObject({ version: z.literal(1), entries: z.array(configSchema).max(100).refine(entries => new Set(entries.map(entry => entry.id)).size === entries.length) })
export const mutationSchema = z.strictObject({ id: idSchema, revision: z.number().int().nonnegative() })

/** 错误只返回字段名，不把凭据、参数或远端响应拼进异常。 */
export function parse(schema, input) {
  const result = schema.safeParse(input)
  if (!result.success) throw new ConnectorError('连接器参数无效，请检查名称、地址、参数和凭据格式。')
  return result.data
}

export async function validateTransport(config) {
  if (config.transport !== 'stdio') {
    let url
    try { url = new URL(config.url) } catch { throw new ConnectorError('请输入有效的 HTTP(S) MCP 地址。') }
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.hash || url.search) {
      throw new ConnectorError('MCP 地址仅支持 HTTP(S)，不得内嵌凭据、查询参数或片段；请使用请求头配置认证。')
    }
    if (config.command || config.cwd || config.args.length || Object.keys(config.env).length || config.environmentPassthrough.length) throw new ConnectorError('HTTP 连接器不能包含本地命令或环境变量。')
    return
  }
  if (config.url || Object.keys(config.headers).length || Object.keys(config.headerEnvironment).length || config.requiredHeaders.length || Object.keys(config.queryCredentials).length || Object.keys(config.queryParameters).length || config.requiredQuery.length) throw new ConnectorError('stdio 连接器不能包含 HTTP 地址或请求头。')
  if (!isAbsolute(config.command)) throw new ConnectorError('本地命令必须使用可执行文件的绝对路径。')
  let executable
  try { executable = await lstat(config.command) } catch { throw new ConnectorError('找不到本地可执行文件。') }
  if (!executable.isFile() || executable.isSymbolicLink()) throw new ConnectorError('本地命令必须指向普通文件，不能使用符号链接。')
  if (config.cwd) {
    if (!isAbsolute(config.cwd)) throw new ConnectorError('工作目录必须使用绝对路径。')
    let directory
    try { directory = await lstat(config.cwd) } catch { throw new ConnectorError('找不到工作目录。') }
    if (!directory.isDirectory() || directory.isSymbolicLink()) throw new ConnectorError('工作目录必须指向真实目录。')
  }
}

const descriptorSchema = z.object({
  schemaVersion: z.literal('stratex.capability/v1'),
  transport: z.enum(['http', 'stdio', 'sse']),
  endpointTemplate: text.optional(),
  authMode: z.enum(['none', 'api_key', 'oauth_authorization_code_pkce', 'token_exchange']).default('none'),
  staticHeaders: z.array(z.object({ headerName, value: text })).max(100).default([]),
  headerSlots: z.array(z.object({ headerName, credentialSlot: text.min(1), required: z.boolean().default(true) })).max(100).default([]),
  compatibility: z.object({ os: z.array(z.string()).default([]), arch: z.array(z.string()).default([]) }).default({ os: [], arch: [] }),
}).passthrough()

/** 只接纳无额外运行时的 HTTP descriptor；不得悄悄忽略包内引导或认证流程。 */
export function fromDescriptor({ id, name, version, descriptor, accountId, directory, adapter, summary, category }) {
  const value = parse(descriptorSchema, descriptor)
  if (value.authMode === 'token_exchange' && !value.tokenExchange) throw new ConnectorError('连接器缺少令牌交换地址。')
  if (value.authExperience === 'shared' && value.authMode !== 'oauth_authorization_code_pkce') throw new ConnectorError('共享认证需要 OAuth 配置。')
  if (value.workspaceBootstrap && !directory) throw new ConnectorError('工作区引导需要完整安装包。')
  const os = process.platform === 'win32' ? 'windows' : process.platform
  if (value.compatibility.os.length && !value.compatibility.os.includes(os) || value.compatibility.arch.length && !value.compatibility.arch.includes(process.arch)) {
    throw new ConnectorError('此连接器不支持当前操作系统或架构。')
  }
  return parse(configSchema, {
    id: `m-${createHash('sha256').update(`${accountId}/${id}`).digest('hex').slice(0, 24)}`, name, summary: summary ?? value.description ?? '', category: category ?? 'office',
    transport: value.transport === 'stdio' ? 'stdio' : value.transport === 'sse' ? 'sse' : 'streamable-http',
    ...(value.transport === 'stdio' ? { command: join(directory, safeRelative(value.executable)), args: value.args ?? [], cwd: value.workingDirectory ? join(directory, safeRelative(value.workingDirectory)) : directory, env: Object.fromEntries((value.environmentVariables ?? []).map(item => [item.name, item.value])), environmentPassthrough: value.environmentPassthrough ?? [], requiredEnv: (value.environmentSlots ?? []).filter(slot => slot.required).map(slot => slot.name) } : { url: value.endpointTemplate ?? (adapter ? 'http://localhost/' : undefined) }),
    headers: Object.fromEntries([...value.staticHeaders.map(header => [header.headerName, header.value]), ...(value.bearerTokenEnvironmentVariable && process.env[value.bearerTokenEnvironmentVariable] ? [['Authorization', `Bearer ${process.env[value.bearerTokenEnvironmentVariable]}`]] : [])]),
    headerEnvironment: Object.fromEntries((value.environmentHeaders ?? []).map(header => [header.headerName, header.environmentName])),
    requiredHeaders: [...value.headerSlots.filter(slot => slot.required).map(slot => slot.headerName), ...(value.authMode === 'token_exchange' ? ['Authorization'] : [])],
    ...(value.authMode === 'oauth_authorization_code_pkce' ? { oauth: { scopes: value.oauthPkce?.scopes ?? value.oauthDiscovery?.scopes ?? [], ...(value.oauthPkce ? { clientInformation: { client_id: value.oauthPkce.clientId }, discovery: { authorizationServerUrl: new URL(value.oauthPkce.authorizationEndpoint).origin, resourceMetadata: { resource: value.endpointTemplate }, authorizationServerMetadata: { issuer: new URL(value.oauthPkce.authorizationEndpoint).origin, authorization_endpoint: value.oauthPkce.authorizationEndpoint, token_endpoint: value.oauthPkce.tokenEndpoint, response_types_supported: ['code'], grant_types_supported: ['authorization_code', 'refresh_token'], code_challenge_methods_supported: ['S256'], token_endpoint_auth_methods_supported: ['none'] } } } : value.oauthDiscovery?.client?.clientId ? { clientInformation: { client_id: value.oauthDiscovery.client.clientId } } : {}) } } : {}),
    ...(value.workspaceBootstrap ? { bootstrap: { ...value.workspaceBootstrap, directory } } : {}),
    ...(adapter ? { adapter, credentialSlots: value.credentialSlots ?? [] } : {}),
    ...(value.authMode === 'token_exchange' ? { tokenExchange: value.tokenExchange } : {}),
    source: { id, version, accountId },
  })
}
