function settingsUrl(origin, section) {
  const url = new URL(origin.trim())
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('WeKnora 地址必须以 http:// 或 https:// 开头')
  url.pathname = '/platform/settings'
  url.search = `?section=${section}`
  url.hash = ''
  return url.toString()
}

export function modelSettingsUrl(origin) {
  return settingsUrl(origin, 'models')
}

export function apiKeySettingsUrl(origin) {
  return settingsUrl(origin, 'integration-api')
}
