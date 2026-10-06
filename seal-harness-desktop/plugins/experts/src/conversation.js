export const conversationServices = ['sessions', 'uiWorkspace', 'workspaces', 'conversation', 'remote', 'remote.agentPresets']

export const expertCreationTemplate = `请帮我创建一个专家，并保存到「专家 > 个人」。

专家名称：<填写名称，例如：产品研究专家>
专业职责：<这个专家主要解决什么问题>
工作方式：<希望它如何分析、执行和输出>
需要的技能：<填写已存在的技能名称；不需要就写“无”>
需要的连接器：<填写已存在的连接器名称；不需要就写“无”>
其他要求：<可选，例如回答风格、边界、注意事项>

请根据以上要求完善专家设定；若关键信息缺失，先向我提问。需要绑定技能或连接器时，先查询可用能力，不要虚构。完成后使用应用提供的创建专家工具保存；只有保存成功，才告诉我“专家已创建完成”并给出专家名称。`

export async function createExpertDraftConversation(ctx, workspaceId) {
  if (!workspaceId) {
    const workspaces = ctx.workspaces.list.getSnapshot().items
    const sessions = ctx.sessions.list.getSnapshot().byId
    const current = Object.values(sessions).find(session => (session.retainedBy.mainView ?? 0) > 0)?.id
    workspaceId = workspaces.find(item => item.sessionIds.includes(current))?.workspaceId ?? workspaces[0]?.workspaceId
  }
  if (!workspaceId) throw new Error('请先选择或创建对话工作区。')
  const sessionId = await ctx.sessions.create({ workspaceId })
  const reference = ctx.sessions.retain(sessionId, { source: 'sealHarnessExpertCreation' })
  try {
    const binding = await reference.ready
    ctx.conversation.input.for(binding.ctx).setDraft(expertCreationTemplate)
    ctx.uiWorkspace.openSession(sessionId)
  } finally { reference.release() }
}

export async function createExpertConversation(ctx, presetId, prompt, workspaceId) {
  if (!workspaceId) throw new Error('请先选择对话工作区。')
  const sessionId = await ctx.sessions.create({ workspaceId })
  const result = await ctx.remote.agentPresets.select(sessionId, presetId)
  if (!result.ok) throw new Error(result.error.message)
  const reference = ctx.sessions.retain(sessionId, { source: 'sealHarnessExpert' })
  try {
    const binding = await reference.ready
    if (prompt) ctx.conversation.input.for(binding.ctx).setDraft(prompt)
    ctx.uiWorkspace.openSession(sessionId)
  } finally { reference.release() }
}
