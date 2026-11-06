import { createHash, randomUUID } from 'node:crypto'
import { createReadStream, createWriteStream } from 'node:fs'
import { lstat, mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import { Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { AppError, digest, removeManaged } from './installer.js'

const MAX_FILES = 50000
const MAX_BYTES = 5 * 1024 * 1024 * 1024
const SHA = /^[a-f0-9]{64}$/

function safePath(value) {
  if (typeof value !== 'string' || !value || value.includes('\\') || value.startsWith('/') || value.split('/').some(part =>
    !part || part === '.' || part === '..' || /[<>:"|?*\x00-\x1f]/.test(part) || /[. ]$/.test(part)
    || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\.|$)/i.test(part))) throw new AppError('发布包包含不安全的文件路径。')
  return value
}

export async function inspectLocalRelease(sourcePath, expectedSha256) {
  if (!SHA.test(expectedSha256)) throw new AppError('应用清单校验值未配置。')
  if (typeof sourcePath !== 'string' || !sourcePath.trim() || sourcePath.length > 2048) throw new AppError('请选择已解压的 BuildingBuilt 发布目录。')
  const supplied = sourcePath.trim().replace(/^"(.*)"$/, '$1')
  if (!isAbsolute(supplied)) throw new AppError('请输入 BuildingBuilt 发布目录的绝对路径。')
  const source = resolve(supplied)
  const rootInfo = await lstat(source).catch(() => null)
  if (!rootInfo?.isDirectory() || rootInfo.isSymbolicLink()) throw new AppError('发布目录不存在或不是普通目录。')
  const manifestPath = join(source, 'release.json')
  const manifestInfo = await lstat(manifestPath).catch(() => null)
  if (!manifestInfo?.isFile() || manifestInfo.isSymbolicLink() || manifestInfo.size > 8 * 1024 * 1024) throw new AppError('BuildingBuilt 发布清单不存在或过大。')
  const bytes = await readFile(manifestPath)
  if (digest(bytes) !== expectedSha256) throw new AppError('BuildingBuilt 发布清单校验失败，请使用指定版本的官方发布包。')
  let manifest
  try { manifest = JSON.parse(bytes.toString('utf8')) } catch { throw new AppError('BuildingBuilt 发布清单不是有效 JSON。') }
  if (manifest.id !== 'buildingbuilt' || manifest.platform !== 'win32' || manifest.arch !== 'x64' || manifest.entry !== 'BuildingBuilt.exe'
    || !Array.isArray(manifest.files) || !manifest.files.length || manifest.files.length > MAX_FILES) throw new AppError('BuildingBuilt 发布清单格式无效。')
  const seen = new Set()
  let total = 0
  for (const file of manifest.files) {
    const path = safePath(file.path)
    const key = path.toLowerCase()
    if (seen.has(key) || key === 'release.json') throw new AppError('发布清单包含重复文件。')
    seen.add(key)
    if (!Number.isSafeInteger(file.size) || file.size < 0 || !SHA.test(file.sha256)) throw new AppError('发布清单包含无效文件摘要。')
    total += file.size
    if (total > MAX_BYTES) throw new AppError('BuildingBuilt 发布包超过大小限制。')
  }
  if (!seen.has('buildingbuilt.exe')) throw new AppError('BuildingBuilt.exe 不在发布清单中。')
  return { source, manifest, bytes, total }
}

async function checkOrdinarySource(source, file) {
  let current = source
  for (const part of file.split('/')) {
    current = join(current, part)
    const info = await lstat(current)
    if (info.isSymbolicLink()) throw new AppError('发布包不能包含符号链接或联接。')
  }
  if (!(await lstat(current)).isFile()) throw new AppError('发布清单中的文件不是普通文件。')
  return current
}

export async function installLocalRelease(root, release, signal, progress = () => {}, commit = async () => {}) {
  await mkdir(root, { recursive: true })
  const stage = join(root, `stage-${randomUUID()}`)
  const runtime = join(root, 'runtime')
  const backup = join(root, `backup-${randomUUID()}`)
  await mkdir(stage)
  let replaced = false
  try {
    let copied = 0
    for (const file of release.manifest.files) {
      signal.throwIfAborted()
      const from = await checkOrdinarySource(release.source, file.path)
      const to = join(stage, ...file.path.split('/'))
      await mkdir(dirname(to), { recursive: true })
      const hash = createHash('sha256')
      await pipeline(createReadStream(from), new Transform({ transform(chunk, _encoding, callback) {
        hash.update(chunk); callback(null, chunk)
      } }), createWriteStream(to, { flags: 'wx' }), { signal })
      if ((await stat(to)).size !== file.size || hash.digest('hex') !== file.sha256) throw new AppError(`发布包文件校验失败：${file.path}`)
      copied += file.size
      progress({ phase: '安装 BuildingBuilt', received: copied, total: release.total })
    }
    await writeFile(join(stage, 'release.json'), release.bytes, { flag: 'wx' })
    signal.throwIfAborted()
    const entry = release.manifest.files.find(file => file.path === release.manifest.entry)
    const existing = await lstat(runtime).catch(error => { if (error.code === 'ENOENT') return null; throw error })
    if (existing?.isSymbolicLink()) throw new AppError('应用安装目录不能是符号链接或联接。')
    if (existing) { await rename(runtime, backup); replaced = true }
    try {
      await rename(stage, runtime)
      signal.throwIfAborted()
      await commit(entry)
    } catch (error) {
      await removeManaged(root, runtime)
      if (replaced) await rename(backup, runtime)
      throw error
    }
    // 安装已提交，旧版清理失败不应回滚数据库记录和新程序。
    if (replaced) await removeManaged(root, backup).catch(error => { progress({ phase: `旧版清理待重试：${error.message}`, received: release.total, total: release.total }) })
    return entry
  } finally {
    await removeManaged(root, stage)
  }
}
