import { scopeOf } from '@deepseek-ai/dsh-scope'
import { installModelSelection } from '@deepseek-ai/dsh-agent'
import * as sseClient from '../../connectors/src/sse.js'
import * as mcpClient from '@deepseek-ai/dsh-mcp-client'
import { z } from 'zod'

export const name = 'seal-harness-expert-runtime'
export const inject = ['systemPrompt', 'tools']
const skillSchema = z.object({ name: z.string(), description: z.string(), content: z.string(), source: z.string(), path: z.string().optional(), resourceBase: z.object({ kind: z.literal('directory'), path: z.string() }).optional(), invocation: z.object({ modelInvocable: z.boolean(), userInvocable: z.boolean() }) })

/** 人设、模型和能力只安装到专家的原生 Agent preset 作用域。 */
export function apply(ctx, input) {
  if (!scopeOf(ctx)) throw new Error('专家运行时必须加载在 Agent preset 作用域中。')
  const config = z.object({ persona: z.string().min(1), model: z.string().min(1), provider: z.string().min(1), accountId: z.string().min(1).optional(), reasoningEffort: z.enum(['minimal', 'low', 'medium', 'high']).optional(), personality: z.enum(['none', 'friendly', 'pragmatic']).optional(), skills: z.array(skillSchema).default([]), toolNames: z.array(z.string()).default([]), knowledgeGroupIds: z.array(z.string()).default([]), mcpServers: z.array(z.object({ serverName: z.string(), transport: z.enum(['stdio', 'streamable-http', 'sse']), command: z.string().optional(), args: z.array(z.string()).optional(), cwd: z.string().optional(), env: z.record(z.string(), z.string()).optional(), url: z.string().optional(), headers: z.record(z.string(), z.string()).optional() })).default([]), toolPolicy: z.object({ webSearch: z.string().optional(), allowedTools: z.object({ requestUserInput: z.boolean().optional() }).optional(), mcpServers: z.record(z.string(), z.object({ command: z.string(), args: z.array(z.string()).optional(), env: z.record(z.string(), z.string()).optional() })).optional() }).optional() }).parse(input)
  if (config.accountId) ctx.on('agent/request', async (_payload, next) => {
    const identity = ctx.get('sealHarnessIdentity')
    const before = await identity?.getSession()
    if (before?.accountId !== config.accountId) throw new Error('专家所属账号已退出或变化，请重新登录后启用专家。')
    const result = await next()
    const after = await identity?.getSession()
    if (after?.accountId !== before.accountId || after?.epoch !== before.epoch) throw new Error('专家所属账号已变化，请重试。')
    return result
  })
  const personality = config.personality === 'friendly' ? '\n交流时友善、耐心，清楚说明下一步。' : config.personality === 'pragmatic' ? '\n以任务结果为先，表达简洁，给出可执行步骤。' : ''
  ctx.effect(() => ctx.systemPrompt.variable('seal_harness_expert_persona', () => config.persona + personality))
  ctx.effect(() => ctx.systemPrompt.section({ name: 'deployment:persona-prefix', order: ctx.systemPrompt.getSectionOrder('DEPLOYMENT_PERSONA_PREFIX'), text: '{{seal_harness_expert_persona}}' }))
  ctx.effect(() => ctx.systemPrompt.section({ name: 'deployment:persona-suffix', order: ctx.systemPrompt.getSectionOrder('DEPLOYMENT_PERSONA_SUFFIX'), text: '' }))
  for (const skill of config.skills) {
    const registry = ctx.get('skills')
    if (!registry) throw new Error('技能服务未加载。')
    ctx.effect(() => registry.register({ ...skill, provider: 'seal-harness-expert' }))
  }
  if (config.skills.length) {
    ctx.effect(() => ctx.systemPrompt.variable('seal_harness_expert_skills', () => config.skills.map(skill => `## ${skill.name}\n${skill.content}\n资源目录：${skill.resourceBase?.path ?? ''}`).join('\n\n')))
    ctx.effect(() => ctx.systemPrompt.section({ name: 'seal-harness-expert-skills', order: 85, text: '{{seal_harness_expert_skills}}' }))
  }
  if (config.knowledgeGroupIds.length) {
    ctx.effect(() => ctx.systemPrompt.variable('seal_harness_expert_knowledge', () => `已绑定知识组：${config.knowledgeGroupIds.join('、')}。回答相关问题时使用 knowledge_search 检索这些 groupIds，再用 knowledge_navigate 阅读证据，并引用来源。`))
    ctx.effect(() => ctx.systemPrompt.section({ name: 'seal-harness-expert-knowledge', order: 86, text: '{{seal_harness_expert_knowledge}}' }))
  }
  const toolGuidance = [
    ...(config.toolNames.length ? [`优先使用专家绑定的连接器工具：${config.toolNames.join('、')}。`] : []),
    ...(config.toolPolicy?.webSearch && config.toolPolicy.webSearch !== 'disabled' ? ['需要网上资料时使用 DSH 的 web_search 工具，并引用来源。'] : []),
    ...(config.toolPolicy?.allowedTools?.requestUserInput ? ['需要用户补充信息时使用 DSH 的 ask_user_question 工具。'] : []),
  ].join('\n')
  if (toolGuidance) ctx.effect(() => ctx.systemPrompt.section({ name: 'seal-harness-expert-tools', order: 87, text: toolGuidance }))
  for (const server of config.mcpServers) ctx.plugin(server.transport === 'sse' ? sseClient : mcpClient, { ...server, failOnStartupError: true })
  for (const [serverName, server] of Object.entries(config.toolPolicy?.mcpServers ?? {})) {
    ctx.plugin(mcpClient, { serverName: `expert-${serverName}`, transport: 'stdio', ...server, failOnStartupError: true })
  }
  ctx.effect(() => installModelSelection(ctx, { current: { provider: config.provider, model: config.model, ...(config.reasoningEffort ? { reasoningEffort: config.reasoningEffort } : {}) }, assembled: undefined }))
}
