import { z } from 'zod'
import { lastAssistantStreamChunk } from '@deepseek-ai/dsh-llm/assistant-stream'
import { deriveTurnTokenUsage } from '@deepseek-ai/dsh-token-meter/client'

export const projectionKey = 'sealHarnessTokenStatsTurn'

const count = z.number().int().nonnegative().safe()
const usageSchema = z.object({
  uncachedInputTokens: count, outputTokens: count, totalTokens: count,
  cacheReadTokens: count.optional(), cacheWriteTokens: count.optional(), reasoningTokens: count.optional(),
  routes: z.array(z.object({ provider: z.string(), model: z.string() })).optional(),
})

// 仅投影用量计算所需字段；不把提示词、回复正文或工具结果复制进统计状态。
export function usageEvent(event) {
  if (!['turn/start', 'turn/end', 'step/start', 'step/end', 'llm/retry', 'llm/retry-started', 'assistant/message', 'assistant/attempt'].includes(event.type)) return null
  const { turn, step } = event.data
  if (['turn/start', 'turn/end'].includes(event.type)) return { type: event.type, data: { turn } }
  if (['step/start', 'step/end', 'llm/retry', 'llm/retry-started'].includes(event.type))
    return { type: event.type, data: { turn, step } }
  if (!['assistant/message', 'assistant/attempt'].includes(event.type)) return null
  const raw = event.data.usage ?? lastAssistantStreamChunk(event.data.stream, 'usage')?.usage
  const sample = raw ? Object.fromEntries(['inputTokens', 'outputTokens', 'totalTokens', 'cacheReadTokens', 'cacheWriteTokens', 'reasoningTokens'].filter(key => raw[key] !== undefined).map(key => [key, raw[key]])) : null
  const stream = sample ? [{ type: 'chunk', chunk: { type: 'usage', usage: sample } }] : []
  return { type: event.type, data: {
    turn, step, stream,
    ...(event.type === 'assistant/message' ? { message: { source: {
      provider: event.data.message.source.provider, model: event.data.message.source.model,
    } }, ...(sample ? { usage: sample } : {}) } : {}),
  } }
}

export const usageProjection = {
  key: projectionKey,
  stateVersion: 1,
  stateSchema: z.object({ turn: count.nullable(), events: z.array(z.object({ type: z.string(), data: z.record(z.string(), z.unknown()) })), usage: usageSchema.nullable() }),
  init: () => ({ turn: null, events: [], usage: null }),
  apply(state, event) {
    if (event.type === 'turn/start') return { turn: event.data.turn, events: [usageEvent(event)], usage: null }
    const value = usageEvent(event)
    if (!value || state.turn === null || value.data.turn !== state.turn) return state
    const events = [...state.events, value]
    return event.type === 'turn/end'
      ? { turn: state.turn, events: [], usage: deriveTurnTokenUsage(events) ?? null }
      : { turn: state.turn, events, usage: null }
  },
}
