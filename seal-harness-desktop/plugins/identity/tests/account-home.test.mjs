import test from 'node:test'
import assert from 'node:assert/strict'
import { chmodSync, mkdtempSync, mkdirSync, lstatSync, readdirSync, symlinkSync, writeFileSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, relative, sep } from 'node:path'
import { accountHomeKey, accountHomePath, loginHomePath, ensureAccountHome, ensureLoginHome, AccountHomeState, prepareAccountHome } from '../src/account-home.js'

test('account Home is deterministic, scoped to service and user, and never uses the legacy root', () => {
  const root = mkdtempSync(join(tmpdir(), 'seal-harness-account-home-'))
  try {
    const first = accountHomePath(root, 'https://agent.geovisearth.com/', 'user/一号')
    assert.equal(first, accountHomePath(root, 'https://agent.geovisearth.com/', 'user/一号'))
    assert.notEqual(first, accountHomePath(root, 'https://agent.geovisearth.com/', 'user/二号'))
    assert.notEqual(first, accountHomePath(root, 'http://10.1.128.250/', 'user/一号'))
    assert.notEqual(first, accountHomePath(root, 'https://agent.geovisearth.com/proxy/', 'user/一号'))
    assert.equal(relative(root, first).split(/[\\/]/)[0], 'accounts')
    assert.equal(relative(root, loginHomePath(root)), 'login')
    assert.doesNotMatch(first, /user|一号|agent\.geovisearth/)
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test('product startup prepares the selected Home, profile state, renderer partition and service configuration', async t => {
  const root = mkdtempSync(join(tmpdir(), 'seal-harness-account-startup-'))
  const baseHome = join(root, 'data')
  const appData = join(root, 'desktop')
  const originalConfig = process.env.SEAL_HARNESS_SERVICES_CONFIG
  t.after(() => {
    if (originalConfig === undefined) delete process.env.SEAL_HARNESS_SERVICES_CONFIG
    else process.env.SEAL_HARNESS_SERVICES_CONFIG = originalConfig
    rmSync(root, { recursive: true, force: true })
  })
  delete process.env.SEAL_HARNESS_SERVICES_CONFIG
  const offline = prepareAccountHome({ baseHome, appData })
  assert.equal(offline.homeDir, join(baseHome, 'login'))
  assert(lstatSync(offline.homeDir).isDirectory())
  assert.equal(offline.profileUserDataDir, join(appData, 'identity-profile-state', 'login'))
  assert.equal(offline.rendererSessionPartition, 'persist:seal-harness-login')
  assert.equal(offline.homes.dataLocations().runtime.servicesConfigFile, join(baseHome, 'services.yml'))

  const grant = { baseUrl: 'https://agent.geovisearth.com/', userId: 'one' }
  const key = accountHomeKey(grant.baseUrl, grant.userId)
  await offline.homes.select(key, grant)
  process.env.SEAL_HARNESS_SERVICES_CONFIG = join(root, 'external-services.yml')
  const online = prepareAccountHome({ baseHome, appData })
  assert.equal(online.homeDir, accountHomePath(baseHome, grant.baseUrl, grant.userId))
  assert.equal(online.profileUserDataDir, join(appData, 'identity-profile-state', key))
  assert.equal(online.rendererSessionPartition, `persist:seal-harness-${key}`)
  const locations = online.homes.dataLocations()
  assert.equal(locations.online.dshHome, online.homeDir)
  assert.equal(locations.online.desktopProfileDirectory, online.profileUserDataDir)
  assert.equal(locations.runtime.servicesConfigFile, process.env.SEAL_HARNESS_SERVICES_CONFIG)
  const dialog = online.homes.dataLocationsDialog('zh')
  assert(dialog.detail.includes(`${baseHome}${sep}`))
  assert(dialog.detail.includes(`│   └── ${key}${sep}`))
  assert(dialog.detail.includes(process.env.SEAL_HARNESS_SERVICES_CONFIG))

  rmSync(online.homeDir, { recursive: true })
  assert.throws(() => prepareAccountHome({ baseHome, appData }), { code: 'ENOENT' })
})

test('account Home rejects unsafe or ambiguous identity boundaries', () => {
  const root = mkdtempSync(join(tmpdir(), 'seal-harness-account-home-'))
  try {
    assert.throws(() => accountHomePath('relative', 'https://agent.geovisearth.com/', 'one'))
    assert.throws(() => accountHomePath(root, 'file:///tmp/login', 'one'))
    assert.throws(() => accountHomePath(root, 'https://u:p@agent.geovisearth.com/', 'one'))
    assert.throws(() => accountHomePath(root, 'https://agent.geovisearth.com/?token=x', 'one'))
    assert.throws(() => accountHomePath(root, 'https://agent.geovisearth.com/', ''))
    assert.equal(relative(root, accountHomePath(root, 'https://agent.geovisearth.com/', '../')).split(/[\\/]/)[0], 'accounts')
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test('creating an account Home does not claim or copy legacy sessions', () => {
  const root = mkdtempSync(join(tmpdir(), 'seal-harness-account-home-'))
  try {
    const legacy = join(root, 'sessions')
    mkdirSync(legacy)
    writeFileSync(join(legacy, 'marker'), 'legacy conversation')
    const account = ensureAccountHome(root, 'https://agent.geovisearth.com/', 'one')
    assert(lstatSync(account).isDirectory())
    assert.deepEqual(readdirSync(account), [])
    assert.equal(readFileSync(join(legacy, 'marker'), 'utf8'), 'legacy conversation')
    assert.equal(ensureAccountHome(root, 'https://agent.geovisearth.com/', 'one'), account)
    assert.equal(ensureLoginHome(root), loginHomePath(root))
    assert.deepEqual(readdirSync(loginHomePath(root)), [])
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test('login and account Homes use ordinary directories without changing existing permissions', () => {
  const root = mkdtempSync(join(tmpdir(), 'seal-harness-account-home-'))
  try {
    if (process.platform !== 'win32') chmodSync(root, 0o755)
    assert.equal(ensureLoginHome(root), loginHomePath(root))
    assert.equal(ensureAccountHome(root, 'https://agent.geovisearth.com/', 'one'),
      accountHomePath(root, 'https://agent.geovisearth.com/', 'one'))
    if (process.platform !== 'win32') assert.equal(lstatSync(root).mode & 0o777, 0o755)
    const fresh = join(root, 'new-data-root')
    assert.equal(ensureLoginHome(fresh), loginHomePath(fresh))
    assert.equal(ensureAccountHome(join(root, 'another-new-root'), 'https://agent.geovisearth.com/', 'one'),
      accountHomePath(join(root, 'another-new-root'), 'https://agent.geovisearth.com/', 'one'))
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test('account Home can use a linked accounts directory', t => {
  const root = mkdtempSync(join(tmpdir(), 'seal-harness-account-home-'))
  try {
    const storage = join(root, 'storage')
    mkdirSync(storage)
    try { symlinkSync(storage, join(root, 'accounts'), process.platform === 'win32' ? 'junction' : 'dir') }
    catch (error) {
      if (['EPERM', 'EACCES'].includes(error.code)) { t.skip('当前系统不允许创建测试符号链接'); return }
      throw error
    }
    const account = ensureAccountHome(root, 'https://agent.geovisearth.com/', 'one')
    writeFileSync(join(account, 'marker'), 'account data')
    assert.equal(readFileSync(join(storage, accountHomeKey('https://agent.geovisearth.com/', 'one'), 'marker'), 'utf8'), 'account data')
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test('active account selection and encrypted login handoff are single-use', async () => {
  const root = mkdtempSync(join(tmpdir(), 'seal-harness-account-home-'))
  const appData = mkdtempSync(join(tmpdir(), 'seal-harness-app-data-'))
  const crypto = {
    isEncryptionAvailable: () => true,
    encryptString: text => Buffer.from(`sealed:${text}`),
    decryptString: bytes => {
      assert.match(bytes.toString(), /^sealed:/)
      return bytes.toString().slice(7)
    },
  }
  try {
    const accountKey = accountHomeKey('https://agent.geovisearth.com/', 'one')
    const state = new AccountHomeState({ baseHome: root, appData, crypto })
    assert.deepEqual(state.current(), { key: null, homeDir: loginHomePath(root) })
    const grant = { baseUrl: 'https://agent.geovisearth.com/', userId: 'one', session: { accessToken: 'fixture-access', refreshToken: 'fixture-refresh' }, remember: false }
    await state.select(accountKey, grant)
    if (process.platform !== 'win32') {
      for (const path of [root, appData, join(root, 'accounts'), state.current().homeDir, join(appData, 'identity-home')]) chmodSync(path, 0o755)
      chmodSync(join(state.current().homeDir, '.identity-handoff'), 0o644)
      chmodSync(state.stateFile, 0o644)
    }
    const next = new AccountHomeState({ baseHome: root, appData, crypto })
    assert.equal(next.current().key, accountKey)
    assert.equal(next.current().homeDir, accountHomePath(root, grant.baseUrl, grant.userId))
    assert.equal(next.assertCurrentHome(), next.current().homeDir)
    assert.deepEqual(await next.consumeHandoff(), grant)
    assert.equal(await next.consumeHandoff(), null)
    await next.clear()
    assert.equal(new AccountHomeState({ baseHome: root, appData, crypto }).current().key, null)
  } finally { rmSync(root, { recursive: true, force: true }); rmSync(appData, { recursive: true, force: true }) }
})

test('an unavailable secure store switches to the empty account Home without writing a token', async () => {
  const root = mkdtempSync(join(tmpdir(), 'seal-harness-account-home-'))
  const appData = mkdtempSync(join(tmpdir(), 'seal-harness-app-data-'))
  try {
    const key = accountHomeKey('https://agent.geovisearth.com/', 'one')
    const available = new AccountHomeState({ baseHome: root, appData, crypto: {
      isEncryptionAvailable: () => true,
      encryptString: text => Buffer.from(text), decryptString: bytes => bytes.toString(),
    } })
    await available.select(key, { baseUrl: 'https://agent.geovisearth.com/', userId: 'one', session: { refreshToken: 'stale' }, remember: false })
    const state = new AccountHomeState({ baseHome: root, appData, crypto: { isEncryptionAvailable: () => false } })
    assert.deepEqual(await state.select(key, { baseUrl: 'https://agent.geovisearth.com/', userId: 'one', session: {}, remember: false }), { handoff: false })
    assert.equal(state.current().key, key)
    assert.equal(await state.consumeHandoff(), null)
    await state.clear()
    await assert.rejects(available.select(key, { baseUrl: 'https://agent.geovisearth.com/', userId: 'other', session: {}, remember: false }))
    assert.equal(available.current().key, null)
  } finally { rmSync(root, { recursive: true, force: true }); rmSync(appData, { recursive: true, force: true }) }
})

test('data location snapshot traces offline, account, Desktop, runtime, and legacy storage without reading contents', async () => {
  const root = mkdtempSync(join(tmpdir(), 'seal-harness-account-home-'))
  const appData = mkdtempSync(join(tmpdir(), 'seal-harness-app-data-'))
  const crypto = {
    isEncryptionAvailable: () => true,
    encryptString: text => Buffer.from(text),
    decryptString: bytes => bytes.toString(),
  }
  try {
    const state = new AccountHomeState({ baseHome: root, appData, crypto })
    const offline = state.dataLocations()
    assert.equal(offline.activeScope, 'offline')
    assert.equal(offline.online, null)
    assert.equal(offline.onlineHomeTemplate, join(root, 'accounts', '<account-key>'))
    assert.equal(offline.offline.dshHome, join(root, 'login'))
    assert.equal(offline.offline.sessionsDirectory, join(root, 'login', 'sessions'))
    assert.equal(offline.offline.sessionProjectionDirectory, join(root, 'login', 'storages', 'session_projcache', 'sessions'))
    assert.equal(offline.offline.desktopProfileDirectory, join(appData, 'identity-profile-state', 'login'))
    assert.equal(offline.offline.rendererPartitionDirectory, join(appData, 'Partitions', 'seal-harness-login'))
    assert.equal(offline.runtime.identitySelectionFile, join(appData, 'identity-home', 'state.json'))
    assert.equal(offline.runtime.logsDirectory, join(appData, 'logs'))
    assert.equal(offline.runtime.crashpadDirectory, join(appData, 'Crashpad'))
    assert.equal(offline.runtime.installationIdFile, join(appData, 'identity', 'installation-id'))
    assert.equal(offline.runtime.lockFile, join(appData, 'lockfile'))
    assert.equal(offline.legacy.sessionsDirectory, join(root, 'sessions'))
    const selectedConfig = join(appData, 'selected-services.yml')
    assert.equal(new AccountHomeState({ baseHome: root, appData, crypto, servicesConfig: selectedConfig })
      .dataLocations().runtime.servicesConfigFile, selectedConfig)

    const grant = { baseUrl: 'https://agent.geovisearth.com/', userId: 'one', session: {}, remember: false }
    const key = accountHomeKey(grant.baseUrl, grant.userId)
    await state.select(key, grant)
    const online = state.dataLocations()
    assert.equal(online.activeScope, 'online')
    assert.equal(online.key, key)
    assert.equal(online.online.dshHome, join(root, 'accounts', key))
    assert.equal(online.online.credentialsFile, join(root, 'accounts', key, '.credentials.yaml'))
    assert.equal(online.online.desktopProfileDirectory, join(appData, 'identity-profile-state', key))
    assert.equal(online.online.rendererPartitionDirectory, join(appData, 'Partitions', `seal-harness-${key}`))
    assert.equal(JSON.stringify(online).includes('fixture-access'), false)
  } finally { rmSync(root, { recursive: true, force: true }); rmSync(appData, { recursive: true, force: true }) }
})
