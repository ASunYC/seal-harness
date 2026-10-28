import { agent, methods, ndJsonStream, PROTOCOL_VERSION } from '@agentclientprotocol/sdk'
import { Readable, Writable } from 'node:stream'

const mode = process.argv[2] ?? 'normal'
if (mode === 'exit') process.exit(2)
if (mode === 'garbage') { process.stdout.write('not ACP\n'); setTimeout(() => process.exit(0), 50) }
else {
  let waiting
  const app = agent({ name: 'seal-acp-fixture' })
    .onRequest(methods.agent.initialize, () => ({ protocolVersion: PROTOCOL_VERSION, agentCapabilities: {}, agentInfo: { name: 'Fixture ACP', version: '1' } }))
    .onRequest(methods.agent.session.new, () => ({ sessionId: 'fixture-session' }))
    .onRequest(methods.agent.session.prompt, async ({ params, client }) => {
      const text = params.prompt.map(item => item.type === 'text' ? item.text : '').join('')
      const notify = output => client.notify(methods.client.session.update, { sessionId: params.sessionId, update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: output } } })
      if (text === 'wait') {
        await notify('partial')
        return new Promise(resolve => { waiting = resolve })
      }
      if (text === 'permission') {
        const choice = await client.request(methods.client.session.requestPermission, { sessionId: params.sessionId, toolCall: { toolCallId: 'test-tool', title: 'Test', kind: 'edit' }, options: [{ optionId: 'once', name: 'Once', kind: 'allow_once' }, { optionId: 'forever', name: 'Forever', kind: 'allow_always' }] })
        await notify(choice.outcome.outcome === 'selected' ? choice.outcome.optionId : 'rejected')
      } else if (text === 'environment') await notify(JSON.stringify({ ambient: Boolean(process.env.ACP_AMBIENT_SECRET), explicit: process.env.ACP_EXPLICIT_KEY === 'fixture-key' }))
      else if (text === 'large') await notify('x'.repeat(70000))
      else await notify(`ACP:${text}`)
      return { stopReason: 'end_turn' }
    })
    .onNotification(methods.agent.session.cancel, () => { waiting?.({ stopReason: 'cancelled' }); waiting = null })
  const connection = app.connect(ndJsonStream(Writable.toWeb(process.stdout), Readable.toWeb(process.stdin)))
  connection.closed.then(() => process.exit(0))
}
