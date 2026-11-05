import snapshot from '../catalog/cc-haha.json' with { type: 'json' }

export const catalogSource = { repository: snapshot.repository, commit: snapshot.commit }
export const blenderConnector = {
  id: 'blender-mcp', displayName: 'Blender MCP', transport: 'local-mcp', source: 'product',
  category: 'development', version: '2.2.6', license: 'MIT',
  homepage: 'https://github.com/ahujasid/mcp-for-blender',
  description: '通过 MCP 在 Blender 中创建和编辑 3D 场景。',
  requirements: '需要 Blender 3.0+ 和 uv。安装时会将官方插件复制到当前系统用户的 Blender 插件目录；随后在 Blender 中启用 Interface: MCP for Blender，并启动 MCP Server。',
  example: '请在 Blender 中创建一个简单的立方体场景。',
  icon: `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><path d="M16 3 28 10v12l-12 7L4 22V10zM4 10l12 7 12-7M16 17v12" fill="none" stroke="#6d78e8" stroke-width="2.2" stroke-linejoin="round"/></svg>')}`,
}
export const connectorCatalog = [...snapshot.connectors, blenderConnector]
export const skillCatalog = [
  ...snapshot.connectors.filter(item => item.transport === 'skills').map(item => ({ id: `bundle:${item.id}`, name: item.displayName,
    summary: item.description, category: item.category, version: item.version, icon: item.icon, source: 'bundle',
    requirements: item.requirements, homepage: item.homepage, license: snapshot.skillBundles.find(recipe => recipe.id === item.id).license })),
  ...snapshot.skills.map(item => ({ ...item, id: `${item.source}:${item.owner}:${item.slug}` })),
]
export const skillBundles = snapshot.skillBundles
export function catalogConnector(id) {
  const item = connectorCatalog.find(item => item.id === id)
  if (!item) throw new Error('系统连接器不存在。')
  return item
}
export function catalogSkill(id) {
  const item = skillCatalog.find(item => item.id === id)
  if (!item) throw new Error('系统技能不存在。')
  return item
}
export function remoteConfiguration(id) {
  const recipe = snapshot.remoteRecipes.find(item => item.id === id), item = catalogConnector(id)
  if (!recipe) throw new Error('这项能力需要专用安装方式。')
  const url = new URL(recipe.endpoint)
  const queryParameters = Object.fromEntries(url.searchParams)
  url.search = ''
  const auth = recipe.auth
  return {
    id: `cc-${id}`, catalogId: id, name: item.displayName, summary: item.description,
    category: item.category === 'development' ? 'development' : 'office', transport: recipe.transport === 'sse' ? 'sse' : 'streamable-http',
    url: url.toString(), queryParameters,
    ...(auth.type === 'oauth' ? { oauth: { scopes: [], ...(auth.clientId ? { clientInformation: { client_id: auth.clientId } } : {}) } } : {}),
    ...(auth.type === 'api-key' && auth.in === 'header' ? { requiredHeaders: [auth.name], headerPrefixes: { [auth.name]: auth.prefix ?? '' } } : {}),
    ...(auth.type === 'api-key' && auth.in === 'query' ? { requiredQuery: [auth.name] } : {}),
    installed: true, enabled: false,
  }
}
export function remoteUrl(entry) {
  if (!entry.url) return ''
  const url = new URL(entry.url)
  for (const [key, value] of Object.entries(entry.queryParameters ?? {})) url.searchParams.set(key, value)
  for (const [key, value] of Object.entries(entry.queryCredentials ?? {})) if (value) url.searchParams.set(key, value)
  return url.toString()
}
