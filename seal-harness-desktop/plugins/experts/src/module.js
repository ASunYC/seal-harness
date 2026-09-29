import { createHash, randomUUID } from 'node:crypto'
import { lstat, mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { z } from 'zod'
import { ExpertError, MANIFEST, decodeZip, draftFiles, encodeZip, manifestSchema, nameSchema, portablePackage, readDirectory, validatePackage, versionSchema } from './package.js'
import { capabilityOptions, materializeSkills, materializeConnectors, resolveCapabilities } from './capabilities.js'
import { changeVisibility, downloadExpert, uploadExpert } from './remote.js'

const selectedSchema = z.object({ name: nameSchema, version: versionSchema.optional() })
const mutationSchema = selectedSchema.extend({ expectedDigest: z.string().regex(/^[a-f0-9]{64}$/) })
const stateSchema = z.object({
  enabled: versionSchema.nullable().default(null), provider: z.string().optional(), creationKey: z.string(),
  versions: z.record(versionSchema, z.object({ digest: z.string().regex(/^[a-f0-9]{64}$/), createdAt: z.string() })),
  remote: z.record(z.string(), z.string()).default({}),
  knowledge: z.record(versionSchema, z.array(z.string().min(1)).max(64)).default({}),
  origin: z.object({ accountId: z.string(), assetId: z.string(), releaseId: z.string(), dependencyCount: z.number().int().nonnegative() }).optional(),
})

const packageProblems = () => []

async function safeDirectory(path) {
  await mkdir(path, { recursive: true })
  if (!(await lstat(path)).isDirectory()) throw new ExpertError('专家目录不能是符号链接或文件。')
}

async function atomicJson(path, value) {
  const temporary = `${path}.${randomUUID()}.tmp`
  try {
    await writeFile(temporary, JSON.stringify(value, null, 2) + '\n', { flag: 'wx' })
    await rename(temporary, path)
  } finally { await rm(temporary, { force: true }) }
}

/** @param {object} ctx @param {{home:string, backend:object}} options */
export async function createModule(ctx, { home, backend }) {
  const root = join(home, 'seal-harness-capabilities', 'experts')
  await safeDirectory(join(home, 'seal-harness-capabilities'))
  await safeDirectory(root)
  let disposed = false, queue = Promise.resolve()
  const mounted = new Map()
  const activationErrors = new Map()
  const service = name => typeof ctx.get === 'function' ? ctx.get(name) : ctx[name]
  const directory = name => join(root, nameSchema.parse(name))
  const statePath = name => join(directory(name), 'state.json')
  const presetId = name => `seal-harness-expert-${name}`
  const readState = async name => {
    if (!(await lstat(directory(name))).isDirectory()) throw new ExpertError('专家存储目录无效。')
    if (!(await lstat(statePath(name))).isFile()) throw new ExpertError('专家状态文件无效。')
    return stateSchema.parse(JSON.parse(await readFile(statePath(name), 'utf8')))
  }
  const access = async state => {
    if (state.origin && (await backend.account()).accountId !== state.origin.accountId) throw new ExpertError('此专家属于其他账号，请切换到导入时的账号。')
  }
  const load = async input => {
    const { name, version } = selectedSchema.parse(input), state = await readState(name)
    await access(state)
    const selected = version ?? state.enabled ?? Object.keys(state.versions).at(-1)
    if (!selected || !state.versions[selected]) throw new ExpertError('专家版本不存在。')
    const file = join(directory(name), `${selected}.zip`)
    const info = await lstat(file)
    if (!info.isFile() || info.size > 128 * 1024 * 1024) throw new ExpertError('专家版本文件无效。')
    const pkg = validatePackage(decodeZip(await readFile(file)))
    if (pkg.digest !== state.versions[selected].digest || pkg.manifest.name !== name || pkg.manifest.version !== selected) throw new ExpertError('专家版本内容已变化，请重新导入。')
    return { name, version: selected, state, pkg }
  }
  const checked = async input => {
    const parsed = mutationSchema.parse(input), loaded = await load(parsed)
    if (loaded.pkg.digest !== parsed.expectedDigest) throw new ExpertError('专家已修改，请刷新后重试。')
    return loaded
  }
  const save = async (pkg, origin, knowledgeGroupIds = []) => {
    knowledgeGroupIds = z.array(z.string().min(1).max(256)).max(64).parse(knowledgeGroupIds)
    const { name, version } = pkg.manifest
    await safeDirectory(directory(name))
    let state
    try { state = await readState(name) } catch (error) {
      if (error.code !== 'ENOENT') throw error
      state = { enabled: null, creationKey: randomUUID(), versions: {}, remote: {}, knowledge: {}, ...(origin ? { origin } : {}) }
    }
    await access(state)
    if (origin && state.origin?.assetId !== origin.assetId) throw new ExpertError('已有同名专家，请先为本地专家更名或移除。')
    if (state.versions[version]) {
      if (state.versions[version].digest !== pkg.digest) throw new ExpertError('同一版本不能覆盖不同内容，请增加版本号。')
      return { name, version, digest: pkg.digest, existing: true }
    }
    const file = join(directory(name), `${version}.zip`), bytes = encodeZip(pkg.files)
    try { await writeFile(file, bytes, { flag: 'wx' }) } catch (error) {
      if (error.code !== 'EEXIST') throw error
      const existing = validatePackage(decodeZip(await readFile(file)))
      if (existing.digest !== pkg.digest) throw new ExpertError('未登记的同版本文件已存在，请先处理存储冲突。')
    }
    await atomicJson(statePath(name), { ...state, knowledge: { ...state.knowledge, [version]: knowledgeGroupIds }, versions: { ...state.versions, [version]: { digest: pkg.digest, createdAt: new Date().toISOString() } } })
    return { name, version, digest: pkg.digest, problems: packageProblems(pkg) }
  }
  const unmount = async name => {
    await mounted.get(name)?.dispose()
    mounted.delete(name)
  }
  const mount = async (loaded, provider, audit = true) => {
    const { name, pkg, state } = loaded
    const problems = packageProblems(pkg)
    if (problems.length) throw new ExpertError(problems.join(' '))
    const registry = service('agentPresets'), llm = service('llm')
    if (!registry?.register || !registry.resolve || !llm?.resolveModelInfo) throw new ExpertError('当前运行时缺少公开 Agent preset 或模型服务。')
    const route = provider || service('agentDefaultModel')?.currentSelection()?.provider
    if (!route) throw new ExpertError('请先在设置中配置模型提供方。')
    await llm.resolveModelInfo(route, pkg.manifest.model)
    await access(state)
    const resolved = await resolveCapabilities(ctx, pkg.manifest.capabilities?.filter(reference => !pkg.portableDependencies.some(dependency => dependency.kind === reference.kind && dependency.sourceId === reference.sourceId)))
    resolved.skills.push(...await materializeSkills(pkg, join(directory(name), `${loaded.version}.skills`)))
    const mcpServers = await materializeConnectors(pkg, join(directory(name), `${loaded.version}.connectors`), ctx, state.origin?.accountId)
    const knowledgeGroupIds = state.knowledge[loaded.version] ?? []
    if (knowledgeGroupIds.length && !service('sealHarnessKnowledge')) throw new ExpertError('知识库插件未加载。')
    const definition = {
      id: presetId(name), name: pkg.manifest.displayName.zh,
      description: `${pkg.manifest.profession.zh} · ${pkg.manifest.description.zh}`,
      plugins: [{ name: '@seal-harness/experts/expert-runtime', config: { persona: pkg.manifest.personaInstructions, model: pkg.manifest.model, provider: route, expertName: name, version: loaded.version, reasoningEffort: pkg.manifest.reasoningEffort, personality: pkg.manifest.personality, skills: resolved.skills, toolNames: resolved.toolNames, knowledgeGroupIds, mcpServers, toolPolicy: pkg.manifest.toolPolicy, ...(state.origin ? { accountId: state.origin.accountId } : {}) } }],
    }
    const previous = mounted.get(name)
    await unmount(name)
    let dispose
    try {
      dispose = await registry.register(definition)
      // Host 加载过程中不能等待整个 Loader settle；交互启用时再核对诊断。
      if (audit) {
        const resolved = await registry.resolve(definition.id)
        if (resolved.broken) throw new ExpertError(resolved.broken)
      }
      mounted.set(name, { definition, dispose })
      activationErrors.delete(name)
      return { presetId: definition.id, provider: route }
    } catch (error) {
      await dispose?.()
      if (previous) mounted.set(name, { definition: previous.definition, dispose: await registry.register(previous.definition) })
      throw error
    }
  }
  const list = async () => {
    const items = []
    for (const entry of await readdir(root, { withFileTypes: true })) {
      if (!entry.isDirectory() || !nameSchema.safeParse(entry.name).success) continue
      try {
        const state = await readState(entry.name)
        try { await access(state) } catch { continue }
        const loaded = await load({ name: entry.name })
        items.push({ name: entry.name, version: loaded.version, displayName: loaded.pkg.manifest.displayName.zh, description: loaded.pkg.manifest.description.zh, category: loaded.pkg.manifest.categoryId ?? '', tags: loaded.pkg.manifest.tags?.map(tag => tag.zh) ?? [], digest: loaded.pkg.digest, enabled: mounted.has(entry.name), desiredVersion: state.enabled, problems: [...packageProblems(loaded.pkg), ...(activationErrors.has(entry.name) ? [activationErrors.get(entry.name)] : [])] })
      } catch (error) { items.push({ name: entry.name, error: error.message }) }
    }
    return { items, runtime: !!service('agentPresets'), note: '专家使用独立 DSH Agent 模式，按绑定能力提供技能与连接器。' }
  }
  const actions = {
    list,
    capabilities: () => capabilityOptions(ctx),
    knowledge: async (_input, signal) => service('sealHarnessKnowledge') ? service('sealHarnessKnowledge').invoke('list', { scope: 'installed' }, signal) : { items: [] },
    models: async () => {
      const llm = service('llm')
      if (!llm?.listProviders) return { items: [] }
      const providers = llm.listProviders()
      const items = []
      for (const provider of providers) for (const model of await llm.listModels(provider.id)) items.push({ provider: provider.id, id: model.id, name: model.name ?? model.id })
      return { items, default: service('agentDefaultModel')?.currentSelection() }
    },
    detail: async input => {
      const loaded = await load(input)
      return { knowledgeGroupIds: loaded.state.knowledge[loaded.version] ?? [], manifest: loaded.pkg.manifest, digest: loaded.pkg.digest, enabled: mounted.has(loaded.name), versions: Object.entries(loaded.state.versions).map(([version, meta]) => ({ version, ...meta, active: loaded.state.enabled === version })), problems: packageProblems(loaded.pkg), files: [...loaded.pkg.files.keys()], origin: loaded.state.origin ?? null }
    },
    versions: async input => (await actions.detail(input)).versions,
    create: async input => save(validatePackage(draftFiles(manifestSchema.parse(input.manifest))), undefined, input.knowledgeGroupIds),
    update: async input => {
      const loaded = await checked(input), manifest = manifestSchema.parse(input.manifest)
      if (manifest.name !== loaded.name || manifest.version === loaded.version) throw new ExpertError('编辑需要保留专家标识并增加版本号。')
      const files = new Map(loaded.pkg.files)
      files.set(MANIFEST, Buffer.from(JSON.stringify(manifest, null, 2) + '\n'))
      const entry = loaded.pkg.agents.find(agent => agent.name === manifest.entryAgent)
      if (!entry) throw new ExpertError('请保持入口 agent 不变。')
      const frontmatter = files.get(entry.path).toString('utf8').match(/^(---\r?\n[\s\S]*?\r?\n---)/)[0]
      files.set(entry.path, Buffer.from(`${frontmatter}\n\n${manifest.personaInstructions}\n`))
      return save(validatePackage(files), undefined, input.knowledgeGroupIds ?? loaded.state.knowledge[loaded.version])
    },
    import: async input => {
      const source = z.union([z.strictObject({ path: z.string().min(1).max(4096) }), z.strictObject({ contentBase64: z.string().max(180 * 1024 * 1024) })]).parse(input)
      let files
      if ('path' in source) {
        const info = await lstat(source.path)
        if (info.isDirectory()) files = await readDirectory(source.path)
        else {
          if (!info.isFile() || info.size > 128 * 1024 * 1024) throw new ExpertError('请选择有效的专家 ZIP 文件或目录。')
          files = decodeZip(await readFile(source.path))
        }
      } else {
        const bytes = Buffer.from(source.contentBase64, 'base64')
        if (bytes.toString('base64') !== source.contentBase64) throw new ExpertError('专家压缩包编码无效。')
        files = decodeZip(bytes)
      }
      return save(validatePackage(files))
    },
    export: async input => {
      const { pkg } = await load(input), portable = portablePackage(pkg)
      return { fileName: `${pkg.manifest.name}-${pkg.manifest.version}.zip`, contentBase64: encodeZip(portable.files).toString('base64'), stripped: portable.stripped }
    },
    activate: async input => {
      const loaded = await checked(input), provider = input.provider === undefined ? undefined : z.string().trim().min(1).max(256).parse(input.provider)
      const active = await mount(loaded, provider)
      try { await atomicJson(statePath(loaded.name), { ...loaded.state, enabled: loaded.version, provider: active.provider }) } catch (error) { await unmount(loaded.name); throw error }
      return active
    },
    deactivate: async input => {
      const loaded = await checked(input)
      await unmount(loaded.name)
      await atomicJson(statePath(loaded.name), { ...loaded.state, enabled: null })
      return { name: loaded.name, enabled: false }
    },
    remove: async input => {
      const loaded = await checked(input)
      await unmount(loaded.name)
      await rm(directory(loaded.name), { recursive: true })
      return { name: loaded.name, removed: true }
    },
    install: async (input, signal) => {
      const result = await downloadExpert(backend, z.strictObject({ id: z.string().min(1).max(256), version: z.string().min(1).max(256) }).parse(input), signal)
      await backend.assertAccount(result.account)
      return save(result.pkg, result.origin)
    },
    upload: async (input, signal) => {
      const loaded = await checked(input), account = await backend.account()
      const accountKey = createHash('sha256').update(account.accountId).digest('hex')
      return uploadExpert(backend, loaded.pkg, { assetId: loaded.state.remote[accountKey], creationKey: `seal-harness:${accountKey}:${loaded.state.creationKey}`, saveAsset: async (captured, assetId) => {
        await backend.assertAccount(captured)
        await atomicJson(statePath(loaded.name), { ...loaded.state, remote: { ...loaded.state.remote, [accountKey]: assetId } })
      } }, signal)
    },
    cloud: async (input, signal) => {
      const loaded = await load(input), account = await backend.account()
      const accountKey = createHash('sha256').update(account.accountId).digest('hex')
      const assetId = loaded.state.remote[accountKey]
      if (!assetId) throw new ExpertError('此专家尚未上传到当前账号。')
      const result = await backend.request(`experts/${encodeURIComponent(assetId)}`, { signal })
      await backend.assertAccount(account)
      if (result.data?.id !== assetId || !result.headers.get('etag')) throw new ExpertError('云端专家详情无效。')
      return { assetId, etag: result.headers.get('etag'), visibility: result.data.visibility ?? '未知', publicVersion: result.data.cloud?.publicVersion ?? null }
    },
    visibility: (input, signal) => changeVisibility(backend, input, signal),
  }
  // ponytail: 单 Host 实例串行文件写入；多个进程共用同一 Home 时再引入文件锁。
  const serial = action => (...args) => {
    const next = queue.then(() => {
      if (disposed) throw new ExpertError('专家插件已卸载。')
      args[1]?.throwIfAborted()
      return Promise.resolve(action(...args)).catch(error => {
        if (error instanceof z.ZodError) throw new ExpertError('专家字段不符合格式要求，请检查名称、版本、必填字段和兼容设置。')
        throw error
      })
    })
    queue = next.catch(() => {})
    return next
  }
  const reconcile = async () => {
    for (const entry of await readdir(root, { withFileTypes: true })) {
      if (!entry.isDirectory() || !nameSchema.safeParse(entry.name).success) continue
      try {
        const state = await readState(entry.name)
        if (state.enabled) await mount(await load({ name: entry.name, version: state.enabled }), state.provider, false)
      } catch (error) {
        await unmount(entry.name)
        activationErrors.set(entry.name, error.code === 'expertRejected' ? error.message : '专家无法恢复启用，请检查模型提供方和用户登录状态后重试。')
        ctx.logger?.warn?.(`专家 ${entry.name} 未启用：${error.message}`)
      }
    }
  }
  await reconcile()
  const unsubscribe = backend.getIdentity?.()?.subscribe?.(() => { void serial(reconcile)().catch(error => ctx.logger?.warn?.(error.message)) })
  return { handlers: Object.fromEntries(Object.entries(actions).map(([name, action]) => [name, serial(action)])), dispose: async () => {
    disposed = true
    unsubscribe?.()
    await queue
    const results = await Promise.allSettled([...mounted.keys()].map(unmount))
    if (results.some(result => result.status === 'rejected')) throw new ExpertError('部分专家预设无法卸载，请查看插件日志。')
  } }
}
