<script setup lang="ts">
import { computed, nextTick, ref } from 'vue';

import type { Todo } from '@shared/protocol/project-collab.js';

import AppIcon from '../ui/AppIcon.vue';
import TodoToolPopover from './TodoToolPopover.vue';
import { isTodoFieldHideable } from './todo-fields';
import type { TodoFieldDescriptor } from './todo-fields';
import {
  TODO_FILTER_OPERATOR_LABELS,
  todoFilterOperatorNeedsValue,
  todoFilterOperators,
} from './todo-query';
import type { TodoFilterCondition, TodoFilterOperator } from './todo-query';
import { REQUIREMENT_FROM_DOC_LABEL, REQUIREMENT_FROM_DOC_TITLE } from './requirement-from-doc';
import { groupableFields } from './useTodoViewState';
import type { TodoBoardView, TodoViewState } from './useTodoViewState';
import { FIXED_VIEWS, PROJECT_VIEWS } from './project-views';
import type { ProjectView } from './project-views';

/**
 * 看板页签工具栏：左侧视图芯片组，右侧筛选 / 搜索 / 视图设置 / 添加。
 *
 * 三个浮层里的每一项都对着**字段描述符表**（`fields`）生成——筛选的字段下拉、
 * 分组的候选、排序的候选、字段显示的开关清单，四处都是同一张表的投影。
 * 往表里塞一个自定义字段，这四处自动多出一项，本文件一行不改。
 */
const props = withDefaults(
  defineProps<{
    viewState: TodoViewState;
    fields: readonly TodoFieldDescriptor[];
    queryFields?: readonly TodoFieldDescriptor[];
    sortableFields?: readonly TodoFieldDescriptor[];
    filterOperators?: (field: TodoFieldDescriptor) => readonly TodoFilterOperator[];
    /** 取候选值与显示名的上下文（处理人/标签的候选来自当前这批待办）。 */
    todos: readonly Todo[];
    /** 收窄后剩几条（工具栏左侧的计数报的是**筛完的**数，不是全量）。 */
    visibleCount: number;
    canWrite: boolean;
    /**
     * 「从文档」建需求的入口开关。
     *
     * 缺省 false：**任务页不该有它**——任务挂在需求下，「从一份文档开始」开的是一条
     * 需求；在任务页摆这个按钮会建出一条不属于本页的东西。调用方不显式给就没有入口。
     */
    canCreateFromDoc?: boolean;
    /**
     * 外部数据源配置入口的角色门：**只有项目拥有者**能配数据源、能触发同步。
     *
     * ⚠️ 这一条不是「不给点了必错的按钮」那种便利收窄——数据源决定整个项目会被灌进
     * 什么，触发同步用的又是操作者本人的外部票据。成员看到一个点开只会 403 的入口，
     * 只会以为是坏了。缺省 false：新调用点不显式给权限就没有入口（fail-safe）。
     */
    canManageDataSources?: boolean;
    /**
     * 当前**已启用**的视图集合（固定的表格/看板 + 已加的额外视图）。UX-03：芯片按它渲染。
     * ⛔ 集合的真相在 `ProjectBoardPane`（按账号×项目读偏好并回落），这里只负责渲染。
     * 缺省只有两个固定视图——调用方不给就是「首次仅表格+看板」。
     */
    enabledViews?: readonly ProjectView[];
  }>(),
  { enabledViews: () => FIXED_VIEWS },
);

const emit = defineEmits<{
  create: [];
  /** 「从一份文档开始」：选来源 → 非资产的先入库 → 预填标题与关联的建单框。 */
  'create-from-doc': [];
  'open-data-sources': [];
  /** 「＋」：打开「添加或管理面板」（UX-03，日历/时间轴的增删）。 */
  'manage-views': [];
}>();

const VIEW_ICONS: Readonly<Record<ProjectView, string | undefined>> = {
  table: 'table',
  board: 'board',
  calendar: 'calendar',
  timeline: 'timeline',
};

/** 视图芯片按**已启用集合**渲染（固定两枚 + 已加的额外视图），文案取自 PROJECT_VIEWS。 */
const viewChips = computed<
  readonly { value: TodoBoardView; label: string; icon: string | undefined }[]
>(() =>
  props.enabledViews.map((id) => ({
    value: id,
    label: PROJECT_VIEWS.find((def) => def.id === id)?.label ?? id,
    icon: VIEW_ICONS[id],
  })),
);

const context = computed(() => ({ todos: props.todos }));
const config = computed(() => props.viewState.config);
const queryFields = computed(() => props.queryFields ?? props.fields);
const sortableFields = computed(() => props.sortableFields ?? props.fields);
const fieldOperators = (field: TodoFieldDescriptor): readonly TodoFilterOperator[] =>
  props.filterOperators?.(field) ?? todoFilterOperators(field);

const filterPopover = ref<InstanceType<typeof TodoToolPopover> | null>(null);
const searchInput = ref<HTMLInputElement | null>(null);
/** 搜索框就地展开：收起时只是一个放大镜，占位一格而不是一直摆一个空输入框。 */
const searchOpen = ref(config.value.search.length > 0);

const chipGroup = ref<HTMLElement | null>(null);

const filterCount = computed(() => config.value.filters.length);
const hiddenCount = computed(
  () => props.fields.filter((field) => !props.viewState.isFieldVisible(field.key)).length,
);
const visibleFieldCount = computed(() => props.fields.length - hiddenCount.value);
const groupChoices = computed(() => groupableFields(props.fields));
const currentViewLabel = computed(
  () => viewChips.value.find((chip) => chip.value === config.value.view)?.label ?? '表格',
);

function pickView(view: TodoBoardView): void {
  props.viewState.setView(view);
}

/** 芯片组是 radiogroup：左右方向键在组内移动，Tab 只进出整组（与 SegmentedControl 同口径）。 */
function onChipKeydown(event: KeyboardEvent): void {
  const step = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0;
  if (step === 0) return;
  event.preventDefault();
  const chips = viewChips.value;
  const index = chips.findIndex((chip) => chip.value === config.value.view);
  const next = chips[(index + step + chips.length) % chips.length];
  if (!next) return;
  pickView(next.value);
  void nextTick(() =>
    chipGroup.value?.querySelector<HTMLElement>('[aria-checked="true"]')?.focus(),
  );
}

async function toggleSearch(): Promise<void> {
  if (searchOpen.value) {
    searchOpen.value = false;
    props.viewState.setSearch('');
    return;
  }
  searchOpen.value = true;
  await nextTick();
  searchInput.value?.focus();
}

function onSearchInput(event: Event): void {
  const el = event.target;
  if (el instanceof HTMLInputElement) props.viewState.setSearch(el.value);
}

function onSearchKeydown(event: KeyboardEvent): void {
  if (event.key !== 'Escape') return;
  event.preventDefault();
  event.stopPropagation();
  props.viewState.setSearch('');
  searchOpen.value = false;
}

function fieldOf(condition: TodoFilterCondition): TodoFieldDescriptor | null {
  return (
    queryFields.value.find((field) => field.key === condition.fieldKey) ??
    props.fields.find((field) => field.key === condition.fieldKey) ??
    null
  );
}

/** 认不出字段的残留条件（自定义字段被删）只留它自己那一个运算符，下拉不空着。 */
function operatorsFor(condition: TodoFilterCondition): readonly TodoFilterOperator[] {
  const field = fieldOf(condition);
  return field === null ? [condition.operator] : fieldOperators(field);
}

/** 换字段＝换类型＝运算符与值都作废，一并重置，别留一个当前类型不支持的运算符。 */
function onConditionField(condition: TodoFilterCondition, event: Event): void {
  const el = event.target;
  if (!(el instanceof HTMLSelectElement)) return;
  const field = props.fields.find((candidate) => candidate.key === el.value);
  if (!field) return;
  const [operator] = fieldOperators(field);
  if (!operator) return;
  props.viewState.updateFilter(condition.id, { fieldKey: field.key, operator, value: '' });
}

function onConditionOperator(condition: TodoFilterCondition, event: Event): void {
  const el = event.target;
  if (!(el instanceof HTMLSelectElement)) return;
  props.viewState.updateFilter(condition.id, { operator: el.value as TodoFilterOperator });
}

function onConditionValue(condition: TodoFilterCondition, event: Event): void {
  const el = event.target;
  if (el instanceof HTMLSelectElement || el instanceof HTMLInputElement)
    props.viewState.updateFilter(condition.id, { value: el.value });
}

function onGroupChange(event: Event): void {
  const el = event.target;
  if (!(el instanceof HTMLSelectElement)) return;
  props.viewState.setGroupKey(el.value === '' ? null : el.value);
}

function onSortKeyChange(event: Event): void {
  const el = event.target;
  if (!(el instanceof HTMLSelectElement)) return;
  props.viewState.setSort({ key: el.value, direction: config.value.sort.direction });
}

function flipSortDirection(): void {
  props.viewState.setSort({
    key: config.value.sort.key,
    direction: config.value.sort.direction === 'asc' ? 'desc' : 'asc',
  });
}

function onFieldToggle(field: TodoFieldDescriptor, event: Event): void {
  const el = event.target;
  if (el instanceof HTMLInputElement) props.viewState.setFieldVisible(field, el.checked);
}

function openFilters(): void {
  filterPopover.value?.open();
}
</script>

<template>
  <div class="tbar">
    <!-- 视图芯片组。radiogroup 语义保留：读屏与自动化认的是 role 而不是那两个字形 -->
    <div
      ref="chipGroup"
      class="tbar__chips"
      role="radiogroup"
      aria-label="待办视图"
      @keydown="onChipKeydown"
    >
      <button
        v-for="chip in viewChips"
        :key="chip.value"
        class="tbar__chip"
        :class="{ 'is-on': chip.value === config.view }"
        type="button"
        role="radio"
        :aria-checked="chip.value === config.view"
        :tabindex="chip.value === config.view ? 0 : -1"
        :data-testid="`todo-view-${chip.value}`"
        @click="pickView(chip.value)"
      >
        <AppIcon v-if="chip.icon" :name="chip.icon" :size="16" class="tbar__chipIcon" />
        {{ chip.label }}
      </button>
      <!-- 「＋」＝添加或管理面板（UX-03）：勾选日历/时间轴才启用，取消勾选即移除。
           表格、看板始终保留、不在此增删。 -->
      <button
        class="tbar__chip tbar__chip--add"
        type="button"
        data-testid="todo-view-add"
        title="添加或管理面板"
        aria-label="添加或管理面板"
        @click="emit('manage-views')"
      >
        <AppIcon name="plus" :size="16" class="tbar__chipIcon" />
      </button>
    </div>

    <span class="tbar__count tnum">{{ props.visibleCount }} 项待办</span>
    <span class="tbar__spacer"></span>

    <!-- 筛选 -->
    <TodoToolPopover
      ref="filterPopover"
      label="筛选"
      test-id="todo-filter"
      :badge="filterCount > 0 ? String(filterCount) : ''"
    >
      <template #icon>
        <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5">
          <path d="M2 3.5h12L9.5 8.7v3.9l-3 1.4V8.7z" stroke-linejoin="round" />
        </svg>
      </template>

      <p v-if="config.filters.length === 0" class="tbar__note" data-testid="todo-filter-empty">
        还没有筛选条件。多条条件按「与」生效——每条都成立的待办才留下。
      </p>
      <div
        v-for="condition in config.filters"
        :key="condition.id"
        class="tbar__cond"
        :data-filter-id="condition.id"
      >
        <label class="tbar__condCell">
          <span class="sr-only">筛选字段</span>
          <select
            class="tbar__select"
            data-testid="todo-filter-field"
            :value="condition.fieldKey"
            @change="onConditionField(condition, $event)"
          >
            <option v-for="field in queryFields" :key="field.key" :value="field.key">
              {{ field.label }}
            </option>
          </select>
        </label>
        <label class="tbar__condCell">
          <span class="sr-only">筛选运算</span>
          <select
            class="tbar__select"
            data-testid="todo-filter-operator"
            :value="condition.operator"
            @change="onConditionOperator(condition, $event)"
          >
            <option v-for="operator in operatorsFor(condition)" :key="operator" :value="operator">
              {{ TODO_FILTER_OPERATOR_LABELS[operator] }}
            </option>
          </select>
        </label>
        <template v-if="todoFilterOperatorNeedsValue(condition.operator)">
          <label v-if="fieldOf(condition)?.options" class="tbar__condCell">
            <span class="sr-only">筛选取值</span>
            <select
              class="tbar__select"
              data-testid="todo-filter-value"
              :value="condition.value"
              @change="onConditionValue(condition, $event)"
            >
              <option value="">未设置</option>
              <option
                v-for="option in fieldOf(condition)?.options?.(context) ?? []"
                :key="option.value"
                :value="option.value"
              >
                {{ option.label }}
              </option>
            </select>
          </label>
          <label v-else class="tbar__condCell">
            <span class="sr-only">筛选取值</span>
            <input
              class="tbar__input"
              data-testid="todo-filter-value"
              :type="fieldOf(condition)?.type === 'date' ? 'date' : 'text'"
              :value="condition.value"
              placeholder="未设置"
              @input="onConditionValue(condition, $event)"
            />
          </label>
        </template>
        <button
          class="tbar__condDrop"
          type="button"
          data-testid="todo-filter-remove"
          :aria-label="`移除筛选条件 ${fieldOf(condition)?.label ?? condition.fieldKey}`"
          @click="props.viewState.removeFilter(condition.id)"
        >
          ✕
        </button>
      </div>
      <button
        class="tbar__panelAction"
        type="button"
        data-testid="todo-filter-add"
        @click="props.viewState.addFilter(queryFields)"
      >
        ＋ 添加筛选条件
      </button>
    </TodoToolPopover>

    <!-- 搜索：就地展开 -->
    <div class="tbar__search" :class="{ 'is-open': searchOpen }">
      <button
        class="tbar__tool"
        type="button"
        :aria-expanded="searchOpen"
        aria-label="搜索事项"
        data-testid="todo-search-toggle"
        @click="toggleSearch"
      >
        <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5">
          <circle cx="7" cy="7" r="4.2" />
          <path d="M10.2 10.2 14 14" stroke-linecap="round" />
        </svg>
      </button>
      <input
        v-if="searchOpen"
        ref="searchInput"
        class="tbar__searchInput"
        type="search"
        placeholder="搜索事项..."
        aria-label="搜索事项"
        data-testid="todo-search-input"
        :value="config.search"
        @input="onSearchInput"
        @keydown="onSearchKeydown"
      />
    </div>

    <!-- 视图设置 -->
    <TodoToolPopover label="视图设置" test-id="todo-settings">
      <template #icon>
        <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5">
          <path d="M2 4.5h12M2 11.5h12" stroke-linecap="round" />
          <circle cx="6" cy="4.5" r="1.8" />
          <circle cx="10.5" cy="11.5" r="1.8" />
        </svg>
      </template>

      <!-- 数据源设置：**仅项目拥有者**可见。成员只读——他们看得见条目上的「外部」
           标记，但配置与同步不归他们，摆一个点开只会 403 的入口只会像坏了。 -->
      <div v-if="props.canManageDataSources" class="tbar__group" data-testid="datasource-group">
        <p class="tbar__groupHead">数据源</p>
        <p class="tbar__hint">从代码仓库导入需求、任务与需求文档（单向只读，不写回）。</p>
        <button
          class="tbar__panelAction"
          type="button"
          data-testid="datasource-open"
          @click="emit('open-data-sources')"
        >
          数据源设置…
        </button>
      </div>

      <div class="tbar__group">
        <p class="tbar__groupHead">视图</p>
        <div class="tbar__row">
          <span class="tbar__rowLabel">当前视图</span>
          <span class="tbar__rowValue" data-testid="todo-settings-view">{{
            currentViewLabel
          }}</span>
        </div>
        <p class="tbar__hint">表格、看板始终保留；日历、时间轴用左侧的 ＋ 按需添加或移除。</p>
      </div>

      <div class="tbar__group">
        <p class="tbar__groupHead">
          字段显示
          <span class="tbar__groupCount tnum" data-testid="todo-settings-field-count"
            >{{ visibleFieldCount }}/{{ props.fields.length }}</span
          >
        </p>
        <label
          v-for="field in props.fields"
          :key="field.key"
          class="tbar__check"
          :data-field-key="field.key"
        >
          <input
            type="checkbox"
            :data-testid="`todo-field-toggle-${field.key}`"
            :checked="props.viewState.isFieldVisible(field.key)"
            :disabled="!isTodoFieldHideable(field)"
            @change="onFieldToggle(field, $event)"
          />
          <span>{{ field.label }}</span>
          <span v-if="!isTodoFieldHideable(field)" class="tbar__lock">锚列</span>
        </label>
      </div>

      <div class="tbar__group">
        <p class="tbar__groupHead">分组</p>
        <label class="tbar__row">
          <span class="tbar__rowLabel">按字段分组</span>
          <select
            class="tbar__select"
            data-testid="todo-group-select"
            :value="config.groupKey ?? ''"
            @change="onGroupChange"
          >
            <option value="">不分组</option>
            <option v-for="field in groupChoices" :key="field.key" :value="field.key">
              {{ field.label }}
            </option>
          </select>
        </label>
      </div>

      <div class="tbar__group">
        <p class="tbar__groupHead">
          筛选
          <span class="tbar__groupCount tnum" data-testid="todo-settings-filter-count">{{
            filterCount
          }}</span>
        </p>
        <button class="tbar__panelAction" type="button" @click="openFilters">打开筛选条件…</button>
      </div>

      <div class="tbar__group">
        <p class="tbar__groupHead">排序</p>
        <label class="tbar__row">
          <span class="tbar__rowLabel">排序字段</span>
          <select
            class="tbar__select"
            data-testid="todo-sort-select"
            :value="config.sort.key"
            @change="onSortKeyChange"
          >
            <option v-for="field in sortableFields" :key="field.key" :value="field.key">
              {{ field.label }}
            </option>
          </select>
        </label>
        <button
          class="tbar__panelAction"
          type="button"
          data-testid="todo-sort-direction"
          @click="flipSortDirection"
        >
          {{ config.sort.direction === 'asc' ? '升序 ↑' : '倒序 ↓' }}
        </button>
      </div>
    </TodoToolPopover>

    <!--
      「从文档」排在「添加」之前：手上已经有一份需求书的人，走这条比先建单再回头
      找关联短两步。⛔ 不做成「添加」的下拉菜单——那会把一条常用路径藏进二级。
    -->
    <button
      v-if="props.canCreateFromDoc"
      class="btn btn--secondary tbar__fromDoc"
      type="button"
      data-testid="todo-create-from-doc"
      :title="REQUIREMENT_FROM_DOC_TITLE"
      @click="emit('create-from-doc')"
    >
      {{ REQUIREMENT_FROM_DOC_LABEL }}
    </button>
    <button
      v-if="props.canWrite"
      class="btn btn--primary tbar__add"
      type="button"
      data-testid="todo-create"
      @click="emit('create')"
    >
      <AppIcon name="plus" :size="15" />
      添加
    </button>
  </div>
</template>

<style scoped src="./project-todo-toolbar.css"></style>
