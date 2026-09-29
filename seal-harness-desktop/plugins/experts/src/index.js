import { mountCapability } from '../../capability-shared/src/host.js'
import { createModule } from './module.js'

export { Config } from '../../capability-shared/src/host.js'
export const name = 'seal-harness-experts'
export const inject = ['connection', 'sealHarnessIdentity', 'sealHarnessServices']

export async function apply(ctx) {
  return mountCapability(ctx, 'experts', createModule)
}
