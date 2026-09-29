function pathSeparator(path) {
  return path.includes('\\') ? '\\' : '/'
}

function rootPath(path, separator) {
  return path.endsWith(separator) ? path : `${path}${separator}`
}

function annotated(node, comment) {
  return `${node}${' '.repeat(Math.max(3, 76 - node.length))}# ${comment}`
}

function scopeChildren(prefix, separator, copy) {
  return [
    annotated(`${prefix}├── sessions${separator}`, copy.sessions),
    annotated(`${prefix}├── storages${separator}`, copy.storages),
    `${prefix}│   └── session_projcache${separator}`,
    annotated(`${prefix}│       └── sessions${separator}`, copy.projections),
    annotated(`${prefix}├── profiles${separator}`, copy.profiles),
    annotated(`${prefix}├── projects${separator}`, copy.projects),
    annotated(`${prefix}├── capabilities${separator}`, copy.capabilities),
    annotated(`${prefix}├── seal-harness-capabilities${separator}`, copy.productCapabilities),
    annotated(`${prefix}└── .credentials.yaml`, copy.credentials),
  ]
}

/** Format the current user storage as two annotated physical directory trees. */
export function identityDataLocationsDialog(locations, locale) {
  const zh = locale === 'zh'
  const separator = pathSeparator(locations.baseHome)
  const appSeparator = pathSeparator(locations.appData)
  const copy = zh ? {
    dataRoot: 'Seal Harness数据根目录', accounts: '在线账号目录', currentAccount: '当前在线账号', futureAccount: '登录后创建的在线账号目录',
    offline: '离线用户目录', sessions: '会话原始记录', storages: '运行存储', projections: '会话运行投影', profiles: 'Profile 配置',
    projects: '项目数据', capabilities: '能力数据', productCapabilities: 'Seal Harness能力数据', credentials: '身份凭据文件（仅显示路径）',
    legacySessions: '旧版未归属会话', legacyProfiles: '旧版未归属 Profile', legacyStorages: '旧版未归属存储', legacyCredentials: '旧版未归属凭据',
    services: '服务地址配置', externalServices: '外部服务地址配置', desktopRoot: 'Desktop 运行数据根目录', selection: '当前账号选择状态',
    profileState: '按用户隔离的 Desktop 设置', offlineProfile: '离线 Desktop 设置', onlineProfile: '当前在线账号 Desktop 设置', futureProfile: '登录后的在线账号 Desktop 设置',
    partitions: '按用户隔离的 Electron 分区', offlinePartition: '离线渲染器分区', onlinePartition: '当前在线账号渲染器分区', futurePartition: '登录后的在线账号渲染器分区',
    installation: '本机安装标识', logs: '运行日志', crashEvidence: '崩溃证据', crashpad: 'Chromium 崩溃转储', lifecycle: '生命周期事件', windowState: '主窗口状态', lock: '运行锁文件',
  } : {
    dataRoot: 'Seal Harness data root', accounts: 'Online account directories', currentAccount: 'Current online account', futureAccount: 'Online account directory after sign-in',
    offline: 'Offline user directory', sessions: 'Session records', storages: 'Runtime storage', projections: 'Session projections', profiles: 'Profile configuration',
    projects: 'Project data', capabilities: 'Capability data', productCapabilities: 'Seal Harness capability data', credentials: 'Identity credentials path only',
    legacySessions: 'Unassigned legacy sessions', legacyProfiles: 'Unassigned legacy profiles', legacyStorages: 'Unassigned legacy storage', legacyCredentials: 'Unassigned legacy credentials',
    services: 'Service endpoint configuration', externalServices: 'External service endpoint configuration', desktopRoot: 'Desktop runtime data root', selection: 'Current identity selection',
    profileState: 'Per-user Desktop settings', offlineProfile: 'Offline Desktop settings', onlineProfile: 'Current online Desktop settings', futureProfile: 'Online Desktop settings after sign-in',
    partitions: 'Per-user Electron partitions', offlinePartition: 'Offline renderer partition', onlinePartition: 'Current online renderer partition', futurePartition: 'Online renderer partition after sign-in',
    installation: 'Installation identifier', logs: 'Runtime logs', crashEvidence: 'Crash evidence', crashpad: 'Chromium crash dumps', lifecycle: 'Lifecycle events', windowState: 'Main-window state', lock: 'Runtime lock file',
  }
  const accountName = locations.key ?? '<account-key>'
  const defaultServicesFile = `${rootPath(locations.baseHome, separator)}services.yml`
  const servicesInRoot = process.platform === 'win32'
    ? locations.runtime.servicesConfigFile.toLowerCase() === defaultServicesFile.toLowerCase()
    : locations.runtime.servicesConfigFile === defaultServicesFile
  const detail = [
    annotated(rootPath(locations.baseHome, separator), copy.dataRoot),
    annotated(`├── accounts${separator}`, copy.accounts),
    annotated(`│   └── ${accountName}${separator}`, locations.key === null ? copy.futureAccount : copy.currentAccount),
    ...(locations.key === null ? [] : scopeChildren('│       ', separator, copy)),
    annotated(`├── login${separator}`, copy.offline),
    ...scopeChildren('│   ', separator, copy),
    annotated(`├── sessions${separator}`, copy.legacySessions),
    annotated(`├── profiles${separator}`, copy.legacyProfiles),
    annotated(`├── storages${separator}`, copy.legacyStorages),
    annotated(`${servicesInRoot ? '├' : '└'}── .credentials.yaml`, copy.legacyCredentials),
    ...(servicesInRoot ? [annotated('└── services.yml', copy.services)] : []),
    ...(!servicesInRoot ? ['', annotated(locations.runtime.servicesConfigFile, copy.externalServices)] : []),
    '',
    annotated(rootPath(locations.appData, appSeparator), copy.desktopRoot),
    annotated(`├── identity-home${appSeparator}`, copy.selection),
    '│   └── state.json',
    annotated(`├── identity-profile-state${appSeparator}`, copy.profileState),
    annotated(`│   ├── login${appSeparator}`, copy.offlineProfile),
    annotated(`│   └── ${accountName}${appSeparator}`, locations.key === null ? copy.futureProfile : copy.onlineProfile),
    annotated(`├── Partitions${appSeparator}`, copy.partitions),
    annotated(`│   ├── seal-harness-login${appSeparator}`, copy.offlinePartition),
    annotated(`│   └── seal-harness-${accountName}${appSeparator}`, locations.key === null ? copy.futurePartition : copy.onlinePartition),
    `├── identity${appSeparator}`,
    annotated('│   └── installation-id', copy.installation),
    annotated(`├── logs${appSeparator}`, copy.logs),
    annotated(`├── crash-evidence${appSeparator}`, copy.crashEvidence),
    annotated(`├── Crashpad${appSeparator}`, copy.crashpad),
    annotated(`├── lifecycle-events${appSeparator}`, copy.lifecycle),
    annotated('├── main-window-state.json', copy.windowState),
    annotated('└── lockfile', copy.lock),
  ].join('\n')
  return {
    title: zh ? '用户数据目录' : 'User data locations',
    message: locations.activeScope === 'online'
      ? (zh ? '当前正在使用在线账号隔离目录。' : 'The isolated online account directories are active.')
      : (zh ? '当前正在使用离线工作区目录。' : 'Offline workspace directories are active.'),
    detail,
    advisory: zh
      ? '这里只显示路径，不读取凭据、Cookie、令牌或会话内容。目录可能按需创建。'
      : 'Only paths are shown. Credentials, cookies, tokens, and session contents are not read. Some paths are created on demand.',
  }
}
