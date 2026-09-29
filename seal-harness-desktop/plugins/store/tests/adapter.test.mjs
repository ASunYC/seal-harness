import test from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { createHash } from 'node:crypto'
import { adapterHandlers } from '../src/adapter.js'
import { readArchive } from '../../skills/src/package.js'

const id = '49d9b8d0-d87c-4c65-8e54-c45b6c4fe9de'
const artifact = url => ({ schemaVersion: 'stratex.http-adapter/v1', sourceType: 'http_adapter', name: 'HTTP tools', description: 'Test adapter', tools: [{ name: 'lookup', riskLevel: 'read', inputSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'], additionalProperties: false }, request: { method: 'GET', url, auth: { type: 'bearer', credentialSlot: 'token' }, parameters: { id: { location: 'path' } } }, response: { format: 'json', dataPath: 'data' } }] })

test('HTTP tool draft writes canonical Stratex ZIP and reads it back without credential values', async () => {
  let archive, descriptor
  const calls = []
  const current = { version: '1.0.0', etag: 'revision-1', status: 'draft', descriptor: { description: 'tools', entrypoint: 'old.json', transport: 'http', compatibility: {} }, dependencies: [] }
  const backend = {
    request: async (path, options = {}) => { calls.push({ path, options }); if (options.method === 'PATCH') descriptor = options.body.descriptor; if (!options.method) assert.equal(path, `mcps/${id}`); return { data: { id, name: 'HTTP tools', slug: 'http-tools', kind: 'tool', category: 'development', summary: 'HTTP', versions: [current] } } },
    upload: async (path, bytes) => { calls.push({ path }); archive = bytes },
    download: async () => ({ bytes: archive }),
  }
  const api = adapterHandlers(backend)
  await api.saveAdapter({ id, version: '1.0.0', etag: 'revision-1', adapter: artifact('https://example.com/items/{id}') })
  assert.equal(calls[1].options.headers['if-match'], 'revision-1')
  assert.match(calls[2].path, /\/artifact$/)
  const files = readArchive(archive)
  assert.deepEqual(files.map(file => file.path).sort(), ['descriptor.json', 'manifest.json', 'stratex-http-adapter.json'])
  assert.equal(descriptor.entrypoint, undefined)
  assert.deepEqual(descriptor.credentialSlots, [{ name: 'token', required: true }])
  current.artifact = { sizeBytes: archive.length, sha256: createHash('sha256').update(archive).digest('hex') }
  const loaded = await api.adapter({ id, version: '1.0.0' })
  assert.equal(loaded.adapter.description, 'Test adapter')
  assert.equal(loaded.adapter.tools[0].request.auth.credentialSlot, 'token')
  const before = calls.length
  await assert.rejects(api.saveAdapter({ id, version: '1.0.0', etag: 'stale', adapter: artifact('https://example.com/items/{id}') }), { code: 'conflict' })
  assert.equal(calls.length, before + 1)
})

test('HTTP tool test validates typed input then uses the same real adapter request and redacts credentials', async t => {
  let requests = 0
  const server = createServer((request, response) => {
    requests++
    assert.equal(request.url, '/items/a%20b')
    assert.equal(request.headers.authorization, 'Bearer selected-secret')
    response.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ data: { value: 'selected-secret' } }))
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  t.after(() => { server.closeAllConnections(); server.close() })
  const adapter = artifact(`http://127.0.0.1:${server.address().port}/items/{id}`)
  const api = adapterHandlers({})
  await assert.rejects(api.testAdapter({ adapter, toolName: 'lookup', arguments: { id: 12 }, credentials: { token: 'selected-secret' } }))
  assert.equal(requests, 0)
  const result = await api.testAdapter({ adapter, toolName: 'lookup', arguments: { id: 'a b' }, credentials: { token: 'selected-secret' } })
  assert.equal(result.content[0].text, '{"value":"[redacted]"}')
  assert.equal(requests, 1)
})
