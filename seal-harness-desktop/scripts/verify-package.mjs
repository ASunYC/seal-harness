import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { existsSync, mkdtempSync, readFileSync, rmdirSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { desktop, desktopRequire, product, productPlugins } from './build.mjs'

export async function verifyDistributionArtifacts(result, target) {
  if (target === 'dir') return
  const artifact = suffix => {
    const files = result.artifactPaths.filter(path => path.endsWith(suffix))
    assert.equal(files.length, 1, `应生成一个 ${suffix} 文件`)
    return files[0]
  }
  if (target === 'linux') {
    const { assertAppImage, assertDebArchive } = await import(pathToFileURL(join(desktop, 'scripts/verify-linux-artifacts.ts')))
    assertAppImage(artifact('.AppImage'), 'Seal Harness AppImage')
    assertDebArchive(artifact('.deb'), 'Seal Harness Debian package')
    return
  }
  const AdmZip = desktopRequire('adm-zip')
  const zip = new AdmZip(artifact('.zip'))
  const entry = path => {
    const file = zip.getEntry(path)
    assert.ok(file && !file.isDirectory, `ZIP 缺少 ${path}`)
    return file
  }
  if (target === 'win') {
    const { assertPortableExecutable, assertPortableExecutableBuffer } = await import(pathToFileURL(join(desktop, 'scripts/verify-win-installer.ts')))
    assertPortableExecutable(artifact('.exe'), 'Seal Harness NSIS installer')
    assertPortableExecutableBuffer(entry(`${product.executableName}.exe`).getData(), 'Seal Harness portable', artifact('.zip'))
    entry('resources/app/package.json')
    entry('resources/app/node_modules/seal-harness-desktop/lib/client.js')
  } else if (target === 'mac') {
    const { verifyMacSmoke } = await import(pathToFileURL(join(desktop, 'scripts/verify-mac-smoke.ts')))
    entry(`${product.executableName}.app/Contents/Resources/app/node_modules/seal-harness-desktop/lib/client.js`)
    verifyMacSmoke({
      distDir: result.outDir, productName: product.executableName, listDmgs: () => [artifact('.dmg')],
      makeMountPoint: () => mkdtempSync(join(tmpdir(), 'seal-harness-dmg-')),
      removeMountPoint: rmdirSync, exists: existsSync,
      run: (command, args) => { execFileSync(command, args, { stdio: 'inherit' }) },
      stat: path => { const value = statSync(path); return { size: value.size, mode: value.mode, isFile: value.isFile() } },
    })
  } else {
    throw new Error(`未知Seal Harness打包目标：${target}`)
  }
}

export default async function verifyPackage(result) {
  const { afterAllArtifactBuild, resolveFinalPackagedRuntimeContexts } = await import(pathToFileURL(join(desktop, 'scripts/verify-electron-fuses.ts')))
  const { resolvePackagedApplicationRoot } = await import(pathToFileURL(join(desktop, 'scripts/verify-packaged-runtime.ts')))
  // dir 目标不携带架构信息；本产品入口明确只构建当前架构，补齐后仍运行上游完整检查。
  const { Arch } = desktopRequire('builder-util')
  const checked = process.env.SEAL_HARNESS_PACKAGE_TARGET === 'dir'
    ? { ...result, platformToTargets: new Map([...result.platformToTargets.keys()].map(platform => [platform, new Map([[Arch[process.arch], []]])])) }
    : result
  await afterAllArtifactBuild(checked)
  for (const context of resolveFinalPackagedRuntimeContexts(checked)) {
    const appRoot = resolvePackagedApplicationRoot(context)
    const require = createRequire(join(appRoot, 'package.json'))
    const manifest = JSON.parse(readFileSync(require.resolve('seal-harness-desktop/package.json'), 'utf8'))
    assert.equal(manifest.dsh.client.platform, 'web')
    assert.ok(readFileSync(require.resolve('seal-harness-desktop/client'), 'utf8').includes('seal-harness-desktop'))
    for (const folder of productPlugins) {
      assert.ok(readFileSync(require.resolve(`@seal-harness/${folder}`), 'utf8').length > 0)
      const item = JSON.parse(readFileSync(require.resolve(`@seal-harness/${folder}/package.json`), 'utf8'))
      if (item.dsh?.client) assert.ok(readFileSync(require.resolve(`@seal-harness/${folder}/client`), 'utf8').includes(`@seal-harness/${folder}`))
    }
    assert.ok(readFileSync(require.resolve('@seal-harness/experts/expert-runtime'), 'utf8').length > 0)
    const { DESKTOP_PRODUCT } = await import(pathToFileURL(join(appRoot, 'lib/product-config.js')))
    assert.equal(DESKTOP_PRODUCT.appId, product.appId)
    assert.equal(DESKTOP_PRODUCT.homeDirectoryName, '.seal-harness')
    assert.equal(DESKTOP_PRODUCT.updatesEnabled, false)
  }
  await verifyDistributionArtifacts(result, process.env.SEAL_HARNESS_PACKAGE_TARGET)
  process.stdout.write('Seal Harness安装包：上游运行时/fuses检查及产品身份、品牌插件检查通过。\n')
  return []
}
