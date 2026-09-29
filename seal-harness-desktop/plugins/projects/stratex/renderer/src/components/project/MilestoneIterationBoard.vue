<script setup lang="ts">
import { computed, nextTick, ref } from 'vue';

import type { ProjectIterationListItem } from '@shared/protocol/project-planning.js';
import { planningLifecycleActionFor } from '@shared/protocol/project-planning-lifecycle.js';

import { TODO_PRIORITY_LABELS } from './project-format';
import { isIterationOverdue } from './iteration-list-view';
import {
  adjacentMonthKey,
  boardColumnKey,
  boardDropDueKey,
  BOARD_UNSCHEDULED_KEY,
  buildBoardColumns,
  type IterationScheduleDraft,
  type MilestonePeriod,
} from './iteration-schedule-view';
import { PLANNING_LIFECYCLE_COPY, planningLifecycleEntryLabel } from './planning-lifecycle-view';
import {
  formatPlanningDate,
  ITERATION_STATUS_LABELS,
  PLANNING_UNASSIGNED_OWNER_LABEL,
  shortRequirementId,
} from './project-planning-view';
import { scheduleDayKey } from './schedule-layout';
import { useProjectCollabStore } from '../../stores/projectCollab';

/**
 * 迭代计划**看板**（MIL-06，原型 `board28` / `wireBoard28`，`:2682`–`:2683`、`:2701`）：按到期月分列。
 *
 * ⭐ 行来自父级算好的**共用查询结果**（关键字 / 筛选 / 排序 + 草案叠加，与列表、甘特同一份），
 *    本组件只按月切列，⛔ 不另起一份筛选或排序。
 * ⭐ 拖卡到某月 / 键盘 ←→ 挪月 **只改本地排期草案**（`store.queueIterationSchedule`，⛔ 不发请求）；
 *    横幅上的「保存排期」才落盘。
 * ⚠️ 拖拽是**附加**手势：卡片获得焦点后 ←/→ 把它挪到上 / 下一个月列（键盘可达的那条路）。
 * ⚠️ 已达成的卡片不可拖；拖进「未安排」拒绝并提示「需要保留计划日期，可点击日期重新安排。」
 * ⭐ MIL-07：卡片标题点开「迭代计划详情」（含阶段记录，viewer 也能读）；「记录达成 / 重新打开」
 *    打开生命周期弹层。弹层与详情都挂在里程碑页（PlanningLifecycleLayer），本组件只转发给 store。
 */

const props = defineProps<{
  projectId: string;
  milestoneId: string;
  rows: readonly ProjectIterationListItem[];
  draft: IterationScheduleDraft;
  period: MilestonePeriod;
  today: string;
}>();

const store = useProjectCollabStore();
const canPlan = computed(() => store.canManagePlanning);

const columns = computed(() => buildBoardColumns(props.rows, props.period));

const memberNames = computed(() => {
  const map = new Map<string, string>();
  for (const member of store.detail?.members ?? []) map.set(member.subject, member.displayName);
  return map;
});
function ownerLabel(subject: string | null): string {
  if (!subject) return PLANNING_UNASSIGNED_OWNER_LABEL;
  return memberNames.value.get(subject) || subject;
}

function statusLabel(row: ProjectIterationListItem): string {
  if (row.status === 'open' && isIterationOverdue(row, props.today)) return '已逾期';
  return ITERATION_STATUS_LABELS[row.status];
}

function canMove(row: ProjectIterationListItem): boolean {
  return canPlan.value && row.status === 'open';
}

/* ── 生命周期入口（MIL-07，原型 `board28` `:2683`）──────────────────────────── */

/** 卡片标题：点开迭代计划详情（原型 `stage-detail28`）。读动作，不看角色。 */
function openDetail(row: ProjectIterationListItem): void {
  void store.openPlanningDetail(props.projectId, {
    kind: 'iteration',
    milestoneId: props.milestoneId,
    row,
  });
}

/**
 * 「记录达成 / 重新打开」：照原型 `canPlan27()?mButton28(…):''` **只对 manager+ 渲染**。
 * ⚠️ 与列表的 ○/✓ 不同：那个图标本身就是完成状态，所以对非管理者禁用显示；卡片左上的状态标签
 *    已经表达了达成与否，这里只是动作入口，非管理者不摆。真正的门在服务端；下面这道判定是纵深兜底。
 */
function openLifecycle(row: ProjectIterationListItem): void {
  if (!canPlan.value) return;
  store.openPlanningLifecycle(
    { kind: 'iteration', milestoneId: props.milestoneId, row },
    planningLifecycleActionFor(row.status),
  );
}

/* ── 展开关联与标准（卡片内，按卡片 id 记，切视图/重渲染不丢）──────────────── */
const expanded = ref<ReadonlySet<string>>(new Set());
function toggleExpanded(id: string): void {
  const next = new Set(expanded.value);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  expanded.value = next;
}

/* ── 拖拽（HTML5 DnD，原型 `wireBoard28`）────────────────────────────────── */
const draggingId = ref<string | null>(null);
const dropTarget = ref<string | null>(null);

function onDragStart(row: ProjectIterationListItem, event: DragEvent): void {
  if (!canMove(row)) {
    event.preventDefault();
    return;
  }
  draggingId.value = row.id;
  if (event.dataTransfer) {
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', row.id);
  }
}
function onDragEnd(): void {
  draggingId.value = null;
  dropTarget.value = null;
}
function onDragOver(columnKey: string, event: DragEvent): void {
  if (draggingId.value === null || !canPlan.value) return;
  event.preventDefault();
  if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
  dropTarget.value = columnKey;
}
function onDragLeave(columnKey: string): void {
  if (dropTarget.value === columnKey) dropTarget.value = null;
}

/** 把一张卡片挪到某一列：月份列 ⇒ 入草案；「未安排」⇒ 拒绝并提示。 */
function moveToColumn(iterationId: string, columnKey: string): boolean {
  const row = props.rows.find((item) => item.id === iterationId);
  if (!row || !canMove(row)) return false;
  if (columnKey === BOARD_UNSCHEDULED_KEY) {
    store.rejectIterationScheduleUnscheduledDrop(props.milestoneId);
    return false;
  }
  const dueAt = boardDropDueKey(columnKey, scheduleDayKey(row.dueAt), props.period);
  return store.queueIterationSchedule(props.milestoneId, iterationId, dueAt);
}

function onDrop(columnKey: string, event: DragEvent): void {
  event.preventDefault();
  const carried = draggingId.value ?? event.dataTransfer?.getData('text/plain') ?? '';
  onDragEnd();
  if (carried === '') return;
  moveToColumn(carried, columnKey);
}

/** 键盘：←/→ 挪到上 / 下一个月列；挪完焦点跟着卡片走（DOM 会换列重建）。 */
async function onCardKeydown(row: ProjectIterationListItem, event: KeyboardEvent): Promise<void> {
  if (event.target !== event.currentTarget) return;
  if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
  event.preventDefault();
  const current = boardColumnKey(row);
  if (current === BOARD_UNSCHEDULED_KEY || !canMove(row)) return;
  moveToColumn(row.id, adjacentMonthKey(current, event.key === 'ArrowLeft' ? -1 : 1));
  await nextTick();
  document
    .querySelector<HTMLElement>(`[data-board-card="${CSS.escape(row.id)}"]`)
    ?.focus({ preventScroll: true });
}
</script>

<template>
  <div class="plan-board" :data-testid="`iteration-board-${milestoneId}`">
    <p v-if="columns.length === 0" class="plan-board__empty" role="status">暂无匹配节点。</p>
    <section
      v-for="column in columns"
      :key="column.key"
      class="plan-board__column"
      :class="{ 'is-drop-target': dropTarget === column.key }"
      :data-board-column="column.key"
      :aria-label="`${column.label}（${column.rows.length}）`"
      @dragover="onDragOver(column.key, $event)"
      @dragleave="onDragLeave(column.key)"
      @drop="onDrop(column.key, $event)"
    >
      <header class="plan-board__head">
        <b>{{ column.label }}</b>
        <small class="tnum" :data-board-count="column.key">{{ column.rows.length }}</small>
      </header>
      <article
        v-for="row in column.rows"
        :key="row.id"
        class="plan-board__card"
        :class="{
          'is-draft': draft[row.id] !== undefined,
          'is-dragging': draggingId === row.id,
          'is-completed': row.status === 'completed',
        }"
        :data-board-card="row.id"
        :draggable="canMove(row)"
        :tabindex="canMove(row) ? 0 : -1"
        :aria-label="`${row.name}，${formatPlanningDate(row.dueAt)}${canMove(row) ? '，左右方向键移到上或下一个月' : ''}`"
        @dragstart="onDragStart(row, $event)"
        @dragend="onDragEnd"
        @keydown="onCardKeydown(row, $event)"
      >
        <div class="plan-board__cardHead">
          <span class="plan-board__status" :data-status="row.status">{{ statusLabel(row) }}</span>
          <span v-if="draft[row.id] !== undefined" class="plan-board__draftTag">未保存</span>
          <span class="plan-board__grow"></span>
          <span class="plan-board__priority">{{ TODO_PRIORITY_LABELS[row.priority] }}</span>
        </div>
        <button
          class="plan-board__title"
          type="button"
          :data-testid="`iteration-board-detail-${row.id}`"
          @click="openDetail(row)"
        >
          {{ row.name }}
        </button>
        <p class="plan-board__meta">
          {{ ownerLabel(row.ownerSubject) }} ·
          <span class="tnum">{{ formatPlanningDate(row.dueAt) }}</span>
        </p>
        <div class="plan-board__actions">
          <button
            class="plan-board__toggle"
            type="button"
            :aria-expanded="expanded.has(row.id)"
            :data-testid="`iteration-board-expand-${row.id}`"
            @click="toggleExpanded(row.id)"
          >
            {{ expanded.has(row.id) ? '收起关联与标准' : '查看关联与标准' }}
          </button>
          <button
            v-if="canPlan"
            class="plan-board__toggle"
            type="button"
            :aria-label="
              planningLifecycleEntryLabel(planningLifecycleActionFor(row.status), row.name)
            "
            :data-action="planningLifecycleActionFor(row.status)"
            :data-testid="`iteration-board-lifecycle-${row.id}`"
            @click="openLifecycle(row)"
          >
            {{ PLANNING_LIFECYCLE_COPY[planningLifecycleActionFor(row.status)].entry }}
          </button>
        </div>
        <div v-if="expanded.has(row.id)" class="plan-board__children">
          <p><b>达成标准</b> {{ row.criteriaMd || '待补充' }}</p>
          <p v-if="row.linkedRequirements.length === 0" class="plan-board__muted">暂无关联需求</p>
          <p v-for="requirement in row.linkedRequirements" :key="requirement.requirementId">
            <code>{{ shortRequirementId(requirement.requirementId) }}</code>
            {{ requirement.title }}
          </p>
        </div>
      </article>
    </section>
  </div>
</template>

<style scoped>
.plan-board {
  display: flex;
  gap: var(--px-10);
  padding-bottom: var(--px-6);
  overflow-x: auto;
}
.plan-board__empty {
  margin: 0;
  color: var(--muted2);
  font-size: var(--fs-200);
}
.plan-board__column {
  display: flex;
  flex: 0 0 220px;
  flex-direction: column;
  gap: var(--px-8);
  min-height: 120px;
  padding: var(--px-8);
  border: var(--bw) dashed transparent;
  border-radius: var(--r-md);
  background: var(--sunken);
  transition: border-color var(--dur-1) var(--ease-out);
}
.plan-board__column.is-drop-target {
  border-color: var(--accent-line);
  background: var(--accent-soft);
}
.plan-board__head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  color: var(--ink);
  font-size: var(--fs-200);
}
.plan-board__head small {
  color: var(--muted2);
}
.plan-board__card {
  display: flex;
  flex-direction: column;
  gap: var(--px-4);
  padding: var(--px-8) var(--px-10);
  border: var(--bw) solid var(--line);
  border-radius: var(--r-sm);
  background: var(--panel);
  cursor: grab;
  transition:
    box-shadow var(--dur-1) var(--ease-out),
    opacity var(--dur-1) var(--ease-out);
}
.plan-board__card:hover {
  box-shadow: var(--sh-1);
}
.plan-board__card:focus-visible {
  outline: none;
  box-shadow: var(--focus-ring-flat);
}
.plan-board__card.is-draft {
  border-color: var(--accent-line);
  border-style: dashed;
}
.plan-board__card.is-dragging {
  opacity: 0.55;
}
.plan-board__card.is-completed {
  cursor: default;
  opacity: 0.8;
}
.plan-board__cardHead {
  display: flex;
  align-items: center;
  gap: var(--px-6);
  font-size: var(--fs-100);
}
.plan-board__grow {
  flex: 1 1 auto;
}
.plan-board__status {
  padding: var(--px-1) var(--px-6);
  border-radius: var(--r-pill);
  color: var(--muted2);
  background: var(--sunken);
}
.plan-board__status[data-status='completed'] {
  color: var(--ok-text);
  background: var(--ok-soft);
}
.plan-board__draftTag {
  color: var(--accent-text);
}
.plan-board__priority {
  color: var(--muted2);
}
/* 卡片标题是「查看详情」按钮（原型 `stage-card-title28`）：去掉按钮外观，保留标题字重。 */
.plan-board__title {
  align-self: flex-start;
  margin: 0;
  padding: 0;
  border: 0;
  color: var(--ink);
  background: transparent;
  font: inherit;
  font-size: var(--fs-200);
  font-weight: var(--fw-label);
  text-align: left;
  overflow-wrap: anywhere;
  cursor: pointer;
}
.plan-board__title:hover {
  color: var(--accent-text);
}
.plan-board__title:focus-visible {
  outline: none;
  box-shadow: var(--focus-ring-flat);
}
.plan-board__actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--px-10);
}
.plan-board__meta {
  margin: 0;
  color: var(--muted2);
  font-size: var(--fs-100);
}
.plan-board__toggle {
  align-self: flex-start;
  padding: 0;
  border: 0;
  color: var(--accent-text);
  background: transparent;
  font: inherit;
  font-size: var(--fs-100);
  cursor: pointer;
}
.plan-board__toggle:focus-visible {
  outline: none;
  box-shadow: var(--focus-ring-flat);
}
.plan-board__children {
  display: flex;
  flex-direction: column;
  gap: var(--px-2);
  color: var(--muted);
  font-size: var(--fs-100);
}
.plan-board__children p {
  margin: 0;
  overflow-wrap: anywhere;
}
.plan-board__children code {
  color: var(--accent-text);
}
.plan-board__muted {
  color: var(--muted2);
}
</style>
