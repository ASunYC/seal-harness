import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile, chmod } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'
import { readArchive, safeRelative } from '../../skills/src/package.js'
import { ConnectorError } from './schema.js'

export const MAX_CONNECTOR_PACKAGE_BYTES = 200 * 1024 * 1024
export const MAX_CONNECTOR_PACKAGE_EXPANDED_BYTES = 1024 * 1024 * 1024

function relative(path, message = '连接器包包含无效路径。') {
  try { return safeRelative(path) } catch { throw new ConnectorError(message) }
}

function verifyPackageFiles(files, descriptor) {
  const byPath = new Map(files.map(file => [file.path, file]))
  const executable = descriptor.transport === 'stdio' ? relative(descriptor.executable, '连接器包缺少有效的 STDIO 启动文件。') : undefined
  if (executable && !byPath.has(executable)) throw new ConnectorError('连接器包中找不到 descriptor.json 指定的 STDIO 启动文件。')
  for (const expected of descriptor.files ?? []) {
    const file = byPath.get(relative(expected.path))
    if (!file || file.bytes.length !== expected.sizeBytes || createHash('sha256').update(file.bytes).digest('hex') !== expected.sha256) throw new ConnectorError('连接器文件完整性检查失败。')
  }
  return executable
}

export function inspectLocalPackage(bytes, fileName = 'connector.zip') {
  try {
    if (!Buffer.isBuffer(bytes)) bytes = Buffer.from(bytes)
    if (!bytes.length || bytes.length > MAX_CONNECTOR_PACKAGE_BYTES) throw new ConnectorError('请选择不超过 200 MiB 的连接器 ZIP 包。')
    const files = readArchive(bytes, { maxPackageBytes: MAX_CONNECTOR_PACKAGE_BYTES, maxFileBytes: MAX_CONNECTOR_PACKAGE_BYTES, maxExpandedBytes: MAX_CONNECTOR_PACKAGE_EXPANDED_BYTES })
    const descriptorFile = files.find(file => file.path === 'descriptor.json')
    if (!descriptorFile) throw new ConnectorError('连接器包缺少 descriptor.json。')
    let descriptor
    try { descriptor = JSON.parse(descriptorFile.bytes.toString('utf8')) } catch { throw new ConnectorError('descriptor.json 不是有效的 JSON。') }
    if (!descriptor || descriptor.schemaVersion !== 'stratex.capability/v1' || descriptor.transport !== 'stdio') throw new ConnectorError('这里只能安装 Stratex STDIO 连接器包。')
    const executable = verifyPackageFiles(files, descriptor)
    const fallbackName = basename(fileName).replace(/\.zip$/iu, '').trim() || '本地 MCP 连接器'
    return {
      files,
      descriptor,
      hash: createHash('sha256').update(bytes).digest('hex'),
      preview: {
        name: typeof descriptor.name === 'string' && descriptor.name.trim() ? descriptor.name.trim() : fallbackName,
        summary: typeof descriptor.description === 'string' ? descriptor.description : '',
        version: typeof descriptor.version === 'string' && descriptor.version.trim() ? descriptor.version.trim() : '0.0.0-local',
        executable,
        args: Array.isArray(descriptor.args) ? descriptor.args : [],
        requiredEnv: Array.isArray(descriptor.environmentSlots) ? descriptor.environmentSlots.filter(slot => slot?.required !== false && typeof slot?.name === 'string').map(slot => slot.name) : [],
        fileCount: files.length,
        byteSize: files.reduce((total, file) => total + file.bytes.length, 0),
      },
    }
  } catch (error) {
    if (error instanceof ConnectorError) throw error
    throw new ConnectorError(error?.message || '无法读取连接器 ZIP 包。')
  }
}

export async function materializePackage(files, directory, descriptor) {
  verifyPackageFiles(files, descriptor)
  for (const file of files) {
    const target = join(directory, relative(file.path))
    await mkdir(dirname(target), { recursive: true })
    try { await writeFile(target, file.bytes, { flag: 'wx', mode: file.mode ?? 0o644 }) }
    catch (error) { if (error.code !== 'EEXIST' || !(await readFile(target)).equals(file.bytes)) throw new ConnectorError('连接器安装目录已有不同内容。') }
  }
  for (const file of descriptor.files ?? []) {
    const bytes = await readFile(join(directory, relative(file.path)))
    if (bytes.length !== file.sizeBytes || createHash('sha256').update(bytes).digest('hex') !== file.sha256) throw new ConnectorError('连接器文件完整性检查失败。')
  }
  for (const executable of [descriptor.executable, descriptor.workspaceBootstrap?.executable].filter(Boolean)) await chmod(join(directory, relative(executable)), 0o755)
  return directory
}

export async function downloadPackage(backend, id, version, artifact, directory, signal) {
  if (!artifact || !/^[a-f0-9]{64}$/.test(artifact.sha256) || !Number.isSafeInteger(artifact.sizeBytes) || artifact.sizeBytes < 1 || artifact.sizeBytes > 64 * 1024 * 1024) throw new ConnectorError('连接器包缺少有效的大小和 SHA-256 信息。')
  const { bytes } = await backend.download(`mcps/${encodeURIComponent(id)}/versions/${encodeURIComponent(version)}/export`, { signal, maxBytes: artifact.sizeBytes })
  if (bytes.length !== artifact.sizeBytes || createHash('sha256').update(bytes).digest('hex') !== artifact.sha256) throw new ConnectorError('连接器下载完整性检查失败。')
  const files = readArchive(bytes)
  const descriptor = JSON.parse(files.find(file => file.path === 'descriptor.json')?.bytes.toString('utf8') ?? 'null')
  if (!descriptor) throw new ConnectorError('连接器包缺少 descriptor.json。')
  await materializePackage(files, directory, descriptor)
  return { directory, descriptor, files }
}
