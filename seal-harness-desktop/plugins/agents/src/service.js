import { AUTONOMOUS_REMOTE_ERROR_MESSAGES } from '../stratex/main/services/autonomous-remote-errors.js'
import { join } from 'node:path'
import { AutonomousSshClient } from '../stratex/main/services/autonomous-ssh.js'
import { createNativeAgents, nativeRequest } from './native.js'
import { AutonomousRemoteService } from '../stratex/main/services/autonomous-remote-service.js'
import { AutonomousRemoteRuntime } from '../stratex/main/services/autonomous-remote-runtime.js'
import { AutonomousRemoteStore } from '../stratex/main/services/autonomous-remote-store.js'
import { AutonomousPlatformService } from '../stratex/main/services/autonomous-platform-service.js'
import { WorkflowInstancesService } from '../stratex/main/services/workflowInstancesService.js'
import { WorkflowCli } from '../stratex/main/services/workflowCli.js'
import { WorkflowRuntimeStore } from '../stratex/main/services/workflowRuntimeStore.js'
import { WORKFLOW_REMOTE_ERROR_MESSAGES, WorkflowRemoteService } from '../stratex/main/services/workflow-remote-service.js'
import { WorkflowRemoteRuntime } from '../stratex/main/services/workflow-remote-runtime.js'
import { WorkflowRemoteStore } from '../stratex/main/services/workflow-remote-store.js'
import { WorkflowLocalRequestSchema, WorkflowRemoteRequestSchema } from '../stratex/shared/protocol/workflow-instances.js'
import { AutonomousLocalRequestSchema, AutonomousRemoteRequestSchema } from '../stratex/shared/protocol/autonomous-instances.js'
import { TerminalPlatformRequestSchema } from '../stratex/shared/protocol/terminal-platform.js'
import { createEncryption } from './storage.js'
import { deploymentModels } from './models.js'
import { workflowResources } from './resources.js'

export async function createAgentService(ctx, { home, resources, encryption, services: injected = {} }) {
  const config = ctx.sealHarnessServices.getConfig(), identity = ctx.sealHarnessIdentity
  const lifetime = new AbortController()
  const ssh = new AutonomousSshClient(lifetime.signal)
  let disposed = false
  const accountKey = () => disposed ? null : identity.getSession()?.accountId ?? 'local'
  const storage = encryption ?? await createEncryption(ctx.credentials)
  const models = deploymentModels(ctx), data = join(home, 'seal-harness-agents')
  const external = async url => {
    const target = new URL(url)
    if (!['http:', 'https:'].includes(target.protocol)) throw new Error('管理页地址无效。')
    const runtime = ctx.get('desktopRuntime')
    if (!runtime?.openExternal) throw new Error('请在桌面应用中打开管理页。')
    await runtime.openExternal(target.href)
  }
  const localFlow = injected.localFlow ?? new WorkflowInstancesService({
    accountKey, ...models, storage: new WorkflowRuntimeStore(join(data, 'workflow-local'), storage),
    resources: workflowResources(ctx), openExternal: external,
    cli: new WorkflowCli({ signal: lifetime.signal, executable: process.execPath, resourceDirectory: join(resources, 'workflow-cli'), runtimePackDirectory: config.workflowRuntimePackDirectory || join(resources, 'workflow-runtime') }),
  })
  const localAuto = injected.localAuto ?? await createNativeAgents(ctx, join(data, 'native-agents.json'))
  const remoteAuto = injected.remoteAuto ?? new AutonomousRemoteService({ accountKey, ...models, store: new AutonomousRemoteStore(join(data, 'autonomous-remote'), storage), runtime: new AutonomousRemoteRuntime({ ssh, assetsDirectory: join(resources, 'autonomous-linux') }) })
  const remoteFlow = injected.remoteFlow ?? new WorkflowRemoteService({ accountKey, ...models, openExternal: external, store: new WorkflowRemoteStore(join(data, 'workflow-remote'), storage), runtime: new WorkflowRemoteRuntime({ ssh, assetsDirectory: join(resources, 'workflow-linux'), runtimePackDirectory: config.workflowRuntimePackDirectory || join(resources, 'workflow-runtime') }) })
  const platformOptions = { signal: lifetime.signal, baseUrl: config.terminalBaseUrl, accountKey: () => disposed ? null : identity.getSession()?.accountId ?? null, ownerId: () => identity.getSession()?.subject ?? null, accessToken: () => identity.getAccessToken(), refreshAccessToken: async () => { await identity.refreshSession(); return identity.getAccessToken() } }
  const platformAuto = injected.platformAuto ?? new AutonomousPlatformService(platformOptions)
  const platformFlow = injected.platformFlow ?? new AutonomousPlatformService({ ...platformOptions, mode: 'planner' })
  const unwrap = value => { if (value.ok === false) throw Object.assign(new Error(value.error.message), { code: value.error.code }); return value.ok === true ? value.value : value }
  const groups = { autonomous: { local: localAuto, remote: remoteAuto, platform: platformAuto }, flow: { local: localFlow, remote: remoteFlow, platform: platformFlow } }
  return {
    async request({ kind, target, request }) {
      const schema = target === 'local' && kind === 'autonomous' ? nativeRequest : target === 'platform' ? TerminalPlatformRequestSchema : kind === 'flow' ? target === 'local' ? WorkflowLocalRequestSchema : WorkflowRemoteRequestSchema : target === 'local' ? AutonomousLocalRequestSchema : AutonomousRemoteRequestSchema
      const input = schema.parse(request)
      try { return unwrap(await groups[kind][target].request(input)) }
      catch (error) { throw Object.assign(new Error(({ ...AUTONOMOUS_REMOTE_ERROR_MESSAGES, ...WORKFLOW_REMOTE_ERROR_MESSAGES })[error.message] ?? error.message), { code: error.code ?? error.message }) }
    },
    async catalog() {
      const result = { instances: [], operations: [], notices: [], services: { terminalBaseUrl: config.terminalBaseUrl, workflowRuntimePackDirectory: config.workflowRuntimePackDirectory } }
      await Promise.all(Object.entries(groups).flatMap(([kind, targets]) => Object.entries(targets).map(async ([target, service]) => {
        try {
          const action = target === 'platform' ? 'platform-catalog' : target === 'remote' ? 'remote-catalog' : kind === 'flow' ? 'list' : 'snapshot'
          const value = unwrap(await service.request({ action }))
          result.instances.push(...value.instances.map(item => ({ ...item, kind, target })))
          if (value.operation) result.operations.push({ ...value.operation, kind, target })
        } catch (error) { result.notices.push({ kind, target, message: error.message }) }
      })))
      return result
    },
    models: models.models,
    dispose: async () => { disposed = true; lifetime.abort(); await localAuto.dispose?.() },
    async open({ kind, target, id }) {
      if (target === 'local' && kind === 'autonomous') return localAuto.request({ action: 'open', id })
      if (target === 'remote' && kind === 'autonomous') unwrap(await remoteAuto.request({ action: 'remote-open-manage', id }))
      const value = await this.request({ kind, target, request: { action: target === 'platform' ? 'platform-catalog' : target === 'remote' ? 'remote-catalog' : 'list' } })
      const item = value.instances.find(item => item.id === id)
      if (!item?.adminUrl || !['running', 'ready'].includes(item.status)) throw new Error('实例未运行，请先启动。')
      await external(item.adminUrl)
      return { opened: true }
    },
  }
}
