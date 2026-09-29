<script setup lang="ts">
import { computed, nextTick, ref } from 'vue';

import type { ProjectIterationListItem } from '@shared/protocol/project-planning.js';

import {
  GANTT_CAPTION,
  ganttBounds,
  ganttDragDueKey,
  ganttKeyboardDueKey,
  ganttNodeLeftStyle,
  ganttNodePercent,
  ganttTicks,
  isWithinPeriod,
  type IterationScheduleDraft,
  type MilestonePeriod,
} from './iteration-schedule-view';
import { formatDayKeyShort, scheduleDayKey } from './schedule-layout';
import { useProjectCollabStore } from '../../stores/projectCollab';

/**
 * 迭代计划**甘特图**（MIL-06，原型 `ganttBounds28` / `gantt28` / `wireGantt28`，`:2686`、`:2688`、`:2700`）。
 *
 * ⭐ **只有到期点**：每一轮只画一个 ◆ 节点，⛔ 不画持续条、不派生开始日——排期从来不表达持续时间。
 * ⭐ 行来自父级的**共用查询结果**（与列表、看板同一份，草案已叠加）；时间范围取全部轮次的**原始**
 *    日期（拖动时范围不跟着抖）。
 * ⭐ 指针拖动 / ←→ 逐日 **只改本地排期草案**（`store.queueIterationSchedule`，⛔ 不发请求）；
 *    方向键调完焦点留在该节点。已达成的节点禁用。
 * ⚠️ 无日期的轮次显示「设置日期」：那是一次**直接保存**的行内编辑（与列表的日期格同一条改单出口），
 *    不是拖动，所以不走草案（原型 `stage-date28` 同样直接保存）。
 * ⭐ MIL-07：行首名称点开「迭代计划详情」（原型 `gantt28` 行首 `stage-detail28`，含阶段记录，
 *    viewer 也能读）；详情挂在里程碑页（PlanningLifecycleLayer）。甘特行上**没有**达成入口（原型同）。
 */

const props = defineProps<{
  projectId: string;
  milestoneId: string;
  rows: readonly ProjectIterationListItem[];
  baseRows: readonly ProjectIterationListItem[];
  draft: IterationScheduleDraft;
  period: MilestonePeriod;
  today: string;
}>();

const store = useProjectCollabStore();
const canPlan = computed(() => store.canManagePlanning);

const bounds = computed(() => ganttBounds(props.baseRows, props.period, props.today));
const ticks = computed(() => ganttTicks(bounds.value));

function isLocked(row: ProjectIterationListItem): boolean {
  return !canPlan.value || row.status !== 'open';
}

/** 行首名称：点开迭代计划详情（读动作，不看角色）。 */
function openDetail(row: ProjectIterationListItem): void {
  void store.openPlanningDetail(props.projectId, {
    kind: 'iteration',
    milestoneId: props.milestoneId,
    row,
  });
}

/* ── 指针拖动：按像素换算天数并钳在范围内 ───────────────────────────────── */
interface GanttDrag {
  readonly iterationId: string;
  readonly pointerId: number;
  readonly originX: number;
  readonly initialKey: string;
  readonly previewKey: string;
}
const drag = ref<GanttDrag | null>(null);

function nodeKey(row: ProjectIterationListItem): string | null {
  if (drag.value?.iterationId === row.id) return drag.value.previewKey;
  return scheduleDayKey(row.dueAt);
}

function onPointerDown(row: ProjectIterationListItem, event: PointerEvent): void {
  const initialKey = scheduleDayKey(row.dueAt);
  if (event.button !== 0 || isLocked(row) || initialKey === null) return;
  event.preventDefault();
  (event.currentTarget as HTMLElement | null)?.setPointerCapture?.(event.pointerId);
  drag.value = {
    iterationId: row.id,
    pointerId: event.pointerId,
    originX: event.clientX,
    initialKey,
    previewKey: initialKey,
  };
}

function onPointerMove(event: PointerEvent): void {
  const state = drag.value;
  if (state === null || state.pointerId !== event.pointerId) return;
  drag.value = {
    ...state,
    previewKey: ganttDragDueKey(bounds.value, state.initialKey, event.clientX - state.originX),
  };
}

function onPointerUp(event: PointerEvent): void {
  const state = drag.value;
  if (state === null || state.pointerId !== event.pointerId) return;
  drag.value = null;
  // ⛔ 只入草案：拖动不落盘，横幅上的「保存排期」才落盘。
  store.queueIterationSchedule(props.milestoneId, state.iterationId, state.previewKey);
}

function onPointerCancel(event: PointerEvent): void {
  if (drag.value?.pointerId === event.pointerId) drag.value = null;
}

/* ── 键盘：←/→ 逐日，调完焦点留在该节点 ───────────────────────────────────── */
async function onNodeKeydown(row: ProjectIterationListItem, event: KeyboardEvent): Promise<void> {
  const current = scheduleDayKey(row.dueAt);
  if (current === null) return;
  const next = ganttKeyboardDueKey(current, event.key);
  if (next === null) return;
  event.preventDefault();
  if (isLocked(row)) return;
  store.queueIterationSchedule(props.milestoneId, row.id, next);
  await nextTick();
  document
    .querySelector<HTMLElement>(`[data-gantt-node="${CSS.escape(row.id)}"]`)
    ?.focus({ preventScroll: true });
}

/* ── 无日期：「设置日期」行内直接保存（与列表日期格同一条改单出口）──────────── */
const settingId = ref<string | null>(null);
const settingValue = ref('');
const settingRequestId = ref('');
const settingError = ref('');
const settingSaving = ref(false);

function startSetDate(row: ProjectIterationListItem): void {
  if (isLocked(row)) return;
  settingId.value = row.id;
  settingValue.value = '';
  settingError.value = '';
  settingRequestId.value = crypto.randomUUID();
}
function cancelSetDate(): void {
  settingId.value = null;
  settingError.value = '';
}
async function commitSetDate(row: ProjectIterationListItem): Promise<void> {
  if (settingSaving.value) return;
  const value = settingValue.value;
  if (!value || !isWithinPeriod(value, props.period)) {
    settingError.value = '请选择里程碑周期内的日期。';
    return;
  }
  const base = props.baseRows.find((item) => item.id === row.id);
  if (!base) return;
  settingSaving.value = true;
  try {
    const outcome = await store.saveIterationField({
      projectId: props.projectId,
      milestoneId: props.milestoneId,
      iterationId: row.id,
      field: 'dueAt',
      value,
      expectedVersion: base.version,
      clientRequestId: settingRequestId.value,
    });
    if (outcome === 'ok') cancelSetDate();
  } finally {
    settingSaving.value = false;
  }
}
</script>

<template>
  <div class="plan-gantt" :data-testid="`iteration-gantt-${milestoneId}`">
    <p class="plan-gantt__caption">{{ GANTT_CAPTION }}</p>
    <div class="plan-gantt__scroll">
      <div class="plan-gantt__grid" :data-gantt-width="bounds.widthPx">
        <div class="plan-gantt__row plan-gantt__row--head">
          <span class="plan-gantt__name">迭代计划</span>
          <div class="plan-gantt__track" :style="{ width: `${bounds.widthPx}px` }">
            <small
              v-for="tick in ticks"
              :key="tick.key"
              class="plan-gantt__tick tnum"
              :style="{ left: `${tick.leftPercent}%` }"
            >
              {{ tick.label }}
            </small>
          </div>
        </div>
        <p v-if="rows.length === 0" class="plan-gantt__empty" role="status">暂无匹配节点</p>
        <div v-for="row in rows" :key="row.id" class="plan-gantt__row" :data-gantt-row="row.id">
          <button
            class="plan-gantt__name plan-gantt__nameButton"
            type="button"
            :title="row.name"
            :data-testid="`iteration-gantt-detail-${row.id}`"
            @click="openDetail(row)"
          >
            {{ row.name }}
          </button>
          <div class="plan-gantt__track" :style="{ width: `${bounds.widthPx}px` }">
            <button
              v-if="nodeKey(row) !== null"
              type="button"
              class="plan-gantt__node"
              :class="{
                'is-draft': draft[row.id] !== undefined,
                'is-dragging': drag?.iterationId === row.id,
                'is-completed': row.status === 'completed',
              }"
              :data-gantt-node="row.id"
              :data-due="nodeKey(row)"
              :data-percent="ganttNodePercent(bounds, nodeKey(row) ?? '')"
              :disabled="isLocked(row)"
              :title="nodeKey(row) ?? ''"
              :aria-label="`调整${row.name}达成日期，当前 ${nodeKey(row)}`"
              aria-keyshortcuts="ArrowLeft ArrowRight"
              :style="{ left: ganttNodeLeftStyle(ganttNodePercent(bounds, nodeKey(row) ?? '')) }"
              @pointerdown="onPointerDown(row, $event)"
              @pointermove="onPointerMove"
              @pointerup="onPointerUp"
              @pointercancel="onPointerCancel"
              @keydown="onNodeKeydown(row, $event)"
            >
              <span aria-hidden="true">◆</span>
              <span class="plan-gantt__label tnum">{{
                formatDayKeyShort(nodeKey(row) ?? '')
              }}</span>
            </button>
            <template v-else-if="settingId === row.id">
              <span class="plan-gantt__setDate">
                <input
                  v-model="settingValue"
                  type="date"
                  :aria-label="`设置 ${row.name} 的达成日期`"
                  :data-testid="`iteration-gantt-date-input-${row.id}`"
                />
                <button
                  class="btn btn--primary btn--xs"
                  type="button"
                  :disabled="settingSaving"
                  :data-testid="`iteration-gantt-date-save-${row.id}`"
                  @click="commitSetDate(row)"
                >
                  保存
                </button>
                <button class="btn btn--ghost btn--xs" type="button" @click="cancelSetDate">
                  取消
                </button>
                <small v-if="settingError" role="alert">{{ settingError }}</small>
              </span>
            </template>
            <button
              v-else
              type="button"
              class="plan-gantt__setDateButton"
              :disabled="isLocked(row)"
              :data-testid="`iteration-gantt-set-date-${row.id}`"
              @click="startSetDate(row)"
            >
              设置日期
            </button>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.plan-gantt {
  display: flex;
  flex-direction: column;
  gap: var(--px-8);
}
.plan-gantt__caption {
  margin: 0;
  color: var(--muted2);
  font-size: var(--fs-200);
}
.plan-gantt__scroll {
  overflow-x: auto;
  border: var(--bw) solid var(--line);
  border-radius: var(--r-md);
  background: var(--panel);
}
.plan-gantt__grid {
  display: flex;
  flex-direction: column;
  width: max-content;
  min-width: 100%;
}
.plan-gantt__row {
  display: flex;
  align-items: center;
  min-height: 40px;
  border-top: var(--bw) solid var(--line);
}
.plan-gantt__row--head {
  min-height: 32px;
  border-top: 0;
  background: var(--sunken);
}
.plan-gantt__name {
  position: sticky;
  left: 0;
  z-index: 1;
  flex: 0 0 200px;
  padding: 0 var(--px-10);
  overflow: hidden;
  color: var(--ink);
  background: inherit;
  font-size: var(--fs-200);
  text-overflow: ellipsis;
  white-space: nowrap;
}
.plan-gantt__row:not(.plan-gantt__row--head) .plan-gantt__name {
  background: var(--panel);
}
/* 行首名称是「查看详情」按钮：去掉按钮外观，沿用名称格的吸附、截断与底色。 */
.plan-gantt__nameButton {
  border: 0;
  font: inherit;
  font-size: var(--fs-200);
  text-align: left;
  cursor: pointer;
}
.plan-gantt__nameButton:hover {
  color: var(--accent-text);
}
.plan-gantt__nameButton:focus-visible {
  outline: none;
  box-shadow: var(--focus-ring-flat);
}
.plan-gantt__track {
  position: relative;
  flex: 0 0 auto;
  align-self: stretch;
}
.plan-gantt__tick {
  position: absolute;
  top: 50%;
  color: var(--muted2);
  font-size: var(--fs-100);
  transform: translate(-50%, -50%);
  white-space: nowrap;
}
.plan-gantt__tick:first-child {
  transform: translate(0, -50%);
}
.plan-gantt__tick:last-child {
  transform: translate(-100%, -50%);
}
.plan-gantt__empty {
  margin: 0;
  padding: var(--px-12);
  color: var(--muted2);
  font-size: var(--fs-200);
}
.plan-gantt__node {
  position: absolute;
  top: 50%;
  display: inline-flex;
  align-items: center;
  gap: var(--px-4);
  padding: var(--px-2) var(--px-4);
  border: var(--bw) solid transparent;
  border-radius: var(--r-sm);
  color: var(--accent-text);
  background: transparent;
  font: inherit;
  font-size: var(--fs-100);
  transform: translate(-50%, -50%);
  cursor: grab;
  touch-action: none;
  user-select: none;
}
.plan-gantt__node:hover:not(:disabled) {
  border-color: var(--accent-line);
  background: var(--accent-soft);
}
.plan-gantt__node:focus-visible {
  outline: none;
  box-shadow: var(--focus-ring-flat);
}
.plan-gantt__node.is-draft {
  border-color: var(--accent-line);
  border-style: dashed;
}
.plan-gantt__node.is-dragging {
  cursor: grabbing;
  background: var(--accent-soft);
}
.plan-gantt__node:disabled {
  color: var(--muted2);
  cursor: default;
}
.plan-gantt__node.is-completed {
  color: var(--ok-text);
}
.plan-gantt__label {
  color: var(--muted);
}
.plan-gantt__setDate {
  position: absolute;
  top: 50%;
  left: var(--px-10);
  display: inline-flex;
  align-items: center;
  gap: var(--px-6);
  transform: translateY(-50%);
  font-size: var(--fs-100);
}
.plan-gantt__setDate small {
  color: var(--danger-text);
}
.plan-gantt__setDateButton {
  position: absolute;
  top: 50%;
  left: var(--px-10);
  padding: var(--px-2) var(--px-8);
  border: var(--bw) dashed var(--line);
  border-radius: var(--r-sm);
  color: var(--muted2);
  background: transparent;
  font: inherit;
  font-size: var(--fs-100);
  transform: translateY(-50%);
  cursor: pointer;
}
.plan-gantt__setDateButton:hover:not(:disabled) {
  color: var(--ink);
  border-color: var(--accent-line);
}
.plan-gantt__setDateButton:focus-visible {
  outline: none;
  box-shadow: var(--focus-ring-flat);
}
.plan-gantt__setDateButton:disabled {
  cursor: default;
}
</style>
