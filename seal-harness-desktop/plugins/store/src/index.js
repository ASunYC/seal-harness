import { mountCapability } from '../../capability-shared/src/host.js'
import { createStore } from './module.js'

export { Config } from '../../capability-shared/src/host.js'
export const name = 'seal-harness-store'
export const inject = ['connection', 'sealHarnessIdentity', 'sealHarnessServices']

export async function apply(ctx) {
  return mountCapability(ctx, 'store', (_ctx, { backend }) => ({ handlers: createStore(backend) }))
}
