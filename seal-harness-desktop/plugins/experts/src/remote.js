import { createHash } from 'node:crypto'
import { z } from 'zod'
import { ExpertError, MANIFEST, MAX_BYTES, decodeZip, portablePackage, validatePackage } from './package.js'

const identifier = z.string().trim().min(1).max(256)
const versionWire = z.object({ id: identifier, assetId: identifier, version: identifier, status: z.enum(['draft', 'published', 'yanked']), packageReady: z.boolean().optional(), etag: z.string().optional() }).passthrough()
const assetWire = z.object({ id: identifier, visibility: z.enum(['private', 'company', 'public']).optional(), versions: z.array(versionWire), cloud: z.object({ publicVersion: z.string().nullable().optional() }).passthrough().optional() }).passthrough()
const assetPath = id => `experts/${encodeURIComponent(identifier.parse(id))}`
const digestOf = bytes => createHash('sha256').update(bytes).digest('hex')
const etag = response => response.headers?.get?.('etag') ?? response.data?.etag ?? response.meta?.etag

/** 保持 Stratex 发送面字段，中文投影只用于远端 descriptor。 */
export function descriptor(pkg) {
  const manifest = pkg.manifest
  const toolPolicy = {}
  if (manifest.toolPolicy?.webSearch !== undefined) toolPolicy.webSearch = manifest.toolPolicy.webSearch !== 'disabled'
  if (manifest.toolPolicy?.allowedTools !== undefined) toolPolicy.allowedTools = manifest.toolPolicy.allowedTools.requestUserInput === true ? ['requestUserInput'] : []
  if (manifest.skills?.length) toolPolicy.skills = manifest.skills
  return {
    entryAgent: manifest.entryAgent, agents: pkg.agents.map(agent => ({ name: agent.name, path: agent.path })),
    displayName: manifest.displayName, profession: manifest.profession, description: manifest.description,
    personaInstructions: manifest.personaInstructions, model: manifest.model,
    ...(manifest.personality ? { personality: manifest.personality } : {}),
    ...(manifest.initPrompt ? { initPrompt: manifest.initPrompt.zh } : {}),
    ...(manifest.tags?.length ? { tags: manifest.tags.map(tag => tag.zh) } : {}),
    ...(manifest.quickPrompts?.length ? { quickPrompts: manifest.quickPrompts.map(prompt => prompt.zh) } : {}),
    ...(Object.keys(toolPolicy).length ? { toolPolicy } : {}),
  }
}

/** @param {object} backend @param {{id:string, version:string}} input @param {AbortSignal} [signal] */
export async function downloadExpert(backend, input, signal) {
  const account = await backend.account()
  const response = await backend.request(assetPath(input.id), { signal })
  const asset = assetWire.parse(response.data)
  if (asset.id !== input.id) throw new ExpertError('云端专家标识不匹配。')
  const version = asset.versions.find(item => item.version === input.version || item.id === input.version)
  if (!version || version.assetId !== asset.id || version.status !== 'published' || version.packageReady !== true) throw new ExpertError('请选择可安装的已发布专家版本。')
  await backend.assertAccount(account)
  const downloaded = await backend.download(`${assetPath(asset.id)}/versions/${encodeURIComponent(version.id)}/export-bundle`, { signal, maxBytes: 128 * 1024 * 1024 })
  await backend.assertAccount(account)
  const digest = digestOf(downloaded.bytes)
  if (downloaded.headers.get('x-agent-bundle-sha256') !== digest || downloaded.headers.get('x-agent-release-id') !== version.id || downloaded.headers.get('etag') !== `"sha256-${digest}"`) throw new ExpertError('云端专家包完整性校验失败。')
  const files = decodeZip(downloaded.bytes)
  const bundleBytes = files.get('config/agent-assets-bundle.json')
  if (!bundleBytes || bundleBytes.length > 8 * 1024 * 1024) throw new ExpertError('云端专家包缺少有效发布清单。')
  const bundle = z.object({ schemaVersion: z.literal(1), app: z.literal('agent-earth-platform'), kind: z.literal('agent-asset-bundle'), clientRelease: z.object({ kind: z.literal('asset'), assetId: identifier, assetVersionId: identifier, portableDependencies: z.array(z.unknown()).default([]) }), versions: z.record(z.string(), z.array(z.object({ id: identifier }))) }).parse(JSON.parse(bundleBytes.toString('utf8')))
  if (bundle.clientRelease.assetId !== asset.id || bundle.clientRelease.assetVersionId !== version.id || Object.keys(bundle.versions).length !== 1 || bundle.versions[asset.id]?.length !== 1 || bundle.versions[asset.id][0].id !== version.id) throw new ExpertError('云端专家包版本闭包不匹配。')
  const pkg = validatePackage(files)
  if (pkg.manifest.version !== version.version) throw new ExpertError('云端专家清单版本不匹配。')
  return { pkg, account, origin: { accountId: account.accountId, assetId: asset.id, releaseId: version.id, dependencyCount: bundle.clientRelease.portableDependencies.length } }
}

/** 私有发布流程独立于可见性，分步保存 assetId 以支持失败后重试。 */
export async function uploadExpert(backend, pkg, { assetId, creationKey, saveAsset }, signal) {
  const account = await backend.account()
  const portable = portablePackage(pkg), manifest = portable.manifest
  const files = [...portable.files].filter(([path]) => path !== MANIFEST).map(([path, bytes]) => ({ path, contentBase64: bytes.toString('base64'), sha256: digestOf(bytes) }))
  if (files.length > 1998) throw new ExpertError('专家上传最多包含 1998 个内容文件。')
  const body = { version: manifest.version, descriptor: descriptor(portable), dependencies: [], package: { manifest, files } }
  if (Buffer.byteLength(JSON.stringify(body)) > 144 * 1024 * 1024 || [...portable.files.values()].reduce((sum, bytes) => sum + bytes.length, 0) > MAX_BYTES) throw new ExpertError('专家上传超过体积上限。')
  if (!assetId) {
    await backend.assertAccount(account)
    const created = await backend.request('experts', { method: 'POST', body: { name: manifest.displayName.zh, slug: manifest.name, summary: manifest.description.zh, kind: 'personal_expert', category: manifest.categoryId === 'development' ? 'development' : 'office', publisherTeam: '', tags: (manifest.tags ?? []).map(tag => tag.zh).slice(0, 30) }, headers: { 'x-expert-creation-key': creationKey }, signal })
    assetId = identifier.parse(created.data?.id)
    await backend.assertAccount(account)
    if (created.data.visibility !== 'private') throw new ExpertError('新建专家未返回私有状态，已停止发布。')
    await saveAsset(account, assetId)
  }
  await backend.assertAccount(account)
  const created = await backend.request(`${assetPath(assetId)}/versions`, { method: 'POST', body, headers: { 'x-expert-upload-key': `version:${manifest.version}` }, signal })
  const version = versionWire.parse(created.data)
  if (version.assetId !== assetId || version.version !== manifest.version || version.packageReady !== true || version.status === 'yanked') throw new ExpertError('云端专家版本创建结果不匹配。')
  const versionEtag = etag(created)
  if (!versionEtag) throw new ExpertError('云端专家版本缺少 ETag，已停止发布。')
  if (version.status === 'draft') {
    await backend.assertAccount(account)
    await backend.request(`${assetPath(assetId)}/versions/${encodeURIComponent(manifest.version)}/publish`, { method: 'POST', body: {}, headers: { 'if-match': versionEtag, 'x-expert-expected-status': 'draft' }, signal })
  }
  await backend.assertAccount(account)
  const detail = assetWire.parse((await backend.request(assetPath(assetId), { signal })).data)
  const readBack = detail.versions.find(item => item.version === manifest.version)
  if (detail.id !== assetId || readBack?.status !== 'published' || readBack?.packageReady !== true || readBack?.etag !== versionEtag) throw new ExpertError('发布后的专家版本读回不匹配，请刷新云端目录。')
  return { assetId, version: manifest.version, visibility: detail.visibility ?? null, stripped: portable.stripped }
}

/** @param {object} backend @param {object} input @param {AbortSignal} [signal] */
export async function changeVisibility(backend, input, signal) {
  const { assetId, scope, version, expectedPublicVersion, expectedEtag } = z.strictObject({ assetId: identifier, scope: z.enum(['private', 'company', 'public']), version: identifier.optional(), expectedPublicVersion: identifier.nullable().optional(), expectedEtag: z.string().min(1) }).parse(input)
  if (scope === 'public' && (!version || expectedPublicVersion === undefined)) throw new ExpertError('公开专家需要选定版本和当前公开版本。')
  const account = await backend.account()
  const read = await backend.request(assetPath(assetId), { signal })
  if (etag(read) !== expectedEtag) throw new ExpertError('专家已被修改，请刷新后重试。')
  await backend.assertAccount(account)
  await backend.request(`${assetPath(assetId)}/visibility`, { method: 'POST', body: { scope, ...(version ? { version } : {}), ...(expectedPublicVersion !== undefined ? { expectedPublicVersion } : {}) }, headers: { 'if-match': expectedEtag }, signal })
  await backend.assertAccount(account)
  const updated = (await backend.request(assetPath(assetId), { signal })).data
  if (updated.id !== assetId || updated.visibility !== scope || (scope === 'public' && updated.cloud?.publicVersion !== version)) throw new ExpertError('专家可见性读回不匹配，请刷新后重试。')
  return { assetId, scope }
}
