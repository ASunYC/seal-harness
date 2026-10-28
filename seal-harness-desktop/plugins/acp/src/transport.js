import { Readable, Writable, Transform } from 'node:stream'
import { client, ndJsonStream, methods, PROTOCOL_VERSION } from '@agentclientprotocol/sdk'
import { AcpError, abortable, discover, usableDirectory } from './config.js'

const safeFailure = (phase, cause) => new AcpError('protocolFailed', `ACP ${phase}失败，请检查 Runner 的安装、ACP 模式和登录状态。`, { cause })

export class AcpProcess {
  constructor({ subprocess, config, env, signal, onText = () => {}, onPermission = () => {} }) {
    Object.assign(this, { subprocess, config, env, signal, onText, onPermission })
    this.sessionId = null
    this.closing = null
  }
  async open() {
    this.signal.throwIfAborted()
    const cwd = await abortable(usableDirectory(this.config.cwd), this.signal)
    const found = await discover(this.subprocess, this.config.command, this.signal, this.env)
    if (!found.supported) throw new AcpError('programUnavailable', found.message)
    this.signal.throwIfAborted()
    this.child = this.subprocess.spawn({
      argv: [found.executable, ...this.config.args], cwd, env: this.env,
      stdio: { stdin: 'pipe', stdout: 'pipe', stderr: { maxBytes: 4096 } }, graceMs: 1000,
    })
    this.exitFailure = this.child.done.then(
      () => { throw new AcpError('processExited', 'ACP Runner 已退出。') },
      cause => { throw safeFailure('进程启动', cause) },
    )
    this.exitFailure.catch(() => {})
    // 限制单个协议帧，避免异常 Runner 无限输出一行导致内存膨胀。
    let lineBytes = 0
    this.bounded = new Transform({ transform(chunk, _encoding, done) {
      for (const byte of chunk) { lineBytes = byte === 10 ? 0 : lineBytes + 1; if (lineBytes > 2 * 1024 * 1024) return done(new Error('ACP frame too large')) }
      done(null, chunk)
    } })
    this.onReadError = error => this.bounded.destroy(error)
    this.child.stdout.on('error', this.onReadError)
    this.child.stdout.pipe(this.bounded)
    const app = client({ name: 'seal-harness-acp' })
      .onNotification(methods.client.session.update, ({ params }) => {
        if (params.sessionId === this.sessionId && params.update.sessionUpdate === 'agent_message_chunk' && params.update.content?.type === 'text') this.onText(params.update.content.text)
      })
      .onRequest(methods.client.session.requestPermission, ({ params }) => {
        const once = !this.signal.aborted && this.config.permission === 'allow-once' && params.sessionId === this.sessionId
          ? params.options.find(option => option.kind === 'allow_once') : null
        this.onPermission(once ? 'allowed-once' : 'rejected')
        return { outcome: once ? { outcome: 'selected', optionId: once.optionId } : { outcome: 'cancelled' } }
      })
    this.connection = app.connect(ndJsonStream(Writable.toWeb(this.child.stdin), Readable.toWeb(this.bounded)))
    this.agent = this.connection.agent
    try {
      const initialized = await this.request(methods.agent.initialize, { protocolVersion: PROTOCOL_VERSION, clientCapabilities: {}, clientInfo: { name: 'Seal Harness', version: '0.1.0' } })
      if (initialized.protocolVersion !== PROTOCOL_VERSION) throw new Error('Unsupported ACP protocol')
      const created = await this.request(methods.agent.session.new, { cwd, mcpServers: [] })
      if (typeof created.sessionId !== 'string' || !created.sessionId || created.sessionId.length > 512) throw new Error('Invalid ACP session')
      this.sessionId = created.sessionId
      return { agentName: initialized.agentInfo?.name?.slice(0, 120) ?? 'ACP Runner', protocolVersion: initialized.protocolVersion }
    } catch (cause) { if (cause instanceof AcpError) throw cause; throw safeFailure('握手', cause) }
  }
  async request(method, params) {
    this.signal.throwIfAborted()
    let onAbort
    const aborted = new Promise((_, reject) => { onAbort = () => reject(this.signal.reason ?? new Error('aborted')); this.signal.addEventListener('abort', onAbort, { once: true }) })
    try { return await Promise.race([this.agent.request(method, params), this.exitFailure, aborted]) }
    finally { this.signal.removeEventListener('abort', onAbort) }
  }
  async prompt(text) {
    try { return await this.request(methods.agent.session.prompt, { sessionId: this.sessionId, prompt: [{ type: 'text', text }] }) }
    catch (cause) { if (this.signal.aborted || cause instanceof AcpError) throw cause; throw safeFailure('任务执行', cause) }
  }
  async cancel() {
    if (this.agent && this.sessionId) {
      let timer
      try { await Promise.race([this.agent.notify(methods.agent.session.cancel, { sessionId: this.sessionId }).catch(() => {}), new Promise(resolve => { timer = setTimeout(resolve, 200) })]) }
      finally { clearTimeout(timer) }
    }
  }
  close() { return this.closing ??= this.#close() }
  async #close() {
    if (!this.child) return
    this.connection?.close()
    this.child.stdin?.end()
    const stopped = await this.child.waitForExit(AbortSignal.timeout(300)).catch(() => false)
    if (!stopped) {
      this.child.terminate()
      if (!(await this.child.waitForExit(AbortSignal.timeout(3000)))) throw new AcpError('cleanupFailed', 'ACP 进程尚未确认停止，请检查 Host 日志。')
    }
    this.bounded?.destroy()
    if (this.onReadError) this.child.stdout?.removeListener('error', this.onReadError)
  }
}
