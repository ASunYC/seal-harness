import { mountCapability } from '../../capability-shared/src/host.js'
import { createModule } from './module.js'

export { Config } from '../../capability-shared/src/host.js'
export const name = 'seal-harness-connectors'
export const inject = ['connection', 'sealHarnessIdentity', 'sealHarnessServices', 'tools', 'credentials', 'agents']

export async function apply(ctx) {
  return mountCapability(ctx, 'connectors', createModule)
}
