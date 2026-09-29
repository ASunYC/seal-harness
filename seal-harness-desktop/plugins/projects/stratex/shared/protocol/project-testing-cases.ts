import { z } from 'zod';

import {
  ProjectCollabErrorCodeSchema,
  ProjectCollabReferenceCodeSchema,
  ProjectCollabServerCodeSchema,
} from './project-collab.js';

/**
 * 测试轮次的用例（TST-04，ADR-0046）的**客户端契约**：用例形状、五条通道的请求与结果、必填规则与业务码文案。
 *
 * 服务端契约在 `scripts/collab-service/server/routes_test_cases.py`（端点）与 `domain_test_cases.py`
 * （判定、复用与序列化）。线协议是 snake_case，这里是 camelCase；两者之间的投影**只在** Main 的
 * `collabTestCaseWireMapping.ts` 一处，⛔ SDK、store、组件里不许再写第二份字段名映射。
 *
 * ⭐ 用例**属于轮次**（原型 `runCases`）：活动轮次里只有本轮测试负责人能新建与编辑（`testActor`）；「复用
 *    上轮用例」把最近一个有用例的更早轮次复制成本轮新行、结果重置为未执行；轮次结束后用例只读。
 *    这些判定都在服务端强判——渲染层按身份与轮次状态收起入口只是「不摆必错入口」，⛔ 不是门。
 *
 * ⚠️ 两条红线由本文件的 schema 结构性承载：
 *  1. 【账号】请求里**没有** accountKey 或新建人 / 修改人字段——身份是令牌里的那个人，`strictObject`
 *     让「多带一个字段」都不可表达。
 *  2. 【埋点红线】用例名称 / 前置 / 步骤 / 预期都是用户亲笔：只进 REST，⛔ 不进事件面、日志与埋点。
 */

/** 字段上界（按码点计），与服务端 `MAX_TEST_CASE_*` 同界。 */
export const PROJECT_TEST_CASE_MAX_TITLE_LENGTH = 200;
export const PROJECT_TEST_CASE_MAX_PRECONDITIONS_LENGTH = 4_000;
export const PROJECT_TEST_CASE_MAX_STEPS_LENGTH = 8_000;
export const PROJECT_TEST_CASE_MAX_EXPECTED_LENGTH = 4_000;

/** 用例列表一页：缺省 30、上界 50（服务端 `TEST_CASE_DEFAULT_PAGE_LIMIT` / `MAX`）。 */
export const PROJECT_TEST_CASE_DEFAULT_PAGE_SIZE = 30;
export const PROJECT_TEST_CASE_MAX_PAGE_SIZE = 50;

/** 一轮至多几条用例（服务端 `MAX_TEST_CASES_PER_ROUND`）。 */
export const PROJECT_TEST_CASE_MAX_PER_ROUND = 200;

/** 幂等键上界（与整需求提交同界）。 */
export const PROJECT_TEST_CASE_MAX_CLIENT_REQUEST_ID_LENGTH = 128;

/** 原型 `caseEditor` 缺必填时的那一句（服务端 400 `test_case_fields_required` 同一句）。 */
export const PROJECT_TEST_CASE_FIELDS_REQUIRED_TEXT = '请填写用例名称、操作步骤和预期结果。';

/**
 * 执行结果闭集：原型 `caseStates` 四态（服务端迁移 0032 的 CHECK）。
 * ⚠️ TST-04 只会看到 `notrun`；记录结果属 TST-05。
 */
export const ProjectTestCaseResultSchema = z.enum(['notrun', 'passed', 'failed', 'blocked']);

/** 证据只引用不可变文件版本或无凭据的网页地址，不触发外部读取。 */
export const ProjectTestEvidenceRefSchema = z
  .string()
  .max(2048)
  .refine((value) => {
    if (/[\p{Cc}\p{Cf}\p{Z}]/u.test(value)) return false;
    if (value.startsWith('file-version:'))
      return z.string().uuid().safeParse(value.slice(13)).success;
    if (!value.startsWith('link:')) return false;
    const address = value.slice(5);
    return (
      z.string().url().safeParse(address).success &&
      /^https?:\/\/[^/?#@\s\\]+(?:[/?#]|$)/iu.test(address)
    );
  });

const entityIdSchema = z.string().uuid();
const subjectSchema = z.string().min(1).max(256);
const timestampSchema = z.string().max(64);
const positiveCountSchema = z.number().int().safe().positive();
const nonnegativeCountSchema = z.number().int().safe().nonnegative();
const cursorSchema = z.string().min(1).max(1_024);

/** 用户亲笔正文：只拒 NUL（与既有协议同口径；服务端库也存不进 NUL）。 */
const noNul = (value: string): boolean => !value.includes('\0');

/**
 * 入站正文：上界取出站上界的**两倍**。服务端按码点计，这里的 `length` 按 UTF-16 单元计——四字节字符在
 * 这里占两个单元，按原上界收会让一段满长的带表情正文整页解析失败（与 `ProjectTestRoundDetailSchema` 同理）。
 */
const inboundText = (max: number) =>
  z
    .string()
    .max(max * 2)
    .refine(noNul, 'NUL is forbidden');
const inboundRequiredText = (max: number) => inboundText(max).pipe(z.string().min(1));

/** 出站正文：按服务端上界收紧（客户端拒的服务端必拒）；判空（去空白后）留给服务端给 400 业务码。 */
const outboundText = (max: number) => z.string().max(max).refine(noNul, 'NUL is forbidden');

/**
 * 一条用例（服务端 `serialize_test_case`）。⛔ 不含幂等指纹、没有「必测」（原型没有这一项：本轮全部用例
 * 都要通过，判定在 TST-07）。`copiedFromCaseId` 是「复用上轮」时的来源用例。
 */
export const ProjectTestCaseSchema = z.strictObject({
  id: entityIdSchema,
  projectId: entityIdSchema,
  requirementId: entityIdSchema,
  submissionId: entityIdSchema,
  ordinal: positiveCountSchema,
  title: inboundRequiredText(PROJECT_TEST_CASE_MAX_TITLE_LENGTH),
  preconditions: inboundText(PROJECT_TEST_CASE_MAX_PRECONDITIONS_LENGTH),
  steps: inboundRequiredText(PROJECT_TEST_CASE_MAX_STEPS_LENGTH),
  expected: inboundRequiredText(PROJECT_TEST_CASE_MAX_EXPECTED_LENGTH),
  result: ProjectTestCaseResultSchema,
  // 旧服务没有执行投影；缺席保留为未知，不编造执行人或时间。
  actualResult: z.string().max(16000).optional(),
  testedBySubject: subjectSchema.nullable().optional(),
  testedAt: timestampSchema.nullable().optional(),
  evidenceRefs: z.array(ProjectTestEvidenceRefSchema).max(32).optional(),
  copiedFromCaseId: entityIdSchema.nullable(),
  createdBySubject: subjectSchema,
  updatedBySubject: subjectSchema,
  version: positiveCountSchema,
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
});

/** 可复用的来源轮次（最近一个有用例的更早轮次）。 */
export const ProjectTestCaseCopySourceSchema = z.strictObject({
  submissionId: entityIdSchema,
  roundNo: positiveCountSchema,
  caseCount: positiveCountSchema,
});

export type ProjectTestCaseResult = z.infer<typeof ProjectTestCaseResultSchema>;
export type ProjectTestCase = z.infer<typeof ProjectTestCaseSchema>;
export type ProjectTestCaseCopySource = z.infer<typeof ProjectTestCaseCopySourceSchema>;

/** 一次不可变执行及当时四项用例文字。 */
export const ProjectTestExecutionSchema = z.strictObject({
  id: entityIdSchema,
  caseId: entityIdSchema,
  projectId: entityIdSchema,
  requirementId: entityIdSchema,
  roundId: entityIdSchema,
  result: ProjectTestCaseResultSchema,
  actualResult: inboundText(8000),
  evidenceRefs: z.array(ProjectTestEvidenceRefSchema).max(32),
  caseSnapshot: z.strictObject({
    title: inboundRequiredText(200),
    preconditions: inboundText(4000),
    steps: inboundRequiredText(8000),
    expected: inboundRequiredText(4000),
  }),
  testedBySubject: subjectSchema,
  testedAt: timestampSchema,
});
export type ProjectTestExecution = z.infer<typeof ProjectTestExecutionSchema>;

/** 用例四项文字（新建、编辑与表单草稿同形）。 */
export interface ProjectTestCaseDraft {
  readonly title: string;
  readonly preconditions: string;
  readonly steps: string;
  readonly expected: string;
}

/** 必填的三项（原型 `caseEditor`：`!title || !steps || !expected`）。 */
export type ProjectTestCaseRequiredField = 'title' | 'steps' | 'expected';

const REQUIRED_FIELDS: readonly ProjectTestCaseRequiredField[] = ['title', 'steps', 'expected'];

/**
 * 草稿缺哪几项必填（去首尾空白后为空即缺）。与服务端 `normalize_case_fields` 同一套规则：前置可空。
 * ⚠️ 这只是「不发必错请求」，服务端照判（400 `test_case_fields_required`）。
 */
export function projectTestCaseMissingFields(
  draft: ProjectTestCaseDraft,
): ProjectTestCaseRequiredField[] {
  return REQUIRED_FIELDS.filter((field) => draft[field].trim().length === 0);
}

/* ══════════════════════════════════════════════════════════════════════════════
 * 请求 / 结果契约（五条通道）
 *
 * 失败信封复用协作面那一套闭集（`code` / `referenceCode` / `serverCode`）。
 * ═══════════════════════════════════════════════════════════════════════════ */

const errorShape = {
  code: ProjectCollabErrorCodeSchema,
  message: z.string().max(2_048),
  referenceCode: ProjectCollabReferenceCodeSchema,
  serverCode: ProjectCollabServerCodeSchema.optional(),
} as const;

/** 400 点名的字段（服务端 `field` / `missing_fields`）。 */
const fieldNameSchema = z.enum(['title', 'preconditions', 'steps', 'expected']);
export type ProjectTestCaseField = z.infer<typeof fieldNameSchema>;

/** 写失败的附加键：结构只有一种形状，取不到一律 null。 */
const writeFailureExtras = {
  field: fieldNameSchema.nullable(),
  missingFields: z.array(fieldNameSchema).max(4).nullable(),
} as const;

const pageRefine = (
  value: { readonly hasMore: boolean; readonly nextCursor: string | null },
  context: z.RefinementCtx,
): void => {
  // 与待办列表页逐字同一条：游标与 hasMore 同生同灭，否则调用方会停在半途而不报错。
  if (value.hasMore !== (value.nextCursor !== null)) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['nextCursor'],
      message: 'nextCursor must be present exactly when hasMore is true',
    });
  }
};

/**
 * `project:round-test-cases`：一轮的用例（按序号，游标分页；`total` 整轮条数）。门与单轮详情同一道：
 * 轮次不存在、所属需求不可见一律 404 `submission_not_found`。`copySource` 只在轮次仍在测时给出。
 */
export const ProjectRoundTestCasesRequestSchema = z.strictObject({
  projectId: entityIdSchema,
  submissionId: entityIdSchema,
  cursor: cursorSchema.nullable().optional(),
  limit: z.number().int().min(1).max(PROJECT_TEST_CASE_MAX_PAGE_SIZE).optional(),
});

export const ProjectRoundTestCasesResultSchema = z.discriminatedUnion('ok', [
  z
    .strictObject({
      ok: z.literal(true),
      testCases: z.array(ProjectTestCaseSchema).max(PROJECT_TEST_CASE_MAX_PAGE_SIZE),
      hasMore: z.boolean(),
      nextCursor: cursorSchema.nullable(),
      total: nonnegativeCountSchema,
      copySource: ProjectTestCaseCopySourceSchema.nullable(),
    })
    .superRefine(pageRefine),
  z.strictObject({ ok: z.literal(false), ...errorShape }),
]);

/**
 * `project:round-test-case-create`：本轮测试负责人在活动轮次里新建一条用例（服务端强判身份与轮次状态）。
 *
 * ⭐ `clientRequestId` 必填：服务端把 (项目, 轮次, 新建人, 请求号) 折成用例主键。同一次打开弹层内的重试
 *    **沿用同一个号**——换号等于把幂等关掉。
 */
export const ProjectRoundTestCaseCreateRequestSchema = z.strictObject({
  projectId: entityIdSchema,
  submissionId: entityIdSchema,
  clientRequestId: z.string().min(1).max(PROJECT_TEST_CASE_MAX_CLIENT_REQUEST_ID_LENGTH),
  title: outboundText(PROJECT_TEST_CASE_MAX_TITLE_LENGTH),
  preconditions: outboundText(PROJECT_TEST_CASE_MAX_PRECONDITIONS_LENGTH),
  steps: outboundText(PROJECT_TEST_CASE_MAX_STEPS_LENGTH),
  expected: outboundText(PROJECT_TEST_CASE_MAX_EXPECTED_LENGTH),
});

/** 新建结果。成功：`replayed=true` ＝ 同号同内容的重试命中了原用例（服务端 200）——⛔ 不是失败。 */
export const ProjectRoundTestCaseCreateResultSchema = z.discriminatedUnion('ok', [
  z.strictObject({ ok: z.literal(true), testCase: ProjectTestCaseSchema, replayed: z.boolean() }),
  z.strictObject({ ok: z.literal(false), ...errorShape, ...writeFailureExtras }),
]);

/**
 * `project:test-case-update`：本轮测试负责人编辑一条用例（四项整表保存，原型编辑弹层一次提交全部字段）。
 * 没有实际改动时服务端原样返回、不 +1 版本。
 */
export const ProjectTestCaseUpdateRequestSchema = z.strictObject({
  projectId: entityIdSchema,
  caseId: entityIdSchema,
  expectedVersion: positiveCountSchema,
  title: outboundText(PROJECT_TEST_CASE_MAX_TITLE_LENGTH),
  preconditions: outboundText(PROJECT_TEST_CASE_MAX_PRECONDITIONS_LENGTH),
  steps: outboundText(PROJECT_TEST_CASE_MAX_STEPS_LENGTH),
  expected: outboundText(PROJECT_TEST_CASE_MAX_EXPECTED_LENGTH),
});

/**
 * 编辑结果。失败另**恒带** `currentVersion`（409 `version_conflict` 带回的当前版本，取不到给 null）：界面据此
 * 把表单改基到最新版本、保留填写内容（`projectTestCaseServerCodeText` 那句承诺的恢复路径）。
 */
export const ProjectTestCaseUpdateResultSchema = z.discriminatedUnion('ok', [
  z.strictObject({ ok: z.literal(true), testCase: ProjectTestCaseSchema }),
  z.strictObject({
    ok: z.literal(false),
    ...errorShape,
    ...writeFailureExtras,
    currentVersion: positiveCountSchema.nullable(),
  }),
]);

/**
 * `project:round-test-cases-copy`：复用上轮用例（原型 `case-copy-previous`）。来源由服务端决定（最近一个有用例
 * 的更早轮次）；重复点击只补还没复制过的，`copiedCount` 可能为 0。
 */
export const ProjectRoundTestCasesCopyRequestSchema = z.strictObject({
  projectId: entityIdSchema,
  submissionId: entityIdSchema,
});

export const ProjectRoundTestCasesCopyResultSchema = z.discriminatedUnion('ok', [
  z.strictObject({
    ok: z.literal(true),
    copiedCount: nonnegativeCountSchema,
    sourceSubmissionId: entityIdSchema,
    sourceRoundNo: positiveCountSchema,
  }),
  z.strictObject({ ok: z.literal(false), ...errorShape }),
]);

/** `project:requirement-test-case-counts`：一条需求各轮各有几条用例（只列有用例的轮次）。 */
export const ProjectRequirementTestCaseCountsRequestSchema = z.strictObject({
  projectId: entityIdSchema,
  requirementId: entityIdSchema,
});

export const ProjectRequirementTestCaseCountsResultSchema = z.discriminatedUnion('ok', [
  z.strictObject({
    ok: z.literal(true),
    counts: z
      .array(z.strictObject({ submissionId: entityIdSchema, caseCount: positiveCountSchema }))
      .max(1_000),
  }),
  z.strictObject({ ok: z.literal(false), ...errorShape }),
]);

export type ProjectRoundTestCasesRequest = z.infer<typeof ProjectRoundTestCasesRequestSchema>;
export type ProjectRoundTestCasesResult = z.infer<typeof ProjectRoundTestCasesResultSchema>;
export type ProjectRoundTestCaseCreateRequest = z.infer<
  typeof ProjectRoundTestCaseCreateRequestSchema
>;
export type ProjectRoundTestCaseCreateResult = z.infer<
  typeof ProjectRoundTestCaseCreateResultSchema
>;
export type ProjectTestCaseUpdateRequest = z.infer<typeof ProjectTestCaseUpdateRequestSchema>;
export type ProjectTestCaseUpdateResult = z.infer<typeof ProjectTestCaseUpdateResultSchema>;
export type ProjectRoundTestCasesCopyRequest = z.infer<
  typeof ProjectRoundTestCasesCopyRequestSchema
>;
export type ProjectRoundTestCasesCopyResult = z.infer<typeof ProjectRoundTestCasesCopyResultSchema>;
export type ProjectRequirementTestCaseCountsRequest = z.infer<
  typeof ProjectRequirementTestCaseCountsRequestSchema
>;
export type ProjectRequirementTestCaseCountsResult = z.infer<
  typeof ProjectRequirementTestCaseCountsResultSchema
>;

const FIELD_LABELS: Readonly<Record<ProjectTestCaseField, string>> = {
  title: '用例名称',
  preconditions: '前置条件',
  steps: '操作步骤',
  expected: '预期结果',
};

/**
 * 轮次用例的**服务端业务码** → 用户可读中文（就地覆盖通用文案）。
 *
 * 与 `projectRequirementSubmitServerCodeText` 同一条纪律：文案收口在共享层，⛔ 业务码不露给用户；认不出的码
 * 与缺席一律 `null`，调用方退回按失败分档 `code` 取的通用句。编号照旧取 `code` 那一格。
 * ⚠️ 两个幂等码**不能塌缩**：`idempotency_retry` 是「稍后重试就有结果」，`idempotency_conflict` 是
 *    「这次内容变了，关掉重来」。
 * ⚠️ `version_conflict` 与 `invalid_cursor` 两句承诺了恢复路径（表单改基到最新版本并保留填写 / 回到第一页），
 *    store 必须照做。
 */
export function projectTestCaseServerCodeText(
  serverCode: string | null | undefined,
  context: { readonly field?: string | null } = {},
): string | null {
  switch (serverCode) {
    case 'test_case_fields_required':
      return PROJECT_TEST_CASE_FIELDS_REQUIRED_TEXT;
    case 'test_case_field_too_long': {
      const field = fieldNameSchema.safeParse(context.field);
      const label = field.success ? FIELD_LABELS[field.data] : '内容';
      return `${label}超出长度上限，请精简后再保存。`;
    }
    case 'invalid_test_case_field':
      return '用例内容格式不正确，请检查后再保存。';
    case 'not_round_reviewer':
      return '只有本轮测试负责人可以编辑测试用例。';
    case 'reviewer_not_independent':
      return '测试负责人不能是需求处理人或本轮提交人，本轮用例只读。';
    case 'forbidden':
      return '观察者只能查看测试用例。';
    case 'test_round_closed':
      return '这一轮测试已结束，用例只读。';
    case 'test_case_limit_reached':
      return `这一轮的测试用例已达 ${String(PROJECT_TEST_CASE_MAX_PER_ROUND)} 条上限。`;
    case 'test_case_not_found':
      return '这条用例已不存在或不可见，请刷新后重试。';
    case 'submission_not_found':
      return '这一轮测试已不存在或不可见，请刷新后重试。';
    case 'no_reusable_test_cases':
      return '没有可复用的上轮测试用例。';
    case 'version_conflict':
      return '这条用例已被修改过，已刷新到最新版本；你填写的内容已保留，确认后可再次保存。';
    case 'idempotency_retry':
      return '保存正在处理中，请稍后重试。';
    case 'idempotency_conflict':
      return '本次新建内容已变化，请关闭后重新新建。';
    case 'invalid_cursor':
      return '分页位置已失效，已回到第一页。';
    default:
      return null;
  }
}

/** 签署本次执行，身份与时间不能由客户端代填。 */
export const ProjectTestCaseExecuteRequestSchema = z.strictObject({
  projectId: entityIdSchema,
  caseId: entityIdSchema,
  expectedVersion: positiveCountSchema,
  clientRequestId: z.string().min(1).max(128),
  result: z.enum(['passed', 'failed', 'blocked']),
  actualResult: outboundText(8000),
  evidenceRefs: z.array(ProjectTestEvidenceRefSchema).max(32),
});
export const ProjectTestCaseExecuteResultSchema = z.discriminatedUnion('ok', [
  z.strictObject({
    ok: z.literal(true),
    testCase: ProjectTestCaseSchema,
    execution: ProjectTestExecutionSchema,
  }),
  z.strictObject({
    ok: z.literal(false),
    ...errorShape,
    currentVersion: positiveCountSchema.nullable(),
  }),
]);
export const ProjectTestExecutionsRequestSchema = z.strictObject({
  projectId: entityIdSchema,
  caseId: entityIdSchema,
  cursor: cursorSchema.nullable().optional(),
  limit: z.number().int().min(1).max(50).optional(),
});
export const ProjectTestExecutionsResultSchema = z.discriminatedUnion('ok', [
  z
    .strictObject({
      ok: z.literal(true),
      items: z.array(ProjectTestExecutionSchema).max(50),
      total: nonnegativeCountSchema,
      hasMore: z.boolean(),
      nextCursor: cursorSchema.nullable(),
    })
    .superRefine(pageRefine),
  z.strictObject({ ok: z.literal(false), ...errorShape }),
]);
export type ProjectTestCaseExecuteRequest = z.infer<typeof ProjectTestCaseExecuteRequestSchema>;
export type ProjectTestCaseExecuteResult = z.infer<typeof ProjectTestCaseExecuteResultSchema>;
export type ProjectTestExecutionsRequest = z.infer<typeof ProjectTestExecutionsRequestSchema>;
export type ProjectTestExecutionsResult = z.infer<typeof ProjectTestExecutionsResultSchema>;
