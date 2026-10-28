import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import test from 'node:test'
import { managementRequest } from '../src/management.js'

test('management transport bounds responses, rejects malformed JSON and keeps failures secret-free', async t => {
  const server = createServer((request, response) => {
    response.setHeader('Content-Type', 'application/json')
    if (request.url.endsWith('/huge')) { response.setHeader('Content-Length', 9 * 1024 * 1024); response.end('{}') }
    else if (request.url.endsWith('/invalid')) response.end('fixture-api-key must never appear in errors')
    else if (request.url.endsWith('/failure')) response.end(JSON.stringify({ success: false, message: 'fixture-api-key' }))
    else if (request.url.endsWith('/empty')) { response.writeHead(204); response.end() }
    else { response.writeHead(404); response.end('{}') }
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)) })
  const config = { baseUrl: `http://127.0.0.1:${server.address().port}/api/v1`, apiKey: 'fixture-api-key', requestTimeoutMs: 1000 }
  const signal = new AbortController().signal
  for (const [path, code] of [['/huge', 'responseTooLarge'], ['/invalid', 'invalidResponse'], ['/failure', 'serviceError']]) {
    await assert.rejects(managementRequest(config, path, {}, signal), error => error.code === code && !error.message.includes(config.apiKey))
  }
  assert.deepEqual(await managementRequest(config, '/empty', {}, signal), { success: true })
  await assert.rejects(managementRequest(config, '/../outside', {}, signal), error => error.code === 'invalidPath')
})
