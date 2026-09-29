import { createHash } from 'node:crypto'
import { existsSync, statSync, mkdirSync, readFileSync } from 'node:fs'
import { readFile, unlink } from 'node:fs/promises'
import { isAbsolute, join, resolve } from 'node:path'
import { writeFileAtomic } from '@deepseek-ai/dsh-atomic-write'
import { identityDataLocationsDialog } from './data-locations.js'

const accountKeyPattern = /^[a-f0-9]{64}$/
const MAX_HANDOFF_BYTES = 64 * 1024
const HANDOFF_LIFETIME_MS = 5 * 60_000

function baseDirectory(home) {
  if (typeof home !== 'string' || !isAbsolute(home) || home.includes('\0')) throw new TypeError('Seal Harness数据根目录必须是绝对路径')
  return resolve(home)
}

export function accountHomeKey(baseUrl, userId) {
  const url = new URL(baseUrl)
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
    throw new TypeError('身份服务根地址无效')
  }
  if (typeof userId !== 'string' || !userId || userId.trim() !== userId || userId.length > 512 || userId.includes('\0')) {
    throw new TypeError('用户 ID 无效')
  }
  return createHash('sha256').update(JSON.stringify(['seal-harness-account-home-v1', url.href, userId])).digest('hex')
}

export function loginHomePath(baseHome) {
  return join(baseDirectory(baseHome), 'login')
}

export function accountHomePath(baseHome, baseUrl, userId) {
  return join(baseDirectory(baseHome), 'accounts', accountHomeKey(baseUrl, userId))
}

/** 只创建空的账号目录；旧 Home 中的会话、配置和凭据绝不自动迁入。 */
export function ensureAccountHome(baseHome, baseUrl, userId) {
  const target = accountHomePath(baseHome, baseUrl, userId)
  mkdirSync(target, { recursive: true })
  return target
}

export function ensureLoginHome(baseHome) {
  const target = loginHomePath(baseHome)
  mkdirSync(target, { recursive: true })
  return target
}

function scopeHome(baseHome, key) {
  const base = baseDirectory(baseHome)
  if (key === null) return loginHomePath(base)
  if (typeof key !== 'string' || !accountKeyPattern.test(key)) throw new TypeError('账号 Home 标识无效')
  return join(base, 'accounts', key)
}

function scopedDataLocations(home, appData, suffix) {
  return Object.freeze({
    dshHome: home,
    credentialsFile: join(home, '.credentials.yaml'),
    sessionsDirectory: join(home, 'sessions'),
    sessionProjectionDirectory: join(home, 'storages', 'session_projcache', 'sessions'),
    profilesDirectory: join(home, 'profiles'),
    projectsDirectory: join(home, 'projects'),
    capabilitiesDirectory: join(home, 'capabilities'),
    productCapabilitiesDirectory: join(home, 'seal-harness-capabilities'),
    desktopProfileDirectory: join(appData, 'identity-profile-state', suffix),
    rendererPartitionDirectory: join(appData, 'Partitions', `seal-harness-${suffix}`),
  })
}

export function prepareAccountHome({ baseHome, appData, crypto }) {
  const homes = new AccountHomeState({ baseHome, appData, crypto,
    servicesConfig: process.env.SEAL_HARNESS_SERVICES_CONFIG || undefined,
  })
  const { key, homeDir } = homes.current()
  if (key === null) ensureLoginHome(baseHome)
  else homes.assertCurrentHome()
  const suffix = key ?? 'login'
  return {
    homes,
    homeDir,
    profileUserDataDir: scopedDataLocations(homeDir, homes.appData, suffix).desktopProfileDirectory,
    rendererSessionPartition: `persist:seal-harness-${suffix}`,
  }
}

/** 进程重启前的账号选择；旧根目录永远不作为登录或账号 Home。 */
export class AccountHomeState {
  constructor({ baseHome, appData, crypto, servicesConfig, now = Date.now }) {
    this.baseHome = baseDirectory(baseHome)
    this.appData = baseDirectory(appData)
    this.crypto = crypto
    this.now = now
    this.stateFile = join(this.appData, 'identity-home', 'state.json')
    this.servicesConfigFile = servicesConfig === undefined ? join(this.baseHome, 'services.yml') : resolve(servicesConfig)
  }

  current() {
    let key = null
    if (existsSync(this.stateFile)) {
      if (statSync(this.stateFile).size > 4096) throw new Error('Seal Harness账号 Home 状态过大')
      const state = JSON.parse(readFileSync(this.stateFile, 'utf8'))
      if (state?.version !== 1 || !Object.hasOwn(state, 'key') || Object.keys(state).length !== 2
        || state.key !== null && !accountKeyPattern.test(state.key)) throw new Error('Seal Harness账号 Home 状态无效')
      key = state.key
    }
    return { key, homeDir: scopeHome(this.baseHome, key) }
  }

  dataLocations() {
    const { key, homeDir } = this.current()
    const offlineHome = loginHomePath(this.baseHome)
    return Object.freeze({
      activeScope: key === null ? 'offline' : 'online',
      key,
      baseHome: this.baseHome,
      appData: this.appData,
      onlineHomeTemplate: join(this.baseHome, 'accounts', '<account-key>'),
      offline: scopedDataLocations(offlineHome, this.appData, 'login'),
      online: key === null ? null : scopedDataLocations(homeDir, this.appData, key),
      runtime: Object.freeze({
        identitySelectionFile: this.stateFile,
        logsDirectory: join(this.appData, 'logs'),
        crashEvidenceDirectory: join(this.appData, 'crash-evidence'),
        crashpadDirectory: join(this.appData, 'Crashpad'),
        lifecycleEventsDirectory: join(this.appData, 'lifecycle-events'),
        windowStateFile: join(this.appData, 'main-window-state.json'),
        installationIdFile: join(this.appData, 'identity', 'installation-id'),
        lockFile: join(this.appData, 'lockfile'),
        servicesConfigFile: this.servicesConfigFile,
      }),
      legacy: Object.freeze({
        credentialsFile: join(this.baseHome, '.credentials.yaml'),
        sessionsDirectory: join(this.baseHome, 'sessions'),
        profilesDirectory: join(this.baseHome, 'profiles'),
        storagesDirectory: join(this.baseHome, 'storages'),
      }),
    })
  }

  dataLocationsDialog(locale) {
    return identityDataLocationsDialog(this.dataLocations(), locale)
  }

  assertCurrentHome() {
    const { homeDir } = this.current()
    if (!statSync(homeDir).isDirectory()) throw new Error(`Seal Harness账号 Home 路径不是目录：${homeDir}`)
    return homeDir
  }

  async #writeState(key) {
    await writeFileAtomic(this.stateFile, `${JSON.stringify({ version: 1, key })}\n`, { mode: 0o666 })
  }

  async select(key, grant) {
    if (typeof key !== 'string' || !accountKeyPattern.test(key)
      || !grant || key !== accountHomeKey(grant.baseUrl, grant.userId)) throw new TypeError('账号与认证结果不匹配')
    const home = ensureAccountHome(this.baseHome, grant.baseUrl, grant.userId)
    const handoffFile = join(home, '.identity-handoff')
    if (!this.crypto?.isEncryptionAvailable?.()
      || process.platform === 'linux' && this.crypto.getSelectedStorageBackend?.() === 'basic_text') {
      // 不将明文 refresh token 写盘；新 Home 启动后要求用户再登录一次。
      try { await unlink(handoffFile) }
      catch (error) { if (error.code !== 'ENOENT') throw error }
      await this.#writeState(key)
      return { handoff: false }
    }
    const encrypted = this.crypto.encryptString(JSON.stringify({ key, grant, expiresAt: this.now() + HANDOFF_LIFETIME_MS }))
    if (!Buffer.isBuffer(encrypted) || encrypted.length > MAX_HANDOFF_BYTES) throw new Error('登录交接内容过大')
    await writeFileAtomic(handoffFile, encrypted, { mode: 0o666 })
    try { await this.#writeState(key) }
    catch (error) { await unlink(handoffFile).catch(() => {}); throw error }
    return { handoff: true }
  }

  async consumeHandoff() {
    const { key, homeDir } = this.current()
    if (key === null) return null
    const path = join(homeDir, '.identity-handoff')
    if (!existsSync(path)) return null
    if (statSync(path).size > MAX_HANDOFF_BYTES) throw new Error('登录交接内容过大')
    const encrypted = await readFile(path)
    await unlink(path)
    const value = JSON.parse(this.crypto.decryptString(encrypted))
    if (value?.key !== key || !Number.isSafeInteger(value.expiresAt) || value.expiresAt < this.now()
      || value.expiresAt > this.now() + HANDOFF_LIFETIME_MS
      || value.grant?.baseUrl === undefined || value.grant?.userId === undefined
      || accountHomeKey(value.grant.baseUrl, value.grant.userId) !== key) throw new Error('登录交接已失效')
    return value.grant
  }

  async clear() {
    await this.#writeState(null)
  }
}
