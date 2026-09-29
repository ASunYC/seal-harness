import { z } from 'zod';

import { PROJECT_TODO_MAX_TITLE_LENGTH, TodoStatusSchema } from './project-collab.js';
import {
  PROJECT_ITERATION_MAX_NAME_LENGTH,
  PROJECT_MILESTONE_MAX_NAME_LENGTH,
  PROJECT_PLANNING_MAX_CLIENT_REQUEST_ID_LENGTH,
  PROJECT_PLANNING_MAX_PAGE_SIZE,
  ProjectIterationListItemSchema,
  ProjectIterationStatusSchema,
  projectPlanningErrorShape,
} from './project-planning.js';

/**
 * 规划域两条**整批写**的请求 / 响应契约：迭代排期整批保存（MIL-06，看板 / 甘特的「保存排期」）与
 * 安排需求整批保存（MIL-09，里程碑页「安排需求」的「保存安排」，见文件后半）。
 *
 * 以下先是迭代排期整批保存。
 *
 * ⭐ 一次「保存排期」是**一个**用户动作，所以是**一条**写请求：服务端单事务全有或全无——
 *    任一条版本过期 / 已达成 / 已归档 / 越出目标周期 ⇒ 零写入，失败信封整份回来，
 *    客户端草案原样保留。⛔ 别在客户端拆成逐条 `project:iteration-update`：第 k 条撞 409 时
 *    前 k-1 条已落盘并广播，排期停在半套。
 *
 * 与 `project-planning.ts` 分文件只为行数（那份已近上限）；失败信封**复用那一份**
 * （`projectPlanningErrorShape`），⛔ 不另立一族失败码。字段命名口径同那份：客户端
 * `camelCase`，snake_case 投影只在 Main 的 `collabPlanningClient`。
 *
 * ⚠️ 三条红线同 `project-planning.ts`：契约里没有账号字段（`strictObject` 让它不可表达）；
 *    没有任何正文字段（只有 id / 日期 / 版本）；标识符与文案不含内核品牌词根。
 */

/** 一次最多调整几轮：与服务端 `MAX_ITERATION_SCHEDULE_ITEMS`（＝一页上界）同界。 */
export const PROJECT_ITERATION_SCHEDULE_MAX_ITEMS = PROJECT_PLANNING_MAX_PAGE_SIZE;

const entityIdSchema = z.string().uuid();

/** `YYYY-MM-DD` 是不是一个真实存在的日历日（走 UTC 分量比对，⛔ 不经本地时区解析）。 */
export function isCalendarDayKey(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/u.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const probe = new Date(Date.UTC(year, month - 1, day));
  return (
    probe.getUTCFullYear() === year &&
    probe.getUTCMonth() === month - 1 &&
    probe.getUTCDate() === day
  );
}

/**
 * 排期日：**只有日期**（`YYYY-MM-DD`）。
 *
 * ⭐ 甘特只画到期点——契约层就不给「时分」与「开始日」留位置，结构上表达不出持续时间。
 */
export const ProjectIterationScheduleDaySchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/u)
  .refine(isCalendarDayKey, 'invalid calendar day');

/** 一条排期：哪一轮、改到哪一天、基于看到的哪个版本。 */
export const ProjectIterationScheduleItemSchema = z.strictObject({
  iterationId: entityIdSchema,
  dueAt: ProjectIterationScheduleDaySchema,
  expectedVersion: z.number().int().safe().positive(),
});

/**
 * `project:iteration-schedule-save`：一个业务目标下多轮到期日整批保存（**manager+**，服务端强判）。
 *
 * ⚠️ `clientRequestId` 必填，并在**同一份草案**的重试里保持不变（服务端幂等键）；草案内容
 *    （含期望版本）一变就得换新编号——同编号异内容服务端回 `idempotency_conflict`。
 * ⛔ 同一轮在一次请求里只能出现一次（两条会互相覆盖、谁赢取决于顺序）。
 */
export const ProjectIterationScheduleSaveRequestSchema = z
  .strictObject({
    projectId: entityIdSchema,
    milestoneId: entityIdSchema,
    clientRequestId: z.string().min(1).max(PROJECT_PLANNING_MAX_CLIENT_REQUEST_ID_LENGTH),
    items: z
      .array(ProjectIterationScheduleItemSchema)
      .min(1)
      .max(PROJECT_ITERATION_SCHEDULE_MAX_ITEMS),
  })
  .refine(
    (request) =>
      new Set(request.items.map((entry) => entry.iterationId)).size === request.items.length,
    { message: 'each iteration may appear once' },
  );

/** 版本冲突里的一条：哪一轮、服务端当前版本。 */
export const ProjectIterationScheduleConflictSchema = z.strictObject({
  iterationId: entityIdSchema,
  currentVersion: z.number().int().safe().positive(),
});

/**
 * 保存结果。
 *  - 成功：`changed=false` **不是失败**（回放命中，或每一轮本来就在所求那一天）；`iterations`
 *    按请求顺序给回每一轮的权威投影（与列表行逐字同形，版本已推进）。
 *  - 失败：`conflicts` **恒在**——仅 `serverCode === 'version_conflict'` 时非空（一次收齐全部
 *    过期条目），其余失败为空数组。
 * ⛔ 两个数组都**不设条数上界**：它们是服务端产出的，客户端再设一道只会让越界那次整体取不回来。
 */
export const ProjectIterationScheduleSaveResultSchema = z.discriminatedUnion('ok', [
  z.strictObject({
    ok: z.literal(true),
    changed: z.boolean(),
    iterations: z.array(ProjectIterationListItemSchema),
  }),
  z.strictObject({
    ok: z.literal(false),
    ...projectPlanningErrorShape,
    conflicts: z.array(ProjectIterationScheduleConflictSchema),
  }),
]);

export type ProjectIterationScheduleItem = z.infer<typeof ProjectIterationScheduleItemSchema>;
export type ProjectIterationScheduleConflict = z.infer<
  typeof ProjectIterationScheduleConflictSchema
>;
export type ProjectIterationScheduleSaveRequest = z.infer<
  typeof ProjectIterationScheduleSaveRequestSchema
>;
export type ProjectIterationScheduleSaveResult = z.infer<
  typeof ProjectIterationScheduleSaveResultSchema
>;

/* ══════════════════════════════════════════════════════════════════════════════
 * 安排需求整批保存（MIL-09）：`project:requirement-schedule-save`
 *
 * 一次「保存安排」把多条需求排进本业务目标的某一轮，或移出本业务目标——**一条**写请求，服务端
 * 单事务全有或全无（ADR-0038）。⛔ 别在客户端拆成逐条 `project:iteration-requirement-link` / `unlink`：
 * 第 k 条撞冲突时前 k-1 条已落盘并广播，安排停在半套。
 *
 * ⭐ 每条带**两道闸**：`expectedRequirementVersion`（你看到的那条需求还是它）与
 *    `expectedIterationId`（你看到它当前排在哪一轮，null ＝ 没排）。后者才挡得住「弹层开着时别人
 *    把它排去了别处」——单条关联不推进需求版本，只比版本挡不住。
 * ⛔ 不收轮次版本：安排需求不改轮次字段；轮次能不能接需求是状态（服务端加锁后判）。
 * ═══════════════════════════════════════════════════════════════════════════ */

/** 一次最多安排几条：与服务端 `MAX_REQUIREMENT_SCHEDULE_ITEMS`（＝一页上界）同界。 */
export const PROJECT_REQUIREMENT_SCHEDULE_MAX_ITEMS = PROJECT_PLANNING_MAX_PAGE_SIZE;

/** 一条安排：哪条需求、排进本目标哪一轮（null ＝ 不排）、基于看到的什么。 */
export const ProjectRequirementScheduleItemSchema = z.strictObject({
  requirementId: entityIdSchema,
  /** 目标轮次（必须属于本业务目标）。**null ＝ 不排**：移出本业务目标；排在别的目标下的不动。 */
  iterationId: entityIdSchema.nullable(),
  expectedRequirementVersion: z.number().int().safe().positive(),
  /** 看的人看到它**当前**排在哪一轮（任何目标下；null ＝ 没排）。 */
  expectedIterationId: entityIdSchema.nullable(),
});

/**
 * `project:requirement-schedule-save` 的请求（**manager+**，服务端强判）。
 *
 * ⚠️ `clientRequestId` 在**同一份安排**的重试里保持不变（服务端幂等键）；内容（含两道闸的期望值）
 *    一变就换新编号——同编号异内容服务端回 `idempotency_conflict`。
 * ⛔ 同一条需求在一次请求里只能出现一次。
 */
export const ProjectRequirementScheduleSaveRequestSchema = z
  .strictObject({
    projectId: entityIdSchema,
    /** 目标轮次所属里程碑；`null` ＝安排到未关联里程碑的轮次。 */
    milestoneId: entityIdSchema.nullable(),
    clientRequestId: z.string().min(1).max(PROJECT_PLANNING_MAX_CLIENT_REQUEST_ID_LENGTH),
    items: z
      .array(ProjectRequirementScheduleItemSchema)
      .min(1)
      .max(PROJECT_REQUIREMENT_SCHEDULE_MAX_ITEMS),
  })
  .refine(
    (request) =>
      new Set(request.items.map((entry) => entry.requirementId)).size === request.items.length,
    { message: 'each requirement may appear once' },
  );

/** 冲突清单里的一条：哪条需求、服务端当前版本、它当前排在哪一轮（只有 id）。 */
export const ProjectRequirementScheduleConflictSchema = z.strictObject({
  requirementId: entityIdSchema,
  currentVersion: z.number().int().safe().positive(),
  currentIterationId: entityIdSchema.nullable(),
});

/** 本请求号落下的一条改动：需求、排进的轮次（null ＝ 移出）、原轮次（可以在别的目标下）。 */
export const ProjectRequirementScheduleMoveSchema = z.strictObject({
  requirementId: entityIdSchema,
  iterationId: entityIdSchema.nullable(),
  previousIterationId: entityIdSchema.nullable(),
});

/**
 * 保存结果。
 *  - 成功：`changed=false` **不是失败**（回放命中，或每条本来就是所求状态）；`moves` 是本请求号
 *    落下的改动（回放时照原样给回）；`iterations` 是受影响的**本目标**轮次的权威投影（与列表行同形）。
 *    ⚠️ 被移出的原轮次若在别的目标下，不在 `iterations` 里——据 `moves[].previousIterationId` 刷那个目标。
 *  - 失败：`conflicts` **恒在**——仅 `serverCode === 'version_conflict'` 时可能非空，其余为空数组。
 * ⛔ 三个数组都不设条数上界：服务端产出的，客户端再设一道只会让越界那次整体取不回来。
 */
export const ProjectRequirementScheduleSaveResultSchema = z.discriminatedUnion('ok', [
  z.strictObject({
    ok: z.literal(true),
    changed: z.boolean(),
    iterations: z.array(ProjectIterationListItemSchema),
    moves: z.array(ProjectRequirementScheduleMoveSchema),
  }),
  z.strictObject({
    ok: z.literal(false),
    ...projectPlanningErrorShape,
    conflicts: z.array(ProjectRequirementScheduleConflictSchema),
  }),
]);

/**
 * 安排需求整批保存的**服务端业务码** → 报错条文案（与 `projectIterationUpdateServerCodeText` 同一条
 * 纪律：文案收口在共享层，⛔ 业务码不露给用户；认不出的码与缺席一律 `null`，调用方退回通用句）。
 * ⚠️ 版本冲突（`version_conflict`）**不在这里**：调用方据 `conflicts` 刷新并保留选择，另有专句。
 */
export function projectRequirementScheduleServerCodeText(
  serverCode: string | null | undefined,
): string | null {
  switch (serverCode) {
    case 'milestone_archived':
      return '该里程碑已归档，恢复后才能安排需求。';
    case 'milestone_not_found':
      return '该里程碑不存在或已不可见，请刷新后重试。';
    case 'iteration_archived':
      return '所选迭代计划已归档，请刷新后重新安排。';
    case 'iteration_outside_milestone':
    case 'iteration_not_found':
      return '所选迭代计划已不在本里程碑中，请刷新后重新安排。';
    case 'todo_not_found':
      return '有需求已删除或你已无权查看，请刷新后重新安排。';
    case 'requirement_kind_required':
      return '只有需求能安排进迭代计划。';
    case 'idempotency_retry':
      return '上一次保存仍在处理中，请稍后再点一次保存。';
    case 'idempotency_conflict':
      return '保存请求已失效，请再点一次保存（你的安排已保留）。';
    case 'project_archived':
      return '项目已归档，内容只读，恢复后才能继续操作。';
    default:
      return null;
  }
}

export type ProjectRequirementScheduleItem = z.infer<typeof ProjectRequirementScheduleItemSchema>;
export type ProjectRequirementScheduleConflict = z.infer<
  typeof ProjectRequirementScheduleConflictSchema
>;
export type ProjectRequirementScheduleMove = z.infer<typeof ProjectRequirementScheduleMoveSchema>;
export type ProjectRequirementScheduleSaveRequest = z.infer<
  typeof ProjectRequirementScheduleSaveRequestSchema
>;
export type ProjectRequirementScheduleSaveResult = z.infer<
  typeof ProjectRequirementScheduleSaveResultSchema
>;

/* ── 需求排期现状（MIL-09）：`project:requirement-placement-list` ─────────────────────
 *
 * 看的人**读得到**的活需求，每条带它当前排在哪一轮（轮次名、状态与所属业务目标名），外加服务端算的
 * 「未排进任何迭代」条数。「安排需求」弹层的候选、需求编辑器的「迭代信息」（带 `requirementId`）、
 * 里程碑页的「未排里程碑 N」都读它（ADR-0038）。
 * ⛔ 读侧不严于写侧（ADR-0035 第 6 条）：名称只按库层上界收，⛔ 不加写入侧才有的格式要求。
 */

const serverCountSchema = z.number().int().nonnegative();

/** 需求当前在排的那一轮。`milestoneId` / `milestoneName` 为 null ＝ 那一轮是「未关联」的旧轮次。 */
export const ProjectRequirementPlacementSchema = z.strictObject({
  iterationId: entityIdSchema,
  iterationName: z.string().min(1).max(PROJECT_ITERATION_MAX_NAME_LENGTH),
  iterationStatus: ProjectIterationStatusSchema,
  milestoneId: entityIdSchema.nullable(),
  milestoneName: z.string().min(1).max(PROJECT_MILESTONE_MAX_NAME_LENGTH).nullable(),
});

/** 一条候选：需求最小摘要 + 当前排期（null ＝ 没排进任何迭代）。版本随行，保存安排时递回。 */
export const ProjectRequirementPlacementItemSchema = z
  .strictObject({
    requirementId: entityIdSchema,
    title: z.string().min(1).max(PROJECT_TODO_MAX_TITLE_LENGTH),
    status: TodoStatusSchema,
    version: z.number().int().safe().positive(),
    placement: ProjectRequirementPlacementSchema.nullable(),
    parentId: entityIdSchema.nullable().optional(),
    ancestorPath: z
      .array(
        z.strictObject({
          requirementId: entityIdSchema,
          title: z.string().min(1).max(PROJECT_TODO_MAX_TITLE_LENGTH),
        }),
      )
      .optional(),
    hasParent: z.boolean().optional(),
    pathComplete: z.boolean().optional(),
    hasVisibleChildren: z.boolean().optional(),
  })
  .refine(
    (item) => {
      const fields = [
        item.parentId,
        item.ancestorPath,
        item.hasParent,
        item.pathComplete,
        item.hasVisibleChildren,
      ];
      return (
        fields.every((field) => field === undefined) || fields.every((field) => field !== undefined)
      );
    },
    { message: 'requirement hierarchy must be complete when supplied' },
  );

export const ProjectRequirementPlacementListRequestSchema = z
  .strictObject({
    projectId: entityIdSchema,
    page: z.number().int().positive().optional(),
    pageSize: z.number().int().positive().max(PROJECT_PLANNING_MAX_PAGE_SIZE).optional(),
    /** 关键字：匹配需求标题或完整/短 ID；空串不传。 */
    q: z.string().min(1).max(PROJECT_TODO_MAX_TITLE_LENGTH).optional(),
    /** 只取这一条（需求编辑器用）；看不见或不存在 ⇒ 空页，与不存在不可区分。 */
    requirementId: entityIdSchema.optional(),
    groupRootId: entityIdSchema.optional(),
  })
  .refine(
    (input) =>
      input.groupRootId === undefined ||
      (input.q === undefined && input.requirementId === undefined && (input.page ?? 1) === 1),
    { message: 'group query cannot include search filters or subsequent pages' },
  );

/**
 * ⭐ `unscheduledTotal` 是「未排里程碑 N」的**权威值**：不受 `q` 影响，⛔ 渲染层不自算
 *    （它看不见别人的个人需求，也拿不全分页之外的行）。计数一律不设客户端上界。
 */
export const ProjectRequirementPlacementListResultSchema = z
  .discriminatedUnion('ok', [
    z.strictObject({
      ok: z.literal(true),
      items: z.array(ProjectRequirementPlacementItemSchema),
      total: serverCountSchema,
      page: z.number().int().positive(),
      pageSize: z.number().int().positive(),
      unscheduledTotal: serverCountSchema,
      // 旧服务可缺省；缺省不能证明整组完整。
      selectionScope: z.enum(['page', 'group']).optional(),
      groupRootId: entityIdSchema.nullable().optional(),
      groupComplete: z.boolean().optional(),
    }),
    z.strictObject({ ok: z.literal(false), ...projectPlanningErrorShape }),
  ])
  .refine(
    (result) => {
      if (!result.ok) return true;
      if (result.selectionScope === undefined) {
        return result.groupRootId === undefined && result.groupComplete === undefined;
      }
      if (result.selectionScope === 'page') {
        return result.groupRootId === null && result.groupComplete === false;
      }
      return (
        result.groupComplete === true &&
        result.groupRootId != null &&
        result.page === 1 &&
        result.pageSize === PROJECT_REQUIREMENT_SCHEDULE_MAX_ITEMS &&
        result.total === result.items.length &&
        result.total <= PROJECT_REQUIREMENT_SCHEDULE_MAX_ITEMS &&
        new Set(result.items.map((item) => item.requirementId)).size === result.items.length &&
        result.items.every((item) => item.ancestorPath !== undefined) &&
        result.items.some((item) => item.requirementId === result.groupRootId)
      );
    },
    { message: 'invalid requirement selection completeness' },
  );

export type ProjectRequirementPlacement = z.infer<typeof ProjectRequirementPlacementSchema>;
export type ProjectRequirementPlacementItem = z.infer<typeof ProjectRequirementPlacementItemSchema>;
export type ProjectRequirementPlacementListRequest = z.infer<
  typeof ProjectRequirementPlacementListRequestSchema
>;
export type ProjectRequirementPlacementListResult = z.infer<
  typeof ProjectRequirementPlacementListResultSchema
>;
