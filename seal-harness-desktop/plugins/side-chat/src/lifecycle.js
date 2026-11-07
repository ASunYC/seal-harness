import { randomUUID } from 'node:crypto'
import { lstat, readdir, rm } from 'node:fs/promises'
import { homedir } from 'node:os'
import { isAbsolute, join, relative, resolve } from 'node:path'
import { resolveDshHome } from '@deepseek-ai/dsh-home-paths'
import { jsonlSessionDir } from '../../session-context-selector/src/deletion.js'

const sideChatIdPattern = /^seal-side-chat-[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu

export function isSideChatId(sessionId) {
  return typeof sessionId === 'string' && sideChatIdPattern.test(sessionId)
}

function sideChatError(code, message) {
  return Object.assign(new Error(message), { code })
}

function inside(root, target) {
  const resolvedRoot = resolve(root)
  const resolvedTarget = resolve(target)
  const path = relative(resolvedRoot, resolvedTarget)
  if (!path || path.startsWith('..') || isAbsolute(path))
    throw sideChatError('unsafePath', '侧聊记录路径无效。')
  return resolvedTarget
}

async function removeSafe(path, options) {
  let entry
  try { entry = await lstat(path) }
  catch (error) { if (error?.code === 'ENOENT') return; throw error }
  if (entry.isSymbolicLink()) throw sideChatError('unsafePath', '侧聊记录不能是符号链接。')
  if (options?.recursive && !entry.isDirectory()) throw sideChatError('unsafePath', '侧聊记录目录格式无效。')
  await rm(path, options)
}

export function createSideChatLifecycle({ agents, agentDefaultModel, agentPresets, sessionPersistence, workspaceRegistry, emit = () => {}, home = resolveDshHome(process.env.DSH_HOME || join(homedir(), '.seal-harness')) }) {
  const handles = new Map()

  async function compose() {
    const { provider, model } = agentDefaultModel.currentSelection()
    const preset = agentPresets ? await agentPresets.resolve(undefined) : undefined
    return {
      agentOptions: { provider, model },
      ...preset ? { agentPreset: preset.id, setup: async agentCtx => { await agentPresets.mount(agentCtx, preset.id) } } : {},
    }
  }

  async function detachLegacy(sessionId) {
    for (const workspace of workspaceRegistry.list())
      if (workspace.sessionIds.includes(sessionId)) await workspace.detachSession(sessionId)
    if (workspaceRegistry.archivedSessionIds.includes(sessionId))
      await workspaceRegistry.unarchiveSession(sessionId)
  }

  async function create(parentSessionId) {
    const workspace = workspaceRegistry.list().find(item => item.sessionIds.includes(parentSessionId))
    if (!workspace) throw sideChatError('workspaceNotFound', '主会话不属于工作区。')
    const sessionId = `seal-side-chat-${randomUUID()}`
    const composition = await compose()
    const handle = await agents.create({
      sessionId, agentOptions: composition.agentOptions,
      meta: { cwd: workspace.path, ...composition.agentPreset ? { agentPreset: composition.agentPreset } : {} },
      ...composition.setup ? { setup: composition.setup } : {},
    })
    handles.set(sessionId, handle)
    return { sessionId }
  }

  async function ensure(sessionId) {
    if (!isSideChatId(sessionId)) throw sideChatError('invalidSideChatId', '侧聊标识无效。')
    if (handles.has(sessionId)) return { sessionId }
    if (agents.get(sessionId)) throw sideChatError('sessionActive', '侧聊仍由旧版本持有，请重启 Seal Harness。')
    const stored = await sessionPersistence.stat(sessionId)
    if (!stored) throw sideChatError('sessionNotFound', '侧聊记录不存在。')
    const composition = await compose()
    const handle = await agents.resume({
      resumeSessionId: sessionId, agentOptions: composition.agentOptions,
      ...composition.setup ? { setup: composition.setup } : {},
    })
    handles.set(sessionId, handle)
    await detachLegacy(sessionId)
    return { sessionId }
  }

  async function close(sessionId) {
    if (!isSideChatId(sessionId)) throw sideChatError('invalidSideChatId', '侧聊标识无效。')
    const handle = handles.get(sessionId)
    if (handle) {
      await handle.dispose()
      handles.delete(sessionId)
    } else if (agents.get(sessionId)) {
      throw sideChatError('sessionActive', '侧聊仍在运行，无法清理。')
    }
    await detachLegacy(sessionId)
    const stored = await sessionPersistence.stat(sessionId)
    const projectionsRoot = resolve(home, 'storages', 'session_projcache', 'sessions')
    const projectionPath = inside(projectionsRoot, join(projectionsRoot, `${sessionId}.json`))
    if (stored) {
      const sessionsRoot = resolve(home, 'sessions')
      const sessionPath = inside(sessionsRoot, jsonlSessionDir(sessionsRoot, stored.header.cwd, sessionId))
      await removeSafe(sessionPath, { recursive: true, force: true })
    }
    emit('api-session/removed', sessionId)
    await removeSafe(projectionPath, { force: true })
    return { sessionId }
  }

  async function migrateLegacy() {
    for (const workspace of workspaceRegistry.list())
      for (const sessionId of workspace.sessionIds)
        if (isSideChatId(sessionId)) await detachLegacy(sessionId)
  }

  async function prune(keepIds) {
    if (!Array.isArray(keepIds) || keepIds.some(id => !isSideChatId(id)))
      throw sideChatError('invalidSideChatId', '侧聊保留列表无效。')
    const kept = new Set(keepIds)
    const stored = await sessionPersistence.list()
    const orphans = stored.filter(item => isSideChatId(item.header.id) && !kept.has(item.header.id) && !handles.has(item.header.id))
    for (const item of orphans) await close(item.header.id)
    const projectionsRoot = resolve(home, 'storages', 'session_projcache', 'sessions')
    let projectionFiles = []
    try { projectionFiles = await readdir(projectionsRoot) }
    catch (error) { if (error?.code !== 'ENOENT') throw error }
    const removedIds = new Set(orphans.map(item => item.header.id))
    const storedIds = new Set(stored.filter(item => !removedIds.has(item.header.id)).map(item => item.header.id))
    const cacheOrphans = projectionFiles
      .filter(file => file.endsWith('.json'))
      .map(file => ({ file, sessionId: file.slice(0, -5) }))
      .filter(({ sessionId }) => isSideChatId(sessionId) && !storedIds.has(sessionId) && !kept.has(sessionId) && !handles.has(sessionId))
    for (const { file } of cacheOrphans)
      await removeSafe(inside(projectionsRoot, join(projectionsRoot, file)), { force: true })
    return { removed: orphans.length, orphanCaches: cacheOrphans.length }
  }

  async function dispose() {
    await Promise.all([...handles.values()].map(handle => handle.dispose()))
    handles.clear()
  }

  return { create, ensure, close, prune, migrateLegacy, dispose }
}
