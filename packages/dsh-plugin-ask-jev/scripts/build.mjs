import { existsSync, lstatSync, mkdirSync, readlinkSync, rmSync, symlinkSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const packageRoot = resolve(import.meta.dirname, '..')
const desktop = resolve(packageRoot, '../../dsh-plugin-desktop-beta')
const desktopModules = join(desktop, 'node_modules')
const modules = join(packageRoot, 'node_modules')
if (!existsSync(modules)) symlinkSync(desktopModules, modules, process.platform === 'win32' ? 'junction' : 'dir')
else if (lstatSync(modules).isSymbolicLink() && resolve(packageRoot, readlinkSync(modules)) !== desktopModules)
  throw new Error('Ask Jev 的 node_modules 链接未指向根 Desktop 依赖')

const require = createRequire(join(desktop, 'package.json'))
const { build } = await import(pathToFileURL(require.resolve('tsdown')).href)
const outDir = join(packageRoot, 'lib')
rmSync(outDir, { recursive: true, force: true })
mkdirSync(outDir, { recursive: true })
const common = { config: false, cwd: packageRoot, outDir, clean: false, dts: false, sourcemap: true }
await build({ ...common, entry: { index: 'src/index.js' }, format: 'esm', platform: 'node', fixedExtension: false,
  deps: { neverBundle: [/^@deepseek-ai\//] } })
await build({ ...common, entry: { client: 'src/client.jsx' }, format: 'cjs', platform: 'browser', target: 'es2022',
  deps: { neverBundle: [/^react(?:-dom)?(?:\/|$)/] },
  define: { 'process.env.NODE_ENV': JSON.stringify('production') },
  outputOptions: {
    entryFileNames: 'client.js',
    banner: 'window.__ModuleLoader__.load({ id: "dsh-plugin-ask-jev", factory: (require) => {',
    footer: 'return module.exports; } });',
    intro: 'var module = { exports: {} }; var exports = module.exports;',
  },
})
