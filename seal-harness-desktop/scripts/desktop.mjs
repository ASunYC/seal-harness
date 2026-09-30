import { spawnSync } from 'node:child_process'
import { readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { buildBrand, buildProductPlugins, capabilityPlugins, desktop, desktopPackage, desktopRequire, installBrand, linkProductDependencies, product, productRoot, root } from './build.mjs'

const command = process.argv[2]
const environment = { ...process.env, DSH_DESKTOP_PRODUCT: join(productRoot, 'product.json') }

function run(executable, args, cwd = root, env = environment) {
  const result = spawnSync(executable, args, { cwd, env, stdio: 'inherit', shell: process.platform === 'win32' && executable === 'corepack' })
  if (result.error) throw result.error
  if (result.status !== 0) throw new Error(`${executable} ${args.join(' ')} exited with ${result.status}`)
}

async function build() {
  await buildBrand()
  await buildProductPlugins()
  run('corepack', ['yarn', 'workspace', 'dsh-community-market', 'build'])
  run('corepack', ['yarn', 'workspace', desktopPackage, 'build'])
  installBrand()
  writeFileSync(join(desktop, 'lib/product-build.json'), `${JSON.stringify(product)}\n`)
}

function start() {
  const receipt = JSON.parse(readFileSync(join(desktop, 'lib/product-build.json'), 'utf8'))
  if (receipt.name !== product.name || receipt.appId !== product.appId) {
    throw new Error('当前产物不是Seal Harness，请先执行 corepack yarn seal-harness:build。')
  }
  run('corepack', ['yarn', 'workspace', desktopPackage, 'prepare:electron-native'])
  run(process.execPath, [join(desktop, 'lib/bin.js'), ...process.argv.slice(3)], desktop)
}

if (command === 'build' || command === 'dev') {
  await build()
  if (command === 'dev') start()
} else if (command === 'start') {
  start()
} else if (command === 'check') {
  linkProductDependencies()
  run(process.execPath, ['--test', join(productRoot, 'scripts/product.test.mjs')])
  for (const folder of ['local-data', 'identity', 'user', ...capabilityPlugins, 'capability-shared', 'session-context-selector']) {
    const tests = join(productRoot, 'plugins', folder, 'tests')
    run(process.execPath, ['--test', ...readdirSync(tests).filter(file => file.endsWith('.test.mjs')).map(file => join(tests, file))])
  }
  run(process.execPath, [join(productRoot, 'scripts/verify.mjs')])
  run(process.execPath, [join(productRoot, 'scripts/verify-profile.mjs')])
} else if (['dir', 'mac', 'win', 'linux'].includes(command)) {
  const targetPlatform = { mac: 'darwin', win: 'win32', linux: 'linux' }[command]
  if (targetPlatform && targetPlatform !== process.platform) throw new Error('请在目标操作系统上打包。')
  if (['win', 'linux'].includes(command) && process.arch !== 'x64') throw new Error('Windows/Linux 发行包需要 x64 Node。')
  if (command !== 'dir') run('corepack', ['yarn', 'aa:prepare-release', '--verify-release'])
  await build()
  run(process.execPath, [join(productRoot, 'scripts/verify.mjs')])
  run('corepack', ['yarn', 'workspace', desktopPackage, 'prepare:electron-native'])
  if (command === 'mac') {
    const { prepareFsExtForElectron } = await import(pathToFileURL(join(desktop, 'scripts/prepare-fs-ext.ts')))
    for (const arch of ['arm64', 'x64']) prepareFsExtForElectron({ platform: 'darwin', arch, desktopRoot: desktop })
    const { prepareInstalledMacUniversalRuntime } = await import(pathToFileURL(join(desktop, 'scripts/mac-universal.ts')))
    prepareInstalledMacUniversalRuntime(desktop)
  }
  const { electronBuilderEnvironment } = await import(pathToFileURL(join(desktop, 'scripts/electron-builder-environment.ts')))
  const { withoutWindowsSigningSecrets } = await import(pathToFileURL(join(desktop, 'scripts/package-win.ts')))
  const { withoutMacReleaseSecrets } = await import(pathToFileURL(join(desktop, 'scripts/release-preflight.ts')))
  const platform = { darwin: 'mac', win32: 'win', linux: 'linux' }[process.platform]
  const target = command === 'dir' ? [`--${platform}`, 'dir', `--${process.arch}`]
    : command === 'mac' ? ['--mac', 'dmg', 'zip', '--universal']
      : command === 'win' ? ['--win', 'nsis', 'zip', '--x64'] : ['--linux', 'AppImage', 'deb', '--x64']
  run(process.execPath, [desktopRequire.resolve('electron-builder/cli.js'), ...target,
    '--config', join(productRoot, 'scripts/electron-builder.mjs'), '--publish', 'never',
    '--config.forceCodeSigning=false', '--config.mac.identity=null', '--config.mac.notarize=false',
    '--config.win.signExecutable=false',
  ], desktop, electronBuilderEnvironment({
    ...withoutWindowsSigningSecrets(withoutMacReleaseSecrets(environment)), CSC_IDENTITY_AUTO_DISCOVERY: 'false', SEAL_HARNESS_PACKAGE_TARGET: command,
  }))
} else {
  process.stdout.write('Seal Harness：build | dev | start | check | dir | mac | win | linux\n示例：corepack yarn seal-harness:dev\n打包在目标系统执行；dir使用当前CPU架构，mac为universal，Windows/Linux为x64。仅生成内部验证包，不发布。\n')
  if (command && command !== '--help') process.exitCode = 1
}
