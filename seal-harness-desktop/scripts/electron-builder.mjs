import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { desktop, product, productPlugins, productRoot } from './build.mjs'
import verifyPackage from './verify-package.mjs'
import { officePackage, officeVersion } from './office-bundle.mjs'

const manifest = JSON.parse(readFileSync(join(desktop, 'package.json'), 'utf8'))
const upstream = manifest.build
const assets = join(productRoot, 'assets')
const artifactName = 'Seal-Harness-${version}-${arch}.${ext}'

// 继承上游原生依赖、fuses 和 afterPack 检查；这里只覆盖产品身份和分发资源。
export default {
  ...upstream,
  afterAllArtifactBuild: verifyPackage,
  appId: product.appId,
  productName: product.name,
  executableName: product.executableName,
  protocols: [{ name: product.name, schemes: [product.protocolScheme] }],
  publish: null,
  extraMetadata: {
    version: product.version,
    description: product.description,
    author: product.publisher,
    desktopName: `${product.appId}.desktop`,
    dependencies: { ...manifest.dependencies, [officePackage]: officeVersion, 'seal-harness-desktop': product.version, 'dsh-plugin-ask-jev': '0.1.0', ...Object.fromEntries(productPlugins.map(folder => [`@seal-harness/${folder}`, '0.1.0'])) },
  },
  directories: { ...upstream.directories, output: join(productRoot, 'dist', process.platform) },
  files: [
    ...upstream.files,
    { from: join(desktop, 'node_modules', officePackage), to: `node_modules/${officePackage}`, filter: ['package.json', 'LICENSE', 'README*', 'cordis.patch.yml', 'lib/**', 'artifacts/**', 'docs/**', 'skills/**', 'scripts/**', 'node_modules/**'] },
    { from: join(desktop, 'node_modules/seal-harness-desktop'), to: 'node_modules/seal-harness-desktop', filter: ['package.json', 'cordis.patch.yml', 'office.patch.yml', 'THIRD_PARTY_NOTICES.md', 'lib/**'] },
    { from: join(desktop, 'node_modules/dsh-plugin-ask-jev'), to: 'node_modules/dsh-plugin-ask-jev', filter: ['package.json', 'cordis.patch.yml', 'README.md', 'LICENSE', 'lib/**'] },
    ...productPlugins.map(folder => ({ from: join(desktop, `node_modules/@seal-harness/${folder}`), to: `node_modules/@seal-harness/${folder}`, filter: ['package.json', 'lib/**', 'node_modules/**'] })),
  ],
  mac: { ...upstream.mac, icon: join(assets, 'app-icon.icns'), artifactName },
  win: { ...upstream.win, icon: join(assets, 'app-icon.ico'), artifactName },
  nsis: {
    ...upstream.nsis,
    shortcutName: product.name,
    installerIcon: join(assets, 'app-icon.ico'),
    uninstallerIcon: join(assets, 'app-icon.ico'),
    artifactName: 'Seal-Harness-${version}-${arch}-Setup.${ext}',
  },
  linux: {
    ...upstream.linux, icon: join(assets, 'icons'), executableName: product.executableName,
    synopsis: product.description, maintainer: product.publisher, artifactName,
  },
  deb: { ...upstream.deb, packageName: product.executableName },
  dmg: { ...upstream.dmg, icon: join(assets, 'app-icon.icns') },
}
