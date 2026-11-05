const MAX_WAIT_MS = 30000

export class WordWorkerClient {
  #worker
  #url
  #pending
  #nextId = 0

  constructor(source = __SEAL_OFFICE_WORKER_SOURCE__) {
    this.#url = URL.createObjectURL(new Blob([source], { type: 'text/javascript' }))
    this.#worker = new Worker(this.#url, { type: 'module', name: 'seal-office-docx' })
    this.#worker.onmessage = event => this.#receive(event.data)
    this.#worker.onerror = () => this.#fail(new Error('Word 文档引擎未能启动。'))
    this.#worker.onmessageerror = () => this.#fail(new Error('Word 文档引擎返回了无效结果。'))
  }

  #receive(response) {
    const pending = this.#pending
    if (!pending || response?.id !== pending.id) return
    this.#pending = null
    clearTimeout(pending.timer)
    if (response.kind === 'error') pending.reject(new Error(response.message))
    else pending.resolve(response)
  }

  #fail(error) {
    const pending = this.#pending
    this.#pending = null
    if (pending) { clearTimeout(pending.timer); pending.reject(error) }
    this.dispose()
  }

  #request(request) {
    if (!this.#worker || this.#pending) return Promise.reject(new Error('Word 文档引擎不可用或正忙。'))
    const id = ++this.#nextId
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => this.#fail(new Error('Word 文档处理超时。')), MAX_WAIT_MS)
      this.#pending = { id, resolve, reject, timer }
      try { this.#worker.postMessage({ ...request, id }) }
      catch (error) { this.#fail(error) }
    })
  }

  async parse(bytes) {
    const result = await this.#request({ kind: 'parse', bytes })
    if (result.kind !== 'parsed') throw new Error('Word 文档解析结果无效。')
    return result.document
  }

  async serialize(blocks) {
    const result = await this.#request({ kind: 'serialize', blocks })
    if (result.kind !== 'serialized' || !(result.bytes instanceof Uint8Array))
      throw new Error('Word 文档生成结果无效。')
    return result.bytes
  }

  dispose() {
    const pending = this.#pending
    this.#pending = null
    if (pending) { clearTimeout(pending.timer); pending.reject(new Error('Word 编辑器已关闭。')) }
    this.#worker?.terminate()
    this.#worker = null
    if (this.#url) URL.revokeObjectURL(this.#url)
    this.#url = null
  }
}
