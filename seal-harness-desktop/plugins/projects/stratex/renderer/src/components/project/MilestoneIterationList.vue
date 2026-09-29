<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';

import { type ProjectIterationListItem } from '@shared/protocol/project-planning.js';
import { planningLifecycleActionFor } from '@shared/protocol/project-planning-lifecycle.js';

import ReferenceIdCopy from '../ui/ReferenceIdCopy.vue';
import ArchivedPlanningSection from './ArchivedPlanningSection.vue';
import IterationPlanViewSwitch from './IterationPlanViewSwitch.vue';
import IterationScheduleBanner from './IterationScheduleBanner.vue';
import MilestoneIterationBoard from './MilestoneIterationBoard.vue';
import MilestoneIterationGantt from './MilestoneIterationGantt.vue';
import {
  applyScheduleDraft,
  milestonePeriod,
  rowsForScheduleViews,
  scheduleDraftSize,
  type IterationPlanView,
} from './iteration-schedule-view';
import { planningLifecycleEntryLabel } from './planning-lifecycle-view';
import { TODO_PRIORITY_LABELS } from './project-format';
import {
  distinctIterationCount,
  groupIterations,
  ITERATION_FILTER_OPTIONS,
  visibleIterations,
  type IterationGroupKey,
} from './iteration-list-view';
import {
  formatPlanningDate,
  ITERATION_STATUS_LABELS,
  PLANNING_UNASSIGNED_OWNER_LABEL,
  PLANNING_UNSCHEDULED_LABEL,
  shortRequirementId,
} from './project-planning-view';
import type { IterationEditableField } from '../../stores/projectCollabPlanning';
import { useProjectCollabStore } from '../../stores/projectCollab';

/**
 * 单个业务目标下的**迭代列表**（MIL-05 · 列表视图）：分组（我的 / 未完成 / 已完成）+
 * 关键字/负责人/优先级/日期的筛选与排序 + 负责人/优先级/日期的**行内编辑** + 快速添加草稿。
 *
 * ⚠️ 挂在 `ProjectMilestonesPane` 展开的那个目标体里（一次只展开一个 ⇒ 本组件同时只有一份
 *    实例）。分组/筛选/排序/去重汇总的**纯派生**逻辑在 `iteration-list-view.ts`，视图态
 *    （筛选/排序/草稿）与三态写入在 `projectCollabPlanning.ts`——本组件只做取数触发、DOM
 *    呈现与把交互转发给 store，⛔ 不在这里重算分组或计数。
 *
 * ⭐ 权威结构来自项目组原型 `index.html` 的**终版**（`renderIterationPlan26` 在 `:2765` 覆写、
 *    展开时调 `milestoneList28`/`:2681`）：分组＝我的/未完成/已完成；筛选下拉 `stage-filter28`
 *    是**另一个**面（全部/我负责的/未计划/已逾期/已完成）。⛔ 别照被覆写的中间层
 *    （`:2599/:2630/:2690`）——那些页面照样渲染但行为是旧的。
 *
 * ⭐ 判据 3：一条「我负责的进行中」轮次会**同时**落进「我的」与「未完成」两组 ⇒ 汇总走
 *    `distinctIterationCount`（按 id 去重），⛔ 不把各组行数相加。
 *
 * ⭐ MIL-06：本组件同时是三视图（看板 / 列表 / 甘特图）的容器——工具条（关键字 / 显示已完成 /
 *    筛选 / 视图切换）与排期草案横幅三视图共用；`visible` 是**唯一一份**共用查询结果（草案先叠加、
 *    再筛、再排），列表切分组、看板按月分列、甘特画到期点，⛔ 各视图不另起一份筛选或排序。
 *    看板与甘特的拖动只进草案（`store.queueIterationSchedule`），横幅「保存排期」才整批落盘。
 *
 * ⚠️ 排期归管理者和拥有者（D-MODEL-01 §四）：编辑/快速添加入口仅 `canManagePlanning`
 *    （manager+）可见——真正的门在服务端（editor/viewer 一律 403），这里只是不给点了必错的
 *    入口，⛔ 不在客户端重造一份权限判定。
 *
 * ⭐ MIL-09（照原型 `[里程碑管理·已定稿]`）：工具条「＋ 添加迭代计划」打开整条表单弹层（名称 / 计划达成
 *    日期 / 负责人 / 完成标准 / 关联需求）；快速添加草稿行的入口挪到「我的迭代计划」组尾。底部「已归档迭代
 *    计划 N」只读可展开。
 */

const props = defineProps<{ projectId: string; milestoneId: string }>();

const store = useProjectCollabStore();

/** subject → 显示名（名册是名称的唯一真相源；解析不到回落 subject）。 */
const memberNames = computed(() => {
  const map = new Map<string, string>();
  for (const member of store.detail?.members ?? []) map.set(member.subject, member.displayName);
  return map;
});
function ownerLabel(subject: string | null): string {
  if (!subject) return PLANNING_UNASSIGNED_OWNER_LABEL;
  return memberNames.value.get(subject) || subject;
}
const ownerOptions = computed(() => store.detail?.members ?? []);

/** 视图态与原始行（都从 store 读；本组件不缓存副本，改视图态即刻联动重算）。 */
const view = computed(() => store.iterationViewFor(props.milestoneId));
const rows = computed<readonly ProjectIterationListItem[]>(
  () => store.milestoneIterations[props.milestoneId] ?? [],
);
const iterationsLoading = computed(
  () => store.milestoneIterationsLoading[props.milestoneId] === true,
);
const iterationsError = computed(() => store.milestoneIterationsError[props.milestoneId] ?? null);
const canEdit = computed(() => store.canManagePlanning);

/** 今天的日历日（`YYYY-MM-DD`）：仅供「已逾期」筛选与排期比较，纯呈现边界读一次时钟。 */
const today = computed(() => {
  const now = new Date();
  const pad = (part: number): string => String(part).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
});

/* MIL-06：视图偏好（按账号 × 项目 × 目标）与排期草案（按目标隔离，未保存）。 */
store.hydrateIterationPlanView(props.projectId, props.milestoneId);
const draft = computed(() => store.iterationScheduleDraftFor(props.milestoneId));
const draftCount = computed(() => scheduleDraftSize(draft.value));
const period = computed(() =>
  milestonePeriod(store.milestones.find((milestone) => milestone.id === props.milestoneId)),
);

/* ⭐ 判据 1「可联动」：关键字 + 筛选下拉 + 负责人 + 排序在同一条派生链上依次作用；
 *    分组在筛完之后切。改任一项都只重算这条链，后者不覆盖前者。
 * ⭐ MIL-06：链的起点是**叠加了排期草案**的行——三视图读的是同一份结果。 */
const visible = computed(() =>
  visibleIterations(applyScheduleDraft(rows.value, draft.value), {
    query: view.value.query,
    filter: view.value.filter,
    subject: store.mySubject,
    today: today.value,
    sort: view.value.sort,
    direction: view.value.direction,
  }),
);
const groups = computed(() =>
  groupIterations(visible.value, { subject: store.mySubject, showDone: view.value.showDone }),
);
/** ⭐ 判据 3 的机器载体：按 id 去重的并集势，⛔ 不是三组行数相加。 */
const distinctCount = computed(() => distinctIterationCount(groups.value));
/** 看板 / 甘特在共用结果之上再隐去已达成（除非显示已完成或筛选就是已完成）。 */
const scheduleRows = computed(() =>
  rowsForScheduleViews(visible.value, { showDone: view.value.showDone, filter: view.value.filter }),
);

function onSelectView(next: IterationPlanView): void {
  if (next === view.value.view) return;
  store.selectIterationPlanView({
    projectId: props.projectId,
    milestoneId: props.milestoneId,
    view: next,
  });
}
function onCancelSchedule(): void {
  store.cancelIterationSchedule(props.milestoneId);
}
function onSaveSchedule(): void {
  void store.saveIterationSchedule(props.projectId, props.milestoneId);
}

/** 「已完成」组只在勾了「显示已完成」时展开行（组头与计数常在）——让开关有可见效果。 */
function groupExpanded(key: IterationGroupKey): boolean {
  return key === 'done' ? view.value.showDone : true;
}

/** 排序箭头（当前列升/降；非当前列显 ↕）。与原型 `stage-sort28` 同义。 */
function sortArrow(field: 'priority' | 'due_at'): string {
  if (view.value.sort !== field) return '↕';
  return view.value.direction === 1 ? '↑' : '↓';
}

function retryIterations(): void {
  void store.loadMilestoneIterations(props.projectId, props.milestoneId);
}

/* MIL-09：添加迭代计划（整条表单）与已归档迭代计划（只读）。 */
function openAddIteration(): void {
  store.openIterationForm(props.projectId, props.milestoneId, null);
}
const archivedLoaded = computed(() => store.archivedIterations[props.milestoneId]?.loaded === true);
onMounted(() => {
  if (!archivedLoaded.value) void store.loadArchivedIterations(props.projectId, props.milestoneId);
});
// 归档一轮之后已归档列表作废（store 置 loaded=false）：重取一次。
watch(archivedLoaded, (loaded) => {
  const current = store.archivedIterations[props.milestoneId];
  if (!loaded && current !== undefined && !current.loading) {
    void store.loadArchivedIterations(props.projectId, props.milestoneId);
  }
});

/* ── 生命周期入口（MIL-07）：勾选钮 ○/✓ 与名称进详情。弹层挂在里程碑页（PlanningLifecycleLayer）。
 * ⭐ 勾选钮对**所有人**渲染（照原型 `:2680`）：这个图标本身就是完成状态，藏掉它成员 / 观察者就看不到
 *    哪轮已达成；非 manager+ 渲染成 `disabled`，点了也不开弹层、不发请求。
 *    变异锚点：去掉 `:disabled` ⇒ editor / viewer 用例转红。下面这道判定是纵深兜底：只去掉它
 *    测试抓不到（disabled 按钮本身就收不到 click，实测保持绿），⛔ 别把它当成那条用例的载体。 */
function openLifecycle(iteration: ProjectIterationListItem): void {
  if (!canEdit.value) return;
  store.openPlanningLifecycle(
    { kind: 'iteration', milestoneId: props.milestoneId, row: iteration },
    planningLifecycleActionFor(iteration.status),
  );
}
function openDetail(iteration: ProjectIterationListItem): void {
  void store.openPlanningDetail(props.projectId, {
    kind: 'iteration',
    milestoneId: props.milestoneId,
    row: iteration,
  });
}

/* ── 工具条交互（都薄转发给 store 的按目标视图态）───────────────────────────── */

function onSearch(event: Event): void {
  store.setIterationView(props.milestoneId, { query: (event.target as HTMLInputElement).value });
}
function onShowDone(event: Event): void {
  store.setIterationView(props.milestoneId, {
    showDone: (event.target as HTMLInputElement).checked,
  });
}
function onFilter(event: Event): void {
  const value = (event.target as HTMLSelectElement)
    .value as (typeof ITERATION_FILTER_OPTIONS)[number]['value'];
  store.setIterationView(props.milestoneId, { filter: value });
}
function onSort(field: 'priority' | 'due_at'): void {
  store.toggleIterationSort(props.milestoneId, field);
}

/* ── 行内编辑：负责人 / 优先级 / 日期（乐观锁三态；取消不留痕，409 保留输入）──────
 *
 * ⭐ 编辑态是**组件局部**（`editing`/`editValue`）：切目标会卸载本组件实例、局部态随之清空，
 *    而按目标各存一份的是 store 里的筛选/草稿（判据「切目标不串数据」的载体在那边）。
 * ⚠️ `clientRequestId` 在一次编辑会话内**保持不变**（重试同一逻辑请求用同一幂等键）；
 *    保存成功或取消后清空，下次编辑再生成新的。 */
interface EditingCell {
  readonly iterationId: string;
  readonly field: IterationEditableField;
}
const editing = ref<EditingCell | null>(null);
const editValue = ref<string>('');
const editRequestId = ref<string>('');
const editSaving = ref(false);

function isEditing(iterationId: string, field: IterationEditableField): boolean {
  return editing.value?.iterationId === iterationId && editing.value.field === field;
}

function startEdit(iteration: ProjectIterationListItem, field: IterationEditableField): void {
  // 已达成的轮次不改（改派/改期/改优先级都属结构动作，且达成后不再排期）。
  if (!canEdit.value || iteration.status !== 'open' || editSaving.value) return;
  editing.value = { iterationId: iteration.id, field };
  editRequestId.value = crypto.randomUUID();
  if (field === 'priority') editValue.value = iteration.priority;
  else if (field === 'ownerSubject') editValue.value = iteration.ownerSubject ?? '';
  else editValue.value = iteration.dueAt ? iteration.dueAt.slice(0, 10) : '';
}

function cancelEdit(): void {
  // 取消不留痕：直接丢弃局部编辑态，⛔ 不回写任何东西。
  editing.value = null;
  editValue.value = '';
  editRequestId.value = '';
}

async function commitEdit(): Promise<void> {
  const cell = editing.value;
  if (!cell || editSaving.value) return;
  // 期望版本每次从最新行读（409 就地重取后，下一次带的是刷新后的版本）。
  const row = rows.value.find((item) => item.id === cell.iterationId);
  if (!row) {
    cancelEdit();
    return;
  }
  const value =
    cell.field === 'ownerSubject' || cell.field === 'dueAt'
      ? editValue.value || null
      : editValue.value;
  editSaving.value = true;
  try {
    const outcome = await store.saveIterationField({
      projectId: props.projectId,
      milestoneId: props.milestoneId,
      iterationId: cell.iterationId,
      field: cell.field,
      value,
      expectedVersion: row.version,
      clientRequestId: editRequestId.value,
    });
    // ok ⇒ 关闭；conflict/error ⇒ 保留编辑态（⛔ 不吞用户输入，让其在新版本上重下决定）。
    // MIL-06：日期已直接落盘 ⇒ 这一轮不再是排期草案（原型 `saveInlineStage28` 同步删草案条目）。
    if (outcome === 'ok' && cell.field === 'dueAt') {
      store.dropIterationScheduleEntry(props.milestoneId, cell.iterationId);
    }
    if (outcome === 'ok') cancelEdit();
  } finally {
    editSaving.value = false;
  }
}

/* ── 快速添加草稿（草稿在 store 的按目标视图态里；409/失败保留草稿）─────────────── */
const quickRequestId = ref<string>('');
const quickSaving = ref(false);

function openQuickAdd(): void {
  if (!canEdit.value) return;
  store.setIterationQuickAddOpen(props.milestoneId, true);
  quickRequestId.value = crypto.randomUUID();
}
function cancelQuickAdd(): void {
  // 主动取消 ⇒ store 收起并清空草稿。
  store.setIterationQuickAddOpen(props.milestoneId, false);
  quickRequestId.value = '';
}
function onQuickField(field: 'name' | 'dueAt' | 'criteriaMd', event: Event): void {
  store.setIterationQuickDraft(props.milestoneId, {
    [field]: (event.target as HTMLInputElement).value,
  });
}
async function commitQuickAdd(): Promise<void> {
  if (quickSaving.value) return;
  // 名称是服务端 `authoredName` 的硬约束（min 1）：空名先在客户端挡，别白跑一趟 422。
  if (!view.value.quickDraft.name.trim()) return;
  if (!quickRequestId.value) quickRequestId.value = crypto.randomUUID();
  quickSaving.value = true;
  try {
    // ok ⇒ store 清草稿并收起；conflict/error ⇒ store 保留草稿（判据「409 保留草稿」）。
    await store.saveQuickIteration({
      projectId: props.projectId,
      milestoneId: props.milestoneId,
      clientRequestId: quickRequestId.value,
    });
  } finally {
    quickSaving.value = false;
  }
}

const PRIORITY_OPTIONS: ReadonlyArray<{
  value: ProjectIterationListItem['priority'];
  label: string;
}> = [
  { value: 'high', label: TODO_PRIORITY_LABELS.high },
  { value: 'medium', label: TODO_PRIORITY_LABELS.medium },
  { value: 'low', label: TODO_PRIORITY_LABELS.low },
];
</script>

<template>
  <section class="iteration-plan" :data-testid="`iteration-plan-${milestoneId}`">
    <!-- 单目标迭代取数：加载 / 错误（无行时）优先，其余进列表视图。 -->
    <div v-if="iterationsLoading && rows.length === 0" class="iteration-plan__status" role="status">
      正在加载迭代…
    </div>
    <div
      v-else-if="iterationsError && rows.length === 0"
      class="iteration-plan__error"
      role="alert"
      :data-testid="`milestone-iterations-error-${milestoneId}`"
    >
      <span>{{ iterationsError?.message }}</span>
      <ReferenceIdCopy
        v-if="iterationsError?.referenceCode"
        :reference-id="iterationsError.referenceCode"
      />
      <button class="btn btn--secondary" type="button" @click="retryIterations">重试</button>
    </div>

    <template v-else>
      <!-- 工具条：搜索 / 显示已完成 / 筛选下拉 / 汇总（去重）/ 添加。 -->
      <div class="iteration-plan__toolbar">
        <input
          class="iteration-plan__search"
          type="search"
          aria-label="搜索迭代计划名称或标准"
          placeholder="搜索迭代计划名称或标准"
          :value="view.query"
          :data-testid="`iteration-search-${milestoneId}`"
          @input="onSearch"
        />
        <label class="iteration-plan__showDone">
          <input
            type="checkbox"
            :checked="view.showDone"
            :data-testid="`iteration-show-done-${milestoneId}`"
            @change="onShowDone"
          />
          显示已完成
        </label>
        <select
          class="iteration-plan__filter"
          aria-label="筛选迭代计划"
          :value="view.filter"
          :data-testid="`iteration-filter-${milestoneId}`"
          @change="onFilter"
        >
          <option
            v-for="option in ITERATION_FILTER_OPTIONS"
            :key="option.value"
            :value="option.value"
          >
            {{ option.label }}
          </option>
        </select>
        <span class="iteration-plan__grow"></span>
        <!-- MIL-06：看板 / 列表 / 甘特图切换（先写偏好、写成功才切）。 -->
        <IterationPlanViewSwitch
          :milestone-id="milestoneId"
          :model-value="view.view"
          @select="onSelectView"
        />
        <!-- ⭐ 判据 3 载体：去重后的真实条数（⛔ 不是三组行数相加）。 -->
        <span
          class="iteration-plan__count"
          :data-testid="`iteration-distinct-count-${milestoneId}`"
          :data-count="distinctCount"
        >
          共 <b class="tnum">{{ distinctCount }}</b> 条迭代
        </span>
        <button
          v-if="canEdit"
          class="btn btn--primary"
          type="button"
          :data-testid="`iteration-add-${milestoneId}`"
          @click="openAddIteration"
        >
          ＋ 添加迭代计划
        </button>
      </div>

      <!-- 快速添加草稿行（⛔ 409/失败不清草稿）。 -->
      <div
        v-if="canEdit && view.quickAddOpen"
        class="iteration-plan__quick"
        :data-testid="`iteration-quick-form-${milestoneId}`"
      >
        <input
          class="iteration-plan__quickField"
          aria-label="新迭代计划名称"
          placeholder="迭代计划名称"
          :value="view.quickDraft.name"
          :data-testid="`iteration-quick-name-${milestoneId}`"
          @input="onQuickField('name', $event)"
        />
        <input
          class="iteration-plan__quickField"
          type="date"
          aria-label="新迭代计划到期时间"
          :value="view.quickDraft.dueAt"
          :data-testid="`iteration-quick-due-${milestoneId}`"
          @input="onQuickField('dueAt', $event)"
        />
        <input
          class="iteration-plan__quickField"
          aria-label="新迭代计划达成标准"
          placeholder="达成标准"
          :value="view.quickDraft.criteriaMd"
          :data-testid="`iteration-quick-criteria-${milestoneId}`"
          @input="onQuickField('criteriaMd', $event)"
        />
        <button
          class="btn btn--primary"
          type="button"
          :disabled="quickSaving || !view.quickDraft.name.trim()"
          :data-testid="`iteration-quick-save-${milestoneId}`"
          @click="commitQuickAdd"
        >
          添加
        </button>
        <button
          class="btn btn--ghost"
          type="button"
          :data-testid="`iteration-quick-cancel-${milestoneId}`"
          @click="cancelQuickAdd"
        >
          取消
        </button>
      </div>

      <!-- 动作回执（乐观锁冲突 / 失败）：常驻，⛔ 不走 toast（与看板同一套）。 -->
      <p
        v-if="store.iterationActionNotice"
        class="iteration-plan__notice"
        role="status"
        :data-testid="`iteration-action-notice-${milestoneId}`"
      >
        <span>{{ store.iterationActionNotice?.message }}</span>
        <ReferenceIdCopy
          v-if="store.iterationActionNotice?.referenceCode"
          :reference-id="store.iterationActionNotice.referenceCode"
        />
      </p>

      <!-- MIL-06：排期草案横幅（三视图共用）+ 本目标的排期回执。 -->
      <IterationScheduleBanner
        :milestone-id="milestoneId"
        :count="draftCount"
        :saving="store.iterationScheduleSaving[milestoneId] === true"
        :can-plan="canEdit"
        :notice="store.iterationScheduleNotices[milestoneId] ?? null"
        @cancel="onCancelSchedule"
        @save="onSaveSchedule"
      />

      <MilestoneIterationBoard
        v-if="view.view === 'board'"
        :project-id="projectId"
        :milestone-id="milestoneId"
        :rows="scheduleRows"
        :draft="draft"
        :period="period"
        :today="today"
      />
      <MilestoneIterationGantt
        v-else-if="view.view === 'gantt'"
        :project-id="projectId"
        :milestone-id="milestoneId"
        :rows="scheduleRows"
        :base-rows="rows"
        :draft="draft"
        :period="period"
        :today="today"
      />
      <div
        v-else
        class="iteration-plan__scroll"
        :data-testid="`milestone-iterations-${milestoneId}`"
      >
        <table class="iteration-plan__table">
          <thead>
            <tr>
              <th scope="col">迭代计划名称</th>
              <th scope="col">关联需求</th>
              <th scope="col">
                <button
                  class="iteration-plan__sort"
                  type="button"
                  :data-testid="`iteration-sort-priority-${milestoneId}`"
                  @click="onSort('priority')"
                >
                  优先级 {{ sortArrow('priority') }}
                </button>
              </th>
              <th scope="col">负责人</th>
              <th scope="col">
                <button
                  class="iteration-plan__sort"
                  type="button"
                  :data-testid="`iteration-sort-due-${milestoneId}`"
                  @click="onSort('due_at')"
                >
                  到期时间 {{ sortArrow('due_at') }}
                </button>
              </th>
            </tr>
          </thead>
          <tbody v-for="group in groups" :key="group.key">
            <tr class="iteration-plan__groupHead">
              <td colspan="5">
                <span :data-testid="`iteration-group-${group.key}-${milestoneId}`">{{
                  group.label
                }}</span>
                <small
                  :data-testid="`iteration-group-count-${group.key}-${milestoneId}`"
                  :data-count="group.rows.length"
                >
                  ({{ group.rows.length }})
                </small>
              </td>
            </tr>
            <template v-if="groupExpanded(group.key)">
              <tr
                v-for="iteration in group.rows"
                :key="`${group.key}:${iteration.id}`"
                class="iteration-plan__row"
                :data-iteration-row="iteration.id"
                :data-group="group.key"
              >
                <td>
                  <button
                    class="iteration-plan__check"
                    type="button"
                    :disabled="!canEdit"
                    :data-status="iteration.status"
                    :aria-label="
                      planningLifecycleEntryLabel(
                        planningLifecycleActionFor(iteration.status),
                        iteration.name,
                      )
                    "
                    :data-testid="`iteration-lifecycle-${iteration.id}`"
                    @click="openLifecycle(iteration)"
                  >
                    {{ iteration.status === 'completed' ? '✓' : '○' }}
                  </button>
                  <button
                    class="iteration-plan__name"
                    type="button"
                    :data-testid="`iteration-detail-${iteration.id}`"
                    @click="openDetail(iteration)"
                  >
                    {{ iteration.name }}
                  </button>
                  <span class="iteration-plan__badge" :data-status="iteration.status">
                    {{ ITERATION_STATUS_LABELS[iteration.status] }}
                  </span>
                </td>
                <td class="iteration-plan__refs">
                  <template v-if="iteration.linkedRequirements.length">
                    <span
                      v-for="requirement in iteration.linkedRequirements"
                      :key="requirement.requirementId"
                      class="iteration-plan__ref"
                      :title="requirement.title"
                    >
                      <code>{{ shortRequirementId(requirement.requirementId) }}</code>
                      {{ requirement.title }}
                    </span>
                    <span v-if="iteration.linkedRequirementsHasMore" class="iteration-plan__refMore"
                      >…</span
                    >
                  </template>
                  <span v-else class="iteration-plan__refEmpty">未关联需求</span>
                </td>

                <!-- 优先级：行内编辑（manager+ 且未达成）。 -->
                <td>
                  <template v-if="isEditing(iteration.id, 'priority')">
                    <select
                      v-model="editValue"
                      :aria-label="`修改 ${iteration.name} 的优先级`"
                      :data-testid="`iteration-edit-input-${iteration.id}`"
                    >
                      <option
                        v-for="option in PRIORITY_OPTIONS"
                        :key="option.value"
                        :value="option.value"
                      >
                        {{ option.label }}
                      </option>
                    </select>
                    <button
                      class="btn btn--primary btn--xs"
                      type="button"
                      :disabled="editSaving"
                      :data-testid="`iteration-edit-save-${iteration.id}`"
                      @click="commitEdit"
                    >
                      保存
                    </button>
                    <button
                      class="btn btn--ghost btn--xs"
                      type="button"
                      :data-testid="`iteration-edit-cancel-${iteration.id}`"
                      @click="cancelEdit"
                    >
                      取消
                    </button>
                  </template>
                  <button
                    v-else
                    class="iteration-plan__cell"
                    type="button"
                    :disabled="!canEdit || iteration.status !== 'open'"
                    :data-testid="`iteration-priority-${iteration.id}`"
                    @click="startEdit(iteration, 'priority')"
                  >
                    {{ TODO_PRIORITY_LABELS[iteration.priority] }}
                  </button>
                </td>

                <!-- 负责人：行内编辑。 -->
                <td>
                  <template v-if="isEditing(iteration.id, 'ownerSubject')">
                    <select
                      v-model="editValue"
                      :aria-label="`修改 ${iteration.name} 的负责人`"
                      :data-testid="`iteration-edit-input-${iteration.id}`"
                    >
                      <option value="">{{ PLANNING_UNASSIGNED_OWNER_LABEL }}</option>
                      <option
                        v-for="member in ownerOptions"
                        :key="member.subject"
                        :value="member.subject"
                      >
                        {{ member.displayName }}
                      </option>
                    </select>
                    <button
                      class="btn btn--primary btn--xs"
                      type="button"
                      :disabled="editSaving"
                      :data-testid="`iteration-edit-save-${iteration.id}`"
                      @click="commitEdit"
                    >
                      保存
                    </button>
                    <button
                      class="btn btn--ghost btn--xs"
                      type="button"
                      :data-testid="`iteration-edit-cancel-${iteration.id}`"
                      @click="cancelEdit"
                    >
                      取消
                    </button>
                  </template>
                  <button
                    v-else
                    class="iteration-plan__cell"
                    type="button"
                    :disabled="!canEdit || iteration.status !== 'open'"
                    :data-testid="`iteration-owner-${iteration.id}`"
                    @click="startEdit(iteration, 'ownerSubject')"
                  >
                    {{ ownerLabel(iteration.ownerSubject) }}
                  </button>
                </td>

                <!-- 日期：行内编辑。 -->
                <td>
                  <template v-if="isEditing(iteration.id, 'dueAt')">
                    <input
                      v-model="editValue"
                      type="date"
                      :aria-label="`修改 ${iteration.name} 的到期时间`"
                      :data-testid="`iteration-edit-input-${iteration.id}`"
                    />
                    <button
                      class="btn btn--primary btn--xs"
                      type="button"
                      :disabled="editSaving"
                      :data-testid="`iteration-edit-save-${iteration.id}`"
                      @click="commitEdit"
                    >
                      保存
                    </button>
                    <button
                      class="btn btn--ghost btn--xs"
                      type="button"
                      :data-testid="`iteration-edit-cancel-${iteration.id}`"
                      @click="cancelEdit"
                    >
                      取消
                    </button>
                  </template>
                  <button
                    v-else
                    class="iteration-plan__cell"
                    type="button"
                    :class="{ 'is-overdue': view.filter !== 'done' }"
                    :disabled="!canEdit || iteration.status !== 'open'"
                    :data-testid="`iteration-due-${iteration.id}`"
                    @click="startEdit(iteration, 'dueAt')"
                  >
                    {{
                      iteration.dueAt
                        ? formatPlanningDate(iteration.dueAt)
                        : PLANNING_UNSCHEDULED_LABEL
                    }}
                  </button>
                </td>
              </tr>
              <tr v-if="group.rows.length === 0" class="iteration-plan__emptyRow">
                <td colspan="5">暂无匹配迭代</td>
              </tr>
            </template>
            <!-- 快速添加入口在「我的迭代计划」组尾（原型定稿层；草稿行本身仍在表格上方）。 -->
            <tr
              v-if="group.key === 'mine' && canEdit && !view.quickAddOpen"
              class="iteration-plan__quickRow"
            >
              <td colspan="5">
                <button
                  class="iteration-plan__quickTrigger"
                  type="button"
                  :data-testid="`iteration-quick-add-${milestoneId}`"
                  @click="openQuickAdd"
                >
                  ＋ 添加迭代计划
                </button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <!-- MIL-09：已归档迭代计划（只读、可展开读阶段记录；所有身份可见）。 -->
      <ArchivedPlanningSection
        :project-id="projectId"
        kind="iteration"
        :milestone-id="milestoneId"
      />
    </template>
  </section>
</template>

<style scoped>
.iteration-plan {
  display: flex;
  flex-direction: column;
  gap: var(--px-10);
  margin-top: var(--px-12);
}
.iteration-plan__toolbar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--px-8);
}
.iteration-plan__search {
  /* 搜索框宽度是一处一次性尺寸，不是设计 token（guard-tokens D2.1：真尺寸走裸值）。 */
  flex: 0 1 240px;
  min-width: 160px;
  padding: var(--px-6) var(--px-10);
  border: var(--bw) solid var(--line);
  border-radius: var(--r-sm);
  color: var(--ink);
  background: var(--bg);
  font: inherit;
  font-size: var(--fs-200);
}
.iteration-plan__showDone {
  display: inline-flex;
  align-items: center;
  gap: var(--px-4);
  color: var(--muted2);
  font-size: var(--fs-200);
}
.iteration-plan__filter {
  padding: var(--px-6) var(--px-8);
  border: var(--bw) solid var(--line);
  border-radius: var(--r-sm);
  color: var(--ink);
  background: var(--bg);
  font: inherit;
  font-size: var(--fs-200);
}
.iteration-plan__grow {
  flex: 1 1 auto;
}
.iteration-plan__count {
  color: var(--muted2);
  font-size: var(--fs-200);
}
.iteration-plan__count b {
  color: var(--ink);
}
.iteration-plan__quick {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--px-8);
  padding: var(--px-8) var(--px-10);
  border: var(--bw) dashed var(--accent-line);
  border-radius: var(--r-sm);
  background: var(--sunken);
}
.iteration-plan__quickField {
  padding: var(--px-6) var(--px-8);
  border: var(--bw) solid var(--line);
  border-radius: var(--r-sm);
  color: var(--ink);
  background: var(--bg);
  font: inherit;
  font-size: var(--fs-200);
}
.iteration-plan__notice {
  margin: 0;
  display: flex;
  align-items: center;
  gap: var(--px-8);
  padding: var(--px-6) var(--px-10);
  border: var(--bw) solid var(--accent-line);
  border-radius: var(--r-sm);
  color: var(--muted);
  background: var(--sunken);
  font-size: var(--fs-200);
}
.iteration-plan__scroll {
  overflow-x: auto;
}
.iteration-plan__table {
  width: 100%;
  border-collapse: collapse;
  font-size: var(--fs-200);
}
.iteration-plan__table th {
  padding: var(--px-6) var(--px-8);
  color: var(--muted2);
  font-weight: var(--fw-label);
  text-align: left;
}
.iteration-plan__table td {
  padding: var(--px-6) var(--px-8);
  border-top: var(--bw) solid var(--line);
  color: var(--ink);
  vertical-align: top;
}
.iteration-plan__sort {
  border: 0;
  color: var(--muted2);
  background: transparent;
  font: inherit;
  font-weight: var(--fw-label);
  cursor: pointer;
}
.iteration-plan__sort:hover {
  color: var(--ink);
}
.iteration-plan__groupHead td {
  padding: var(--px-8);
  color: var(--muted);
  background: var(--sunken);
  font-weight: var(--fw-title);
}
.iteration-plan__groupHead small {
  margin-left: var(--px-4);
  color: var(--muted2);
  font-weight: var(--fw-body);
}
.iteration-plan__name {
  padding: 0;
  border: 0;
  color: var(--ink);
  background: transparent;
  font: inherit;
  font-weight: var(--fw-label);
  text-align: left;
  cursor: pointer;
}
.iteration-plan__name:hover {
  color: var(--accent-text);
}
/* 记录达成 / 重新打开的勾选钮（原型 `stage-check28`）：○ 进行中、✓ 已达成。 */
.iteration-plan__check {
  display: inline-grid;
  width: var(--ctl-h-sm);
  height: var(--ctl-h-sm);
  margin-right: var(--px-6);
  place-items: center;
  padding: 0;
  border: var(--bw) solid var(--line);
  border-radius: var(--r-pill);
  color: var(--muted2);
  background: var(--bg);
  font: inherit;
  cursor: pointer;
}
.iteration-plan__check[data-status='completed'] {
  border-color: var(--ok-text);
  color: var(--ok-text);
  background: var(--ok-soft);
}
.iteration-plan__check:hover:not(:disabled) {
  border-color: var(--accent-line);
}
.iteration-plan__check:disabled {
  cursor: default;
}
.iteration-plan__badge {
  margin-left: var(--px-6);
  padding: var(--px-1) var(--px-8);
  border-radius: var(--r-pill);
  color: var(--muted2);
  background: var(--sunken);
  font-size: var(--fs-px-10p5);
}
.iteration-plan__badge[data-status='completed'] {
  color: var(--ok-text);
  background: var(--ok-soft);
}
.iteration-plan__refs {
  display: flex;
  flex-wrap: wrap;
  gap: var(--px-4);
}
.iteration-plan__ref {
  display: inline-flex;
  align-items: center;
  gap: var(--px-4);
  max-width: 100%;
  padding: var(--px-2) var(--px-8);
  border: var(--bw) solid var(--line);
  border-radius: var(--r-sm);
  color: var(--muted);
  background: var(--panel);
  font-size: var(--fs-100);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.iteration-plan__ref code {
  color: var(--accent-text);
}
.iteration-plan__refMore,
.iteration-plan__refEmpty {
  color: var(--muted2);
  font-size: var(--fs-100);
}
.iteration-plan__cell {
  padding: var(--px-2) var(--px-6);
  border: var(--bw) solid transparent;
  border-radius: var(--r-sm);
  color: var(--ink);
  background: transparent;
  font: inherit;
  font-size: var(--fs-200);
  text-align: left;
  cursor: pointer;
}
.iteration-plan__cell:hover:not(:disabled) {
  border-color: var(--line);
  background: var(--sunken);
}
.iteration-plan__cell:disabled {
  color: var(--muted2);
  cursor: default;
}
.iteration-plan__emptyRow td {
  color: var(--muted2);
  text-align: center;
}
.iteration-plan__quickTrigger {
  padding: var(--px-4) 0;
  border: 0;
  color: var(--accent-text);
  background: transparent;
  font: inherit;
  font-size: var(--fs-200);
  cursor: pointer;
}
.iteration-plan__quickTrigger:focus-visible {
  outline: none;
  box-shadow: var(--focus-ring-flat);
}
.iteration-plan__status,
.iteration-plan__error {
  margin-top: var(--px-12);
  font-size: var(--fs-meta);
}
.iteration-plan__status {
  color: var(--muted2);
}
.iteration-plan__error {
  display: flex;
  align-items: center;
  gap: var(--px-8);
  padding: var(--px-8) var(--px-10);
  border: var(--bw) solid var(--danger-line);
  border-radius: var(--r-sm);
  color: var(--danger-text);
  background: var(--danger-soft);
}
</style>
