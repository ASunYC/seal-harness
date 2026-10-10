import { createHash } from 'node:crypto'
import { ConnectorError } from './schema.js'

export function workflowIdentity(entry) {
  const hash = createHash('sha256').update(`seal-harness-connector:${entry.source?.accountId ?? 'local'}:${entry.id}`).digest('hex')
  return { kind: 'mcp', sourceId: `${hash.slice(0, 8)}-${hash.slice(8, 12)}-5${hash.slice(13, 16)}-a${hash.slice(17, 20)}-${hash.slice(20, 32)}`, version: `0.1.${entry.revision}`, name: entry.name }
}

export function workflowResource(entry) {
  return { ...workflowIdentity(entry), ...(entry.oauth ? { unavailableReason: '动态 OAuth 认证连接器不能独立部署。' } : entry.requiredQuery?.length ? { unavailableReason: 'URL 参数认证连接器不能独立部署。' } : entry.transport === 'stdio' ? { unavailableReason: '此连接器依赖本机程序，不能部署到远端实例。' } : {}) }
}

export function workflowExport(entry) {
  if (entry.oauth) throw new ConnectorError('动态 OAuth 认证连接器不能独立部署。')
  if (entry.requiredQuery?.length) throw new ConnectorError('URL 参数认证连接器不能独立部署。')
  if (entry.transport !== 'streamable-http') throw new ConnectorError('本机程序连接器不能部署到远端实例。')
  const selection = workflowIdentity(entry)
  const headers = Object.entries(entry.headers).map(([name, value]) => [name, value && entry.headerPrefixes?.[name] && !value.startsWith(entry.headerPrefixes[name]) ? `${entry.headerPrefixes[name]}${value}` : value])
  const values = Object.fromEntries(headers.map(([name, value]) => [name, value]))
  const descriptor = { schemaVersion: 'stratex.capability/v1', description: entry.name, transport: 'http', endpointTemplate: entry.url, authMode: headers.length ? 'api_key' : 'none', files: [], credentialSlots: headers.map(([name]) => ({ name, required: true })), headerSlots: headers.map(([name]) => ({ headerName: name, credentialSlot: name, required: true })), publisherSource: selection }
  return { capabilities: [{ assetId: selection.sourceId, assetType: 'mcp', name: entry.name, version: selection.version, descriptor, files: [] }], credentials: headers.length ? [{ assetId: selection.sourceId, name: entry.name, values }] : [] }
}
