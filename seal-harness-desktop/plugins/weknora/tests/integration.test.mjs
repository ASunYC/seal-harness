import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import test from 'node:test'
import { apply } from '../lib/index.js'

test('bundled WeKnora plugin registers DSH tools and retrieves a passage over HTTP', async () => {
  const requests = []
  const server = createServer(async (request, response) => {
    let body = ''
    for await (const chunk of request) body += chunk
    requests.push({ path: request.url, method: request.method, key: request.headers['x-api-key'], body })
    response.setHeader('Content-Type', 'application/json')
    if (request.url.startsWith('/api/v1/knowledge-bases')) {
      response.end(JSON.stringify({ success: true, data: [{ id: 'kb-demo', name: 'Demo', description: '' }] }))
    } else if (request.url.startsWith('/api/v1/knowledge-search')) {
      response.end(JSON.stringify({ success: true, data: [{ id: 'chunk-1', knowledge_id: 'doc-1', knowledge_title: 'Demo document', chunk_index: 0, score: 0.9, content: '蓝色海豹喜欢星图' }] }))
    } else if (request.url.startsWith('/api/v1/knowledge/search')) {
      response.end(JSON.stringify({ success: true, data: [] }))
    } else {
      response.statusCode = 404
      response.end(JSON.stringify({ success: false, message: 'not found' }))
    }
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  try {
    const definitions = new Map()
    const routes = new Map()
    const records = new Map()
    let activeAccount = 'account-1'
    let epoch = 1
    const credentials = {
      async readRecord(key) { assert.match(key, /^seal-harness-weknora\/connection-[a-z0-9-]+$/u); return records.get(key) },
      async modifyRecord(key, update) { assert.match(key, /^seal-harness-weknora\/connection-[a-z0-9-]+$/u); records.set(key, update(records.get(key))) },
    }
    apply({
      get(name) {
        if (name === 'credentials') return credentials
        assert.equal(name, 'sealHarnessIdentity')
        return { getSession: () => ({ accountId: activeAccount, epoch }) }
      },
      effect() {},
      tools: { register(definition) { definitions.set(definition.name, definition) } },
      connection: { fetch: { register(route) { routes.set(route.path, route) } } },
    }, {
      baseUrl: `http://127.0.0.1:${server.address().port}`,
      knowledgeBaseIds: ['kb-demo'],
    })
    const rpc = async (method, payload = {}) => {
      const response = await routes.get(`/api/weknora/${method}`).fetch(new Request(`http://localhost/api/weknora/${method}`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ type: 'client-request', rpcId: method, method: `weknora/${method}`, payload }),
      }))
      return (await response.json()).result
    }
    assert.deepEqual([...definitions.keys()].sort(), [
      'weknora_ask', 'weknora_list_knowledge_bases', 'weknora_read_document', 'weknora_search',
    ])
    const exec = { signal: new AbortController().signal }
    await assert.rejects(definitions.get('weknora_list_knowledge_bases').execute({}, exec), /API Key/)
    assert.equal((await rpc('status')).value.configured, false)
    const saved = await rpc('configure', { baseUrl: `http://127.0.0.1:${server.address().port}`, apiKey: 'fixture-key' })
    assert.equal(saved.value.configured, true)
    assert.equal(JSON.stringify(saved).includes('fixture-key'), false)
    const listed = await definitions.get('weknora_list_knowledge_bases').execute({}, exec)
    assert.equal(listed.knowledge_bases[0].id, 'kb-demo')
    const result = await definitions.get('weknora_search').execute({ query: '蓝色海豹喜欢什么' }, exec)
    assert.equal(result.results[0].content, '蓝色海豹喜欢星图')
    assert.equal(JSON.parse(requests.find(item => item.method === 'POST').body).knowledge_base_ids[0], 'kb-demo')
    assert.ok(requests.every(item => item.key === 'fixture-key'))
    assert.equal((await rpc('test')).value.knowledgeBaseCount, 1)
    await rpc('configure', { baseUrl: `http://127.0.0.1:${server.address().port}`, apiKey: 'replacement-key' })
    await definitions.get('weknora_search').execute({ query: '第二次检索' }, exec)
    assert.equal(requests.at(-1).key, 'replacement-key')
    const changed = await rpc('configure', { baseUrl: 'https://different.example/api/v1' })
    assert.equal(changed.value.configured, false)
    await assert.rejects(definitions.get('weknora_search').execute({ query: '第三次检索' }, exec), /API Key/)
    assert.equal(records.get('seal-harness-weknora/connection-account-1').payload.apiKey, null)
    activeAccount = 'account-2'; epoch++
    assert.equal((await rpc('status')).value.configured, false)
    activeAccount = 'account-1'; epoch++
    assert.equal((await rpc('status')).value.baseUrl, 'https://different.example/api/v1')
  } finally {
    await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
  }
})
