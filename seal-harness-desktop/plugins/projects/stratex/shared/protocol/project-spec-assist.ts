import { z } from 'zod';

import {
  PROJECT_TODO_ACCEPTANCE_TEXT_MAX_LENGTH,
  PROJECT_TODO_MAX_ACCEPTANCE_ITEMS,
  PROJECT_TODO_MAX_CONSTRAINTS_LENGTH,
  PROJECT_TODO_MAX_DESCRIPTION_LENGTH,
  PROJECT_TODO_MAX_TITLE_LENGTH,
  ProjectDetailRequestSchema,
  TodoItemKindSchema,
} from './project-collab.js';

/**
 * 派单表单「让助理补全」（`project:todo-spec-assist*`）的两端契约（ADR-0043）。
 *
 * 用户在派单表单只写一句标题，点「让助理补全」，主进程经账号新会话默认模型发一次**无工具**
 * 请求，把「目标 / 验收清单 / 注意事项」的建议回给表单；建议只进表单本地字段，保存仍走原来
 * 那一次写请求。本文件**不写库、不碰协作服务的写接口**。
 *
 * 与 `project-collab.ts` 分文件的理由（同 `project-datasource.ts` 先例）：
 *  ① 失败码是**另一套**：模型不可用、条款不允许、超时、输出不完整这些原因要分得开说给用户，
 *     协作面那套会把它们塌缩进 `rejected/transient`；
 *  ② 参考编号另起一族（`STRX-SPEC-0xx`），不与协作面抢号段。
 *
 * ⚠️ 三条红线由本文件的 schema **结构性**承载：
 *  1. 【账号与模型】请求里没有账号字段，也没有连接 / 模型选择字段——模型由 Main 按账号
 *     新会话默认分配解析，渲染层递不进来（strictObject 拒多余键）。
 *  2. 【上界】建议的描述按**服务端**写入上限 4000 封顶，不按表单的 20000：生成一段本地过、
 *     保存时 422 的描述等于替用户埋雷。越界一律拒绝，⛔ 不在任何一层截断。
 *  3. 【白标】标识符、注释与用户可见文案一律中性词。
 */

/* ------------------------------ 上界与闭集 ------------------------------ */

/**
 * 建议描述的字符上限：取服务端 `todos.description` 的写入上限（4000），而不是客户端表单
 * 的 {@link PROJECT_TODO_MAX_DESCRIPTION_LENGTH}（20000，既有漂移，方向反了）。
 */
export const PROJECT_SPEC_ASSIST_MAX_DESCRIPTION_LENGTH = 4_000;

/** 用户亲笔文本：允许换行，只拒 NUL（同协作面口径）。 */
const boundedText = (maxLength: number) =>
  z
    .string()
    .max(maxLength)
    .refine((value) => !value.includes('\0'), 'NUL is forbidden');

const nonBlankText = (maxLength: number) =>
  boundedText(maxLength)
    .min(1)
    .refine((value) => value.trim().length > 0, 'must not be blank');

const acceptanceTextsSchema = z
  .array(nonBlankText(PROJECT_TODO_ACCEPTANCE_TEXT_MAX_LENGTH))
  .max(PROJECT_TODO_MAX_ACCEPTANCE_ITEMS);

const requestIdSchema = z.string().uuid();

/**
 * 失败码（渲染层固定文案，不回显主进程或上游文本）：
 *  - `unavailable` / `authRequired` / `invalidRequest` / `forbidden` / `credentialRejected` /
 *    `rateLimited` / `transient`：与协作面同名同义（读项目名这一跳的结局）；
 *  - `modelUnavailable`：没有可用的新会话默认模型（未设、连接停用、证据漂移、凭据不可用）；
 *  - `modelNotSupported`：默认模型可用，但其条款不允许用于补全（使用用途 `assist-draft`）；
 *  - `modelTimeout`：主进程总时限到点；
 *  - `modelOutputInvalid`：输出不是约定 JSON、缺键、越界、全空、被截断或企图调用工具；
 *  - `modelFailed`：其余模型侧失败（上游失败、流中断、协议违约）；
 *  - `busy`：同一窗口已有一次在途补全；
 *  - `cancelled`：用户取消、保存或关闭表单（渲染层不提示）。
 */
export const ProjectSpecAssistErrorCodeSchema = z.enum([
  'unavailable',
  'authRequired',
  'invalidRequest',
  'forbidden',
  'credentialRejected',
  'rateLimited',
  'transient',
  'modelUnavailable',
  'modelNotSupported',
  'modelTimeout',
  'modelOutputInvalid',
  'modelFailed',
  'busy',
  'cancelled',
]);

export type ProjectSpecAssistErrorCode = z.infer<typeof ProjectSpecAssistErrorCodeSchema>;

/**
 * 失败码 → 参考编号（`STRX-SPEC-0xx`）。**唯一登记处**：签发方（Main 的失败体）与展示方
 * （表单里的报错行）都从这里取。
 *
 * ⛔ 已发出的号不得改写含义、不得回收复用；新增失败码在末尾续号。
 */
export const PROJECT_SPEC_ASSIST_REFERENCE_CODES = {
  unavailable: 'STRX-SPEC-001',
  authRequired: 'STRX-SPEC-002',
  invalidRequest: 'STRX-SPEC-003',
  forbidden: 'STRX-SPEC-004',
  credentialRejected: 'STRX-SPEC-005',
  rateLimited: 'STRX-SPEC-006',
  transient: 'STRX-SPEC-007',
  modelUnavailable: 'STRX-SPEC-008',
  modelNotSupported: 'STRX-SPEC-009',
  modelTimeout: 'STRX-SPEC-010',
  modelOutputInvalid: 'STRX-SPEC-011',
  modelFailed: 'STRX-SPEC-012',
  busy: 'STRX-SPEC-013',
  cancelled: 'STRX-SPEC-014',
} as const satisfies Record<ProjectSpecAssistErrorCode, string>;

export const ProjectSpecAssistReferenceCodeSchema = z.string().regex(/^STRX-SPEC-\d{3}$/u);

const specAssistFailureShape = {
  ok: z.literal(false),
  code: ProjectSpecAssistErrorCodeSchema,
  message: z.string().max(2_048),
  referenceCode: ProjectSpecAssistReferenceCodeSchema,
} as const;

/* --------------------------- 各通道 Request/Result --------------------------- */

/**
 * `project:todo-spec-assist`：按标题与已填内容生成三段规格建议。
 *
 * 已填字段有则带上，让助理在其基础上补全而不是推翻；空的不带（与「没给」同义）。
 * 项目名由 Main 从协作服务读（同时是成员判定），⛔ 不信渲染层递来的项目名。
 */
export const ProjectSpecAssistRequestSchema = z.strictObject({
  requestId: requestIdSchema,
  projectId: ProjectDetailRequestSchema.shape.projectId,
  itemKind: TodoItemKindSchema,
  title: nonBlankText(PROJECT_TODO_MAX_TITLE_LENGTH),
  /** 任务挂在某条需求下时，那条需求的标题——给助理最有用的一句上下文。 */
  parentTitle: nonBlankText(PROJECT_TODO_MAX_TITLE_LENGTH).optional(),
  description: boundedText(PROJECT_TODO_MAX_DESCRIPTION_LENGTH).optional(),
  acceptanceItems: acceptanceTextsSchema.optional(),
  constraintsText: boundedText(PROJECT_TODO_MAX_CONSTRAINTS_LENGTH).optional(),
});

/** 助理给出的三段建议：字段与拆解草案同名，上界按服务端写入契约。 */
export const TodoSpecSuggestionSchema = z.strictObject({
  description: boundedText(PROJECT_SPEC_ASSIST_MAX_DESCRIPTION_LENGTH),
  acceptanceItems: acceptanceTextsSchema,
  constraintsText: boundedText(PROJECT_TODO_MAX_CONSTRAINTS_LENGTH),
});

export const ProjectSpecAssistResultSchema = z.discriminatedUnion('ok', [
  z.strictObject({
    ok: z.literal(true),
    requestId: requestIdSchema,
    suggestion: TodoSpecSuggestionSchema,
  }),
  z.strictObject({
    ...specAssistFailureShape,
    /** 入参校验前的失败无从得知请求号，为 null。 */
    requestId: requestIdSchema.nullable(),
  }),
]);

/** `project:todo-spec-assist-cancel`：取消本窗口在途的那一次（幂等；认不出的号静默忽略）。 */
export const ProjectSpecAssistCancelRequestSchema = z.strictObject({
  requestId: requestIdSchema,
});

export const ProjectSpecAssistCancelResultSchema = z.discriminatedUnion('ok', [
  z.strictObject({ ok: z.literal(true) }),
  z.strictObject(specAssistFailureShape),
]);

/**
 * `project:todo-spec-assist-readiness`：点击前的只读就绪查询——账号新会话默认模型能不能
 * 用于补全。三档：可用 / 默认模型条款不允许 / 没有可用模型。⛔ 不外发模型请求。
 */
export const ProjectSpecAssistReadinessStateSchema = z.enum([
  'ready',
  'modelNotSupported',
  'modelUnavailable',
]);

export const ProjectSpecAssistReadinessRequestSchema = z.strictObject({});

export const ProjectSpecAssistReadinessResultSchema = z.discriminatedUnion('ok', [
  z.strictObject({ ok: z.literal(true), state: ProjectSpecAssistReadinessStateSchema }),
  z.strictObject(specAssistFailureShape),
]);

/* ------------------------------ 类型出口 ------------------------------ */

export type ProjectSpecAssistRequest = z.infer<typeof ProjectSpecAssistRequestSchema>;
export type TodoSpecSuggestion = z.infer<typeof TodoSpecSuggestionSchema>;
export type ProjectSpecAssistResult = z.infer<typeof ProjectSpecAssistResultSchema>;
export type ProjectSpecAssistCancelRequest = z.infer<typeof ProjectSpecAssistCancelRequestSchema>;
export type ProjectSpecAssistCancelResult = z.infer<typeof ProjectSpecAssistCancelResultSchema>;
export type ProjectSpecAssistReadinessState = z.infer<typeof ProjectSpecAssistReadinessStateSchema>;
export type ProjectSpecAssistReadinessRequest = z.infer<
  typeof ProjectSpecAssistReadinessRequestSchema
>;
export type ProjectSpecAssistReadinessResult = z.infer<
  typeof ProjectSpecAssistReadinessResultSchema
>;
