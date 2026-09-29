import { computed, onScopeDispose, ref, watch, type Ref, type ComputedRef } from 'vue';
import type { Todo } from '@shared/protocol/project-collab.js';
import type {
  ProjectWorkOverview,
  ProjectWorkOverviewGroup,
  ProjectWorkOverviewResult,
} from '@shared/protocol/project-work-overview.js';
import { projectCollabApi } from '../../sdk/projectCollab';
import type { ProjectWorkOverviewApi } from '../../sdk/projectWorkOverview';

export interface WorkOverviewContext {
  readonly projectId: string;
  readonly accountEpoch: number;
  readonly projectEpoch: number;
}
export interface WorkOverviewState {
  readonly group: Ref<ProjectWorkOverviewGroup>;
  readonly counts: ComputedRef<ProjectWorkOverview['counts'] | null>;
  readonly total: ComputedRef<number | null>;
  readonly items: Ref<Todo[]>;
  readonly nextCursor: Ref<string | null>;
  readonly loading: Ref<boolean>;
  readonly error: Ref<string | null>;
  readonly refresh: () => Promise<void>;
  readonly loadMore: () => Promise<void>;
}

function accessLost(result: Exclude<ProjectWorkOverviewResult, { ok: true }>): boolean {
  return (
    ['authRequired', 'credentialRejected', 'forbidden'].includes(result.code) ||
    ['project_not_found', 'todo_not_found'].includes(result.serverCode ?? '')
  );
}

/** 组件局部查询快照；换域清空、事件合并重读，绝不合成服务器总数。 */
export function useProjectWorkOverview(
  context: () => WorkOverviewContext,
  api: ProjectWorkOverviewApi,
): WorkOverviewState {
  const group = ref<ProjectWorkOverviewGroup>('incomplete');
  const summary = ref<Pick<ProjectWorkOverview, 'counts' | 'total'> | null>(null);
  const items = ref<Todo[]>([]);
  const nextCursor = ref<string | null>(null);
  const loading = ref(false);
  const error = ref<string | null>(null);
  let generation = 0;
  let queued = false;
  let seenCursors = new Set<string>();
  const clear = (): void => {
    summary.value = null;
    items.value = [];
    nextCursor.value = null;
    seenCursors = new Set();
  };
  const load = async (more = false): Promise<void> => {
    if (loading.value || (more && nextCursor.value === null) || !context().projectId) return;
    const epoch = generation;
    loading.value = true;
    error.value = null;
    try {
      const result = await api.read({
        projectId: context().projectId,
        group: group.value,
        limit: 20,
        ...(more ? { cursor: nextCursor.value } : {}),
      });
      if (epoch !== generation || queued) return;
      if (!result.ok) {
        if (accessLost(result) || result.serverCode === 'invalid_cursor') clear();
        error.value = result.message || '工作概览读取失败，请重试。';
        return;
      }
      if (
        result.items.some((item) => item.projectId !== context().projectId) ||
        (more && result.nextCursor !== null && seenCursors.has(result.nextCursor))
      ) {
        clear();
        error.value = '工作概览分页已失效，请刷新。';
        return;
      }
      if (!more) seenCursors = new Set();
      if (result.nextCursor !== null) seenCursors.add(result.nextCursor);
      summary.value = { counts: result.counts, total: result.total };
      items.value = more
        ? [...new Map([...items.value, ...result.items].map((item) => [item.id, item])).values()]
        : result.items;
      nextCursor.value = result.nextCursor;
    } catch {
      if (epoch === generation) error.value = '工作概览读取失败，请重试。';
    } finally {
      if (epoch === generation) {
        loading.value = false;
        if (queued) {
          queued = false;
          void load();
        }
      }
    }
  };
  const refresh = async (): Promise<void> => {
    if (loading.value) {
      queued = true;
      return;
    }
    await load();
  };
  watch(
    () => [context().projectId, context().accountEpoch, context().projectEpoch, group.value],
    () => {
      generation++;
      queued = false;
      loading.value = false;
      error.value = null;
      clear();
      void load();
    },
    { immediate: true, flush: 'sync' },
  );
  const unsubscribe = projectCollabApi.onEvent((event) => {
    if (event.kind === 'connection') {
      if (event.payload.state === 'online') void refresh();
      return;
    }
    if (event.projectId !== context().projectId) return;
    if (
      event.kind === 'todo.changed' ||
      event.kind === 'project.changed' ||
      event.kind === 'member.changed'
    ) {
      if (event.kind !== 'todo.changed') clear();
      void refresh();
    }
  });
  onScopeDispose(() => {
    generation++;
    queued = false;
    unsubscribe();
  });
  return {
    group,
    counts: computed(() => summary.value?.counts ?? null),
    total: computed(() => summary.value?.total ?? null),
    items,
    nextCursor,
    loading,
    error,
    refresh,
    loadMore: () => load(true),
  };
}
