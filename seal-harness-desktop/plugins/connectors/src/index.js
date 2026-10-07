import { mountCapability } from '../../capability-shared/src/host.js'
import { createModule } from './module.js'
import { registerConnectorCreationTool } from './create-tool.js'

export { Config } from '../../capability-shared/src/host.js'
export const name = 'seal-harness-connectors'
export const inject = ['connection', 'sealHarnessIdentity', 'sealHarnessServices', 'tools', 'credentials', 'agents']

export async function apply(ctx) {
  await mountCapability(ctx, 'connectors', createModule)
  const connectors = ctx.get('sealHarnessConnectors')
  ctx.effect(() => registerConnectorCreationTool(ctx, connectors), 'seal-harness-connectors: creation tool')
}
