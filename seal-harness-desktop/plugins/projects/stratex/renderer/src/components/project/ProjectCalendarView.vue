<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue';

import type { Todo } from '@shared/protocol/project-collab.js';
import type { ProjectPlanWindow } from '@shared/protocol/project-collab-plan-dates.js';

import type { ProjectCollabNotice } from '../../stores/projectCollabErrors';
import PlanWindowStatus from './PlanWindowStatus.vue';
import { classifySchedule, planWindowForDays, scheduleDayKey } from './schedule-layout';

/**
 * 日历视图（UX-04：接手 UX-03 简版；原型 addViewPanel「按计划完成日期查看安排，切换月份后打开需求」）。
 *
 * ⭐ 按可见时间段向服务端取数（CORE-08，ADR-0042）：挂载时与每次翻月，把这一屏 42 格换成时间段报给父级
 *    （`window`），父级按计划区间交叠逐页取全、叠上看板视图配置后经 `todos` 传回；卸载时报 `release`
 *    交还这一段。⛔ 这里不自己取数、⛔ 也不再从一批行里按月份本地筛——格里画什么，就是服务端对这一段给了什么。
 * ⚠️ 按「计划完成日期」（`dueAt`）落格；无日期的需求**不占格**（判据 1「无日期不伪造」）。按时间段取数时
 *    服务端本来就不返回没有截止的行，所以脚注条数由父级从表格同一支管线里数好传进来（`unscheduledCount`）。
 *    分类与时间轴共用同一支 `classifySchedule`/`scheduleDayKey`，⛔ 两视图不各写一份日期口径。
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

const WEEKDAYS = ['一', '二', '三', '四', '五', '六', '日'] as const;

/** 日键：未排期（含 dueAt 空/脏值）⇒ null（不落格）；否则取截止日键。与时间轴同一口径。 */
function dueDateKey(todo: Todo): string | null {
  if (classifySchedule(todo.startAt, todo.dueAt) === 'unscheduled') return null;
  return scheduleDayKey(todo.dueAt);
}

const byDay = computed(() => {
  const buckets = new Map<string, Todo[]>();
  for (const todo of props.todos) {
    const key = dueDateKey(todo);
    if (key === null) continue;
    const bucket = buckets.get(key);
    if (bucket) bucket.push(todo);
    else buckets.set(key, [todo]);
  }
  return buckets;
});

/**
 * 初始月份：当月（原型 `month=new Date()` 同）。按时间段取数之前手里没有数据，⛔ 不能再按「最早一条排期」
 * 定位——那要先把全部行拿到本地才知道。
 */
function initialCursor(): { year: number; month: number } {
  const now = new Date();
  return { year: now.getFullYear(), month: now.getMonth() };
}

const cursor = ref(initialCursor());

function shiftMonth(delta: number): void {
  const next = new Date(cursor.value.year, cursor.value.month + delta, 1);
  cursor.value = { year: next.getFullYear(), month: next.getMonth() };
}

const monthLabel = computed(() => `${cursor.value.year} 年 ${cursor.value.month + 1} 月`);

interface Cell {
  readonly key: string;
  readonly day: number;
  readonly inMonth: boolean;
  readonly todos: readonly Todo[];
}

/** 6×7 网格：从当月第一天所在的周一开始铺 42 格（周一起始，与 WEEKDAYS 对齐）。 */
const cells = computed<Cell[]>(() => {
  const first = new Date(cursor.value.year, cursor.value.month, 1);
  // JS getDay(): 周日=0…周六=6；换算成「周一=0…周日=6」的偏移。
  const offset = (first.getDay() + 6) % 7;
  const gridStart = new Date(cursor.value.year, cursor.value.month, 1 - offset);
  const out: Cell[] = [];
  for (let i = 0; i < 42; i += 1) {
    const date = new Date(gridStart.getFullYear(), gridStart.getMonth(), gridStart.getDate() + i);
    const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
    out.push({
      key,
      day: date.getDate(),
      inMonth: date.getMonth() === cursor.value.month,
      todos: byDay.value.get(key) ?? [],
    });
  }
  return out;
});

/** 这一屏 42 格对应的时间段：首格那一日 00:00Z 起，末格次日 00:00Z 止（含左不含右）。 */
const visibleWindow = computed<ProjectPlanWindow>(() => {
  const first = cells.value[0]?.key ?? '';
  const last = cells.value[cells.value.length - 1]?.key ?? first;
  return planWindowForDays(first, last);
});

// 挂载即报一次（immediate），之后每翻一次月报一次；同一段不重复报（两端都没变就不触发）。
watch(
  () => `${visibleWindow.value.planFrom}|${visibleWindow.value.planTo}`,
  () => emit('window', visibleWindow.value),
  { immediate: true },
);
// 卸载即交还（切到别的视图、页签卸载）：父级不再为没人看的一段随事件与清单重取发请求。
onBeforeUnmount(() => emit('release'));
</script>

<template>
  <div class="cal" data-testid="todo-calendar">
    <div class="cal-head">
      <button
        type="button"
        class="cal-nav"
        data-testid="todo-calendar-prev"
        aria-label="上一月"
        @click="shiftMonth(-1)"
      >
        ‹
      </button>
      <span class="cal-head__label" data-testid="todo-calendar-month">{{ monthLabel }}</span>
      <button
        type="button"
        class="cal-nav"
        data-testid="todo-calendar-next"
        aria-label="下一月"
        @click="shiftMonth(1)"
      >
        ›
      </button>
    </div>
    <PlanWindowStatus :error="props.error" :truncated="props.truncated" @retry="emit('retry')" />
    <div
      class="cal-grid"
      role="grid"
      aria-label="计划完成日期日历"
      :aria-busy="props.loading ? 'true' : 'false'"
      data-testid="todo-calendar-grid"
    >
      <div v-for="wd in WEEKDAYS" :key="wd" class="cal-weekday" role="columnheader">周{{ wd }}</div>
      <div
        v-for="cell in cells"
        :key="cell.key"
        class="cal-cell"
        :class="{ 'is-out': !cell.inMonth }"
        role="gridcell"
        :data-date="cell.key"
      >
        <span class="cal-cell__day tnum">{{ cell.day }}</span>
        <ul v-if="cell.todos.length > 0" class="cal-cell__list">
          <li v-for="todo in cell.todos" :key="todo.id">
            <button
              type="button"
              class="cal-item"
              data-testid="todo-calendar-item"
              :data-todo-id="todo.id"
              :data-status="todo.status"
              :title="todo.title"
              @click="emit('edit', todo)"
            >
              {{ todo.title }}
            </button>
          </li>
        </ul>
      </div>
    </div>
    <p v-if="props.unscheduledCount > 0" class="cal-foot">
      <template v-if="props.unscheduledScope === 'page'">当前列表页中，</template>
      {{ props.unscheduledCount }} 条需求未设置计划完成日期，不在日历上显示（不伪造为今天）。
    </p>
  </div>
</template>

<style scoped>
.cal {
  display: flex;
  min-height: 0;
  flex: 1;
  flex-direction: column;
  gap: var(--sp-3);
  padding: var(--sp-3) 0 var(--sp-4);
}
.cal-head {
  display: flex;
  align-items: center;
  gap: var(--sp-3);
}
.cal-head__label {
  color: var(--ink);
  font: var(--fw-title) var(--fs-body) / 1 var(--font-sans);
}
.cal-nav {
  display: inline-grid;
  width: var(--ctl-h-sm);
  height: var(--ctl-h-sm);
  place-items: center;
  border: var(--bw) solid var(--line);
  border-radius: var(--r-sm);
  color: var(--muted2);
  background: var(--panel);
  cursor: pointer;
}
.cal-nav:hover {
  color: var(--ink);
  background: var(--sunken);
}
.cal-nav:focus-visible {
  outline: none;
  box-shadow: var(--focus-ring-flat);
}
.cal-grid {
  display: grid;
  min-height: 0;
  flex: 1;
  grid-template-columns: repeat(7, minmax(0, 1fr));
  grid-auto-rows: minmax(84px, 1fr);
  gap: var(--px-2);
  overflow: auto;
}
.cal-weekday {
  padding: var(--sp-1);
  color: var(--muted);
  font-size: var(--fs-100);
  text-align: center;
}
.cal-cell {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: var(--sp-1);
  padding: var(--sp-1);
  border: var(--bw) solid var(--line-weak);
  border-radius: var(--r-sm);
  background: var(--sunken);
}
.cal-cell.is-out {
  opacity: 0.5;
}
.cal-cell__day {
  color: var(--muted2);
  font-size: var(--fs-100);
}
.cal-cell__list {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: var(--px-2);
  margin: 0;
  padding: 0;
  list-style: none;
}
.cal-item {
  display: block;
  width: 100%;
  overflow: hidden;
  padding: var(--px-1) var(--px-3);
  border: var(--bw) solid var(--accent-line);
  border-radius: var(--r-sm);
  color: var(--accent-text);
  background: var(--accent-soft);
  font-size: var(--fs-100);
  line-height: 1.4;
  text-align: left;
  text-overflow: ellipsis;
  white-space: nowrap;
  cursor: pointer;
}
.cal-item:hover {
  background: var(--accent);
}
.cal-item:focus-visible {
  outline: none;
  box-shadow: var(--focus-ring-flat);
}
.cal-foot {
  margin: 0;
  color: var(--muted);
  font-size: var(--fs-100);
}
</style>
