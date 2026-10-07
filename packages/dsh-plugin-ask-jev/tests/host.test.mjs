import test from 'node:test'
import assert from 'node:assert/strict'
import * as plugin from '../src/index.js'

test('DSH Host routes keep API keys out of Client responses and call the selected model', async t => {
  const previousFetch = globalThis.fetch
  let record, external
  globalThis.fetch = async (url, options) => {
    external = { url, options }
    return Response.json({ model: 'jev-1', answers: { decision: { type: 'noul', noul: .7 } } })
  }
  t.after(() => { globalThis.fetch = previousFetch })
  const routes = new Map(), cleanup = [], tools = new Map()
  const credentials = {
    async readRecord() { return record },
    async modifyRecord(_key, operation) { record = await operation(record); return record },
  }
  const ctx = {
    get: name => name === 'credentials' ? credentials : name === 'tools' ? { register(tool) { tools.set(tool.name, tool); return () => tools.delete(tool.name) } } : undefined,
    effect: callback => cleanup.push(callback()),
    connection: { fetch: { register: route => routes.set(route.path, route) } },
    logger: { warn() {} },
  }
  plugin.apply(ctx)
  t.after(() => cleanup.forEach(dispose => dispose?.()))
  assert.deepEqual([...routes.keys()], ['/api/ask-jev/status', '/api/ask-jev/configure', '/api/ask-jev/decide'])
  async function rpc(action, payload, headers = { 'content-type': 'application/json' }) {
    const method = `ask-jev/${action}`
    const request = new Request(`http://localhost/api/${method}`, { method: 'POST', headers,
      body: JSON.stringify({ type: 'client-request', rpcId: `request-${action}`, method, payload }) })
    return routes.get(`/api/${method}`).fetch(request)
  }
  const configured = await (await rpc('configure', { provider: 'jev', apiKey: 'host-secret' })).json()
  assert.equal(configured.result.value.configured.jev, true)
  assert.equal(JSON.stringify(configured).includes('host-secret'), false)
  const status = await (await rpc('status', {})).json()
  assert.equal(JSON.stringify(status).includes('host-secret'), false)
  const decided = await (await rpc('decide', { question: '继续吗？', mode: 'yes_no' })).json()
  assert.equal(decided.result.value.yesProbability, .7)
  assert.equal(external.url, 'https://api.typesafe.ai/v1/systemone')
  assert.equal(external.options.headers.authorization, 'Bearer host-secret')
  const decisionTool = tools.get('ask_jev_decide')
  assert(decisionTool, 'native conversation has a decision tool')
  const toolResult = JSON.parse(await decisionTool.execute({ question: '继续吗？', mode: 'yes_no' }, { signal: new AbortController().signal }))
  assert.equal(toolResult.yesProbability, .7)
  assert.equal(JSON.stringify(toolResult).includes('host-secret'), false)
  const missing = await rpc('status', {}, { 'content-type': 'text/plain' })
  assert.equal(missing.status, 415)
})
