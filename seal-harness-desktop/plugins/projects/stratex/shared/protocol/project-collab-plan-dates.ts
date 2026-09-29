import { z } from 'zod';

/**
 * 计划起止日期的共享契约（CORE-08，ADR-0042）：按计划区间交叠读取的时间段字段，与需求 / 任务写入的
 * 起止成对服务端码文案。
 *
 * ⭐ 时间段语义在服务端（`server/domain_plan_dates.py`）：`planFrom` / `planTo` 是时刻、**含左不含右**，
 *    一条计划按 UTC 日展开成 `[首日 00:00Z, 末日次日 00:00Z)` 再与时间段比交集；只有截止按截止当天算，
 *    截止为空的行不进结果。客户端只负责把「可见的那几天」换成两端时刻，⛔ 不在本地再按日期筛一遍。
 * ⚠️ 本模块只依赖 zod：`project-collab.ts` 与 `project-planning.ts` 都从这里取同一份字段，
 *    两处各写一份就会出现「需求分页收带时区的串、业务目标列表收不带的」这类分叉。
 */

/** 时间段一端：带时区偏移的 RFC 3339 时刻。上界与其它时刻字段同为 64 字符。 */
export const ProjectPlanWindowBoundSchema = z.string().max(64).datetime({ offset: true });

/** 请求形状里的两个可选字段（`project:requirement-page`、`project:milestone-list` 共用）。 */
export const projectPlanWindowShape = {
  /** 时间段起点（含）；缺席＝不限起点。 */
  planFrom: ProjectPlanWindowBoundSchema.optional(),
  /** 时间段终点（不含）；缺席＝不限终点。 */
  planTo: ProjectPlanWindowBoundSchema.optional(),
} as const;

/**
 * 两端都给时要求 `planFrom < planTo`。服务端对倒挂的时间段只回空结果（与截止时间筛选同口径），
 * 客户端先手拒绝——倒挂只可能是调用方拼错，空结果会被读成「这段没有排期」。
 */
export function refineProjectPlanWindow(
  value: { readonly planFrom?: string | undefined; readonly planTo?: string | undefined },
  context: z.RefinementCtx,
): void {
  if (
    value.planFrom !== undefined &&
    value.planTo !== undefined &&
    Date.parse(value.planFrom) >= Date.parse(value.planTo)
  ) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['planTo'],
      message: 'planTo must be later than planFrom',
    });
  }
}

/**
 * 需求 / 任务编辑框与认领框的两句日期提示——与服务端码**一一对应**（ADR-0042 决策 9）。
 * 编辑框就地提示直接用这里的句子，服务端拒绝时 `projectTodoPlanDatesServerCodeText` 回同一句，
 * 两处不各写一份字面量。
 */
export const PROJECT_TODO_PLAN_DATE_TEXT = {
  startRequiresDue: '填写开始时间后请同时填写截止时间',
  dateOrder: '开始时间不能晚于截止时间',
} as const;

/**
 * 待办新建 / 修改 / 认领的日期类**服务端业务码** → 提示句。认不出的码与缺席一律 `null`，
 * 调用方退回按通用 `code` 取的句子（⛔ 业务码不露给用户）。
 */
export function projectTodoPlanDatesServerCodeText(
  serverCode: string | null | undefined,
): string | null {
  switch (serverCode) {
    case 'start_requires_due':
      return PROJECT_TODO_PLAN_DATE_TEXT.startRequiresDue;
    case 'invalid_date_range':
      return PROJECT_TODO_PLAN_DATE_TEXT.dateOrder;
    default:
      return null;
  }
}

/** 视图可见的那一段（两端都有）：日历 42 格、时间轴一个月。 */
export interface ProjectPlanWindow {
  readonly planFrom: string;
  readonly planTo: string;
}
