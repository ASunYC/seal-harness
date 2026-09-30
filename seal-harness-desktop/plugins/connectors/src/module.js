import { hasCompletionMarker, prepareWorkspace } from './workspace.js'
import { resolveStdioRuntime } from './runtime.js'
import { join, relative, isAbsolute } from 'node:path'
import { readFile, realpath } from 'node:fs/promises'
import { safeRelative } from '../../skills/src/package.js'
import { downloadPackage, inspectLocalPackage, materializePackage, MAX_CONNECTOR_PACKAGE_BYTES } from './package.js'
import * as httpAdapter from './http-adapter.js'
import * as sseClient from './sse.js'
import { z } from 'zod'
import { createHash, randomUUID } from 'node:crypto'
import { createOAuth } from './oauth.js'
import { workflowResource, workflowExport } from './workflow.js'
import * as mcpClient from '@deepseek-ai/dsh-mcp-client'
import { credentialKey } from '@deepseek-ai/dsh-credentials'
import { ConnectorError, configSchema, stateSchema, mutationSchema, idSchema, parse, validateTransport, fromDescriptor } from './schema.js'

const storageKey = credentialKey('seal-harness-capabilities', 'connectors')
const sessionSelectionKey = credentialKey('seal-harness-capabilities', 'connector-session-selections')
const emptyState = () => ({ version: 1, entries: [] })
const readState = record => record === undefined ? emptyState() : parse(stateSchema, record.kind === 'grant' ? record.payload : null)
const sessionSelectionSchema = z.strictObject({
  version: z.literal(1),
  rows: z.array(z.strictObject({
    accountId: z.string().min(1).max(512),
    sessionId: z.string().min(1).max(256),
    ids: z.array(idSchema).max(8).refine(ids => new Set(ids).size === ids.length),
  })).max(1_000).refine(rows => new Set(rows.map(row => `${row.accountId}\0${row.sessionId}`)).size === rows.length),
})
const emptySessionSelections = () => ({ version: 1, rows: [] })
const readSessionSelections = record => record === undefined
  ? emptySessionSelections()
  : parse(sessionSelectionSchema, record.kind === 'grant' ? record.payload : null)
const prefix = id => `mcp__zz-${id}__`
const capabilities = {
  transports: ['stdio', 'streamable-http', 'sse'],
  scope: 'global-or-workspace',
  unsupported: [],
}

/**
 * 每个 MCP 使用标准 Cordis 子插件；凭据 grant record 只留在 Host。
 * @param {import('@deepseek-ai/cordis').Context} ctx
 * @param {{home: string, backend: import('../backend.js').CapabilityBackend}} options
 */
export async function createModule(ctx, { home, backend }) {
  const credentials = ctx.get('credentials')
  const tools = ctx.get('tools')
  const running = new Map()
  const toolNames = new Set()
  const outcomes = new Map()
  const sessionRestrictions = new Map()
  const knownSessions = new Map()
  const oauth = createOAuth()
  let entries = []
  let sessionSelections = emptySessionSelections()
  let currentAccountId = 'local'
  let packagePreview
  let disposed = false
  let chain = Promise.resolve()
  const own = exec => entries.find(entry => exec.name.startsWith(prefix(entry.id)))
  const identity = () => ctx.get('sealHarnessIdentity')
  const currentSession = async () => await identity()?.getSession() ?? null
  const accountId = session => session?.accountId ?? 'local'
  const visible = (entry, session) => !entry.source || entry.source.accountId === session?.accountId
  const requireStorage = () => {
    if (!credentials) throw new ConnectorError('DSH 凭据服务未加载，无法安全保存或读取连接器。')
  }
  const assertActive = signal => {
    if (disposed) throw new ConnectorError('连接器插件已卸载。')
    signal?.throwIfAborted()
  }

  async function stop(id) {
    const fiber = running.get(id)
    if (fiber) {
      await fiber.dispose()
      if (running.get(id) === fiber) running.delete(id)
    }
  }

  function clearSessionRestrictions() {
    for (const dispose of sessionRestrictions.values()) dispose()
    sessionRestrictions.clear()
  }

  function selectedIds(account, sessionId) {
    return sessionSelections.rows.find(row => row.accountId === account && row.sessionId === sessionId)?.ids ?? []
  }

  function liveAgent(sessionId) {
    const agent = ctx.get('agents')?.get(sessionId)
    if (!agent || String(agent.id) !== sessionId) throw new ConnectorError('当前会话尚未就绪，请重新打开会话后再选择连接器。')
    return agent
  }

  function applySessionRestriction(account, sessionId) {
    const key = `${account}\0${sessionId}`
    sessionRestrictions.get(key)?.()
    sessionRestrictions.delete(key)
    const agent = liveAgent(sessionId)
    const selected = new Set(selectedIds(account, sessionId))
    const denied = [...toolNames].filter(name => {
      const entry = entries.find(candidate => name.startsWith(prefix(candidate.id)))
      return entry && !selected.has(entry.id)
    })
    if (!denied.length) return
    const scopedTools = agent.ctx?.get?.('tools') ?? agent.ctx?.tools
    if (!scopedTools?.restrict) throw new ConnectorError('当前会话未提供工具隔离作用域。')
    sessionRestrictions.set(key, scopedTools.restrict({ deny: denied }))
  }

  function applyKnownSessionRestrictions() {
    for (const [sessionId, account] of knownSessions) {
      if (!ctx.get('agents')?.get(sessionId)) {
        const key = `${account}\0${sessionId}`
        sessionRestrictions.get(key)?.()
        sessionRestrictions.delete(key)
        knownSessions.delete(sessionId)
        continue
      }
      applySessionRestriction(account, sessionId)
    }
  }

  function runtimeEnvironment(entry) {
    return {
      ...Object.fromEntries(entry.environmentPassthrough.filter(name => process.env[name] !== undefined).map(name => [name, process.env[name]])),
      ...entry.env,
    }
  }

  function runtimeHeaders(entry) {
    const resolved = {}
    const assign = (name, value) => {
      const previous = Object.keys(resolved).find(key => key.toLowerCase() === name.toLowerCase())
      if (previous) delete resolved[previous]
      resolved[name] = value
    }
    for (const [name, environmentName] of Object.entries(entry.headerEnvironment)) {
      if (process.env[environmentName] !== undefined) assign(name, process.env[environmentName])
    }
    for (const [name, value] of Object.entries(entry.headers)) assign(name, value)
    return resolved
  }

  async function checkConnection(entry, signal) {
    if (!tools) throw new ConnectorError('DSH 工具服务未加载。')
    await validateTransport(entry)
    assertActive(signal)
    const serverName = `probe-${randomUUID().slice(0, 8)}`
    const probePrefix = `mcp__${serverName}__`
    const discovered = []
    const registration = ctx.extend({ tools: {
      register(definition) {
        discovered.push(definition)
        return () => {}
      },
    } })
    const config = {
      serverName, transport: entry.transport, url: entry.url, headers: runtimeHeaders(entry),
      toolCallTimeoutMs: entry.toolCallTimeoutMs, failOnStartupError: true,
    }
    const fiber = registration.plugin(entry.transport === 'sse' ? sseClient : mcpClient, config)
    try {
      await fiber.await()
      assertActive(signal)
      const result = discovered.map(tool => ({ name: tool.name.startsWith(probePrefix) ? tool.name.slice(probePrefix.length) : tool.name, description: tool.description ?? '' }))
      return { status: 'ready', toolCount: result.length, tools: result }
    } catch (error) {
      throw new ConnectorError('连接检查失败，请检查地址、认证和请求头后重试。', { cause: error })
    } finally {
      await fiber.dispose()
    }
  }

  async function start(entry, signal) {
    await stop(entry.id)
    outcomes.delete(entry.id)
    if (!entry.enabled) return
    const session = await currentSession()
    if (!visible(entry, session)) return
    if (entry.source && typeof identity()?.subscribe !== 'function') {
      outcomes.set(entry.id, { status: 'error', issue: '用户插件尚未提供身份变化通知，无法安全启用商店连接器。' })
      return
    }
    assertActive(signal)
    if (!tools) {
      outcomes.set(entry.id, { status: 'error', issue: 'DSH 工具服务未加载。' })
      return
    }
    if (entry.bootstrap && !entry.workspacePath) { outcomes.set(entry.id, { status: 'unconfigured', issue: '请先选择工作区并运行初始化。' }); return }
    if (entry.oauth && !entry.oauth.tokens) {
      outcomes.set(entry.id, { status: 'unconfigured', issue: '请先完成浏览器授权。' })
      return
    }
    const resolvedHeaders = runtimeHeaders(entry)
    if (!entry.oauth && entry.requiredHeaders.some(name => !Object.entries(resolvedHeaders).some(([key, value]) => key.toLowerCase() === name.toLowerCase() && value))) {
      outcomes.set(entry.id, { status: 'unconfigured', issue: '请先配置所需认证请求头。' })
      return
    }
    const runtimeEnv = runtimeEnvironment(entry)
    if (entry.requiredEnv.some(name => !runtimeEnv[name]) || entry.credentialSlots.some(slot => slot.required && !entry.credentialValues[slot.name])) { outcomes.set(entry.id, { status: 'unconfigured', issue: '请先配置所需环境变量或凭据。' }); return }
    try {
      await validateTransport(entry)
      assertActive(signal)
      if (entry.source) {
        const current = await currentSession()
        if (current?.accountId !== session?.accountId || current?.epoch !== session?.epoch) throw new ConnectorError('identityChanged')
      }
      let headers = resolvedHeaders
      if (entry.oauth) {
        const authorized = await oauth.refresh(entry, signal)
        headers = { ...entry.headers, Authorization: `Bearer ${authorized.tokens.access_token}` }
        if (authorized.tokens.access_token !== entry.oauth.tokens.access_token) {
          await credentials.modifyRecord(storageKey, record => ({ kind: 'grant', payload: { ...readState(record), entries: readState(record).entries.map(item => item.id === entry.id ? { ...item, oauth: authorized } : item) } }))
          entry.oauth = authorized
        }
      }
      const config = {
        serverName: `zz-${entry.id}`, transport: entry.transport,
        ...(entry.transport === 'stdio'
          ? resolveStdioRuntime(entry, runtimeEnv)
          : { url: entry.url, headers }),
        toolCallTimeoutMs: entry.toolCallTimeoutMs, failOnStartupError: true,
      }
      // 只记录子插件自己的注册；全局 schemas() 会投影无关原生工具。
      const registration = ctx.extend({ tools: {
        register(definition) {
          const dispose = tools.register(definition)
          toolNames.add(definition.name)
          return () => { toolNames.delete(definition.name); return dispose() }
        },
      } })
      const fiber = registration.plugin(entry.adapter ? httpAdapter : entry.transport === 'sse' ? sseClient : mcpClient, entry.adapter ? { ...config, adapter: entry.adapter, values: entry.credentialValues } : config)
      running.set(entry.id, fiber)
      await fiber.await()
      assertActive(signal)
      const current = await currentSession()
      if (!visible(entry, current) || entry.source && current?.epoch !== session?.epoch) throw new ConnectorError('identityChanged')
      outcomes.set(entry.id, { status: 'active', checkedAt: new Date().toISOString() })
    } catch {
      await stop(entry.id)
      outcomes.set(entry.id, { status: 'error', issue: 'MCP 初始化或工具发现失败，请检查程序、地址和凭据后重新连接。' })
      assertActive(signal)
    }
  }

  // ponytail: 一个变更队列串行管理不超过 100 个连接器；有并行配置吞吐需求时再按 id 分队列。
  function serial(action) {
    const operation = chain.then(action)
    chain = operation.catch(() => {})
    return operation
  }

  async function load() {
    requireStorage()
    currentAccountId = accountId(await currentSession())
    sessionSelections = readSessionSelections(await credentials.readRecord(sessionSelectionKey))
    let state = readState(await credentials.readRecord(storageKey))
    const recovered = await recoverWorkspaceBindings(state)
    if (recovered !== state) {
      const saved = await credentials.modifyRecord(storageKey, () => ({ kind: 'grant', payload: recovered }))
      state = readState(saved)
    }
    await reconcile(state.entries)
  }

  async function recoverWorkspaceBindings(state) {
    const paths = [...new Set((ctx.get('workspaceRegistry')?.list() ?? []).map(workspace => workspace.path).filter(Boolean))]
    if (!paths.length) return state
    let changed = false
    const next = []
    for (const entry of state.entries) {
      if (!entry.bootstrap || entry.workspacePath) { next.push(entry); continue }
      const matches = new Set()
      for (const path of paths) {
        try {
          if (await hasCompletionMarker(entry, path)) matches.add(await realpath(path))
        } catch {
          // 无效或不可访问的候选不参与自动恢复；手动绑定仍会返回具体错误。
        }
      }
      if (matches.size === 1) {
        changed = true
        const workspacePath = await prepareWorkspace(entry, matches.values().next().value)
        next.push({ ...entry, workspacePath, revision: entry.revision + 1 })
      } else next.push(entry)
    }
    return changed ? parse(stateSchema, { ...state, entries: next }) : state
  }

  async function reconcile(nextEntries, signal) {
    clearSessionRestrictions()
    const changed = nextEntries.filter(entry => !entries.some(previous => previous.id === entry.id && previous.revision === entry.revision))
    for (const entry of entries) {
      if (!nextEntries.some(next => next.id === entry.id && next.revision === entry.revision)) await stop(entry.id)
    }
    entries = nextEntries
    for (const entry of changed) await start(entry, signal)
    applyKnownSessionRestrictions()
  }

  function view(entry) {
    const { headers, env, credentialValues, adapter, bootstrap, source, oauth: authorization, ...publicConfig } = entry
    const schemas = [...toolNames].filter(name => name.startsWith(prefix(entry.id))).map(name => tools.get(name)).filter(Boolean)
    return {
      ...publicConfig,
      adapter: !!adapter,
      workspaceBootstrap: !!bootstrap,
      configuredCredentials: Object.keys(credentialValues),
      authorization: authorization ? { configured: !!authorization.tokens, expiresAt: authorization.expiresAt } : null,
      source: source ? { id: source.id, version: source.version, ...(source.centerId ? { centerId: source.centerId } : {}) } : null,
      headers: Object.keys(headers).sort(), env: Object.keys(env).sort(),
      configuredHeaders: Object.entries(headers).filter(([, value]) => !!value).map(([name]) => name),
      tools: schemas.map(tool => ({ name: tool.name.slice(prefix(entry.id).length), description: tool.description, inputSchema: structuredClone(tool.parameters) })),
      status: !entry.enabled ? 'disabled' : outcomes.get(entry.id)?.status ?? 'inactive',
      ...outcomes.get(entry.id),
    }
  }

  async function list() {
    if (!credentials) return { items: [], capabilities, issue: 'DSH 凭据服务未加载，本地连接器不可用。' }
    const session = await currentSession()
    return { items: entries.filter(entry => visible(entry, session)).map(view), capabilities, identityNotifications: typeof identity()?.subscribe === 'function' }
  }

  async function mutate(payload, transform, signal) {
    assertActive(signal)
    requireStorage()
    const session = await currentSession()
    const saved = await credentials.modifyRecord(storageKey, async record => {
      const state = readState(record)
      const previous = state.entries.find(entry => entry.id === payload.id)
      if (previous && !visible(previous, session)) throw new ConnectorError('当前账号无法修改该连接器。')
      if (previous ? payload.revision !== previous.revision : payload.revision !== undefined) throw new ConnectorError('连接器已被修改或移除，请刷新后重试。')
      const next = await transform(previous)
      if (next) await validateTransport(next)
      assertActive(signal)
      if (next?.source && !visible(next, await currentSession())) throw new ConnectorError('当前账号已变化，请刷新后重试。')
      return { kind: 'grant', payload: parse(stateSchema, { version: 1, entries: [...state.entries.filter(entry => entry.id !== payload.id), ...(next ? [{ ...next, revision: (previous?.revision ?? -1) + 1 }] : [])] }) }
    })
    await reconcile(readState(saved).entries, signal)
    if (!entries.some(entry => entry.id === payload.id)) outcomes.delete(payload.id)
    return list()
  }

  const releaseGuard = tools?.guard(exec => {
    const entry = own(exec)
    if (!entry) return
    if (disposed || !entry.enabled || !running.has(entry.id)) return '此连接器已停用。'
    if (exec.agent && ctx.get('agents')?.get(String(exec.agent.id))
      && !selectedIds(currentAccountId, String(exec.agent.id)).includes(entry.id)) return '此连接器未加入当前会话。'
    const name = exec.name.slice(prefix(entry.id).length)
    if (entry.enabledTools && !entry.enabledTools.includes(name)) return '此工具不在连接器允许列表中。'
  })
  const releaseExecution = ctx.on('tools/execute', async (exec, next) => {
    const entry = own(exec)
    if (entry && !visible(entry, await currentSession())) throw new ConnectorError('连接器账号已变化，执行已拒绝。')
    if (entry?.workspacePath) {
      const cwd = exec.agent?.session.header.cwd
      const path = cwd ? relative(entry.workspacePath, await realpath(cwd)) : '..'
      if (path.startsWith('..') || isAbsolute(path)) throw new ConnectorError('此连接器只在所选工作区内可用。')
    }
    return next()
  })
  const releaseAgentCreated = ctx.on('agent/created', ({ agent }) => {
    if (disposed) return
    const sessionId = String(agent.id)
    knownSessions.set(sessionId, currentAccountId)
    applySessionRestriction(currentAccountId, sessionId)
  })
  const releaseAgentDisposed = ctx.on('agent/disposed', ({ agent }) => {
    const sessionId = String(agent.id)
    const account = knownSessions.get(sessionId)
    if (account === undefined) return
    sessionRestrictions.get(`${account}\0${sessionId}`)?.()
    sessionRestrictions.delete(`${account}\0${sessionId}`)
    knownSessions.delete(sessionId)
  })
  const unsubscribe = identity()?.subscribe?.(() => {
    if (disposed) return
    oauth.dispose()
    clearSessionRestrictions()
    knownSessions.clear()
    currentAccountId = '__identity-changing__'
    void Promise.all(entries.filter(entry => entry.source).map(async entry => {
      await stop(entry.id)
      outcomes.delete(entry.id)
    })).catch(() => { ctx.logger.warn('连接器身份变更清理失败。') })
  })

  if (credentials) {
    try {
      await load()
    } catch (error) {
      await Promise.all([...running.keys()].map(stop))
      releaseGuard?.(); releaseExecution(); releaseAgentCreated(); releaseAgentDisposed(); unsubscribe?.()
      throw error
    }
  }

  async function installResolved(item, account, signal, files) {
    const id = item.assetId, version = item.version
    let directory, adapter
    const descriptor = item.descriptor
    if (files || descriptor.transport === 'stdio' || descriptor.entrypoint || descriptor.workspaceBootstrap || descriptor.files?.some(file => file.path === 'stratex-http-adapter.json')) {
      directory = join(home, 'seal-harness-capabilities', 'connectors', id, createHash('sha256').update(version).digest('hex'))
      if (files) await materializePackage(files, directory, descriptor)
      else await downloadPackage(backend, id, version, item.artifact, directory, signal)
      if (descriptor.files?.some(file => file.path === 'stratex-http-adapter.json') || descriptor.runtime === 'http_adapter' || descriptor.entrypoint?.endsWith('.json')) {
        const artifact = JSON.parse(await readFile(join(directory, descriptor.files?.some(file => file.path === 'stratex-http-adapter.json') ? 'stratex-http-adapter.json' : safeRelative(descriptor.entrypoint)), 'utf8'))
        if (artifact.schemaVersion === 'stratex.http-adapter/v1') adapter = httpAdapter.adapterSchema.parse(artifact)
      }
    }
    const config = fromDescriptor({ id, name: item.name ?? descriptor.description ?? '专家连接器', summary: item.summary, category: item.category, version, descriptor, accountId: account?.accountId ?? 'local', directory, adapter })
    if (!account) delete config.source
    const existing = entries.find(entry => entry.id === config.id)
    if (existing) return view(existing)
    await mutate({ id: config.id }, () => config, signal)
    return view(entries.find(entry => entry.id === config.id))
  }

  return {
    hostHandlers: {
      installResolved: (input, signal) => serial(async () => {
        const account = await backend.account()
        for (const item of input.items) {
          if (item.assetType !== 'mcp') throw new ConnectorError('连接器安装只接受 MCP 资源。')
          await installResolved(item, account, signal)
        }
        await backend.assertAccount(account)
        return list()
      }),
      ensurePackage: (input, signal) => serial(async () => {
        const hash = createHash('sha256').update(input.sourceId).digest('hex')
        const assetId = `${hash.slice(0, 8)}-${hash.slice(8, 12)}-5${hash.slice(13, 16)}-a${hash.slice(17, 20)}-${hash.slice(20, 32)}`
        const item = await installResolved({ ...input, assetId }, input.accountId ? { accountId: input.accountId } : null, signal, input.files)
        const entry = entries.find(entry => entry.id === item.id)
        if (!entry.enabled) await mutate({ id: entry.id, revision: entry.revision }, previous => ({ ...previous, enabled: true }), signal)
        return view(entries.find(entry => entry.id === item.id))
      }),
      workflowResources: (_input, signal) => serial(async () => {
        assertActive(signal)
        const session = await currentSession()
        return { resources: entries.filter(entry => visible(entry, session)).map(workflowResource) }
      }),
      workflowExport: (input, signal) => serial(async () => {
        assertActive(signal)
        const selection = z.object({ kind: z.literal('mcp'), sourceId: z.string().uuid(), version: z.string() }).parse(input)
        const session = await currentSession()
        const entry = entries.find(entry => visible(entry, session) && workflowResource(entry).sourceId === selection.sourceId && workflowResource(entry).version === selection.version)
        if (!entry) throw new ConnectorError('连接器已更新，请重新选择。')
        return workflowExport(entry)
      }),
    },
    handlers: {
      list: () => serial(async () => { assertActive(); if (credentials) await load(); return list() }),
      inspectPackage: (input, signal) => serial(async () => {
        assertActive(signal)
        const payload = parse(z.strictObject({
          fileName: z.string().min(1).max(260),
          zipBase64: z.string().min(1).max(Math.ceil(MAX_CONNECTOR_PACKAGE_BYTES * 4 / 3) + 4),
        }), input)
        const inspected = inspectLocalPackage(Buffer.from(payload.zipBase64, 'base64'), payload.fileName)
        const digest = createHash('sha256').update(`local-package:${inspected.hash}`).digest('hex')
        const assetId = `${digest.slice(0, 8)}-${digest.slice(8, 12)}-5${digest.slice(13, 16)}-a${digest.slice(17, 20)}-${digest.slice(20, 32)}`
        const directory = join(home, 'seal-harness-capabilities', 'connectors', assetId, createHash('sha256').update(inspected.preview.version).digest('hex'))
        fromDescriptor({ id: assetId, name: inspected.preview.name, version: inspected.preview.version, descriptor: inspected.descriptor, accountId: 'local', directory })
        packagePreview = { token: randomUUID(), expires: Date.now() + 10 * 60_000, assetId, directory, ...inspected }
        return { token: packagePreview.token, ...inspected.preview }
      }),
      importPackage: (input, signal) => serial(async () => {
        assertActive(signal)
        const payload = parse(z.strictObject({
          token: z.string().uuid(),
          name: configSchema.shape.name,
          summary: configSchema.shape.summary.unwrap().optional(),
          category: configSchema.shape.category.unwrap(),
          command: z.string().min(1).max(2_000),
          args: configSchema.shape.args.unwrap(),
          envValues: configSchema.shape.env.unwrap().optional(),
          environmentPassthrough: configSchema.shape.environmentPassthrough.unwrap(),
          enabled: z.boolean().default(false),
        }), input)
        if (!packagePreview || packagePreview.token !== payload.token || packagePreview.expires < Date.now()) throw new ConnectorError('连接器包预览已失效，请重新选择文件。')
        const descriptor = { ...packagePreview.descriptor, executable: safeRelative(payload.command), args: payload.args, environmentVariables: [], environmentPassthrough: payload.environmentPassthrough }
        const { source: _source, ...local } = fromDescriptor({
          id: packagePreview.assetId,
          name: payload.name,
          summary: payload.summary ?? packagePreview.preview.summary,
          category: payload.category,
          version: packagePreview.preview.version,
          descriptor,
          accountId: 'local',
          directory: packagePreview.directory,
        })
        if (entries.some(entry => entry.id === local.id)) throw new ConnectorError('此连接器包已经安装。')
        const config = parse(configSchema, { ...local, env: payload.envValues ?? {}, environmentPassthrough: payload.environmentPassthrough, enabled: payload.enabled })
        await materializePackage(packagePreview.files, packagePreview.directory, descriptor)
        const result = await mutate({ id: config.id }, () => config, signal)
        packagePreview = undefined
        return { ...result, importedId: config.id }
      }),
      checkConnection: (input, signal) => serial(async () => {
        const payload = parse(configSchema.omit({ source: true, revision: true, oauth: true, adapter: true, tokenExchange: true, bootstrap: true, headerEnvironment: true }).extend({
          authMode: z.enum(['none', 'api_key', 'oauth_authorization_code_pkce']).optional(),
          summary: configSchema.shape.summary.unwrap().optional(), category: configSchema.shape.category.unwrap().optional(),
          headers: configSchema.shape.headers.unwrap().optional(), env: configSchema.shape.env.unwrap().optional(),
          headerValues: configSchema.shape.headers.unwrap().optional(),
          headerEnvironment: configSchema.shape.headerEnvironment.unwrap().optional(),
        }), input)
        const { headerValues, headerEnvironment, authMode: _authMode, ...fields } = payload
        if (fields.transport === 'stdio') throw new ConnectorError('本地 STDIO 连接器请在安装后检查。')
        const entry = parse(configSchema, { ...fields, enabled: false, headers: { ...(fields.headers ?? {}), ...(headerValues ?? {}) }, headerEnvironment: headerEnvironment ?? {} })
        return checkConnection(entry, signal)
      }),
      sessionList: (input, signal) => serial(async () => {
        assertActive(signal)
        const { sessionId } = parse(z.strictObject({ sessionId: z.string().min(1).max(256) }), input)
        liveAgent(sessionId)
        if (credentials) await load()
        const account = accountId(await currentSession())
        currentAccountId = account
        knownSessions.set(sessionId, account)
        applySessionRestriction(account, sessionId)
        const snapshot = await list()
        const visibleIds = new Set(snapshot.items.map(item => item.id))
        return { ...snapshot, selectedIds: selectedIds(account, sessionId).filter(id => visibleIds.has(id)) }
      }),
      sessionSet: (input, signal) => serial(async () => {
        assertActive(signal)
        requireStorage()
        const payload = parse(z.strictObject({
          sessionId: z.string().min(1).max(256),
          id: idSchema,
          revision: z.number().int().nonnegative(),
          selected: z.boolean(),
        }), input)
        liveAgent(payload.sessionId)
        const session = await currentSession()
        const account = accountId(session)
        currentAccountId = account
        const entry = entries.find(candidate => candidate.id === payload.id && candidate.revision === payload.revision && visible(candidate, session))
        if (!entry) throw new ConnectorError('连接器已更新，请刷新选择器后重试。')
        if (payload.selected && !entry.enabled) {
          await mutate(payload, previous => ({ ...previous, enabled: true }), signal)
        }
        const saved = await credentials.modifyRecord(sessionSelectionKey, record => {
          const state = readSessionSelections(record)
          const previous = state.rows.find(row => row.accountId === account && row.sessionId === payload.sessionId)
          const ids = new Set(previous?.ids ?? [])
          if (payload.selected) ids.add(payload.id)
          else ids.delete(payload.id)
          if (ids.size > 8) throw new ConnectorError('每个会话最多选择 8 个连接器。')
          return { kind: 'grant', payload: parse(sessionSelectionSchema, {
            version: 1,
            rows: [
              ...state.rows.filter(row => row.accountId !== account || row.sessionId !== payload.sessionId),
              ...(ids.size ? [{ accountId: account, sessionId: payload.sessionId, ids: [...ids] }] : []),
            ],
          }) }
        })
        sessionSelections = readSessionSelections(saved)
        knownSessions.set(payload.sessionId, account)
        applySessionRestriction(account, payload.sessionId)
        const snapshot = await list()
        const visibleIds = new Set(snapshot.items.map(item => item.id))
        return { ...snapshot, selectedIds: selectedIds(account, payload.sessionId).filter(id => visibleIds.has(id)) }
      }),
      save: (input, signal) => serial(async () => {
        const payload = parse(configSchema.omit({ source: true, revision: true, oauth: true, adapter: true, tokenExchange: true, bootstrap: true, headerEnvironment: true }).extend({
          authMode: z.enum(['none', 'api_key', 'oauth_authorization_code_pkce']).optional(),
          summary: configSchema.shape.summary.unwrap().optional(), category: configSchema.shape.category.unwrap().optional(),
          headers: configSchema.shape.headers.unwrap().optional(), env: configSchema.shape.env.unwrap().optional(),
          revision: z.number().int().nonnegative().optional(),
          headerValues: configSchema.shape.headers.unwrap().optional(),
          headerEnvironment: configSchema.shape.headerEnvironment.unwrap().optional(),
          envValues: configSchema.shape.env.unwrap().optional(),
          environmentPassthrough: configSchema.shape.environmentPassthrough.unwrap().optional(),
        }), input)
        const { headerValues, headerEnvironment, envValues, environmentPassthrough, authMode, ...fields } = payload
        if (fields.transport === 'stdio' && authMode && authMode !== 'none') throw new ConnectorError('本地程序使用环境变量配置认证。')
        return mutate(payload, previous => parse(configSchema, {
          ...(!previous && authMode === 'oauth_authorization_code_pkce' ? { oauth: { scopes: [] } } : {}),
          ...fields, summary: fields.summary ?? previous?.summary ?? '', category: fields.category ?? previous?.category ?? 'office', headerEnvironment: headerEnvironment ?? previous?.headerEnvironment ?? {}, environmentPassthrough: environmentPassthrough ?? previous?.environmentPassthrough ?? [], ...(previous?.bootstrap ? { bootstrap: previous.bootstrap, workspacePath: previous.workspacePath } : {}), ...(previous?.adapter ? { adapter: previous.adapter, credentialSlots: previous.credentialSlots } : {}), credentialValues: { ...previous?.credentialValues, ...fields.credentialValues }, ...(previous?.tokenExchange ? { tokenExchange: previous.tokenExchange } : {}), ...(previous?.oauth ? { oauth: previous.oauth } : {}), ...(previous?.source ? { source: previous.source, requiredHeaders: previous.requiredHeaders, requiredEnv: previous.requiredEnv } : {}),
          headers: headerValues ? { ...(payload.headers ?? previous?.headers ?? {}), ...headerValues } : payload.headers ?? previous?.headers ?? {}, env: envValues ? { ...(payload.env ?? previous?.env ?? {}), ...envValues } : payload.env ?? previous?.env ?? {},
        }), signal)
      }),
      prepareWorkspace: (input, signal) => serial(async () => {
        const payload = parse(mutationSchema.extend({ path: z.string().min(1).max(4096) }), input)
        const session = await currentSession()
        const entry = entries.find(item => item.id === payload.id && item.revision === payload.revision && visible(item, session))
        if (!entry) throw new ConnectorError('连接器已更新，请刷新。')
        const workspacePath = await prepareWorkspace(entry, payload.path, signal)
        return mutate(payload, previous => ({ ...previous, workspacePath, enabled: true }), signal)
      }),
      exchangeToken: (input, signal) => serial(async () => {
        const payload = parse(mutationSchema.extend({ subjectToken: z.string().min(1).max(16384) }), input)
        const session = await currentSession()
        const entry = entries.find(item => item.id === payload.id && item.revision === payload.revision && visible(item, session))
        if (!entry?.tokenExchange) throw new ConnectorError('连接器不支持令牌交换。')
        const { tokenEndpoint, audience, scope } = entry.tokenExchange
        const response = await fetch(tokenEndpoint, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:token-exchange', subject_token: payload.subjectToken, subject_token_type: 'urn:ietf:params:oauth:token-type:access_token', requested_token_type: 'urn:ietf:params:oauth:token-type:access_token', audience, ...(scope ? { scope } : {}) }), signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(30000)]) : AbortSignal.timeout(30000) })
        if (!response.ok) throw new ConnectorError('令牌交换失败，请检查凭据。')
        const token = z.object({ access_token: z.string().min(1).max(16384) }).parse(await response.json())
        return mutate(payload, previous => ({ ...previous, headers: { ...previous.headers, Authorization: `Bearer ${token.access_token}` } }), signal)
      }),
      remove: (input, signal) => serial(() => { oauth.cancel(input.id); return mutate(parse(mutationSchema, input), () => null, signal) }),
      setEnabled: (input, signal) => serial(async () => {
        const payload = parse(mutationSchema.extend({ enabled: z.boolean() }), input)
        return mutate(payload, previous => ({ ...previous, enabled: payload.enabled }), signal)
      }),
      reconnect: (input, signal) => serial(async () => {
        const { id } = parse(z.strictObject({ id: idSchema }), input)
        const entry = entries.find(candidate => candidate.id === id && candidate.enabled)
        if (!entry || !visible(entry, await currentSession())) throw new ConnectorError('请先启用该连接器。')
        await start(entry, signal)
        return list()
      }),
      testTool: (input, signal) => serial(async () => {
        const payload = parse(mutationSchema.extend({ tool: z.string().regex(/^[A-Za-z0-9_.-]{1,160}$/), arguments: z.record(z.string(), z.unknown()) }), input)
        const session = await currentSession()
        const entry = entries.find(item => item.id === payload.id && item.revision === payload.revision && visible(item, session))
        if (!entry?.enabled || !running.has(entry.id)) throw new ConnectorError('请先启用并连接该连接器。')
        if (entry.workspacePath) throw new ConnectorError('此连接器限定了工作区，请在该工作区的原生会话中运行工具。')
        const name = `${prefix(entry.id)}${payload.tool}`
        if (!tools?.get(name) || entry.enabledTools && !entry.enabledTools.includes(payload.tool)) throw new ConnectorError('该工具未启用，请先保存工具选择。')
        if (JSON.stringify(payload.arguments).length > 200000) throw new ConnectorError('工具参数过大，请精简后重试。')
        // 复用 DSH 的完整 guard/审批链；无会话时需要审批的调用会被 DSH 拒绝。
        const result = await tools.execute({ name, callId: `connector-test-${randomUUID()}`, arguments: payload.arguments, signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(entry.toolCallTimeoutMs)]) : AbortSignal.timeout(entry.toolCallTimeoutMs) })
        assertActive(signal)
        const current = await currentSession()
        if (entry.source && (current?.accountId !== session?.accountId || current?.epoch !== session?.epoch)) throw new ConnectorError('当前账号已变化，请重新运行。')
        return result
      }),
      authorize: (input, signal) => serial(async () => {
        const { id, revision } = parse(mutationSchema, input)
        const session = await currentSession()
        const entry = entries.find(item => item.id === id && item.revision === revision && visible(item, session))
        if (!entry?.oauth) throw new ConnectorError('请选择支持 OAuth 的连接器。')
        const result = await oauth.begin(entry, state => serial(async () => {
          const current = await currentSession()
          if (entry.source && (current?.accountId !== session?.accountId || current?.epoch !== session?.epoch)) throw new ConnectorError('当前账号已变化，请重新授权。')
          await mutate({ id, revision }, previous => ({ ...previous, oauth: state, enabled: true }))
        }), () => outcomes.set(id, { status: 'error', issue: '授权未完成，请重新授权。' }), signal)
        return result
      }),
      clearAuthorization: (input, signal) => serial(() => {
        const payload = parse(mutationSchema, input)
        oauth.cancel(payload.id)
        return mutate(payload, previous => ({ ...previous, enabled: false, headers: {}, ...(previous.oauth ? { oauth: { scopes: previous.oauth.scopes } } : {}) }), signal)
      }),
      installCenter: (input, signal) => serial(async () => {
        const { connectorId } = z.object({ connectorId: z.string().regex(/^[a-z0-9][a-z0-9_-]{1,63}$/) }).parse(input)
        const session = await currentSession()
        if (!session) throw new ConnectorError('请先登录，再安装连接器。')
        const catalog = await backend.listCenter(signal)
        const application = z.object({ connectorId: z.string(), name: z.string(), version: z.string(), mcpEndpoint: z.string().url(), clientAuthMode: z.enum(['none', 'oauth']), scopes: z.array(z.string()).default([]) }).parse(catalog.data.find(item => item.connectorId === connectorId))
        const endpoint = new URL(application.mcpEndpoint), expected = new URL(`mcp/apps/${connectorId}`, backend.center)
        if (endpoint.href !== expected.href) throw new ConnectorError('MCP Center 目录地址与服务配置不一致。')
        const hash = createHash('sha256').update(`${backend.center.href}/${connectorId}`).digest('hex')
        const id = `${hash.slice(0, 8)}-${hash.slice(8, 12)}-5${hash.slice(13, 16)}-a${hash.slice(17, 20)}-${hash.slice(20, 32)}`
        const config = fromDescriptor({ id, name: application.name, version: application.version, accountId: session.accountId, descriptor: { schemaVersion: 'stratex.capability/v1', transport: 'http', endpointTemplate: endpoint.href, authMode: application.clientAuthMode === 'oauth' ? 'oauth_authorization_code_pkce' : 'none', ...(application.clientAuthMode === 'oauth' ? { oauthDiscovery: { scopes: application.scopes } } : {}) } })
        config.source.centerId = connectorId
        if (entries.some(entry => entry.id === config.id)) throw new ConnectorError('此连接器已经安装。')
        return mutate({ id: config.id }, () => config, signal)
      }),
      install: async (input, signal) => {
        const request = parse(z.strictObject({ id: z.string().uuid(), version: z.string().min(1).max(64).optional() }), input)
        const session = await currentSession()
        if (!session) throw new ConnectorError('请先登录，再安装商店连接器。')
        const asset = await backend.detail('mcps', request.id, signal)
        if (asset.id !== request.id || asset.assetType !== 'mcp') throw new ConnectorError('连接器详情与所选条目不一致。')
        const selected = request.version
          ? (await backend.request(`mcps/${request.id}/versions/${encodeURIComponent(request.version)}`, { signal })).data
          : asset.latestVersion
        if (!selected || selected.assetId !== request.id || request.version && selected.version !== request.version ||
            !['draft', 'private', 'published'].includes(selected.status)) {
          throw new ConnectorError('版本不可用，或包含尚不支持的适配器或依赖。')
        }
        if (selected.dependencies?.length) {
          const { data: lock } = await backend.request('installations/resolve', { method: 'POST', signal, body: { requirements: [{ assetId: request.id, versionRange: selected.version }], installationUid: createHash('sha256').update(home).digest('hex').slice(0, 32).replace(/^(.{8})(.{4})(.{4})(.{4})(.{12})$/, '$1-$2-$3-$4-$5'), target: { os: process.platform === 'win32' ? 'windows' : process.platform, arch: process.arch, runtimes: ['prompt_only', 'node', 'python'], transports: ['stdio', 'http', 'sse'] } } })
          if (lock?.schemaVersion !== 'stratex.registry-lock/v1' || !lock.capabilities?.some(item => item.assetId === request.id)) throw new ConnectorError('连接器安装依赖解析结果无效。')
          const account = await backend.account()
          const skills = lock.capabilities.filter(item => item.assetType === 'skill')
          if (skills.length) {
            const service = ctx.get('sealHarnessSkills')
            if (!service) throw new ConnectorError('技能插件未加载。')
            await service.call('installResolved', { items: skills }, signal)
          }
          for (const item of lock.capabilities.filter(item => item.assetType === 'mcp')) await serial(() => installResolved(item, account, signal))
          await backend.assertAccount(account)
          await backend.request(`installations/${encodeURIComponent(lock.resolutionId)}/result`, { method: 'POST', signal, body: { status: 'succeeded', versions: Object.fromEntries(lock.capabilities.map(item => [item.assetId, item.version])) } })
          return list()
        }
        let directory, adapter
        if (selected.descriptor.transport === 'stdio' || selected.descriptor.workspaceBootstrap || selected.descriptor.entrypoint || asset.sourceType === 'http_adapter' || asset.metadata?.sourceType === 'http_adapter') {
          directory = join(home, 'seal-harness-capabilities', 'connectors', request.id, createHash('sha256').update(selected.version).digest('hex'))
          const downloaded = await downloadPackage(backend, request.id, selected.version, selected.artifact, directory, signal)
          if (asset.sourceType === 'http_adapter' || asset.metadata?.sourceType === 'http_adapter') adapter = httpAdapter.adapterSchema.parse(JSON.parse(await readFile(join(directory, 'stratex-http-adapter.json'), 'utf8')))
        }
        const config = fromDescriptor({ id: request.id, name: asset.name, summary: asset.summary, category: asset.category, version: selected.version, descriptor: selected.descriptor, accountId: session.accountId, directory, adapter })
        if (entries.some(entry => entry.id === config.id)) throw new ConnectorError('此连接器已经安装；请在连接器页面管理。')
        const current = await currentSession()
        if (current?.accountId !== session.accountId || current?.epoch !== session.epoch) throw new ConnectorError('当前账号已变化，请重新安装。')
        return serial(() => mutate({ id: config.id }, () => config, signal))
      },
    },
    async dispose() {
      disposed = true
      packagePreview = undefined
      oauth.dispose()
      unsubscribe?.()
      clearSessionRestrictions()
      knownSessions.clear()
      await Promise.all([...running.keys()].map(stop))
      await chain
      releaseGuard?.(); releaseExecution(); releaseAgentCreated(); releaseAgentDisposed()
      outcomes.clear()
    },
  }
}
