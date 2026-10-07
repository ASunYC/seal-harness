/** Open a native DSH conversation for the decision entry. */
export async function openDecisionConversation(ctx, navigation, existingSessionId) {
  const sessions = ctx.sessions.list.getSnapshot().byId
  if (existingSessionId && sessions[existingSessionId]) {
    navigation.markDecisionSession(existingSessionId)
    ctx.uiWorkspace.openSession(existingSessionId)
    return existingSessionId
  }
  const workspaces = ctx.workspaces.list.getSnapshot().items
  const current = Object.values(sessions).find(session => (session.retainedBy?.mainView ?? 0) > 0)?.id
  const workspaceId = workspaces.find(item => item.sessionIds.includes(current))?.workspaceId ?? workspaces[0]?.workspaceId
  if (!workspaceId) throw new Error('请先选择或创建对话工作区。')
  const sessionId = await ctx.sessions.create({ workspaceId })
  navigation.markDecisionSession(sessionId)
  ctx.uiWorkspace.openSession(sessionId)
  return sessionId
}
