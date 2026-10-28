const MAX_RESPONSE_BYTES = 8 * 1024 * 1024

export class WeknoraManagementError extends Error {
  constructor(code, message, status) { super(message); this.code = code; this.status = status }
}

async function jsonResponse(response) {
  if (Number(response.headers.get('content-length')) > MAX_RESPONSE_BYTES) {
    await response.body?.cancel()
    throw new WeknoraManagementError('responseTooLarge', 'WeKnora 返回内容过大，请缩小查询范围。')
  }
  const reader = response.body?.getReader()
  if (!reader) throw new WeknoraManagementError('invalidResponse', 'WeKnora 返回了空响应。')
  let bytes = 0
  const chunks = []
  try {
    while (true) {
      const part = await reader.read()
      if (part.done) break
      bytes += part.value.byteLength
      if (bytes > MAX_RESPONSE_BYTES) throw new WeknoraManagementError('responseTooLarge', 'WeKnora 返回内容过大，请缩小查询范围。')
      chunks.push(part.value)
    }
  } finally { await reader.cancel().catch(() => undefined) }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')) }
  catch { throw new WeknoraManagementError('invalidResponse', 'WeKnora 返回格式无效，请检查服务版本和 API 地址。') }
}

/** 仅供 Host 插件调用；凭据始终留在本服务，禁止重定向到另一个服务。 */
export async function managementRequest(config, path, options, lifetime) {
  const base = new URL(config.baseUrl)
  const url = new URL(`${config.baseUrl}${path}`)
  if (!path.startsWith('/') || path.startsWith('//') || url.origin !== base.origin || !url.pathname.startsWith(`${base.pathname}/`))
    throw new WeknoraManagementError('invalidPath', '知识库请求路径无效。')
  const headers = { Accept: 'application/json', 'X-API-Key': config.apiKey }
  if (config.tenantId !== undefined) headers['X-Tenant-ID'] = String(config.tenantId)
  if (options.body !== undefined) headers['Content-Type'] = 'application/json'
  let response
  try {
    response = await fetch(url, {
      method: options.method ?? 'GET', headers, redirect: 'error',
      ...(options.formData ? { body: options.formData } : options.body !== undefined ? { body: JSON.stringify(options.body) } : {}),
      signal: AbortSignal.any([lifetime, options.signal, AbortSignal.timeout(config.requestTimeoutMs)].filter(Boolean)),
    })
  } catch (error) {
    if (lifetime.aborted || options.signal?.aborted) throw new WeknoraManagementError('cancelled', '知识库请求已取消。')
    throw new WeknoraManagementError('connectionFailed', error.name === 'TimeoutError' ? 'WeKnora 请求超时，请稍后重试。' : '无法连接 WeKnora，请检查 API 地址和服务状态。')
  }
  if (!response.ok) {
    await response.body?.cancel()
    const message = response.status === 401 ? 'WeKnora 凭据无效或已过期，请在设置中更新 API Key。'
      : response.status === 403 ? 'WeKnora 拒绝访问。检索需要 retrieve，导入/删除文档需要 ingest，创建/编辑/删除知识库需要 manage_kbs；请由管理员检查 Key 权限与知识库范围。'
        : response.status === 404 ? 'WeKnora 中的资源不存在或当前版本不支持此操作。'
          : `WeKnora 操作未完成（HTTP ${response.status}），请检查向量模型、存储配置及服务日志。`
    throw new WeknoraManagementError('serviceError', message, response.status)
  }
  if (response.status === 204) return { success: true }
  let value
  try { value = await jsonResponse(response) }
  catch (error) {
    if (lifetime.aborted || options.signal?.aborted) throw new WeknoraManagementError('cancelled', '知识库请求已取消。')
    if (error.name === 'TimeoutError' || error.name === 'AbortError') throw new WeknoraManagementError('connectionFailed', 'WeKnora 响应读取超时，请稍后重试。')
    throw error
  }
  if (value?.success === false) throw new WeknoraManagementError('serviceError', 'WeKnora 未完成操作，请检查服务端配置及日志。')
  return value
}
