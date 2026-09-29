import AgentRegistry from '@deepseek-ai/dsh-agent'

/** 保留公开创建句柄，让实例管理也能释放由原生历史恢复的同一实例。 */
export default class ManagedAgentRegistry extends AgentRegistry {
  instanceHandles = new Map()
  pendingInstances = new Map()
  closingInstances = new Map()

  constructor(ctx) {
    super(ctx)
    ctx.on('agent/disposed', ({ agent }) => {
      if (this.instanceHandles.get(agent.id)?.agent === agent) this.instanceHandles.delete(agent.id)
    })
  }

  create(options) {
    return this.trackInstance(options.sessionId, options, input => super.create(input))
  }

  resume(options) {
    return this.trackInstance(options.resumeSessionId, options, input => super.resume(input))
  }

  trackInstance(id, options, start) {
    const closing = this.closingInstances.get(id)
    if (closing) return closing.then(() => this.trackInstance(id, options, start))
    const controller = new AbortController()
    const pending = this.pendingInstances.get(id) ?? new Set()
    const operation = { controller, promise: undefined }
    this.pendingInstances.set(id, pending)
    pending.add(operation)
    operation.promise = Promise.resolve().then(() => start({
      ...options,
      signal: options.signal ? AbortSignal.any([options.signal, controller.signal]) : controller.signal,
    })).then(handle => {
      // owner 卸载可能先于此 continuation；旧代句柄不能重新进入缓存。
      if (this.get(id) === handle.agent) this.instanceHandles.set(id, handle)
      return handle
    }).finally(() => {
      pending.delete(operation)
      if (!pending.size) this.pendingInstances.delete(id)
    })
    return operation.promise
  }

  releaseInstance(id) {
    const previous = this.closingInstances.get(id)
    if (previous) return previous
    const closing = Promise.resolve().then(async () => {
      const pending = [...(this.pendingInstances.get(id) ?? [])]
      for (const operation of pending) operation.controller.abort()
      await Promise.allSettled(pending.map(operation => operation.promise))
      const handle = this.instanceHandles.get(id)
      if (handle) await handle.dispose()
      else if (this.get(id)) throw new Error('此实例没有可用的关闭句柄。')
    }).finally(() => { this.closingInstances.delete(id) })
    this.closingInstances.set(id, closing)
    return closing
  }
}
