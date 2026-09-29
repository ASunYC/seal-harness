import { projectRuntime } from '../../../../src/ui/runtime'

export function useReturnToConversation(): () => Promise<void> {
  const runtime = projectRuntime()
  return () => runtime.returnToConversation()
}
