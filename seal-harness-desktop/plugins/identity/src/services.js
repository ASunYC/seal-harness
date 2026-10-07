import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { dirname, join, resolve } from 'node:path'
import { parseDocument } from 'yaml'
import { z } from 'zod'

export const serviceDefaults = Object.freeze({
  identityBaseUrl: '',
  collaborationBaseUrl: '',
  storeBaseUrl: '',
  mcpCenterBaseUrl: '',
  knowledgeBaseUrl: '',
  terminalBaseUrl: '',
  knowledgeTargetType: 'standalone',
  workflowRuntimePackDirectory: '',
})

export function normalizeServiceUrl(value) {
  if (value === '') return ''
  const url = new URL(value)
  if (!/^https?:\/\//i.test(value) || url.username || url.password || /[?#\\]/.test(value)
    || value.slice(value.indexOf('//') + 2).split('/')[0].includes('@')
    || /(?:^|\/)api\/v1(?:\/|$)/i.test(decodeURIComponent(url.pathname))) throw new Error('invalid URL')
  url.pathname = `${url.pathname.replace(/\/+$/, '')}/`
  return url.href
}

const serviceUrl = z.string().trim().transform((value, ctx) => {
  try { return normalizeServiceUrl(value) }
  catch { ctx.addIssue({ code: 'custom', message: '必须是无凭据、query、hash 和 api/v1 后缀的 HTTP(S) 服务根地址' }); return z.NEVER }
})
const directoryKeys = ['workflowRuntimePackDirectory']
const knowledgeServiceSchema = z.object({ id: z.string().min(1), name: z.string().trim().min(1), baseUrl: serviceUrl, targetType: z.enum(['standalone', 'platform']) })
export const servicesSchema = z.strictObject({
  ...Object.fromEntries(Object.keys(serviceDefaults).filter(key => key.endsWith('BaseUrl')).map(key => [key, serviceUrl.optional()])),
  knowledgeTargetType: z.enum(['standalone', 'platform']).optional(),
  ...Object.fromEntries(directoryKeys.map(key => [key, z.string().trim().optional()])),
  knowledgeServices: z.array(knowledgeServiceSchema).optional(),
  activeKnowledgeServiceId: z.string().optional(),
})
  .transform(values => Object.fromEntries(Object.entries(values).filter(([, value]) => value !== undefined)))

export async function loadServices({ home, services = {}, env = process.env }) {
  const selected = env.SEAL_HARNESS_SERVICES_CONFIG
  const file = resolve(selected || join(home, 'services.yml'))
  let fromFile = {}
  try {
    const document = parseDocument(await readFile(file, 'utf8'), { uniqueKeys: true, maxAliasCount: 0 })
    if (document.errors.length) throw new Error('YAML 格式无效')
    fromFile = servicesSchema.parse(document.toJS({ maxAliasCount: 0 }) ?? {})
  } catch (error) {
    if (error.code !== 'ENOENT' || selected) {
      const keys = error instanceof z.ZodError ? error.issues.map(issue => issue.path.join('.')).join(', ') : 'YAML 或文件'
      throw new Error(`Seal Harness服务配置 ${file} 无效（${keys}），请检查 services.example.yml；配置值不写入日志。`)
    }
  }
  const explicit = servicesSchema.safeParse(services)
  if (!explicit.success) throw new Error(`Seal Harness插件 services 配置无效：${explicit.error.issues.map(issue => issue.path.join('.')).join(', ')}`)
  const listeners = new Set()
  const configured = () => ({ ...serviceDefaults, ...fromFile, ...explicit.data })
  function getKnowledgeConfiguration() {
    const values = configured()
    const profiles = [
      { id: 'default', name: '默认知识服务', baseUrl: values.knowledgeBaseUrl, targetType: values.knowledgeTargetType, builtIn: true },
      ...(values.knowledgeServices ?? []).map(profile => ({ ...profile, builtIn: false })),
    ]
    const activeServiceId = values.activeKnowledgeServiceId || 'default'
    if (!profiles.some(profile => profile.id === activeServiceId)) throw new Error('选中的知识服务不存在，请检查 services.yml。')
    if (new Set(profiles.map(profile => profile.id)).size !== profiles.length) throw new Error('知识服务 ID 重复，请检查 services.yml。')
    return { activeServiceId, services: profiles }
  }
  function getConfig() {
    const { knowledgeServices, activeKnowledgeServiceId, ...values } = configured()
    const snapshot = getKnowledgeConfiguration()
    const active = snapshot.services.find(profile => profile.id === snapshot.activeServiceId)
    values.knowledgeBaseUrl = active.baseUrl
    values.knowledgeTargetType = active.targetType
    for (const key of directoryKeys) if (values[key]) values[key] = resolve(dirname(file), values[key])
    return Object.freeze(values)
  }
  getKnowledgeConfiguration()
  let pending = Promise.resolve()
  function updateKnowledge(change) {
    const operation = pending.then(async () => {
      if (explicit.data.knowledgeServices || explicit.data.activeKnowledgeServiceId) throw new Error('知识服务列表由插件配置管理，请在对应插件配置中修改。')
      const snapshot = getKnowledgeConfiguration()
      const next = change(snapshot)
      let document
      try { document = parseDocument(await readFile(file, 'utf8'), { uniqueKeys: true }) }
      catch (error) { if (error.code !== 'ENOENT') throw error; document = parseDocument('{}') }
      if (document.errors.length) throw new Error('服务配置 YAML 格式无效，未写入修改。')
      document.set('knowledgeServices', next.services.filter(profile => !profile.builtIn).map(({ builtIn, ...profile }) => profile))
      document.set('activeKnowledgeServiceId', next.activeServiceId)
      const nextFile = servicesSchema.parse(document.toJS({ maxAliasCount: 0 }))
      const temporary = `${file}.${randomUUID()}.tmp`
      try {
        await mkdir(dirname(file), { recursive: true })
        await writeFile(temporary, String(document), { flag: 'wx' })
        await rename(temporary, file)
      } finally { await rm(temporary, { force: true }) }
      fromFile = nextFile
      for (const listener of listeners) listener(getConfig())
      return getKnowledgeConfiguration()
    })
    pending = operation.catch(() => {})
    return operation
  }
  return Object.freeze({
    getConfig,
    getKnowledgeConfiguration,
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener) },
    saveKnowledgeService(input) {
      const profile = knowledgeServiceSchema.parse({ ...input, id: input.id || randomUUID() })
      return updateKnowledge(snapshot => {
        if (profile.id === 'default') throw new Error('默认服务地址由 services.yml 的 knowledgeBaseUrl 管理。')
        const services = snapshot.services.filter(item => item.id !== profile.id)
        return { ...snapshot, services: [...services, profile] }
      })
    },
    activateKnowledgeService({ serviceId }) {
      return updateKnowledge(snapshot => {
        if (!snapshot.services.some(profile => profile.id === serviceId)) throw new Error('知识服务不存在。')
        return { ...snapshot, activeServiceId: serviceId }
      })
    },
    deleteKnowledgeService({ serviceId }) {
      return updateKnowledge(snapshot => {
        if (serviceId === 'default') throw new Error('默认知识服务不能删除。')
        return { activeServiceId: snapshot.activeServiceId === serviceId ? 'default' : snapshot.activeServiceId, services: snapshot.services.filter(profile => profile.id !== serviceId) }
      })
    },
    getDiagnostics: () => ({ file, entries: Object.entries(getConfig()).map(([key, value]) => ({ key, value, configured: Boolean(value), source: ['knowledgeBaseUrl', 'knowledgeTargetType'].includes(key) && getKnowledgeConfiguration().activeServiceId !== 'default' ? 'profile' : Object.hasOwn(explicit.data, key) ? 'plugin' : Object.hasOwn(fromFile, key) ? 'file' : 'default' })) }),
  })
}
