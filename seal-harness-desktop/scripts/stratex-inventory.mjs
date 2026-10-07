import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, extname, join, relative, resolve } from 'node:path'

const require = createRequire(new URL('../../dsh-plugin-desktop-beta/package.json', import.meta.url))
const ts = require('typescript')

function imports(source, file, includeTypes) {
  const scripts = file.endsWith('.vue') ? [...source.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)].map(match => match[1]).join('\n') : source
  const syntax = ts.createSourceFile(file, scripts, ts.ScriptTarget.Latest, true)
  const names = []
  for (const statement of syntax.statements) {
    if (!ts.isImportDeclaration(statement) && !ts.isExportDeclaration(statement)) continue
    if (!statement.moduleSpecifier || !ts.isStringLiteral(statement.moduleSpecifier)) continue
    if (!includeTypes && (statement.isTypeOnly || statement.importClause?.isTypeOnly)) continue
    names.push(statement.moduleSpecifier.text)
  }
  for (const match of source.matchAll(/@import\s+["']([^"']+)["']/g)) names.push(match[1])
  return names
}

function findModule(sourceRoot, importer, specifier) {
  let candidate
  if (specifier.startsWith('.')) candidate = resolve(dirname(importer), specifier)
  else if (specifier.startsWith('@shared/')) candidate = join(sourceRoot, 'src/shared', specifier.slice(8))
  else if (specifier.startsWith('@renderer/')) candidate = join(sourceRoot, 'src/renderer/src', specifier.slice(10))
  else return undefined
  const stem = /\.js$/.test(candidate) ? candidate.slice(0, -3) : candidate
  return [candidate, `${stem}.ts`, `${stem}.tsx`, `${stem}.js`, `${stem}.vue`, join(stem, 'index.ts')].find(path => existsSync(path) && extname(path)) ?? null
}

const args = process.argv.slice(2)
if (args[0] === '--self-check') {
  assert.deepEqual(imports("import type { A } from './a'; import { B } from './b'; export { C } from './c'", 'x.ts', false), ['./b', './c'])
  assert.deepEqual(imports('<script setup lang="ts">import X from "./X.vue"</script><style>@import "./x.css";</style>', 'x.vue', true), ['./X.vue', './x.css'])
  process.stdout.write('Stratex 依赖盘点解析检查通过。\n')
} else if (args.length < 2 || args.includes('--help')) {
  process.stdout.write('盘点指定 Stratex 入口的静态依赖、外部包和来源哈希，不复制或修改源码。\n用法：node seal-harness-desktop/scripts/stratex-inventory.mjs <Stratex目录> <入口...> [--types]\n示例：node seal-harness-desktop/scripts/stratex-inventory.mjs /path/Stratex src/renderer/src/views/ProjectsView.vue src/renderer/src/views/ProjectDetailView.vue\n')
} else {
  const sourceRoot = resolve(args[0])
  const includeTypes = args.includes('--types')
  const pending = args.slice(1).filter(arg => arg !== '--types').map(entry => resolve(sourceRoot, entry))
  const files = new Map()
  const external = new Set()
  const missing = []
  while (pending.length) {
    const file = pending.pop()
    if (files.has(file)) continue
    const source = readFileSync(file, 'utf8')
    const dependencies = imports(source, file, includeTypes)
    files.set(file, { path: relative(sourceRoot, file), sha256: createHash('sha256').update(source).digest('hex'), lines: source.split('\n').length })
    for (const specifier of dependencies) {
      const target = findModule(sourceRoot, file, specifier)
      if (target === undefined) external.add(specifier)
      else if (target === null) missing.push({ importer: relative(sourceRoot, file), specifier })
      else pending.push(target)
    }
  }
  process.stdout.write(`${JSON.stringify({ sourceRoot, includeTypes, files: [...files.values()].sort((a, b) => a.path.localeCompare(b.path)), external: [...external].sort(), missing }, null, 2)}\n`)
}
