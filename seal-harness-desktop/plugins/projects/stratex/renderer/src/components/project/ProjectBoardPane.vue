<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';

import {
  hasTodoChildProgress,
  isTodoAssignedToAssistant,
  isTodoRequirement,
  todoChildProgress,
} from '@shared/protocol/project-collab.js';
import type { Todo, TodoItemKind } from '@shared/protocol/project-collab.js';

import ReferenceIdCopy from '../ui/ReferenceIdCopy.vue';
import ProjectAvatar from './ProjectAvatar.vue';
import ProjectDataSourceDialog from './ProjectDataSourceDialog.vue';
import ProjectDocRequirementDialog from './ProjectDocRequirementDialog.vue';
import ProjectDraftReviewDialog from './ProjectDraftReviewDialog.vue';
import ProjectRequirementClaimDialog from './ProjectRequirementClaimDialog.vue';
import ProjectRequirementDetail from './ProjectRequirementDetail.vue';
import ProjectRequirementSubmitDialog from './ProjectRequirementSubmitDialog.vue';
import ProjectTodoDeleteDialog from './ProjectTodoDeleteDialog.vue';
import ProjectTodoDialog from './ProjectTodoDialog.vue';
import ProjectTodoTable from './ProjectTodoTable.vue';
import ProjectTodoPageState from './ProjectTodoPageState.vue';
import RequirementPageControls from './RequirementPageControls.vue';
import TodoSubtreeControls from './TodoSubtreeControls.vue';
import { requirementFilterOperators } from './requirement-page-query';
import type { ProjectRefTarget } from './project-refs';
import ProjectWorkOrderDialog from './ProjectWorkOrderDialog.vue';
import ProjectTodoToolbar from './ProjectTodoToolbar.vue';
import ProjectCalendarView from './ProjectCalendarView.vue';
import ProjectTimelineView from './ProjectTimelineView.vue';
import ProjectViewManageDialog from './ProjectViewManageDialog.vue';
import TodoMetaBadges from './TodoMetaBadges.vue';
import TodoRowActions from './TodoRowActions.vue';
import {
  TODO_PRIORITY_LABELS,
  TODO_STATUS_LABELS,
  TODO_STATUS_ORDER,
  formatProjectDate,
  isTodoDueSoon,
  todoAssigneeLabel,
  todoProgressHint,
  todoRelationCount,
} from './project-format';
import { BUILTIN_TODO_FIELDS, TODO_PARENT_FIELD } from './todo-fields';
import type { TodoFieldDescriptor } from './todo-fields';
import { findTodoById, requirementCandidates } from './todo-hierarchy';
import type { TodoScope } from './todo-hierarchy';
import type { ProjectRefTodoFocus } from './project-ref-navigation';
import { requirementDocRef, requirementTitleFromFilename } from './requirement-from-doc';
import { buildTodoDecomposeRequest } from './todo-decompose';
import { isDraftBatchVisibleTo } from './work-order';
import { useRequirementDetailView } from './useRequirementDetailView';
import { usePlanWindowRows } from './usePlanWindowRows';
import { classifySchedule } from './schedule-layout';
import { useTodoBoardDnd } from './useTodoBoardDnd';
import { useRequirementPagePane } from './useRequirementPagePane';
import {
  readEnabledExtraViews,
  resolveActiveView,
  resolveEnabledViews,
  writeEnabledExtraViews,
} from './project-views';
import type { ProjectExtraView } from './project-views';
// ⚠️ 状态流转与编辑入口已收进 TodoRowActions（看板卡与表格行同一份），
//    这里不再直接调 changeTodoStatus——两处各调一次就是两条会漂移的路径。
//    看板的拖卡换列走 useTodoBoardDnd，它底下仍是同一支 applyTodoStatus。
import { useProjectCollabStore } from '../../stores/projectCollab';

const props = withDefaults(
  defineProps<{
    projectId: string;
    scope?: TodoScope;
    fields?: readonly TodoFieldDescriptor[];
    focusRequest?: ProjectRefTodoFocus | null;
  }>(),
  { scope: 'requirement', fields: () => BUILTIN_TODO_FIELDS, focusRequest: null },
);
const emit = defineEmits<{
  openExecution: [string];
  decompose: [string];
  openMilestones: [string | null];
  focusHandled: [boolean];
  openRef: [ProjectRefTarget];
}>();

const store = useProjectCollabStore();

const isTaskScope = computed(() => props.scope === 'task');

const paneFields = computed<readonly TodoFieldDescriptor[]>(() =>
  isTaskScope.value ? [...props.fields, TODO_PARENT_FIELD] : props.fields,
);

const mountedAtMs = Date.now();

const dialogTodo = ref<Todo | null | undefined>(undefined);

const docPickerOpen = ref(false);
const docSeed = ref<{ readonly title: string; readonly refs: readonly string[] } | null>(null);

function onDocPicked(picked: { readonly fileId: string; readonly filename: string }): void {
  const refToken = requirementDocRef(picked.fileId);
  docPickerOpen.value = false;
  docSeed.value = {
    title: requirementTitleFromFilename(picked.filename),
    // 组不出 token 就不带关联（⛔ 不产出一个服务端必拒的建单请求）；标题照填，
    // 用户至少不用从零打字。
    refs: refToken === null ? [] : [refToken],
  };
  dialogTodo.value = null;
}

function onDecompose(todo: Todo, targetItemKind: TodoItemKind): void {
  emit(
    'decompose',
    buildTodoDecomposeRequest(todo, targetItemKind, {
      members: store.detail?.members ?? [],
      files: store.files,
      todos: store.todos,
    }),
  );
}

const workOrderTodo = ref<Todo | null>(null);
const draftReviewOpen = ref(false);

const deleteTargets = ref<readonly Todo[] | null>(null);

const claimTarget = ref<Todo | null>(null);

const submitTarget = ref<Todo | null>(null);

function claimFromEditor(requirement: Todo): void {
  dialogTodo.value = undefined;
  docSeed.value = null;
  claimTarget.value = requirement;
}

const dataSourceOpen = ref(false);

onMounted(() => {
  void store.loadDraftBatches(props.projectId);
  /*
   * 资产列表这一页也要：需求行的「关联材料」与「让助理拆解」都得把 `asset:<id>`
   * 换回文件名，换不出来那句话里就少一行——而用户在需求页从头到尾不会去点「资产」
   * 页签。已经取过就不再取（换项目时 store 会清空，那时自然会重取）。
   */
  if (store.files.length === 0) void store.loadFiles(props.projectId);
});

const openDraftBatches = computed(() =>
  store.draftBatches.filter(
    (batch) => batch.state === 'open' && isDraftBatchVisibleTo(batch, store.mySubject),
  ),
);
const pendingDraftCount = computed(() =>
  openDraftBatches.value.reduce(
    (total, batch) => total + batch.drafts.filter((draft) => draft.state === 'pending').length,
    0,
  ),
);

const {
  viewState,
  config,
  pageQuery,
  queryFields,
  sortableFields,
  focusedTodo,
  availableTodos,
  fieldContext,
  visibleTodos,
  boardExpanded,
  boardRows,
  toggleBoardChildren,
} = useRequirementPagePane({
  projectId: () => props.projectId,
  scope: () => props.scope,
  fields: () => paneFields.value,
});

const enabledExtra = ref<ProjectExtraView[]>([]);
function reloadEnabledExtra(): void {
  enabledExtra.value = readEnabledExtraViews(store.mySubject, props.projectId);
}
watch(() => [store.mySubject, props.projectId] as const, reloadEnabledExtra, { immediate: true });

const enabledViews = computed(() => resolveEnabledViews(enabledExtra.value));

watch(
  enabledViews,
  (views) => {
    const resolved = resolveActiveView(config.value.view, views);
    if (resolved !== config.value.view) viewState.setView(resolved);
  },
  { immediate: true },
);

const manageViewsOpen = ref(false);
function onManageViewsSave(next: readonly ProjectExtraView[]): void {
  writeEnabledExtraViews(store.mySubject, props.projectId, next);
  reloadEnabledExtra();
  manageViewsOpen.value = false;
}

const planWindow = usePlanWindowRows({
  projectId: () => props.projectId,
  scope: () => (isTaskScope.value ? 'task' : 'requirement'),
  config: () => config.value,
  fields: () => paneFields.value,
  context: () => fieldContext.value,
});
const windowTodos = planWindow.rows;
const windowLoading = planWindow.loading;
const windowError = planWindow.error;
const windowTruncated = planWindow.truncated;
const unscheduledCount = computed(
  () =>
    visibleTodos.value.filter(
      (todo) => classifySchedule(todo.startAt, todo.dueAt) === 'unscheduled',
    ).length,
);

const requirements = computed(() => requirementCandidates(availableTodos.value));
const canCreate = computed(
  () => store.canWrite && (!isTaskScope.value || requirements.value.length > 0),
);

const defaultParentId = computed<string | null>(() => {
  if (!isTaskScope.value) return null;
  return visibleTodos.value[0]?.parentId ?? requirements.value[0]?.id ?? null;
});

function parentTitle(todo: Todo): string | null {
  if (todo.parentId === null) return null;
  return findTodoById(availableTodos.value, todo.parentId)?.title ?? todo.parentId;
}

const dnd = useTodoBoardDnd(store);

const paneRoot = ref<HTMLElement | null>(null);
const {
  detailTodo,
  open: openRequirementDetail,
  close: closeRequirementDetail,
} = useRequirementDetailView({
  root: paneRoot,
  todos: () => availableTodos.value,
  resetKeys: [() => props.projectId, () => store.mySubject, () => store.projectEpoch],
});

function applyFocusRequest(request: ProjectRefTodoFocus & { readonly todo?: Todo }): boolean {
  if (
    request.todo &&
    (request.todo.projectId !== props.projectId || request.todo.id !== request.todoId)
  )
    return false;
  if (
    request.todo &&
    'projectId' in request.todo &&
    request.todo.projectId === props.projectId &&
    request.todo.id === request.todoId
  )
    focusedTodo.value = request.todo;
  const todo = findTodoById(availableTodos.value, request.todoId);
  if (todo === null) return false;
  if (request.mode === 'detail') {
    if (!isTodoRequirement(todo)) return false;
    openRequirementDetail(todo);
    return true;
  }
  if (isTodoRequirement(todo) || !store.canEditTodo(todo)) return false;
  closeRequirementDetail();
  dialogTodo.value = todo;
  return true;
}

watch(
  () => [props.focusRequest, store.requirementItems, store.requirementPageLoading] as const,
  ([request]) => {
    if (request === null) return;
    const carried = 'todo' in request && request.todo !== undefined;
    if (
      !carried &&
      store.requirementPageLoading &&
      findTodoById(availableTodos.value, request.todoId) === null
    )
      return;
    emit('focusHandled', applyFocusRequest(request));
  },
  { immediate: true },
);

function openTodo(todo: Todo, trigger?: EventTarget | null): void {
  if (isTodoRequirement(todo)) openRequirementDetail(todo, trigger);
  else dialogTodo.value = todo;
}

function isCardFocusable(todo: Todo): boolean {
  return !isTodoRequirement(todo) && store.canEditTodo(todo);
}

const dragClickGuard = ref(false);

function isInteractiveTarget(event: Event): boolean {
  const target = event.target;
  if (!(target instanceof Element)) return false;
  return (
    target.closest(
      'a, button, select, input, textarea, label, [role="button"], [data-todo-interactive]',
    ) !== null
  );
}

function onCardActivate(todo: Todo, event: MouseEvent): void {
  if (dragClickGuard.value) return;
  if (isInteractiveTarget(event)) return;
  // 需求卡的空白承载区＝进详情（看得见就能看详情，不看改单权限）。
  if (isTodoRequirement(todo)) {
    openRequirementDetail(todo);
    return;
  }
  if (!store.canEditTodo(todo)) return;
  dialogTodo.value = todo;
}

function onCardTitleOpen(todo: Todo, event: MouseEvent): void {
  if (dragClickGuard.value) return;
  openRequirementDetail(todo, event.currentTarget);
}

function onCardKey(todo: Todo, event: KeyboardEvent): void {
  if (event.target !== event.currentTarget) return;
  if (event.key !== 'Enter' && event.key !== ' ') return;
  if (!isCardFocusable(todo)) return;
  event.preventDefault();
  dialogTodo.value = todo;
}

function onCardDragStart(todo: Todo, event: DragEvent): void {
  dragClickGuard.value = true;
  dnd.onDragStart(todo, event);
}

function onCardDragEnd(): void {
  dnd.onDragEnd();
  // 放行到下一拍再解除：那次紧随 dragend 的 click 已被吞掉；真正的点击来自新一次
  // mousedown，不会被这次守卫波及。
  setTimeout(() => {
    dragClickGuard.value = false;
  }, 0);
}

const columns = computed(() =>
  TODO_STATUS_ORDER.map((status) => ({
    status,
    label: TODO_STATUS_LABELS[status],
    // 分列读 `columnStatusOf` 而不是 `todo.status`：拖拽落库这段时间里卡片
    // 先待在目标列，失败会被撤回原列。
    todos: boardRows.value
      .map((row) => row.todo)
      .filter((todo) => dnd.columnStatusOf(todo) === status),
  })),
);

const isEmpty = computed(
  () =>
    !store.requirementPageError &&
    !store.requirementPageLoading &&
    store.requirementTotal === 0 &&
    !hasNarrowing.value,
);
const hasNarrowing = computed(
  () =>
    config.value.search.trim().length > 0 ||
    config.value.filters.some((filter) => filter.value.trim().length > 0),
);

const isFilteredEmpty = computed(
  () =>
    !isEmpty.value &&
    !store.requirementPageLoading &&
    !store.requirementPageError &&
    visibleTodos.value.length === 0,
);

const scopeNoun = computed(() => (isTaskScope.value ? '任务' : '需求'));

function clearNarrowing(): void {
  viewState.setSearch('');
  for (const condition of [...config.value.filters]) viewState.removeFilter(condition.id);
}
</script>

<template>
  <div ref="paneRoot" class="board-pane" :class="{ 'has-detail': detailTodo !== null }">
    <ProjectRequirementDetail
      v-if="detailTodo !== null"
      class="board-pane__detail"
      :todo="detailTodo"
      :project-id="props.projectId"
      :page="props.scope"
      @back="closeRequirementDetail"
      @open="openRequirementDetail"
      @edit="dialogTodo = $event"
      @claim="claimTarget = $event"
      @submit-test="submitTarget = $event"
      @decompose="onDecompose"
      @work-order="workOrderTodo = $event"
      @open-execution="emit('openExecution', $event)"
      @delete="deleteTargets = [$event]"
      @open-drafts="draftReviewOpen = true"
      @open-ref="emit('openRef', $event)"
    />

    <ProjectTodoToolbar
      :view-state="viewState"
      :fields="paneFields"
      :query-fields="queryFields"
      :sortable-fields="sortableFields"
      :filter-operators="requirementFilterOperators"
      :todos="availableTodos"
      :visible-count="store.requirementTotal"
      :can-write="canCreate"
      :can-create-from-doc="canCreate && !isTaskScope"
      :can-manage-data-sources="store.canManageDataSources"
      :enabled-views="enabledViews"
      @create="dialogTodo = null"
      @create-from-doc="docPickerOpen = true"
      @open-data-sources="dataSourceOpen = true"
      @manage-views="manageViewsOpen = true"
    />

    <p
      v-if="!(store.requirementPageError && store.requirementItems.length === 0)"
      class="board-pane__priv"
    >
      <svg
        class="board-pane__privIcon"
        viewBox="0 0 16 16"
        fill="none"
        stroke="currentColor"
        stroke-width="1.5"
        aria-hidden="true"
      >
        <rect x="3" y="7.2" width="10" height="6.3" rx="1.5" />
        <path d="M5.4 7.2V5.2a2.6 2.6 0 0 1 5.2 0v2" stroke-linecap="round" />
      </svg>
      标「个人」的{{ scopeNoun }}只有创建者能看到，项目拥有者也看不到。
    </p>
    <p v-if="isTaskScope" class="board-pane__guide" data-testid="task-page-guide">
      个人视图：这里只按需求处理人筛选。你负责别人某条需求下的某个任务时，那条需求不会进入这里。
    </p>
    <div
      v-if="openDraftBatches.length > 0"
      class="board-drafts"
      data-testid="draft-banner"
      role="status"
    >
      <span class="board-drafts__text"
        >有 {{ pendingDraftCount }} 条拆解草案待审阅，确认后才会进入清单。</span
      >
      <button
        class="btn btn--secondary"
        type="button"
        data-testid="draft-review-open"
        @click="draftReviewOpen = true"
      >
        去审阅
      </button>
    </div>

    <ProjectTodoPageState
      v-if="
        (config.view === 'table' || config.view === 'board') &&
        (pageQuery.error ||
          store.requirementPageError ||
          store.requirementPageLoading ||
          isEmpty ||
          isFilteredEmpty)
      "
      :noun="scopeNoun"
      :task-scope="isTaskScope"
      :error="store.requirementPageError"
      :query-error="pageQuery.error"
      :loading="store.requirementPageLoading"
      :empty="isEmpty"
      :filtered="isFilteredEmpty"
      :can-create="canCreate"
      :can-write="store.canWrite"
      @create="dialogTodo = null"
      @retry="store.loadRequirementPage(props.projectId)"
      @reset="
        clearNarrowing();
        viewState.setSort({ key: 'status', direction: 'asc' });
      "
    />

    <ProjectTodoTable
      v-else-if="config.view === 'table'"
      :now-ms="mountedAtMs"
      :project-id="props.projectId"
      :fields="paneFields"
      :view-state="viewState"
      :scope="props.scope"
      :server-paged="true"
      @open="openRequirementDetail"
      @edit="dialogTodo = $event"
      @work-order="workOrderTodo = $event"
      @open-execution="emit('openExecution', $event)"
      @open-drafts="draftReviewOpen = true"
      @decompose="onDecompose"
      @claim="claimTarget = $event"
      @delete="deleteTargets = $event"
    />

    <ProjectCalendarView
      v-else-if="config.view === 'calendar'"
      :todos="windowTodos"
      :unscheduled-count="unscheduledCount"
      unscheduled-scope="page"
      :loading="windowLoading"
      :error="windowError"
      :truncated="windowTruncated"
      @window="planWindow.onWindow"
      @retry="planWindow.retry"
      @release="planWindow.release"
      @edit="openTodo"
    />
    <ProjectTimelineView
      v-else-if="config.view === 'timeline'"
      :todos="windowTodos"
      :unscheduled-count="unscheduledCount"
      unscheduled-scope="page"
      :loading="windowLoading"
      :error="windowError"
      :truncated="windowTruncated"
      @window="planWindow.onWindow"
      @retry="planWindow.retry"
      @release="planWindow.release"
      @edit="openTodo"
    />

    <div v-else class="board-scroll">
      <div class="board">
        <section
          v-for="column in columns"
          :key="column.status"
          class="board-col"
          :class="{ 'is-dropzone': dnd.isDropTarget(column.status) }"
          :data-status="column.status"
          :data-dropzone="dnd.isDropTarget(column.status) ? 'active' : 'idle'"
          @dragover="dnd.onDragOver(column.status, $event)"
          @dragleave="dnd.onDragLeave(column.status)"
          @drop="dnd.onDrop(column.status, $event)"
        >
          <header class="board-col__head">
            {{ column.label }} <span class="board-col__cnt tnum">{{ column.todos.length }}</span>
          </header>
          <div class="board-col__list">
            <article
              v-for="todo in column.todos"
              :key="todo.id"
              class="todo-card"
              :class="{
                'todo-card--closed': todo.status === 'done' || todo.status === 'cancelled',
                'todo-card--personal': todo.visibility === 'personal',
                'is-dragging': dnd.isDraggingTodo(todo.id),
                'is-editable': store.canEditTodo(todo),
              }"
              :data-todo-id="todo.id"
              :data-item-kind="todo.itemKind"
              :data-parent-id="todo.parentId ?? undefined"
              :data-visibility="todo.visibility"
              :data-source="todo.source"
              :draggable="dnd.canDragTodo(todo)"
              :tabindex="isCardFocusable(todo) ? 0 : undefined"
              :aria-label="isCardFocusable(todo) ? `编辑：${todo.title}` : undefined"
              @click="onCardActivate(todo, $event)"
              @keydown="onCardKey(todo, $event)"
              @dragstart="onCardDragStart(todo, $event)"
              @dragend="onCardDragEnd()"
            >
              <p class="todo-card__title">
                <button
                  v-if="
                    (todo.childTotal ?? 0) > 0 ||
                    (store.requirementSubtrees[todo.id]?.length ?? 0) > 0
                  "
                  type="button"
                  data-testid="todo-board-expand"
                  :aria-expanded="boardExpanded.has(todo.id)"
                  :aria-label="`${boardExpanded.has(todo.id) ? '收起' : '展开'} ${todo.title} 的子项`"
                  @click="toggleBoardChildren(todo.id)"
                >
                  {{ boardExpanded.has(todo.id) ? '▾' : '▸' }}
                </button>
                <button
                  v-if="isTodoRequirement(todo)"
                  class="todo-card__titleBtn"
                  type="button"
                  data-todo-open-detail
                  data-testid="todo-open-detail"
                  :aria-label="`查看需求详情：${todo.title}`"
                  @click="onCardTitleOpen(todo, $event)"
                >
                  {{ todo.title }}
                </button>
                <template v-else>{{ todo.title }}</template>
              </p>
              <ReferenceIdCopy
                v-if="todo.itemKind === 'requirement'"
                :key="todo.id"
                :reference-id="todo.id"
                label="需求 ID"
                class="todo-card__requirementId"
                @click.stop
                @keydown.stop
              />
              <p v-if="parentTitle(todo)" class="todo-card__parent" data-testid="todo-parent-label">
                父项：{{ parentTitle(todo) }}
              </p>
              <div class="todo-card__badges">
                <TodoMetaBadges :todo="todo" @open-drafts="draftReviewOpen = true" />
              </div>
              <div class="todo-card__meta">
                <span class="todo-card__prio" :data-priority="todo.priority">{{
                  TODO_PRIORITY_LABELS[todo.priority]
                }}</span>
                <span
                  v-if="hasTodoChildProgress(todo)"
                  class="todo-card__progress"
                  :class="{ 'is-complete': todo.childDone === todo.childTotal }"
                  data-testid="todo-progress"
                  :title="todoProgressHint"
                  >{{ todoChildProgress(todo).done }}/{{ todoChildProgress(todo).total }}</span
                >
                <span
                  v-if="todoRelationCount(todo) > 0"
                  class="todo-card__links"
                  data-testid="todo-links"
                  >关联 {{ todoRelationCount(todo) }}</span
                >
                <span v-if="todo.startAt" class="todo-card__due tnum"
                  >{{ formatProjectDate(todo.startAt) }} 开始</span
                >
                <span
                  v-if="todo.dueAt"
                  class="todo-card__due tnum"
                  :class="{ 'is-soon': isTodoDueSoon(todo.dueAt, todo.status, mountedAtMs) }"
                  >{{ formatProjectDate(todo.dueAt) }} 截止</span
                >
                <span class="todo-card__who">
                  <span
                    v-if="isTodoAssignedToAssistant(todo)"
                    class="todo-card__assistant"
                    data-testid="todo-assignee-assistant"
                    >{{ todoAssigneeLabel(todo) }}</span
                  >
                  <template v-else-if="todo.assigneeSubject">
                    <ProjectAvatar :name="todo.assigneeDisplayName" size="s" />
                    <span>{{ todoAssigneeLabel(todo) }}</span>
                  </template>
                  <span v-else class="todo-card__unassigned">{{ todoAssigneeLabel(todo) }}</span>
                </span>
              </div>
              <TodoSubtreeControls
                v-if="boardExpanded.has(todo.id)"
                :state="store.requirementSubtreeStates[todo.id]"
                @retry="store.loadRequirementSubtree(props.projectId, todo.id)"
                @more="store.loadMoreRequirementSubtree(props.projectId, todo.id)"
              />
              <TodoRowActions
                class="todo-card__ops"
                variant="card"
                :todo="todo"
                :page="props.scope"
                @work-order="workOrderTodo = $event"
                @open-execution="emit('openExecution', $event)"
                @decompose="onDecompose"
                @claim="claimTarget = $event"
                @delete="deleteTargets = [$event]"
              />
            </article>
            <div v-if="column.todos.length === 0" class="board-col__empty">
              没有{{ column.label }}的待办
            </div>
          </div>
        </section>
      </div>
    </div>

    <RequirementPageControls
      v-if="(config.view === 'table' || config.view === 'board') && !pageQuery.error"
      :page="store.requirementPage"
      :page-size="store.requirementPageSize"
      :total="store.requirementTotal"
      :loading="store.requirementPageLoading"
      @page="store.goToRequirementPage(props.projectId, $event)"
      @size="store.setRequirementPageSize(props.projectId, $event)"
    />

    <ProjectTodoDialog
      v-if="dialogTodo !== undefined"
      :project-id="props.projectId"
      :todo="dialogTodo"
      :require-parent="isTaskScope"
      :default-parent-id="defaultParentId"
      :default-title="dialogTodo === null ? (docSeed?.title ?? '') : ''"
      :default-refs="dialogTodo === null ? (docSeed?.refs ?? []) : []"
      @close="
        dialogTodo = undefined;
        docSeed = null;
      "
      @open-milestones="emit('openMilestones', $event)"
      @open-ref="emit('openRef', $event)"
      @claim="claimFromEditor"
    />

    <ProjectDocRequirementDialog
      v-if="docPickerOpen"
      :project-id="props.projectId"
      @pick="onDocPicked"
      @close="docPickerOpen = false"
    />

    <ProjectWorkOrderDialog
      v-if="workOrderTodo !== null"
      :todo="workOrderTodo"
      @close="workOrderTodo = null"
    />

    <ProjectTodoDeleteDialog
      v-if="deleteTargets !== null && store.canDeleteTodos"
      :roots="deleteTargets"
      @close="deleteTargets = null"
      @done="deleteTargets = null"
    />

    <ProjectRequirementClaimDialog
      v-if="claimTarget !== null"
      :requirement="claimTarget"
      @close="claimTarget = null"
      @done="claimTarget = null"
    />

    <ProjectRequirementSubmitDialog
      v-if="submitTarget !== null"
      :requirement="submitTarget"
      :project-id="props.projectId"
      @close="submitTarget = null"
      @done="submitTarget = null"
    />

    <ProjectDraftReviewDialog
      v-if="draftReviewOpen"
      :project-id="props.projectId"
      @close="draftReviewOpen = false"
    />

    <ProjectDataSourceDialog
      v-if="dataSourceOpen && store.canManageDataSources"
      :project-id="props.projectId"
      :can-manage="store.canManageDataSources"
      @close="dataSourceOpen = false"
    />

    <ProjectViewManageDialog
      v-if="manageViewsOpen"
      :enabled="enabledExtra"
      @close="manageViewsOpen = false"
      @save="onManageViewsSave"
    />
  </div>
</template>

<style scoped src="./project-board-pane.css"></style>
