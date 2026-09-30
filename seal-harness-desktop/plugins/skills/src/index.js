import { mountCapability } from '../../capability-shared/src/host.js'
import { createModule } from './module.js'

export { Config } from '../../capability-shared/src/host.js'
export const name = 'seal-harness-skills'
export const inject = ['connection', 'sealHarnessIdentity', 'sealHarnessServices', 'sealHarnessDatabase', 'skills']

export async function apply(ctx) {
  return mountCapability(ctx, 'skills', createModule)
}
