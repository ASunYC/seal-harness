<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue';

import type { Todo } from '@shared/protocol/project-collab.js';
import type { ProjectPlanWindow } from '@shared/protocol/project-collab-plan-dates.js';

import { useProjectCollabStore } from '../../stores/projectCollab';
import type { ProjectCollabNotice } from '../../stores/projectCollabErrors';
import PlanWindowStatus from './PlanWindowStatus.vue';
import {
  buildTimelineModel,
  monthTimelineRange,
  planWindowForDays,
  SCHEDULE_DAY_WIDTH_PX,
} from './schedule-layout';
import type { TimelineRow } from './schedule-layout';
import { useScheduleDnd } from './useScheduleDnd';
import type { ScheduleDragMode } from './useScheduleDnd';

/**
 * 时间轴视图（UX-04：接手 UX-03 的功能性简版，收口日期截断与拖动排期）。
 *
 * ⭐ 按月分段、按可见时间段向服务端取数（CORE-08，ADR-0042）：当前这一段（整月）换成时间段报给父级
 *    （`window`），父级按计划区间交叠逐页取全、叠上看板视图配置后经 `todos` 传回；翻段再报一次，卸载时报
 *    `release` 交还。
 *    ⛔ 这里不自己取数，⛔ 也不再从一批行里按日期本地筛。跨段的长条在段内裁切显示，被裁的那一端
 *    不出拖动把手（拖它等于改一个看不见的日期），日期标签照旧写完整起止。
 *
 * ## 判据 1「日期标签不被条宽裁切」怎么落
 *
 * 几何用**固定像素/天**（`buildTimelineModel`）：条宽 = 天数 × 每天像素，是数据的确定函数，
 * 组件把算出来的 px 直接写进内联样式——**模型即渲染**，不依赖布局引擎。摆位 `placement`
 * （`inside`/`outside`）也由纯函数按同一个宽度判定：
 *  - `outside`（条太窄）⇒ 日期落**名称列**日期行（min-width、不受条宽约束、恒不裁切）；
 *  - `inside`（条够宽，装得下）⇒ 日期放条内。
 * 两条路都不会被条宽裁切，且判定用的宽度与渲染宽度是同一个数。⛔ 组件不量像素、不断言像素。
 *
 * ## 判据 2「拖动排期」怎么落
 *
 * 拖动手势接 `useScheduleDnd`：先手校验 `start ≤ due`、乐观落位、409 弹回并显示、观察者两道门
 * 不可改。落库仍走 store 现有乐观锁 `updateTodo`（带 `expectedVersion`）——不新增 IPC。
 * ⚠️ 拖拽是**附加**手势：键盘用户走「点名称/条 → 详情弹层里改日期」那条既有路（drag 只增不减）。
 */
const props = withDefaults(
  defineProps<{
    todos: readonly Todo[];
    /** 未设计划完成日期的条数（表格同一支管线里数的，时间段查询取不到它们）。 */
    unscheduledCount?: number;
    unscheduledScope?: 'all' | 'page';
    loading?: boolean;
    error?: ProjectCollabNotice | null;
    truncated?: boolean;
  }>(),
  { unscheduledCount: 0, unscheduledScope: 'all', loading: false, error: null, truncated: false },
);
const emit = defineEmits<{
  edit: [Todo];
  window: [ProjectPlanWindow];
  retry: [];
  release: [];
}>();

const store = useProjectCollabStore();
const schedule = useScheduleDnd(store);

/** 当前这一段（整月）；初始为当月，与日历同口径。 */
function currentMonth(): { year: number; month: number } {
  const now = new Date();
  return { year: now.getFullYear(), month: now.getMonth() };
}
const cursor = ref(currentMonth());
const segment = computed(() => monthTimelineRange(cursor.value.year, cursor.value.month));
const segmentLabel = computed(() => `${cursor.value.year} 年 ${cursor.value.month + 1} 月`);

function shiftSegment(delta: number): void {
  const next = new Date(cursor.value.year, cursor.value.month + delta, 1);
  cursor.value = { year: next.getFullYear(), month: next.getMonth() };
}

// 挂载即报一次，之后每翻一段报一次（两端都没变就不触发）。
watch(
  () => `${segment.value.startKey}|${segment.value.endKey}`,
  () => emit('window', planWindowForDays(segment.value.startKey, segment.value.endKey)),
  { immediate: true },
);
// 卸载即交还（切到别的视图、页签卸载）：父级不再为没人看的一段随事件与清单重取发请求。
onBeforeUnmount(() => emit('release'));

/** 模型读的是「应用了乐观预览之后」的那批行：拖动中那条即时按预览区间重算几何；时间面就是这一段。 */
const model = computed(() =>
  buildTimelineModel(schedule.applyPreview(props.todos), SCHEDULE_DAY_WIDTH_PX, segment.value),
);

/** 时间面画布宽度（含末尾一天留白，最后一根条不贴边）。 */
const trackWidthPx = computed(() => (model.value.totalDays + 1) * SCHEDULE_DAY_WIDTH_PX);

/* ------------------------------ 拖动手势接线 ------------------------------ */

/** 拖动是否真的移动过（区分「点击打开详情」与「拖动改排期」）。 */
let dragMoved = false;
let pointerBound = false;

function bindPointer(): void {
  if (pointerBound) return;
  window.addEventListener('pointermove', onPointerMove);
  window.addEventListener('pointerup', onPointerUp);
  pointerBound = true;
}
function unbindPointer(): void {
  if (!pointerBound) return;
  window.removeEventListener('pointermove', onPointerMove);
  window.removeEventListener('pointerup', onPointerUp);
  pointerBound = false;
}

function onBarPointerDown(row: TimelineRow, mode: ScheduleDragMode, event: PointerEvent): void {
  // 观察者/无写权限：不起手拖，交给随后的 click 去开详情（第一道门，UI）。
  if (!schedule.canDrag(row.todo)) return;
  if (event.button !== 0) return;
  event.preventDefault();
  dragMoved = false;
  schedule.beginDrag(row.todo, mode, event.clientX);
  bindPointer();
}

function onPointerMove(event: PointerEvent): void {
  dragMoved = true;
  schedule.updateDrag(event.clientX);
}

function onPointerUp(): void {
  unbindPointer();
  if (dragMoved) {
    // 落库（含校验/乐观/409 弹回）在 commitDrag 里；这一拍的 click 用守卫吞掉。
    void schedule.commitDrag();
  } else {
    schedule.cancelDrag();
  }
}

onBeforeUnmount(unbindPointer);

/** 点名称/条打开详情——拖动刚结束的那次 click 吞掉（dragMoved 守卫）。 */
function onOpen(todo: Todo): void {
  if (dragMoved) {
    dragMoved = false;
    return;
  }
  emit('edit', todo);
}
</script>

<template>
  <div class="tl" data-testid="todo-timeline">
    <div class="tl-head">
      <button
        type="button"
        class="tl-nav"
        data-testid="todo-timeline-prev"
        aria-label="上一段"
        @click="shiftSegment(-1)"
      >
        ‹
      </button>
      <span class="tl-head__range" data-testid="todo-timeline-segment"
        >排期时间轴 · {{ segmentLabel }}</span
      >
      <button
        type="button"
        class="tl-nav"
        data-testid="todo-timeline-next"
        aria-label="下一段"
        @click="shiftSegment(1)"
      >
        ›
      </button>
      <span class="tl-head__hint"
        >翻段查看其他月份；拖动时间条改排期，观察者只读。窄条的完整日期列在名称下方，不被裁切。</span
      >
    </div>
    <PlanWindowStatus :error="props.error" :truncated="props.truncated" @retry="emit('retry')" />
    <div
      v-if="model.rows.length === 0 && props.error === null"
      class="tl-empty"
      data-testid="todo-timeline-empty"
      role="status"
      :aria-busy="props.loading ? 'true' : 'false'"
    >
      这一段暂无已排期需求。打开需求详情设置计划完成日期。
    </div>
    <template v-else-if="model.rows.length > 0">
      <div class="tl-scroll" :aria-busy="props.loading ? 'true' : 'false'">
        <ul class="tl-grid" :style="{ '--tl-track-w': `${trackWidthPx}px` }">
          <li
            v-for="row in model.rows"
            :key="row.todo.id"
            class="tl-row"
            :data-schedule-kind="row.kind"
            :data-label-placement="row.placement"
            :data-clipped-start="row.clippedStart ? 'yes' : 'no'"
            :data-clipped-end="row.clippedEnd ? 'yes' : 'no'"
            :data-can-reschedule="schedule.canDrag(row.todo) ? 'yes' : 'no'"
            :class="{ 'is-dragging': schedule.isDragging(row.todo.id) }"
          >
            <div class="tl-name">
              <button
                type="button"
                class="tl-name__title"
                data-testid="todo-timeline-open"
                :data-todo-id="row.todo.id"
                @click="onOpen(row.todo)"
              >
                {{ row.todo.title }}
              </button>
              <!-- 窄条：完整日期独立列在名称下方（原型 :1765），不受条宽约束、恒不裁切。 -->
              <span
                v-if="row.placement === 'outside'"
                class="tl-name__dates tnum"
                data-testid="todo-timeline-dates"
                >{{ row.labelSegments.join(' → ') }}</span
              >
            </div>
            <div class="tl-track">
              <button
                type="button"
                class="tl-bar"
                :class="`tl-bar--${row.placement}`"
                :style="{ left: `${row.leftPx}px`, width: `${row.widthPx}px` }"
                :data-todo-id="row.todo.id"
                :data-label-placement="row.placement"
                :aria-label="`${row.todo.title}，${row.labelSegments.join(' 至 ')}${
                  schedule.canDrag(row.todo) ? '（可拖动改排期）' : ''
                }`"
                :title="`${row.todo.title} · ${row.labelSegments.join(' → ')}`"
                data-testid="todo-timeline-bar"
                @pointerdown="onBarPointerDown(row, 'move', $event)"
                @click="onOpen(row.todo)"
              >
                <!-- 宽条：日期装得下就放条内（inside）；否则条上无字，只在名称列显示（outside）。 -->
                <span v-if="row.placement === 'inside'" class="tl-bar__label tnum">{{
                  row.labelSegments.join(' → ')
                }}</span>
                <!-- 拖端把手：只对可改排期的条渲染（观察者无把手＝第一道门）；被段边裁掉的那一端不出把手。 -->
                <template v-if="schedule.canDrag(row.todo)">
                  <span
                    v-if="!row.clippedStart"
                    class="tl-bar__handle tl-bar__handle--start"
                    data-testid="todo-timeline-handle-start"
                    aria-hidden="true"
                    @pointerdown.stop="onBarPointerDown(row, 'resize-start', $event)"
                    @click.stop
                  ></span>
                  <span
                    v-if="!row.clippedEnd"
                    class="tl-bar__handle tl-bar__handle--end"
                    data-testid="todo-timeline-handle-end"
                    aria-hidden="true"
                    @pointerdown.stop="onBarPointerDown(row, 'resize-end', $event)"
                    @click.stop
                  ></span>
                </template>
              </button>
            </div>
          </li>
        </ul>
      </div>
    </template>
    <p v-if="props.unscheduledCount > 0" class="tl-foot">
      <template v-if="props.unscheduledScope === 'page'">当前列表页中，</template>
      {{ props.unscheduledCount }} 条需求未排期。未设置计划完成日期时不进入时间轴。
    </p>
  </div>
</template>

<style scoped>
.tl {
  display: flex;
  min-height: 0;
  flex: 1;
  flex-direction: column;
  gap: var(--sp-3);
  padding: var(--sp-3) 0 var(--sp-4);
}
.tl-empty {
  padding: var(--sp-7) var(--sp-5);
  color: var(--muted2);
  text-align: center;
}
.tl-head {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: var(--sp-2) var(--sp-3);
}
.tl-head__range {
  color: var(--ink);
  font-weight: var(--fw-title);
}
.tl-nav {
  display: inline-grid;
  width: var(--ctl-h-sm);
  height: var(--ctl-h-sm);
  place-items: center;
  align-self: center;
  border: var(--bw) solid var(--line);
  border-radius: var(--r-sm);
  color: var(--muted2);
  background: var(--panel);
  cursor: pointer;
}
.tl-nav:hover {
  color: var(--ink);
  background: var(--sunken);
}
.tl-nav:focus-visible {
  outline: none;
  box-shadow: var(--focus-ring-flat);
}
.tl-head__hint {
  color: var(--muted);
  font-size: var(--fs-100);
}
.tl-scroll {
  min-height: 0;
  flex: 1;
  /* 横向滚动查看长区间；纵向随行数增长。 */
  overflow: auto;
}
.tl-grid {
  display: flex;
  flex-direction: column;
  gap: var(--sp-2);
  margin: 0;
  padding: 0;
  list-style: none;
  /* 名称列固定 + 时间面画布（--tl-track-w 由行内按 totalDays 算出，就地声明避免孤儿变量）。 */
  width: calc(var(--tl-name-w) + var(--tl-track-w));
  --tl-name-w: 180px;
  --tl-track-w: 0px;
}
.tl-row {
  display: grid;
  grid-template-columns: var(--tl-name-w) 1fr;
  align-items: center;
  gap: var(--sp-3);
  padding: var(--sp-2);
  border: var(--bw) solid var(--line-weak);
  border-radius: var(--r-md);
  background: var(--sunken);
}
.tl-row.is-dragging {
  border-color: var(--accent-line);
}
.tl-name {
  /* 名称列吸附在左：横向滚动时标题与完整日期始终可见、不被条宽裁切。 */
  position: sticky;
  left: 0;
  z-index: 1;
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: var(--sp-1);
  padding-right: var(--sp-2);
  background: var(--sunken);
}
.tl-name__title {
  overflow-wrap: anywhere;
  border: 0;
  padding: 0;
  color: var(--accent-text);
  background: transparent;
  font: var(--fw-title) var(--fs-body) / 1.4 var(--font-sans);
  text-align: left;
  cursor: pointer;
}
.tl-name__title:hover {
  text-decoration: underline;
}
.tl-name__title:focus-visible {
  outline: none;
  box-shadow: var(--focus-ring-flat);
}
.tl-name__dates {
  color: var(--muted);
  font-size: var(--fs-100);
  white-space: nowrap;
}
.tl-track {
  position: relative;
  height: var(--ctl-h-sm);
  border-radius: var(--r-sm);
  background: var(--panel);
}
.tl-bar {
  position: absolute;
  top: 0;
  bottom: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  overflow: visible;
  min-width: var(--px-2); /* 短条地板由模型给 widthPx，这里再兜一道，保证可点 */
  padding: 0 var(--px-3);
  border: var(--bw) solid var(--accent-line);
  border-radius: var(--r-sm);
  color: var(--accent-text);
  background: var(--accent-soft);
  cursor: grab;
  touch-action: none;
}
.tl-bar:hover {
  background: var(--accent);
}
.tl-bar:active {
  cursor: grabbing;
}
.tl-bar:focus-visible {
  outline: none;
  box-shadow: var(--focus-ring-flat);
}
/* 观察者的条不出把手也不给抓握指针：视觉上就读得出「只读」。 */
.tl-row[data-can-reschedule='no'] .tl-bar {
  cursor: pointer;
}
.tl-bar__label {
  overflow: hidden;
  font-size: var(--fs-100);
  line-height: 1;
  text-overflow: ellipsis;
  white-space: nowrap;
}
/* 拖端把手：条两端各一条细抓握区，改单端 = 改开始 / 改截止。 */
.tl-bar__handle {
  position: absolute;
  top: 0;
  bottom: 0;
  width: var(--px-3);
  cursor: ew-resize;
}
.tl-bar__handle--start {
  left: 0;
}
.tl-bar__handle--end {
  right: 0;
}
.tl-foot {
  margin: 0;
  color: var(--muted);
  font-size: var(--fs-100);
}
@media (prefers-reduced-motion: reduce) {
  .tl-row {
    transition: none;
  }
}
</style>
