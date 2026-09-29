import { z } from 'zod';
import {
  ProjectCollabErrorCodeSchema,
  ProjectCollabReferenceCodeSchema,
  ProjectCollabServerCodeSchema,
} from './project-collab.js';
import { PROJECT_TEST_MODE_MAX_ROUNDS, ProjectTestRoundSchema } from './project-testing.js';

/**
 * 服务能力协商与新旧测试模式兼容（CORE-05 + TST-02）。
 *
 * 能力清单是**新旧客户端协商面**：客户端据此判断「新增写字段能不能发」——对面没有
 * `requirement.dictionaries` 就别发 `module_id`/`category_id`（否则老服务端 `extra=forbid`
 * 一律 422、或静默忽略，两种都糟），改就地显示升级提示。
 *
 * ⚠️ 这里的字符串与服务端 `scripts/collab-service/server/domain_capabilities.py` 的
 *    `SERVICE_CAPABILITIES` **逐字对齐**（本仓无跨语言同步器，靠两侧各一条断言钉死）。
 */
export const SERVICE_CAPABILITY = {
  chatIdempotency: 'chat_idempotency',
  chatSearch: 'chat_search',
  requirementDictionaries: 'requirement.dictionaries',
  requirementTimeFacts: 'requirement.time_facts',
  requirementStatusEvents: 'requirement.status_events',
  requirementPaging: 'requirement.paging',
  requirementSummary: 'requirement.summary',
  requirementSubtaskSummary: 'requirement.subtask_summary',
  /**
   * 整需求提测与轮次读取（TST-02）。D-TEST-01 已定案选 A，提交端点与测试负责人独立性校验同批上线。
   * ⭐ 渲染层的提测入口与「测试记录」只在协商到它时出现；能力未加载或加载失败一律按不支持处理——
   *    新客户端连旧服务端（没有轮次端点）时不摆入口、不发请求、不报错。
   */
  requirementTestMode: 'requirement.test_mode',
  optionalTestReviewer: 'requirement.optional_test_reviewer',
  /**
   * 测试轮次的用例：读取 / 新建 / 编辑 / 复用上轮（TST-04，ADR-0046）。
   * ⭐ 需求详情轮次卡上的「N 个用例 · 进入测试」与测试页签的轮次视图只在协商到它时出现；判不出一律按不支持。
   */
  requirementTestCases: 'requirement.test_cases',
} as const;

const projectIdSchema = z.string().uuid();

/** 与 `project-collab.ts` 的失败信封同形（那份 shape 未导出，此处按导出的三段子 schema 重建）。 */
const projectCollabErrorShape = {
  code: ProjectCollabErrorCodeSchema,
  message: z.string().max(2_048),
  referenceCode: ProjectCollabReferenceCodeSchema,
  serverCode: ProjectCollabServerCodeSchema.optional(),
} as const;

/** 能力标识：小写起头，允许点分段（与服务端字符串同形）。 */
const capabilityFlagSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[a-z][a-z0-9_.]*$/u);

/** 服务能力描述（协商面载荷，camelCase）。 */
export const ServiceCapabilitiesSchema = z.strictObject({
  capabilities: z.array(capabilityFlagSchema).max(64),
  serviceVersion: z.string().min(1).max(64),
});
export type ServiceCapabilities = z.infer<typeof ServiceCapabilitiesSchema>;

/**
 * 新旧测试模式判定（只读；camelCase）。
 *
 * - `mode`：项目有过任何一轮整需求提测 ⇒ `rounds`，否则 `legacy`（第一轮提交成功即进入，不另设开关）。
 * - `testRounds`：**真实**的活动轮次摘要（服务端已按看的人过滤可见性，至多 100 条，最新在前）。
 *   ⛔ 绝不从旧待验收虚构轮次（判据 2b）：条目必须是轮次形状（strict、不带整体完成说明），
 *   任何「看起来像轮次」的伪造条目整条判不可信。完整历史走需求维度的轮次列表。
 */
export const ProjectTestModeSchema = z.strictObject({
  mode: z.enum(['legacy', 'rounds']),
  canEnableNewMode: z.boolean(),
  blockedReasons: z.array(z.string().min(1).max(64)).max(16),
  legacyOpenReviewCount: z.number().int().safe().nonnegative(),
  testRounds: z.array(ProjectTestRoundSchema).max(PROJECT_TEST_MODE_MAX_ROUNDS),
});
export type ProjectTestMode = z.infer<typeof ProjectTestModeSchema>;

/* -- IPC 请求/结果信封 ------------------------------------------------------- */

export const ServiceCapabilitiesRequestSchema = z.strictObject({});
export type ServiceCapabilitiesRequest = z.infer<typeof ServiceCapabilitiesRequestSchema>;

export const ServiceCapabilitiesResultSchema = z.discriminatedUnion('ok', [
  z.strictObject({ ok: z.literal(true), capabilities: ServiceCapabilitiesSchema }),
  z.strictObject({ ok: z.literal(false), ...projectCollabErrorShape }),
]);
export type ServiceCapabilitiesResult = z.infer<typeof ServiceCapabilitiesResultSchema>;

export const ProjectTestModeRequestSchema = z.strictObject({ projectId: projectIdSchema });
export type ProjectTestModeRequest = z.infer<typeof ProjectTestModeRequestSchema>;

export const ProjectTestModeResultSchema = z.discriminatedUnion('ok', [
  z.strictObject({ ok: z.literal(true), testMode: ProjectTestModeSchema }),
  z.strictObject({ ok: z.literal(false), ...projectCollabErrorShape }),
]);
export type ProjectTestModeResult = z.infer<typeof ProjectTestModeResultSchema>;

/* -- 纯函数：能力判定 + 写字段协商门 ----------------------------------------- */

/** 协商面是否包含某能力。 */
export function hasCapability(
  capabilities: ServiceCapabilities | null | undefined,
  flag: string,
): boolean {
  return capabilities != null && capabilities.capabilities.includes(flag);
}

/**
 * 归类写字段（`moduleId` / `categoryId`）能否发给这个服务端（CORE-05 判据 1）。
 *
 * 「旧服务禁发新增写字段」：**已协商到能力**且缺 `requirement.dictionaries`、且这次请求
 * **携带**了归类字段（`!== undefined`，含显式 `null` 的「清空」也算携带）⇒ 需要升级、不许发。
 * ⚠️ 能力未知（`caps` 为 null/undefined，尚未协商）⇒ 不拦（服务端仍是最终权威）；只在
 *    **确知**对面不支持时才拦，避免把没协商上的正常写请求误伤。
 */
export function dictionaryWriteRequiresUpgrade(
  capabilities: ServiceCapabilities | null | undefined,
  fields: { readonly moduleId?: unknown; readonly categoryId?: unknown },
): boolean {
  if (capabilities == null) return false;
  const carriesDictionary = fields.moduleId !== undefined || fields.categoryId !== undefined;
  if (!carriesDictionary) return false;
  return !hasCapability(capabilities, SERVICE_CAPABILITY.requirementDictionaries);
}
