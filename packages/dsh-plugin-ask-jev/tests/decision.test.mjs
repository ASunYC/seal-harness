import test from 'node:test'
import assert from 'node:assert/strict'
import { callDecisionModel, decisionRequest, providerEndpoint, presentDecision } from '../src/decision.js'
import { createDecisionService } from '../src/service.js'

const credentials = () => {
  let record
  return {
    async readRecord() { return record },
    async modifyRecord(_key, update) { record = await update(record); return record },
    inspect() { return record },
  }
}

test('Jev uses the official System One endpoint and noul request without exposing its Key', async () => {
  const saved = credentials(), calls = []
  const service = createDecisionService({ credentials: saved, fetchImpl: async (url, options) => {
    calls.push({ url, options })
    return Response.json({ model: 'jev-1.13.0', answers: { decision: { type: 'noul', noul: .82 } } })
  } })
  assert.equal((await service.status()).configured.jev, false)
  const status = await service.configure({ provider: 'jev', apiKey: 'jev-secret' })
  assert.equal(status.configured.jev, true)
  assert.equal(JSON.stringify(status).includes('jev-secret'), false)
  const answer = await service.decide({ question: '要不要现在开始？', mode: 'yes_no', context: '时间充足' })
  assert.equal(answer.summary, '倾向行动')
  assert.equal(answer.yesProbability, .82)
  assert.equal(answer.model, 'jev-1.13.0')
  assert.equal(calls[0].url, 'https://api.typesafe.ai/v1/systemone')
  assert.equal(calls[0].options.headers.authorization, 'Bearer jev-secret')
  assert.deepEqual(JSON.parse(calls[0].options.body), {
    model: 'jev-latest', state: { question: '要不要现在开始？', context: '时间充足' },
    questions: { decision: { type: 'noul', instructions: '结合问题和背景，判断现在是否值得行动。',
      criteria: { true: '收益和条件足以支持行动', false: '风险、代价或信息不足，应该暂缓' } } },
  })
  assert.equal(calls[0].options.redirect, 'error')
})

test('Alibaba uses the workspace region endpoint and decision-model-preview', async () => {
  const saved = credentials(), calls = []
  const service = createDecisionService({ credentials: saved, fetchImpl: async (url, options) => {
    calls.push({ url, options })
    return Response.json({ model: 'decision-model-preview', request_id: 'request-1',
      answers: { decision: { type: 'choice', choice: '先试点', confidence: .79,
        probabilities: { '先试点': .84, '直接上线': .16 } } } })
  } })
  await service.configure({ provider: 'alibaba', region: 'ap-southeast-1', workspaceId: 'llm-123', apiKey: 'ali-secret' })
  const answer = await service.decide({ question: '怎么推进？', mode: 'choice', options: ['先试点', '直接上线'] })
  assert.equal(answer.choice, '先试点')
  assert.equal(answer.confidence, .79)
  assert.equal(answer.requestId, 'request-1')
  assert.equal(calls[0].url, 'https://llm-123.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1/systemone')
  assert.equal(JSON.parse(calls[0].options.body).model, 'decision-model-preview')
  assert.equal(calls[0].options.headers.authorization, 'Bearer ali-secret')
  await assert.rejects(service.configure({ provider: 'alibaba', workspaceId: 'evil.example.com' }), error => error.code === 'invalidWorkspace')
  assert.equal(providerEndpoint('alibaba', { region: 'cn-beijing', workspaceId: 'llm-123' }),
    'https://llm-123.cn-beijing.maas.aliyuncs.com/compatible-mode/v1/systemone')
})

test('score is a structured model result and malformed or failed calls stay errors', async () => {
  const request = decisionRequest({ question: '是否值得投入？', mode: 'score' }, 'jev-latest')
  const answer = presentDecision({ model: 'jev-1', answers: { decision: { type: 'score', score: 2.4, confidence: .72 } } }, request, 'jev')
  assert.equal(answer.score, 2.4)
  assert.equal(answer.max, 4)
  assert.equal(answer.confidence, .72)
  assert.equal('reasoning' in answer, false)
  await assert.rejects(callDecisionModel({ provider: 'jev', settings: {}, key: 'key', input: { question: '问', mode: 'yes_no' },
    fetchImpl: async () => new Response('bad key', { status: 401 }) }), error => error.code === 'remoteError')
  await assert.rejects(callDecisionModel({ provider: 'jev', settings: {}, key: 'key', input: { question: '问', mode: 'yes_no' },
    fetchImpl: async () => Response.json({ model: 'jev', answers: {} }) }), error => error.code === 'invalidResponse')
  await assert.rejects(callDecisionModel({ provider: 'jev', settings: {}, key: '', input: { question: '问', mode: 'yes_no' } }), error => error.code === 'notConfigured')
})

test('Seal accounts remain isolated in Host credentials and no account cannot use keys', async () => {
  const saved = credentials()
  let current = 'alice'
  const service = createDecisionService({ credentials: saved, identity: () => ({ getSession: () => current ? { accountId: current } : null }) })
  await service.configure({ provider: 'jev', apiKey: 'alice-secret' })
  current = 'bob'
  assert.equal((await service.status()).configured.jev, false)
  await service.configure({ provider: 'alibaba', apiKey: 'bob-secret', region: 'cn-beijing', workspaceId: 'llm-bob' })
  assert.equal((await service.status()).configured.alibaba, true)
  current = 'alice'
  assert.equal((await service.status()).configured.alibaba, false)
  assert.equal((await service.status()).configured.jev, true)
  const restarted = createDecisionService({ credentials: saved, identity: () => ({ getSession: () => ({ accountId: current }) }) })
  assert.equal((await restarted.status()).configured.jev, true, 'Host restart restores the saved provider configuration')
  current = null
  await assert.rejects(service.status(), error => error.code === 'notSignedIn')
  assert.equal(JSON.stringify(saved.inspect()).includes('alice-secret'), true)
})
