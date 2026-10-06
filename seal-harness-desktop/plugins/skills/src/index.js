import { mountCapability } from '../../capability-shared/src/host.js'
import { createModule } from './module.js'
import { registerSkillCreationTool } from './create-tool.js'

export { Config } from '../../capability-shared/src/host.js'
export const name = 'seal-harness-skills'
export const inject = ['connection', 'tools', 'sealHarnessIdentity', 'sealHarnessServices', 'sealHarnessDatabase', 'skills']

export async function apply(ctx) {
  await mountCapability(ctx, 'skills', createModule)
  const skills = ctx.get('sealHarnessSkills')
  ctx.effect(() => registerSkillCreationTool(ctx, skills), 'seal-harness-skills: creation tool')
}
