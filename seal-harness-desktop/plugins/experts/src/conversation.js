export const conversationServices = ['sessions', 'uiWorkspace', 'workspaces', 'conversation', 'remote', 'remote.agentPresets']

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
