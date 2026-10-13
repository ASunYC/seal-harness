/**
 * Adapter between Desktop notifications and the core job registry's completion stream.
 *
 * Both 0.2.x channels use the filtered event stream:
 * `jobs.events.subscribe(filter, listener)` delivers `registered`, `progress`,
 * `stopping`, `settled`, `removed`, and `output` events carrying a `JobView`.
 * Desktop only needs terminal states, so the adapter narrows settled jobs to an outcome.
 */

import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-jobs'

/** Terminal state of one background job, narrowed to what Desktop notifies on. */
export type DesktopJobOutcome = 'completed' | 'failed' | 'other'

/** Narrow a core job status to the outcomes Desktop raises attention for. */
function desktopJobOutcome(status: string): DesktopJobOutcome {
  if (status === 'completed' || status === 'failed') return status
  return 'other'
}

/**
 * Observe the settlements of every job composed under this context's scope.
 * @param ctx - a context with the `jobs` service injected.
 * @param listener - receives each settled job's narrowed outcome.
 * @returns the disposer unregistering the observer.
 */
export function observeDesktopJobOutcomes(
  ctx: Context,
  listener: (outcome: DesktopJobOutcome) => void,
): () => void {
  return ctx.jobs.events.subscribe({ owners: 'scope' }, (event) => {
    if (event.type !== 'settled') return
    listener(desktopJobOutcome(event.job.status))
  })
}
