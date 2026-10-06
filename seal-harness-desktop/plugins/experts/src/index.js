import { mountCapability } from '../../capability-shared/src/host.js'
import { createModule } from './module.js'
import { registerExpertCreationTools } from './create-tool.js'

export { Config } from '../../capability-shared/src/host.js'
export const name = 'seal-harness-experts'
export const inject = ['connection', 'tools', 'sealHarnessIdentity', 'sealHarnessServices', 'sealHarnessDatabase']

export async function apply(ctx) {
  await mountCapability(ctx, 'experts', createModule)
  const experts = ctx.get('sealHarnessExperts')
  ctx.effect(() => registerExpertCreationTools(ctx, experts), 'seal-harness-experts: creation tools')
}
