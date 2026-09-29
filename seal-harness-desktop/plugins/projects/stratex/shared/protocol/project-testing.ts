import { z } from 'zod';

import {
  PROJECT_FILE_MAX_BYTES,
  PROJECT_TODO_ACCEPTANCE_TEXT_MAX_LENGTH,
  PROJECT_TODO_LABEL_MAX_LENGTH,
  PROJECT_TODO_MAX_CONSTRAINTS_LENGTH,
  PROJECT_TODO_MAX_DESCRIPTION_LENGTH,
  PROJECT_TODO_MAX_LABELS,
  PROJECT_TODO_MAX_TITLE_LENGTH,
  ProjectCollabErrorCodeSchema,
  ProjectCollabReferenceCodeSchema,
  ProjectCollabServerCodeSchema,
  TodoItemKindSchema,
  TodoPrioritySchema,
  TodoSchema,
  TodoStatusSchema,
} from './project-collab.js';

/**
 * 整需求提测（TST-02）的**客户端契约**：测试轮次、五面快照、三条通道的请求 / 结果与业务码文案。
 *
 * 服务端契约在 `scripts/collab-service/server/routes_testing.py`（端点）与 `domain_testing.py`
 * （判定与序列化）。线协议是 snake_case，这里是 camelCase；两者之间的投影**只在** Main 的
 * `collabTestingWireMapping.ts` 一处，⛔ SDK、store、组件里不许再写第二份字段名映射。
 *
 * ⭐ D-TEST-01 已定案选 A（独立测试负责人）：测试负责人 ≠ 当前需求处理人、≠ 本轮提交人，
 *    判定在服务端 `ensure_reviewer_independent`。渲染层过滤候选人只是「不摆必错入口」，⛔ 不是门。
 *
 * ⚠️ 三条红线由本文件的 schema 结构性承载（与 `project-planning.ts` 同一份纪律）：
 *  1. 【账号】请求里**没有** accountKey 或提交人字段——提交人是令牌里的那个人，`strictObject`
 *     让「多带一个字段」都不可表达。
 *  2. 【快照】请求里**没有**任何快照字段：五面快照由服务端在事务里构造（契约「不接受任意 task
 *     snapshots」），客户端连表达都表达不出来。
 *  3. 【埋点红线】整体完成说明是用户亲笔：只进 REST，⛔ 不进事件面、日志与埋点。
 */

/** 整体完成说明的字符上限，与服务端 `MAX_TEST_ROUND_SUMMARY_CHARS` 同界。 */
export const PROJECT_TEST_ROUND_MAX_SUMMARY_LENGTH = 4_000;

/** 一轮至多选几份交付物，与服务端 `MAX_TEST_ROUND_ARTIFACTS` 同界。 */
export const PROJECT_TEST_ROUND_MAX_ARTIFACTS = 50;

/** 幂等键（`clientRequestId`）上界，与服务端 `MAX_CLIENT_REQUEST_ID_CHARS` 同界。 */
export const PROJECT_TEST_ROUND_MAX_CLIENT_REQUEST_ID_LENGTH = 128;

/** 轮次列表一页：缺省 30、上界 50（与服务端 `TEST_ROUND_DEFAULT_PAGE_LIMIT` / `MAX` 同界）。 */
export const PROJECT_TEST_ROUND_DEFAULT_PAGE_SIZE = 30;
export const PROJECT_TEST_ROUND_MAX_PAGE_SIZE = 50;

/** 项目级测试模式判定里至多列几条活动轮次（服务端 `MAX_TEST_MODE_ROUNDS`）。 */
export const PROJECT_TEST_MODE_MAX_ROUNDS = 100;

/** 「未完成任务」拒绝体里至多带回几个 id（服务端 `MAX_UNFINISHED_TASK_IDS`，总数另给）。 */
export const PROJECT_TEST_ROUND_MAX_UNFINISHED_TASK_IDS = 50;

/**
 * 轮次状态闭集（与服务端迁移 0025 的 CHECK 逐字一致）。
 *
 * ⚠️ 这**不是**待办的五值状态集：需求问的是「做到哪一步了」，轮次问的是「这一次提交测得怎么样」。
 *    需求进待验收是服务端在同一个事务里顺带推进的，⛔ 渲染层不从轮次状态反推需求状态。
 */
export const ProjectTestRoundStateSchema = z.enum([
  'queued',
  'testing',
  'passed',
  'returned',
  'withdrawn',
]);

/** 活动轮次（一条需求同时至多一个，库层部分唯一索引兜底）。 */
export const PROJECT_TEST_ROUND_ACTIVE_STATES = ['queued', 'testing'] as const;

const entityIdSchema = z.string().uuid();
const subjectSchema = z.string().min(1).max(256);
const timestampSchema = z.string().max(64);
const clientRequestIdSchema = z
  .string()
  .min(1)
  .max(PROJECT_TEST_ROUND_MAX_CLIENT_REQUEST_ID_LENGTH);

/**
 * 服务端计数（轮号 / 版本 / 条数）：⛔ **不设客户端上界**。越界的代价是 `mapArray` 一条坏全批坏，
 * 表现是整页取不回来，而不是少显示一行（`childTotal` 加 `.max(500)` 那次事故的形状）。
 */
const positiveCountSchema = z.number().int().safe().positive();
const nonnegativeCountSchema = z.number().int().safe().nonnegative();

/** 用户亲笔正文：只拒 NUL（与既有协议同口径；服务端库也存不进 NUL）。 */
const noNul = (value: string): boolean => !value.includes('\0');

/**
 * 一轮测试的**摘要**（服务端 `serialize_test_round`）。
 *
 * 线协议字段逐条对应：`id` / `project_id` / `requirement_id` / `round_no` / `state` /
 * `submitted_by_subject` / `reviewer_subject` / `version` / `created_at` / `updated_at`。
 *
 * ⚠️ 摘要**没有**整体完成说明：项目级测试模式判定一次列出多轮，正文只在需求维度的轮次列表与
 *    单轮详情里给（`ProjectTestRoundDetailSchema`）。strict 让「摘要里夹带正文」过不了。
 * ⚠️ 提交人与测试负责人都只有 subject，**没有显示名快照**：显示名从成员名册解析，取不到用 subject。
 */
export const ProjectTestRoundSchema = z.strictObject({
  id: entityIdSchema,
  projectId: entityIdSchema,
  requirementId: entityIdSchema,
  roundNo: positiveCountSchema,
  state: ProjectTestRoundStateSchema,
  submittedBySubject: subjectSchema,
  reviewerSubject: subjectSchema.nullable(),
  version: positiveCountSchema,
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
});

/**
 * 一轮测试的**完整**出参：摘要 + 整体完成说明（服务端 `serialize_test_round_detail`）。
 *
 * ⚠️ 入站上界取出站上界的**两倍**：服务端按码点计 4000，而这里的 `length` 按 UTF-16 单元计——
 *    四字节字符在这里占两个单元。按 4000 收会让一段满长的带表情说明整页解析失败。
 *    出站（`ProjectRequirementSubmitRequestSchema`）照旧按 4000 收紧（客户端拒的服务端必拒）。
 */
export const ProjectTestRoundDetailSchema = ProjectTestRoundSchema.extend({
  summary: z
    .string()
    .max(PROJECT_TEST_ROUND_MAX_SUMMARY_LENGTH * 2)
    .refine(noNul, 'NUL is forbidden'),
});

/* ── 五面快照（建轮次那一刻**物化**的值，⛔ 不是会跟随当前记录的外键）──────────────── */

/** 需求面：需求当时的字段逐个拷进快照。 */
export const ProjectTestRoundSnapshotRequirementSchema = z.strictObject({
  id: entityIdSchema,
  title: z.string().min(1).max(PROJECT_TODO_MAX_TITLE_LENGTH),
  description: z.string().max(PROJECT_TODO_MAX_DESCRIPTION_LENGTH),
  priority: TodoPrioritySchema,
  status: TodoStatusSchema,
  constraintsText: z.string().max(PROJECT_TODO_MAX_CONSTRAINTS_LENGTH),
  labels: z
    .array(z.string().min(1).max(PROJECT_TODO_LABEL_MAX_LENGTH))
    .max(PROJECT_TODO_MAX_LABELS),
  itemKind: TodoItemKindSchema,
});

/** 任务面：沿 task 边下降的任务清单（各自 id / 父项 / 标题 / 状态）。⛔ 条数不设上界。 */
export const ProjectTestRoundSnapshotTaskSchema = z.strictObject({
  id: entityIdSchema,
  parentId: entityIdSchema.nullable(),
  title: z.string().min(1).max(PROJECT_TODO_MAX_TITLE_LENGTH),
  status: TodoStatusSchema,
  itemKind: TodoItemKindSchema,
});

/** 标准面：当时的验收清单（各条序号 / 正文 / 勾选）。 */
export const ProjectTestRoundSnapshotCriterionSchema = z.strictObject({
  ordinal: positiveCountSchema,
  text: z.string().min(1).max(PROJECT_TODO_ACCEPTANCE_TEXT_MAX_LENGTH),
  checked: z.boolean(),
});

/**
 * 附件面：提测选定的**版本行**冻结元数据。
 *
 * ⭐ 键是 `fileVersionId`（不可变的资产版本），**不是** `assetId`：存资产 id 再在读时解析当前版本，
 *    会让「提测时那一版」跟着资产的新版本走——那正是快照要防的事。
 */
export const ProjectTestRoundSnapshotAttachmentSchema = z.strictObject({
  fileVersionId: entityIdSchema,
  assetId: entityIdSchema,
  versionNo: positiveCountSchema,
  filename: z.string().max(512),
  contentSha256: z.string().regex(/^[0-9a-f]{64}$/u, 'invalid sha256'),
  byteSize: z.number().int().safe().nonnegative().max(PROJECT_FILE_MAX_BYTES),
});

/**
 * 门槛面：建轮次那一刻项目约定的提交测试门槛（`gate_version` + 四个布尔的闭集）+ 本轮必过判据摘要。
 * ⛔ 闭集外的门槛键一律过不了（strict）——「按单任务提测」之类的开关连表达都表达不出来。
 */
export const ProjectTestRoundSnapshotGateSchema = z.strictObject({
  gateVersion: positiveCountSchema,
  submissionGate: z.strictObject({
    requireTasks: z.boolean(),
    requireAllTasksDone: z.boolean(),
    requireCriteria: z.boolean(),
    requireReadyArtifacts: z.boolean(),
  }),
  requiredItemCount: nonnegativeCountSchema,
  requiredItemOrdinals: z.array(positiveCountSchema),
});

export const ProjectTestRoundSnapshotSchema = z.strictObject({
  requirement: ProjectTestRoundSnapshotRequirementSchema,
  tasks: z.array(ProjectTestRoundSnapshotTaskSchema),
  criteria: z.array(ProjectTestRoundSnapshotCriterionSchema),
  attachments: z.array(ProjectTestRoundSnapshotAttachmentSchema),
  gate: ProjectTestRoundSnapshotGateSchema,
});

export type ProjectTestRoundState = z.infer<typeof ProjectTestRoundStateSchema>;
export type ProjectTestRound = z.infer<typeof ProjectTestRoundSchema>;
export type ProjectTestRoundDetail = z.infer<typeof ProjectTestRoundDetailSchema>;
export type ProjectTestRoundSnapshot = z.infer<typeof ProjectTestRoundSnapshotSchema>;

/** 这一轮是不是还在测（判定收口成一个函数：调用点各写一遍闭集迟早漏一档）。 */
export function isProjectTestRoundActive(round: Pick<ProjectTestRound, 'state'>): boolean {
  return (PROJECT_TEST_ROUND_ACTIVE_STATES as readonly string[]).includes(round.state);
}

/* ══════════════════════════════════════════════════════════════════════════════
 * 请求 / 结果契约（三条通道）
 *
 * 失败信封复用协作面那一套（`code` / `referenceCode` / `serverCode` 三个闭集都从
 * `project-collab.ts` 导入），本地只重复「把它们拼成一个信封」这一步——与
 * `projectPlanningErrorShape` 同一个理由：那份 shape 未导出，导出属另一条线的改动面。
 * ═══════════════════════════════════════════════════════════════════════════ */

export const projectTestingErrorShape = {
  code: ProjectCollabErrorCodeSchema,
  message: z.string().max(2_048),
  referenceCode: ProjectCollabReferenceCodeSchema,
  serverCode: ProjectCollabServerCodeSchema.optional(),
} as const;

/**
 * `project:requirement-submit`：需求处理人把整条需求提交一轮测试（服务端强判处理人、独立测试负责人、
 * 版本、状态与项目门槛）。
 *
 * ⭐ `clientRequestId` 必填：服务端把 (项目, 需求, 提交人, 请求号) 折成新轮次的主键。同一次打开弹窗
 *    内的重试**沿用同一个号**——换号等于把幂等关掉。
 * ⭐ `artifactVersionIds` 是**资产版本** id（不可变），不是资产 id；去重由服务端做。
 * ⚠️ `projectId` 不进请求体（服务端从需求推项目），它是上下文：Main 据此核对回来的轮次确实属于
 *    调用方以为的那个项目，对不上即判不可信响应。
 * ⚠️ 整体完成说明「去空白后非空」由服务端判（`submission_summary_required`），契约这一层只挡上界与 NUL。
 */
export const ProjectRequirementSubmitRequestSchema = z.strictObject({
  projectId: entityIdSchema,
  requirementId: entityIdSchema,
  expectedVersion: positiveCountSchema,
  clientRequestId: clientRequestIdSchema,
  summary: z.string().max(PROJECT_TEST_ROUND_MAX_SUMMARY_LENGTH).refine(noNul, 'NUL is forbidden'),
  reviewerSubject: subjectSchema.nullable(),
  artifactVersionIds: z.array(entityIdSchema).max(PROJECT_TEST_ROUND_MAX_ARTIFACTS),
});

/**
 * 提交结果。
 *
 * 成功：`submission` 是新建（或回放）的那一轮、`todo` 是推进后的权威需求；`replayed=true` ＝ 同号同内容
 * 的重试命中了原轮次（服务端 200，不发第二次事件）——⛔ 它**不是失败**，也别据此再提交一次。
 *
 * 失败在协作面信封之上**恒带**四个附加键（取不到给 null，让结构只有一种形状）：
 *  - `currentVersion`：409 `version_conflict` 带回的当前版本；
 *  - `unfinishedTaskIds` / `unfinishedTaskCount`：422 `submission_tasks_unfinished` 带回的未完成任务
 *    （id 至多 50 个，总数另给）；
 *  - `legacyOpenReviewCount`：409 `open_legacy_review` 带回的旧流程待验收条数（判定型计数，不叠可见性）。
 */
export const ProjectRequirementSubmitResultSchema = z.discriminatedUnion('ok', [
  z.strictObject({
    ok: z.literal(true),
    submission: ProjectTestRoundDetailSchema,
    todo: TodoSchema,
    replayed: z.boolean(),
  }),
  z.strictObject({
    ok: z.literal(false),
    ...projectTestingErrorShape,
    currentVersion: positiveCountSchema.nullable(),
    unfinishedTaskIds: z
      .array(entityIdSchema)
      .max(PROJECT_TEST_ROUND_MAX_UNFINISHED_TASK_IDS)
      .nullable(),
    unfinishedTaskCount: nonnegativeCountSchema.nullable(),
    legacyOpenReviewCount: nonnegativeCountSchema.nullable(),
  }),
]);

/**
 * `project:requirement-submissions`：一条需求的测试轮次（最新在前，游标分页）。
 * 权限门与需求本身同一道：看不见的需求 404（与「不存在」不可区分）。
 */
export const ProjectRequirementSubmissionsRequestSchema = z.strictObject({
  projectId: entityIdSchema,
  requirementId: entityIdSchema,
  cursor: z.string().min(1).max(1_024).nullable().optional(),
  limit: z.number().int().min(1).max(PROJECT_TEST_ROUND_MAX_PAGE_SIZE).optional(),
});

export const ProjectRequirementSubmissionsResultSchema = z.discriminatedUnion('ok', [
  z
    .strictObject({
      ok: z.literal(true),
      submissions: z.array(ProjectTestRoundDetailSchema).max(PROJECT_TEST_ROUND_MAX_PAGE_SIZE),
      hasMore: z.boolean(),
      nextCursor: z.string().min(1).max(1_024).nullable(),
    })
    .superRefine((value, context) => {
      // 与待办列表页逐字同一条：游标与 hasMore 同生同灭，否则调用方会停在半途而不报错。
      if (value.hasMore !== (value.nextCursor !== null)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['nextCursor'],
          message: 'nextCursor must be present exactly when hasMore is true',
        });
      }
    }),
  z.strictObject({ ok: z.literal(false), ...projectTestingErrorShape }),
]);

/**
 * `project:submission-detail`：单轮详情（轮次 + 五面快照）。轮次不存在、跨项目、所属需求不可见一律
 * 同一个 404 `submission_not_found`——不以拒绝形态泄漏存在性。
 */
export const ProjectSubmissionDetailRequestSchema = z.strictObject({
  projectId: entityIdSchema,
  submissionId: entityIdSchema,
});

export const ProjectSubmissionDetailResultSchema = z.discriminatedUnion('ok', [
  z.strictObject({
    ok: z.literal(true),
    submission: ProjectTestRoundDetailSchema,
    snapshot: ProjectTestRoundSnapshotSchema,
  }),
  z.strictObject({ ok: z.literal(false), ...projectTestingErrorShape }),
]);

export type ProjectRequirementSubmitRequest = z.infer<typeof ProjectRequirementSubmitRequestSchema>;
export type ProjectRequirementSubmitResult = z.infer<typeof ProjectRequirementSubmitResultSchema>;
export type ProjectRequirementSubmissionsRequest = z.infer<
  typeof ProjectRequirementSubmissionsRequestSchema
>;
export type ProjectRequirementSubmissionsResult = z.infer<
  typeof ProjectRequirementSubmissionsResultSchema
>;
export type ProjectSubmissionDetailRequest = z.infer<typeof ProjectSubmissionDetailRequestSchema>;
export type ProjectSubmissionDetailResult = z.infer<typeof ProjectSubmissionDetailResultSchema>;

/**
 * 整需求提交的**服务端业务码** → 用户可读中文（就地覆盖通用文案）。
 *
 * 与 `projectTodoWriteServerCodeText` 同一条纪律：文案收口在共享层，⛔ 业务码不露给用户；认不出的码与
 * 缺席一律 `null`，调用方退回按失败分档 `code` 取的通用句。编号照旧取 `code` 那一格。
 *
 * ⚠️ 两个幂等码**不能塌缩**：`idempotency_retry` 是「稍后重试就有结果」，`idempotency_conflict` 是
 *    「这次内容变了，关掉重来」——说成一句就把前者变成死路。
 * ⚠️ `open_legacy_review` 只说条数（服务端带回的判定型计数），⛔ 不说是哪几条：看不见的个人条目不外泄。
 *    条数取不到时去掉数字，⛔ 不编一个。
 */
export function projectRequirementSubmitServerCodeText(
  serverCode: string | null | undefined,
  context: { readonly legacyOpenReviewCount?: number | null } = {},
): string | null {
  switch (serverCode) {
    case 'optional_test_reviewer_unsupported':
      return '当前服务尚不支持待认领测试，请升级服务或指定测试负责人。';
    case 'reviewer_already_assigned':
      return '本轮测试已有人负责，请刷新。';
    case 'reviewer_not_independent':
      return '测试负责人不能是需求处理人或本轮提交人，请选择其他成员。';
    case 'reviewer_not_member':
      return '所选测试负责人已不在项目里，请重新选择。';
    case 'reviewer_not_editor':
      return '观察者不能担任测试负责人，请选择可编辑成员。';
    case 'submitter_not_assignee':
      return '只有需求处理人可以整体提交测试。';
    case 'submission_summary_required':
      return '请填写整体完成说明。';
    case 'submission_criteria_required':
      return '请先填写这条需求的通过标准。';
    case 'submission_tasks_required':
      return '当前提交规则要求至少一项任务，请先拆分执行任务。';
    case 'submission_tasks_unfinished':
      return '当前提交规则要求完成全部任务，还有任务没有完成。';
    case 'submission_tasks_restricted':
      return '这条需求下有你看不到的任务，需管理者核对任务范围后再提交。';
    case 'submission_artifacts_required':
      return '当前提交规则要求至少一份本轮交付物。';
    case 'artifact_not_found':
    case 'artifact_not_ready':
      return '所选交付物已不可用，请重新选择。';
    case 'active_round_exists':
      return '这条需求已在测试中，无需重复提交。';
    case 'legacy_review_in_progress':
      return '这条需求还在原流程待验收中，请先按原流程验收或打回。';
    case 'requirement_not_submittable':
      return '已完成或已取消的需求不能提交测试。';
    case 'open_legacy_review':
      return typeof context.legacyOpenReviewCount === 'number'
        ? `项目里还有 ${String(context.legacyOpenReviewCount)} 条旧评审未结，请先按旧流程完成评审再提测。`
        : '项目里还有旧评审未结，请先按旧流程完成评审再提测。';
    case 'version_conflict':
      return '需求已被他人修改，请刷新后重新提交。';
    case 'idempotency_retry':
      return '提交正在处理中，请稍后重试。';
    case 'idempotency_conflict':
      return '本次提交内容已变化，请关闭后重新提交。';
    case 'not_a_requirement':
      return '只有需求可以整体提测，子任务不单独提测。';
    // 个人需求只有创建者看得见，没有「另一位成员来测」可言：先共享给项目才有测试负责人可选。
    case 'personal_requirement_not_submittable':
      return '私有需求须先共享给项目，才能提交测试。';
    default:
      return null;
  }
}

/** 游标与分页状态须一致，避免列表静默截断。 */
export function refineTestingPage(
  value: { readonly hasMore: boolean; readonly nextCursor: string | null },
  context: z.RefinementCtx,
): void {
  if (value.hasMore !== (value.nextCursor !== null)) {
    context.addIssue({
      code: 'custom',
      path: ['nextCursor'],
      message: 'nextCursor must be present exactly when hasMore is true',
    });
  }
}

/** 轮次写动作：幂等键和轮次版本均由调用方固定，重试不得隐式换号。 */
export const ProjectTestRoundActionRequestSchema = z.discriminatedUnion('action', [
  z.strictObject({
    action: z.literal('withdraw'),
    projectId: entityIdSchema,
    submissionId: entityIdSchema,
    expectedVersion: positiveCountSchema,
    clientRequestId: clientRequestIdSchema,
    reason: z.string().trim().min(1).max(8000),
  }),
  z.strictObject({
    action: z.literal('decision'),
    projectId: entityIdSchema,
    submissionId: entityIdSchema,
    expectedVersion: positiveCountSchema,
    clientRequestId: clientRequestIdSchema,
    decision: z.enum(['passed', 'returned']),
    reason: z.string().max(8000),
  }),
  z.strictObject({
    action: z.literal('reviewer'),
    projectId: entityIdSchema,
    submissionId: entityIdSchema,
    expectedVersion: positiveCountSchema,
    clientRequestId: clientRequestIdSchema,
    reviewerSubject: subjectSchema,
    claim: z.boolean().optional(),
    reason: z.string().trim().min(1).max(8000),
  }),
]);
export const ProjectTestRoundActionResultSchema = z.discriminatedUnion('ok', [
  z.strictObject({
    ok: z.literal(true),
    submission: ProjectTestRoundDetailSchema,
    todo: TodoSchema.optional(),
  }),
  z.strictObject({
    ok: z.literal(false),
    ...projectTestingErrorShape,
    currentVersion: positiveCountSchema.nullable(),
  }),
]);
export const ProjectTestRoundsRequestSchema = z.strictObject({
  projectId: entityIdSchema,
  cursor: z.string().max(1024).nullable().optional(),
  limit: z.number().int().min(1).max(50).optional(),
  state: ProjectTestRoundStateSchema.optional(),
});
export const ProjectTestRoundsResultSchema = z.discriminatedUnion('ok', [
  z
    .strictObject({
      ok: z.literal(true),
      items: z.array(ProjectTestRoundDetailSchema).max(50),
      total: nonnegativeCountSchema,
      hasMore: z.boolean(),
      nextCursor: z.string().min(1).max(1024).nullable(),
    })
    .superRefine(refineTestingPage),
  z.strictObject({ ok: z.literal(false), ...projectTestingErrorShape }),
]);
export type ProjectTestRoundActionRequest = z.infer<typeof ProjectTestRoundActionRequestSchema>;
export type ProjectTestRoundActionResult = z.infer<typeof ProjectTestRoundActionResultSchema>;
export type ProjectTestRoundsRequest = z.infer<typeof ProjectTestRoundsRequestSchema>;
export type ProjectTestRoundsResult = z.infer<typeof ProjectTestRoundsResultSchema>;

/** 不可变动作历史只读取服务端签署的身份、原因和时间。 */
export const ProjectTestRoundHistorySchema = z.strictObject({
  id: entityIdSchema,
  action: z.enum(['withdraw', 'decision', 'reviewer-reassigned']),
  actorSubject: subjectSchema,
  reason: z.string().max(8000),
  createdAt: z.string().min(1).max(64),
});
export const ProjectTestRoundActionsRequestSchema = z.strictObject({
  projectId: entityIdSchema,
  submissionId: entityIdSchema,
  cursor: z.string().min(1).max(512).nullable().optional(),
  limit: z.number().int().min(1).max(50).optional(),
});
export const ProjectTestRoundActionsResultSchema = z.discriminatedUnion('ok', [
  z
    .strictObject({
      ok: z.literal(true),
      items: z.array(ProjectTestRoundHistorySchema).max(50),
      total: nonnegativeCountSchema,
      hasMore: z.boolean(),
      nextCursor: z.string().min(1).max(512).nullable(),
    })
    .superRefine(refineTestingPage),
  z.strictObject({ ok: z.literal(false), ...projectTestingErrorShape }),
]);
export type ProjectTestRoundActionsRequest = z.infer<typeof ProjectTestRoundActionsRequestSchema>;
export type ProjectTestRoundActionsResult = z.infer<typeof ProjectTestRoundActionsResultSchema>;
export type ProjectTestRoundHistory = z.infer<typeof ProjectTestRoundHistorySchema>;
