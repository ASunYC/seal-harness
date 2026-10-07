import { ExpertError } from './package.js'

export async function capabilityOptions(ctx) {
  const items = []
  for (const [kind, serviceName] of [['skill', 'sealHarnessSkills'], ['mcp', 'sealHarnessConnectors']]) {
    const service = ctx.get?.(serviceName)
    if (!service) continue
    const result = await service.call('list')
    for (const item of result.skills ?? result.items) {
      if (item.installed === false) continue
      items.push({ kind, sourceId: item.id, name: item.name, enabled: item.enabled, ...(kind === 'mcp' ? { status: item.status } : {}) })
    }
  }
  return { items }
}

/** 只解析专家明确绑定的能力；工具继续由原插件的 DSH runtime 执行。 */
export async function resolveCapabilities(ctx, references = []) {
  const skills = [], toolNames = []
  for (const reference of references) {
    if (reference.kind === 'skill') {
      const service = ctx.get?.('sealHarnessSkills')
      if (!service) throw new ExpertError('技能插件未加载。')
      const skill = await service.call('runtimeSkill', { id: reference.sourceId })
      skills.push(skill)
    } else {
      const service = ctx.get?.('sealHarnessConnectors')
      if (!service) throw new ExpertError('连接器插件未加载。')
      const { items } = await service.call('list')
      const connector = items.find(item => item.id === reference.sourceId || item.source?.id === reference.sourceId)
      if (!connector || !connector.enabled || connector.status !== 'active') throw new ExpertError(`请先启用并连接专家绑定的连接器：${connector?.name ?? reference.sourceId}`)
      toolNames.push(...connector.tools.filter(tool => !connector.enabledTools || connector.enabledTools.includes(tool.name)).map(tool => `mcp__zz-${connector.id}__${tool.name}`))
    }
  }
  return { skills, toolNames }
}

export async function materializeSkills(pkg, directory) {
  const { inspectFiles } = await import('../../skills/src/package.js')
  const { mkdir, readFile, writeFile } = await import('node:fs/promises')
  const { dirname, join } = await import('node:path')
  const definitions = []
  for (const reference of [...new Set([...(pkg.manifest.skills ?? []), ...(pkg.portableDependencies ?? []).filter(item => item.kind === 'skill').map(item => item.packageRoot)])]) {
    const prefix = reference.endsWith('/SKILL.md') ? reference.slice(0, -8) : `${reference.replace(/\/$/, '')}/`
    const candidates = inspectFiles([...pkg.files].filter(([path]) => path.startsWith(prefix)).map(([path, bytes]) => ({ path: path.slice(prefix.length), bytes, mode: 0o644 })))
    for (const candidate of candidates) {
      if (candidate.error) throw new ExpertError(candidate.error)
      const root = join(directory, candidate.name)
      for (const file of candidate.files) {
        const target = join(root, file.path)
        await mkdir(dirname(target), { recursive: true })
        try { await writeFile(target, file.bytes, { flag: 'wx', mode: file.mode }) }
        catch (error) { if (error.code !== 'EEXIST' || !(await readFile(target)).equals(file.bytes)) throw new ExpertError('专家技能副本内容发生变化，请重新导入。') }
      }
      definitions.push({ name: candidate.name, description: candidate.description, content: candidate.content, invocation: candidate.invocation, source: 'runtime', path: join(root, 'SKILL.md'), resourceBase: { kind: 'directory', path: root } })
    }
  }
  return definitions
}

export async function materializeConnectors(pkg, directory, ctx, accountId) {
  const { mkdir, readFile, writeFile, chmod } = await import('node:fs/promises')
  const { dirname, join } = await import('node:path')
  const { safePath } = await import('./package.js')
  const servers = []
  for (const dependency of pkg.portableDependencies ?? []) {
    if (dependency.kind !== 'mcp') continue
    const prefix = `${dependency.packageRoot}/`
    const descriptorFile = pkg.files.get(`${prefix}descriptor.json`)
    if (!descriptorFile) throw new ExpertError('专家 MCP 依赖缺少 descriptor.json。')
    const descriptor = JSON.parse(descriptorFile.toString('utf8'))
    const service = ctx?.get?.('sealHarnessConnectors')
    if (service) {
      const item = await service.call('ensurePackage', { sourceId: dependency.sourceId, version: dependency.version, descriptor, accountId, files: [...pkg.files].filter(([path]) => path.startsWith(prefix)).map(([path, bytes]) => ({ path: path.slice(prefix.length), bytes })) })
      if (item.status !== 'active') throw new ExpertError(`请在连接器页完成“${item.name}”的配置：${item.issue ?? '连接尚未就绪'}`)
      continue
    }

    const root = join(directory, safePath(dependency.packageRoot))
    for (const [path, bytes] of pkg.files) {
      if (!path.startsWith(prefix)) continue
      const target = join(root, safePath(path.slice(prefix.length)))
      await mkdir(dirname(target), { recursive: true })
      try { await writeFile(target, bytes, { flag: 'wx' }) }
      catch (error) { if (error.code !== 'EEXIST' || !(await readFile(target)).equals(bytes)) throw new ExpertError('专家连接器副本内容发生变化，请重新导入。') }
    }
    if (descriptor.transport === 'stdio') {
      const command = join(root, safePath(descriptor.executable))
      await chmod(command, 0o755)
      servers.push({ serverName: `dependency-${servers.length}`, transport: 'stdio', command, args: descriptor.args ?? [], cwd: descriptor.workingDirectory ? join(root, safePath(descriptor.workingDirectory)) : root, env: Object.fromEntries((descriptor.environmentVariables ?? []).map(item => [item.name, item.value])) })
    } else {
      const headers = Object.fromEntries((descriptor.staticHeaders ?? []).map(item => [item.headerName, item.value]))
      servers.push({ serverName: `dependency-${servers.length}`, transport: descriptor.transport === 'sse' ? 'sse' : 'streamable-http', url: descriptor.endpointTemplate, headers })
    }
  }
  return servers
}
