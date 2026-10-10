import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { connectorCatalog, skillCatalog, skillBundles, remoteConfiguration, remoteUrl } from '../src/catalog.js'
import { downloadPinnedFiles, downloadMarketSkill, boundedDownload } from '../src/catalog-download.js'
import { configSchema, validateTransport } from '../../connectors/src/schema.js'
import { getArtifactPins } from '../vendor/cc-haha/managedRuntime.ts'

const hash = bytes => createHash('sha256').update(bytes).digest('hex')
test('all 55 connectors, 398 market skills and 29 pinned skills have complete source records and icons', async () => {
  assert.equal(connectorCatalog.length, 55)
  assert.equal(connectorCatalog.filter(item => item.transport === 'mcp').length, 43)
  assert.equal(connectorCatalog.filter(item => item.transport === 'cli').length, 3)
  assert.equal(skillBundles.length, 9)
  assert.equal(skillCatalog.length, 407)
  assert.equal(new Set(skillCatalog.map(item => item.id)).size, 407)
  assert.equal(skillBundles.flatMap(recipe => recipe.files.filter(file => file.target.endsWith('/SKILL.md'))).length, 29)
  const provenance = JSON.parse(await readFile(new URL('../catalog/cc-haha-provenance.json', import.meta.url), 'utf8'))
  for (const item of connectorCatalog) {
    assert(item.displayName)
    assert.equal(hash(Buffer.from(item.icon.split(',')[1], 'base64')), provenance.sourceHashes[`desktop/public/connectors/${item.id}.svg`])
    assert(Buffer.from(item.icon.split(',')[1], 'base64').toString('utf8').includes('<svg'))
    if (item.transport === 'cli') for (const target of item.platforms) assert.match(getArtifactPins(item, target).binaryIntegrity, /^sha256-/)
  }
  for (const file of ['types.ts', 'managedRuntime.ts', 'cliAdapter.ts']) {
    const adapted = await readFile(new URL(`../vendor/cc-haha/${file}`, import.meta.url), 'utf8')
    assert.equal(hash(adapted.replaceAll("'./types.ts'", "'./types.js'").replaceAll("'./managedRuntime.ts'", "'./managedRuntime.js'")), provenance.sourceHashes[`src/services/connectors/${file}`])
  }
})

test('all remote recipes convert to valid configs and query tokens stay out of the stored public URL', async () => {
  for (const item of connectorCatalog.filter(item => item.transport === 'mcp')) await validateTransport(configSchema.parse(remoteConfiguration(item.id)))
  const tencent = configSchema.parse(remoteConfiguration('tencent-maps'))
  tencent.queryCredentials.key = 'secret &? token'
  assert.equal(new URL(tencent.url).search, '')
  assert.equal(new URL(remoteUrl(tencent)).searchParams.get('format'), '0')
  assert.equal(new URL(remoteUrl(tencent)).searchParams.get('key'), 'secret &? token')
  assert.deepEqual(tencent.requiredQuery, ['key'])
  assert.deepEqual(remoteConfiguration('notion').oauth, { scopes: [] })
})

test('pinned bundle downloads retain complete assets and licenses and reject checksum or path changes', async () => {
  const contents = { 'skills/sample/SKILL.md': '---\nname: sample\ndescription: Example\n---\nRead references/a.md', 'skills/sample/references/a.md': 'resource', LICENSE: 'license' }
  const recipe = { id: 'sample', repository: 'owner/repo', commit: 'a'.repeat(40), version: '1.0.0', license: 'MIT', files: Object.entries(contents).map(([path, value]) => ({ source: path, target: path, integrity: `sha256-${hash(value)}` })) }
  const response = async url => new Response(contents[decodeURIComponent(new URL(url).pathname.split('/').slice(4).join('/'))])
  const result = await downloadPinnedFiles(recipe, undefined, response)
  assert.equal(result.files.length, 3)
  assert(result.files.some(file => file.path.endsWith('references/a.md')))
  assert.equal(result.files.find(file => file.path === 'LICENSE').bytes.toString(), 'license')
  await assert.rejects(downloadPinnedFiles(recipe, undefined, async () => new Response('changed')), /校验失败/)
  await assert.rejects(downloadPinnedFiles({ ...recipe, files: [{ source: '../secret', target: 'valid', integrity: '' }] }, undefined, response), /不安全/)
  await assert.rejects(boundedDownload('https://example.com', undefined, 1, async () => new Response('too large')), /大小限制/)
})

test('online skill installation resolves owner/version and verifies the entire file manifest', async () => {
  const item = skillCatalog.find(item => item.source === 'clawhub')
  const body = '---\nname: sample\ndescription: Example\n---\nBody'
  const urls = []
  const fake = async url => {
    urls.push(url)
    if (url.includes('/versions/')) return Response.json({ version: { files: [{ path: 'SKILL.md', sha256: hash(body) }], license: 'MIT' } })
    if (url.includes('/file?')) return new Response(body)
    return Response.json({ latestVersion: { version: '1.2.3' } })
  }
  const result = await downloadMarketSkill(item.id, undefined, fake)
  assert.equal(result.origin.version, '1.2.3')
  assert.equal(result.origin.owner, item.owner)
  assert(urls.every(url => new URL(url).searchParams.get('owner') === item.owner))
  assert.equal(result.files[0].bytes.toString(), body)
  assert(result.files.some(file => file.path === 'SEAL-SOURCE.md'))
  await assert.rejects(downloadMarketSkill(item.id, undefined, async url => url.includes('/file?') ? new Response('wrong') : fake(url)), /完整性检查失败/)
})

test('SkillHub preserves binary resources and rejects a different returned publisher skill', async () => {
  const item = skillCatalog.find(item => item.source === 'skillhub'), bytes = Buffer.from([0, 255, 123, 2])
  const fake = async url => {
    if (url.endsWith('/files')) return Response.json({ files: [{ path: 'assets/data.bin', sha256: hash(bytes) }] })
    if (url.includes('/file?')) return new Response(bytes)
    return Response.json({ skill: { slug: item.slug, version: '2.0.0' } })
  }
  const result = await downloadMarketSkill(item.id, undefined, fake)
  assert.deepEqual(result.files[0].bytes, bytes)
  assert.equal(result.origin.version, '2.0.0')
  await assert.rejects(downloadMarketSkill(item.id, undefined, async () => Response.json({ skill: { slug: 'other', version: '2.0.0' } })), /不同的技能/)
})

test('download retries transient network failures but never retries permanent HTTP errors', async () => {
  let calls = 0
  const bytes = await boundedDownload('https://example.com', undefined, 10, async () => {
    calls++; if (calls === 1) throw new TypeError('fetch failed'); return new Response('ok')
  })
  assert.equal(bytes.toString(), 'ok'); assert.equal(calls, 2)
  calls = 0
  await assert.rejects(boundedDownload('https://example.com', undefined, 10, async () => { calls++; return new Response('missing', { status: 404 }) }), /HTTP 404/)
  assert.equal(calls, 1)
})
