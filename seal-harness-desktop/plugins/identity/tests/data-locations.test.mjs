import test from 'node:test'
import assert from 'node:assert/strict'
import { posix, win32 } from 'node:path'
import { identityDataLocationsDialog } from '../src/data-locations.js'

function snapshot(paths, activeScope, externalServices = false) {
  const root = paths === win32 ? 'D:\\Seal Harness数据' : '/volumes/Seal Harness数据'
  const appData = paths === win32 ? 'C:\\Users\\示例\\AppData\\Roaming\\Seal Harness' : '/home/example/.config/Seal Harness'
  const key = activeScope === 'online' ? 'a'.repeat(64) : null
  const scope = (home, suffix) => ({
    dshHome: home,
    credentialsFile: paths.join(home, '.credentials.yaml'),
    sessionsDirectory: paths.join(home, 'sessions'),
    sessionProjectionDirectory: paths.join(home, 'storages', 'session_projcache', 'sessions'),
    profilesDirectory: paths.join(home, 'profiles'),
    projectsDirectory: paths.join(home, 'projects'),
    capabilitiesDirectory: paths.join(home, 'capabilities'),
    productCapabilitiesDirectory: paths.join(home, 'seal-harness-capabilities'),
    desktopProfileDirectory: paths.join(appData, 'identity-profile-state', suffix),
    rendererPartitionDirectory: paths.join(appData, 'Partitions', `seal-harness-${suffix}`),
  })
  return {
    activeScope,
    key,
    baseHome: root,
    appData,
    onlineHomeTemplate: paths.join(root, 'accounts', '<account-key>'),
    offline: scope(paths.join(root, 'login'), 'login'),
    online: key === null ? null : scope(paths.join(root, 'accounts', key), key),
    runtime: {
      identitySelectionFile: paths.join(appData, 'identity-home', 'state.json'),
      logsDirectory: paths.join(appData, 'logs'),
      crashEvidenceDirectory: paths.join(appData, 'crash-evidence'),
      crashpadDirectory: paths.join(appData, 'Crashpad'),
      lifecycleEventsDirectory: paths.join(appData, 'lifecycle-events'),
      windowStateFile: paths.join(appData, 'main-window-state.json'),
      installationIdFile: paths.join(appData, 'identity', 'installation-id'),
      lockFile: paths.join(appData, 'lockfile'),
      servicesConfigFile: externalServices ? paths.join(appData, 'services.yml') : paths.join(root, 'services.yml'),
    },
    legacy: {
      credentialsFile: paths.join(root, '.credentials.yaml'),
      sessionsDirectory: paths.join(root, 'sessions'),
      profilesDirectory: paths.join(root, 'profiles'),
      storagesDirectory: paths.join(root, 'storages'),
    },
  }
}

for (const paths of [posix, win32]) {
  for (const activeScope of ['offline', 'online']) {
    for (const locale of ['zh', 'en']) {
      test(`${paths === win32 ? 'Windows' : 'POSIX'} ${activeScope} ${locale} renders annotated physical trees`, () => {
        const locations = snapshot(paths, activeScope)
        const before = structuredClone(locations)
        const dialog = identityDataLocationsDialog(locations, locale)
        const separator = paths === win32 ? '\\' : '/'
        assert.deepEqual(Object.keys(dialog).sort(), ['advisory', 'detail', 'message', 'title'])
        assert.deepEqual(locations, before)
        assert(dialog.detail.startsWith(`${locations.baseHome}${separator}`))
        assert(dialog.detail.includes(`├── accounts${separator}`))
        assert(dialog.detail.includes(`├── login${separator}`))
        assert(dialog.detail.includes(`│   ├── sessions${separator}`))
        assert(dialog.detail.includes(`│   │   └── session_projcache${separator}`))
        assert(dialog.detail.includes(`│   │       └── sessions${separator}`))
        assert(dialog.detail.includes('└── .credentials.yaml'))
        assert(dialog.detail.includes(`${locations.appData}${separator}`))
        assert(dialog.detail.includes(`├── identity-home${separator}`))
        assert(dialog.detail.includes('│   └── state.json'))
        assert(dialog.detail.includes(`├── Partitions${separator}`))
        assert.match(dialog.detail, locale === 'zh' ? /# Seal Harness数据根目录/ : /# Seal Harness data root/)
        assert.match(dialog.advisory, locale === 'zh' ? /不读取/ : /not read/)
        if (activeScope === 'online') {
          assert(dialog.detail.includes(`│   └── ${locations.key}${separator}`))
          assert(!dialog.detail.includes('<account-key>'))
        } else {
          assert(dialog.detail.includes(`│   └── <account-key>${separator}`))
        }
      })
    }
  }
}

test('shows an external service configuration path outside the data-root tree', () => {
  const locations = snapshot(win32, 'offline', true)
  const dialog = identityDataLocationsDialog(locations, 'zh')
  assert(new RegExp(`${locations.runtime.servicesConfigFile.replace(/[\\^$.*+?()[\]{}|]/gu, '\\$&')}\\s+# 外部服务地址配置`).test(dialog.detail))
  assert(!dialog.detail.includes('└── services.yml'))
})
