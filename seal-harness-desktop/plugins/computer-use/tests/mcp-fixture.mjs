import { createInterface } from 'node:readline'

const lines = createInterface({ input: process.stdin })
lines.on('line', line => {
  const message = JSON.parse(line)
  if (!Object.hasOwn(message, 'id')) return
  if (process.argv.includes('--hang-initialize') && message.method === 'initialize') return
  const result = message.method === 'initialize' ? { protocolVersion: '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'cua-fixture', version: '0.38.0' } }
    : message.method === 'tools/list' ? { tools: [{ name: 'get_window_state', description: 'fixture', inputSchema: { type: 'object', properties: {} } }] }
      : message.method === 'tools/call' && message.params.name === 'wait' ? null
        : message.method === 'tools/call' ? { content: [{ type: 'text', text: JSON.stringify({ args: message.params.arguments, telemetry: process.env.CUA_DRIVER_RS_TELEMETRY_ENABLED, secret: process.env.OPENAI_API_KEY ?? null }) },
          { type: 'image', data: 'iVBORw0KGgo=', mimeType: 'image/png' }], structuredContent: { observed: true } }
          : undefined
  if (result === null) return
  process.stdout.write(JSON.stringify(result ? { jsonrpc: '2.0', id: message.id, result } : { jsonrpc: '2.0', id: message.id, error: { code: -32601, message: 'not found' } }) + '\n')
})
lines.on('close', () => process.exit(0))
