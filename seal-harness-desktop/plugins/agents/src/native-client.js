export async function openNativeSession(ctx, sessionId, signal) {
  const previous = ctx.sessions.binding(sessionId)
  // Host removal ends this Client generation; retaining it again cannot reopen it.
  if (previous?.session.getSnapshot().removed) await previous.ctx.fiber.dispose()
  const reference = ctx.sessions.retain(sessionId, { source: 'sealHarnessAgents', signal })
  try {
    await reference.ready
    ctx.uiWorkspace.openSession(sessionId)
  } finally { reference.release() }
}
