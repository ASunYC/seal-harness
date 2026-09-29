import { computed, onScopeDispose, shallowRef, watch } from 'vue';
import type { ComputedRef } from 'vue';

import type { Todo } from '@shared/protocol/project-collab.js';
import type { ProjectPlanWindow } from '@shared/protocol/project-collab-plan-dates.js';

import { useProjectCollabStore } from '../../stores/projectCollab';
import type { ProjectCollabNotice } from '../../stores/projectCollabErrors';
import { projectCollabApi } from '../../sdk/projectCollab';
import { resolvePlanWindowTaskScope } from './plan-window-task-scope';
import type { TodoFieldContext, TodoFieldDescriptor } from './todo-fields';
import { selectTodoRows } from './useTodoViewState';
import type { TodoViewConfig } from './useTodoViewState';

/**
 * 日历 / 时间轴的取数与行集合（CORE-08，ADR-0042）——看板页签里这两个视图的**唯一**数据入口。
 *
 * ⭐ 日期由服务端判：视图报来「此刻可见的那一段」（`onWindow`），这里按页签层级向服务端按计划时间段逐页取全
 *    （`store.loadPlanWindow`）；⛔ 不再拿看板那份游标全量（`store.todos`）在本地按日期筛。
 * ⭐ 视图配置照旧：筛选 / 搜索 / 排序与表格、看板走同一支 `selectTodoRows`，作用在服务端取回的**完整**
 *    这一段上——所以筛选叠加之后日历里有的条目，表格里带同样筛选也有（判据「切视图数据一致」）。
 * ⚠️ 任务页归属从日期结果向上按需授权补齐父链；不依赖旧全量缓存，也不把段外祖先作为日期结果。
 * ⚠️ 结果只认**本页签那一段**：store 里残留的若是别的层级的查询（刚切页签、新查询还没回来），一律当空。
 * ⚠️ 同一个看板视图里切项目：store 清空这一段并推进纪元，视图的月份却没变、不会再报一次——这里记住上次那一段，
 *    在 store 已打开这个项目时按它重取；换号途中（store 没打开任何项目）⛔ 不发请求。
 * ⚠️ 视图离屏（切到表格 / 看板、页签卸载）即交还这一段（`release`）：store 不再持有时间段，之后的事件、
 *    清单重取与切项目都不为没人看的一段发请求；视图重新挂载时自己会再报一段。
 */
export interface PlanWindowRowsOptions {
  readonly projectId: () => string;
  readonly scope: () => 'requirement' | 'task';
  readonly config: () => TodoViewConfig;
  readonly fields: () => readonly TodoFieldDescriptor[];
  readonly context: () => TodoFieldContext;
}

export interface PlanWindowRows {
  readonly rows: ComputedRef<Todo[]>;
  readonly loading: ComputedRef<boolean>;
  readonly error: ComputedRef<ProjectCollabNotice | null>;
  readonly truncated: ComputedRef<boolean>;
  /** 视图报来可见的那一段（挂载时一次、翻月 / 翻段各一次）。 */
  onWindow(window: ProjectPlanWindow): void;
  /** 报错条上的「重试」：按视图上次报来的那一段重取。 */
  retry(): void;
  /** 视图卸载时报来：交还这一段（此后切项目也不再按上次那一段重取）。 */
  release(): void;
}

export function usePlanWindowRows(options: PlanWindowRowsOptions): PlanWindowRows {
  const store = useProjectCollabStore();

  /** 视图最近一次报来的那一段（还没报过为 null）。 */
  let lastWindow: ProjectPlanWindow | null = null;

  function load(): void {
    if (lastWindow === null) return;
    if (
      options.scope() === 'task' &&
      (!store.mySubject || store.activeProjectId !== options.projectId())
    )
      return;
    void store.loadPlanWindow(options.projectId(), { scope: options.scope(), ...lastWindow });
  }

  // flush: 'post'：切项目时纪元（openProject）与视图的 projectId 属性先后变，合到渲染之后判一次。
  watch(
    () => [options.projectId(), store.projectEpoch, store.accountEpoch, store.mySubject] as const,
    () => {
      if (store.activeProjectId === options.projectId()) load();
    },
    { flush: 'post' },
  );

  const ownQuery = computed(() => store.planWindowQuery?.scope === options.scope());

  const source = computed(() => ({
    projectId: options.projectId(),
    activeProjectId: store.activeProjectId,
    subject: store.mySubject,
    accountEpoch: store.accountEpoch,
    projectEpoch: store.projectEpoch,
    requestId: store.planWindowRequestId,
    query: store.planWindowQuery,
    scope: options.scope(),
    items: store.planWindowItems,
    loading: store.planWindowLoading,
    error: store.planWindowError,
  }));
  const taskState = shallowRef<{
    readonly source: typeof source.value | null;
    readonly items: readonly Todo[];
    readonly contextTodos: readonly Todo[];
    readonly loading: boolean;
    readonly error: ProjectCollabNotice | null;
  }>({ source: null, items: [], contextTodos: [], loading: false, error: null });
  let disposed = false;
  onScopeDispose(() => {
    disposed = true;
  });
  watch(
    source,
    async (snapshot) => {
      taskState.value = {
        source: snapshot,
        items: [],
        contextTodos: [],
        loading: false,
        error: null,
      };
      if (
        snapshot.scope !== 'task' ||
        snapshot.query?.scope !== 'task' ||
        !snapshot.subject ||
        snapshot.activeProjectId !== snapshot.projectId ||
        snapshot.loading ||
        snapshot.error
      )
        return;
      taskState.value = { ...taskState.value, loading: true };
      const result = await resolvePlanWindowTaskScope({
        items: snapshot.items,
        projectId: snapshot.projectId,
        subject: snapshot.subject,
        readTodo: (todoId) => projectCollabApi.todoDetail({ todoId }),
        stale: () => disposed || snapshot !== source.value,
      });
      if (disposed || snapshot !== source.value) return;
      taskState.value = {
        source: snapshot,
        loading: false,
        items: result.ok ? result.items : [],
        contextTodos: result.ok ? result.contextTodos : [],
        error: result.ok ? null : result.error,
      };
    },
    { immediate: true, flush: 'post' },
  );
  const taskCurrent = computed(() => taskState.value.source === source.value);

  const scopedItems = computed<readonly Todo[]>(() => {
    if (!ownQuery.value) return [];
    const items = store.planWindowItems;
    if (options.scope() !== 'task') return items;
    return taskCurrent.value ? taskState.value.items : [];
  });

  return {
    rows: computed(() =>
      selectTodoRows(
        scopedItems.value,
        options.config(),
        options.fields(),
        options.scope() === 'task'
          ? { todos: taskCurrent.value ? taskState.value.contextTodos : [] }
          : options.context(),
      ),
    ),
    loading: computed(
      () =>
        ownQuery.value &&
        (store.planWindowLoading ||
          (options.scope() === 'task' && (!taskCurrent.value || taskState.value.loading))),
    ),
    error: computed(() =>
      ownQuery.value
        ? (store.planWindowError ??
          (options.scope() === 'task' && taskCurrent.value ? taskState.value.error : null))
        : null,
    ),
    truncated: computed(() => ownQuery.value && store.planWindowTruncated),
    onWindow(window) {
      lastWindow = window;
      load();
    },
    retry: load,
    release() {
      lastWindow = null;
      store.releasePlanWindow();
    },
  };
}
