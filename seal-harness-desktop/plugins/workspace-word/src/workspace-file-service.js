import { copyFile, lstat, realpath } from 'node:fs/promises'
import { basename, isAbsolute, relative, sep } from 'node:path'
import { z } from 'zod'

export class WorkspaceFileError extends Error {
  constructor(code, message) { super(message); this.code = code }
}

const fileInput = z.strictObject({ sessionId: z.string().min(1), path: z.string().min(1).max(4096) })
const inside = (root, path) => {
  const part = relative(root, path)
  return part !== '' && part !== '..' && !part.startsWith(`..${sep}`) && !isAbsolute(part)
}

export class WorkspaceFileService {
  constructor({ sessions, sandboxPolicy, fs, native }) {
    this.sessions = sessions
    this.sandboxPolicy = sandboxPolicy
    this.fs = fs
    this.native = native
  }

  async target(input) {
    const { sessionId, path } = fileInput.parse(input)
    const header = this.sessions.get(sessionId)?.header
    if (!header) throw new WorkspaceFileError('sessionUnavailable', '原会话已关闭，请重新打开工作区。')
    const workspace = header.cwd ?? this.sandboxPolicy.workspaceRoot
    if (!isAbsolute(workspace) || !this.fs.processPathFromHostPath(workspace))
      throw new WorkspaceFileError('workspaceUnavailable', '此工作区没有本机文件映射。')
    if (!isAbsolute(path) || path.includes('\0')) throw new WorkspaceFileError('invalidPath', '文件路径无效。')
    const root = await realpath(workspace)
    let entry
    try { entry = await lstat(path) }
    catch (error) {
      if (error.code === 'ENOENT') throw new WorkspaceFileError('notFound', '文件已不存在，请刷新列表。')
      throw error
    }
    if (!entry.isFile() || entry.isSymbolicLink() || entry.nlink !== 1)
      throw new WorkspaceFileError('invalidPath', '只能操作工作区内的普通文件。')
    const target = await realpath(path)
    if (!inside(root, target)) throw new WorkspaceFileError('outsideWorkspace', '文件不在此会话的工作区内。')
    return target
  }

  async openSystem(input) {
    const target = await this.target(input)
    const error = await this.native.openPath(target)
    if (error) throw new WorkspaceFileError('openFailed', `系统应用打开失败：${error}`)
    return { opened: true }
  }

  async saveCopy(input) {
    const target = await this.target(input)
    const path = await this.native.savePath(basename(target))
    if (!path) return { cancelled: true }
    if (path === target) throw new WorkspaceFileError('samePath', '请选择原文件以外的保存位置。')
    // 选定目标后再次验证来源，避免原文件在系统对话框期间被替换。
    if (await this.target(input) !== target) throw new WorkspaceFileError('sourceChanged', '文件已变化，请重试。')
    try { await copyFile(target, path) }
    catch { throw new WorkspaceFileError('saveFailed', '保存副本失败，请检查目标位置后重试。') }
    return { path }
  }

  async trash(input) {
    const target = await this.target(input)
    try { await this.native.trashItem(target) }
    catch { throw new WorkspaceFileError('deleteFailed', '移到回收站失败，请检查文件是否被占用。') }
    return { deleted: true }
  }
}
