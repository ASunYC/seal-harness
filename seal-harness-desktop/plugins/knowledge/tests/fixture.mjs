import { createServer } from 'node:http'
import { apply as applyWeknora } from '../../weknora/src/index.js'
import { apply as applyKnowledge } from '../src/index.js'

export async function fixture(t) {
  const requests = [], accounts = new Map(), services = new Map(), routes = new Map(), disposers = []
  let current = { accountId: 'owner-1', epoch: 1 }, denied = false, delayed = null
  const server = createServer(async (request, response) => {
    const chunks = []
    for await (const chunk of request) chunks.push(chunk)
    const raw = Buffer.concat(chunks).toString('utf8')
    const path = new URL(request.url, 'http://fixture').pathname.replace('/api/v1', '')
    const key = request.headers['x-api-key']
    requests.push({ path, method: request.method, key, raw, type: request.headers['content-type'] })
    response.setHeader('Content-Type', 'application/json')
    if (denied === true || (denied === 'readonly' && (path === '/models' || (request.method !== 'GET' && path !== '/knowledge-search')))) { response.writeHead(403); response.end(JSON.stringify({ message: `secret ${key}` })); return }
    if (delayed) { const wait = delayed; delayed = null; await wait }
    if (path === '/knowledge-bases/redirect') { response.writeHead(302, { Location: '/api/v1/leaked' }); response.end('{}'); return }
    const state = accounts.get(key) ?? { bases: [], documents: [] }
    accounts.set(key, state)
    const json = raw && request.headers['content-type']?.startsWith('application/json') ? JSON.parse(raw) : {}
    let data
    if (path === '/knowledge-bases' && request.method === 'GET') data = state.bases
    else if (path === '/knowledge-bases' && request.method === 'POST') { data = { id: 'kb-1', ...json, private_fixture: 'backend-secret' }; state.bases.push(data) }
    else if (path === '/knowledge-bases/kb-1' && request.method === 'PUT') { Object.assign(state.bases[0], json); data = state.bases[0] }
    else if (path === '/knowledge-bases/kb-1' && request.method === 'DELETE') { state.bases = []; data = {} }
    else if (path === '/models') data = [{ id: 'embed-1', name: 'Embedding', type: 'Embedding', parameters: { api_key: 'model-secret' } }, { id: 'chat-1', type: 'KnowledgeQA' }]
    else if (path === '/knowledge-bases/kb-1/knowledge' && request.method === 'GET') { response.end(JSON.stringify({ success: true, data: state.documents, total: state.documents.length })); return }
    else if (path === '/knowledge-bases/kb-1/knowledge/manual') { data = { id: 'doc-1', title: json.title, content: json.content, parse_status: 'pending' }; state.documents.push(data) }
    else if (path === '/knowledge-bases/kb-1/knowledge/file') { data = { id: 'file-1', file_name: 'guide.txt', parse_status: 'pending' }; state.documents.push(data) }
    else if (path === '/knowledge/doc-1' && request.method === 'GET') data = state.documents.find(item => item.id === 'doc-1')
    else if (path === '/knowledge/doc-1' && request.method === 'DELETE') { state.documents = state.documents.filter(item => item.id !== 'doc-1'); data = {} }
    else if (path === '/knowledge/doc-1/reparse') { state.documents[0].parse_status = 'completed'; data = {} }
    else if (path === '/chunks/doc-1') data = [{ id: 'chunk-1', content: '海豹在这里查找星图' }]
    else if (path === '/knowledge-search') data = [{ id: 'chunk-1', knowledge_id: 'doc-1', knowledge_title: '指南', score: 0.9, content: '海豹在这里查找星图' }]
    else { response.writeHead(404); response.end('{}'); return }
    response.end(JSON.stringify({ success: true, data }))
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const baseUrl = `http://127.0.0.1:${server.address().port}/api/v1`
  const identity = { getSession: () => current }
  const records = new Map()
  const ctx = {
    get: name => name === 'credentials' ? {
      readRecord: async key => records.get(key),
      modifyRecord: async (key, update) => records.set(key, update(records.get(key))),
    } : identity,
    provide: (name, value) => services.set(name, value),
    effect: effect => disposers.push(effect()),
    tools: { register() {} },
    connection: { fetch: { register: route => routes.set(route.path, route) } },
  }
  applyWeknora(ctx, { baseUrl, requestTimeoutMs: 2000 })
  ctx.sealHarnessWeknora = services.get('sealHarnessWeknora')
  applyKnowledge(ctx)
  const rpc = async (action, payload = {}, prefix = 'seal-harness-knowledge') => {
    const endpoint = `${prefix}/${action}`
    const response = await routes.get(`/api/${endpoint}`).fetch(new Request(`http://localhost/api/${endpoint}`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'client-request', rpcId: 'fixture', method: endpoint, payload }),
    }))
    return (await response.json()).result
  }
  const configure = key => rpc('configure', { baseUrl, apiKey: key }, 'weknora')
  t.after(async () => { for (const dispose of disposers) dispose?.(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)) })
  return { services, routes, requests, records, baseUrl, rpc, configure, setAccount(accountId) { current = accountId ? { accountId, epoch: (current?.epoch ?? 0) + 1 } : null }, deny(value) { denied = value }, delay(promise) { delayed = promise } }
}
