import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { createCenterCache } from '../src/center-cache.js'
import { createStore } from '../src/module.js'

const catalog = {
  data: [{ connectorId: 'itest', name: 'iTest', summary: '测试管理', category: 'office', tags: [], version: '1.0.1', clientAuthMode: 'none', toolCount: 50, iconRevision: 'icon-7' }],
  meta: { schemaVersion: 'mcp-center.catalog/v1', asOf: '2026-09-29T00:00:00Z', revision: 'r1' },
}
const icon = { mimeType: 'image/png', data: Buffer.from('real-logo').toString('base64') }

test('MCP Center 网络成功后持久化公开目录和 Logo，失败时读取最后有效快照', async t => {
  const home = await mkdtemp(join(tmpdir(), 'seal-harness-center-cache-'))
  t.after(() => rm(home, { recursive: true, force: true }))
  const cache = createCenterCache(home)
  const online = createStore({
    listCenter: async () => catalog,
    readCenterIcon: async () => icon,
  }, { centerCache: cache })

  assert.equal((await online.center({}))[0].name, 'iTest')
  assert.deepEqual(await online.centerIcon({ connectorId: 'itest', iconRevision: 'icon-7' }), icon)

  const offline = createStore({
    listCenter: async () => { throw new Error('offline') },
    readCenterIcon: async () => { throw new Error('offline') },
  }, { centerCache: createCenterCache(home) })
  assert.equal((await offline.center({}))[0].connectorId, 'itest')
  assert.deepEqual(await offline.centerIcon({ connectorId: 'itest', iconRevision: 'icon-7' }), icon)
})
