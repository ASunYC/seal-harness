import { computed, onScopeDispose, ref, watch } from 'vue';
import type { Ref } from 'vue';
import type { Todo, TodoItemKind } from '@shared/protocol/project-collab.js';
import { projectCollabApi } from '../../sdk/projectCollab';
import { useProjectCollabStore } from '../../stores/projectCollab';
import { hierarchyParentCandidates } from './todo-hierarchy';

/** Bounded parent lookup; the selected parent is independent of the visible search page. */
export function useTodoParentSearch(input: {
  projectId: () => string;
  itemKind: () => TodoItemKind;
  todoId: () => string | undefined;
  parentId: Ref<string>;
}) {
  const store = useProjectCollabStore();
  const keyword = ref('');
  const kind = ref<TodoItemKind>('requirement');
  const page = ref(1);
  const total = ref(0);
  const loading = ref(false);
  const error = ref<string | null>(null);
  const selectedError = ref<string | null>(null);
  const items = ref<readonly Todo[]>([]);
  const selected = ref<Todo | null>(null);
  let request = 0;
  let selectedRequest = 0;
  let revision: string | null = null;
  const context = computed(
    () =>
      `${store.accountEpoch}:${store.projectEpoch}:${store.activeProjectId}:${input.projectId()}`,
  );
  const active = computed(() => store.activeProjectId === input.projectId());
  const known = computed(() =>
    [...store.todosById.values()].filter(
      (todo) =>
        todo.projectId === input.projectId() ||
        (todo.projectId === undefined &&
          !store.requirementPageActive &&
          (active.value || store.activeProjectId === null)),
    ),
  );
  const candidates = computed(() => {
    if (!active.value && store.activeProjectId !== null) return [];
    const visible = active.value ? items.value : known.value;
    const all = new Map(
      [...known.value, ...items.value, ...(selected.value ? [selected.value] : [])].map((todo) => [
        todo.id,
        todo,
      ]),
    );
    const eligible = new Set(
      hierarchyParentCandidates([...all.values()], input.itemKind(), input.todoId()).map(
        (todo) => todo.id,
      ),
    );
    return [
      ...new Map(
        [...(selected.value ? [selected.value] : []), ...visible]
          .filter((todo) => eligible.has(todo.id))
          .map((todo) => [todo.id, todo]),
      ).values(),
    ];
  });
  const hasNext = computed(() => page.value * 20 < total.value);

  async function load(targetPage = 1): Promise<void> {
    const ticket = ++request;
    const scope = context.value;
    if (!active.value) return;
    loading.value = true;
    error.value = null;
    items.value = [];
    total.value = 0;
    if (targetPage === 1) revision = null;
    try {
      const query = keyword.value.trim();
      const result = await projectCollabApi.requirementPage({
        projectId: input.projectId(),
        itemKind: input.itemKind() === 'requirement' ? 'requirement' : kind.value,
        ...(query ? { keyword: query } : {}),
        page: targetPage,
        pageSize: 20,
      });
      if (ticket !== request || scope !== context.value) return;
      if (!result.ok) {
        error.value = result.message;
        return;
      }
      if (revision !== null && revision !== result.queryRevision) {
        error.value = '父项列表已变化，请重新搜索。';
        return;
      }
      revision = result.queryRevision;
      items.value = result.items.filter((todo) => todo.projectId === input.projectId());
      total.value = result.total;
      page.value = result.page;
    } catch {
      if (ticket === request && scope === context.value) error.value = '父项读取失败，请重试。';
    } finally {
      if (ticket === request && scope === context.value) loading.value = false;
    }
  }

  async function loadSelected(): Promise<void> {
    const ticket = ++selectedRequest;
    const scope = context.value;
    const id = input.parentId.value;
    selected.value = null;
    selectedError.value = null;
    if (!id) return;
    const cached =
      known.value.find((todo) => todo.id === id) ?? items.value.find((todo) => todo.id === id);
    if (cached) {
      selected.value = cached;
      return;
    }
    if (!active.value) return;
    try {
      const result = await projectCollabApi.todoDetail({ todoId: id });
      if (ticket !== selectedRequest || scope !== context.value) return;
      if (result.ok && result.todo.id === id && result.todo.projectId === input.projectId())
        selected.value = result.todo;
      else selectedError.value = result.ok ? '当前父项不可用。' : result.message;
    } catch {
      if (ticket === selectedRequest && scope === context.value)
        selectedError.value = '当前父项读取失败，请重试。';
    }
  }
  watch(
    [context, keyword, kind, input.itemKind],
    () => {
      request += 1;
      items.value = [];
      loading.value = false;
      error.value = null;
      total.value = 0;
      page.value = 1;
      void load();
    },
    { immediate: true },
  );
  watch(
    [context, () => input.parentId.value],
    () => {
      void loadSelected();
    },
    { immediate: true },
  );
  onScopeDispose(() => {
    request += 1;
    selectedRequest += 1;
  });
  return {
    keyword,
    kind,
    page,
    total,
    loading,
    error,
    selectedError,
    candidates,
    selected,
    hasNext,
    load,
    loadSelected,
  };
}
