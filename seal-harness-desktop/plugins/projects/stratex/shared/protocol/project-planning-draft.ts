import { z } from 'zod';

import { LocalSessionIdSchema } from './session-id.js';
import {
  PROJECT_ITERATION_MAX_CRITERIA_LENGTH,
  PROJECT_ITERATION_MAX_NAME_LENGTH,
  PROJECT_MILESTONE_MAX_NAME_LENGTH,
  PROJECT_MILESTONE_MAX_OBJECTIVE_LENGTH,
  projectPlanningErrorShape,
} from './project-planning.js';
import { ProjectIterationScheduleDaySchema } from './project-planning-schedule.js';

/**
 * 项目助理提出的**规划草案**（mil-11，ADR-0045）：新建里程碑（业务目标）草案、挂在已有里程碑下的
 * 新建迭代计划草案，以及渲染层取草案 / 清除草案两条入站通道的请求与响应。
 *
 * ⭐ 草案**什么都不新建**：它只在 Main 内存里按账号×会话暂存，渲染层审阅弹层确认时，提交的是
 *    表单当前值，走与手工新建**同一条** `project:milestone-create` / `project:iteration-create`。
 *    所以这里没有、也不会有「按草案新建」的请求形状。
 * ⭐ 草案内容**不进会话事件流**：事件流只带工具完成信号，草案本体只经本文件这条请求/响应通道。
 *
 * ⚠️ 三条红线同 `project-planning.ts`：
 *  1. 契约里没有账号字段（`strictObject` 让它不可表达），账号由 Main 从登录态推导；
 *  2. 没有任何会话正文字段（提示词、回答、命令参数）——自由文本只有草案本身的名称、目标说明、完成标准；
 *  3. 标识符与文案不含内核品牌词根。
 */

/** 每个会话至多暂存几份待审阅草案。到上限**拒绝暂存**，⛔ 不挤掉旧草案。 */
export const PROJECT_PLANNING_DRAFTS_PER_SESSION = 10;

/** 每个账号至多暂存几份待审阅草案（跨会话合计）。到上限同样拒绝，⛔ 不淘汰。 */
export const PROJECT_PLANNING_DRAFTS_PER_ACCOUNT = 50;

/** 迭代计划草案的完成标准至多几条；每条一行，拼成一段后仍在迭代完成标准的长度上界内。 */
export const PROJECT_PLANNING_DRAFT_MAX_CRITERIA = 20;

/** 完成标准单条的字符上限。 */
export const PROJECT_PLANNING_DRAFT_MAX_CRITERION_LENGTH = 500;

const entityIdSchema = z.string().uuid();

/** 成员身份主体（与规划域同界）。 */
const subjectSchema = z.string().min(1).max(256);

const noNul = (value: string): boolean => !value.includes('\0');

/** 草案名称：必填、去首尾空白后不空、不含 NUL；长度与手工新建同界。 */
const draftName = (maxLength: number) =>
  z
    .string()
    .min(1)
    .max(maxLength)
    .refine((value) => value.trim().length > 0, 'name must not be blank')
    .refine(noNul, 'NUL is forbidden');

/** 草案正文（目标说明 / 完成标准）：空串＝没写；不含 NUL。 */
const draftText = (maxLength: number) =>
  z.string().max(maxLength).refine(noNul, 'NUL is forbidden');

/**
 * 计划日期：**只有日期**（`YYYY-MM-DD`，真实日历日）。与手工表单的日期输入同形，
 * 预填进 `<input type="date">` 不需要任何换算；null＝没有给出。
 */
const draftDaySchema = ProjectIterationScheduleDaySchema.nullable();

const draftEnvelope = {
  /** Main 铸造的随机 UUID；确认新建时原样用作幂等键（`clientRequestId`）。 */
  draftId: entityIdSchema,
  /** 提出草案时会话绑定的项目；确认时新建在这个项目下。 */
  projectId: entityIdSchema,
  /** 暂存时刻（ISO 串，展示与排序用）。 */
  createdAt: z.string().max(64),
} as const;

/** 新建里程碑（业务目标）草案：字段与手工「新建里程碑」表单逐项对应。 */
export const ProjectMilestoneDraftSchema = z.strictObject({
  kind: z.literal('milestone'),
  ...draftEnvelope,
  name: draftName(PROJECT_MILESTONE_MAX_NAME_LENGTH),
  objectiveMd: draftText(PROJECT_MILESTONE_MAX_OBJECTIVE_LENGTH),
  startAt: draftDaySchema,
  dueAt: draftDaySchema,
  ownerSubject: subjectSchema.nullable(),
});

/**
 * 新建迭代计划草案：挂在**已有且未归档**的里程碑下。字段与手工「添加迭代计划」表单对应，
 * ⛔ 没有「关联本里程碑需求」——把需求排进迭代不在草案范围内。
 */
export const ProjectIterationDraftSchema = z.strictObject({
  kind: z.literal('iteration'),
  ...draftEnvelope,
  milestoneId: entityIdSchema,
  /** 提出草案时所属里程碑的名称快照，只供审阅时看清挂在哪里；新建只认 `milestoneId`。 */
  milestoneName: draftName(PROJECT_MILESTONE_MAX_NAME_LENGTH),
  name: draftName(PROJECT_ITERATION_MAX_NAME_LENGTH),
  /** 完成标准，每行一条（与手工表单提交的 `criteriaMd` 同形）。 */
  criteriaMd: draftText(PROJECT_ITERATION_MAX_CRITERIA_LENGTH),
  dueAt: draftDaySchema,
  ownerSubject: subjectSchema.nullable(),
});

export const ProjectPlanningDraftSchema = z.discriminatedUnion('kind', [
  ProjectMilestoneDraftSchema,
  ProjectIterationDraftSchema,
]);

/** `project:planning-draft-list`：取本账号某个会话里待审阅的规划草案。 */
export const ProjectPlanningDraftListRequestSchema = z.strictObject({
  sessionId: LocalSessionIdSchema,
});

export const ProjectPlanningDraftListResultSchema = z.discriminatedUnion('ok', [
  z.strictObject({
    ok: z.literal(true),
    drafts: z.array(ProjectPlanningDraftSchema).max(PROJECT_PLANNING_DRAFTS_PER_SESSION),
  }),
  z.strictObject({ ok: z.literal(false), ...projectPlanningErrorShape }),
]);

/**
 * 渲染层能报的处置结果：确认新建成功（`confirmed`）或用户忽略（`dismissed`）。
 * ⛔ 没有 `cleared`：换号、会话删除时的清空只在 Main 内部发生，渲染层表达不出来。
 */
export const ProjectPlanningDraftDiscardOutcomeSchema = z.enum(['confirmed', 'dismissed']);

/** `project:planning-draft-discard`：清除一份草案（确认新建成功之后，或用户忽略时）。 */
export const ProjectPlanningDraftDiscardRequestSchema = z.strictObject({
  sessionId: LocalSessionIdSchema,
  draftId: entityIdSchema,
  outcome: ProjectPlanningDraftDiscardOutcomeSchema,
});

export const ProjectPlanningDraftDiscardResultSchema = z.discriminatedUnion('ok', [
  z.strictObject({ ok: z.literal(true) }),
  z.strictObject({ ok: z.literal(false), ...projectPlanningErrorShape }),
]);

export type ProjectMilestoneDraft = z.infer<typeof ProjectMilestoneDraftSchema>;
export type ProjectIterationDraft = z.infer<typeof ProjectIterationDraftSchema>;
export type ProjectPlanningDraft = z.infer<typeof ProjectPlanningDraftSchema>;
export type ProjectPlanningDraftListRequest = z.infer<typeof ProjectPlanningDraftListRequestSchema>;
export type ProjectPlanningDraftListResult = z.infer<typeof ProjectPlanningDraftListResultSchema>;
export type ProjectPlanningDraftDiscardOutcome = z.infer<
  typeof ProjectPlanningDraftDiscardOutcomeSchema
>;
export type ProjectPlanningDraftDiscardRequest = z.infer<
  typeof ProjectPlanningDraftDiscardRequestSchema
>;
export type ProjectPlanningDraftDiscardResult = z.infer<
  typeof ProjectPlanningDraftDiscardResultSchema
>;
