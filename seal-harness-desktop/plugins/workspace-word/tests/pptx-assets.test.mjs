import assert from 'node:assert/strict'
import { once } from 'node:events'
import { createServer } from 'node:http'
import test from 'node:test'
import { Context } from '@deepseek-ai/cordis'
import { apply, inject } from '@deepseek-ai/dsh-client-connection'
import { registerPptxAssets } from '../src/pptx-assets.js'
import { pptxAssetBase } from '../src/pptx-asset-path.js'

test('the authenticated desktop HTTP bridge serves the Office preview modules and WASM', async t => {
  const ctx = new Context()
  const routes = new Map()
  ctx.provide('credentials', { modifyRecord: (_key, update) => update(undefined) })
  ctx.provide('webServer', {
    host: '127.0.0.1', protocol: 'http:', register(route) {
      routes.set(route.path, route)
      return () => routes.delete(route.path)
    },
  })
  const fiber = ctx.plugin({ inject: [...inject], apply })
  t.after(() => fiber.dispose())
  await fiber.await()
  const connection = ctx.get('connection')
  registerPptxAssets(connection.fetch)
  let bridgeError
  const server = createServer(async (req, res) => {
    if (!req.url.startsWith('/api/')) {
      connection.authorizeIndex(req, res)
      return
    }
    try { await routes.get('/api').handler(req, res) }
    catch (error) { bridgeError = error; res.writeHead(500).end() }
  })
  t.after(() => new Promise(resolve => server.close(resolve)))
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const base = `http://127.0.0.1:${server.address().port}`
  const login = await fetch(connection.authenticatedUrl(base), { redirect: 'manual' })
  assert.equal(login.status, 303)
  const headers = { cookie: login.headers.get('set-cookie').split(';')[0] }
  for (const [name, mime] of [['pptx.mjs', 'text/javascript'], ['pptx_parser_bg.wasm', 'application/wasm'],
    ['xlsx.mjs', 'text/javascript'], ['xlsx_parser_bg.wasm', 'application/wasm']]) {
    const response = await fetch(`${base}${pptxAssetBase}${name}`, { headers })
    assert.ifError(bridgeError)
    assert.equal(response.status, 200)
    assert(response.headers.get('Content-Type').startsWith(mime))
    assert((await response.arrayBuffer()).byteLength > 0)
  }
  const privateFile = await fetch(`${base}${pptxAssetBase}package.json`, { headers })
  assert.equal(privateFile.status, 404)
})
