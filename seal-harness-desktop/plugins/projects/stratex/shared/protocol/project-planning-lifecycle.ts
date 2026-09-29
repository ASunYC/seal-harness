import { z } from 'zod';

import {
  PROJECT_MAX_REFS,
  PROJECT_REF_TOKEN_PATTERN,
  ProjectCollabErrorCodeSchema,
  ProjectCollabReferenceCodeSchema,
  ProjectCollabServerCodeSchema,
} from './project-collab.js';
import {
  PROJECT_PLANNING_MAX_CLIENT_REQUEST_ID_LENGTH,
  PROJECT_PLANNING_MAX_PAGE_SIZE,
  ProjectIterationListItemSchema,
  ProjectIterationStatusSchema,
  ProjectMilestoneListItemSchema,
  ProjectMilestoneStatusSchema,
  type ProjectIterationStatus,
} from './project-planning.js';

/**
 * 规划域**生命周期**契约：业务目标 / 多轮迭代的记录达成、重新打开与阶段记录（MIL-07）。
 *
 * 服务端表 `milestone_events` / `iteration_events`（迁移 0027）。四个写动作共用一个请求形状
 * （`reason / evidenceRefs / expectedVersion / clientRequestId`），读侧是两份阶段记录。
 *
 * ⚠️ **为什么与 `project-planning.ts` 分文件**：那份承载持久化模型与 CRUD / 关联历史，而排期
 *    （看板 / 甘特）那条线还要往里接着长；生命周期另成一份，两条线各改各的文件。依赖方向
 *    只有一条：本文件引用 `project-planning.ts` 的列表行与状态闭集，⛔ 那边永不回头引用这里。
 *
 * ⭐ 「完成要说明 + 证据、重开只要原因」是**业务规则**，判定在服务端（缺则 422
 *    `completion_note_required` / `completion_evidence_required` / `reopen_reason_required`）。
 *    这里**不按动作分两套请求 schema**：两套会各自演化，而服务端只有一个判定出处。
 * ⭐ 「达成没」只由这四个动作改：`status` 从来不在目标 / 轮次的更新契约里，所以不存在
 *    「顺手改个名就被标成已达成」的第二条写路径。
 * ⭐ 已归档的目标 / 轮次拒绝完成与重开（409 `milestone_archived` / `iteration_archived`）——
 *    归档即只读；阶段记录照样读得到。
 * ⛔ 【事件面红线】`reason` 与 `evidenceRefs` 是用户亲笔正文：只经本文件的 REST 契约读回，
 *    SSE 负载里一个字都没有（服务端负载只有 id / 枚举 / 版本）。渲染层收到
 *    `milestone.updated` / `iteration.updated` 只能按 id 走阶段记录通道重取。
 *
 * 【账号】契约里**没有** accountKey 或任何账号字段（`strictObject` 连多带一个键都不可表达）。
 * 【白标】标识符、注释与文案一律不含内核品牌词根。
 */

/* ── 基础形状 ─────────────────────────────────────────────────────────────────
 *
 * ⚠️ 下面几条与 `project-planning.ts` 里的私有常量**同一份定义**（那边未导出）：这里只重复
 *    「uuid / 主体 / 时刻 / 亲笔正文 / 版本 / 失败信封」这几块拼装，**取值闭集与上界一律导入**
 *    （失败码、参考编号、业务码、请求号上界、分页上界、状态闭集、列表行），与
 *    `project-collab-assets.ts` 重新声明失败信封的先例同一条取舍。
 */

const entityIdSchema = z.string().uuid();
const subjectSchema = z.string().min(1).max(256);
const timestampSchema = z.string().max(64);
const clientRequestIdSchema = z.string().min(1).max(PROJECT_PLANNING_MAX_CLIENT_REQUEST_ID_LENGTH);
/** 乐观锁的期望版本。⛔ 不设上界（服务端单调计数，客户端定的任何数字都只是下一堵墙）。 */
const expectedVersionSchema = z.number().int().safe().positive();

/** 用户亲笔正文。允许换行与空串（空串 ＝ 没写）；只拒 NUL（与既有协议同口径）。 */
const authoredMarkdown = (maxLength: number): z.ZodString =>
  z
    .string()
    .max(maxLength)
    .refine((value) => !value.includes('\0'), 'NUL is forbidden');

const lifecycleErrorShape = {
  code: ProjectCollabErrorCodeSchema,
  message: z.string().max(2_048),
  referenceCode: ProjectCollabReferenceCodeSchema,
  serverCode: ProjectCollabServerCodeSchema.optional(),
} as const;

/** 分页信封的三个数。⛔ `total` 是服务端计数，不设上界。 */
const pageShape = {
  total: z.number().int().nonnegative(),
  page: z.number().int().positive(),
  pageSize: z.number().int().positive(),
} as const;

/* ── 上界 ──────────────────────────────────────────────────────────────────── */

/**
 * 达成说明 / 重开原因的字符上限。
 * 与服务端 `MAX_LIFECYCLE_REASON_CHARS`、迁移 0027 的 `length(reason) <= 4000` **同界**。
 */
export const PROJECT_PLANNING_LIFECYCLE_REASON_MAX_LENGTH = 4_000;

/** 单条证据引用的字符上限：与服务端 `MAX_EVIDENCE_REF_CHARS` / `models.MAX_REF_CHARS` 同界。 */
export const PROJECT_PLANNING_EVIDENCE_REF_MAX_LENGTH = 256;

/* ── 证据引用里的外部链接（ADR-0036）───────────────────────────────────────── */

/** 外部链接证据的 token 前缀：`link:<完整地址>`，与 `asset:` / `todo:` 并列。 */
export const PLANNING_EVIDENCE_LINK_PREFIX = 'link:';

/** 可打开的协议闭集（小写比对）。⛔ 别往里加：系统浏览器之外的协议会被交给本机注册的任意程序。 */
const EVIDENCE_LINK_SCHEMES: ReadonlySet<string> = new Set(['http', 'https']);

/**
 * 地址里不许出现的码点（闭区间）：C0 控制字符与空格、DEL 与 C1 控制字符、各种 Unicode 空白、
 * 零宽字符与双向文本控制符（后者能让显示出来的地址与真正打开的地址看起来不一样）。
 *
 * ⚠️ 按码点判，源码里不写转义。服务端 `domain_planning_lifecycle._EVIDENCE_LINK_FORBIDDEN_RANGES`
 *    与这里逐项同值；两边共用 `scripts/collab-service/tests/fixtures/evidence_link_vectors.json`
 *    这份向量（主进程侧由 `projectCollabHandlersPlanning.test.ts` 逐条送进打开通道）。
 */
const EVIDENCE_LINK_FORBIDDEN_RANGES: readonly (readonly [number, number])[] = [
  [0x00, 0x20],
  [0x7f, 0x9f],
  [0xa0, 0xa0],
  [0x1680, 0x1680],
  [0x180e, 0x180e],
  [0x2000, 0x200f],
  [0x2028, 0x202f],
  [0x205f, 0x206f],
  [0x3000, 0x3000],
  [0xfeff, 0xfeff],
];

/** 反斜杠：浏览器把它当 `/`，会让「主机段看起来是谁」与「真正打开的是谁」不一致。 */
const BACKSLASH = String.fromCharCode(0x5c);

function hasForbiddenLinkChar(url: string): boolean {
  for (const char of url) {
    const code = char.codePointAt(0) ?? 0;
    if (EVIDENCE_LINK_FORBIDDEN_RANGES.some(([low, high]) => code >= low && code <= high)) {
      return true;
    }
  }
  return false;
}

/** 非方括号主机里不许出现的字符：主机名里不可能有（IPv6 字面量走方括号分支，百分号编码的主机不收）。 */
const LINK_HOST_FORBIDDEN_CHARS = ['%', '<', '>', '[', ']', '^', '|'] as const;
/** 方括号里只许出现 IPv6 字面量的字符，且至少有一个冒号。 */
const LINK_IPV6_LITERAL = /^[0-9A-Fa-f:.]+$/u;
const LINK_PORT_DIGITS = /^[0-9]*$/u;
const LINK_PORT_MAX = 65_535;

/**
 * 主机段（账号密码闸之后）= 主机 + 可选端口：主机非空且字符合规；端口为空或是不超过 65535 的数字。
 * ⚠️ 文法只判结构，不做完整的主机解析（国际化域名、百分号解码、IPv6 字面量本身是否成立）——
 *    那一半留给渲染时与主进程打开前的解析器（`openablePlanningEvidenceLink`）。
 */
function isValidLinkAuthority(authority: string): boolean {
  let rest: string;
  if (authority.startsWith('[')) {
    const close = authority.indexOf(']');
    if (close < 0) return false;
    const literal = authority.slice(1, close);
    if (!LINK_IPV6_LITERAL.test(literal) || !literal.includes(':')) return false;
    rest = authority.slice(close + 1);
  } else {
    const colon = authority.indexOf(':');
    const host = colon < 0 ? authority : authority.slice(0, colon);
    if (host === '' || LINK_HOST_FORBIDDEN_CHARS.some((char) => host.includes(char))) return false;
    rest = colon < 0 ? '' : authority.slice(colon);
  }
  if (rest === '') return true;
  if (!rest.startsWith(':')) return false;
  const port = rest.slice(1);
  return LINK_PORT_DIGITS.test(port) && (port === '' || Number(port) <= LINK_PORT_MAX);
}

/**
 * 一个地址过不过得了外部链接**文法**（ADR-0036）：`http://` / `https://` 开头的完整地址，主机段不带
 * 账号密码、没有反斜杠、主机与端口结构合规，全文没有空白与控制字符。
 *
 * ⭐ **按文法判、不用 `URL`**：共享层没有 DOM / Node 的全局，且服务端（Python）要逐行写出同一份
 *    判定——文法两边写得一样，解析器两边做不到一样。
 * ⭐ 用在：写入前的请求 schema（预加载与主进程两道边界）；服务端写入时按同一文法再判一次（422
 *    `evidence_link_invalid`）。「能不能交系统浏览器打开」还要再过解析器，见 `openablePlanningEvidenceLink`。
 * ⛔ 只看地址本身、不看是谁写的。
 */
export function isSafePlanningEvidenceLinkUrl(url: string): boolean {
  if (hasForbiddenLinkChar(url)) return false;
  const separator = url.indexOf('://');
  if (separator <= 0) return false;
  // 协议闸：只放 http / https（大小写不敏感）。
  if (!EVIDENCE_LINK_SCHEMES.has(url.slice(0, separator).toLowerCase())) return false;
  const authority = url.slice(separator + 3).split(/[/?#]/u, 1)[0] ?? '';
  // 账号密码闸：主机段出现 `@` 即视为带账号（含 `https://@host` 这种空账号）。
  if (authority.includes('@')) return false;
  if (authority.includes(BACKSLASH)) return false;
  return isValidLinkAuthority(authority);
}

/** WHATWG `URL` 解析结果里本判定要用的字段（共享层没有 `URL` 全局，解析器由调用方注入）。 */
export interface PlanningEvidenceLinkParse {
  readonly protocol: string;
  readonly username: string;
  readonly password: string;
  readonly hostname: string;
  readonly href: string;
}

/**
 * 能交系统浏览器打开的外部链接：先过文法，再用调用方注入的 WHATWG 解析器解一遍——解析得了、协议仍是
 * http / https、没有账号密码、主机非空——才返回解析结果（打开用它规范化后的 `href`），否则 `null`。
 *
 * ⭐ 渲染时「这条可不可点」（渲染层的 `URL`）与主进程打开前的二次校验（Node 的 `URL`）共用这一份：
 *    文法过得了、却根本不是地址的串（如 `https://[:::]/`）在这两层都被挡下，⛔ 不交给系统浏览器。
 */
export function openablePlanningEvidenceLink<T extends PlanningEvidenceLinkParse>(
  url: string,
  parse: (raw: string) => T,
): T | null {
  if (!isSafePlanningEvidenceLinkUrl(url)) return null;
  let parsed: T;
  try {
    parsed = parse(url);
  } catch {
    return null;
  }
  const httpScheme = parsed.protocol === 'http:' || parsed.protocol === 'https:';
  return httpScheme && parsed.username === '' && parsed.password === '' && parsed.hostname !== ''
    ? parsed
    : null;
}

/** `link:<地址>` ⇒ 地址（仅当它过得了 `isSafePlanningEvidenceLinkUrl`）；其余 token 一律 `null`。 */
export function planningEvidenceLinkUrl(token: string): string | null {
  if (!token.startsWith(PLANNING_EVIDENCE_LINK_PREFIX)) return null;
  const url = token.slice(PLANNING_EVIDENCE_LINK_PREFIX.length);
  return isSafePlanningEvidenceLinkUrl(url) ? url : null;
}

/**
 * 提交的证据引用（**写入前**的输入校验），按前缀分两条规则：
 *  - `link:` 开头 ⇒ **只**认合规的外部链接（`planningEvidenceLinkUrl`），整条 ≤256；
 *  - 其余 ⇒ 待办 `refs`、动态评论 `refs` 共用的 token 闭集（`PROJECT_REF_TOKEN_PATTERN`，取自
 *    `project-collab.ts`，⛔ 不另立一份、⛔ 也不为链接放宽它）。
 * ⚠️ 共用闭集的字符集放得过 `link:javascript:void` 这类串，所以 `link:` ⛔ 不能落回它兜底。
 * ⚠️ 写侧比服务端严是允许的；⛔ 读侧**不许**跟着严，见 `evidenceRefRecordsSchema`。
 */
const evidenceRefInputsSchema = z
  .array(
    z
      .string()
      .refine(
        (token) =>
          token.startsWith(PLANNING_EVIDENCE_LINK_PREFIX)
            ? token.length <= PROJECT_PLANNING_EVIDENCE_REF_MAX_LENGTH &&
              planningEvidenceLinkUrl(token) !== null
            : PROJECT_REF_TOKEN_PATTERN.test(token),
        'invalid reference token',
      ),
  )
  .max(PROJECT_MAX_REFS);

/**
 * 读回的证据引用：**只按服务端写入契约收**——非空、≤256 字符、≤16 条（`models.ensure_short_refs`
 * 与 `MAX_EVIDENCE_REFS` 同界）。
 * ⛔ 这里**不许**套 token 正则：服务端写入时不查它，别的写入方写进含空白的引用是合法数据；
 *    读侧若更严，一条就让整页阶段记录解析失败（映射层 `mapArray` 一条坏全批坏）——用户看到的是
 *    「阶段记录取不回来」，而那份历史本身毫无问题。
 * ⛔ 同理也**不许**套链接文法：服务端复检 `link:`（ADR-0036）之前落库的坏链接照样是历史，读回照收，
 *    可不可点由渲染时再判。
 */
const evidenceRefRecordsSchema = z
  .array(z.string().min(1).max(PROJECT_PLANNING_EVIDENCE_REF_MAX_LENGTH))
  .max(PROJECT_MAX_REFS);

/* ── 写：记录达成 / 重新打开 ─────────────────────────────────────────────────── */

/** 目标 / 轮次的生命周期动作：记录达成 / 重新打开（值与服务端路径段逐字一致）。 */
export const ProjectPlanningLifecycleActionSchema = z.enum(['complete', 'reopen']);

const lifecycleRequestShape = {
  projectId: entityIdSchema,
  /** 乐观锁：不匹配回 conflict + currentVersion（并发重开 / 重复完成据此可恢复）。 */
  expectedVersion: expectedVersionSchema,
  /**
   * 幂等键。⭐ 同一次提交的重试**保持不变**（服务端命中同一条记录回原结果）；
   * ⚠️ 内容（`reason` / `evidenceRefs`）改过再提交必须换新号——同号异内容服务端回
   *    conflict + `idempotency_conflict`，那是死路。
   */
  clientRequestId: clientRequestIdSchema,
  /**
   * 完成时＝达成说明（验收结果 / 交付依据），重开时＝原因。用户亲笔。
   * 空串在形状上可表达：「必填」由服务端判（422），与业务规则同一个出处。
   */
  reason: authoredMarkdown(PROJECT_PLANNING_LIFECYCLE_REASON_MAX_LENGTH),
  /** 授权证据引用。完成至少一条（服务端判）；重开可空。 */
  evidenceRefs: evidenceRefInputsSchema,
} as const;

/** `project:milestone-complete` / `project:milestone-reopen`（**manager+**，服务端强判）。 */
export const ProjectMilestoneLifecycleRequestSchema = z.strictObject({
  ...lifecycleRequestShape,
  milestoneId: entityIdSchema,
});

/** `project:iteration-complete` / `project:iteration-reopen`（**manager+**，服务端强判）。 */
export const ProjectIterationLifecycleRequestSchema = z.strictObject({
  ...lifecycleRequestShape,
  iterationId: entityIdSchema,
});

/**
 * 写结果：成功回改完之后的权威投影（与列表行**逐字同形**，拼回列表不丢聚合与关联摘要）。
 * ⚠️ 幂等回放与真改动出参相同，⛔ 客户端不据此区分——两者对用户都是「已记录」。
 * 失败分支的 `currentVersion` **仅**版本冲突时非空，其余失败恒为 null。
 */
export const ProjectMilestoneLifecycleResultSchema = z.discriminatedUnion('ok', [
  z.strictObject({ ok: z.literal(true), milestone: ProjectMilestoneListItemSchema }),
  z.strictObject({
    ok: z.literal(false),
    ...lifecycleErrorShape,
    currentVersion: expectedVersionSchema.nullable(),
  }),
]);

export const ProjectIterationLifecycleResultSchema = z.discriminatedUnion('ok', [
  z.strictObject({ ok: z.literal(true), iteration: ProjectIterationListItemSchema }),
  z.strictObject({
    ok: z.literal(false),
    ...lifecycleErrorShape,
    currentVersion: expectedVersionSchema.nullable(),
  }),
]);

/* ── 读：阶段记录 ────────────────────────────────────────────────────────────── */

/**
 * 阶段记录的一行（一次记录达成或重新打开）。线协议字段逐条对应：`id` /
 * `milestone_id`|`iteration_id` / `from_status` / `to_status` / `actor_subject` / `reason` /
 * `evidence_refs` / `occurred_at`。
 *
 * ⭐ 达成时刻**不在**目标 / 轮次行上（没有完成时间列）：它由 `toStatus === 'completed'` 那一行的
 *    `occurredAt` 派生——「做完了没」只有一个能被写的答案。
 * ⚠️ `reason` / `evidenceRefs` 是本契约里仅有的自由正文，⛔ 只在这里（REST）出现。
 * ⛔ 读侧每一格都**不严于服务端写入契约**（`mapArray` 一条坏全批坏）：说明 ≤4000（库 CHECK 同界）、
 *    操作人 1..256（库 CHECK 同界）、证据引用见 `evidenceRefRecordsSchema`；也不设
 *    `fromStatus !== toStatus` 的客户端校验（库层 CHECK 已保证）。
 */
const lifecycleEventShape = {
  id: entityIdSchema,
  /** 谁做的。⛔ 不带显示名快照（名册是名称的唯一真相源）。 */
  actorSubject: subjectSchema,
  reason: authoredMarkdown(PROJECT_PLANNING_LIFECYCLE_REASON_MAX_LENGTH),
  evidenceRefs: evidenceRefRecordsSchema,
  occurredAt: timestampSchema,
} as const;

export const ProjectMilestoneLifecycleEventSchema = z.strictObject({
  ...lifecycleEventShape,
  milestoneId: entityIdSchema,
  fromStatus: ProjectMilestoneStatusSchema,
  toStatus: ProjectMilestoneStatusSchema,
});

export const ProjectIterationLifecycleEventSchema = z.strictObject({
  ...lifecycleEventShape,
  iterationId: entityIdSchema,
  fromStatus: ProjectIterationStatusSchema,
  toStatus: ProjectIterationStatusSchema,
});

const lifecycleEventPageShape = {
  projectId: entityIdSchema,
  page: z.number().int().positive().optional(),
  pageSize: z.number().int().positive().max(PROJECT_PLANNING_MAX_PAGE_SIZE).optional(),
} as const;

/**
 * `project:milestone-events`：一个业务目标的阶段记录（按项目可读权限，viewer 也能读）。
 * ⚠️ **已归档的目标照样读得到**（归档保留历史，服务端只判存在、不套归档闸）。
 * 按发生时刻升序。
 */
export const ProjectMilestoneLifecycleEventListRequestSchema = z.strictObject({
  ...lifecycleEventPageShape,
  milestoneId: entityIdSchema,
});

/** `project:iteration-events`：一轮迭代的阶段记录（同上：归档仍可读，正文只在 REST 面）。 */
export const ProjectIterationLifecycleEventListRequestSchema = z.strictObject({
  ...lifecycleEventPageShape,
  iterationId: entityIdSchema,
});

export const ProjectMilestoneLifecycleEventListResultSchema = z.discriminatedUnion('ok', [
  z.strictObject({
    ok: z.literal(true),
    items: z.array(ProjectMilestoneLifecycleEventSchema),
    ...pageShape,
  }),
  z.strictObject({ ok: z.literal(false), ...lifecycleErrorShape }),
]);

export const ProjectIterationLifecycleEventListResultSchema = z.discriminatedUnion('ok', [
  z.strictObject({
    ok: z.literal(true),
    items: z.array(ProjectIterationLifecycleEventSchema),
    ...pageShape,
  }),
  z.strictObject({ ok: z.literal(false), ...lifecycleErrorShape }),
]);

/* ── 打开证据引用里的外部链接（ADR-0036）───────────────────────────────────── */

/**
 * `project:evidence-link-open`：把一条证据引用里的外部链接交**系统浏览器**打开。
 *
 * ⚠️ 请求只收**形状**（非空、≤256）。可不可以打开由主进程在处理器里用
 *    `openablePlanningEvidenceLink`（文法 + Node 的解析器）**再判一次**——⛔ 别把那道判定挪进这个
 *    schema：主进程侧的二次校验必须是处理器里一处看得见的代码，渲染层判过「可点」也不作数。
 * ⛔ 渲染层自己不导航、不开窗；地址只进这条通道与系统浏览器，不进日志与埋点。
 */
export const ProjectEvidenceLinkOpenRequestSchema = z.strictObject({
  url: z.string().min(1).max(PROJECT_PLANNING_EVIDENCE_REF_MAX_LENGTH),
});

export const ProjectEvidenceLinkOpenResultSchema = z.discriminatedUnion('ok', [
  z.strictObject({ ok: z.literal(true), url: z.string().optional() }),
  z.strictObject({ ok: z.literal(false), ...lifecycleErrorShape }),
]);

/* ── 呈现辅助 ────────────────────────────────────────────────────────────────── */

/**
 * 当前状态下能做的那个动作：进行中 ⇒ 记录达成；已达成 ⇒ 重新打开。
 * ⚠️ 只用于**呈现**（不摆一个点了必 409 的入口）——状态闸在服务端。
 */
export function planningLifecycleActionFor(
  status: ProjectIterationStatus,
): ProjectPlanningLifecycleAction {
  return status === 'completed' ? 'reopen' : 'complete';
}

/** 这个动作要求的当前状态：记录达成要求进行中、重新打开要求已达成（与服务端状态闸同口径）。 */
export function planningLifecycleRequiredStatus(
  action: ProjectPlanningLifecycleAction,
): ProjectIterationStatus {
  return action === 'complete' ? 'open' : 'completed';
}

/**
 * 规划域生命周期与归档的**服务端业务码** → 报错条文案（就地覆盖通用文案）。
 *
 * 与 `projectAssetServerCodeText` / `projectOpenInvitationErrorText` 同一条纪律：文案收口在
 * 共享层，渲染层不手抄第二份中文；⛔ 业务码本身不露给用户。认不出的码与缺席一律 `null`，
 * 调用方退回按 `code` 取的通用句（带参考编号）。
 *
 * ⚠️ 版本冲突**不在这里**：它经 `currentVersion` 非空表达（网络面读到 `current_version`
 *    就不再带业务码），调用方先判它再查本表。
 */
export function projectPlanningLifecycleServerCodeText(
  serverCode: string | null | undefined,
): string | null {
  switch (serverCode) {
    // 完成 / 重开的必填（422）。
    case 'completion_note_required':
      return '请填写验收结果 / 交付依据后再确认达成。';
    case 'completion_evidence_required':
      return '请至少关联一份交付依据后再确认达成。';
    case 'reopen_reason_required':
      return '请填写重新打开原因。';
    // 证据引用里的外部链接过不了服务端的同一份文法（422，ADR-0036）。
    case 'evidence_link_invalid':
      return '证据链接不合法，请检查后重试。';
    // 业务目标完成门槛（409）。
    case 'milestone_needs_a_round':
      return '该业务目标下还没有进行中的迭代计划，至少完成一轮迭代后才能记录达成。';
    case 'milestone_has_open_rounds':
      return '该业务目标下还有未达成的迭代计划，请先记录达成或归档它们。';
    // 状态已被别人改过（409）。
    case 'milestone_already_completed':
      return '该业务目标已记录达成，无需重复操作。';
    case 'iteration_already_completed':
      return '该迭代计划已记录达成，无需重复操作。';
    case 'milestone_not_completed':
      return '该业务目标当前未达成，无需重新打开。';
    case 'iteration_not_completed':
      return '该迭代计划当前未达成，无需重新打开。';
    // 归档即只读：已归档的对象拒绝完成与重开（409）。
    case 'milestone_archived':
      return '该业务目标已归档，恢复后才能记录达成或重新打开。';
    case 'iteration_archived':
      return '该迭代计划已归档，恢复后才能记录达成或重新打开。';
    // ⚠️ 归档不再因在排需求被拒（ADR-0040：连带移出），此前的两个 409 码已不存在。
    // 幂等（409）。
    case 'idempotency_conflict':
      return '提交内容与上一次不一致，请再确认提交一次。';
    case 'idempotency_retry':
      return '上一次提交还在处理中，请稍后再试一次。';
    // 不存在 / 跨项目（404）。
    case 'milestone_not_found':
      return '该业务目标不存在或已不可见，请刷新后重试。';
    case 'iteration_not_found':
      return '该迭代计划不存在或已不可见，请刷新后重试。';
    // 项目在弹层开着时被归档（写路径带档位即套只读门，403）：说清是「归档只读」，
    // ⛔ 别落成通用的「没有执行该操作的权限」——管理者会以为自己被降了档。
    case 'project_archived':
      return '项目已归档，内容只读，恢复后才能继续操作。';
    default:
      return null;
  }
}

export type ProjectPlanningLifecycleAction = z.infer<typeof ProjectPlanningLifecycleActionSchema>;
export type ProjectMilestoneLifecycleRequest = z.infer<
  typeof ProjectMilestoneLifecycleRequestSchema
>;
export type ProjectIterationLifecycleRequest = z.infer<
  typeof ProjectIterationLifecycleRequestSchema
>;
export type ProjectMilestoneLifecycleResult = z.infer<typeof ProjectMilestoneLifecycleResultSchema>;
export type ProjectIterationLifecycleResult = z.infer<typeof ProjectIterationLifecycleResultSchema>;
export type ProjectMilestoneLifecycleEvent = z.infer<typeof ProjectMilestoneLifecycleEventSchema>;
export type ProjectIterationLifecycleEvent = z.infer<typeof ProjectIterationLifecycleEventSchema>;
export type ProjectMilestoneLifecycleEventListRequest = z.infer<
  typeof ProjectMilestoneLifecycleEventListRequestSchema
>;
export type ProjectIterationLifecycleEventListRequest = z.infer<
  typeof ProjectIterationLifecycleEventListRequestSchema
>;
export type ProjectMilestoneLifecycleEventListResult = z.infer<
  typeof ProjectMilestoneLifecycleEventListResultSchema
>;
export type ProjectIterationLifecycleEventListResult = z.infer<
  typeof ProjectIterationLifecycleEventListResultSchema
>;
export type ProjectEvidenceLinkOpenRequest = z.infer<typeof ProjectEvidenceLinkOpenRequestSchema>;
export type ProjectEvidenceLinkOpenResult = z.infer<typeof ProjectEvidenceLinkOpenResultSchema>;
