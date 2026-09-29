import type { ProjectIterationListItem } from '@shared/protocol/project-planning.js';
import {
  isCalendarDayKey,
  type ProjectIterationScheduleItem,
} from '@shared/protocol/project-planning-schedule.js';

import { formatDayKeyShort, scheduleDayKey, shiftDayKey } from './schedule-layout';

/**
 * 迭代计划看板 / 甘特（MIL-06）的**纯派生与几何**：排期草案、看板月份列、甘特到期点。
 *
 * ⚠️ 权威来自项目组原型 `index.html` 第 28 层 `milestones-v28`（终版经 `:2765` → `:2690`
 *    → `:2630` 三层链式包裹后生效）：
 *    - 草案 `queueSchedule28`（`:2698`）/ `saveSchedule28`（`:2699`）/ 横幅 `scheduleBanner28`（`:2687`）；
 *    - 看板 `boardMonths28` / `board28`（`:2682`–`:2683`）与落点 `wireBoard28`（`:2701`）；
 *    - 甘特 `ganttBounds28` / `gantt28`（`:2686`、`:2688`）与拖动/方向键 `wireGantt28`（`:2700`）。
 *    原型里的「plan」是产品的**业务目标**，「milestones」数组是产品的**迭代**。
 *
 * ⭐ 日期纪律（与 `schedule-layout.ts` 同一路数）：date-only 日键**不进 `Date` 做本地解析**，
 *    天数差一律走 `Date.UTC`。⛔ 别改成「正午锚点」或 `new Date('YYYY-MM-DD')`——那会在负时区
 *    把日键推到前一天。
 *
 * ⚠️ 常量**各用各的**：需求/任务时间轴是 28px/天（`SCHEDULE_DAY_WIDTH_PX`），里程碑甘特是
 *    26px/天（原型 `:2686` 的 `*26`）。⛔ 别互相套用。
 *
 * 本模块不读时钟、不发请求、不碰 store：「今天」由调用方传入。
 */

const DAY_MS = 86_400_000;

/* ══ 视图 ═════════════════════════════════════════════════════════════════════ */

/** 迭代计划的三种视图（闭集）。 */
export type IterationPlanView = 'list' | 'board' | 'gantt';

/** 默认视图：列表（原型 `viewState28` 的初值）。 */
export const DEFAULT_ITERATION_PLAN_VIEW: IterationPlanView = 'list';

/** 切换按钮的顺序与文案（逐字对齐原型 `:2691`：看板 / 列表 / 甘特图）。 */
export const ITERATION_PLAN_VIEW_OPTIONS: ReadonlyArray<{
  readonly value: IterationPlanView;
  readonly label: string;
}> = [
  { value: 'board', label: '看板' },
  { value: 'list', label: '列表' },
  { value: 'gantt', label: '甘特图' },
];

export function isIterationPlanView(value: unknown): value is IterationPlanView {
  return value === 'list' || value === 'board' || value === 'gantt';
}

/* ══ 排期草案 ═════════════════════════════════════════════════════════════════ */

/**
 * 一条草案：改到哪一天（日键）+ 起草时看到的版本（保存时作为期望版本发出去）。
 *
 * ⭐ 带 `baseVersion` 而不是保存时现读行版本：草案期间若事件驱动刷新把别人的改动拉进来，
 *    现读版本会让保存**静默覆盖**别人的改期；带着起草时的版本，服务端回 409、用户看到提示。
 */
export interface IterationScheduleDraftEntry {
  readonly dueAt: string;
  readonly baseVersion: number;
}

/** 一个业务目标的排期草案：`iterationId → 草案条目`（按 UUID 关联，⛔ 不按名称或日期）。 */
export type IterationScheduleDraft = Readonly<Record<string, IterationScheduleDraftEntry>>;

export const EMPTY_ITERATION_SCHEDULE_DRAFT: IterationScheduleDraft = Object.freeze({});

/** 草案被拒的文案（原型 `queueSchedule28`）。 */
export const SCHEDULE_QUEUE_REJECTED_MESSAGE = '日期需在里程碑周期内，且节点尚未达成。';
/** 保存前复核不过（原型 `saveSchedule28`）。 */
export const SCHEDULE_STALE_MESSAGE = '节点或计划周期已变化，请取消调整后重试。';
/** 看板拖进「未安排」（原型 `wireBoard28`）。 */
export const SCHEDULE_UNSCHEDULED_DROP_MESSAGE = '需要保留计划日期，可点击日期重新安排。';
/** 保存成功（原型 `saveSchedule28`）。 */
export const SCHEDULE_SAVED_MESSAGE = '迭代计划排期已保存。';

/** 业务目标周期（日键；未设为 null）。 */
export interface MilestonePeriod {
  readonly startKey: string | null;
  readonly endKey: string | null;
}

export function milestonePeriod(
  milestone: { readonly startAt: string | null; readonly dueAt: string | null } | null | undefined,
): MilestonePeriod {
  return {
    startKey: scheduleDayKey(milestone?.startAt ?? null),
    endKey: scheduleDayKey(milestone?.dueAt ?? null),
  };
}

/** 日键是否落在周期闭区间内（只设一端就只查那一端）。 */
export function isWithinPeriod(dayKey: string, period: MilestonePeriod): boolean {
  if (period.startKey !== null && dayKey < period.startKey) return false;
  if (period.endKey !== null && dayKey > period.endKey) return false;
  return true;
}

export function scheduleDraftSize(draft: IterationScheduleDraft): number {
  return Object.keys(draft).length;
}

/**
 * 把草案叠加到列表行上：有草案的那一轮 `dueAt` 换成草案日键，其余原样。
 *
 * ⭐ 列表 / 看板 / 甘特**同一份**叠加结果（原型 `visibleMilestones28` 先叠草案再筛再排）——
 *    草案日期因此同时影响三个视图的显示、「已逾期」判断与「到期时间」排序。返回新数组。
 */
export function applyScheduleDraft(
  rows: readonly ProjectIterationListItem[],
  draft: IterationScheduleDraft,
): ProjectIterationListItem[] {
  if (scheduleDraftSize(draft) === 0) return [...rows];
  return rows.map((row) => {
    const entry = draft[row.id];
    return entry === undefined ? row : { ...row, dueAt: entry.dueAt };
  });
}

export type QueueScheduleOutcome =
  { readonly ok: true; readonly draft: IterationScheduleDraft } | { readonly ok: false };

/**
 * 把一次拖动 / 方向键调整记进草案（原型 `queueSchedule28`）。
 *
 * 入草案前校验：有排期权限、这一轮存在且进行中、日键是真实日历日、落在目标周期内——
 * 任一不过 ⇒ `{ ok: false }`（调用方出「日期需在里程碑周期内，且节点尚未达成。」）。
 * ⭐ 拖回原日期 ＝ **从草案删除**这一条（草案里只留真正的改动）。
 * ⛔ 本函数只算新草案，**不发任何请求**——拖动只改本地草案，保存才落盘。
 */
export function queueScheduleDraft(
  draft: IterationScheduleDraft,
  request: {
    readonly row: ProjectIterationListItem | undefined;
    readonly dueAt: string;
    readonly period: MilestonePeriod;
    readonly canPlan: boolean;
  },
): QueueScheduleOutcome {
  const { row, dueAt, period } = request;
  if (!request.canPlan || row === undefined || row.status !== 'open') return { ok: false };
  if (!isCalendarDayKey(dueAt) || !isWithinPeriod(dueAt, period)) return { ok: false };
  const next: Record<string, IterationScheduleDraftEntry> = { ...draft };
  if (scheduleDayKey(row.dueAt) === dueAt) {
    delete next[row.id];
  } else {
    next[row.id] = { dueAt, baseVersion: draft[row.id]?.baseVersion ?? row.version };
  }
  return { ok: true, draft: next };
}

/** 从草案里拿掉一条（行内直接改日期保存成功后调用：那一轮已经不是草案了）。 */
export function dropScheduleDraftEntry(
  draft: IterationScheduleDraft,
  iterationId: string,
): IterationScheduleDraft {
  if (draft[iterationId] === undefined) return draft;
  const next: Record<string, IterationScheduleDraftEntry> = { ...draft };
  delete next[iterationId];
  return next;
}

/**
 * 保存前复核（原型 `saveSchedule28` 的逐条检查）：每条草案的那一轮仍在、仍进行中、日期仍在
 * 周期内。任一不成立 ⇒ `false`（调用方出「节点或计划周期已变化，请取消调整后重试。」，不发请求）。
 */
export function isScheduleDraftSavable(
  draft: IterationScheduleDraft,
  rows: readonly ProjectIterationListItem[],
  period: MilestonePeriod,
): boolean {
  const byId = new Map(rows.map((row) => [row.id, row]));
  return Object.entries(draft).every(([iterationId, entry]) => {
    const row = byId.get(iterationId);
    return row !== undefined && row.status === 'open' && isWithinPeriod(entry.dueAt, period);
  });
}

/**
 * 草案 → 请求条目（按 iterationId 排序：同一份草案恒产出同一串，客户端据此判断「是不是同一个请求」）。
 */
export function scheduleDraftItems(draft: IterationScheduleDraft): ProjectIterationScheduleItem[] {
  return Object.entries(draft)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([iterationId, entry]) => ({
      iterationId,
      dueAt: entry.dueAt,
      expectedVersion: entry.baseVersion,
    }));
}

/** 请求身份指纹：目标 + 排好序的条目。同指纹 ⇒ 同一个请求 ⇒ 重试沿用同一个幂等键。 */
export function scheduleRequestFingerprint(
  milestoneId: string,
  items: readonly ProjectIterationScheduleItem[],
): string {
  return JSON.stringify([
    milestoneId,
    items.map((i) => [i.iterationId, i.dueAt, i.expectedVersion]),
  ]);
}

/**
 * 409 版本冲突刷新后，把草案**对齐到新快照**（草案里的日期一个不丢）：
 *  - 那一轮已不在列表（被归档/移走）⇒ 保留条目（保存前复核会拦下并提示取消调整）；
 *  - 新快照的到期日恰好就是草案日期 ⇒ 这一条已不是改动，从草案删除；
 *  - 其余 ⇒ 期望版本换成新快照的版本（用户已经看到刷新后的数据，再点保存才以它为准）。
 */
export function rebaseScheduleDraft(
  draft: IterationScheduleDraft,
  rows: readonly ProjectIterationListItem[],
): IterationScheduleDraft {
  const byId = new Map(rows.map((row) => [row.id, row]));
  const next: Record<string, IterationScheduleDraftEntry> = {};
  for (const [iterationId, entry] of Object.entries(draft)) {
    const row = byId.get(iterationId);
    if (row === undefined) {
      next[iterationId] = entry;
      continue;
    }
    if (scheduleDayKey(row.dueAt) === entry.dueAt) continue;
    next[iterationId] = { dueAt: entry.dueAt, baseVersion: row.version };
  }
  return next;
}

/* ══ 看板 / 甘特共用的可见集 ═══════════════════════════════════════════════════ */

/**
 * 看板与甘特在共用查询结果之上**再**隐去已达成的轮次，除非勾了「显示已完成」或筛选就是「已完成」
 * （原型 `board28` / `gantt28` 同一句 `s.showDone||s.filter==='done'||!m.completedAt`）。
 */
export function rowsForScheduleViews(
  visible: readonly ProjectIterationListItem[],
  options: { readonly showDone: boolean; readonly filter: string },
): ProjectIterationListItem[] {
  return visible.filter(
    (row) => options.showDone || options.filter === 'done' || row.status !== 'completed',
  );
}

/* ══ 看板：按到期月分列 ════════════════════════════════════════════════════════ */

/** 「未安排」列的键（排在所有月份之后）。 */
export const BOARD_UNSCHEDULED_KEY = 'unscheduled';
export const BOARD_UNSCHEDULED_LABEL = '未安排';
/** 业务目标有周期时，最多补齐多少个月的空列（原型 `n<first+24`）。 */
export const BOARD_MAX_PERIOD_MONTHS = 24;

export interface BoardColumn {
  /** `YYYY-MM` 或 `unscheduled`。 */
  readonly key: string;
  readonly label: string;
  readonly rows: readonly ProjectIterationListItem[];
}

/** 一轮落在哪一列：有到期日取 `YYYY-MM`，否则「未安排」。 */
export function boardColumnKey(row: Pick<ProjectIterationListItem, 'dueAt'>): string {
  const dayKey = scheduleDayKey(row.dueAt);
  return dayKey === null ? BOARD_UNSCHEDULED_KEY : dayKey.slice(0, 7);
}

function monthIndex(monthKey: string): number {
  return Number(monthKey.slice(0, 4)) * 12 + Number(monthKey.slice(5, 7)) - 1;
}

function monthKeyOf(index: number): string {
  return `${String(Math.floor(index / 12)).padStart(4, '0')}-${String((index % 12) + 1).padStart(2, '0')}`;
}

/**
 * 看板的列（原型 `boardMonths28` + `board28`）：
 *  - 行按到期月分列（无日期进「未安排」）；
 *  - 业务目标**两端都设了**周期时，补齐周期内每个月（从开始月起最多 24 个）；
 *  - 月份升序，「未安排」恒在最后。行在列内保持传入顺序（即共用查询的排序）。
 */
export function buildBoardColumns(
  rows: readonly ProjectIterationListItem[],
  period: MilestonePeriod,
): BoardColumn[] {
  const keys = new Set(rows.map(boardColumnKey));
  if (period.startKey !== null && period.endKey !== null) {
    const first = monthIndex(period.startKey);
    const last = monthIndex(period.endKey);
    for (let index = first; index <= last && index < first + BOARD_MAX_PERIOD_MONTHS; index += 1) {
      keys.add(monthKeyOf(index));
    }
  }
  const ordered = [...keys].sort((a, b) => {
    if (a === b) return 0;
    if (a === BOARD_UNSCHEDULED_KEY) return 1;
    if (b === BOARD_UNSCHEDULED_KEY) return -1;
    return a < b ? -1 : 1;
  });
  return ordered.map((key) => ({
    key,
    label: key === BOARD_UNSCHEDULED_KEY ? BOARD_UNSCHEDULED_LABEL : key,
    rows: rows.filter((row) => boardColumnKey(row) === key),
  }));
}

/** 某月最后一天（走 UTC：`Date.UTC(y, m, 0)` 即上月最后一天，这里 m 取「下一个月」的 0 号）。 */
function lastDayOfMonth(monthKey: string): number {
  return new Date(
    Date.UTC(Number(monthKey.slice(0, 4)), Number(monthKey.slice(5, 7)), 0),
  ).getUTCDate();
}

/**
 * 卡片拖到某个月时的新到期日（原型 `wireBoard28`）：
 * 日 ＝ min(原日, 当月最后一天)（无原日取 1 号），再钳进业务目标周期。
 */
export function boardDropDueKey(
  monthKey: string,
  currentDueKey: string | null,
  period: MilestonePeriod,
): string {
  const day = Math.min(
    lastDayOfMonth(monthKey),
    currentDueKey ? Number(currentDueKey.slice(8, 10)) : 1,
  );
  let dueKey = `${monthKey}-${String(day).padStart(2, '0')}`;
  if (period.startKey !== null && dueKey < period.startKey) dueKey = period.startKey;
  if (period.endKey !== null && dueKey > period.endKey) dueKey = period.endKey;
  return dueKey;
}

/** 相邻月份键（键盘把卡片挪到上 / 下一个月列用）。 */
export function adjacentMonthKey(monthKey: string, delta: -1 | 1): string {
  return monthKeyOf(monthIndex(monthKey) + delta);
}

/* ══ 甘特：只有到期点 ══════════════════════════════════════════════════════════ */

/** 里程碑甘特每天的像素（原型 `:2686`）。⛔ 别套用需求时间轴的 28。 */
export const GANTT_DAY_WIDTH_PX = 26;
export const GANTT_MIN_WIDTH_PX = 720;
export const GANTT_MAX_WIDTH_PX = 2000;
/** 区间非法 / 没有任何日期时的回退跨度：今天起 14 天。 */
export const GANTT_FALLBACK_DAYS = 14;
export const GANTT_TICK_COUNT = 7;
/** 到期点距轨道两端的最小留白（`clamp(10px, pos%, 100% - 10px)`）。 */
export const GANTT_NODE_EDGE_PX = 10;
/** 说明文字（逐字对齐原型 `:2688`）。 */
export const GANTT_CAPTION = '拖动节点调整达成日期；方向键可逐日调整。保存排期后生效。';

/** 日键 → UTC 天序号（只做差值用）。非法 ⇒ NaN。 */
export function dayNumber(dayKey: string | null): number {
  if (dayKey === null || !isCalendarDayKey(dayKey)) return Number.NaN;
  return (
    Date.UTC(
      Number(dayKey.slice(0, 4)),
      Number(dayKey.slice(5, 7)) - 1,
      Number(dayKey.slice(8, 10)),
    ) / DAY_MS
  );
}

/** UTC 天序号 → 日键。 */
export function dayKeyOf(day: number): string {
  const date = new Date(day * DAY_MS);
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`;
}

export interface GanttBounds {
  readonly startKey: string;
  readonly endKey: string;
  /** 开始日的 UTC 天序号。 */
  readonly startDay: number;
  readonly endDay: number;
  /** 跨度天数 `max(1, end - start)`（位置换算的分母）。 */
  readonly span: number;
  /** 轨道像素宽：`(end - start + 1) × 26`，钳进 [720, 2000]。 */
  readonly widthPx: number;
}

/**
 * 甘特的时间范围（原型 `ganttBounds28`）：
 *  开始 ＝ 目标开始日 ‖ 最早到期日 ‖ 今天；结束 ＝ 目标到期日 ‖ 最晚到期日 ‖ 开始 + 14 天；
 *  任一端非法或结束早于开始 ⇒ 回退「今天 + 14 天」。
 * ⚠️ 到期日取**全部轮次的原始日期**（不叠草案、不受筛选）：拖动时范围不跟着抖。
 */
export function ganttBounds(
  baseRows: readonly Pick<ProjectIterationListItem, 'dueAt'>[],
  period: MilestonePeriod,
  todayKey: string,
): GanttBounds {
  const dates = baseRows
    .map((row) => scheduleDayKey(row.dueAt))
    .filter((key): key is string => key !== null)
    .sort();
  let start = dayNumber(period.startKey ?? dates[0] ?? todayKey);
  let end = dayNumber(period.endKey ?? dates.at(-1) ?? dayKeyOf(start + GANTT_FALLBACK_DAYS));
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) {
    start = dayNumber(todayKey);
    end = start + GANTT_FALLBACK_DAYS;
  }
  return {
    startKey: dayKeyOf(start),
    endKey: dayKeyOf(end),
    startDay: start,
    endDay: end,
    span: Math.max(1, end - start),
    widthPx: Math.max(
      GANTT_MIN_WIDTH_PX,
      Math.min(GANTT_MAX_WIDTH_PX, (end - start + 1) * GANTT_DAY_WIDTH_PX),
    ),
  };
}

/** 7 个刻度（原型 `:2688`）：均分 0..6，标签 `MM-DD`。 */
export function ganttTicks(
  bounds: GanttBounds,
): ReadonlyArray<{ readonly key: string; readonly label: string; readonly leftPercent: number }> {
  return Array.from({ length: GANTT_TICK_COUNT }, (_unused, index) => {
    const key = dayKeyOf(
      bounds.startDay + Math.round((bounds.span * index) / (GANTT_TICK_COUNT - 1)),
    );
    return {
      key,
      label: formatDayKeyShort(key),
      leftPercent: (index / (GANTT_TICK_COUNT - 1)) * 100,
    };
  });
}

/** 到期点在轨道上的百分比位置（钳进 0..100）。 */
export function ganttNodePercent(bounds: GanttBounds, dueKey: string): number {
  const position = ((dayNumber(dueKey) - bounds.startDay) / bounds.span) * 100;
  return Math.max(0, Math.min(100, position));
}

/** 到期点的内联 left（`clamp(10px, pos%, calc(100% - 10px))`，两端留白保证点得中）。 */
export function ganttNodeLeftStyle(percent: number): string {
  return `clamp(${GANTT_NODE_EDGE_PX}px, ${percent}%, calc(100% - ${GANTT_NODE_EDGE_PX}px))`;
}

/** 指针拖动：按像素换算天数并钳在范围内（原型 `wireGantt28` 的 `move`）。 */
export function ganttDragDueKey(bounds: GanttBounds, initialKey: string, deltaPx: number): string {
  const day = dayNumber(initialKey) + Math.round((deltaPx / bounds.widthPx) * bounds.span);
  return dayKeyOf(Math.max(bounds.startDay, Math.min(bounds.endDay, day)));
}

/** 方向键逐日调整：←/→ 各一天（周期闸在入草案时判，这里不钳）。 */
export function ganttKeyboardDueKey(currentKey: string, key: string): string | null {
  if (key === 'ArrowLeft') return shiftDayKey(currentKey, -1);
  if (key === 'ArrowRight') return shiftDayKey(currentKey, 1);
  return null;
}
