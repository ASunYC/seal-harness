import assert from 'node:assert/strict'
import test from 'node:test'
import { fixture } from './fixture.mjs'

test('knowledge RPC manages real HTTP library/document lifecycle, multipart, indexing and retrieval', async t => {
  const f = await fixture(t)
  assert.equal((await f.rpc('status')).value.configured, false)
  assert.match((await f.rpc('bases')).error.message, /API Key/)
  await f.configure('owner-1-key')
  assert.equal((await f.rpc('saveBase', { name: '指南', description: '资料', embeddingModelId: 'embed-1' })).ok, true)
  assert.equal(JSON.parse(f.requests.at(-1).raw).embedding_model_id, 'embed-1')
  const bases = await f.rpc('bases')
  assert.equal(bases.value.items[0].name, '指南')
  assert.equal(JSON.stringify(bases).includes('backend-secret'), false)
  const models = await f.rpc('models')
  assert.equal(models.value.items.length, 1)
  assert.equal(JSON.stringify(models).includes('model-secret'), false)
  assert.equal((await f.rpc('importText', { baseId: 'kb-1', title: '指南', content: '星图' })).ok, true)
  assert.equal(JSON.parse(f.requests.at(-1).raw).status, 'publish')
  assert.equal((await f.rpc('documents', { baseId: 'kb-1' })).value.items[0].parse_status, 'pending')
  assert.equal((await f.rpc('reparse', { documentId: 'doc-1' })).value.accepted, true)
  assert.equal((await f.rpc('documents', { baseId: 'kb-1' })).value.items[0].parse_status, 'completed')
  const uploaded = await f.rpc('upload', { baseId: 'kb-1', fileName: 'guide.txt', mimeType: 'text/plain', data: Buffer.from('文档内容').toString('base64') })
  assert.equal(uploaded.value.item.id, 'file-1')
  assert.match(f.requests.at(-1).type, /^multipart\/form-data; boundary=/u)
  assert.match(f.requests.at(-1).raw, /filename="guide.txt"/u)
  assert.match(f.requests.at(-1).raw, /文档内容/u)
  assert.equal((await f.rpc('search', { baseId: 'kb-1', query: '星图' })).value.items[0].knowledge_id, 'doc-1')
  assert.equal((await f.rpc('readDocument', { documentId: 'doc-1' })).value.chunks[0].content, '海豹在这里查找星图')
  assert.equal((await f.rpc('saveBase', { id: 'kb-1', name: '改名' })).ok, true)
  assert.equal((await f.rpc('deleteDocument', { documentId: 'doc-1' })).value.deleted, true)
  assert.equal((await f.rpc('deleteBase', { baseId: 'kb-1' })).value.deleted, true)
  assert.deepEqual((await f.rpc('bases')).value.items, [])
})

test('knowledge rejects malformed payloads and returns permissions without leaking backend text or keys', async t => {
  const f = await fixture(t)
  await f.configure('private-fixture-key')
  for (const [action, payload] of [
    ['saveBase', { name: 'ok', accountId: 'another' }],
    ['documents', { baseId: '../outside' }],
    ['search', { baseId: 'kb-1', query: '' }],
    ['upload', { baseId: 'kb-1', fileName: '../key', data: 'aGVsbG8=' }],
    ['upload', { baseId: 'kb-1', fileName: 'guide.txt', data: 'not base64' }],
  ]) assert.equal((await f.rpc(action, payload)).error.code, 'invalidInput')
  assert.equal(f.requests.length, 0)
  f.deny(true)
  const result = await f.rpc('bases')
  assert.match(result.error.message, /retrieve.*ingest.*manage_kbs/u)
  assert.equal(JSON.stringify(result).includes('private-fixture-key'), false)
  const route = f.routes.get('/api/seal-harness-knowledge/bases')
  assert.equal((await route.fetch(new Request('http://localhost', { method: 'POST', body: '{}' }))).status, 415)
  assert.equal((await route.fetch(new Request('http://localhost', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ type: 'client-request', rpcId: '1', method: 'wrong' }) }))).status, 400)
})

test('per-account connection and epoch reject stale results; cancellation and redirects never forward credentials', async t => {
  const f = await fixture(t)
  await f.configure('first-key')
  await f.rpc('saveBase', { name: '仅账号一' })
  f.setAccount('owner-2')
  assert.equal((await f.rpc('status')).value.configured, false)
  await f.configure('second-key')
  assert.deepEqual((await f.rpc('bases')).value.items, [])
  f.setAccount('owner-1')
  assert.equal((await f.rpc('bases')).value.items.length, 1)
  let release
  f.delay(new Promise(resolve => { release = resolve }))
  const requestCount = f.requests.length
  const pending = f.rpc('bases')
  while (f.requests.length === requestCount) await new Promise(resolve => setTimeout(resolve, 5))
  f.setAccount('owner-2'); release()
  assert.match((await pending).error.message, /账号已变化/u)
  const host = f.services.get('sealHarnessWeknora')
  await assert.rejects(host.request('/knowledge-bases/redirect'), /无法连接/u)
  assert.equal(f.requests.some(item => item.path === '/leaked'), false)
  const controller = new AbortController()
  controller.abort()
  await assert.rejects(host.request('/models', { signal: controller.signal }), /取消/u)
  f.setAccount(null)
  assert.match((await f.rpc('status')).error.message, /登录/u)
})
