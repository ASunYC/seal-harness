import test from 'node:test'
import assert from 'node:assert/strict'
import { createSuperagentService, PANEL_URL } from '../src/service.js'

test('reads the isolated service state without forwarding credentials', async () => {
  const calls = []
  const service = createSuperagentService({
    request: async (url, options) => {
      calls.push({ url: String(url), headers: options.headers })
      return Response.json({ setup: { problem: { detail: 'Set GitHub source' } }, health: { runtime: { state: 'ready' } }, load: { running: 1, queued: 2 }, paused: false })
    },
    openExternal() {},
  })
  assert.deepEqual(await service.status(new AbortController().signal), {
    online: true, setup: 'Set GitHub source', runtime: 'ready', running: 1, queued: 2, paused: false,
  })
  assert.deepEqual(calls, [{ url: `${PANEL_URL}orchestrator/api/state`, headers: { 'x-orchestrator-request': '1' } }])
})

test('reports an unavailable service and opens only its fixed local address', async () => {
  const opened = []
  const service = createSuperagentService({
    request: async () => { throw new Error('connection refused') },
    openExternal: async url => { opened.push(url) },
  })
  assert.deepEqual(await service.status(new AbortController().signal), { online: false, message: 'Superagent 服务未启动或暂时无法连接。' })
  assert.deepEqual(await service.open(), { url: PANEL_URL })
  assert.deepEqual(opened, [PANEL_URL])
})

test('explains the first setup requirement in Chinese', async () => {
  const service = createSuperagentService({
    request: async () => Response.json({ setup: { problem: { code: 'repositoryUnset', detail: 'The GitHub Source names no repository.' } }, health: { runtime: { state: 'paused' } } }),
    openExternal() {},
  })
  assert.equal((await service.status(new AbortController().signal)).setup, '尚未设置 GitHub 仓库。')
})
