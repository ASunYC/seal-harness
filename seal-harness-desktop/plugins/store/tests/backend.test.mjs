import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import test from 'node:test'
import { CapabilityBackend } from '../../capability-shared/src/backend.js'
import { createStore } from '../src/module.js'

const session = { accountId: 'alice', epoch: 1, accessToken: 'fixture-token' }
async function fixture(t, handler, options = {}) {
  const requests = []
  const server = createServer(async (req, res) => {
    requests.push({ url: req.url, headers: req.headers, method: req.method })
    await handler(req, res, requests)
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  t.after(() => { server.closeAllConnections(); server.close() })
  const url = `http://127.0.0.1:${server.address().port}/prefix/`
  const identity = { getSession: () => session }
  return { backend: new CapabilityBackend({ backendUrl: url, mcpCenterUrl: url, getIdentity: () => identity, ...options }), requests, identity }
}
const json = (res, data, meta) => { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ success: true, data, meta })) }

test('真实 HTTP 保留 Stratex 路径、Bearer 和跨页快照；不给浏览器返回 descriptor', async t => {
  const { backend, requests } = await fixture(t, (req, res) => {
    const offset = Number(new URL(req.url, 'http://fixture').searchParams.get('offset'))
    json(res, [{ id: `asset-${offset}`, name: `Skill ${offset}`, descriptor: { staticHeaders: [{ value: 'secret' }] } }], { total: 2, offset, asOf: '2026-09-23T00:00:00Z' })
  })
  const result = await createStore(backend).list({ collection: 'skills', scope: 'published' })
  assert.equal(result.length, 2)
  assert.equal('descriptor' in result[0], false)
  assert.equal(requests[0].url, '/prefix/api/v1/stratex/skills?scope=published&limit=100&offset=0')
  assert.match(requests[1].url, /offset=1&asOf=/)
  assert.equal(requests[0].headers.authorization, 'Bearer fixture-token')
})

test('空中间页、重复项和快照漂移都拒绝，不返回不完整目录', async t => {
  for (const mode of ['empty', 'duplicate', 'drift']) {
    const { backend } = await fixture(t, (req, res) => {
      const offset = Number(new URL(req.url, 'http://fixture').searchParams.get('offset'))
      json(res, mode === 'empty' && offset ? [] : [{ id: offset && mode !== 'duplicate' ? 'two' : 'one', name: 'x' }], { total: 2, offset, asOf: mode === 'drift' && offset ? '2026-09-24T00:00:00Z' : '2026-09-23T00:00:00Z' })
    })
    await assert.rejects(backend.list('skills'), { code: 'invalidResponse' })
  }
})

test('真实资产允许 metadata 缺少来源类型，目录与详情仍保留已声明的 HTTP 工具类型', async t => {
  const assets = [undefined, {}, { remoteOnly: 'not-for-client' }, { sourceType: 'external_mcp' }, { sourceType: 'http_adapter' }]
    .map((metadata, index) => ({ id: `asset-${index}`, name: `Asset ${index}`, metadata }))
  const { backend } = await fixture(t, (req, res) => {
    const path = new URL(req.url, 'http://fixture').pathname
    const asset = assets.find(item => path.endsWith(`/${item.id}`))
    json(res, asset ?? assets, { total: assets.length, offset: 0, asOf: '2026-09-26T00:00:00Z' })
  })
  const store = createStore(backend)
  for (const collection of ['skills', 'mcps', 'experts']) {
    const rows = await store.list({ collection })
    assert.equal(rows.length, assets.length)
    assert.deepEqual(rows.map(row => row.metadata), [undefined, {}, {}, { sourceType: 'external_mcp' }, { sourceType: 'http_adapter' }])
    for (const row of rows) assert.deepEqual((await store.detail({ collection, id: row.id })).metadata, row.metadata)
  }
})

test('401 刷新一次；包括专家在内的 403 保留远端拒绝', async t => {
  const { backend, identity, requests } = await fixture(t, (_req, res, rows) => {
    if (rows.length === 1) { res.writeHead(401); res.end(); return }
    json(res, { id: 'a', name: 'x' })
  })
  let refreshed = 0
  identity.refreshSession = () => { refreshed++; identity.getSession = () => ({ ...session, accessToken: 'new-token' }) }
  await backend.detail('skills', 'a')
  assert.equal(refreshed, 1)
  assert.equal(requests[1].headers.authorization, 'Bearer new-token')
  const denied = await fixture(t, (_req, res) => { res.writeHead(403); res.end() })
  denied.identity.refreshSession = () => { throw new Error('must not refresh') }
  for (const collection of ['mcps', 'experts']) await assert.rejects(denied.backend.detail(collection, 'a'), { code: 'accessDenied' })
  assert.equal(denied.requests.length, 2)
})

test('用户占位不发送请求；返回期间换用户即拒绝旧数据', async t => {
  const absent = await fixture(t, (_req, res) => json(res, []), { getIdentity: () => undefined })
  await assert.rejects(absent.backend.list('skills'), { code: 'identityUnavailable' })
  assert.equal(absent.requests.length, 0)
  const changed = await fixture(t, (_req, res) => {
    changed.identity.getSession = () => ({ ...session, accountId: 'bob', epoch: 2 })
    json(res, { id: 'a', name: 'private' })
  })
  await assert.rejects(changed.backend.detail('experts', 'a'), { code: 'identityChanged' })
})

test('下载不跟随重定向，超时覆盖响应体，拒绝超大响应', async t => {
  const redirected = await fixture(t, (_req, res) => { res.writeHead(302, { location: 'http://127.0.0.1:1/' }); res.end() })
  await assert.rejects(redirected.backend.download('skills/a/versions/1/download'), { code: 'unreachable' })
  const hanging = await fixture(t, (_req, res) => { res.writeHead(200); res.write('{') }, { timeoutMs: 30 })
  await assert.rejects(hanging.backend.request('skills'), { code: 'unreachable' })
  const large = await fixture(t, (_req, res) => { res.end('12345') })
  await assert.rejects(large.backend.download('skills/a', { maxBytes: 4 }), { code: 'invalidResponse' })
})

test('MCP Center 目录与 Logo 走独立路径，绝不附带 Stratex token', async t => {
  const icon = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])
  const { backend, requests } = await fixture(t, (req, res) => {
    if (req.url.endsWith('/demo/icon')) { res.setHeader('content-type', 'image/png'); res.end(icon); return }
    res.end(JSON.stringify({ data: [{ connectorId: 'demo', name: 'Demo', summary: '目录描述', category: 'office', tags: [], version: '1', clientAuthMode: 'none', toolCount: 5, iconRevision: 'icon-1' }], meta: { schemaVersion: 'mcp-center.catalog/v1', asOf: '2026-09-23T00:00:00Z', revision: 'r1' } }))
  })
  const store = createStore(backend)
  const result = await store.center({})
  assert.equal(result[0].connectorId, 'demo')
  assert.equal(result[0].iconRevision, 'icon-1')
  const logo = await store.centerIcon({ connectorId: 'demo', iconRevision: 'icon-1' })
  assert.deepEqual(Buffer.from(logo.data, 'base64'), icon)
  assert.equal(logo.mimeType, 'image/png')
  assert.equal(requests[0].url, '/prefix/api/v1/catalog/applications')
  assert.equal(requests[1].url, '/prefix/api/v1/catalog/applications/demo/icon')
  assert.equal(requests[0].headers.authorization, undefined)
  assert.equal(requests[1].headers.authorization, undefined)
  assert.equal(requests[0].headers['x-mcp-catalog-features'], 'auth-experience-v1')
})

test('MCP Center Logo 拒绝非图片和超大响应', async t => {
  const invalidType = await fixture(t, (_req, res) => { res.setHeader('content-type', 'text/html'); res.end('<svg>not allowed</svg>') })
  await assert.rejects(invalidType.backend.readCenterIcon('demo'), { code: 'invalidResponse' })
  const oversized = await fixture(t, (_req, res) => { res.setHeader('content-type', 'image/png'); res.setHeader('content-length', String(1024 * 1024 + 1)); res.end() })
  await assert.rejects(oversized.backend.readCenterIcon('demo'), { code: 'invalidResponse' })
})

test('发布传递版本 If-Match；专家额外保留 expected-status，服务端冲突明确返回', async t => {
  const { backend, requests } = await fixture(t, (_req, res) => { res.writeHead(412); res.end() })
  await assert.rejects(createStore(backend).transition({ collection: 'experts', id: 'a', version: '1.0', action: 'publish', etag: 'version-etag' }), { code: 'conflict' })
  assert.equal(requests[0].method, 'POST')
  assert.equal(requests[0].url, '/prefix/api/v1/stratex/experts/a/versions/1.0/publish')
  assert.equal(requests[0].headers['if-match'], 'version-etag')
  assert.equal(requests[0].headers['x-expert-expected-status'], 'draft')
})

test('store validation never returns normalized descriptor credentials to the client', async () => {
  const store = createStore({ request: async () => ({ data: {
    valid: true, errors: [], warnings: [{ code: 'warning', message: 'Review configuration' }],
    normalized: { descriptor: { staticHeaders: { Authorization: 'secret-header' }, environmentVariables: { TOKEN: 'secret-env' } }, dependencies: [] },
  } }) })
  const result = await store.transition({ collection: 'mcps', id: 'mcp', version: '1.0.0', action: 'validate', etag: 'etag' })
  assert.deepEqual(result.validation, { valid: true, errors: [], warnings: [{ code: 'warning', message: 'Review configuration' }] })
  assert(!JSON.stringify(result).includes('secret'))
})

test('草稿编辑只回传公开字段，更新保留原凭据并携带 ETag，冲突不写入', async () => {
  const calls = []
  const remote = { version: '1.0.0', status: 'draft', etag: 'v1', descriptor: { schemaVersion: 'stratex.capability/v1', description: 'before', staticHeaders: [{ headerName: 'Authorization', value: 'secret' }], entrypoint: 'SKILL.md' }, dependencies: [] }
  const store = createStore({ request: async (path, options) => { calls.push({ path, options }); if (!options.method) assert.equal(path, 'skills/skill'); return { data: { versions: [remote] } } } })
  const identity = { collection: 'skills', id: 'skill', version: '1.0.0' }
  const view = await store.version(identity)
  assert.equal(JSON.stringify(view).includes('secret'), false)
  await store.updateVersion({ ...identity, etag: 'v1', descriptor: { description: 'after' }, dependencies: [] })
  assert.equal(calls.at(-1).options.headers['if-match'], 'v1')
  assert.equal(calls.at(-1).options.body.descriptor.staticHeaders[0].value, 'secret')
  assert.equal(calls.at(-1).options.body.descriptor.entrypoint, 'SKILL.md')
  await assert.rejects(store.updateVersion({ ...identity, etag: 'old', descriptor: { description: 'after' } }), { code: 'conflict' })
  assert.equal(calls.at(-1).options.method, undefined)
})

test('创建版本、工件预检上传和导出沿用 Stratex 实际端点及字节', async () => {
  const { createHash } = await import('node:crypto')
  const calls = [], bytes = Buffer.from('zip-fixture')
  const hash = createHash('sha256').update(bytes).digest('hex')
  const backend = {
    request: async (path, options) => { calls.push({ path, ...options }); return { data: {} } },
    upload: async (path, uploaded) => { calls.push({ path, uploaded }); return { data: { artifactSha256: hash, warnings: [{ code: 'review', message: 'Review this package' }] } } },
    download: async path => { calls.push({ path }); return { bytes } },
  }
  const store = createStore(backend), identity = { collection: 'mcps', id: 'asset', version: '1.0.0' }
  await store.createVersion({ ...identity, descriptor: { description: 'MCP', transport: 'http', endpointTemplate: 'https://example.com/mcp' } })
  assert.equal(calls[0].path, 'mcps/asset/versions')
  assert.equal(calls[0].body.descriptor.schemaVersion, 'stratex.capability/v1')
  const input = { ...identity, contentBase64: bytes.toString('base64') }
  const inspection = await store.inspectArtifact(input)
  assert.equal(calls.at(-1).path, 'mcps/asset/versions/1.0.0/artifact/inspect')
  assert.equal(inspection.warnings.length, 1)
  await assert.rejects(store.uploadArtifact({ ...input, expectedSha256: '0'.repeat(64) }), { code: 'conflict' })
  await store.uploadArtifact({ ...input, expectedSha256: hash })
  assert.equal(calls.at(-1).path, 'mcps/asset/versions/1.0.0/artifact')
  assert.deepEqual(calls.at(-1).uploaded, bytes)
  assert.equal((await store.exportVersion(identity)).contentBase64, input.contentBase64)
  assert.equal(calls.at(-1).path, 'mcps/asset/versions/1.0.0/export')
})

test('技能文件预览从资产详情选版本，校验真实 ZIP 并拒绝凭据、越界及损坏工件', async t => {
  const { createArchive } = await import('../../skills/src/package.js')
  const { createHash } = await import('node:crypto')
  const bytes = createArchive([
    { path: 'SKILL.md', bytes: Buffer.from('# 说明\n真实文件'), mode: 0o644 },
    { path: 'refs/guide.txt', bytes: Buffer.from('参考内容'), mode: 0o644 },
    { path: 'descriptor.json', bytes: Buffer.from('{"token":"secret"}'), mode: 0o644 },
    { path: '.env', bytes: Buffer.from('TOKEN=secret'), mode: 0o644 },
    { path: 'image.bin', bytes: Buffer.from([0, 1, 2]), mode: 0o644 },
  ])
  const current = { version: '1.0.0', artifact: { sizeBytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') } }
  const { backend, requests } = await fixture(t, (req, res) => {
    if (req.url === '/prefix/api/v1/stratex/skills/asset') return json(res, { versions: [current] })
    if (req.url === '/prefix/api/v1/stratex/skills/asset/versions/1.0.0/export') return res.end(bytes)
    res.writeHead(405).end()
  })
  const store = createStore(backend)
  const input = { collection: 'skills', id: 'asset', version: '1.0.0' }
  const preview = await store.artifactFiles(input)
  assert.equal(preview.path, 'SKILL.md')
  assert.match(preview.content, /真实文件/)
  assert.deepEqual(preview.files.map(file => file.path).sort(), ['SKILL.md', 'image.bin', 'refs/guide.txt'])
  assert.deepEqual(requests.map(request => request.url), ['/prefix/api/v1/stratex/skills/asset', '/prefix/api/v1/stratex/skills/asset/versions/1.0.0/export'])
  await assert.rejects(store.artifactFiles({ ...input, version: 'missing' }), { code: 'notFound' })
  assert.equal((await store.artifactFiles({ ...input, path: 'image.bin' })).content, null)
  await assert.rejects(store.artifactFiles({ ...input, path: '../secret' }))
  await assert.rejects(store.artifactFiles({ ...input, path: '.env' }))
  current.artifact.sha256 = '0'.repeat(64)
  await assert.rejects(store.artifactFiles(input), { code: 'invalidResponse' })
})
