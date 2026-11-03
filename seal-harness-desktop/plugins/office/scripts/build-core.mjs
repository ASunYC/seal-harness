import { createRequire } from 'node:module'
import { dirname, join, resolve, relative } from 'node:path'
import { readFileSync, writeFileSync, mkdirSync, readdirSync, cpSync, existsSync, realpathSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { pathToFileURL } from 'node:url'

export async function buildCore() {
  const plugin = resolve(import.meta.dirname, '..'), repo = resolve(plugin, '../../..')
  const require = createRequire(join(repo, 'dsh-plugin-desktop-beta/package.json'))
  const { build } = await import(pathToFileURL(require.resolve('genoffice-esbuild')).href)
  const vendor = join(plugin, 'vendor/genoffice'), provenance = JSON.parse(readFileSync(join(vendor, 'provenance.json')))
  for (const [file, expected] of Object.entries(provenance.files)) {
    const bytes = readFileSync(join(vendor, 'upstream', file))
    if (createHash('sha256').update(bytes).digest('hex') !== expected) throw new Error(`GenOffice source changed: ${file}`)
  }
  const lib = join(plugin, 'lib'); mkdirSync(lib, { recursive: true })
  const result = await build({
    entryPoints: [join(plugin, 'src/core-entry.ts')], outfile: join(lib, 'genoffice-core.cjs'), bundle: true,
    format: 'cjs', platform: 'node', target: 'node24', metafile: true, legalComments: 'external',
    banner: { js: '// Apache GenOffice core subset, packaged by Seal Harness; see third-party/genoffice for provenance, LICENSE and NOTICE. No ee, fonts, AI providers or native sidecar.' },
    alias: Object.fromEntries(['jszip','fast-xml-parser','utif2','zod','numfmt'].map(name => [name, require.resolve(`genoffice-${name}`)])),
    plugins: [{ name: 'pinned-apache-core', setup(b) {
      b.onResolve({ filter: /^@genoffice\// }, args => {
        const [, pkg, ...parts] = args.path.split('/')
        if (!['docx-engine','pptx-engine','xlsx-gateway','zip-gate','agent-core'].includes(pkg)) throw new Error(`Unapproved GenOffice package: ${args.path}`)
        return { path: join(vendor, 'upstream/packages', pkg, 'src', parts.length ? `${parts.join('/')}.ts` : 'index.ts') }
      })
    } }],
  })
  const legal = join(lib, 'third-party/genoffice'); mkdirSync(legal, { recursive: true })
  cpSync(join(vendor, 'legal'), legal, { recursive: true }); cpSync(join(vendor, 'provenance.json'), join(legal, 'provenance.json'))
  const packages = new Map()
  for (const input of Object.keys(result.metafile.inputs)) {
    const absolute = resolve(input)
    if (/(?:^|[\\/])ee[\\/]|@univerjs|[\\/]native[\\/]|\.(?:ttf|otf|woff2?)$/i.test(absolute)) throw new Error(`Forbidden core input: ${input}`)
    if (!absolute.includes('node_modules')) continue
    let folder = dirname(realpathSync(absolute))
    while (folder !== dirname(folder)) {
      const path = join(folder, 'package.json')
      if (existsSync(path)) {
        const pkg = JSON.parse(readFileSync(path, 'utf8'))
        if (pkg.name && pkg.version) {
          if (!['MIT','Apache-2.0','ISC','BSD-2-Clause','BSD-3-Clause','Zlib','(MIT AND Zlib)','(MIT OR GPL-3.0-or-later)'].includes(pkg.license)) throw new Error(`Review dependency license: ${pkg.name} ${pkg.license}`)
          packages.set(`${pkg.name}@${pkg.version}`, { folder, pkg }); break
        }
      }
      folder = dirname(folder)
    }
  }
  const records = []
  for (const [key, { folder, pkg }] of packages) {
    let names = readdirSync(folder).filter(name => /^(?:licen[cs]e|copying|notice)(?:[.\-_]|$)/i.test(name))
    // 部分小型 MIT 包把完整授权正文放在 README，而非独立 LICENSE。
    if (!names.length) names = readdirSync(folder).filter(name => /^readme(?:\.|$)/i.test(name) && /Permission is hereby granted, free of charge/.test(readFileSync(join(folder, name), 'utf8')) && /Copyright/i.test(readFileSync(join(folder, name), 'utf8')))
    if (!names.length) throw new Error(`Missing license text: ${key}`)
    const target = join(legal, 'dependencies', key.replaceAll('/', '_')); mkdirSync(target, { recursive: true })
    for (const file of names) cpSync(join(folder, file), join(target, file), { recursive: true })
    if (pkg.name === 'pako') {
      const zlib = join(folder, 'lib/zlib/README')
      if (!existsSync(zlib)) throw new Error('Missing original Zlib notice')
      cpSync(zlib, join(target, 'ZLIB-README.txt')); names.push('ZLIB-README.txt')
    }
    records.push({ name: pkg.name, version: pkg.version, license: pkg.name === 'jszip' ? 'MIT (selected from dual license)' : pkg.license, files: names })
  }
  writeFileSync(join(legal, 'THIRD-PARTY-NOTICES.json'), JSON.stringify(records, null, 2) + '\n')
  writeFileSync(join(legal, 'INTEGRATION.txt'), `Pinned source: ${provenance.repository}/commit/${provenance.commit}\nModified packaging/import resolution and a new local structured editing adapter. Upstream sources are unmodified and SHA256 verified.\nNot the upstream desktop application; no enterprise code, fonts, native recalculation, PDF renderer, AI provider, telemetry or network service is included.\n`)
  writeFileSync(join(lib, 'genoffice-build.json'), JSON.stringify({ commit: provenance.commit, dependencies: records, inputs: Object.keys(result.metafile.inputs).map(path => relative(plugin, resolve(path)).replaceAll('\\','/')) }, null, 2))
  console.log(`GenOffice Apache core built; ${records.length} third-party packages audited`)
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) await buildCore()
