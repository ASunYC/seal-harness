import type {
  ProjectIterationStatus,
  ProjectMilestoneIterationSummary,
} from '@shared/protocol/project-planning.js';

/**
 * 里程碑总览（MIL-04）的**纯展示**辅助：状态/进度文案与日期格式化。
 *
 * ⚠️ 这里出现的数字都由服务端聚合给出，本模块只做**呈现**（格式化、算个百分比给进度条），
 * ⛔ 不重算计数、不遍历需求。
 */

/**
 * 迭代生命周期状态中文名（`open` = 待达成 / `completed` = 已达成）。
 *
 * ⭐ 逐字对齐原型 `milestoneStatus27`（「已达成 / 已逾期 / 待达成」）：未达成的轮次叫「待达成」，
 *    ⛔ 不叫「进行中」——那是待办 `inProgress` 的词（`project-format.ts`），混用会让一轮迭代
 *    读起来像一条正在做的需求。列表徽标与看板状态签都取这一处。
 * ⚠️ 这**不是**待办四值状态（notStarted/inProgress/inReview/done/cancelled）——轮次问的是
 * 「这轮达成没」，需求问的是「这条做到哪步」。合成一套，「迭代达成不写需求完成状态」那条
 * 判据就没落点了。`Record<ProjectIterationStatus, string>` 让加档时编译期炸这一处。
 */
export const ITERATION_STATUS_LABELS: Readonly<Record<ProjectIterationStatus, string>> = {
  open: '待达成',
  completed: '已达成',
};

/** 负责人缺席（`null`）时的占位——与原型「待分配」同词。 */
export const PLANNING_UNASSIGNED_OWNER_LABEL = '待分配';

/** 计划日期未排时的占位——与原型「待安排」同词。 */
export const PLANNING_UNSCHEDULED_LABEL = '待安排';

/**
 * 计划日期展示：`YYYY-MM-DD`；`null` → 「待安排」；解析失败原样返回
 * （展示层不替服务端修数据，与 `project-format` 同一纪律）。
 */
export function formatPlanningDate(value: string | null): string {
  if (!value) return PLANNING_UNSCHEDULED_LABEL;
  // ⭐ date-only 日键（排期草案叠加后就是它）原样返回：⛔ 不经 `Date.parse`——那会按 UTC 零点
  //    解析再取本地日，在负时区把它推到前一天（MIL-06 甘特/看板/列表共用同一份叠加结果）。
  if (/^\d{4}-\d{2}-\d{2}$/u.test(value)) return value;
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) return value;
  const date = new Date(parsed);
  const pad = (part: number): string => String(part).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** 目标计划周期「start — end」（两端都可「待安排」）。 */
export function formatPlanningPeriod(startAt: string | null, dueAt: string | null): string {
  return `${formatPlanningDate(startAt)} — ${formatPlanningDate(dueAt)}`;
}

/**
 * 迭代达成进度百分比（0..100，取整），仅供进度条宽度。
 *
 * ⭐ 分子分母都取**服务端授权聚合** `iterationSummary` 里的 completed/total（total 只数
 *    未归档轮次）——这是把两个服务端数字换算成一个宽度，**不是**本地重算计数。
 * ⚠️ total = 0（还没有轮次）时返回 0，不做 0/0。
 */
export function milestoneProgressPercent(summary: ProjectMilestoneIterationSummary): number {
  if (summary.total <= 0) return 0;
  return Math.round((summary.completed / summary.total) * 100);
}

/** 需求短标识（列表里跳读用）：UUID 取前 8 位。纯展示，跳转仍认完整 id。 */
export function shortRequirementId(requirementId: string): string {
  return requirementId.slice(0, 8);
}
