import { Client, SSEClientTransport } from '@modelcontextprotocol/client'
import { createMcpToolDefinition } from '@deepseek-ai/dsh-mcp-client'

export const name = 'seal-harness-mcp-sse'
export const inject = ['tools']

export async function apply(ctx, config) {
  const client = new Client({ name: 'seal-harness', version: '0.1.0' })
  let releases = []
  ctx.effect(() => async () => { for (const release of releases) release(); await client.close() })
  await client.connect(new SSEClientTransport(new URL(config.url), { requestInit: { headers: config.headers }, eventSourceInit: { fetch: (url, options) => fetch(url, { ...options, headers: { ...options?.headers, ...config.headers } }) } }))
  const sync = async () => {
    const definitions = [], names = new Set()
    let cursor
    do {
      const page = await client.listTools(cursor ? { cursor } : {})
      for (const tool of page.tools) {
        const name = `mcp__${config.serverName}__${tool.name}`
        if (names.has(name)) throw new Error('MCP returned duplicate tool names')
        names.add(name)
        definitions.push(createMcpToolDefinition(ctx, { name, rawName: tool.name, description: tool.description ?? '', inputSchema: tool.inputSchema, outputSchema: tool.outputSchema, taskRequired: tool.execution?.taskSupport === 'required', call: (args, execution) => client.callTool({ name: tool.name, arguments: args }, { signal: execution.signal, timeout: config.toolCallTimeoutMs, toolDefinition: tool }) }))
      }
      cursor = page.nextCursor
    } while (cursor)
    for (const release of releases) release()
    releases = definitions.map(definition => ctx.tools.register(definition))
  }
  await sync()
  client.onclose = () => { for (const release of releases) release(); releases = [] }
}
