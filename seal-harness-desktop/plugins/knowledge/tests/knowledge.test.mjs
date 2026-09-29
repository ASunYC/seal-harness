import test from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { once } from 'node:events'
import { Context } from '@deepseek-ai/cordis'
import { HostConnectionService } from '@deepseek-ai/dsh-client-connection'
import { KnowledgeService } from '../src/service.js'
import * as plugin from '../src/index.js'

const group = { id: 'group-1', name: '资料集', categories: ['office'], visibility: 'private', fileCount: 1, queryableDocumentCount: 1, conversationReady: true, revision: 1, lifecycle: 'ready', analysis: null, installable: true, updatedAt: '2026-09-26T00:00:00Z' }
const file = { id: 'file-1', groupId: group.id, fileName: '资料.txt', sizeBytes: 3, status: 'ready', updatedAt: group.updatedAt }
function credentials() { let record, queue = Promise.resolve(); return { modifyRecord: (_key, update) => { const next = queue.then(async () => { record = await update(record) ?? record; return record }); queue = next.catch(() => {}); return next } } }
async function fixture(t, mode = 'standalone') {
  const requests = [], controls = { revision: 1, text: '真实原文', chunkOffset: 3 }
  const server = createServer(async (req, res) => {
    const chunks = []; for await (const chunk of req) chunks.push(chunk)
    const bytes = Buffer.concat(chunks), body = req.headers['content-type'] === 'application/json' ? JSON.parse(bytes || '{}') : bytes.toString()
    requests.push({ url: req.url, method: req.method, headers: req.headers, body })
    let data
    const path = req.url.replace(/^\/api/, '').split('?')[0]
    if (path === '/v1/clients') data = { clientCredential: 'kbc_fixture', client: { id: 'client-1', knowledgeBaseId: 'kb-1' } }
    else if (path === '/v1/knowledge-groups' && req.method === 'GET') data = { items: [{ ...group, revision: controls.revision }], total: 1, offset: 0 }
    else if (path === '/v1/wiki/library/share-users') data = { users: [{ id: 'user-1', username: 'alice', displayName: 'Alice' }] }
    else if (path === '/v1/knowledge-installations') data = { items: [{ groupId: group.id, status: 'active' }] }
    else if (path === '/v1/knowledge-groups/group-1' && req.method === 'GET') data = { ...group, revision: controls.revision }
    else if (path === '/v1/knowledge-groups/group-1' && req.method === 'PATCH' || path === '/v1/knowledge-groups' && req.method === 'POST') data = { ...group, ...body }
    else if (path === '/v1/knowledge-groups/group-1/files') data = { items: [file] }
    else if (path.endsWith('/preview')) data = { fileName: file.fileName, content: controls.text }
    else if (path.endsWith('/download')) { res.writeHead(200, { 'content-type': 'text/plain', 'content-disposition': 'attachment; filename="source.txt"' }); res.end('abc'); return }
    else if (path.endsWith('/files/upload-sessions')) data = { id: 'upload-1', receivedBytes: 0 }
    else if (path === '/v1/knowledge-upload-sessions/upload-1' && req.method === 'PATCH') { res.writeHead(204, { 'upload-offset': String(controls.chunkOffset) }); res.end(); return }
    else if (path.endsWith('/complete') || path.endsWith('/retry')) data = { file, jobId: 'job-1' }
    else if (path.endsWith('/knowledge-retrieval/query')) data = { citations: [{ groupId: group.id, fileId: file.id, fileName: file.fileName, chunkId: 'chunk-1', generation: 'generation-1', excerpt: '真实', score: 1 }] }
    else if (path.endsWith('/knowledge-retrieval/read')) data = { fileName: file.fileName, sections: [{ sectionId: 'section-1', text: controls.text }], complete: true }
    else if (path.endsWith('/knowledge-retrieval/document')) data = { text: controls.text, generation: 'generation-1' }
    else if (path.endsWith('/shares/codes')) data = { code: 'fixture-share-code-123456', expiresAt: '2026-09-27T00:00:00Z' }
    else if (path === '/v1/shares') data = { items: [] }
    else data = {}
    res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify(data))
  })
  server.listen(0, '127.0.0.1'); await once(server, 'listening')
  const config = { knowledgeBaseUrl: `http://127.0.0.1:${server.address().port}/`, knowledgeTargetType: mode }
  const listeners = new Set(), identity = { subscribe: fn => { listeners.add(fn); return () => listeners.delete(fn) }, getAccessToken: async () => 'platform-token' }
  const saved = credentials(), service = new KnowledgeService({ config, identity, credentials: saved })
  t.after(() => { service.dispose(); server.closeAllConnections(); server.close() })
  return { service, config, identity, credentials: saved, requests, controls }
}

test('standalone registers once in credentials and preserves collection/file/upload/share/retrieval wire contracts', async t => {
  const { service, requests, controls } = await fixture(t)
  assert.equal(requests.length, 0, 'construction does not access the network')
  await Promise.all([service.invoke('list', { scope: 'installed' }), service.invoke('list', { scope: 'owned' })])
  assert.equal(requests.filter(row => row.url === '/v1/clients').length, 1)
  assert.equal(requests[0].headers.authorization, undefined)
  assert.equal(requests.at(-1).headers['x-knowledge-client-credential'], 'kbc_fixture')
  assert.equal((await service.invoke('detail', { groupId: group.id })).files[0].fileName, file.fileName)
  await service.invoke('save', { groupId: group.id, name: '新名称', categories: ['development'], visibility: 'organization' })
  assert.deepEqual(requests.at(-1).body, { name: '新名称', description: '', categories: ['development'], visibility: 'organization' })
  await service.invoke('uploadStart', { groupId: group.id, fileName: file.fileName, mimeType: 'text/plain', sizeBytes: 3 })
  assert.deepEqual(requests.at(-1).body, { fileName: file.fileName, mimeType: 'text/plain', sizeBytes: 3 })
  assert.deepEqual(await service.invoke('uploadChunk', { uploadId: 'upload-1', offset: 0, base64: 'YWJj' }), { receivedBytes: 3 })
  assert.equal(requests.at(-1).headers['upload-offset'], '0'); assert.equal(requests.at(-1).body, 'abc')
  controls.chunkOffset = 5
  await assert.rejects(service.invoke('uploadChunk', { uploadId: 'upload-1', offset: 0, base64: 'YWJj' }), /分块上传失败/)
  for (const action of ['uploadComplete', 'uploadCancel']) await service.invoke(action, { uploadId: 'upload-1' })
  assert.equal(requests.at(-1).method, 'DELETE')
  const result = await service.invoke('search', { groupIds: [group.id], query: '原文' })
  assert.equal(result.citations[0].generation, 'generation-1')
  await service.invoke('navigate', { groupId: group.id, operation: 'tail', fileId: file.id, maxChars: 2000 })
  assert.deepEqual(requests.at(-1).body, { groupId: group.id, operation: 'tail', fileId: file.id, maxChars: 2000 })
  await assert.rejects(service.invoke('navigate', { groupId: group.id, operation: 'search', query: 'q', fileId: file.id }), /不接受/)
  await service.invoke('share', { collectionIds: [group.id] }); assert.deepEqual(requests.at(-1).body, { collectionIds: [group.id] })
  await service.invoke('redeem', { code: 'fixture-share-code-123456' }); assert.equal(requests.at(-1).url, '/v1/shares/redeem')
  await service.invoke('revokeShare', { shareId: 'share-1' }); assert.equal(requests.at(-1).method, 'DELETE')
})

test('platform uses api/v1 and identity token, workflow export validates revisions and never truncates', async t => {
  const { service, requests, controls } = await fixture(t, 'platform')
  const { resources } = await service.workflowResources()
  assert.equal(resources[0].sourceId, file.id); assert.equal(resources[0].version, '1')
  assert(!requests.some(row => row.url === '/v1/clients'))
  assert.equal(requests[0].headers.authorization, 'Bearer platform-token')
  assert(requests[0].url.startsWith('/api/v1/'))
  assert.equal((await service.invoke('shareUsers', { query: 'Alice' })).users[0].id, 'user-1')
  assert.equal(requests.at(-1).url, '/api/v1/wiki/library/share-users?query=Alice')
  await service.invoke('grant', { groupId: group.id, principal: { issuer: 'agent-earth-platform', subject: 'user-1', displayName: 'Alice' }, role: 'viewer' })
  assert.deepEqual(requests.at(-1).body, { principal: { issuer: 'agent-earth-platform', subject: 'user-1', displayName: 'Alice' }, role: 'viewer' })
  const result = await service.workflowExport(resources[0])
  const capability = result.capabilities[0]
  assert.deepEqual(JSON.parse(capability.files[0].content), { pages: [{ title: file.fileName, content: '真实原文' }] })
  assert.equal(capability.version, capability.descriptor.publisherSource.contentSha256)
  controls.revision = 2
  await assert.rejects(service.workflowExport(resources[0]), /版本已变化/)
  controls.revision = 1; controls.text = 'a'.repeat(460 * 1024)
  await assert.rejects(service.workflowExport(resources[0]), /450 KB/)
})

test('real DSH Connection RPC, tools and streamed downloads unload independently; activation is offline-safe', async t => {
  const { config, identity, credentials, requests } = await fixture(t)
  const context = new Context(), tools = new Map()
  context.provide('webServer', { register: () => () => {} })
  const connection = new HostConnectionService(context, [], { isAuthenticated: () => true })
  context.provide('credentials', credentials); context.provide('sealHarnessIdentity', identity); context.provide('sealHarnessServices', { getConfig: () => config, subscribe: () => () => {} })
  context.provide('tools', { register: definition => { tools.set(definition.name, definition); return () => tools.delete(definition.name) } })
  const runtime = context.plugin(plugin); await runtime.await()
  t.after(() => runtime.dispose())
  assert(context.get('sealHarnessKnowledge')); assert.equal(requests.length, 0); assert.equal(tools.size, 3)
  const handler = connection.createSharedFetchHandler('/api')
  const method = 'seal-harness-knowledge/status'
  const response = await handler.fetch(new Request(`http://localhost/api/${method}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ type: 'client-request', rpcId: 'fixture', method, payload: {} }) }))
  const status = (await response.json()).result
  assert.equal(status.ok, true); assert(!JSON.stringify(status).includes('kbc_')); assert.equal(requests.length, 0)
  const search = JSON.parse(await tools.get('knowledge_search').execute({ groupIds: [group.id], query: '原文' }, { signal: new AbortController().signal }))
  assert.equal(search.citations[0].fileName, file.fileName)
  const download = await handler.fetch(new Request(`http://localhost/api/seal-harness-knowledge/file?groupId=${group.id}&fileId=${file.id}`))
  assert.equal(download.headers.get('content-disposition'), 'attachment; filename="source.txt"'); assert.equal(await download.text(), 'abc')
  await runtime.dispose()
  assert.equal(tools.size, 0); assert.equal(context.get('sealHarnessKnowledge'), undefined)
  assert.equal((await handler.fetch(new Request(`http://localhost/api/${method}`, { method: 'POST' }))).status, 404)
})


test('switching knowledge services cancels old requests and selects separately persisted credentials', async t => {
  const records = new Map(), requests = []
  let pendingSignal
  const service = new KnowledgeService({
    config: { knowledgeBaseUrl: 'http://first.test/', knowledgeTargetType: 'standalone' },
    identity: { subscribe: () => () => {} },
    credentials: { modifyRecord: async (key, update) => { const record = await update(records.get(key)); if (record) records.set(key, record); return records.get(key) } },
    fetchImpl: async (url, init) => {
      requests.push({ url: String(url), credential: init.headers instanceof Headers ? init.headers.get('x-knowledge-client-credential') : null })
      if (url.pathname === '/v1/clients') return Response.json({ clientCredential: `kbc_${url.hostname}`, client: { id: 'client', knowledgeBaseId: 'kb' } })
      if (url.hostname === 'first.test') {
        pendingSignal = init.signal
        return new Promise((_resolve, reject) => init.signal.addEventListener('abort', () => reject(init.signal.reason), { once: true }))
      }
      return Response.json({ code: 'shared-code-1234567890123' })
    },
  })
  t.after(() => service.dispose())
  const pending = service.invoke('share', { collectionIds: ['group-1'] })
  while (!pendingSignal) await new Promise(resolve => setImmediate(resolve))
  service.configure({ knowledgeBaseUrl: 'http://second.test/', knowledgeTargetType: 'standalone' })
  await assert.rejects(pending, /abort/i)
  await service.invoke('share', { collectionIds: ['group-1'] })
  assert.equal(records.size, 2)
  assert.equal(requests.at(-1).credential, 'kbc_second.test')
  assert.equal(requests.at(-1).url, 'http://second.test/v1/shares/codes')
})

test('service changes between completed requests stop pagination and workflow continuations', async t => {
  for (const operation of ['list', 'workflowResources', 'workflowExport']) {
    const { service, requests, config } = await fixture(t, 'platform')
    const next = { ...config, knowledgeBaseUrl: 'http://new-service.invalid/' }
    let callsAtSwitch
    if (operation === 'list') {
      const request = service.request.bind(service)
      service.request = async (...args) => {
        const result = await request(...args)
        if (callsAtSwitch === undefined) {
          callsAtSwitch = requests.length
          service.configure(next)
          return { ...result, total: 2 }
        }
        return result
      }
    } else {
      const invoke = service.invoke.bind(service)
      service.invoke = async (...args) => {
        const result = await invoke(...args)
        if (callsAtSwitch === undefined) {
          callsAtSwitch = requests.length
          service.configure(next)
        }
        return result
      }
    }
    const run = operation === 'list' ? service.invoke('list', { scope: 'installed' })
      : operation === 'workflowResources' ? service.workflowResources()
      : service.workflowExport({ kind: 'wiki', sourceId: file.id, collectionId: group.id, version: '1' })
    await assert.rejects(run, error => error.name === 'AbortError', operation)
    assert.equal(requests.length, callsAtSwitch, `${operation} must stop after the completed old-service request`)
  }
})
