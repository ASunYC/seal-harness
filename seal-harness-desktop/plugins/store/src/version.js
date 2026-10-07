import { BackendError } from '../../capability-shared/src/backend.js'

export async function readVersion(backend, { collection, id, version }, signal) {
  const asset = (await backend.request(`${collection}/${encodeURIComponent(id)}`, { signal })).data
  if (!Array.isArray(asset?.versions)) throw new BackendError('invalidResponse')
  const current = asset.versions.find(item => item.version === version)
  if (!current) throw new BackendError('notFound')
  return { asset, current }
}
