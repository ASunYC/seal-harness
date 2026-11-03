import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { cpSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, realpathSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { isAbsolute, join, relative, resolve } from 'node:path'

export const officePackage = 'dsh-univer-office'
export const officeVersion = '0.3.9'
export const officeSourceCommit = 'c59332186fbd0051596b6ef5d73b8322204ad1d5'
const payload = ['lib', 'artifacts', 'docs', 'skills', 'scripts', 'package.json', 'cordis.patch.yml', 'LICENSE', 'README.md', 'README.zh-CN.md']

function readJson(path) { return JSON.parse(readFileSync(path, 'utf8')) }
function inside(parent, child) {
  const path = relative(parent, child)
  return path !== '' && !isAbsolute(path) && path !== '..' && !path.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`)
}

// 只从仓库受锁文件管理的依赖装配，不接受用户 Profile 作为来源。
export function stageOfficeBundle(root, desktop, productDirectory) {
  const source = join(root, 'node_modules', officePackage)
  if (!existsSync(join(source, 'package.json'))) {
    throw new Error('Office 随包依赖尚未准备；先确认分发许可，再将 dsh-univer-office@0.3.9 纳入根 Yarn 锁文件。禁止从用户 Profile 复制。')
  }
  assert.ok(inside(realpathSync(root), realpathSync(source)), 'Office 来源必须在工程内部')
  const manifest = readJson(join(source, 'package.json'))
  assert.equal(manifest.name, officePackage)
  assert.equal(manifest.version, officeVersion)
  assert.equal(readJson(join(source, 'lib/build-info.json')).commit, officeSourceCommit)
  assert.equal(readJson(join(root, 'package.json')).devDependencies?.[officePackage], officeVersion, 'Office 必须由根工作区固定版本')
  assert.ok(readFileSync(join(root, 'yarn.lock'), 'utf8').includes(`${officePackage}@npm:${officeVersion}`), 'Office 必须纳入根 Yarn 锁文件')
  assert.ok(inside(realpathSync(root), realpathSync(join(desktop, 'node_modules'))), 'Office 装配区必须在工程内部')
  assert.ok(inside(realpathSync(join(desktop, 'node_modules')), realpathSync(productDirectory)), '产品配置必须位于当前工程装配区')
  const destination = join(desktop, 'node_modules', officePackage)
  assert.ok(inside(resolve(desktop, 'node_modules'), resolve(destination)))
  // 先在装配区完成整套依赖；失败不能留下看似完整的 Office 包。
  const temporary = `${destination}.staging`
  assert.ok(inside(resolve(desktop, 'node_modules'), resolve(temporary)))
  if (existsSync(temporary)) throw new Error('Office 装配暂存目录已存在，请检查上次失败记录。')
  mkdirSync(temporary, { recursive: true })
  try {
    for (const file of payload) cpSync(join(source, file), join(temporary, file), { recursive: true, dereference: true })
    copyDependencies(root, source, temporary)
    verifyOfficeBundle(temporary)
    if (existsSync(destination) && lstatSync(destination).isSymbolicLink()) throw new Error('Office 装配目标不得是符号链接')
    const previous = `${destination}.previous`
    if (existsSync(previous)) throw new Error('Office 装配备份已存在，请检查上次失败记录。')
    const replacing = existsSync(destination)
    if (replacing) renameSync(destination, previous)
    try {
      renameSync(temporary, destination)
    } catch (error) {
      if (replacing) renameSync(previous, destination)
      throw error
    }
    if (replacing) rmSync(previous, { recursive: true })
  } finally {
    rmSync(temporary, { recursive: true, force: true })
  }
  const productManifestPath = join(productDirectory, 'package.json')
  const productManifest = readJson(productManifestPath)
  const original = productManifest.dsh.bundle.patch
  productManifest.dsh.bundle.patch = [...new Set([...(Array.isArray(original) ? original : [original]), './office.patch.yml'])]
  productManifest.dependencies = { ...productManifest.dependencies, [officePackage]: officeVersion }
  writeFileSync(join(productDirectory, 'office.patch.yml'), '- insert:\n    - id: univer\n      name: dsh-univer-office\n      config:\n        telemetry: false\n')
  writeFileSync(productManifestPath, `${JSON.stringify(productManifest, null, 2)}\n`)
}

function copyDependencies(root, source, destination, ancestors = new Set()) {
  const actual = realpathSync(source)
  if (ancestors.has(actual)) throw new Error('Office 运行依赖存在循环，请在装配前审查依赖图')
  const next = new Set([...ancestors, actual])
  const manifest = readJson(join(source, 'package.json'))
  const resolver = createRequire(join(source, 'package.json'))
  for (const name of new Set([...Object.keys(manifest.dependencies ?? {}), ...Object.keys(manifest.optionalDependencies ?? {})])) {
    const dependency = resolver.resolve.paths(name).map(directory => join(directory, name)).find(path => existsSync(join(path, 'package.json')))
    if (!dependency && name in (manifest.optionalDependencies ?? {})) continue
    if (!dependency) throw new Error(`缺少 Office 运行依赖 ${name}`)
    assert.ok(inside(realpathSync(root), realpathSync(dependency)), `依赖 ${name} 来源超出工程`)
    const target = join(destination, 'node_modules', name)
    mkdirSync(target, { recursive: true })
    for (const entry of readdirSync(dependency).sort()) {
      if (entry === 'node_modules' || entry.startsWith('.')) continue
      cpSync(join(dependency, entry), join(target, entry), { recursive: true, dereference: true })
    }
    copyDependencies(root, dependency, target, next)
  }
}

export function verifyOfficeBundle(directory) {
  const manifest = readJson(join(directory, 'package.json'))
  assert.equal(manifest.name, officePackage)
  assert.equal(manifest.version, officeVersion)
  assert.equal(readJson(join(directory, 'lib/build-info.json')).commit, officeSourceCommit)
  for (const file of ['LICENSE', 'lib/index.js', 'lib/client.js', 'artifacts/gateway.cjs', 'artifacts/unit-content-worker.mjs', 'artifacts/collaboration-runtime-worker.mjs', 'artifacts/viewer/index.html', 'artifacts/render-machine/index.html']) {
    assert.ok(readFileSync(join(directory, file)).length > 0, `Office 包缺少 ${file}`)
  }
}
