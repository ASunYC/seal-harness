import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { createNativeAgents } from '../src/native.js'
import { createEncryption } from '../src/storage.js'
import { createAgentService } from '../src/service.js'
import { AutonomousPlatformClient } from '../stratex/main/services/autonomous-platform-client.js'
import { deploymentModels } from '../src/models.js'

async function temporary(t) { const root = await mkdtemp(join(tmpdir(), 'seal-harness-agents-')); t.after(() => rm(root, { recursive: true, force: true })); return root }
function agents() {
  const live = new Map(), persisted = new Set(), calls = []
  const attach = async (id, type, options) => { calls.push({ type, options }); const agent = { id, cancel() {} }; live.set(id, agent); persisted.add(id); return { agent, async dispose() { live.delete(id) } } }
  return { calls, live, ctx: { sessions: { get: id => live.get(id), flush: async session => assert.ok(session) }, workspaceRegistry: { create: async () => ({ attachSession: async id => assert.ok(persisted.has(id)) }) }, get: () => ({ currentSelection: () => ({ provider: 'local', model: 'fixture' }) }), agents: { get: id => live.get(id), releaseInstance: async id => live.delete(id), create: options => attach(options.sessionId, 'create', options), resume: options => { assert.ok(persisted.has(options.resumeSessionId)); return attach(options.resumeSessionId, 'resume', options) } } } }
}

test('native instances use DSH create/resume and preserve session identity across stop, reopen and plugin restart', async t => {
  const home = await temporary(t), runtime = agents(), path = join(home, 'instances.json')
  const service = await createNativeAgents(runtime.ctx, path)
  const input = { action: 'create', input: { requestId: randomUUID(), name: '写作助理', cwd: home, model: null } }
  const created = await service.request(input), id = created.instances[0].id
  assert.equal(created.instances[0].status, 'running')
  assert.equal(runtime.calls[0].options.meta.cwd, await realpath(home))
  await service.request(input)
  assert.equal(runtime.calls.length, 1)
  await service.request({ action: 'stop', id })
  assert.equal((await service.request({ action: 'snapshot' })).instances[0].status, 'stopped')
  assert.deepEqual(await service.request({ action: 'open', id }), { sessionId: id })
  await service.request({ action: 'rename', id, name: '新名称' })
  await service.dispose()
  assert.equal(runtime.live.size, 0)
  const restored = await createNativeAgents(runtime.ctx, path)
  assert.equal((await restored.request({ action: 'snapshot' })).instances[0].name, '新名称')
  await restored.request({ action: 'open', id })
  assert.equal(runtime.calls.at(-1).type, 'resume')
  await restored.request({ action: 'delete', id })
  assert.deepEqual(JSON.parse(await readFile(path, 'utf8')), [])
  await restored.dispose()
  await assert.rejects(restored.request(input), /卸载/)
})

test('native input validation rejects missing directory and concurrent creates remain idempotent', async t => {
  const home = await temporary(t), runtime = agents(), service = await createNativeAgents(runtime.ctx, join(home, 'instances.json'))
  t.after(() => service.dispose())
  await assert.rejects(service.request({ action: 'create', input: { requestId: randomUUID(), name: 'x', cwd: join(home, 'missing'), model: null } }), /ENOENT/)
  const input = { action: 'create', input: { requestId: randomUUID(), name: 'x', cwd: home, model: null } }
  await Promise.all([service.request(input), service.request(input)])
  assert.equal((await service.request({ action: 'snapshot' })).instances.length, 1)
  assert.equal(runtime.calls.length, 1)
})

test('deployment records use DSH credentials, authenticate encrypted content, and reuse the persisted key', async () => {
  const records = new Map(), credentials = { async modifyRecord(key, update) { records.set(key, update(records.get(key))) }, async readRecord(key) { return records.get(key) } }
  const first = await createEncryption(credentials), second = await createEncryption(credentials)
  const bytes = first.encryptString('ssh-password')
  assert.equal(second.decryptString(bytes), 'ssh-password')
  assert.equal(bytes.includes(Buffer.from('ssh-password')), false)
  bytes[bytes.length - 1] ^= 1
  assert.throws(() => second.decryptString(bytes))
})

const instance = { id: 'a5c9f15a-3ca4-4cef-8b71-32432382916d', name: '测试', kind: 'reasoning', ownerId: 'owner', status: 'running', endpoint: { restUrl: 'https://runtime.example/api', wsUrl: null, manageUrl: 'https://runtime.example/manage' }, lastError: null, updatedAt: '2026-09-26' }
const task = { id: '418928f3-75c0-45b0-a287-044ba6d0d3b2', instanceId: instance.id, status: 'completed', stage: 'complete', percent: 100, error: null, updatedAt: '2026-09-26' }
test('platform protocol preserves Stratex paths, react idempotency and planner body distinction', async () => {
  const calls = [], fetchImpl = async (url, init) => {
    calls.push({ path: new URL(url).pathname + new URL(url).search, method: init.method, body: init.body ? JSON.parse(init.body) : undefined })
    if (init.method === 'POST' && !new URL(url).pathname.endsWith('/actions')) return Response.json({ task, instanceId: instance.id, taskUrl: `/api/v1/terminal-instances/tasks/${task.id}`, instanceUrl: `/api/v1/terminal-instances/${instance.id}` })
    return Response.json(init.method === 'GET' ? { instances: [instance], total: 1 } : { instance })
  }
  const options = { baseUrl: 'https://platform.example/', accessToken: async () => 'fixture', fetchImpl }
  const client = new AutonomousPlatformClient(options), requestId = randomUUID()
  assert.equal((await client.list())[0].id, instance.id)
  await client.create({ name: '测试', requestId })
  await new AutonomousPlatformClient({ ...options, mode: 'planner' }).create({ name: '流程', requestId })
  await client.action(instance.id, 'restart'); await client.remove(instance.id)
  assert.deepEqual(calls.map(item => [item.method, item.path]), [['GET', '/api/v1/terminal-instances?offset=0&limit=100'], ['POST', '/api/v1/terminal-instances'], ['POST', '/api/v1/terminal-instances'], ['POST', `/api/v1/terminal-instances/${instance.id}/actions`], ['DELETE', `/api/v1/terminal-instances/${instance.id}`]])
  assert.deepEqual(calls[1].body, { mode: 'react', name: '测试', idempotencyKey: requestId })
  assert.deepEqual(calls[2].body, { mode: 'planner', name: '流程' })
})

test('catalog keeps local instances visible when a remote source fails', async t => {
  const home = await temporary(t), calls = [], good = { request: async () => ({ instances: [] }) }
  const local = { request: async input => { calls.push(input); return { instances: [{ id: randomUUID(), name: '本机', status: 'running', native: true }] } } }
  const service = await createAgentService({ sealHarnessServices: { getConfig: () => ({ terminalBaseUrl: 'https://platform.example/' }) }, sealHarnessIdentity: { getSession: () => null }, settings: { describe: () => [] } }, { home, resources: home, encryption: {}, services: { localAuto: local, localFlow: good, remoteAuto: good, remoteFlow: good, platformAuto: { request: async () => { throw new Error('offline') } }, platformFlow: good } })
  const result = await service.catalog()
  assert.equal(result.instances[0].name, '本机')
  assert.equal(result.notices[0].message, 'offline')
  assert.equal(calls[0].action, 'snapshot')
})

test('model export reads public DSH settings and resolves only selected credentials', async () => {
  let credential
  const ctx = { settings: { describe: () => [{ ns: 'llm-pi-ai', value: { providers: { test: { api: 'openai-responses', baseURL: 'https://models.example/v1', apiKeyEnv: 'MODEL_TEST' } } } }] }, llm: { resolveModelInfo: async () => ({}), listModels: async () => [{ id: 'a', name: 'A' }] }, credentials: { resolve: async key => { credential = key; return { value: 'private-value' } } } }
  const model = deploymentModels(ctx)
  assert.equal((await model.models())[0].label, 'test · A')
  const resolved = await model.resolveModel({ connectionId: 'test', remoteModelId: 'a' })
  assert.equal(resolved.protocol, 'responses'); assert.equal(resolved.apiKey, 'private-value'); assert.equal(credential, 'MODEL_TEST')
  assert.equal(JSON.stringify(await model.models()).includes('private-value'), false)
})

test('platform requests are cancelled when plugin lifetime ends', async () => {
  const lifetime = new AbortController()
  let started
  const ready = new Promise(resolve => { started = resolve })
  const client = new AutonomousPlatformClient({ baseUrl: 'https://platform.example/', accessToken: async () => 'fixture', signal: lifetime.signal, fetchImpl: async (_, { signal }) => { started(); return new Promise((_, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true })) } })
  const request = client.list(); await ready; lifetime.abort()
  await assert.rejects(request)
})

test('workflow CLI cancellation kills the owned process and deployment manifests match their files', async t => {
  const { WorkflowCli } = await import('../stratex/main/services/workflowCli.js')
  const { createHash } = await import('node:crypto')
  const { writeFile } = await import('node:fs/promises')
  const resources = await temporary(t), source = 'setInterval(() => {}, 1000)\n'
  await writeFile(join(resources, 'stratex-flow.mjs'), source)
  await writeFile(join(resources, 'manifest.json'), JSON.stringify({ schemaVersion: 1, version: '0.1.0', file: 'stratex-flow.mjs', sha256: createHash('sha256').update(source).digest('hex') }))
  const lifetime = new AbortController(), cli = new WorkflowCli({ executable: process.execPath, resourceDirectory: resources, signal: lifetime.signal })
  const operation = cli.execute(['prepare'], {})
  setTimeout(() => lifetime.abort(), 30)
  await assert.rejects(operation, error => error.code === 'operationCancelled')
  for (const directory of ['autonomous-linux', 'workflow-linux']) {
    const root = new URL(`../resources/${directory}/`, import.meta.url), manifest = JSON.parse(await readFile(new URL('manifest.json', root), 'utf8'))
    for (const [file, sha256] of Object.entries(manifest.files)) assert.equal(createHash('sha256').update(await readFile(new URL(file, root))).digest('hex'), sha256, file)
    assert.equal(Object.keys(manifest.files).some(file => file.includes('/patches/') || file.includes('network-safety')), false)
  }
})
