import snapshot from '../catalog/cc-haha.json' with { type: 'json' }

export const catalogSource = { repository: snapshot.repository, commit: snapshot.commit }
export const connectorCatalog = snapshot.connectors
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
