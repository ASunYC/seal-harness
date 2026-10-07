import { createHash, randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

const MAX_CATALOG_BYTES = 2 * 1024 * 1024
const MAX_ICON_RECORD_BYTES = 2 * 1024 * 1024

async function readJson(path, maxBytes) {
  const bytes = await readFile(path)
  if (!bytes.length || bytes.length > maxBytes) throw new Error('缓存文件大小无效')
  return JSON.parse(bytes.toString('utf8'))
}

async function replaceJson(root, path, value) {
  await mkdir(root, { recursive: true })
  const staging = `${path}.${randomUUID()}.tmp`
  try {
    await writeFile(staging, `${JSON.stringify(value)}\n`, { flag: 'wx' })
    await rm(path, { force: true })
    await rename(staging, path)
  } finally {
    await rm(staging, { force: true })
  }
}

/** Account-Home scoped cache for the public MCP Center snapshot and logos. */
export function createCenterCache(home) {
  const root = join(home, 'capabilities', 'store', 'mcp-center')
  const icons = join(root, 'icons')
  const iconPath = connectorId => join(icons, `${createHash('sha256').update(connectorId).digest('hex')}.json`)
  return {
    readCatalog: () => readJson(join(root, 'catalog.json'), MAX_CATALOG_BYTES),
    writeCatalog: value => replaceJson(root, join(root, 'catalog.json'), value),
    async readIcon(connectorId, iconRevision) {
      const value = await readJson(iconPath(connectorId), MAX_ICON_RECORD_BYTES)
      if (iconRevision && value.iconRevision !== iconRevision) throw new Error('Logo 缓存版本已过期')
      return { mimeType: value.mimeType, data: value.data }
    },
    writeIcon: async (connectorId, iconRevision, value) => {
      await mkdir(icons, { recursive: true })
      return replaceJson(icons, iconPath(connectorId), { ...value, iconRevision: iconRevision ?? '' })
    },
  }
}
