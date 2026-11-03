import type { PatchOptions } from '@deepseek-ai/cordis-plugin-include'

interface ExistingProductProfile {
  readonly layers: readonly { readonly packageName?: string }[]
  readonly patches: readonly PatchOptions[]
}

/** 产品默认插件让位于用户已声明或停用的同名包；不重写用户 Profile。 */
export function selectProductBundleDefaults(
  patches: readonly PatchOptions[],
  profile: ExistingProductProfile,
  disabledBundles: ReadonlySet<string>,
): PatchOptions[] {
  const existing = new Set([
    ...disabledBundles,
    ...profile.layers.map(layer => layer.packageName),
    ...profile.patches.flatMap(patch => (patch.insert ?? []).map(entry => entry.name)),
  ])
  return patches.map(patch => patch.insert === undefined ? patch : {
    ...patch,
    insert: patch.insert.filter(entry => entry.name === undefined || !existing.has(entry.name)),
  })
}
