import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { createRequire } from 'node:module'
import { execFileSync } from 'node:child_process'
import { pathToFileURL } from 'node:url'
import { desktopRequire, productRoot, root } from './build.mjs'

const source = resolve(process.argv[2] ?? '../cc-haha')
const destination = join(productRoot, 'plugins/capability-shared')
const scratch = join(root, '.trellis/.runtime/catalog-import')
mkdirSync(scratch, { recursive: true })
const entry = join(scratch, 'entry.ts')
const importPath = path => JSON.stringify(join(source, path).replaceAll('\\', '/'))
writeFileSync(entry, `export { ALL_CONNECTORS } from ${importPath('src/services/connectors/catalog.ts')}\nexport { REMOTE_RECIPES } from ${importPath('src/services/connectors/remoteCatalog.ts')}\nexport { SKILL_RECIPES } from ${importPath('src/services/connectors/skillCatalog.ts')}\n`)
const { build } = await import(pathToFileURL(desktopRequire.resolve('tsdown')))
await build({ config: false, cwd: root, entry: [entry], outDir: scratch, clean: false, format: 'cjs', platform: 'node', dts: false, sourcemap: false, logLevel: 'silent' })
const require = createRequire(import.meta.url)
const extracted = require(join(scratch, 'entry.cjs'))
const sha = bytes => createHash('sha256').update(bytes).digest('hex')
const hashes = {}
const read = path => { const bytes = readFileSync(join(source, path)); hashes[path] = sha(bytes); return bytes }
for (const path of ['src/services/connectors/catalog.ts', 'src/services/connectors/remoteCatalog.ts', 'src/services/connectors/domesticCatalog.ts', 'src/services/connectors/globalCatalog.ts', 'src/services/connectors/skillCatalog.ts', 'src/services/connectors/skillBundles.lock.json']) read(path)
const market = JSON.parse(read('src/server/services/market/catalog/skills.json'))
const nativeNames = { feishu: '飞书', dingtalk: '钉钉', wecom: '企业微信' }
const translations = read('desktop/src/i18n/locales/zh.ts').toString('utf8')
const localized = (id, key) => {
  const match = translations.match(new RegExp(`"connectors\\.${id}\\.${key}"\\s*:\\s*("(?:[^"\\\\]|\\\\.)*")`))
  return match ? JSON.parse(match[1]) : undefined
}
const connectors = extracted.ALL_CONNECTORS.map(item => ({ ...item,
  displayName: item.displayName ?? nativeNames[item.id], transport: item.transport ?? 'cli', category: item.category ?? 'office',
  description: item.description ?? localized(item.id, 'description'), requirements: item.requirements ?? localized(item.id, 'requirements'),
  example: item.example ?? localized(item.id, 'example'),
  region: item.region ?? 'china', collection: item.collection ?? 'services',
  icon: `data:image/svg+xml;base64,${read(`desktop/public/connectors/${item.id}.svg`).toString('base64')}`,
}))
const vendored = ['types.ts', 'managedRuntime.ts', 'cliAdapter.ts']
const contents = vendored.map(name => [name, read(`src/services/connectors/${name}`).toString('utf8').replaceAll("'./types.js'", "'./types.ts'").replaceAll("'./managedRuntime.js'", "'./managedRuntime.ts'")])
const license = read('LICENSE')
const commit = execFileSync('git', ['-C', source, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()
mkdirSync(join(destination, 'catalog'), { recursive: true })
mkdirSync(join(destination, 'vendor/cc-haha'), { recursive: true })
writeFileSync(join(destination, 'catalog/cc-haha.json'), `${JSON.stringify({ repository: 'https://github.com/NanmiCoder/cc-haha', commit, connectors, remoteRecipes: extracted.REMOTE_RECIPES, skillBundles: extracted.SKILL_RECIPES, categories: market.categories, skills: market.skills }, null, 2)}\n`)
writeFileSync(join(destination, 'catalog/cc-haha-provenance.json'), `${JSON.stringify({ repository: 'https://github.com/NanmiCoder/cc-haha', commit, license: 'MIT', sourceHashes: hashes, adaptations: ['办公 CLI 源码仅将相对导入扩展名 .js 改为 .ts；通过产品构建链编译。'], counts: { connectors: connectors.length, remoteMcp: extracted.REMOTE_RECIPES.length, nativeCli: 3, skillBundles: extracted.SKILL_RECIPES.length, pinnedSkills: extracted.SKILL_RECIPES.flatMap(recipe => recipe.files.filter(file => file.target.endsWith('/SKILL.md'))).length, marketSkills: market.skills.length } }, null, 2)}\n`)
for (const [name, content] of contents) writeFileSync(join(destination, 'vendor/cc-haha', name), content)
writeFileSync(join(destination, 'vendor/cc-haha/LICENSE'), license)
console.log(`迁入 ${connectors.length} 项连接器、${market.skills.length} 项精选技能，来源 ${commit}`)
