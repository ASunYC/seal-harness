import React, { useEffect, useState } from 'react'
import { Icon } from '../../capability-shared/src/icons.jsx'

const cache = new Map()

export function CatalogIcon({ api, connectorId, iconRevision, size = 40 }) {
  const key = `${connectorId}:${iconRevision ?? ''}`
  const [source, setSource] = useState(cache.get(key) ?? '')

  useEffect(() => {
    if (!connectorId || source) return
    const controller = new AbortController()
    api('store/centerIcon', { connectorId, ...(iconRevision ? { iconRevision } : {}) }, controller.signal)
      .then(icon => {
        const value = `data:${icon.mimeType};base64,${icon.data}`
        cache.set(key, value)
        if (cache.size > 128) cache.delete(cache.keys().next().value)
        if (!controller.signal.aborted) setSource(value)
      })
      .catch(() => {})
    return () => controller.abort()
  }, [api, connectorId, iconRevision, key, source])

  return <span className="mcp-catalog-icon" style={{ width: size, height: size }} aria-hidden="true">
    {source ? <img src={source} alt="" draggable="false" /> : <Icon name="connectors" size={Math.round(size * 0.58)} />}
  </span>
}
