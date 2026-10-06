import { snapshotSkill } from './snapshot.js'
import { mkdir, writeFile, rename, rm, realpath, lstat, readdir } from 'node:fs/promises'
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { homedir } from 'node:os'
import { randomUUID, createHash } from 'node:crypto'
import { FileSystemSkillProvider } from '@deepseek-ai/dsh-skill-filesystem'
import { scopeOf } from '@deepseek-ai/dsh-scope'
import { createArchive, inside, inspectFiles, inspectPath, MAX_PACKAGE_BYTES, parseSkill, readArchive, readDirectory, safeRelative, SkillError } from './package.js'
import { createSkillPersistence } from './sqlite-store.js'

const PROVIDER = 'seal-harness-skills'
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
const GLOBAL_ROOTS = [['Claude Code', '.claude/skills'], ['Codex', '.codex/skills'], ['Grok', '.grok/skills'], ['Pi', '.pi/agent/skills'], ['共享技能', '.agents/skills']]
const PROJECT_ROOTS = GLOBAL_ROOTS.map(([label, suffix]) => [label, label === 'Pi' ? '.pi/skills' : suffix])

function requiredString(value, label, max = 4096) {
  if (typeof value !== 'string' || !value.trim() || value.length > max || /[\x00-\x1f]/.test(value)) throw new SkillError(`${label}无效`)
  return value.trim()
}

function publicCandidate({ files, content, ...item }) { return item }

/** 产品管理副本通过公开 skills 服务注册；源目录始终只读。 */
export async function createModule(ctx, { home, backend }) {
  const storage = ctx.get?.('sealHarnessDatabase') ?? ctx.sealHarnessDatabase
  if (!storage) throw new SkillError('本地数据库未加载')
  const identity = ctx.get?.('sealHarnessIdentity') ?? ctx.sealHarnessIdentity
  const root = resolve(home, 'seal-harness-cache', 'skills')
  const packages = join(root, 'packages')
  const persistence = createSkillPersistence(storage, home, packages)
  await mkdir(packages, { recursive: true })
  const canonicalRoot = await realpath(root)
  async function assertStorage() {
    if (await realpath(root) !== canonicalRoot || await realpath(packages) !== join(canonicalRoot, 'packages')) {
      throw new SkillError('技能存储目录被替换，操作已停止')
    }
  }
  await assertStorage()
  const emptyState = () => ({ version: 1, revision: 0, installationUid: randomUUID(), skills: [], sources: [], reports: [], defaultCopies: {} })
  let state = emptyState()
  const validateState = stored => {
    if (stored.version !== 1 || !Number.isSafeInteger(stored.revision) || !Array.isArray(stored.skills) || !Array.isArray(stored.sources)
      || stored.skills.some(item => !UUID.test(item.id) || typeof item.enabled !== 'boolean' || typeof item.name !== 'string' || (item.installed !== undefined && typeof item.installed !== 'boolean'))
      || stored.sources.some(item => !UUID.test(item.id) || !isAbsolute(item.path))
      || (stored.installationUid !== undefined && !UUID.test(stored.installationUid))
      || (stored.reports !== undefined && !Array.isArray(stored.reports))) throw new SkillError('技能管理数据格式无效')
    return { ...emptyState(), ...stored }
  }

  let invalidate = () => {}
  let filesystem
  let disposed = false
  let preview
  let actionAccount = null
  async function currentAccount() {
    if (!backend?.account) return null
    try { return await backend.account() }
    catch (error) {
      if (['identityUnavailable', 'authenticationRequired'].includes(error.code)) return null
      throw error
    }
  }
  const visibleTo = (item, account) => item.origin?.kind !== 'store' || item.origin.accountId === account?.accountId
  const skills = ctx.get('skills')
  if (!skills) throw new SkillError('DSH skills 服务未加载')
  const unregister = skills.registerProvider(control => {
    invalidate = control.invalidate
    filesystem = new FileSystemSkillProvider(ctx, control, {
      providerName: PROVIDER, includeDefaultRoots: false, customSkillDirs: [join(canonicalRoot, 'packages')], watch: false,
    })
    const owner = candidate => state.skills.find(item => item.installed !== false && item.enabled && inside(join(canonicalRoot, 'packages', item.id), candidate.path ?? ''))
    return {
      name: PROVIDER,
      async list(options) {
        await syncAccount(await currentAccount())
        await assertStorage()
        const account = await currentAccount()
        const result = await filesystem.list(options)
        const candidates = (Array.isArray(result) ? result : result.candidates).filter(candidate => {
          const item = owner(candidate)
          return item && visibleTo(item, account)
        })
        if (account) await backend.assertAccount(account)
        // 商店技能目录按当前账号取值，避免跨账号目录缓存。
        return { candidates, complete: !state.skills.some(item => item.origin?.kind === 'store') && (Array.isArray(result) || result.complete) }
      },
      async get(candidate, options) {
        await syncAccount(await currentAccount())
        await assertStorage()
        const account = await currentAccount()
        const item = owner(candidate)
        if (!item || !visibleTo(item, account)) return undefined
        const definition = await filesystem.get(candidate, options)
        if (item.origin?.kind === 'store') await backend.assertAccount(account)
        return snapshotSkill(definition, join(root, 'snapshots'), options.signal)
      },
    }
  })

  let sourceFilesystem
  let invalidateSources = () => {}
  let lastDiscovery
  const releaseSources = skills.registerProvider(control => {
    invalidateSources = control.invalidate
    let rootsKey
    let refreshing = Promise.resolve()
    function refreshSourceProvider(roots) {
      refreshing = refreshing.then(async () => {
        const key = JSON.stringify(roots)
        if (key !== rootsKey) {
          await sourceFilesystem?.dispose()
          sourceFilesystem = new FileSystemSkillProvider(ctx, control, { providerName: 'seal-harness-source-skills', includeDefaultRoots: false, customSkillDirs: roots, watch: false })
          rootsKey = key
        }
        return sourceFilesystem
      })
      return refreshing
    }
    return {
      name: 'seal-harness-source-skills',
      async list(options) {
        await syncAccount(await currentAccount())
        const account = await currentAccount()
        const selected = Object.values(state.defaultCopies).filter(item => item.accountId === (account?.accountId ?? null) && (!item.projectRoot || options.cwd && inside(item.projectRoot, options.cwd)))
        const allProjects = (await sources()).sources.filter(item => item.standard && item.projectRoot && item.status === 'ready')
        const projectRoots = allProjects.filter(item => options.cwd && inside(item.projectRoot, options.cwd))
        const roots = [...new Set([...selected, ...projectRoots].map(item => item.path))]
        const allRoots = [...new Set([...Object.values(state.defaultCopies), ...allProjects].map(item => item.path))].sort()
        const result = await (await refreshSourceProvider(allRoots)).list(options)
        const candidates = (Array.isArray(result) ? result : result.candidates).filter(candidate => roots.some(path => inside(path, candidate.path)))
        return { candidates: candidates.map(candidate => ({ ...candidate, rank: selected.some(item => inside(item.path, candidate.path)) ? 290 : candidate.rank })), complete: false }
      },
      async get(candidate, options) {
        await syncAccount(await currentAccount())
        const account = await currentAccount()
        const selected = Object.values(state.defaultCopies).some(item => item.accountId === (account?.accountId ?? null) && (!item.projectRoot || options.cwd && inside(item.projectRoot, options.cwd)) && inside(item.path, candidate.path))
        const project = (await sources()).sources.some(item => item.standard && item.projectRoot && options.cwd && inside(item.projectRoot, options.cwd) && inside(item.path, candidate.path))
        if (!selected && !project) return undefined
        return snapshotSkill(await sourceFilesystem.get(candidate, options), join(root, 'snapshots'), options.signal)
      },
    }
  })

  let loadedAccountId
  async function syncAccount(account) {
    const accountId = account?.accountId ?? null
    if (loadedAccountId === accountId) return
    const loaded = accountId ? await persistence.load(accountId) : (await persistence.clear(), null)
    state = loaded ? validateState(loaded) : emptyState()
    loadedAccountId = accountId
    invalidate(); invalidateSources()
  }

  async function save(next) {
    await assertStorage()
    if (!actionAccount) throw new SkillError('请先登录本机账号')
    const updated = { ...next, revision: state.revision + 1 }
    await persistence.save(actionAccount.accountId, updated)
    state = updated
    invalidate()
    invalidateSources()
    return state.revision
  }

  function find(id) {
    const skill = state.skills.find(item => item.id === id && visibleTo(item, actionAccount))
    if (!skill) throw new SkillError('技能不存在，请刷新列表')
    return skill
  }

  function checkRevision(payload) {
    if (payload.expectedRevision !== undefined && payload.expectedRevision !== state.revision) throw new SkillError('技能列表已变化，请刷新后重试')
  }

  async function managedFiles(id, signal) {
    find(id)
    await assertStorage()
    const path = join(packages, id)
    if (await realpath(path) !== join(canonicalRoot, 'packages', id)) throw new SkillError('技能副本路径被替换')
    return readDirectory(path, signal)
  }

  async function list() {
    invalidate()
    const runtime = await skills.list({ scope: scopeOf(ctx) })
    return { revision: state.revision, skills: state.skills.filter(item => visibleTo(item, actionAccount)).map(item => ({ ...item, active: runtime.some(skill => skill.provider === PROVIDER && inside(join(canonicalRoot, 'packages', item.id), skill.path ?? skill.resourceBase?.path ?? '')) })), pendingReports: state.reports.filter(report => report.accountId === actionAccount?.accountId).length }
  }

  async function sources() {
    const known = GLOBAL_ROOTS.map(([label, suffix]) => ({ label, path: join(homedir(), suffix), standard: true }))
    for (const workspace of ctx.get('workspaceRegistry')?.list() ?? []) for (const [label, suffix] of PROJECT_ROOTS) known.push({ label: `${workspace.title ?? basename(workspace.path)} · ${label}`, path: join(workspace.path, suffix), projectRoot: workspace.path, standard: true })
    for (const source of state.sources) if (!known.some(item => item.path === source.path)) known.push(source)
    return { revision: state.revision, sources: await Promise.all(known.map(async source => {
      const saved = state.sources.find(item => item.path === source.path)
      const hex = createHash('sha256').update(source.path).digest('hex').slice(0, 32)
      const id = saved?.id ?? hex.replace(/^(.{8})(.{4})(.{4})(.{4})(.{12})$/, '$1-$2-$3-$4-$5')
      let status = 'ready'
      try { if (!(await lstat(source.path)).isDirectory()) status = 'unavailable' }
      catch (error) { status = error.code === 'ENOENT' ? 'missing' : 'unavailable' }
      return { ...source, ...saved, id, approved: !!saved || source.standard, status }
    })) }
  }

  async function discover(payload, signal) {
    const available = (await sources()).sources.filter(source => source.status === 'ready')
    const selected = payload.sourceId ? available.filter(source => source.id === payload.sourceId) : payload.projectRoot ? available.filter(source => source.projectRoot === payload.projectRoot) : available
    if (payload.sourceId && !selected.length) throw new SkillError('来源不存在或无法读取，请刷新来源')
    const skills = []
    const diagnostics = []
    for (const source of selected) {
      let visited = 0
      async function walk(path, depth) {
        signal?.throwIfAborted()
        if (depth > 8 || ++visited > 5000) throw new SkillError('来源过大，请选择更具体的技能目录')
        if (!inside(source.path, await realpath(path))) throw new SkillError('来源目录越界')
        const entries = await readdir(path, { withFileTypes: true })
        const instruction = entries.find(entry => entry.name === 'SKILL.md' && entry.isFile())
        if (instruction) {
          const key = relative(source.path, path).split(sep).join('/') || '.'
          try {
            const candidate = inspectFiles(await readDirectory(path, signal)).find(item => item.key === '.')
            if (!candidate || candidate.error) throw new SkillError(candidate?.error ?? '技能格式无效')
            skills.push({ ...publicCandidate(candidate), sourceId: source.id, sourceLabel: source.label, key, path, projectRoot: source.projectRoot })
          } catch (error) { diagnostics.push({ sourceId: source.id, path: key, message: error.message }) }
          return
        }
        for (const entry of entries) {
          if (['.git', 'node_modules', '__pycache__'].includes(entry.name)) continue
          if (entry.isSymbolicLink()) { diagnostics.push({ sourceId: source.id, path: entry.name, message: '已跳过符号链接' }); continue }
          if (entry.isDirectory()) await walk(join(path, entry.name), depth + 1)
        }
      }
      try { if (await realpath(source.path) !== source.path) throw new SkillError('来源路径已改变，请移除后重新添加'); await walk(source.path, 0) }
      catch (error) { signal?.throwIfAborted(); diagnostics.push({ sourceId: source.id, message: error.message }) }
    }
    const groups = new Map()
    for (const skill of skills) {
      const group = groups.get(skill.contentHash) ?? { ...skill, locations: [] }
      group.locations.push({ sourceId: skill.sourceId, sourceLabel: skill.sourceLabel, key: skill.key, path: skill.path, projectRoot: skill.projectRoot })
      groups.set(skill.contentHash, group)
    }
    for (const group of groups.values()) group.defaultLocation = state.defaultCopies[`${actionAccount?.accountId ?? 'local'}:${group.contentHash}`] ?? null
    lastDiscovery = { skills: [...groups.values()], diagnostics }
    return lastDiscovery
  }

  async function importCandidates(candidates, payload, signal, origin, report, origins = {}) {
    checkRevision(payload)
    if (payload.entries !== undefined && (!Array.isArray(payload.entries) || payload.entries.some(key => typeof key !== 'string'))) throw new SkillError('技能选择无效')
    const selected = payload.entries === undefined ? candidates.filter(item => !item.error) : candidates.filter(item => payload.entries.includes(item.key))
    if (!selected.length || selected.some(item => item.error)) throw new SkillError('请选择有效的技能')
    if (payload.entries && (!Array.isArray(payload.entries) || payload.entries.length !== selected.length)) throw new SkillError('技能选择无效或重复')
    if (payload.enable !== undefined && typeof payload.enable !== 'boolean') throw new SkillError('启用状态必须为布尔值')
    const names = new Set(state.skills.filter(item => visibleTo(item, actionAccount)).map(item => item.name))
    for (const candidate of selected) {
      if (names.has(candidate.name)) throw new SkillError(`技能 ${candidate.name} 已存在；请先移除旧副本再导入`)
      names.add(candidate.name)
    }
    const created = []
    const staging = join(root, `import-${randomUUID()}`)
    await mkdir(staging)
    try {
      for (const candidate of selected) {
        signal?.throwIfAborted()
        const id = randomUUID()
        const destination = join(staging, id)
        for (const file of candidate.files) {
          const path = join(destination, ...safeRelative(file.path).split('/'))
          await mkdir(dirname(path), { recursive: true })
          await writeFile(path, file.bytes, { flag: 'wx', mode: file.mode, signal })
        }
        const { key, ...summary } = publicCandidate(candidate)
        created.push({ id, ...summary, installed: payload.draft !== true, enabled: payload.draft !== true && payload.enable === true, importedAt: new Date().toISOString(), origin: origins[candidate.name] ?? origin })
      }
      await assertStorage()
      signal?.throwIfAborted()
      for (const item of created) await rename(join(staging, item.id), join(packages, item.id))
      if (origin.kind === 'store') await backend.assertAccount(actionAccount)
      await save({ ...state, skills: [...state.skills, ...created], reports: report ? [...state.reports, report] : state.reports })
      return { revision: state.revision, skills: created }
    } catch (error) {
      for (const item of created) await rm(join(packages, item.id), { recursive: true, force: true })
      throw error
    } finally { await rm(staging, { recursive: true, force: true }) }
  }

  async function install(payload, signal) {
    checkRevision(payload)
    const account = await backend.account()
    const id = requiredString(payload.id, '资源 ID', 256)
    const version = requiredString(payload.version, '版本', 64)
    const { data: lock } = await backend.request('installations/resolve', { method: 'POST', signal, body: {
      requirements: [{ assetId: id, versionRange: version }],
      installationUid: state.installationUid,
      target: { os: process.platform === 'win32' ? 'windows' : process.platform, arch: process.arch === 'arm64' ? 'arm64' : 'x64', runtimes: ['prompt_only', 'node', 'python'], transports: ['stdio', 'http', 'sse'] },
    } })
    if (lock?.schemaVersion !== 'stratex.registry-lock/v1' || !Array.isArray(lock.capabilities)
      || !lock.capabilities.some(item => item.assetId === id && item.version === version)) throw new SkillError('后端返回的技能安装锁无效')
    if (typeof lock.resolutionId !== 'string' || !lock.resolutionId) throw new SkillError('后端缺少安装结果标识')
    let committed = false
    try {
      const connectors = lock.capabilities.filter(item => item.assetType === 'mcp')
      if (connectors.length) {
        const service = ctx.get('sealHarnessConnectors')
        if (!service) throw new SkillError('连接器插件未加载')
        await service.call('installResolved', { items: connectors }, signal)
      }
      const candidates = []
      const origins = {}
      let downloaded = 0
      for (const item of lock.capabilities.filter(item => item.assetType === 'skill')) {
        if (state.skills.some(skill => skill.origin?.assetId === item.assetId && skill.origin?.version === item.version && visibleTo(skill, account))) continue
        if (!item.artifact || !/^[0-9a-f]{64}$/.test(item.artifact.sha256) || !Number.isSafeInteger(item.artifact.sizeBytes)
          || item.artifact.sizeBytes <= 0 || item.artifact.sizeBytes > MAX_PACKAGE_BYTES) throw new SkillError('技能文件信息无效')
        downloaded += item.artifact.sizeBytes
        if (downloaded > MAX_PACKAGE_BYTES) throw new SkillError('技能及依赖总计超过 64 MiB')
        const path = `skills/${encodeURIComponent(item.assetId)}/versions/${encodeURIComponent(item.version)}/export`
        const { bytes } = await backend.download(path, { signal, maxBytes: item.artifact.sizeBytes })
        if (bytes.length !== item.artifact.sizeBytes || createHash('sha256').update(bytes).digest('hex') !== item.artifact.sha256) throw new SkillError('技能下载的大小或 SHA-256 校验失败')
        const inspected = inspectFiles(readArchive(bytes))
        for (const candidate of inspected) origins[candidate.name] = { kind: 'store', accountId: account.accountId, assetId: item.assetId, version: item.version, permissions: item.permissions ?? [] }
        candidates.push(...inspected)
      }
      if (candidates.some(item => item.error)) throw new SkillError(candidates.find(item => item.error).error)
      await backend.assertAccount(account)
      const report = { accountId: account.accountId, resolutionId: lock.resolutionId, body: { status: 'succeeded', versions: Object.fromEntries(lock.capabilities.map(item => [item.assetId, item.version])) } }
      const result = candidates.length ? await importCandidates(candidates, payload, signal, { kind: 'store', accountId: account.accountId, assetId: id, version,
        permissions: lock.capabilities.flatMap(item => item.permissions ?? []), security: lock.capabilities.map(item => item.security).filter(Boolean) }, report, origins) : { revision: await save({ ...state, reports: [...state.reports, report] }), skills: [] }
      committed = true
      const reported = await flushReports(signal)
      return { ...result, revision: state.revision, resolutionId: lock.resolutionId, reported }
    } catch (error) {
      if (!committed) {
        await save({ ...state, reports: [...state.reports, { accountId: account.accountId, resolutionId: lock.resolutionId, body: { status: 'failed', errorCode: 'INSTALL_FAILED', versions: {} } }] })
        // 先保留原始失败；回执即使断网或身份变化也可由原账号重试。
        try { await flushReports(signal) } catch { /* 持久队列保留回执。 */ }
      }
      throw error
    }
  }

  async function flushReports(signal) {
    if (!actionAccount) return false
    for (const report of state.reports.filter(item => item.accountId === actionAccount.accountId)) {
      try {
        await backend.assertAccount(actionAccount)
        await backend.request(`installations/${encodeURIComponent(report.resolutionId)}/result`, { method: 'POST', body: report.body, signal })
      } catch (error) {
        if (error.code === 'identityChanged') throw error
        return false
      }
      await save({ ...state, reports: state.reports.filter(item => item !== report) })
    }
    return true
  }

  async function action(payload = {}, signal) {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new SkillError('技能请求格式无效')
    if (disposed) throw new SkillError('技能插件已卸载')
    signal?.throwIfAborted()
    actionAccount = await currentAccount()
    await syncAccount(actionAccount)
    switch (payload.action) {
      case 'setDefaultCopy': {
        checkRevision(payload)
        const result = lastDiscovery ?? { skills: [] }
        const group = result.skills.find(item => item.contentHash === payload.contentHash)
        const location = group?.locations.find(item => item.sourceId === payload.sourceId && item.key === payload.key)
        if (!location) throw new SkillError('技能位置已变化，请重新扫描')
        const fresh = (await inspectPath(location.path, signal)).find(item => item.contentHash === group.contentHash)
        if (!fresh) throw new SkillError('技能内容已变化，请重新扫描')
        const key = `${actionAccount?.accountId ?? 'local'}:${group.contentHash}`
        await save({ ...state, defaultCopies: { ...state.defaultCopies, [key]: { ...location, name: group.name, accountId: actionAccount?.accountId ?? null } } })
        group.defaultLocation = state.defaultCopies[key]
        return result
      }
      case 'installResolved': {
        const account = await backend.account()
        for (const item of payload.items) {
          if (state.skills.some(skill => skill.origin?.assetId === item.assetId && skill.origin?.version === item.version && visibleTo(skill, account))) continue
          if (item.assetType !== 'skill' || !item.artifact || !/^[a-f0-9]{64}$/.test(item.artifact.sha256) || item.artifact.sizeBytes > MAX_PACKAGE_BYTES) throw new SkillError('技能依赖文件信息无效')
          const { bytes } = await backend.download(`skills/${encodeURIComponent(item.assetId)}/versions/${encodeURIComponent(item.version)}/export`, { signal, maxBytes: item.artifact.sizeBytes })
          if (bytes.length !== item.artifact.sizeBytes || createHash('sha256').update(bytes).digest('hex') !== item.artifact.sha256) throw new SkillError('技能下载完整性检查失败')
          await backend.assertAccount(account)
          await importCandidates(inspectFiles(readArchive(bytes)), {}, signal, { kind: 'store', accountId: account.accountId, assetId: item.assetId, version: item.version })
        }
        return list()
      }
      case 'list': return list()
      case 'sources': return sources()
      case 'approveSource': {
        checkRevision(payload)
        const path = requiredString(payload.path, '来源路径')
        if (!isAbsolute(path) || !(await lstat(path)).isDirectory()) throw new SkillError('请选择真实的绝对目录，不能使用符号链接')
        const canonical = await realpath(path)
        if (!state.sources.some(source => source.path === canonical)) await save({ ...state, sources: [...state.sources, { id: randomUUID(), path: canonical, label: payload.label ? requiredString(payload.label, '来源名称', 160) : basename(canonical) }] })
        return sources()
      }
      case 'revokeSource':
        checkRevision(payload)
        await save({ ...state, sources: state.sources.filter(item => item.id !== payload.id), defaultCopies: Object.fromEntries(Object.entries(state.defaultCopies).filter(([, item]) => item.sourceId !== payload.id)) })
        return sources()
      case 'discover': return discover(payload, signal)
      case 'inspect': {
        let path = payload.path
        if (payload.sourceId) {
          const source = (await sources()).sources.find(item => item.id === payload.sourceId && item.status === 'ready')
          if (!source || await realpath(source.path) !== source.path) throw new SkillError('来源不存在或已变化')
          path = payload.key === '.' ? source.path : join(source.path, safeRelative(payload.key))
          if (!inside(source.path, await realpath(path))) throw new SkillError('技能路径越界')
        }
        const candidates = payload.zipBase64 !== undefined
          ? inspectFiles(readArchive(Buffer.from(requiredString(payload.zipBase64, 'ZIP 数据', Math.ceil(MAX_PACKAGE_BYTES * 4 / 3) + 4), 'base64')))
          : await inspectPath(path, signal)
        preview = { token: randomUUID(), candidates, expires: Date.now() + 10 * 60_000 }
        return { token: preview.token, candidates: candidates.map(candidate => ({ ...publicCandidate(candidate), instructionPreview: candidate.content?.slice(0, 16_000) })) }
      }
      case 'import': {
        if (!preview || preview.token !== payload.token || preview.expires < Date.now()) throw new SkillError('导入预览已失效，请重新选择文件')
        const result = await importCandidates(preview.candidates, payload, signal, { kind: 'local' })
        preview = undefined
        return result
      }
      case 'runtimeSkill': {
        const item = state.skills.find(item => (item.id === payload.id || item.origin?.assetId === payload.id) && visibleTo(item, actionAccount))
        if (!item || item.installed === false) throw new SkillError('绑定技能未安装，请先安装')
        const files = await managedFiles(item.id, signal)
        const candidate = inspectFiles(files).find(item => item.key === '.')
        if (!candidate || candidate.error || candidate.contentHash !== item.contentHash) throw new SkillError('绑定技能已变化，请重新导入')
        return { name: candidate.name, description: candidate.description, content: candidate.content, invocation: candidate.invocation, source: 'runtime', path: join(packages, item.id, 'SKILL.md'), resourceBase: { kind: 'directory', path: join(packages, item.id) } }
      }
      case 'workflowResources': return { resources: state.skills.filter(item => item.installed !== false && visibleTo(item, actionAccount)).map(item => ({ kind: 'skill', sourceId: item.id, version: `0.1.0+${item.contentHash.slice(0, 12)}`, name: item.name, ...(item.fileCount > 100 ? { unavailableReason: '资源文件超过 100 个。' } : {}) })) }
      case 'workflowExport': {
        const item = find(payload.sourceId)
        if (payload.kind !== 'skill' || payload.version !== `0.1.0+${item.contentHash.slice(0, 12)}`) throw new SkillError('技能已更新，请重新选择')
        const files = await managedFiles(item.id, signal)
        if (files.length > 100 || files.some(file => file.bytes.length > 450_000)) throw new SkillError('技能文件超过流程交付容量')
        const actual = inspectFiles(files).find(candidate => candidate.key === '.')
        if (actual?.contentHash !== item.contentHash) throw new SkillError('技能内容已变化，请重新导入')
        const descriptor = { schemaVersion: 'stratex.capability/v1', description: item.description, runtime: 'prompt_only', authMode: 'none', entrypoint: 'SKILL.md', files: files.map(file => ({ path: file.path, sizeBytes: file.bytes.length, sha256: createHash('sha256').update(file.bytes).digest('hex') })), publisherSource: payload }
        let portableFiles
        try { portableFiles = files.map(file => ({ path: file.path, content: new TextDecoder('utf-8', { fatal: true }).decode(file.bytes) })) }
        catch { throw new SkillError('流程资源仅支持 UTF-8 文本文件') }
        return { capabilities: [{ assetId: item.id, assetType: 'skill', name: item.name, version: payload.version, descriptor, files: portableFiles }], credentials: [] }
      }
      case 'create': {
        if (typeof payload.content !== 'string' || Buffer.byteLength(payload.content) > 16 * 1024 * 1024) throw new SkillError('技能文件内容无效或超过 16 MiB')
        if (payload.draft !== undefined && typeof payload.draft !== 'boolean') throw new SkillError('技能创建状态无效')
        return importCandidates(inspectFiles([{ path: 'SKILL.md', bytes: Buffer.from(payload.content), mode: 0o644 }]), payload, signal, { kind: 'local' })
      }
      case 'installPersonal': {
        checkRevision(payload)
        const item = find(payload.id)
        if (item.installed !== false) return list()
        const files = await managedFiles(item.id, signal)
        const actual = inspectFiles(files).find(candidate => candidate.key === '.')
        if (!actual || actual.error || actual.name !== item.name || actual.contentHash !== item.contentHash) throw new SkillError('技能内容已变化，请重新创建后安装')
        await save({ ...state, skills: state.skills.map(skill => skill.id === item.id ? { ...skill, installed: true, enabled: true } : skill) })
        return list()
      }
      case 'saveFile': {
        checkRevision(payload)
        const item = find(payload.id), path = safeRelative(payload.path)
        if (typeof payload.content !== 'string' || Buffer.byteLength(payload.content) > 16 * 1024 * 1024) throw new SkillError('技能文件内容无效或超过 16 MiB')
        const files = await managedFiles(item.id, signal)
        const actual = inspectFiles(files).find(candidate => candidate.key === '.')
        if (!actual || actual.error || actual.contentHash !== payload.expectedHash || actual.contentHash !== item.contentHash) throw new SkillError('技能副本已变化，请刷新后重试')
        const previous = files.find(file => file.path === path)
        if (!previous) throw new SkillError('技能文件不存在')
        const replacement = { ...previous, bytes: Buffer.from(payload.content) }
        const updated = inspectFiles(files.map(file => file.path === path ? replacement : file)).find(candidate => candidate.key === '.')
        if (!updated || updated.error) throw new SkillError(updated?.error ?? '技能内容无效')
        if (state.skills.some(skill => skill.id !== item.id && visibleTo(skill, actionAccount) && skill.name === updated.name)) throw new SkillError('此名称的技能已经存在')
        const destination = join(packages, item.id, path), temporary = `${destination}.${randomUUID()}.tmp`
        const { key, ...summary } = publicCandidate(updated)
        try {
          await writeFile(temporary, replacement.bytes, { flag: 'wx', mode: previous.mode, signal })
          await rename(temporary, destination)
          try { await save({ ...state, skills: state.skills.map(skill => skill.id === item.id ? { ...skill, ...summary, origin: { kind: 'local' } } : skill) }) }
          catch (error) { await writeFile(temporary, previous.bytes, { mode: previous.mode }); await rename(temporary, destination); throw error }
        } finally { await rm(temporary, { force: true }) }
        return list()
      }
      case 'detail': {
        const item = find(payload.id)
        const files = await managedFiles(item.id, signal)
        const instruction = parseSkill(files.find(file => file.path === 'SKILL.md')?.bytes)
        const member = payload.path ? files.find(file => file.path === safeRelative(payload.path)) : undefined
        if (payload.path && !member) throw new SkillError('技能文件不存在')
        let text = instruction.content
        if (member) {
          try { text = new TextDecoder('utf8', { fatal: true }).decode(member.bytes) }
          catch { throw new SkillError('该文件不是 UTF-8 文本，可导出技能包后查看') }
        }
        const limit = payload.edit === true ? 16 * 1024 * 1024 : 16_000
        return { ...item, ...instruction, content: instruction.content.slice(0, limit),
          rawContent: files.find(file => file.path === 'SKILL.md').bytes.toString('utf8').slice(0, limit), files: files.map(file => ({ path: file.path, size: file.bytes.length })), previewTruncated: text.length > limit,
          ...(member ? { filePath: member.path, fileContent: text.slice(0, limit) } : {}) }
      }
      case 'setEnabled': {
        checkRevision(payload)
        if (typeof payload.enabled !== 'boolean') throw new SkillError('启用状态必须为布尔值')
        const item = find(payload.id)
        if (payload.enabled && item.installed === false) throw new SkillError('请先安装技能')
        if (payload.enabled) {
          const files = await managedFiles(item.id, signal)
          const actual = inspectFiles(files).find(candidate => candidate.key === '.')
          if (!actual || actual.error || actual.name !== item.name || actual.contentHash !== item.contentHash) throw new SkillError('技能副本内容已变化，请重新导入后启用')
        }
        await save({ ...state, skills: state.skills.map(skill => skill.id === item.id ? { ...skill, enabled: payload.enabled } : skill) })
        return list()
      }
      case 'remove': {
        checkRevision(payload)
        const item = find(payload.id)
        await assertStorage()
        await save({ ...state, skills: state.skills.filter(skill => skill.id !== item.id) })
        await rm(join(packages, item.id), { recursive: true, force: true })
        return list()
      }
      case 'install': return install(payload, signal)
      case 'export': {
        const item = find(payload.id)
        return { fileName: `${item.name}.zip`, zipBase64: createArchive(await managedFiles(item.id, signal)).toString('base64') }
      }
      case 'retryReports': return { reported: await flushReports(signal) }
      default: throw new SkillError('未知技能操作')
    }
  }

  // ponytail: 单个管理队列避免并发覆盖；大量技能远端安装成为瓶颈时再拆为每包队列。
  let queue = Promise.resolve()
  const actions = ['list', 'sources', 'setDefaultCopy', 'approveSource', 'revokeSource', 'discover', 'inspect', 'import', 'detail', 'create', 'installPersonal', 'saveFile', 'setEnabled', 'remove', 'install', 'export', 'retryReports']
  const handlers = Object.fromEntries([...actions, 'workflowResources', 'workflowExport', 'runtimeSkill', 'installResolved'].map(name => [name, (payload = {}, signal) => {
      const result = queue.then(async () => {
        if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new SkillError('技能请求格式无效')
        const value = await action({ ...payload, action: name }, signal)
        if (actionAccount) await backend.assertAccount(actionAccount)
        return value
      })
      queue = result.catch(() => {})
      return result
    }]))
  await syncAccount(await currentAccount())
  const unsubscribeIdentity = identity?.subscribe?.(() => {
    queue = queue.then(async () => { await syncAccount(await currentAccount()) }).catch(error => ctx.logger?.warn?.(`技能数据切换失败：${error.message}`))
  })
  return {
    handlers: Object.fromEntries(actions.map(name => [name, handlers[name]])),
    hostHandlers: { installResolved: handlers.installResolved, runtimeSkill: handlers.runtimeSkill, workflowResources: handlers.workflowResources, workflowExport: handlers.workflowExport },
    async dispose() {
      disposed = true
      unsubscribeIdentity?.()
      await queue
      preview = undefined
      unregister()
      releaseSources()
      await sourceFilesystem?.dispose()
      await filesystem.dispose()
    },
  }
}
