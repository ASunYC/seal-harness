import type { Context, Plugin } from '@deepseek-ai/cordis'
import type { Config } from '@deepseek-ai/dsh-session-persistence-jsonl'
import type {} from '@deepseek-ai/dsh-session-persistence'

type JsonlConstructor = new (ctx: Context, config: Config) => unknown
type JsonlApply = (ctx: Context, config: Config) => unknown
type JsonlPlugin = JsonlConstructor | (Plugin.Base & { apply: JsonlApply })

/** 两通道分别使用旧版默认类入口与 rc.2 模块入口，保留相同迁移验证。 */
export async function loadJsonlSessionPersistence(): Promise<JsonlPlugin> {
  const namespace: Plugin.Base & { readonly default?: JsonlConstructor; readonly apply?: JsonlApply }
    = await import('@deepseek-ai/dsh-session-persistence-jsonl')
  if (namespace.default !== undefined) return namespace.default
  if (namespace.apply !== undefined) return { ...namespace, apply: namespace.apply }
  throw new Error('dsh-plugin-desktop: JSONL persistence plugin entry is unavailable')
}
