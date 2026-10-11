function turnResult(reason) {
  if (reason.kind === 'completed') return { status: 'completed', error: '' }
  if (reason.kind === 'aborted') return { status: 'cancelled', error: '会话已停止。' }
  return { status: 'failed', error: reason.error?.message ?? ({ blocked: '执行被权限策略阻止，请打开会话查看。', 'max-tokens': '执行达到输出限制。' }[reason.kind] ?? `会话结束：${reason.kind}`) }
}

export function createSessionRunner(ctx, timeoutMs = 30 * 60000) {
  return async (task, run, signal, onCreated) => {
    let unsubscribe, timer, abort, requestedStop
    let created = false
    let settle
    const completion = new Promise(resolve => { settle = resolve })
    const stop = async status => {
      requestedStop ??= { status, error: status === 'timeout' ? '执行超过 30 分钟，已请求停止。' : '执行已取消。' }
      if (created) {
        try { await ctx.sessionController.cancel({ sessionId: run.sessionId }) }
        catch (error) { ctx.logger?.warn('停止定时任务会话失败：%s', String(error)) }
      }
      settle(requestedStop)
    }
    try {
      signal.throwIfAborted()
      await ctx.sessionController.create({ sessionId: run.sessionId, workspaceId: task.workspaceId })
      created = true
      onCreated()
      signal.throwIfAborted()
      await ctx.sessionController.rename({ sessionId: run.sessionId, title: `定时任务 · ${task.name}` })
      signal.throwIfAborted()
      unsubscribe = ctx.on('session/event', (session, event) => {
        if (session.id === run.sessionId && event.type === 'turn/end') settle(requestedStop ?? turnResult(event.data.reason))
      })
      abort = () => { void stop('cancelled') }
      signal.addEventListener('abort', abort, { once: true })
      timer = setTimeout(() => { void stop('timeout') }, timeoutMs)
      timer.unref?.()
      await ctx.sessionController.prompt({
        sessionId: run.sessionId, requestId: `scheduled-${run.id}`, mode: 'queue',
        content: [{ type: 'text', text: task.prompt }],
        ...(task.schedule.timeZone ? { clientTimeZone: task.schedule.timeZone } : {}),
      }, signal)
      const result = await completion
      const resolved = await ctx.sessionController.resolveAgent(run.sessionId)
      if (resolved.error) throw new Error(resolved.error.message)
      await resolved.agent.whenIdle()
      return result
    } catch (error) {
      if (signal.aborted) { await stop('cancelled'); return { status: 'cancelled', error: '执行已取消。' } }
      return { status: 'failed', error: error instanceof Error ? error.message : String(error) }
    } finally {
      clearTimeout(timer)
      unsubscribe?.()
      if (abort) signal.removeEventListener('abort', abort)
    }
  }
}
