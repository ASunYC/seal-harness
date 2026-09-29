import { createHash } from 'node:crypto'
import { z } from 'zod'
import { adapterSchema, execute } from '../../connectors/src/http-adapter.js'
import { createArchive, readArchive } from '../../skills/src/package.js'
import { BackendError } from '../../capability-shared/src/backend.js'
import { readVersion } from './version.js'

const filename = 'stratex-http-adapter.json'
const selection = z.object({ id: z.string().uuid(), version: z.string().min(1).max(64) })
export function adapterHandlers(backend) {
  return {
    async adapter(input, signal) {
      const request = selection.parse(input)
      const { current } = await readVersion(backend, { ...request, collection: 'mcps' }, signal)
      if (!current.artifact) return { adapter: null, etag: current.etag }
      const { bytes } = await backend.download(`mcps/${request.id}/versions/${encodeURIComponent(request.version)}/export`, { signal, maxBytes: 64 * 1024 * 1024 })
      if (createHash('sha256').update(bytes).digest('hex') !== current.artifact.sha256) throw new BackendError('invalidResponse')
      const file = readArchive(bytes).find(file => file.path === filename)
      return { adapter: file ? adapterSchema.parse(JSON.parse(file.bytes.toString('utf8'))) : null, etag: current.etag }
    },
    async saveAdapter(input, signal) {
      const request = selection.extend({ etag: z.string().min(1), adapter: adapterSchema }).parse(input)
      const path = `mcps/${request.id}/versions/${encodeURIComponent(request.version)}`
      const { asset, current } = await readVersion(backend, { ...request, collection: 'mcps' }, signal)
      if (current.status !== 'draft' || current.etag !== request.etag) throw new BackendError('conflict')
      const bytes = Buffer.from(JSON.stringify(request.adapter, null, 2) + '\n')
      const files = [{ path: filename, sizeBytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') }]
      const slots = new Set(request.adapter.tools.flatMap(tool => [tool.request.auth.credentialSlot, tool.request.auth.usernameCredentialSlot, tool.request.auth.passwordCredentialSlot].filter(Boolean)))
      const descriptor = { ...current.descriptor, runtime: undefined, transport: 'http', authMode: 'none', entrypoint: undefined, endpointTemplate: undefined, commandTemplate: undefined, executable: undefined, args: [], environmentSlots: [], headerSlots: [], staticHeaders: [], environmentVariables: [], workingDirectoryStrategy: 'artifact_root', healthCheck: undefined, oauthPkce: undefined, oauthDiscovery: undefined, tokenExchange: undefined, files, credentialSlots: [...slots].map(name => ({ name, required: true })), permissions: [{ name: 'network.client', required: true }], compatibility: { ...current.descriptor.compatibility, runtimes: [], transports: ['http'] }, detectionHints: [], tools: request.adapter.tools.map(tool => ({ name: tool.name, description: tool.description })), declaredRisk: request.adapter.tools.some(tool => tool.riskLevel === 'dangerous') ? 'high' : 'low' }
      const manifest = { schemaVersion: 'stratex.capability/v1', assetType: 'mcp', assetId: asset.id, name: asset.name, slug: asset.slug, version: request.version, kind: asset.kind === 'service' ? 'service' : 'tool', category: asset.category, summary: asset.summary, publisherTeam: asset.publisherTeam ?? '', tags: asset.tags ?? [], dependencies: current.dependencies ?? [], files }
      const archive = createArchive([{ path: filename, bytes, mode: 0o644 }, { path: 'manifest.json', bytes: Buffer.from(JSON.stringify(manifest) + '\n'), mode: 0o644 }, { path: 'descriptor.json', bytes: Buffer.from(JSON.stringify(descriptor) + '\n'), mode: 0o644 }])
      await backend.request(path, { method: 'PATCH', signal, headers: { 'if-match': request.etag }, body: { descriptor, dependencies: current.dependencies ?? [] } })
      await backend.upload(`${path}/artifact`, archive, { signal })
      return { saved: true }
    },
    async testAdapter(input, signal) {
      const request = z.object({ adapter: adapterSchema, toolName: z.string(), arguments: z.record(z.string(), z.unknown()), credentials: z.record(z.string(), z.string()).default({}) }).parse(input)
      const tool = request.adapter.tools.find(tool => tool.name === request.toolName)
      if (!tool) throw new BackendError('invalidRequest')
      z.fromJSONSchema(tool.inputSchema).parse(request.arguments)
      const started = Date.now()
      const result = await execute(tool, request.arguments, request.credentials, signal)
      return { durationMs: Date.now() - started, content: result.content }
    },
  }
}
