import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { runInNewContext } from 'node:vm'
import { fileURLToPath } from 'node:url'
import * as Cordis from '@deepseek-ai/cordis'
import { openNativeSession } from '../src/native-client.js'

const Store = {
  notifySubscribers(listeners) { for (const listener of listeners) listener() },
  createSnapshotStore(value) {
    const listeners = new Set()
    return { getSnapshot: () => value, subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener) }, set(next) { value = next; Store.notifySubscribers(listeners) } }
  },
}

async function browserPlugin(specifier, dependencies) {
  let plugin
  const window = { __ModuleLoader__: { load: ({ factory }) => { plugin = factory(name => { if (!(name in dependencies)) throw new Error(name); return dependencies[name] }) } } }
  runInNewContext(await readFile(fileURLToPath(import.meta.resolve(specifier)), 'utf8'), { window, console, AbortController, AbortSignal, setTimeout, clearTimeout, queueMicrotask, performance })
  return plugin
}

test('real DSH Client replaces a removed same-id generation before opening its resumed conversation', async t => {
  const gateway = await browserPlugin('@deepseek-ai/dsh-api-gateway/client', { '@deepseek-ai/cordis': Cordis })
  const controller = await browserPlugin('@deepseek-ai/dsh-api-session-controller/client', { '@deepseek-ai/cordis': Cordis, '@deepseek-ai/dsh-client-store': Store, '@deepseek-ai/dsh-api-gateway/client': gateway })
  const ctx = new Cordis.Context(), listeners = new Map()
  const connection = { generation: Store.createSnapshotStore(undefined) }
  let openings = 0, mainReference
  const records = [{ event: { type: 'user/message', seq: 0, time: 1, surfaceOp: 'append', data: { role: 'user', content: [{ type: 'text', text: '保留的历史消息' }], source: { kind: 'user' } } } }]
  const remote = {
    $on: (event, listener) => listeners.set(event, listener),
    $stream: options => new gateway.RemoteStream(connection, options),
    session: {
      async *follow(_request, signal) {
        openings++
        yield { type: 'snapshot', cursor: 0, records, hasMore: false, assistantStream: { revision: 0 } }
        await new Promise(resolve => { if (signal.aborted) resolve(); else signal.addEventListener('abort', resolve, { once: true }) })
      },
    },
  }
  ctx.provide('remote', remote)
  ctx.provide('connection', connection)
  ctx.provide('typert', { contexts: { registerClient() {} } })
  controller.apply(ctx)
  ctx.provide('uiWorkspace', { openSession(id) { const previous = mainReference; mainReference = ctx.sessions.retain(id, { source: 'mainView' }); previous?.release() } })
  t.after(async () => { mainReference?.release(); await ctx.fiber.dispose() })
  const id = 'native-fixture'
  const summary = { sessionId: id, cwd: '/workspace', running: false, blank: false, updatedAt: 0, agentAvailable: true }
  listeners.get('api-session/added')(summary)
  await openNativeSession(ctx, id)
  const original = mainReference.binding
  assert.equal(original.session.getSnapshot().removed, false)
  listeners.get('api-session/removed')(id)
  listeners.get('api-session/added')(summary)
  const stale = ctx.sessions.retain(id, { source: 'proof' })
  await stale.ready
  assert.equal(stale.binding, original)
  assert.equal(stale.binding.session.getSnapshot().removed, true)
  stale.release()
  await openNativeSession(ctx, id)
  assert.notEqual(mainReference.binding, original)
  assert.equal(mainReference.binding.session.getSnapshot().removed, false)
  assert.equal(mainReference.binding.session.getSnapshot().openState, 'open')
  assert.equal(mainReference.binding.eventSource.getSnapshot().entries[0].event.data.content[0].text, '保留的历史消息')
  assert.equal(openings, 2)
  assert.equal(ctx.sessions.retainInfo(id).getSnapshot().referenceCount, 1)
  const resumed = mainReference.binding
  await openNativeSession(ctx, id)
  assert.equal(mainReference.binding, resumed)
  assert.equal(openings, 2)
})
