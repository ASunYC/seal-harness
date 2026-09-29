import test from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { Context } from '@deepseek-ai/cordis'
import LocalCredentials from '@deepseek-ai/dsh-credentials-local'
import { HostConnectionService } from '@deepseek-ai/dsh-client-connection'
import { IdentityProvider } from '../src/provider.js'
import { IdentitySession } from '../src/session.js'
import { IdentitySso, returnUri } from '../src/sso.js'
import { IdentityWecom } from '../src/wecom.js'
import { loadServices, normalizeServiceUrl } from '../src/services.js'
import * as plugin from '../src/index.js'
import { accountHomeKey } from '../src/account-home.js'

const user = id => ({ id, username: id, displayName: `用户 ${id}`, role: 'guest', status: 'active', createdAt: '2026-09-23T00:00:00Z', lastLoginAt: '2026-09-23T00:00:00Z' })
const token = (kind, id, n, expiresInSeconds = 3600) => `${Buffer.from('{"alg":"HS256"}').toString('base64url')}.${Buffer.from(JSON.stringify({ kind, sub: id, n, exp: Math.floor(Date.now() / 1000) + expiresInSeconds })).toString('base64url')}.fixture-signature`
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r }); return { promise, resolve } }

async function fixture(t) {
  const home = await mkdtemp(join(tmpdir(), 'seal-harness-identity-'))
  const context = new Context()
  await context.plugin(LocalCredentials, { dshHome: home, watch: false }).await()
  const requests = [], grants = new Map(), controls = {}
  let counter = 0
  const issue = (id, expiresInSeconds = 3600) => {
    const session = { accessToken: token('access', id, ++counter, expiresInSeconds), refreshToken: token('refresh', id, counter), user: user(id) }
    grants.set(session.accessToken, session); grants.set(session.refreshToken, session)
    return session
  }
  const server = createServer(async (request, response) => {
    let text = ''; for await (const chunk of request) text += chunk
    const body = text ? JSON.parse(text) : null, path = request.url.replace('/proxy/api/v1/auth/', '')
    requests.push({ path, method: request.method, body, authorization: request.headers.authorization })
    const reply = (value, status = 200) => response.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(value))
    if (controls[path]) return controls[path]({ reply, body, issue })
    const current = grants.get(request.headers.authorization?.replace('Bearer ', ''))
    if (path === 'login') return body.password === 'correct' ? reply(issue(body.username)) : reply({}, 401)
    if (path === 'me') return current ? reply({ user: current.user }) : reply({}, 401)
    if (path === 'refresh') {
      const previous = grants.get(body.refreshToken)
      if (!previous) return reply({}, 401)
      grants.delete(body.refreshToken)
      return reply(issue(previous.user.id))
    }
    if (path === 'logout') { grants.delete(body.refreshToken); return reply({ ok: true }) }
    if (path === 'password/change') return reply({ ok: true }, body.currentPassword === 'correct' ? 200 : 401)
    if (path === 'netauth/status') return reply({ enabled: true, desktopFlow: true })
    if (path === 'netauth/desktop/start') return reply({ authorizationUrl: 'https://example.com/login', expiresAtMs: Date.now() + 60000 })
    if (path === 'netauth/desktop/complete') return reply(issue('sso-user'))
    reply({}, 404)
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const baseUrl = `http://127.0.0.1:${server.address().port}/proxy/`
  const provider = new IdentityProvider(baseUrl)
  const identity = new IdentitySession({ provider, credentials: context.credentials })
  await identity.initialize()
  t.after(async () => { identity.dispose(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); await context.fiber.dispose(); await rm(home, { recursive: true, force: true }) })
  return { home, context, identity, provider, requests, controls, baseUrl, issue }
}

test('services preserve proxy roots, apply per-field precedence and report invalid configuration', async t => {
  const home = await mkdtemp(join(tmpdir(), 'seal-harness-services-'))
  t.after(() => rm(home, { recursive: true, force: true }))
  await writeFile(join(home, 'services.yml'), 'identityBaseUrl: https://EXAMPLE.com/tenant\nstoreBaseUrl: ""\n')
  const services = await loadServices({ home, env: {}, services: { collaborationBaseUrl: 'http://localhost:8791/proxy' } })
  assert.equal(services.getConfig().identityBaseUrl, 'https://example.com/tenant/')
  assert.equal(services.getConfig().collaborationBaseUrl, 'http://localhost:8791/proxy/')
  assert.equal(services.getConfig().storeBaseUrl, '')
  assert.deepEqual(services.getDiagnostics().entries.map(entry => entry.source), ['file', 'plugin', 'file', 'default', 'default', 'default', 'default', 'default'])
  await writeFile(join(home, 'services.yml'), 'knowledgeBaseUrl: http://localhost:19095/proxy\nknowledgeTargetType: platform\nworkflowRuntimePackDirectory: ./runtime/flow\n')
  const configured = await loadServices({ home, env: {}, services: { knowledgeTargetType: 'standalone' } })
  assert.equal(configured.getConfig().knowledgeBaseUrl, 'http://localhost:19095/proxy/')
  assert.equal(configured.getConfig().knowledgeTargetType, 'standalone')
  assert.equal(configured.getConfig().workflowRuntimePackDirectory, join(home, 'runtime/flow'))
  assert.deepEqual(configured.getDiagnostics().entries.find(entry => entry.key === 'workflowRuntimePackDirectory'), {
    key: 'workflowRuntimePackDirectory', value: join(home, 'runtime/flow'), configured: true, source: 'file',
  })
  await assert.rejects(loadServices({ home, env: {}, services: { knowledgeTargetType: 'unknown' } }), /knowledgeTargetType/)
  for (const value of ['ftp://example.com/', 'https://user:pass@example.com/', 'https://example.com/?a=b', 'https://example.com/#x', 'https://example.com/api/v1/']) assert.throws(() => normalizeServiceUrl(value))
  await assert.rejects(loadServices({ home, env: { SEAL_HARNESS_SERVICES_CONFIG: join(home, 'missing.yml') } }), /配置/)
  await writeFile(join(home, 'services.yml'), 'storeBaseUrl: 123\n')
  await assert.rejects(loadServices({ home, env: {} }), /storeBaseUrl/)
})

test('test configuration example leaves remote services disconnected by default', async () => {
  const file = fileURLToPath(new URL('../services.test.example.yml', import.meta.url))
  const services = await loadServices({ home: '/', env: { SEAL_HARNESS_SERVICES_CONFIG: file } })
  assert.deepEqual(services.getConfig(), {
    identityBaseUrl: '', collaborationBaseUrl: '', storeBaseUrl: '', mcpCenterBaseUrl: '',
    knowledgeBaseUrl: '', terminalBaseUrl: '', knowledgeTargetType: 'standalone', workflowRuntimePackDirectory: '',
  })
})

test('knowledge services persist in unified YAML, switch live and retain unrelated configuration', async t => {
  const home = await mkdtemp(join(tmpdir(), 'seal-harness-knowledge-services-'))
  t.after(() => rm(home, { recursive: true, force: true }))
  const file = join(home, 'services.yml')
  await writeFile(file, '# existing proxy\nstoreBaseUrl: https://store.example/proxy/\n')
  const services = await loadServices({ home, env: {} })
  const changes = []
  const unsubscribe = services.subscribe(config => changes.push(config.knowledgeBaseUrl))
  const [first] = await Promise.all([
    services.saveKnowledgeService({ name: '团队资料', targetType: 'platform', baseUrl: 'https://knowledge.example/team' }),
    services.saveKnowledgeService({ name: '个人资料', targetType: 'standalone', baseUrl: 'http://localhost:19095' }),
  ])
  const serviceId = first.services.find(profile => profile.name === '团队资料').id
  await services.activateKnowledgeService({ serviceId })
  assert.equal(services.getConfig().knowledgeBaseUrl, 'https://knowledge.example/team/')
  assert.equal(services.getConfig().knowledgeTargetType, 'platform')
  assert.equal(services.getConfig().storeBaseUrl, 'https://store.example/proxy/')
  assert.equal(changes.at(-1), 'https://knowledge.example/team/')
  const reopened = await loadServices({ home, env: {} })
  assert.equal(reopened.getKnowledgeConfiguration().services.length, 3)
  assert.equal(reopened.getKnowledgeConfiguration().activeServiceId, serviceId)
  assert.match(await readFile(file, 'utf8'), /# existing proxy/)
  await services.deleteKnowledgeService({ serviceId })
  assert.equal(services.getKnowledgeConfiguration().activeServiceId, 'default')
  assert.equal(services.getDiagnostics().entries.find(entry => entry.key === 'knowledgeBaseUrl').source, 'default')
  unsubscribe()
})

test('password protocol, credentials persistence, automatic startup restore and local logout', async t => {
  const { identity, provider, context, requests, home } = await fixture(t)
  await assert.rejects(identity.login({ username: 'one', password: 'wrong' }), { code: 'invalidCredentials' })
  await identity.login({ username: 'one', password: 'correct' })
  assert.equal(identity.getStatus().persisted, true)
  const snapshot = identity.getSession()
  assert.equal(snapshot instanceof Promise, false)
  assert.deepEqual(JSON.parse(snapshot.accountId), [provider.baseUrl, 'one'])
  const file = await readFile(join(home, '.credentials.yaml'), 'utf8')
  assert.match(file, /seal-harness-identity/)
  const reopened = new IdentitySession({ provider, credentials: context.credentials })
  await reopened.initialize()
  assert.equal(reopened.getStatus().saved, true)
  assert.equal(reopened.getSession().subject, 'one')
  await reopened.me()
  await assert.rejects(reopened.changePassword({ currentPassword: 'incorrect', newPassword: 'new123', confirmPassword: 'new123' }), { code: 'passwordCurrentInvalid' })
  await reopened.changePassword({ currentPassword: 'correct', newPassword: 'new123', confirmPassword: 'new123' })
  assert.deepEqual(requests.findLast(request => request.path === 'password/change').body, { currentPassword: 'correct', newPassword: 'new123' })
  await reopened.logout()
  assert.equal(reopened.getSession(), null)
  assert.equal(await context.credentials.readRecord(reopened.key), undefined)
  assert.match(requests.findLast(request => request.path === 'logout').authorization, /^Bearer ey/)
  reopened.dispose()
  await identity.login({ username: 'one', password: 'correct', remember: false })
  assert.equal(identity.getStatus().persisted, false)
  assert.equal(await context.credentials.readRecord(identity.key), undefined, 'explicit opt-out clears saved login')
})

test('a login in the wrong Home remains memory-only until the native handoff', async t => {
  const { provider, context } = await fixture(t)
  const scoped = new IdentitySession({ provider, credentials: context.credentials, canPersist: () => false })
  t.after(() => scoped.dispose())
  await scoped.initialize()
  await scoped.login({ username: 'one', password: 'correct', remember: true })
  assert.equal(scoped.getStatus().persisted, false)
  assert.equal(await context.credentials.readRecord(scoped.key), undefined)
  const handoff = scoped.exportHandoff()
  assert.equal(handoff.user.id, 'one')
  handoff.user.id = 'changed'
  assert.equal(scoped.getStatus().user.id, 'one')
})

test('250 Platform users use the configured identity root without falling back to production', async t => {
  const { home, context, baseUrl } = await fixture(t)
  const services = await loadServices({ home, env: {}, services: { identityBaseUrl: 'http://10.1.128.250/' } })
  const targets = []
  const provider = new IdentityProvider(services.getConfig().identityBaseUrl, (url, init) => {
    targets.push(url.href)
    return fetch(new URL(url.pathname.slice(1), baseUrl), init)
  })
  const identity = new IdentitySession({ provider, credentials: context.credentials })
  t.after(() => identity.dispose())
  await identity.initialize()
  await identity.login({ username: 'platform-user', password: 'correct' })
  assert.equal(identity.getSession().subject, 'platform-user')
  assert.deepEqual(targets, ['http://10.1.128.250/api/v1/auth/login', 'http://10.1.128.250/api/v1/auth/me'])
})

test('startup restore tolerates network failure, retries saved login and clears rejected credentials', async t => {
  const { identity, provider, context, controls, requests } = await fixture(t)
  const reopen = async () => {
    const session = new IdentitySession({ provider, credentials: context.credentials })
    t.after(() => session.dispose())
    await session.initialize()
    return session
  }
  await identity.login({ username: 'one', password: 'correct' })
  controls.refresh = ({ reply }) => reply({}, 503)
  const offline = await reopen()
  assert.equal(offline.getSession(), null)
  assert.equal(offline.getStatus().saved, true)
  assert(offline.getStatus().restoreError)
  assert.equal(offline.getStatus().restoreErrorCode, 'serviceError')
  await assert.rejects(offline.restore(), { code: 'serviceError' })
  assert.equal(offline.getStatus().saved, true)
  assert.equal(offline.getStatus().restoreErrorCode, 'serviceError')
  delete controls.refresh
  await offline.restore()
  assert.equal(offline.getSession().subject, 'one')
  assert.equal(offline.getStatus().restoreError, null)
  assert.equal(offline.getStatus().restoreErrorCode, null)
  controls.refresh = ({ reply }) => reply({}, 401)
  const expired = await reopen()
  assert.equal(expired.getSession(), null)
  assert.equal(expired.getStatus().saved, false)
  assert(expired.getStatus().restoreError)
  assert.equal(expired.getStatus().restoreErrorCode, 'sessionExpired')
  const count = requests.filter(item => item.path === 'refresh').length
  assert.equal((await reopen()).getSession(), null)
  assert.equal(requests.filter(item => item.path === 'refresh').length, count)
  await identity.login({ username: 'one', password: 'correct', remember: false })
  assert.equal((await reopen()).getSession(), null)
  await identity.login({ username: 'one', password: 'correct' })
  await identity.logout()
  assert.equal((await reopen()).getSession(), null)
})

test('identity requests distinguish transport, timeout and HTTP failure', async () => {
  const provider = new IdentityProvider('https://example.com/', async () => { throw new TypeError('fetch failed') })
  await assert.rejects(provider.request('me'), { code: 'unreachable' })
  provider.fetch = async () => { throw new DOMException('expired', 'TimeoutError') }
  await assert.rejects(provider.request('me'), { code: 'timeout' })
  provider.fetch = async () => new Response('{}', { status: 503 })
  await assert.rejects(provider.request('me'), { code: 'serviceError' })
  assert.equal(await provider.checkAvailability(), 'reachable')
})

test('refresh is single-flight, rotates saved grant, preserves epoch, and rejects disabled users', async t => {
  const { identity, controls, context } = await fixture(t)
  await identity.login({ username: 'one', password: 'correct', remember: true })
  const before = identity.getSession(), gate = deferred(), entered = deferred()
  let count = 0
  controls.refresh = async ({ reply, issue }) => { count++; entered.resolve(); await gate.promise; reply(issue('one')) }
  const first = identity.refreshSession(), second = identity.refreshSession()
  assert.equal(first, second)
  await entered.promise; gate.resolve(); await Promise.all([first, second])
  assert.equal(count, 1)
  assert.equal(identity.getSession().epoch, before.epoch)
  assert.notEqual(identity.getSession().accessToken, before.accessToken)
  const record = await context.credentials.readRecord(identity.key)
  assert.equal(record.payload.session.accessToken, identity.getSession().accessToken)
  controls.refresh = ({ reply }) => reply({}, 503)
  await assert.rejects(identity.refreshSession(), { code: 'serviceError' })
  assert.equal(identity.getSession().epoch, before.epoch, 'temporary network failure preserves account')
  controls.refresh = ({ reply, issue }) => { const next = issue('one'); next.user.status = 'disabled'; reply(next) }
  await assert.rejects(identity.refreshSession(), { code: 'accountDisabled' })
  assert.equal(identity.getSession(), null)
  assert.equal(await context.credentials.readRecord(identity.key), undefined)
})

test('late refresh and late login cannot overwrite another account or restore its saved grant', async t => {
  const { identity, controls, context } = await fixture(t)
  controls.login = ({ reply, issue }) => reply(issue('one', 60))
  await identity.login({ username: 'one', password: 'correct', remember: true })
  delete controls.login
  const before = identity.getSession(), entered = deferred(), gate = deferred()
  controls.refresh = async ({ reply, issue }) => { entered.resolve(); await gate.promise; reply(issue('one')) }
  const oldRefresh = identity.getAccessToken()
  const rejectedRefresh = assert.rejects(oldRefresh, { code: 'staleOperation' })
  await entered.promise
  await identity.login({ username: 'two', password: 'correct', remember: true })
  gate.resolve(); await rejectedRefresh
  assert.equal(identity.getSession().subject, 'two')
  assert(identity.getSession().epoch > before.epoch)
  assert.equal((await context.credentials.readRecord(identity.key)).payload.session.user.id, 'two')
  const loginGate = deferred(), loginEntered = deferred()
  controls.login = async ({ reply, issue }) => { loginEntered.resolve(); await loginGate.promise; reply(issue('late')) }
  const lateLogin = identity.login({ username: 'late', password: 'correct', remember: true })
  const rejectedLogin = assert.rejects(lateLogin, { code: 'staleOperation' })
  await loginEntered.promise; await identity.logout(); loginGate.resolve(); await rejectedLogin
  assert.equal(identity.getSession(), null)
  assert.equal(await context.credentials.readRecord(identity.key), undefined)
})

test('getAccessToken reuses valid JWTs and shares refresh near or after exp without changing epoch', async t => {
  const { identity, controls, requests } = await fixture(t)
  await assert.rejects(identity.getAccessToken(), { code: 'sessionExpired' })
  await identity.login({ username: 'one', password: 'correct' })
  const valid = identity.getSession()
  assert.deepEqual(await Promise.all([identity.getAccessToken(), identity.getAccessToken()]), [valid.accessToken, valid.accessToken])
  assert.equal(requests.filter(request => request.path === 'refresh').length, 0)
  for (const expiresInSeconds of [60, -60]) {
    controls.login = ({ reply, issue }) => reply(issue('one', expiresInSeconds))
    await identity.login({ username: 'one', password: 'correct' })
    const before = identity.getSession(), gate = deferred(), entered = deferred()
    let refreshes = 0
    controls.refresh = async ({ reply, issue }) => { refreshes++; entered.resolve(); await gate.promise; reply(issue('one')) }
    const first = identity.getAccessToken(), second = identity.getAccessToken()
    await entered.promise; gate.resolve()
    const results = await Promise.all([first, second])
    assert.equal(refreshes, 1)
    assert.equal(results[0], results[1])
    assert.notEqual(results[0], before.accessToken)
    assert.equal(identity.getSession().epoch, before.epoch)
    await identity.refreshSession()
    assert.equal(refreshes, 2, 'explicit refresh stays forced even with an unexpired access token')
    assert.equal(identity.getSession().epoch, before.epoch)
  }
})

test('SSO reuses the desktop protocol and exchanges one callback into the current identity', async t => {
  const { identity, provider, requests } = await fixture(t)
  const opened = []
  const sso = new IdentitySso({ identity, provider, browser: { openExternal: async url => opened.push(url) } })
  await sso.start()
  assert.equal(opened[0], 'https://example.com/login')
  const start = requests.find(request => request.path === 'netauth/desktop/start').body
  assert.equal(start.returnUri, returnUri)
  await sso.callback(`${returnUri}?state=${start.state}&ticket=fixture-ticket`)
  assert.equal(identity.getSession().subject, 'sso-user')
  assert.equal(identity.getStatus().persisted, true, 'SSO remembers by default')
  assert.equal(sso.getStatus().phase, 'idle')
  const complete = requests.find(request => request.path === 'netauth/desktop/complete').body
  assert.equal(complete.state, start.state)
  assert(complete.codeVerifier)
  await assert.rejects(sso.callback(`${returnUri}?state=${start.state}&ticket=fixture-ticket`), { code: 'invalidCallback' })
})

test('SSO allows opting out of persistence while waiting for authentication', async t => {
  const { identity, provider, requests } = await fixture(t)
  const sso = new IdentitySso({ identity, provider, browser: { openExternal: async () => {} } })
  assert.throws(() => sso.setRemember(false), { code: 'staleOperation' })
  await sso.start()
  sso.setRemember(false)
  const { state } = requests.findLast(item => item.path === 'netauth/desktop/start').body
  await sso.callback(`${returnUri}?state=${state}&ticket=fixture-ticket`)
  assert.equal(identity.getSession().subject, 'sso-user')
  assert.equal(identity.getStatus().persisted, false)
  assert.throws(() => sso.setRemember(true), { code: 'staleOperation' })
})

test('SSO availability follows the selected Platform status rather than desktop capability alone', async t => {
  const { identity, provider, controls } = await fixture(t)
  const noBrowser = new IdentitySso({ identity, provider })
  assert.equal((await noBrowser.refreshAvailability()).enabled, false)
  assert.equal(noBrowser.getStatus().reason, 'ssoUnavailable')
  const sso = new IdentitySso({ identity, provider, browser: { openExternal: async () => {} } })
  controls['netauth/status'] = ({ reply }) => reply({ enabled: false, desktopFlow: true })
  assert.equal((await sso.refreshAvailability()).enabled, false)
  controls['netauth/status'] = ({ reply }) => reply({ enabled: true, desktopFlow: true })
  assert.equal((await sso.refreshAvailability()).enabled, true)
  controls['netauth/status'] = ({ reply }) => reply({}, 503)
  assert.equal((await sso.refreshAvailability()).enabled, false)
})

test('WeCom native completion enters the same identity and cancellation discards a late result', async t => {
  const { identity, provider } = await fixture(t)
  const wecomProvider = { baseUrl: 'https://private.example.com/tenant/' }
  const issued = await provider.login({ username: 'wecom-user', password: 'correct' })
  let nativeOptions, aborted = false, completion = deferred()
  const wecom = new IdentityWecom({ identity, provider: wecomProvider, request: async () => ({ status: 200 }), runtime: { openLoginWindow: (options, signal) => {
    nativeOptions = options
    signal.addEventListener('abort', () => { aborted = true })
    return completion.promise
  } } })
  const accepted = deferred(), unsubscribe = identity.subscribe(() => { if (identity.getSession()) accepted.resolve() })
  t.after(unsubscribe)
  assert.equal((await wecom.start()).phase, 'waiting')
  assert.equal(nativeOptions.url, new URL('internal/auth/wecom-probe', wecomProvider.baseUrl).href)
  assert.equal(nativeOptions.completionUrl, new URL('api/v1/auth/wecom/complete', wecomProvider.baseUrl).href)
  assert.deepEqual([nativeOptions.embedded?.width, nativeOptions.embedded?.height], [320, 380], 'WeCom uses the login-page native view')
  assert(nativeOptions.embedded.allowedOrigins.includes('https://login.work.weixin.qq.com'))
  assert(nativeOptions.embedded.allowedOrigins.includes('https://private.example.com'))
  assert(!nativeOptions.embedded.allowedOrigins.includes('https://agent.geovisearth.com'))
  completion.resolve({ ...issued, redirectPath: '/' })
  await accepted.promise
  assert.equal(identity.getSession().subject, 'wecom-user')
  assert.equal(identity.getStatus().persisted, true)
  completion = deferred()
  await wecom.start({ embedded: false })
  assert.equal(Object.hasOwn(nativeOptions, 'embedded'), false, 'main-panel login uses the standalone native window')
  wecom.cancel()
  assert.equal(aborted, true)
  completion.resolve(issued)
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(identity.getSession(), null)
  assert.equal(wecom.getStatus().phase, 'idle')
})

test('WeCom updates persistence without replacing QR and restarting discards the old completion', async t => {
  const { identity, provider, context } = await fixture(t)
  const issued = await provider.login({ username: 'wecom-user', password: 'correct' })
  const windows = []
  const wecom = new IdentityWecom({ identity, provider, request: async () => ({ status: 200 }), runtime: {
    openLoginWindow: (options, signal) => {
      const completion = deferred()
      windows.push({ signal, completion })
      return completion.promise
    },
  } })
  assert.throws(() => wecom.setRemember(false), { code: 'staleOperation' })
  let accepted = deferred()
  const unsubscribe = identity.subscribe(() => { if (identity.getSession()) accepted.resolve() })
  t.after(unsubscribe)
  await wecom.start()
  wecom.setRemember(false)
  assert.equal(windows.length, 1)
  windows[0].completion.resolve(issued)
  await accepted.promise
  assert.equal(identity.getStatus().persisted, false)
  assert.equal(await context.credentials.readRecord(identity.key), undefined)
  assert.throws(() => wecom.setRemember(true), { code: 'staleOperation' })

  await wecom.start({ remember: false })
  await wecom.start({ remember: false })
  assert.equal(windows.length, 3)
  assert.equal(windows[1].signal.aborted, true, 'refresh closes the old native login')
  windows[1].completion.resolve(issued)
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(identity.getSession(), null, 'old QR completion cannot log in')
  wecom.setRemember(true)
  accepted = deferred()
  windows[2].completion.resolve(issued)
  await accepted.promise
  assert.equal(identity.getStatus().persisted, true)
  assert.equal((await context.credentials.readRecord(identity.key)).kind, 'grant')
})

test('WeCom probes the configured identity root and keeps redirects and origins bounded', async () => {
  const calls = []
  const runtime = { openLoginWindow: async () => ({}) }
  const identity = { beginExternalLogin: async () => { throw new Error('login should not start') } }
  const request = async (url, init) => { calls.push({ url, init }); return { status: 200 } }
  const provider = { baseUrl: 'http://10.1.128.250/tenant/' }
  const wecom = new IdentityWecom({ provider, identity, runtime, request })
  assert.equal((await wecom.refreshAvailability()).enabled, true)
  assert.equal(calls[0].url, 'http://10.1.128.250/tenant/api/v1/auth/wecom/probe/config')
  assert.equal(calls[0].init.redirect, 'manual')
  const noWindow = new IdentityWecom({ provider, identity, request })
  assert.equal((await noWindow.refreshAvailability()).enabled, false)
  const unavailable = new IdentityWecom({ provider, identity, runtime, request: async () => ({ status: 302 }) })
  assert.equal((await unavailable.refreshAvailability()).enabled, false)
  const offline = new IdentityWecom({ provider, identity, runtime, request: async () => { throw new Error('network') } })
  assert.equal((await offline.refreshAvailability()).enabled, false)
  await assert.rejects(offline.start(), { code: 'wecomUnavailable' })
  let canceled = false
  const withBody = new IdentityWecom({ provider, identity, runtime, request: async () => ({ status: 200, body: { cancel: async () => { canceled = true } } }) })
  await withBody.refreshAvailability()
  assert.equal(canceled, true, 'probe response body is discarded')
})

test('availability treats every HTTP response as reachable and sends no credentials', async t => {
  const { provider, requests, controls } = await fixture(t)
  for (const status of [401, 404, 503]) {
    controls.me = ({ reply }) => reply({}, status)
    assert.equal(await provider.checkAvailability(), 'reachable')
  }
  assert(requests.every(request => request.path === 'me' && !request.authorization && request.body === null))
  let init, target
  const redirected = new IdentityProvider('https://example.com/tenant/', async (url, options) => { target = url; init = options; return new Response(null, { status: 302 }) })
  assert.equal(await redirected.checkAvailability(), 'reachable')
  assert.equal(target.href, 'https://example.com/tenant/api/v1/auth/me')
  assert.equal(init.redirect, 'manual')
  assert.equal(init.credentials, 'omit')
  const offline = new IdentityProvider(provider.baseUrl, async () => { throw new TypeError('network') })
  assert.equal(await offline.checkAvailability(), 'unreachable')
  assert.equal(await new IdentityProvider('').checkAvailability(), 'notConfigured')
  const canceled = new AbortController()
  canceled.abort()
  assert.equal(await provider.checkAvailability(canceled.signal), 'unreachable')
  controls.me = () => {}
  const started = Date.now()
  assert.equal(await provider.checkAvailability(), 'unreachable')
  assert(Date.now() - started < 6500, 'probe times out without waiting for a response body')
})

test('real DSH Host connection loads identity/services before consumers and unregisters routes', async t => {
  const { context, home, baseUrl, requests } = await fixture(t)
  const priorHome = process.env.DSH_HOME; process.env.DSH_HOME = home
  t.after(() => { if (priorHome === undefined) delete process.env.DSH_HOME; else process.env.DSH_HOME = priorHome })
  context.provide('webServer', { register: () => () => {} })
  const connection = new HostConnectionService(context, [], { isAuthenticated: () => true })
  const runtime = context.plugin(plugin, { services: { identityBaseUrl: baseUrl } })
  await runtime.await()
  assert(context.get('sealHarnessServices'))
  assert.equal(context.get('sealHarnessIdentity').getSession(), null)
  const guarded = async path => {
    let delegated = false, status = null
    const response = { writeHead(code) { status = code; return this }, end() {} }
    await context.waterfall('connection/request', { url: path }, response, async () => { delegated = true })
    return { delegated, status }
  }
  assert.deepEqual(await guarded('/api/seal-harness-identity/status'), { delegated: true, status: null })
  assert.deepEqual(await guarded('/api/session/list'), { delegated: true, status: null })
  const rpc = async (action, payload = {}) => {
    const method = `seal-harness-identity/${action}`
    const result = await connection.createSharedFetchHandler('/api').fetch(new Request(`http://localhost/api/${method}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ type: 'client-request', rpcId: 'fixture', method, payload }) }))
    return result.status === 200 ? (await result.json()).result : result.status
  }
  assert.equal((await rpc('status')).value.user, null)
  assert.equal(requests.length, 0, 'local status does not probe the identity server')
  assert.equal((await rpc('availability')).value.server, 'reachable')
  assert.equal(requests.length, 1)
  const result = await rpc('login', { username: 'host', password: 'correct', remember: false })
  assert.equal(result.ok, true)
  assert.equal(result.value.user.id, 'host')
  assert.equal((await rpc('sso/cancel')).ok, true)
  assert.equal((await rpc('wecom/cancel')).ok, true)
  assert.equal((await rpc('wecom/remember', { remember: 'false' })).error.code, 'invalidInput')
  assert.equal((await rpc('wecom/remember', { remember: false })).error.code, 'staleOperation')
  assert.equal((await rpc('status')).value.user.id, 'host', 'late cancellation does not log out an established session')
  assert.deepEqual(await guarded('/api/session/list'), { delegated: true, status: null })
  assert(!Object.hasOwn(result.value, 'accessToken'))
  assert.equal((await rpc('status')).value.services.entries.length, 8)
  assert.equal((await rpc('me')).value.user.id, 'host')
  assert.equal((await rpc('refresh')).ok, true)
  assert.equal((await rpc('password/change', { currentPassword: 'correct', newPassword: 'new123', confirmPassword: 'new123' })).value.changed, true)
  assert.equal((await rpc('logout')).ok, true)
  assert.deepEqual(await guarded('/api/session/list'), { delegated: true, status: null })
  assert.equal((await rpc('restore')).error.code, 'sessionExpired')
  assert.equal((await rpc('sso/start', { remember: false })).error.code, 'ssoUnavailable')
  assert.equal((await rpc('wecom/start', { remember: false })).error.code, 'wecomUnavailable')
  const fetchIdentity = request => connection.createSharedFetchHandler('/api').fetch(request)
  assert.equal((await fetchIdentity(new Request('http://localhost/api/seal-harness-identity/status', { method: 'POST', body: '{}' }))).status, 415)
  assert.equal((await fetchIdentity(new Request('http://localhost/api/seal-harness-identity/status', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' }))).status, 400)
  assert.equal((await fetchIdentity(new Request('http://localhost/api/seal-harness-identity/status', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ type: 'client-request', rpcId: 'fixture', method: 'seal-harness-identity/login', payload: {} }) }))).status, 400)
  await runtime.dispose()
  assert.equal(await rpc('status'), 404)
  assert.equal(context.get('sealHarnessIdentity'), undefined)
  assert.equal(context.get('sealHarnessServices'), undefined)
})

test('offline entry leaves an account Home before releasing the local workbench', async t => {
  const { context, home, baseUrl } = await fixture(t)
  const switches = []
  context.provide('desktopRuntime', {
    identityHomeStatus: async () => ({ enabled: true, key: accountHomeKey(baseUrl, 'owner'), baseHome: home }),
    takeIdentityHandoff: async () => null,
    switchIdentityHome: async (...args) => { switches.push(args) },
  })
  const connection = new HostConnectionService(context, [], { isAuthenticated: () => true })
  const mounted = context.plugin(plugin, { services: { identityBaseUrl: baseUrl } })
  await mounted.await()
  const method = 'seal-harness-identity/offline'
  const response = await connection.createSharedFetchHandler('/api').fetch(new Request(`http://localhost/api/${method}`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ type: 'client-request', rpcId: 'fixture', method, payload: {} }),
  }))
  assert.deepEqual((await response.json()).result.value, { switchingHome: true })
  assert.deepEqual(switches, [[null]], 'offline workbench must be reopened from the neutral login Home')
  await mounted.dispose()
})

test('login Home cannot expose DSH sessions and requests a verified account switch', async t => {
  const { context, home, baseUrl } = await fixture(t)
  const previous = process.env.DSH_HOME; process.env.DSH_HOME = join(home, 'login')
  t.after(() => { if (previous === undefined) delete process.env.DSH_HOME; else process.env.DSH_HOME = previous })
  const switches = []
  context.provide('desktopRuntime', {
    identityHomeStatus: async () => ({ enabled: true, key: null, baseHome: home }),
    takeIdentityHandoff: async () => null,
    switchIdentityHome: async (...args) => { switches.push(args) },
  })
  context.provide('webServer', { register: () => () => {} })
  const connection = new HostConnectionService(context, [], { isAuthenticated: () => true })
  const mounted = context.plugin(plugin, { services: { identityBaseUrl: baseUrl } })
  await mounted.await()
  const method = 'seal-harness-identity/login'
  const response = await connection.createSharedFetchHandler('/api').fetch(new Request(`http://localhost/api/${method}`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ type: 'client-request', rpcId: 'fixture', method, payload: { username: 'host', password: 'correct', remember: true } }),
  }))
  const result = (await response.json()).result
  assert.equal(result.ok, true)
  assert.equal(result.value.user, null, 'the old Host must not release the workbench')
  assert.equal(switches.length, 1)
  assert.equal(switches[0][1].session.user.id, 'host')
  assert.equal(switches[0][1].remember, true)
  await mounted.dispose()
})

test('failed account Home switch revokes the temporary login and stays signed out', async t => {
  const { context, home, baseUrl } = await fixture(t)
  const previous = process.env.DSH_HOME; process.env.DSH_HOME = join(home, 'login')
  t.after(() => { if (previous === undefined) delete process.env.DSH_HOME; else process.env.DSH_HOME = previous })
  context.provide('desktopRuntime', {
    identityHomeStatus: async () => ({ enabled: true, key: null, baseHome: home }),
    takeIdentityHandoff: async () => null,
    switchIdentityHome: async () => { throw new Error('disk full') },
  })
  context.provide('webServer', { register: () => () => {} })
  const connection = new HostConnectionService(context, [], { isAuthenticated: () => true })
  const mounted = context.plugin(plugin, { services: { identityBaseUrl: baseUrl } })
  await mounted.await()
  const method = 'seal-harness-identity/login'
  const response = await connection.createSharedFetchHandler('/api').fetch(new Request(`http://localhost/api/${method}`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ type: 'client-request', rpcId: 'fixture', method, payload: { username: 'host', password: 'correct' } }),
  }))
  assert.equal((await response.json()).result.error.code, 'homeSwitchFailed')
  assert.equal(context.get('sealHarnessIdentity').getSession(), null)
  await mounted.dispose()
})

test('account Home consumes a one-time handoff, opens only its owner, and logout returns to login Home', async t => {
  const { context, home, baseUrl, issue } = await fixture(t)
  const previous = process.env.DSH_HOME; process.env.DSH_HOME = join(home, 'accounts', 'fixture')
  t.after(() => { if (previous === undefined) delete process.env.DSH_HOME; else process.env.DSH_HOME = previous })
  const key = accountHomeKey(baseUrl, 'owner'), switches = []
  context.provide('desktopRuntime', {
    identityHomeStatus: async () => ({ enabled: true, key, baseHome: home }),
    takeIdentityHandoff: async () => ({ baseUrl, userId: 'owner', session: issue('owner'), remember: true }),
    switchIdentityHome: async (...args) => { switches.push(args) },
  })
  context.provide('webServer', { register: () => () => {} })
  const connection = new HostConnectionService(context, [], { isAuthenticated: () => true })
  const mounted = context.plugin(plugin, { services: { identityBaseUrl: baseUrl } })
  await mounted.await()
  const rpc = async (action, payload = {}) => {
    const method = `seal-harness-identity/${action}`
    const response = await connection.createSharedFetchHandler('/api').fetch(new Request(`http://localhost/api/${method}`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'client-request', rpcId: 'fixture', method, payload }),
    }))
    return (await response.json()).result
  }
  assert.equal((await rpc('status')).value.user.id, 'owner')
  let delegated = false
  await context.waterfall('connection/request', { url: '/api/session/list' }, { writeHead() { return this }, end() {} }, () => { delegated = true })
  assert.equal(delegated, true)
  assert.equal((await rpc('logout')).ok, true)
  assert.deepEqual(switches, [[null]])
  await mounted.dispose()
})

test('logging another user into an existing account Home never exposes its sessions', async t => {
  const { context, home, baseUrl } = await fixture(t)
  const previous = process.env.DSH_HOME; process.env.DSH_HOME = join(home, 'accounts', 'owner')
  t.after(() => { if (previous === undefined) delete process.env.DSH_HOME; else process.env.DSH_HOME = previous })
  const switches = []
  context.provide('desktopRuntime', {
    identityHomeStatus: async () => ({ enabled: true, key: accountHomeKey(baseUrl, 'owner'), baseHome: home }),
    takeIdentityHandoff: async () => null,
    switchIdentityHome: async (...args) => { switches.push(args) },
  })
  context.provide('webServer', { register: () => () => {} })
  const connection = new HostConnectionService(context, [], { isAuthenticated: () => true })
  const mounted = context.plugin(plugin, { services: { identityBaseUrl: baseUrl } })
  await mounted.await()
  const method = 'seal-harness-identity/login'
  const response = await connection.createSharedFetchHandler('/api').fetch(new Request(`http://localhost/api/${method}`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ type: 'client-request', rpcId: 'fixture', method, payload: { username: 'visitor', password: 'correct', remember: true } }),
  }))
  assert.equal((await response.json()).result.value.user, null)
  assert.equal(switches[0][0], accountHomeKey(baseUrl, 'visitor'))
  assert.equal(switches[0][1].session.user.id, 'visitor')
  await mounted.dispose()
})
