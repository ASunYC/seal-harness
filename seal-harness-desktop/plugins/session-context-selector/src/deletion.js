import { lstat, rename, rm } from 'node:fs/promises'
import { isAbsolute, join, relative, resolve } from 'node:path'
import { randomUUID } from 'node:crypto'

const sessionIdPattern = /^session-[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function encodeSegment(raw) {
  if (!raw) throw new Error('cannot encode an empty path segment')
  if (raw === '.') return '~002E'
  if (raw === '..') return '~002E~002E'
  let output = ''
  for (let index = 0; index < raw.length; index += 1) {
    const code = raw.charCodeAt(index)
    const character = String.fromCharCode(code)
    output += character !== '~' && /^[A-Za-z0-9._-]$/.test(character)
      ? character
      : `~${code.toString(16).toUpperCase().padStart(4, '0')}`
  }
  return output
}

function projectKey(cwd) {
  if (!cwd) throw new Error('cannot encode an empty project path')
  let readable = ''
  let separatorRun = false
  for (let index = 0; index < cwd.length; index += 1) {
    const code = cwd.charCodeAt(index)
    const character = String.fromCharCode(code)
    if (character === '/' || character === '\\' || character === ':') {
      if (!separatorRun) readable += '-'
      separatorRun = true
    } else if (character !== '~' && /^[A-Za-z0-9._-]$/.test(character)) {
      readable += character
      separatorRun = false
    } else {
      readable += `~${code.toString(16).toUpperCase().padStart(4, '0')}`
      separatorRun = false
    }
  }
  return `--${(readable.replace(/^-+/, '') || 'root').slice(0, 251)}--`
}

/** 与当前 JSONL 后端的公开磁盘布局保持一致，直到上游提供删除接口。 */
export function jsonlSessionDir(root, cwd, sessionId) {
  return join(root, cwd === undefined ? '_no-cwd' : projectKey(cwd), encodeSegment(sessionId))
}

function deletionError(code, message) {
  return Object.assign(new Error(message), { code })
}

function assertInside(root, target) {
  const resolvedRoot = resolve(root)
  const resolvedTarget = resolve(target)
  const pathFromRoot = relative(resolvedRoot, resolvedTarget)
  if (!pathFromRoot || pathFromRoot.startsWith('..') || isAbsolute(pathFromRoot)) {
    throw deletionError('unsafeSessionPath', '会话数据路径不在允许的存储目录中。')
  }
  return resolvedTarget
}

async function existingPath(path, { directory = false } = {}) {
  try {
    const info = await lstat(path)
    if (info.isSymbolicLink()) throw deletionError('unsafeSessionPath', '会话数据路径不能是符号链接。')
    if (directory && !info.isDirectory()) throw deletionError('invalidSessionStorage', '会话数据目录格式不正确。')
    return true
  } catch (error) {
    if (error?.code === 'ENOENT') return false
    throw error
  }
}

function quarantinePath(path) {
  return `${path}.seal-harness-delete-${randomUUID()}`
}

async function restoreWorkspace(owner, sessionId) {
  if (!owner.workspace.sessionIds.includes(sessionId)) await owner.workspace.attachSession(sessionId)
  await owner.workspace.insertSessionBefore(sessionId, owner.beforeSessionId)
}

export function createSessionDeletion({ home, sessionPersistence, workspaceRegistry, getSessionActivity = async () => [], emit = () => {} }) {
  if (!isAbsolute(home)) throw new Error('Seal Harness Home 必须是绝对路径')

  return {
    async deleteArchivedSession(sessionId) {
      if (!sessionIdPattern.test(sessionId)) throw deletionError('invalidSessionId', '会话标识无效。')
      if (!workspaceRegistry.archivedSessionIds.includes(sessionId)) {
        throw deletionError('sessionNotArchived', '请先归档会话，再执行永久删除。')
      }
      const activity = await getSessionActivity(sessionId)
      if (activity.length > 0) throw deletionError('sessionActive', '会话仍有运行中的任务，请停止后再删除。')

      const snapshot = await sessionPersistence.stat(sessionId)
      if (!snapshot) throw deletionError('sessionNotFound', '找不到要删除的会话数据。')
      const sessionRoot = resolve(home, 'sessions')
      const projectionRoot = resolve(home, 'storages', 'session_projcache', 'sessions')
      const sessionPath = assertInside(sessionRoot, jsonlSessionDir(sessionRoot, snapshot.header.cwd, sessionId))
      const projectionPath = assertInside(projectionRoot, join(projectionRoot, `${sessionId}.json`))
      if (!await existingPath(sessionPath, { directory: true })) {
        throw deletionError('sessionNotFound', '找不到要删除的会话数据。')
      }
      const hasProjection = await existingPath(projectionPath)
      const stagedSessionPath = quarantinePath(sessionPath)
      const stagedProjectionPath = hasProjection ? quarantinePath(projectionPath) : undefined
      const owners = workspaceRegistry.list()
        .filter(workspace => workspace.sessionIds.includes(sessionId))
        .map(workspace => {
          const index = workspace.sessionIds.indexOf(sessionId)
          return { workspace, beforeSessionId: workspace.sessionIds[index + 1] }
        })
      let sessionStaged = false
      let projectionStaged = false

      try {
        await rename(sessionPath, stagedSessionPath)
        sessionStaged = true
        if (stagedProjectionPath) {
          await rename(projectionPath, stagedProjectionPath)
          projectionStaged = true
        }
        for (const owner of owners) await owner.workspace.detachSession(sessionId)
        await workspaceRegistry.unarchiveSession(sessionId)

        // 投影缓存可由日志重建；先清缓存，再删除唯一权威的会话日志。
        if (projectionStaged) {
          await rm(stagedProjectionPath, { force: true })
          projectionStaged = false
        }
        await rm(stagedSessionPath, { recursive: true, force: true })
        sessionStaged = false
      } catch (error) {
        const rollbackErrors = []
        try {
          if (!workspaceRegistry.archivedSessionIds.includes(sessionId)) await workspaceRegistry.archiveSession(sessionId)
        } catch (rollbackError) { rollbackErrors.push(rollbackError) }
        for (const owner of owners) {
          try { await restoreWorkspace(owner, sessionId) } catch (rollbackError) { rollbackErrors.push(rollbackError) }
        }
        try { if (projectionStaged) await rename(stagedProjectionPath, projectionPath) } catch (rollbackError) { rollbackErrors.push(rollbackError) }
        try { if (sessionStaged) await rename(stagedSessionPath, sessionPath) } catch (rollbackError) { rollbackErrors.push(rollbackError) }
        if (rollbackErrors.length) throw new AggregateError([error, ...rollbackErrors], '永久删除失败，且会话状态未能完整恢复。')
        throw error
      }

      emit('api-session/removed', sessionId)
      return { sessionId }
    },
  }
}
