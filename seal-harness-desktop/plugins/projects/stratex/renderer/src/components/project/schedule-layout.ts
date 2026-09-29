/**
 * 排期视图（日历 / 时间轴）的**纯几何与分类**——UX-04 判据 1 的唯一逻辑载体。
 *
 * ## 为什么把「摆位」抽成纯函数（判据 1 必答）
 *
 * jsdom / happy-dom **没有布局引擎**：`getBoundingClientRect()` 恒回 0，元素没有真实宽度。
 * 于是「日期标签**不被条宽裁切**」这种纯布局属性，在组件测试里既测不出真、也测不出假——
 * 写成 DOM 断言就是一条**空跑**。
 *
 * 破法：时间轴几何采用**固定像素/天**（`SCHEDULE_DAY_WIDTH_PX`，与原型 `:1763` 的
 * `unit=24/52` 同一路数）。于是每根条的宽度 = `天数 × 每天像素`，是**数据的确定函数**，
 * 不依赖任何真实布局就能算出——组件把这个算出来的 px 直接写进内联样式，模型即渲染。
 * 「装不装得下标签」因此变成一道纯数值判定（`resolveDateLabelPlacement`），可在无布局引擎的
 * 环境里精确断言，且组件里那根条的实际宽度与判定用的宽度**是同一个数**。
 *
 * 摆位闭集：`inside`（条足够宽，标签放条内、装得下就不会裁）/ `outside`（条太窄，标签落到
 * 名称列的日期行——那里有 min-width、不受条宽约束、**结构上不可能被条宽裁切**）。判据 1 的
 * 「不被裁切」＝ 标签要么**可证足够宽**（inside），要么在**不受条宽约束的容器**里（outside）。
 *
 * 权威口径来自项目组原型最后一层（`index.html:1762`–`:1765` `renderResults` 时间轴覆写、
 * `:1773` `helpGroups.views`「时间条表示区间，完整日期独立展示，避免窄条截断文字」）。
 */

import type { Todo } from '@shared/protocol/project-collab.js';
import type { ProjectPlanWindow } from '@shared/protocol/project-collab-plan-dates.js';

const DAY_MS = 86_400_000;

/** 时间条在时间面上的分类（闭集）：区间 / 单日节点 / 未排期。 */
export type ScheduleKind = 'span' | 'point' | 'unscheduled';

/** 日期标签相对时间条的摆位（闭集）——判据 1「不被条宽裁切」的唯一收口。 */
export type DateLabelPlacement = 'inside' | 'outside';

/**
 * 时间轴每天占的像素宽（与原型 `:1763` 的 `unit`＝24/52 同量级，取 28 折中）。
 * ⚠️ 几何全由它推出，所以渲染宽度是**数据的确定函数**——这是判据 1 在无布局引擎下可量的关键。
 */
export const SCHEDULE_DAY_WIDTH_PX = 28;

/** 短条地板：一天期的条也要点得中、看得见（原型 `.schedule-bar` 最小可读宽同义）。 */
export const SCHEDULE_MIN_BAR_PX = 8;

/** 估算：一个字符约占的像素（保守偏大——宁可判 outside 也不冒险裁切）。 */
const APPROX_CHAR_PX = 8;
/** 条内两侧留白：不贴边才算「装得下、不会差点裁到」。 */
const LABEL_INSET_PX = 12;

/**
 * 任意日期串 → 本地日键 `YYYY-MM-DD`。
 *
 * ⚠️ 日期只有一位「天」的分辨率——`'2026-08-25'`（建单弹层写的date-only）与
 * `'2026-08-26T00:00:00Z'`（列表出参）都直接取**前 10 位**（与弹层 `.slice(0,10)` 同口径），
 * ⛔ 不走 `Date.parse` 再取本地日：那会在负时区把 date-only 串推到前一天。带时分的其它串才回落
 * 到解析。脏值 / 空值 ⇒ null。
 */
export function scheduleDayKey(value: string | null): string | null {
  if (value === null) return null;
  const head = value.slice(0, 10);
  if (/^\d{4}-\d{2}-\d{2}$/.test(head)) return head;
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) return null;
  const d = new Date(parsed);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** 日键 → UTC 0 点毫秒（只用于**天数差**：走 UTC 避开 DST/时区，任何机器上结果一致）。 */
function dayKeyToUtcMs(key: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key);
  if (!m) return null;
  const ms = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return Number.isNaN(ms) ? null : ms;
}

/** 日键平移 N 天（走 UTC，跨月/跨年/DST 都稳）。脏值原样返回。 */
export function shiftDayKey(key: string, deltaDays: number): string {
  const ms = dayKeyToUtcMs(key);
  if (ms === null) return key;
  const d = new Date(ms + deltaDays * DAY_MS);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}

/**
 * 视图可见的若干天 → 向服务端按计划时间段取数的两端时刻（CORE-08，ADR-0042）。
 *
 * ⚠️ 日键就是条目落格用的那个日（`scheduleDayKey` 取服务端时刻串的前 10 位＝UTC 日），所以两端必须是
 *    **UTC 零点**：`[首日 00:00Z, 末日次日 00:00Z)`。⛔ 不用 `new Date(y, m, d)` 的本地零点——东八区会把
 *    时间段整体提前八小时，前一天的条目混进来、最后一天的条目被切掉一截。
 */
export function planWindowForDays(firstKey: string, lastKey: string): ProjectPlanWindow {
  return {
    planFrom: `${firstKey}T00:00:00.000Z`,
    planTo: `${shiftDayKey(lastKey, 1)}T00:00:00.000Z`,
  };
}

/** 时间轴的一段（CORE-08 按月分段）：段内首日与末日，都含。 */
export interface TimelineRange {
  readonly startKey: string;
  readonly endKey: string;
}

/** 某年某月（`month` 从 0 起）的整月一段。 */
export function monthTimelineRange(year: number, month: number): TimelineRange {
  const pad = (part: number): string => String(part).padStart(2, '0');
  const startKey = `${String(year).padStart(4, '0')}-${pad(month + 1)}-01`;
  const nextMonthKey =
    month === 11
      ? `${String(year + 1).padStart(4, '0')}-01-01`
      : `${String(year).padStart(4, '0')}-${pad(month + 2)}-01`;
  return { startKey, endKey: shiftDayKey(nextMonthKey, -1) };
}

/** 日键 → 展示「MM-DD」。 */
export function formatDayKeyShort(key: string): string {
  const m = /^\d{4}-(\d{2})-(\d{2})$/.exec(key);
  return m ? `${m[1]}-${m[2]}` : key;
}

/**
 * 这条需求排期用的「开始日键」：**有开始且不晚于截止**就用开始，否则退成单日节点（截止日）。
 * 与原型 `:1763` `r.start&&r.start<=r.due?r.start:r.due` 同口径。
 */
export function resolveStartKey(startAt: string | null, dueKey: string): string {
  const startKey = scheduleDayKey(startAt);
  if (startKey !== null && startKey <= dueKey) return startKey;
  return dueKey;
}

/**
 * 分类（闭集）：
 *  - **无截止**（`dueAt` 为空 / 解析不出）⇒ `unscheduled`——不落到时间面，走脚注计数
 *    （⛔ 判据 1「无日期不伪造」：不能画成一根 0 宽条）；
 *  - 开始 < 截止 ⇒ `span`（区间）；
 *  - 否则（含**同日**、无开始）⇒ `point`（单日节点）。
 */
export function classifySchedule(startAt: string | null, dueAt: string | null): ScheduleKind {
  const dueKey = scheduleDayKey(dueAt);
  if (dueKey === null) return 'unscheduled';
  const startKey = resolveStartKey(startAt, dueKey);
  return startKey < dueKey ? 'span' : 'point';
}

/**
 * 含首尾的天数跨度：**同日 ⇒ 1**（⛔ 判据 1 变异锚点：绝不算成 0），脏值兜 1。
 * `Math.round(...)+1` 与 `Math.max(1, ...)` 缺一不可——少了 `+1` 同日就是 0，少了 `max` 反序会负。
 */
export function spanDays(startKey: string, dueKey: string): number {
  const s = dayKeyToUtcMs(startKey);
  const e = dayKeyToUtcMs(dueKey);
  if (s === null || e === null) return 1;
  return Math.max(1, Math.round((e - s) / DAY_MS) + 1);
}

/**
 * 一段排期拆成**带标签的段**（判据 1「跨月」）：
 *  - 单日节点（同日）⇒ 1 段 `MM-DD`；
 *  - 同月区间 ⇒ 1 段 `MM-DD → MM-DD`（同一个月一眼读完）；
 *  - **跨月区间 ⇒ 2 段**，每段各带自己的月：`['MM-DD','MM-DD']`——⛔ 变异锚点「跨月只标一段」：
 *    只标一段会读成「12-28 → 03」，读不出跨到几月。组件把各段用「→」连起来显示，视觉与同月一致。
 */
export function scheduleLabelSegments(startKey: string, dueKey: string): readonly string[] {
  if (startKey === dueKey) return [formatDayKeyShort(startKey)];
  const sameMonth = startKey.slice(0, 7) === dueKey.slice(0, 7);
  if (sameMonth) return [`${formatDayKeyShort(startKey)} → ${formatDayKeyShort(dueKey)}`];
  return [formatDayKeyShort(startKey), formatDayKeyShort(dueKey)];
}

/**
 * 日期标签摆位（判据 1「不被条宽裁切」的唯一判据）：
 *  - 条足够宽装得下标签（字符宽 + 两侧留白）⇒ `inside`；
 *  - 否则 ⇒ `outside`（落名称列日期行，不受条宽约束、恒不裁切）。
 * ⚠️ 纯数值判定：`barWidthPx` 由 `spanDays × SCHEDULE_DAY_WIDTH_PX` 算出，`labelChars` 是字符数——
 *    两者都不需要真实布局，故 jsdom 下可精确断言，且与组件实际渲染宽度是同一个数。
 * ⛔ 变异锚点「短条时标签仍放条内」：把这里恒回 `inside`，短条用例当场红。
 */
export function resolveDateLabelPlacement(
  barWidthPx: number,
  labelChars: number,
): DateLabelPlacement {
  return barWidthPx >= labelChars * APPROX_CHAR_PX + LABEL_INSET_PX ? 'inside' : 'outside';
}

/**
 * 排期区间合法性（判据 2「拖动排期校验 start ≤ due」的**先手拦截**）。
 *
 * ⚠️ **不是唯一防线、也不替代服务端**：CORE-02 已在服务端对 `start_at`/`due_at` 做最终区间
 *    校验；这一层只为「别把一个必被服务端 4xx 拒的写请求发出去」。
 *  - 无截止 ⇒ 非法（排期必须有截止日）；
 *  - 无开始（单日节点）⇒ 合法（没有先后可比）；
 *  - 两者都有 ⇒ 要求 `start ≤ due`（日键字典序＝时间序）。
 * ⛔ 变异锚点「start > due 被接受」：把 `<=` 改成恒真 / `>=`，非法区间用例当场红。
 */
export function isValidScheduleInterval(startAt: string | null, dueAt: string | null): boolean {
  const dueKey = scheduleDayKey(dueAt);
  if (dueKey === null) return false;
  if (startAt === null) return true;
  const startKey = scheduleDayKey(startAt);
  if (startKey === null) return false;
  return startKey <= dueKey;
}

/** 时间轴一根条的完整几何与标签（供组件内联样式与摆位直接消费）。 */
export interface TimelineRow {
  readonly todo: Todo;
  readonly kind: 'span' | 'point';
  readonly startKey: string;
  readonly dueKey: string;
  /** 条左缘距时间面起点的像素（＝距起点天数 × 每天像素）。 */
  readonly leftPx: number;
  /** 条渲染宽度像素（已夹**短条地板**，保证可点可见）。 */
  readonly widthPx: number;
  /** 几何宽（未夹地板）——摆位判定用它，别用夹过地板的 `widthPx`。 */
  readonly geoWidthPx: number;
  readonly labelSegments: readonly string[];
  readonly placement: DateLabelPlacement;
  /** 开始早于段首、条在段首被裁（CORE-08 按段显示）——组件据此不出左侧拖动把手。无段时恒 false。 */
  readonly clippedStart: boolean;
  /** 截止晚于段末、条在段末被裁——组件据此不出右侧拖动把手。无段时恒 false。 */
  readonly clippedEnd: boolean;
}

export interface TimelineModel {
  readonly rows: readonly TimelineRow[];
  /** 未排期条数（判据 1「无日期」：走脚注计数，⛔ 不进 `rows`、不画 0 宽条）。 */
  readonly unscheduledCount: number;
  readonly rangeStartKey: string | null;
  readonly rangeEndKey: string | null;
  readonly totalDays: number;
}

/**
 * 由一批需求算出时间轴模型（纯函数——判据 1 的可断言载体）。
 *
 * ⚠️ 未排期（`classifySchedule === 'unscheduled'`）**只计数、不进 `rows`**：这是判据 1「无日期
 *    不伪造成 0 宽条」的结构性证据——它连进 `rows` 的机会都没有。
 * ⭐ `range`（CORE-08 按月分段）：给了就以这一段为时间面（首尾都含），条按段裁切、标签仍写完整起止；
 *    行集合是服务端按这一段取回的，⛔ 这里不再按日期剔行（拖动预览把条拖出段外时钉在段边）。
 *    不给就退回「范围取全部已排期行」的旧口径。
 */
export function buildTimelineModel(
  todos: readonly Todo[],
  dayWidthPx: number = SCHEDULE_DAY_WIDTH_PX,
  range: TimelineRange | null = null,
): TimelineModel {
  const scheduled: Array<{ todo: Todo; startKey: string; dueKey: string; kind: 'span' | 'point' }> =
    [];
  let unscheduledCount = 0;
  for (const todo of todos) {
    const kind = classifySchedule(todo.startAt, todo.dueAt);
    if (kind === 'unscheduled') {
      unscheduledCount += 1;
      continue;
    }
    const dueKey = scheduleDayKey(todo.dueAt) as string; // 分类已保证非空
    const startKey = resolveStartKey(todo.startAt, dueKey);
    scheduled.push({ todo, startKey, dueKey, kind });
  }
  if (scheduled.length === 0) {
    return range === null
      ? { rows: [], unscheduledCount, rangeStartKey: null, rangeEndKey: null, totalDays: 0 }
      : {
          rows: [],
          unscheduledCount,
          rangeStartKey: range.startKey,
          rangeEndKey: range.endKey,
          totalDays: spanDays(range.startKey, range.endKey),
        };
  }
  // 按截止升序（原型 `:1762` `sort((a,b)=>a.due.localeCompare(b.due))`）；同截止按开始稳定。
  scheduled.sort(
    (a, b) => a.dueKey.localeCompare(b.dueKey) || a.startKey.localeCompare(b.startKey),
  );
  // scheduled.length > 0（上面已判），排序后首尾必有值。
  const rangeStartKey =
    range?.startKey ?? ([...scheduled.map((r) => r.startKey)].sort()[0] as string);
  const rangeEndKey =
    range?.endKey ?? ([...scheduled.map((r) => r.dueKey)].sort().at(-1) as string);
  const originMs = dayKeyToUtcMs(rangeStartKey) as number;
  const endMs = dayKeyToUtcMs(rangeEndKey) as number;
  const totalDays = Math.max(1, Math.round((endMs - originMs) / DAY_MS) + 1);
  const rows: TimelineRow[] = scheduled.map((r) => {
    const visible = visibleSpan(r.startKey, r.dueKey, rangeStartKey, rangeEndKey);
    const days = spanDays(visible.startKey, visible.endKey);
    const offsetDays = Math.round(
      ((dayKeyToUtcMs(visible.startKey) as number) - originMs) / DAY_MS,
    );
    const geoWidthPx = days * dayWidthPx;
    const labelSegments = scheduleLabelSegments(r.startKey, r.dueKey);
    const labelChars = labelSegments.join(' → ').length;
    return {
      todo: r.todo,
      kind: r.kind,
      startKey: r.startKey,
      dueKey: r.dueKey,
      leftPx: offsetDays * dayWidthPx,
      widthPx: Math.max(SCHEDULE_MIN_BAR_PX, geoWidthPx),
      geoWidthPx,
      labelSegments,
      placement: resolveDateLabelPlacement(geoWidthPx, labelChars),
      clippedStart: range !== null && r.startKey < range.startKey,
      clippedEnd: range !== null && r.dueKey > range.endKey,
    };
  });
  return { rows, unscheduledCount, rangeStartKey, rangeEndKey, totalDays };
}

/**
 * 一根条在时间面上**看得见**的那一截：与 `[rangeStartKey, rangeEndKey]` 求交。整根都在面外（只会出现在
 * 拖动预览里）时钉成面边上的一天，条不凭空消失。无段时时间面就是全部行的外包，交集恒为条本身。
 */
function visibleSpan(
  startKey: string,
  dueKey: string,
  rangeStartKey: string,
  rangeEndKey: string,
): { readonly startKey: string; readonly endKey: string } {
  if (dueKey < rangeStartKey) return { startKey: rangeStartKey, endKey: rangeStartKey };
  if (startKey > rangeEndKey) return { startKey: rangeEndKey, endKey: rangeEndKey };
  return {
    startKey: startKey < rangeStartKey ? rangeStartKey : startKey,
    endKey: dueKey > rangeEndKey ? rangeEndKey : dueKey,
  };
}
