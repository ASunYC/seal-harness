import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import vm from 'node:vm'
import configuration from './electron-builder.mjs'
import { verifyDistributionArtifacts } from './verify-package.mjs'
import { buildBrand, desktopRequire, product, productPlugins, productRoot, root } from './build.mjs'
import { archiveConflictingElectronLink } from '../src/windows-shell-link.js'

test('Seal Harness构建依赖由根工作区持有，不污染 Stable 或 Beta Desktop', () => {
  const workspace = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
  const stable = JSON.parse(readFileSync(join(root, 'dsh-plugin-desktop/package.json'), 'utf8'))
  const beta = JSON.parse(readFileSync(join(root, 'dsh-plugin-desktop-beta/package.json'), 'utf8'))
  assert.equal(workspace.devDependencies.morphicons, '1.7.0')
  assert.equal(stable.devDependencies.morphicons, undefined)
  assert.equal(beta.devDependencies.morphicons, undefined)
})

test('Seal Harness随品牌插件分发 Morphicons 许可证，不修改上游 Desktop 许可证清单', () => {
  const notice = readFileSync(join(productRoot, 'THIRD_PARTY_NOTICES.md'), 'utf8')
  const buildScript = readFileSync(join(productRoot, 'scripts/build.mjs'), 'utf8')
  assert.match(notice, /morphicons 1\.7\.0/)
  assert.match(notice, /Copyright \(c\) 2026 Guillermo/)
  assert.match(buildScript, /'THIRD_PARTY_NOTICES\.md'/)
})

test('产品安装身份和品牌资源来源一致，分发配置不连接社区更新', () => {
  assert.equal(configuration.appId, 'com.seal-harness.desktop')
  assert.equal(configuration.productName, product.name)
  assert.deepEqual(configuration.protocols, [{ name: product.name, schemes: ['seal-harness'] }])
  assert.equal(configuration.nsis.shortcutName, product.name)
  assert.equal(configuration.extraMetadata.desktopName, `${product.appId}.desktop`)
  assert.equal(configuration.linux.executableName, 'seal-harness')
  assert.equal(configuration.deb.packageName, 'seal-harness')
  assert.equal(configuration.publish, null)
  assert.equal(product.updatesEnabled, false)
  const provenance = JSON.parse(readFileSync(join(productRoot, 'icon-provenance.json'), 'utf8'))
  for (const [file, { sha256 }] of Object.entries(provenance.files)) {
    assert.equal(createHash('sha256').update(readFileSync(join(productRoot, 'assets', file))).digest('hex'), sha256, file)
  }
})

test('品牌 Host 只归档与Seal Harness身份冲突的开发 Electron Shell Link', async () => {
  let captured
  const result = await archiveConflictingElectronLink({
    platform: 'win32',
    appData: 'C:\\Users\\Example\\AppData\\Roaming',
    executablePath: 'D:\\workspace\\electron\\electron.exe',
    appId: product.appId,
    productName: product.name,
    runPowerShell: async request => { captured = request; return { archived: true } },
  })
  assert.deepEqual(result, { archived: true })
  assert.equal(captured.environment.SEAL_HARNESS_STALE_SHORTCUT, 'C:\\Users\\Example\\AppData\\Roaming\\Microsoft\\Windows\\Start Menu\\Programs\\Electron.lnk')
  assert.equal(captured.environment.SEAL_HARNESS_EXPECTED_TARGET, 'D:\\workspace\\electron\\electron.exe')
  assert.equal(captured.environment.SEAL_HARNESS_EXPECTED_APP_ID, product.appId)
  assert.equal(await archiveConflictingElectronLink({ platform: 'win32', executablePath: 'D:\\workspace\\seal-harness.exe', runPowerShell: async () => { throw new Error('must not run') } }), undefined)
  assert.equal(await archiveConflictingElectronLink({ platform: 'linux', executablePath: '/opt/electron', runPowerShell: async () => { throw new Error('must not run') } }), undefined)
})

test('本地账号共用产品基础 Home 与 SQLite 数据库', () => {
  assert.equal(product.identityHomeModule, undefined)
  assert.equal(product.setupWizardEnabled, false)
  const manifest = JSON.parse(readFileSync(join(productRoot, 'plugins/local-data/package.json'), 'utf8'))
  assert.equal(manifest.name, '@seal-harness/local-data')
})

test('独立 Ask Jev bundle 同时具备 Host 与 Client 入口', () => {
  const manifest = JSON.parse(readFileSync(join(root, 'packages/dsh-plugin-ask-jev/package.json'), 'utf8'))
  assert.equal(manifest.name, 'dsh-plugin-ask-jev')
  assert.equal(manifest.dsh.client.platform, 'web')
  assert.equal(manifest.dsh.bundle.patch, './cordis.patch.yml')
  const patch = desktopRequire('yaml').parse(readFileSync(join(productRoot, 'cordis.patch.yml'), 'utf8'))
  assert.equal(patch.find(row => row.insert)?.insert.some(row => row.id === 'ask-jev' && row.name === manifest.name), true)
})

test('产品不再装配项目插件', () => {
  assert.equal(productPlugins.includes('projects'), false)
  const patch = desktopRequire('yaml').parse(readFileSync(join(productRoot, 'cordis.patch.yml'), 'utf8'))
  assert.equal(patch.some(row => row.id === 'seal-harness-projects'), false)
})

test('产品关闭首次模型凭据弹窗但保留模型设置插件', () => {
  const patch = desktopRequire('yaml').parse(readFileSync(join(productRoot, 'cordis.patch.yml'), 'utf8'))
  const models = patch.find(row => row.id === 'ui-settings-models')
  assert.deepEqual(models, { id: 'ui-settings-models', config: { credentialOnboarding: false } })
})

test('产品为所有账号提供Seal Harness助手身份并移除上游 Harness 身份', () => {
  const patch = desktopRequire('yaml').parse(readFileSync(join(productRoot, 'cordis.patch.yml'), 'utf8'))
  const prompt = patch.find(row => row.id === 'system-prompt')
  assert.deepEqual(prompt, {
    id: 'system-prompt',
    config: {
      includeHarnessIdentity: false,
      includeRuntimeContext: true,
      personaPrefix: '你是“Seal Harness”开发者平台中的 AI 助手。面向用户时只以“Seal Harness”或“Seal Harness 助手”自称，不以 DeepSeek、DeepSeek 官方助手、Harness、ChatGPT 或任何底层模型服务名称作为产品身份。底层模型和服务只负责实现，不改变产品身份。默认使用中文，准确、简洁地帮助用户完成开发、分析和知识工作。',
      personaSuffix: '当前工作目录是 {{cwd}}。',
    },
  })
})

test('标准客户端模块注册三个品牌slot，并在卸载时恢复文档标题', async () => {
  await buildBrand()
  const { JSDOM } = desktopRequire('jsdom')
  const dom = new JSDOM('<title>DeepSeek Harness</title><section data-plugin-panel aria-busy="false"><header data-plugin-page-header="list"><div></div><div><button aria-label="刷新"><svg /></button><button>添加插件</button></div></header></section><div><span><div data-slot="conversation.hero.brand.mark"><span id="mark"></span></div></span><span><span id="headline">探索未至之境</span><span>预览版</span></span></div>')
  const document = dom.window.document
  const registrations = new Map()
  const disposers = []
  const layoutEffects = []
  const panelListeners = new Set()
  const PluginIcon = () => null
  const panelEntries = [{
    component: PluginIcon,
    options: { name: 'sidebar.panellist', id: 'plugins', order: 0, label: () => '插件' },
    locale: 'plugin-manager',
  }]
  let client
  vm.runInNewContext(readFileSync(join(productRoot, 'lib/client.js'), 'utf8'), {
    document,
    MutationObserver: dom.window.MutationObserver,
    window: { __ModuleLoader__: { load({ id, factory }) {
      assert.equal(id, 'seal-harness-desktop')
      client = factory(id => id === 'react' ? {
        ...desktopRequire('react'),
        useRef: () => ({ current: document.getElementById('mark') }),
        useLayoutEffect: effect => layoutEffects.push(effect),
      } : desktopRequire(id))
    } } },
  })
  client.apply({
    effect(effect) { disposers.push(effect()) },
    slots: {
      inject(name, effect) {
        assert.ok(['sidebar.brand.mark', 'sidebar.brand.name', 'conversation.hero.brand.mark', 'sidebar.panellist'].includes(name))
        const result = effect()
        if (result?.next) [...result]
        else if (typeof result === 'function') disposers.push(result)
      },
      entries(name) { assert.equal(name, 'sidebar.panellist'); return panelEntries },
      subscribe(name, listener) { assert.equal(name, 'sidebar.panellist'); panelListeners.add(listener); return () => panelListeners.delete(listener) },
      register(options, component) {
        if (options.name !== 'sidebar.panellist') { registrations.set(options.name, component); return }
        const entry = { options, component, locale: options.locale }
        panelEntries.push(entry)
        for (const listener of panelListeners) listener()
        return () => { panelEntries.splice(panelEntries.indexOf(entry), 1); for (const listener of panelListeners) listener() }
      },
    },
  })
  assert.equal(document.title, 'Seal Harness')
  assert.equal(registrations.size, 3)
  assert.equal(panelEntries.filter(entry => entry.options.id === 'plugins').length, 1)
  const pluginPanel = document.querySelector('[data-plugin-panel]')
  const pluginRefresh = pluginPanel.querySelector('button[aria-label="刷新"]')
  assert(pluginRefresh.classList.contains('resource-sync-button'))
  assert.match(pluginPanel.querySelector('[data-seal-harness-plugin-sync-state]').textContent, /已同步/)
  pluginPanel.setAttribute('aria-busy', 'true')
  await new Promise(resolve => setTimeout(resolve, 0))
  assert.match(pluginPanel.querySelector('[data-seal-harness-plugin-sync-state]').textContent, /同步中/)
  pluginPanel.setAttribute('aria-busy', 'false')
  const failure = document.createElement('p')
  failure.setAttribute('role', 'alert')
  pluginPanel.append(failure)
  await new Promise(resolve => setTimeout(resolve, 0))
  assert.match(pluginPanel.querySelector('[data-seal-harness-plugin-sync-state]').textContent, /未连接/)
  const mark = registrations.get('sidebar.brand.mark')({})
  assert.equal(mark.type, 'img')
  assert.equal(mark.props.alt, 'Seal Harness')
  assert.ok(mark.props.src.startsWith('data:image/png;base64,'))
  assert.equal(registrations.get('sidebar.brand.name')().props.children, 'Seal Harness')
  assert.equal(registrations.get('conversation.hero.brand.mark')().props.children.props.size, 64)
  for (const effect of layoutEffects) disposers.push(effect())
  const headline = document.getElementById('headline')
  assert.equal(headline.textContent, '今天，让未来从这里发生。')
  assert.equal(headline.nextElementSibling.textContent, '预览版')
  headline.textContent = 'Into the Unknown'
  await new Promise(resolve => setTimeout(resolve, 0))
  assert.equal(headline.textContent, '今天，让未来从这里发生。')
  document.title = 'Migration session — DeepSeek Harness'
  await new Promise(resolve => setTimeout(resolve, 0))
  assert.equal(document.title, 'Migration session — Seal Harness')
  document.title = 'Unrelated title'
  await new Promise(resolve => setTimeout(resolve, 0))
  assert.equal(document.title, 'Unrelated title')
  document.title = 'Next session — DeepSeek Harness'
  await new Promise(resolve => setTimeout(resolve, 0))
  assert.equal(document.title, 'Next session — Seal Harness')
  for (const dispose of disposers) dispose()
  assert.equal(pluginRefresh.classList.contains('resource-sync-button'), false)
  assert.equal(pluginPanel.querySelector('[data-seal-harness-plugin-sync-state]'), null)
  assert.equal(headline.textContent, 'Into the Unknown')
  assert.equal(document.title, 'Next session — DeepSeek Harness')
  dom.window.close()
})


test('Windows产物校验接受PE/品牌ZIP，并拒绝缺少品牌的ZIP', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'seal-harness-artifact-test-'))
  try {
    const executable = Buffer.alloc(68)
    executable.write('MZ')
    executable.writeUInt32LE(64, 0x3c)
    executable.write('PE\0\0', 64)
    const installer = join(directory, 'setup.exe')
    const archive = join(directory, 'portable.zip')
    writeFileSync(installer, executable)
    const AdmZip = desktopRequire('adm-zip')
    const zip = new AdmZip()
    zip.addFile('seal-harness.exe', executable)
    zip.addFile('resources/app/package.json', Buffer.from('{}'))
    const brand = 'resources/app/node_modules/seal-harness-desktop/lib/client.js'
    zip.addFile(brand, Buffer.from('test brand'))
    zip.writeZip(archive)
    const result = { artifactPaths: [installer, archive] }
    await verifyDistributionArtifacts(result, 'win')
    zip.deleteFile(brand)
    zip.writeZip(archive)
    await assert.rejects(verifyDistributionArtifacts(result, 'win'), /ZIP 缺少/)
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})
