import { cpSync, existsSync, lstatSync, mkdirSync, readFileSync, readlinkSync, rmSync, symlinkSync, unlinkSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

export const productRoot = resolve(import.meta.dirname, '..')
export const root = resolve(productRoot, '..')
export const desktopPackage = 'dsh-plugin-desktop-beta'
export const desktop = join(root, desktopPackage)
export const desktopRequire = createRequire(join(desktop, 'package.json'))
export const product = JSON.parse(readFileSync(join(productRoot, 'product.json'), 'utf8'))
export const capabilityPlugins = ['store', 'connectors', 'skills', 'experts']
export const productPlugins = ['local-data', 'identity', 'user', ...capabilityPlugins, 'session-context-selector', 'projects']

export function linkProductDependencies() {
  const link = join(productRoot, 'node_modules')
  if (existsSync(link) && lstatSync(link).isSymbolicLink()
    && resolve(productRoot, readlinkSync(link)) !== join(desktop, 'node_modules')) unlinkSync(link)
  if (!existsSync(link)) symlinkSync(join(desktop, 'node_modules'), link, process.platform === 'win32' ? 'junction' : 'dir')
}

export async function buildBrand() {
  const { build } = await import(pathToFileURL(desktopRequire.resolve('tsdown')).href)
  const common = { config: false, cwd: productRoot, outDir: join(productRoot, 'lib'), clean: false, dts: false, sourcemap: true }
  await build({ ...common, entry: { index: 'src/index.js' }, format: 'esm', platform: 'node', fixedExtension: false })
  await build({
    ...common,
    entry: { client: 'src/client.jsx' },
    format: 'cjs', platform: 'browser', target: 'es2022', deps: { neverBundle: [/^react(?:-dom)?(?:\/|$)/] },
    define: {
      'process.env.NODE_ENV': JSON.stringify('production'),
      __SEAL_HARNESS_NAME__: JSON.stringify(product.name),
      __SEAL_HARNESS_ICON__: JSON.stringify(`data:image/png;base64,${readFileSync(join(productRoot, 'assets/icons/128x128.png')).toString('base64')}`),
    },
    outputOptions: {
      entryFileNames: 'client.js',
      banner: 'window.__ModuleLoader__.load({ id: "seal-harness-desktop", factory: (require) => {',
      footer: 'return module.exports; } });',
      intro: 'var module = { exports: {} }; var exports = module.exports;',
    },
  })
}

export async function buildProductPlugins() {
  linkProductDependencies()
  const { build } = await import(pathToFileURL(desktopRequire.resolve('tsdown')).href)
  for (const folder of productPlugins) {
    const cwd = join(productRoot, 'plugins', folder)
    const manifest = JSON.parse(readFileSync(join(cwd, 'package.json'), 'utf8'))
    rmSync(join(cwd, 'lib'), { recursive: true, force: true })
    const common = { config: false, cwd, outDir: join(cwd, 'lib'), clean: false, dts: false, sourcemap: true }
    const entry = 'src/index.js'
    await build({ ...common, entry: { index: entry, ...(folder === 'experts' ? { runtime: 'src/runtime.js' } : {}) }, format: 'esm', platform: 'node', fixedExtension: false,
      deps: { neverBundle: [/^@deepseek-ai\//, /^@seal-harness\//, 'zod', 'yaml', 'adm-zip', 'unzipper', 'pdfjs-dist', '@silurus/ooxml', 'ssf', 'ssh2'] } })
    if (manifest.dsh?.client) {
      await build({ ...common, entry: { client: 'src/client.jsx' }, format: 'cjs', platform: 'browser', target: 'es2022', deps: { neverBundle: [/^react(?:-dom)?(?:\/|$)/] },
        define: {
          'process.env.NODE_ENV': JSON.stringify('production'),
          ...(folder === 'identity' ? { __SEAL_HARNESS_ICON__: JSON.stringify(`data:image/png;base64,${readFileSync(join(productRoot, 'assets/icons/128x128.png')).toString('base64')}`) } : {}),
        },
        outputOptions: {
          entryFileNames: 'client.js',
          banner: `window.__ModuleLoader__.load({ id: ${JSON.stringify(manifest.name)}, factory: (require) => {`,
          footer: 'return module.exports; } });', intro: 'var module = { exports: {} }; var exports = module.exports;',
        },
      })
    }
  }
}

// 文档 worker 动态导入保留包目录及 WASM；只装配实际声明的运行依赖，不复制整份开发依赖。
function installRuntimeDependencies(manifest, destination) {
  const pending = Object.keys(manifest.dependencies ?? {}).map(name => ({ name, from: root }))
  const installed = new Set()
  while (pending.length) {
    const { name, from, optional } = pending.pop()
    if (installed.has(name)) continue
    const require = createRequire(join(from, 'package.json'))
    const source = require.resolve.paths('seal-harness-runtime-dependency').map(directory => join(directory, name)).find(directory => existsSync(join(directory, 'package.json')))
    if (!source && optional) continue
    if (!source) throw new Error(`缺少产品运行依赖 ${name}，请执行 corepack yarn install --immutable。`)
    const dependency = JSON.parse(readFileSync(join(source, 'package.json'), 'utf8'))
    const target = join(destination, 'node_modules', name)
    mkdirSync(target, { recursive: true })
    cpSync(source, target, { recursive: true, dereference: true })
    installed.add(name)
    for (const child of Object.keys(dependency.dependencies ?? {})) pending.push({ name: child, from: source })
    for (const child of Object.keys(dependency.optionalDependencies ?? {})) pending.push({ name: child, from: source, optional: true })
  }
}

export function installProductPlugin(folder, target = desktop) {
  const source = join(productRoot, 'plugins', folder)
  const manifest = JSON.parse(readFileSync(join(source, 'package.json'), 'utf8'))
  const destination = join(target, 'node_modules', manifest.name)
  rmSync(destination, { recursive: true, force: true })
  mkdirSync(destination, { recursive: true })
  for (const file of ['package.json', 'lib']) cpSync(join(source, file), join(destination, file), { recursive: true })
  installRuntimeDependencies(manifest, destination)
}

export function installBrand(target = desktop) {
  // 只清理构建装配区的旧聚合包，用户数据仍沿用原路径。
  rmSync(join(target, 'node_modules/@seal-harness/capabilities'), { recursive: true, force: true })
  for (const folder of ['knowledge', 'agents', 'project-agent']) {
    rmSync(join(target, 'node_modules/@seal-harness', folder), { recursive: true, force: true })
  }
  const destination = join(target, 'node_modules/seal-harness-desktop')
  mkdirSync(destination, { recursive: true })
  for (const file of ['package.json', 'cordis.patch.yml', 'THIRD_PARTY_NOTICES.md', 'lib']) {
    cpSync(join(productRoot, file), join(destination, file), { recursive: true })
  }
  cpSync(join(productRoot, 'assets'), join(target, 'lib/product-assets'), { recursive: true })
  for (const folder of productPlugins) installProductPlugin(folder, target)
}
