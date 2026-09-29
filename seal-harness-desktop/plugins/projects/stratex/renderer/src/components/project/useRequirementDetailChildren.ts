import { computed, onScopeDispose, ref, watch } from 'vue';
import type { Todo } from '@shared/protocol/project-collab.js';
import { useProjectCollabStore } from '../../stores/projectCollab';
import { requirementDetailChildren } from './requirement-detail';

/** Only the opened parent's direct page is loaded; aggregate counts stay on the parent. */
export function useRequirementDetailChildren(projectId: () => string, todo: () => Todo) {
  const store = useProjectCollabStore();
  const context = computed(
    () =>
      `${store.accountEpoch}:${store.projectEpoch}:${store.activeProjectId}:${projectId()}:${todo().id}`,
  );
  const readyContext = ref<string | null>(null);
  const pending = ref(false);
  let request = 0;
  const active = computed(() => store.activeProjectId === projectId());
  const state = computed(() =>
    active.value ? store.requirementSubtreeStates[todo().id] : undefined,
  );
  const loading = computed(
    () =>
      pending.value ||
      (active.value && store.requirementPageActive && (state.value?.loading ?? true)),
  );
  const error = computed(() =>
    readyContext.value === context.value ? (state.value?.error?.message ?? null) : null,
  );
  const hasMore = computed(
    () => readyContext.value === context.value && (state.value?.hasMore ?? false),
  );
  const children = computed(() => {
    if (!store.requirementPageActive)
      return requirementDetailChildren([...store.todosById.values()], todo().id);
    if (!active.value || readyContext.value !== context.value) return [];
    return requirementDetailChildren(
      (store.requirementSubtrees[todo().id] ?? []).filter(
        (child) => child.projectId === projectId(),
      ),
      todo().id,
    );
  });
  async function load(more = false): Promise<void> {
    if (!active.value || !store.requirementPageActive) return;
    const ticket = ++request;
    const scope = context.value;
    pending.value = true;
    try {
      if (more) await store.loadMoreRequirementSubtree(projectId(), todo().id);
      else await store.loadRequirementSubtree(projectId(), todo().id);
    } finally {
      if (ticket === request && scope === context.value) {
        readyContext.value = scope;
        pending.value = false;
      }
    }
  }
  watch(
    [context, () => store.requirementPageActive],
    () => {
      request += 1;
      readyContext.value = null;
      pending.value = false;
      void load();
    },
    { immediate: true },
  );
  onScopeDispose(() => {
    request += 1;
  });
  return { children, loading, error, hasMore, load };
}
