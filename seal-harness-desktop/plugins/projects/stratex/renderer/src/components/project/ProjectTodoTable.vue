<script setup lang="ts">
import { computed, ref, watch } from 'vue';

import { isTodoAssignedToAssistant, isTodoRequirement } from '@shared/protocol/project-collab.js';
import type { Todo, TodoItemKind } from '@shared/protocol/project-collab.js';

import ReferenceIdCopy from '../ui/ReferenceIdCopy.vue';
import ProjectAvatar from './ProjectAvatar.vue';
import TodoBatchBar from './TodoBatchBar.vue';
import TodoRowActions from './TodoRowActions.vue';
import TodoTableAddRow from './TodoTableAddRow.vue';
import TodoTitleCell from './TodoTitleCell.vue';
import TodoColumnHeader from './TodoColumnHeader.vue';
import TodoSubtreeControls from './TodoSubtreeControls.vue';
import { todoColumnWidth, todoPinnedOffsets } from './todo-column-layout';
import { pagedTodoRows } from './todo-page-rows';
import { REQUIREMENT_SORT_KEYS } from './requirement-page-query';
import AppIcon from '../ui/AppIcon.vue';
// TODO_STATUS_LABELS 有意不在此处引入：状态文本已随药丸收进 TodoRowActions，
// 本表格不再自绘状态标签（合并 main 时它随并集被带进来过，未使用）。
import {
  formatRelativeTime,
  isTodoDueSoon,
  todoAssigneeLabel,
  todoRelationCount,
} from './project-format';
import { BUILTIN_TODO_FIELDS, todoFieldText } from './todo-fields';
import type { TodoFieldDescriptor } from './todo-fields';
import { flattenTodoTree, selectTaskPageTodos, selectTodosInScope } from './todo-hierarchy';
import type { TodoScope } from './todo-hierarchy';
import { groupTodos } from './todo-query';
import type { TodoGroup } from './todo-query';
import { activeGroupField, selectTodoRows, useTodoViewState } from './useTodoViewState';
import type { TodoViewState } from './useTodoViewState';
import { useProjectCollabStore } from '../../stores/projectCollab';

/**
 * 待办表格视图。看板列看流转，表格扫全量——两个视图读的是**同一份** `store.todos`，
 * 状态流转与编辑入口走同一个 `TodoRowActions`，收窄（筛选/搜索/排序）走同一个
 * `selectTodoRows`，种类收窄走同一个 `selectTodosInScope`。
 *
 * ⚠️ 列不是写死的：`columns` 是**字段描述符表**经字段显示开关过滤后的投影。
 *    单元格渲染对内置字段各有精致形态，其余字段一律走 `todoFieldText` 的通用兜底——
 *    自定义字段（以及任务页那一列「所属需求」）进了描述符表就能出列，不必先来这里加分支。
 *
 * 层级由 `flattenTodoTree` 递归投影，不设产品深度上限。
 */
const props = withDefaults(
  defineProps<{
    /** 临期判定的时间基准，由页签统一快照后传下来（两个视图不各自取一次 now）。 */
    nowMs: number;
    projectId: string;
    /** 字段全集（＝内置 + 本页附加 + 将来的项目自定义）。 */
    fields?: readonly TodoFieldDescriptor[];
    /** 视图配置。缺省时自建一份**不落盘**的，用于把表格单独挂起来。 */
    viewState?: TodoViewState;
    /**
     * 种类收窄（FLOW-01 判据 1）。
     *  - `requirement` 需求池：以**全部需求森林**为入口，行内可展开全部后代；
     *  - `task`        任务页：以**当前身份认领的需求 + 其子树 + 本人旧 standalone 任务**为入口
     *                   （`selectTaskPageTodos`），行内可展开其子任务——⛔ 不是「全部任务森林」；
     *  - `all`         不收窄。
     */
    scope?: TodoScope;
    serverPaged?: boolean;
  }>(),
  {
    fields: () => BUILTIN_TODO_FIELDS,
    viewState: () => useTodoViewState({ persist: false }),
    scope: 'all',
    serverPaged: false,
  },
);
const emit = defineEmits<{
  /** 打开一条**需求**的单屏详情（UX-02）：点需求标题或需求行空白处。详情挂在看板那一层。 */
  open: [Todo];
  /** 打开**任务**的编辑弹层（需求的编辑已退为详情里的动作）。 */
  edit: [Todo];
  workOrder: [Todo];
  openExecution: [string];
  /** 点了标题格里的「N 条草案待审阅」；审阅弹层挂在看板那一层。 */
  openDrafts: [];
  /** 需求行上的「让助理拆解」；发送要用项目页壳层那个常驻会话框，故一路上冒。 */
  decompose: [Todo, TodoItemKind];
  /**
   * 删除请求上冒到看板层（确认框挂在那里）。载荷统一为**根数组**：单行删除是 `[todo]`，
   * 批量删除是选中的那几根 —— 两条路汇到同一个确认框。
   */
  delete: [readonly Todo[]];
  /** 需求池无主需求行上的「认领」；认领对话框挂在看板那一层（FLOW-01 接线 FLOW-02）。 */
  claim: [Todo];
}>();

function onDecompose(todo: Todo, targetItemKind: TodoItemKind): void {
  emit('decompose', todo, targetItemKind);
}

const store = useProjectCollabStore();

const config = computed(() => props.viewState.config);
/** 取候选值/显示名的上下文恒用**全量**待办：所属需求要按 id 换回标题，筛掉的也得换得出。 */
const context = computed(() => ({
  todos: props.serverPaged
    ? [...store.requirementItems, ...Object.values(store.requirementSubtrees).flat()]
    : store.todos,
}));
const columns = computed(() => {
  const visible = props.viewState.visibleFields(props.fields);
  const pinned = config.value.pinnedFieldKeys ?? [];
  return [
    ...visible.filter((field) => pinned.includes(field.key)),
    ...visible.filter((field) => !pinned.includes(field.key)),
  ];
});
const pinnedOffsets = computed(() =>
  todoPinnedOffsets(
    columns.value,
    config.value.pinnedFieldKeys ?? [],
    config.value.columnWidths ?? {},
  ),
);
const tableWidth = computed(
  () =>
    columns.value.reduce(
      (sum, field) => sum + todoColumnWidth(field.key, config.value.columnWidths ?? {}),
      0,
    ) + 160,
);
function columnStyle(key: string): Record<string, string> {
  const size = `${String(todoColumnWidth(key, config.value.columnWidths ?? {}))}px`;
  const left = pinnedOffsets.value[key];
  return {
    width: size,
    minWidth: size,
    maxWidth: size,
    ...(left !== undefined
      ? { position: 'sticky', left: `${String(left)}px`, zIndex: '2', background: 'var(--panel)' }
      : {}),
  };
}
function sortable(key: string): boolean {
  return !props.serverPaged || REQUIREMENT_SORT_KEYS.some((candidate) => candidate === key);
}
const scoped = computed(() => {
  // 需求池：全量需求森林（可展开全部后代）。
  if (props.scope === 'requirement') return store.todos;
  // 任务页：我处理的需求 + 其子树 + 本人旧 standalone 任务——⛔ 不是全部任务森林。
  if (props.scope === 'task') return selectTaskPageTodos(store.todos, store.mySubject);
  return selectTodosInScope(store.todos, props.scope);
});
const rows = computed(() =>
  props.serverPaged
    ? store.requirementItems
    : selectTodoRows(scoped.value, config.value, props.fields, context.value),
);
const groupField = computed(() => activeGroupField(config.value, props.fields));
const showGroupHeaders = computed(() => groupField.value !== null);

/**
 * 需求行下挂的任务：与主表**同一支收窄管线**（筛选/搜索/排序都作用于它们）。
 * 展开看到的是「符合当前条件的任务」而不是另一套口径——两套口径会让人以为筛选漏了。
 */
const expanded = ref<ReadonlySet<string>>(new Set());

function isExpanded(id: string): boolean {
  return expanded.value.has(id);
}

function toggleExpanded(id: string): void {
  const next = new Set(expanded.value);
  if (next.has(id)) next.delete(id);
  else {
    next.add(id);
    if (props.serverPaged && store.requirementSubtrees[id] === undefined)
      void store.loadRequirementSubtree(props.projectId, id);
  }
  expanded.value = next;
}

/**
 * 分组关掉时也走「一个组」的结构：模板只有一条渲染路径，组头由 `showGroupHeaders`
 * 决定出不出，不必为两种形态各写一遍表体。
 */
const groups = computed<readonly TodoGroup[]>(() => {
  const field = groupField.value;
  if (field === null) return [{ key: '', label: '', todos: rows.value }];
  return groupTodos(rows.value, field, context.value);
});

interface TodoRowEntry {
  readonly todo: Todo;
  /** 行号只给顶层行；子行为 null（它答的是「主表第几行」，子行不在那个序列里）。 */
  readonly number: number | null;
  readonly depth: number;
  /** 展开后能看到几条任务（0 ＝没有可展开的，不出展开件）。 */
  readonly childCount: number;
  readonly parentId: string | null;
}

/** 行号跨组连续：它回答的是「这张表一共多少行、我在第几行」，不是组内第几个。 */
const numberedGroups = computed(() => {
  if (props.serverPaged) {
    let offset = (store.requirementPage - 1) * store.requirementPageSize;
    return groups.value.map((group) => {
      const entries = pagedTodoRows(
        group.todos,
        store.requirementSubtrees,
        expanded.value,
        offset,
        store.requirementItems,
      );
      offset += group.todos.length;
      return { key: group.key, label: group.label, rows: entries };
    });
  }
  let seq = 0;
  return groups.value.map((group) => {
    const entries: TodoRowEntry[] = [];
    let hiddenBelowDepth: number | null = null;
    for (const treeRow of flattenTodoTree(group.todos)) {
      if (hiddenBelowDepth !== null) {
        if (treeRow.depth > hiddenBelowDepth) continue;
        hiddenBelowDepth = null;
      }
      const todo = treeRow.todo;
      if (treeRow.depth === 0) seq += 1;
      entries.push({
        todo,
        number: treeRow.depth === 0 ? seq : null,
        depth: treeRow.depth,
        childCount: treeRow.childCount,
        parentId: todo.parentId,
      });
      if (treeRow.childCount > 0 && !isExpanded(todo.id)) hiddenBelowDepth = treeRow.depth;
    }
    return { key: group.key, label: group.label, rows: entries };
  });
});

/* ── 选中态与批量操作 ── */
const selected = ref<ReadonlySet<string>>(new Set());
const renderedIds = computed(() =>
  numberedGroups.value.flatMap((group) => group.rows.map((row) => row.todo.id)),
);
const allSelected = computed(
  () => renderedIds.value.length > 0 && renderedIds.value.every((id) => selected.value.has(id)),
);
const someSelected = computed(
  () => !allSelected.value && renderedIds.value.some((id) => selected.value.has(id)),
);

/**
 * 批量动作的作用域 = **选中 ∩ 当前渲染在表里**。
 *
 * 交集不能省：选完再改筛选条件（或收起某条需求）后，看不见的那些仍在选中集里；
 * 对看不见的行动手是一次不可撤销的意外——没有删除端点更没有撤销。
 */
const batchTargets = computed(() =>
  numberedGroups.value
    .flatMap((group) => group.rows.map((row) => row.todo))
    .filter((todo) => selected.value.has(todo.id)),
);

/** 换项目/换页签后旧的选中集必须作废，否则批量会打到一批已经不在表里的 id 上。 */
watch(
  () => [
    props.projectId,
    props.scope,
    store.mySubject,
    store.projectEpoch,
    props.serverPaged ? store.requirementQueryRevision : null,
    props.serverPaged ? store.requirementPage : null,
  ],
  () => {
    selected.value = new Set();
    expanded.value = new Set();
  },
);

function toggleRow(id: string, checked: boolean): void {
  const next = new Set(selected.value);
  if (checked) next.add(id);
  else next.delete(id);
  selected.value = next;
}

function toggleAll(checked: boolean): void {
  selected.value = checked ? new Set(renderedIds.value) : new Set();
}

function onRowPick(id: string, event: Event): void {
  const el = event.target;
  if (el instanceof HTMLInputElement) toggleRow(id, el.checked);
}

function onAllPick(event: Event): void {
  const el = event.target;
  if (el instanceof HTMLInputElement) toggleAll(el.checked);
}

function toggleSort(key: string): void {
  props.viewState.toggleSort(key, props.fields);
}

/** 表头的 `aria-sort`：读屏与自动化都靠它认当前排序，不靠那个箭头字形。 */
function ariaSort(key: string): 'ascending' | 'descending' | 'none' {
  if (config.value.sort.key !== key) return 'none';
  return config.value.sort.direction === 'asc' ? 'ascending' : 'descending';
}

function dueSoon(todo: Todo): boolean {
  return isTodoDueSoon(todo.dueAt, todo.status, props.nowMs);
}

function isClosed(todo: Todo): boolean {
  return todo.status === 'done' || todo.status === 'cancelled';
}

function cellClass(field: TodoFieldDescriptor, todo: Todo): Record<string, boolean> {
  return {
    'todo-tbl__ref': field.key === 'reference',
    'todo-tbl__title': field.key === 'title',
    'todo-tbl__due': field.key === 'due',
    'todo-tbl__when': field.key === 'updated',
    // 数字/日期列的对齐用全局 .tnum（tokens.css 里就是 tabular-nums），不本地重复声明
    tnum: field.key === 'due' || field.key === 'updated',
    'is-soon': field.key === 'due' && dueSoon(todo),
  };
}

/**
 * 命中区归属：编辑只由行的**空白承载区**触发，交互控件各自吃掉自己的点击。
 *
 * 判据是「点到的东西是不是一个交互控件」，不是「逐个给控件补 `@click.stop`」——
 * 任何原生交互元素（复选框 / 状态下拉 / 展开箭头 / 工作单按钮 / 链接）都被 `closest`
 * 命中而排除，**新加一个原生控件时作者什么都不用记**。真要放一个非原生的可点元素，
 * 显式标 `data-todo-interactive` 即可（约定而非遗漏）。
 */
function isInteractiveTarget(event: Event): boolean {
  const target = event.target;
  if (!(target instanceof Element)) return false;
  return (
    target.closest(
      'a, button, select, input, textarea, label, [role="button"], [data-todo-interactive]',
    ) !== null
  );
}

/**
 * 单击行的空白承载区：**需求**进单屏详情（看得见就能看，不看改单权限）；**任务**进编辑（只在
 * 可编辑时）。选中仍只由复选框负责，行点击不兼任。
 */
function onRowActivate(todo: Todo, event: MouseEvent): void {
  if (isInteractiveTarget(event)) return;
  if (isTodoRequirement(todo)) {
    emit('open', todo);
    return;
  }
  if (!store.canEditTodo(todo)) return;
  emit('edit', todo);
}

/**
 * 行本身可聚焦的只有**可编辑的任务行**（Enter/Space 开编辑）；需求行的键盘入口是标题格里的
 * 「查看需求详情」按钮——行与按钮都可聚焦会让同一条需求吃掉两个 Tab 位。
 */
function isRowFocusable(todo: Todo): boolean {
  return !isTodoRequirement(todo) && store.canEditTodo(todo);
}

/** 键盘：焦点落在行本身时按 Enter/Space 编辑（落在控件上的按键归控件，不上抢）。 */
function onRowKey(todo: Todo, event: KeyboardEvent): void {
  if (event.target !== event.currentTarget) return;
  if (event.key !== 'Enter' && event.key !== ' ') return;
  if (!isRowFocusable(todo)) return;
  event.preventDefault();
  emit('edit', todo);
}

/** 行内新建只在「不必挑父级」的页面上出现：任务页建单必须先指定所属需求，走弹层。 */
const showAddRow = computed(() => store.canWrite && props.scope !== 'task');
/** 行内新建**不带父级**，所以它在需求页建出来的就是需求——文案得跟着说实话。 */
const addRowNoun = computed(() => (props.scope === 'requirement' ? '需求' : '待办'));

/** 勾选列 + 行号列 + 字段列 + 操作列——末尾新建行要横跨整表。 */
const totalColumnCount = computed(() => columns.value.length + 3);
</script>

<template>
  <!-- 表格是扫读界面，比周围更密——原型实测支持它更密：#pp-req .rqt 字号 12px，
       周围 proto 档正文 14px（12<14 ⇒ 确实是密度岛，保留）。但原型的「密」来自小字号，
       内边距反而宽松：原型 .rqt td = 7px/10px、行 ≈30px。旧写法借 compact 档给的是
       13px + td 2px/6px + 行 24px，收得比原型更紧、字号也偏大，与原型不符。
       故：保留 data-density="compact"（承载嵌套徽标/次列的偏紧感），但表体核心度量
       (.todo-tbl 字号、.todo-tbl td 内边距/行高) 已按原型 .rqt 实测显式落值，见下方 CSS。 -->
  <div class="todo-tblshell" data-density="compact">
    <div class="todo-table-layout-actions">
      <span v-if="showGroupHeaders">按本页分组</span>
      <button type="button" class="btn btn--secondary" @click="props.viewState.resetColumns()">
        恢复默认列
      </button>
    </div>
    <TodoBatchBar
      v-if="batchTargets.length > 0"
      :todos="batchTargets"
      @clear="selected = new Set()"
      @done="selected = new Set()"
      @delete="emit('delete', $event)"
    />
    <div class="todo-tblwrap" data-testid="todo-table">
      <table class="todo-tbl" :style="{ width: `${tableWidth}px`, tableLayout: 'fixed' }">
        <colgroup>
          <col style="width: 36px" />
          <col style="width: 44px" />
          <col
            v-for="field in columns"
            :key="field.key"
            :style="{ width: `${todoColumnWidth(field.key, config.columnWidths ?? {})}px` }"
          />
          <col style="width: 80px" />
        </colgroup>
        <caption class="sr-only">
          待办表格视图
        </caption>
        <thead>
          <tr>
            <th scope="col" class="todo-tbl__pickHead">
              <input
                type="checkbox"
                data-testid="todo-select-all"
                aria-label="全选待办"
                :checked="allSelected"
                :indeterminate="someSelected"
                @change="onAllPick"
              />
            </th>
            <th scope="col" class="todo-tbl__numHead"><span class="todo-tbl__opsHead">#</span></th>
            <th
              v-for="field in columns"
              :key="field.key"
              scope="col"
              :data-column="field.key"
              :aria-sort="ariaSort(field.key)"
              :style="{
                ...columnStyle(field.key),
                zIndex:
                  pinnedOffsets[field.key] !== undefined ? 'calc(var(--z-sticky) + 1)' : undefined,
              }"
            >
              <TodoColumnHeader
                :field="field"
                :state="props.viewState"
                :sortable="sortable(field.key)"
                @sort="toggleSort(field.key)"
              />
            </th>
            <th scope="col"><span class="todo-tbl__opsHead">操作</span></th>
          </tr>
        </thead>
        <tbody v-for="group in numberedGroups" :key="group.key" :data-group-key="group.key">
          <tr v-if="showGroupHeaders" class="todo-tbl__groupRow" data-testid="todo-group-row">
            <td :colspan="totalColumnCount">
              <span class="todo-tbl__groupName">{{ group.label }}</span>
              <span class="todo-tbl__groupCnt tnum">{{ group.rows.length }}</span>
            </td>
          </tr>
          <tr
            v-for="row in group.rows"
            :key="row.todo.id"
            :data-todo-id="row.todo.id"
            :data-status="row.todo.status"
            :data-visibility="row.todo.visibility"
            :data-source="row.todo.source"
            :data-parent-id="row.parentId"
            :class="{
              'is-closed': isClosed(row.todo),
              'is-picked': selected.has(row.todo.id),
              'is-child': row.depth > 0,
              'is-personal': row.todo.visibility === 'personal',
              'is-editable': store.canEditTodo(row.todo),
              'is-openable': isTodoRequirement(row.todo),
            }"
            :tabindex="isRowFocusable(row.todo) ? 0 : undefined"
            :aria-label="isRowFocusable(row.todo) ? `编辑：${row.todo.title}` : undefined"
            @click="onRowActivate(row.todo, $event)"
            @keydown="onRowKey(row.todo, $event)"
          >
            <td class="todo-tbl__pick">
              <input
                type="checkbox"
                data-testid="todo-select-row"
                :aria-label="`选中 ${row.todo.title}`"
                :checked="selected.has(row.todo.id)"
                @change="onRowPick(row.todo.id, $event)"
              />
            </td>
            <td class="todo-tbl__num tnum">{{ row.number ?? '' }}</td>
            <td
              v-for="field in columns"
              :key="field.key"
              :data-column="field.key"
              :style="columnStyle(field.key)"
              :class="cellClass(field, row.todo)"
            >
              <!-- 需求标识列（原型 .requirement-id18）：完整 UUID，点即复制；表头已写明是什么，
                   前缀只留给读屏与复制反馈。任务行没有对外标识，写「—」。
                   交互控件自带点击，行的「点空白处编辑」按 isInteractiveTarget 自动让开。 -->
              <template v-if="field.key === 'reference'">
                <ReferenceIdCopy
                  v-if="isTodoRequirement(row.todo)"
                  :key="row.todo.id"
                  :reference-id="row.todo.id"
                  label="需求 ID"
                  label-hidden
                  class="todo-tbl__refCopy"
                />
                <span v-else class="todo-tbl__unassigned">—</span>
              </template>
              <template v-else-if="field.key === 'title'">
                <TodoTitleCell
                  :todo="row.todo"
                  :depth="row.depth"
                  :child-count="row.childCount"
                  :expanded="isExpanded(row.todo.id)"
                  :reserve-caret="true"
                  :show-task-total="props.serverPaged || props.scope === 'task'"
                  @toggle="toggleExpanded(row.todo.id)"
                  @open="emit('open', row.todo)"
                  @open-drafts="emit('openDrafts')"
                />
                <TodoSubtreeControls
                  v-if="props.serverPaged && isExpanded(row.todo.id)"
                  :state="store.requirementSubtreeStates[row.todo.id]"
                  @retry="store.loadRequirementSubtree(props.projectId, row.todo.id)"
                  @more="store.loadMoreRequirementSubtree(props.projectId, row.todo.id)"
                />
              </template>
              <!-- 状态列＝可改状态的药丸本身（编辑入口，非只读文本）。状态在表里只出现
                   这一处：原先「状态列显示、操作列再挂一个下拉」的重复已去重。 -->
              <template v-else-if="field.key === 'status'">
                <TodoRowActions variant="status" :todo="row.todo" />
              </template>
              <template v-else-if="field.key === 'assignee'">
                <!-- 档位与人一起看：⛔ 空处理人不等于未分配，助理档下它同样是空的 -->
                <span
                  v-if="isTodoAssignedToAssistant(row.todo)"
                  class="todo-tbl__assistant"
                  data-testid="todo-assignee-assistant"
                  >{{ todoAssigneeLabel(row.todo) }}</span
                >
                <span v-else-if="row.todo.assigneeSubject" class="todo-tbl__who">
                  <ProjectAvatar :name="row.todo.assigneeDisplayName" size="s" />
                  <span class="todo-tbl__whoName">{{ todoAssigneeLabel(row.todo) }}</span>
                </span>
                <span v-else class="todo-tbl__unassigned">{{ todoAssigneeLabel(row.todo) }}</span>
              </template>
              <template v-else-if="field.key === 'creator'">{{
                row.todo.creatorDisplayName ?? row.todo.creatorSubject ?? '未知添加人'
              }}</template>
              <template v-else-if="field.key === 'priority'">
                <span class="todo-tbl__prio" :data-priority="row.todo.priority">{{
                  todoFieldText(field, row.todo, context)
                }}</span>
              </template>
              <template v-else-if="field.key === 'labels'">
                <span v-if="row.todo.labels.length === 0" class="todo-tbl__unassigned">—</span>
                <span v-else class="todo-tbl__tags">
                  <span v-for="label in row.todo.labels" :key="label" class="todo-tbl__label">{{
                    label
                  }}</span>
                </span>
              </template>
              <!-- 关联列（原型「关联」）：材料引用 + 关联会话的条数，有关联才出徽标，
                   没有的行是「—」（照原型：不写 0）。与看板卡同一支 todoRelationCount。 -->
              <template v-else-if="field.key === 'relations'">
                <span
                  v-if="todoRelationCount(row.todo) > 0"
                  class="todo-tbl__links"
                  data-testid="todo-links"
                  :aria-label="`关联 ${todoRelationCount(row.todo)} 项`"
                >
                  <!-- 图标是**装饰**：语义整个落在 aria-label 上。少了它读屏只会念出
                       一个光秃秃的数字——「关联」二字此前兼着可读名，换成图标就得补回来。 -->
                  <AppIcon name="link" :size="12" aria-hidden="true" />
                  <span aria-hidden="true">{{ todoRelationCount(row.todo) }}</span>
                </span>
                <span v-else class="todo-tbl__unassigned">—</span>
              </template>
              <!-- 更新时间＝相对量（多久以前）：与「截止」那种绝对日期在口径上分工，
                   同一行不再要人在「几分几秒」与「哪一天」之间切换心智（依赖统一的 nowMs 快照）。 -->
              <template v-else-if="field.key === 'updated'">{{
                formatRelativeTime(row.todo.updatedAt, props.nowMs)
              }}</template>
              <!-- 兜底：截止/所属需求与将来的自定义字段都走这一支（值由描述符自己格式化） -->
              <template v-else>{{ todoFieldText(field, row.todo, context) || '—' }}</template>
            </td>
            <!-- 操作列去重后只承担「工作单 + 收窄说明」：状态改到状态列的药丸上、编辑改到
                 点行，这里不再有状态下拉与编辑按钮，普通可编辑行这一格就是空的（列随之收窄）。
                 与看板同一道门（G-11）、同一个组件。 -->
            <td class="todo-tbl__opsCell">
              <!-- 操作件包一层组件根 div：td 一旦 display:flex 就退出表格排版上下文，
                   浏览器会补一个匿名单元格，边框与列宽都跟着错位。 -->
              <TodoRowActions
                class="todo-tbl__ops"
                variant="flow"
                :todo="row.todo"
                :page="props.scope"
                @work-order="emit('workOrder', $event)"
                @open-execution="emit('openExecution', $event)"
                @decompose="onDecompose"
                @claim="emit('claim', $event)"
                @delete="emit('delete', [$event])"
              />
            </td>
          </tr>
        </tbody>
        <!-- 新建行放 tfoot 而不是 tbody：它不是一条待办，不该混进「表里有几行」的计数里 -->
        <tfoot v-if="showAddRow">
          <TodoTableAddRow
            :project-id="props.projectId"
            :colspan="totalColumnCount"
            :noun="addRowNoun"
          />
        </tfoot>
      </table>
    </div>
  </div>
</template>

<style scoped src="./project-todo-table.css"></style>
