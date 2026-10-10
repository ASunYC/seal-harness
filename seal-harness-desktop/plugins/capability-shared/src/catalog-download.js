import { createHash } from 'node:crypto'
import { setTimeout as delay } from 'node:timers/promises'
import { safeRelative, MAX_PACKAGE_BYTES, SkillError } from '../../skills/src/package.js'
import { skillBundles, catalogSkill, catalogSource } from './catalog.js'

export async function boundedDownload(url, signal, maxBytes = 16 * 1024 * 1024, request = fetch) {
  for (let attempt = 0; attempt < 3; attempt++) {
    try { return await readDownload(url, signal, maxBytes, request) }
    catch (error) {
      signal?.throwIfAborted()
      if (error instanceof SkillError && !error.retryable) throw error
      if (attempt === 2) throw new SkillError('技能源网络连接失败，请稍后重试。')
      await delay(250 * (2 ** attempt), undefined, { signal })
    }
  }
}

async function readDownload(url, signal, maxBytes, request) {
  const response = await request(url, { signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(60000)]) : AbortSignal.timeout(60000) })
  if (!response.ok) {
    await response.body?.cancel().catch(() => {})
    throw Object.assign(new SkillError(`技能源暂时不可用（HTTP ${response.status}），请稍后重试。`), { retryable: response.status === 429 || response.status >= 500 })
  }
  if (!response.body) return Buffer.alloc(0)
  const chunks = [], reader = response.body.getReader()
  let size = 0
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      size += value.length
      if (size > maxBytes) throw new SkillError('技能文件超过大小限制。')
      chunks.push(value)
    }
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock() }
  return Buffer.concat(chunks)
}
const digest = bytes => createHash('sha256').update(bytes).digest('hex')
const escapePath = path => safeRelative(path).split('/').map(encodeURIComponent).join('/')

export async function downloadBundle(id, signal, request = fetch) {
  const recipe = skillBundles.find(recipe => recipe.id === id)
  if (!recipe) throw new SkillError('系统技能包不存在。')
  return downloadPinnedFiles(recipe, signal, request)
}

export async function downloadPinnedFiles(recipe, signal, request = fetch) {
  const files = new Array(recipe.files.length), controller = new AbortController()
  const lifetime = signal ? AbortSignal.any([signal, controller.signal]) : controller.signal
  let total = 0, cursor = 0, failure
  const worker = async () => {
    for (;;) {
      lifetime.throwIfAborted()
      const index = cursor++
      if (index >= recipe.files.length) return
      const file = recipe.files[index], target = safeRelative(file.target)
      const url = `https://raw.githubusercontent.com/${recipe.repository}/${recipe.commit}/${escapePath(file.source)}`
      const bytes = await boundedDownload(url, lifetime, 16 * 1024 * 1024, request)
      if (`sha256-${digest(bytes)}` !== file.integrity) throw new SkillError('技能包文件校验失败，未安装任何内容。')
      total += bytes.length
      if (total > MAX_PACKAGE_BYTES) throw new SkillError('技能包超过大小限制。')
      files[index] = { path: target, bytes, mode: target.endsWith('.sh') || target.endsWith('.py') ? 0o755 : 0o644 }
    }
  }
  const workers = Array.from({ length: Math.min(4, recipe.files.length) }, () => worker().catch(error => { failure ??= error; controller.abort(error); throw error }))
  await Promise.allSettled(workers)
  if (failure) throw failure
  return { files, origin: { kind: 'system', catalogId: `bundle:${recipe.id}`, version: recipe.version, repository: recipe.repository, commit: recipe.commit, license: recipe.license, catalogSource } }
}

export async function downloadMarketSkill(id, signal, request = fetch) {
  const item = catalogSkill(id)
  if (item.source === 'bundle') return downloadBundle(item.id.slice(7), signal, request)
  const base = item.source === 'clawhub' ? 'https://clawhub.ai' : 'https://api.skillhub.cn'
  const root = `${base}/api/v1/skills/${encodeURIComponent(item.slug)}`
  const owner = item.owner ? `owner=${encodeURIComponent(item.owner)}` : ''
  const json = async url => JSON.parse((await boundedDownload(url, signal, 2 * 1024 * 1024, request)).toString('utf8'))
  const detail = await json(`${root}${owner ? `?${owner}` : ''}`)
  if (detail.skill?.slug && detail.skill.slug !== item.slug) throw new SkillError('技能源返回了不同的技能，安装已停止。')
  if (item.source === 'clawhub' && item.owner && detail.owner?.handle && detail.owner.handle !== item.owner) throw new SkillError('技能作者已变化，安装已停止。')
  const version = detail.latestVersion?.version ?? detail.skill?.latestVersion?.version ?? detail.skill?.version
  if (!version) throw new SkillError('技能源未返回有效版本，无法安装。')
  const manifest = item.source === 'clawhub'
    ? (await json(`${root}/versions/${encodeURIComponent(version)}${owner ? `?${owner}` : ''}`)).version
    : await json(`${root}/files`)
  const list = manifest?.files
  if (!Array.isArray(list) || !list.length || list.length > 2000) throw new SkillError('技能源未返回完整文件清单。')
  const files = []
  let total = 0
  for (const file of list) {
    const path = safeRelative(file.path)
    const url = `${root}/file?path=${encodeURIComponent(path)}&version=${encodeURIComponent(version)}${owner ? `&${owner}` : ''}`
    const bytes = await boundedDownload(url, signal, Math.min(16 * 1024 * 1024, MAX_PACKAGE_BYTES - total), request)
    if (file.sha256 && digest(bytes) !== file.sha256) throw new SkillError('在线技能文件已变化，完整性检查失败，请重试。')
    total += bytes.length
    files.push({ path, bytes, mode: path.endsWith('.sh') || path.endsWith('.py') ? 0o755 : 0o644 })
  }
  const license = manifest?.license ?? detail.latestVersion?.license ?? item.license ?? '未提供'
  if (!files.some(file => file.path.toLowerCase() === 'seal-source.md')) {
    const bytes = Buffer.from(`来源：${root}${owner ? `?${owner}` : ''}\n作者：${item.owner ?? '未提供'}\n版本：${version}\n许可：${license}\n目录来源：${catalogSource.repository}@${catalogSource.commit}\n`)
    if (files.length >= 2000 || total + bytes.length > MAX_PACKAGE_BYTES) throw new SkillError('技能包及来源文件超过大小限制。')
    files.push({ path: 'SEAL-SOURCE.md', bytes, mode: 0o644 })
  }
  return { files, origin: { kind: 'market', catalogId: id, version, owner: item.owner, repository: base, license, catalogSource } }
}
