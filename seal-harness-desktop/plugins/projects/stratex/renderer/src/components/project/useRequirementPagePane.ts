import { computed, onBeforeUnmount, ref, watch } from 'vue';
import type { ComputedRef, Ref } from 'vue';
import type { Todo } from '@shared/protocol/project-collab.js';
import { useProjectCollabStore } from '../../stores/projectCollab';
import type { TodoScope } from './todo-hierarchy';
import type { TodoFieldContext, TodoFieldDescriptor } from './todo-fields';
import { useTodoViewState } from './useTodoViewState';
import type { TodoViewConfig, TodoViewState } from './useTodoViewState';
import { requirementPageQuery, REQUIREMENT_SORT_KEYS } from './requirement-page-query';
import { pagedTodoRows } from './todo-page-rows';
import type { PagedTodoRow } from './todo-page-rows';
interface RequirementPagePane {
  readonly viewState: TodoViewState;
  readonly config: ComputedRef<TodoViewConfig>;
  readonly pageQuery: ComputedRef<ReturnType<typeof requirementPageQuery>>;
  readonly queryFields: ComputedRef<readonly TodoFieldDescriptor[]>;
  readonly sortableFields: ComputedRef<readonly TodoFieldDescriptor[]>;
  readonly focusedTodo: Ref<Todo | null>;
  readonly availableTodos: ComputedRef<Todo[]>;
  readonly fieldContext: ComputedRef<TodoFieldContext>;
  readonly scopedTodos: ComputedRef<readonly Todo[]>;
  readonly visibleTodos: ComputedRef<readonly Todo[]>;
  readonly boardExpanded: Ref<ReadonlySet<string>>;
  readonly boardRows: ComputedRef<readonly PagedTodoRow[]>;
  toggleBoardChildren(id: string): void;
}
/** One server query and page projection shared by board and table. */
export function useRequirementPagePane(options: {
  readonly projectId: () => string;
  readonly scope: () => TodoScope;
  readonly fields: () => readonly TodoFieldDescriptor[];
}): RequirementPagePane {
  const store = useProjectCollabStore();
  const viewState = useTodoViewState({
    storageKey: options.scope() === 'task' ? '.tasks' : '',
    contextKey: () =>
      store.mySubject
        ? JSON.stringify([
            store.mySubject,
            options.projectId(),
            options.scope(),
            options.fields().map((field) => field.key),
          ])
        : null,
  });
  const config = computed(() => viewState.config);
  const pageQuery = computed(() => requirementPageQuery(config.value, options.scope() === 'task'));
  const queryFields = computed(() =>
    options
      .fields()
      .filter((field) =>
        [
          'title',
          'status',
          'creator',
          ...(options.scope() === 'task' ? [] : ['assignee']),
        ].includes(field.key),
      )
      .map((field) =>
        field.type === 'member'
          ? {
              ...field,
              options: () =>
                (store.detail?.members ?? []).map((member) => ({
                  value: member.subject,
                  label: member.displayName,
                })),
            }
          : field,
      ),
  );
  const sortableFields = computed(() =>
    options.fields().filter((field) => REQUIREMENT_SORT_KEYS.some((key) => key === field.key)),
  );
  watch(
    () =>
      [
        options.projectId(),
        store.activeProjectId,
        store.mySubject,
        store.projectEpoch,
        JSON.stringify(pageQuery.value.filters),
        pageQuery.value.error,
      ] as const,
    () => {
      if (
        pageQuery.value.error !== null ||
        !store.mySubject ||
        store.activeProjectId !== options.projectId()
      )
        return;
      void store.setRequirementPageFilters(options.projectId(), pageQuery.value.filters);
    },
    { immediate: true },
  );
  onBeforeUnmount(() => store.releaseRequirementPage());

  const focusedTodo = ref<Todo | null>(null);
  watch(
    () => [options.projectId(), store.mySubject, store.projectEpoch],
    () => {
      focusedTodo.value = null;
    },
    { flush: 'sync' },
  );
  const availableTodos = computed(() => {
    // A failed authorization refresh clears the page revision; old detail snapshots must not survive it.
    if (store.requirementPageError && store.requirementQueryRevision === null) return [];
    const items = [
      ...store.todos,
      ...store.requirementItems,
      ...Object.values(store.requirementSubtrees).flat(),
      ...(focusedTodo.value ? [focusedTodo.value] : []),
    ];
    const latest = new Map<string, Todo>();
    for (const todo of items)
      if ((latest.get(todo.id)?.version ?? -1) <= todo.version) latest.set(todo.id, todo);
    return [...latest.values()];
  });
  const fieldContext = computed(() => ({ todos: availableTodos.value }));
  const scopedTodos = computed(() => store.requirementItems);
  const visibleTodos = computed(() => (pageQuery.value.error ? [] : scopedTodos.value));
  function defaultBoardExpanded(): ReadonlySet<string> {
    if (options.scope() !== 'requirement') return new Set();
    const pageIds = new Set(store.requirementItems.map((todo) => todo.id));
    return new Set(
      store.requirementItems
        .filter(
          (todo) =>
            todo.itemKind === 'requirement' && todo.parentId !== null && pageIds.has(todo.parentId),
        )
        .map((todo) => todo.parentId as string),
    );
  }
  const boardExpanded = ref<ReadonlySet<string>>(defaultBoardExpanded());
  watch(
    () => [
      options.projectId(),
      store.mySubject,
      store.projectEpoch,
      store.requirementPage,
      store.requirementItems
        .map((todo) => `${todo.id}:${todo.parentId ?? ''}:${todo.itemKind}`)
        .join('|'),
    ],
    () => {
      boardExpanded.value = defaultBoardExpanded();
      if (
        !store.mySubject ||
        store.activeProjectId !== options.projectId() ||
        pageQuery.value.error
      )
        return;
      for (const id of boardExpanded.value) {
        if (store.requirementSubtrees[id] === undefined && !store.requirementSubtreeStates[id])
          void store.loadRequirementSubtree(options.projectId(), id);
      }
    },
    { immediate: true },
  );
  const boardRows = computed(() =>
    pagedTodoRows(visibleTodos.value, store.requirementSubtrees, boardExpanded.value, 0),
  );
  function toggleBoardChildren(id: string): void {
    const next = new Set(boardExpanded.value);
    if (next.has(id)) next.delete(id);
    else {
      next.add(id);
      if (store.requirementSubtrees[id] === undefined)
        void store.loadRequirementSubtree(options.projectId(), id);
    }
    boardExpanded.value = next;
  }

  return {
    viewState,
    config,
    pageQuery,
    queryFields,
    sortableFields,
    focusedTodo,
    availableTodos,
    fieldContext,
    scopedTodos,
    visibleTodos,
    boardExpanded,
    boardRows,
    toggleBoardChildren,
  };
}
