import { createHash, randomUUID } from 'node:crypto'
import { readFile, writeFile, mkdir, cp, readdir, chmod, rm, copyFile } from 'node:fs/promises'
import { resolve, join, relative, isAbsolute } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const executeFile = promisify(execFile)
const pluginRoot = resolve(import.meta.dirname, '..'), repository = resolve(pluginRoot, '../../..')
const require = createRequire(join(pluginRoot, 'package.json'))
const manifestPath = join(pluginRoot, 'assets/driver-manifest.json')
const digest = bytes => createHash('sha256').update(bytes).digest('hex')
const assertWithin = (parent, target) => { const part = relative(parent, target); if (!part || part.startsWith('..') || isAbsolute(part)) throw Error('驱动缓存路径超出预期目录。') }

export async function verifyArchive(file, asset) {
  const bytes = await readFile(file)
  if (bytes.length !== asset.bytes || digest(bytes) !== asset.sha256) throw Error('Cua Driver 归档校验失败，拒绝装配。')
  return bytes
}
async function ensureArchive(file, asset, fetcher) {
  try { return await verifyArchive(file, asset) } catch (error) { if (error.code !== 'ENOENT') throw error }
  const response = await fetcher(asset.url, { signal: AbortSignal.timeout(180000) })
  if (!response.ok) throw Error(`Cua Driver 下载失败（HTTP ${response.status}）。`)
  const length = Number(response.headers.get('content-length') ?? 0)
  if (length && length !== asset.bytes) throw Error('Cua Driver 下载大小与固定资产不一致。')
  const bytes = Buffer.from(await response.arrayBuffer())
  if (bytes.length !== asset.bytes || digest(bytes) !== asset.sha256) throw Error('Cua Driver 下载校验失败。')
  await writeFile(file, bytes, { flag: 'wx' })
  return bytes
}
function validEntry(name) {
  const path = name.replaceAll('\\', '/')
  return !path.startsWith('/') && !/^[a-z]:/i.test(path) && !path.split('/').includes('..')
}
async function extractArchive(bytes, file, destination) {
  if (file.endsWith('.zip')) {
    const Zip = require('adm-zip'), zip = new Zip(bytes)
    if (zip.getEntries().some(entry => !validEntry(entry.entryName) || (entry.header.attr >>> 16 & 0o170000) === 0o120000)) throw Error('驱动 ZIP 含不安全路径或符号链接。')
    zip.extractAllTo(destination, false)
  } else {
    const { stdout } = await executeFile('tar', ['-tzf', file], { maxBuffer: 2 * 1024 * 1024, windowsHide: true })
    if (stdout.split(/\r?\n/).filter(Boolean).some(name => !validEntry(name))) throw Error('驱动归档含不安全路径。')
    await executeFile('tar', ['-xzf', file, '-C', destination], { windowsHide: true })
  }
}
async function findDriver(directory, filename) {
  for (const entry of await readdir(directory, { withFileTypes: true })) if (entry.isFile() && entry.name === filename) return join(directory, entry.name)
  for (const entry of await readdir(directory, { withFileTypes: true })) if (entry.isDirectory()) {
    const found = await findDriver(join(directory, entry.name), filename)
    if (found) return found
  }
}

export async function prepareDriver({ platform = process.platform, arch = process.arch,
  cache = join(repository, '.build/cua-driver-assets'), destination = join(pluginRoot, 'lib/runtime'), fetcher = fetch } = {}) {
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8')), key = `${platform}-${arch}`, asset = manifest.assets[key]
  if (!asset) throw Error(`没有适用于 ${key} 的固定 Cua Driver 资产。`)
  const cacheRoot = resolve(cache), target = join(resolve(destination), key)
  await mkdir(cacheRoot, { recursive: true })
  const archive = join(cacheRoot, asset.filename), stage = join(cacheRoot, `extract-${randomUUID()}`)
  assertWithin(cacheRoot, archive); assertWithin(cacheRoot, stage)
  const bytes = await ensureArchive(archive, asset, fetcher)
  await mkdir(stage)
  try {
    await extractArchive(bytes, archive, stage)
    const filename = platform === 'win32' ? 'cua-driver.exe' : 'cua-driver', executable = await findDriver(stage, filename)
    if (!executable) throw Error('驱动资产缺少预期可执行文件。')
    await mkdir(target, { recursive: true })
    await cp(stage, target, { recursive: true, dereference: false, verbatimSymlinks: true })
    const installed = join(target, filename)
    if (resolve(join(target, relative(stage, executable))) !== resolve(installed)) await copyFile(executable, installed)
    if (platform !== 'win32') await chmod(installed, 0o755)
    const executableSha256 = digest(await readFile(installed))
    const provenance = { schemaVersion: 1, version: manifest.version, tag: manifest.tag, prerelease: manifest.prerelease,
      sourceCommit: manifest.sourceCommit, platform, arch, asset, executable: filename, executableSha256 }
    await writeFile(join(target, 'provenance.json'), JSON.stringify(provenance, null, 2) + '\n')
    await copyFile(join(pluginRoot, 'assets/CUA-LICENSE.txt'), join(target, 'CUA-LICENSE.txt'))
    await copyFile(join(pluginRoot, 'assets/CUA-THIRD-PARTY-NOTICES.md'), join(target, 'CUA-THIRD-PARTY-NOTICES.md'))
    await copyFile(manifestPath, join(resolve(destination), 'driver-manifest.json'))
    return { executable: installed, provenance }
  } finally {
    assertWithin(cacheRoot, stage)
    await rm(stage, { recursive: true, force: true })
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.includes('--help')) console.log('准备固定版本 Cua Driver（下载、SHA256校验、装配到lib/runtime）。\n示例：node seal-harness-desktop/plugins/computer-use/scripts/prepare-driver.mjs --platform win32 --arch x64\n可选：--cache 归档缓存目录 --destination 构建资源目录')
  else {
    const args = process.argv.slice(2), options = {}
    for (let index = 0; index < args.length; index += 2) {
      const flag = args[index].replace(/^--/, '')
      if (!['platform', 'arch', 'cache', 'destination'].includes(flag) || !args[index + 1]) throw Error('参数无效，请运行 --help。')
      options[flag] = args[index + 1]
    }
    const result = await prepareDriver(options)
    console.log(`Cua Driver ${result.provenance.version} 已校验并装配：${result.executable}`)
  }
}
