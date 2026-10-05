export const PROVIDERS = Object.freeze({
  jev: Object.freeze({ label: 'TypeSafe Jev', model: 'jev-latest' }),
  alibaba: Object.freeze({ label: '阿里百炼决策模型', model: 'decision-model-preview' }),
})

export const REGIONS = Object.freeze({
  'cn-beijing': '华北2（北京）',
  'ap-southeast-1': '新加坡',
})

const scoreCriteria = Object.freeze([
  '很不值得：代价显著高于收益',
  '暂不建议：还有关键顾虑未解决',
  '可以观察：收益与代价接近',
  '值得尝试：收益明显高于代价',
  '非常值得：建议尽快行动',
])

export class DecisionError extends Error {
  constructor(code, message) { super(message); this.code = code }
}

function requiredText(value, label, max) {
  if (typeof value !== 'string' || !value.trim() || value.length > max) throw new DecisionError('invalidInput', `${label}不能为空或过长。`)
  return value.trim()
}

export function validateWorkspaceId(value) {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9-]{0,62}$/.test(value))
    throw new DecisionError('invalidWorkspace', '业务空间 ID 格式无效。请填写百炼控制台显示的 WorkspaceId。')
  return value
}

export function providerEndpoint(provider, settings) {
  if (provider === 'jev') return 'https://api.typesafe.ai/v1/systemone'
  if (provider === 'alibaba') {
    if (!Object.hasOwn(REGIONS, settings.region)) throw new DecisionError('invalidRegion', '请选择百炼支持的地域。')
    return `https://${validateWorkspaceId(settings.workspaceId)}.${settings.region}.maas.aliyuncs.com/compatible-mode/v1/systemone`
  }
  throw new DecisionError('invalidProvider', '请选择 Jev 或阿里百炼决策模型。')
}

export function decisionRequest(input, model) {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) throw new DecisionError('invalidInput', '决策请求格式无效。')
  const question = requiredText(input.question, '问题', 2000)
  const context = input.context === undefined || input.context === '' ? '' : requiredText(input.context, '背景', 4000)
  const state = { question, ...(context ? { context } : {}) }
  let decision
  if (input.mode === 'yes_no') {
    decision = { type: 'noul', instructions: '结合问题和背景，判断现在是否值得行动。',
      criteria: { true: '收益和条件足以支持行动', false: '风险、代价或信息不足，应该暂缓' } }
  } else if (input.mode === 'choice') {
    const options = input.options
    if (!Array.isArray(options) || options.length < 2 || options.length > 12)
      throw new DecisionError('invalidOptions', '选择模式需要 2 至 12 个候选项。')
    const clean = options.map(value => requiredText(value, '候选项', 80))
    if (new Set(clean).size !== clean.length) throw new DecisionError('invalidOptions', '候选项不能重复。')
    decision = { type: 'choice', instructions: '结合问题和背景，选择最合适的一项。',
      criteria: Object.fromEntries(clean.map(value => [value, `考虑选择“${value}”的效用、成本与风险`])) }
  } else if (input.mode === 'score') {
    decision = { type: 'score', instructions: '结合问题和背景，对当前行动价值进行从低到高的评分。',
      criteria: [...scoreCriteria] }
  } else throw new DecisionError('invalidMode', '请选择是非、选择或评分模式。')
  return { model, state, questions: { decision } }
}

function boundedProbability(value, label) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1)
    throw new DecisionError('invalidResponse', `模型返回的${label}无效。`)
  return value
}

export function presentDecision(raw, request, provider) {
  const answer = raw?.answers?.decision
  const type = request.questions.decision.type
  if (!answer || answer.type !== type || typeof raw.model !== 'string')
    throw new DecisionError('invalidResponse', '模型返回的数据不符合决策协议。')
  const base = { provider, model: raw.model, requestId: typeof raw.request_id === 'string' ? raw.request_id : null }
  if (type === 'noul') {
    const yesProbability = boundedProbability(answer.noul, '是非概率')
    return { ...base, mode: 'yes_no', summary: yesProbability >= .5 ? '倾向行动' : '倾向暂缓', yesProbability }
  }
  if (type === 'choice') {
    const choices = Object.keys(request.questions.decision.criteria)
    if (!choices.includes(answer.choice)) throw new DecisionError('invalidResponse', '模型选择的候选项不在请求中。')
    const probabilities = Object.fromEntries(choices.map(choice => [choice, boundedProbability(answer.probabilities?.[choice], '候选概率')]))
    return { ...base, mode: 'choice', summary: `首选：${answer.choice}`, choice: answer.choice,
      confidence: boundedProbability(answer.confidence, '置信度'), probabilities }
  }
  const score = answer.score
  const max = request.questions.decision.criteria.length - 1
  if (typeof score !== 'number' || !Number.isFinite(score) || score < 0 || score > max)
    throw new DecisionError('invalidResponse', '模型返回的评分无效。')
  return { ...base, mode: 'score', summary: `行动价值 ${score.toFixed(2)} / ${max}`, score, max,
    confidence: boundedProbability(answer.confidence, '置信度'), criteria: [...scoreCriteria] }
}

async function readBoundedJson(response) {
  const chunks = []
  let total = 0
  if (!response.body) throw new DecisionError('invalidResponse', '模型没有返回数据。')
  for await (const chunk of response.body) {
    total += chunk.byteLength
    if (total > 1024 * 1024) throw new DecisionError('invalidResponse', '模型返回的数据过大。')
    chunks.push(Buffer.from(chunk))
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')) }
  catch { throw new DecisionError('invalidResponse', '模型返回的 JSON 无效。') }
}

export async function callDecisionModel({ provider, settings, input, key, fetchImpl = fetch, signal }) {
  const request = decisionRequest(input, PROVIDERS[provider]?.model)
  const endpoint = providerEndpoint(provider, settings)
  if (typeof key !== 'string' || !key.trim()) throw new DecisionError('notConfigured', '请先配置所选模型的 API Key。')
  const cancellation = signal ? AbortSignal.any([signal, AbortSignal.timeout(30000)]) : AbortSignal.timeout(30000)
  let response
  try {
    response = await fetchImpl(endpoint, { method: 'POST', redirect: 'error', cache: 'no-store', signal: cancellation,
      headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` }, body: JSON.stringify(request) })
  } catch (error) {
    if (cancellation.aborted) throw new DecisionError('cancelled', '请求已取消或超时。')
    throw new DecisionError('unreachable', '无法连接决策模型服务，请检查网络与地域设置。')
  }
  if (!response.ok) {
    await response.body?.cancel().catch(() => {})
    throw new DecisionError('remoteError', `决策模型服务返回 HTTP ${response.status}。请检查 API Key、业务空间和地域。`)
  }
  return presentDecision(await readBoundedJson(response), request, provider)
}
