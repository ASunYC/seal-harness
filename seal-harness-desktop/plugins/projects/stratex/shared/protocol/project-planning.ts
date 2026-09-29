import { z } from 'zod';

import {
  PROJECT_TODO_MAX_TITLE_LENGTH,
  ProjectCollabErrorCodeSchema,
  ProjectCollabReferenceCodeSchema,
  ProjectCollabServerCodeSchema,
  TodoStatusSchema,
} from './project-collab.js';
import { projectPlanWindowShape, refineProjectPlanWindow } from './project-collab-plan-dates.js';

/**
 * 规划域（业务目标 / 多轮迭代）的**持久化模型**契约与请求/响应契约。
 *
 * 本文件只描述服务端迁移 `0019_project_milestones_iterations.sql` 建出来的两张表：
 *  - `project_milestones` 业务目标（例：成员邀请与权限管理）
 *  - `project_iterations` 该目标下的多轮迭代
 *
 * 本文件后半段是**请求/响应契约**（CRUD 与权限链路 + 迭代 ↔ 需求的关联历史）。
 *
 * ⭐ 关联历史（服务端迁移 `0022_iteration_requirements.sql`）在这里表达为三样东西：
 *    一份**授权摘要**（`ProjectIterationRequirementSchema`，随每一轮返回）、一个
 *    **独立分页**端点、以及关联/移出两条写请求。
 *    ⚠️ 「需求当前排在哪一轮」在需求那一侧是 `TodoSchema.iterationId` / `.iteration`
 *       （`project-collab.ts`），那是服务端从 active 关联行**派生**出来的读投影，
 *       ⛔ 客户端没有、也不会有任何写它的请求形状——排期只能走本文件这两条写请求。
 *
 * 字段命名口径与 `project-collab.ts` 逐条一致，不另立一套：
 *  - 服务端 HTTP 与 DDL 是 `snake_case`，客户端契约是 `camelCase`；
 *  - 两者之间的**投影发生在 Main 的线协议映射层**（`src/main/services/collab/`
 *    的 `collabWireMapping.ts` / `mapTodo` 那一支），不在本文件里。协议层只声明
 *    客户端形状，映射函数随 CRUD 那条线落到映射层，避免同一份字段名映射有两个落点。
 *    逐字段对应关系写在下面每个 schema 的注释里，映射层照它实现即可。
 *
 * ⚠️ 三条红线由本文件的 schema 结构性承载（与 `project-collab.ts` 同一份纪律）：
 *
 *  1. 【账号】契约里**没有** accountKey 或任何账号字段。账号由 Main 从会话态推导。
 *     `strictObject` 让它连「多带一个字段」都不可表达——不可表达的东西不需要在
 *     运行时校验。
 *
 *  2. 【埋点红线】契约里**没有**任何助手会话正文字段（prompt / answer / 命令参数 /
 *     查询词 / 文件内容 / 本机路径）。唯一的自由正文是用户**亲笔**写下的字：
 *     目标名称与目标说明、轮次名称与达成标准。
 *
 *  3. 【白标】标识符、注释与文案一律不含内核品牌词根；能力用中性词表述。
 */

/**
 * 业务目标名称的字符上限。
 * 与服务端 DDL `project_milestones.name` 的 `length(name) BETWEEN 1 AND 200` **同界**。
 * 改小是允许的（客户端拒绝的服务端必拒），改大会得到一个本地过、服务端 422 的请求。
 */
export const PROJECT_MILESTONE_MAX_NAME_LENGTH = 200;

/** 业务目标说明（markdown）的字符上限，与项目指令/动态正文同界。 */
export const PROJECT_MILESTONE_MAX_OBJECTIVE_LENGTH = 20_000;

/** 单轮迭代名称的字符上限（与业务目标同界，同一族对象不设两个数）。 */
export const PROJECT_ITERATION_MAX_NAME_LENGTH = 200;

/** 单轮迭代达成标准（markdown）的字符上限。 */
export const PROJECT_ITERATION_MAX_CRITERIA_LENGTH = 20_000;

/**
 * 业务目标与迭代的生命周期状态：进行中 / 已达成。
 *
 * ⚠️ 这**不是**待办的四值状态集（notStarted / inProgress / done / cancelled）。
 * 轮次问的是「这轮达成了没」，需求问的是「这条做到哪一步了」——合成一个集合，
 * 「迭代达成不写需求完成状态」那条判据就没有落点了。服务端两张表的 CHECK
 * `status IN ('open', 'completed')` 是同一件事的库层载体。
 */
export const ProjectMilestoneStatusSchema = z.enum(['open', 'completed']);
export const ProjectIterationStatusSchema = z.enum(['open', 'completed']);

/**
 * 迭代优先级三档。**刻意与待办逐字同一份**（服务端 `todos.priority` 同一个闭集）：
 * 列表上按优先级排序用的是同一个下拉，取值集合分叉一次客户端就得养两张映射表。
 */
export const ProjectIterationPrioritySchema = z.enum(['high', 'medium', 'low']);

/**
 * 服务端资源 id（uuid）。
 *
 * ⭐ 关联键只能是 UUID：业务目标的**名称可重复**（同一个项目里连着两个季度各立一个
 * 同名目标是常态），日期更会被随手改。名称或日期一旦当键，「改个名」就会变成一次
 * 关联关系的静默重排。服务端侧的同一条纪律是两张表都没有 `UNIQUE(name)`、也没有
 * 任何把日期列纳进去的唯一约束。
 */
const entityIdSchema = z.string().uuid();

/** 成员身份主体（服务端不存 accountKey，客户端契约同样不表达）。 */
const subjectSchema = z.string().min(1).max(256);

/** ISO8601 时间串（服务端原样，展示用；客户端不解析成时钟）。 */
const timestampSchema = z.string().max(64);

/** 用户亲笔正文。允许换行与空串（空串 ＝ 没写）；只拒 NUL（与既有协议同口径）。 */
const authoredMarkdown = (maxLength: number): z.ZodString =>
  z
    .string()
    .max(maxLength)
    .refine((value) => !value.includes('\0'), 'NUL is forbidden');

/** 用户亲笔的名称：不许为空，其余同上。 */
const authoredName = (maxLength: number): z.ZodString =>
  z
    .string()
    .min(1)
    .max(maxLength)
    .refine((value) => !value.includes('\0'), 'NUL is forbidden');

/**
 * 乐观并发的版本号。
 *
 * ⛔ **不设上界**，别给它安一个「够用的」常量。这是服务端单调递增的计数，客户端单方面
 * 定的任何数字都只是下一堵墙；而越界的代价远不止这一条：列表投影一条坏全批坏
 * （映射层见 null 即整页返回 null），所以一旦越界，表现不是「少显示一行」，
 * 是整个列表取不回来。同一条纪律适用于后续所有服务端计数字段
 * （轮次汇总、关联需求数、分组计数）——一律不设客户端上界。
 */
const versionSchema = z.number().int().safe().positive();

/**
 * 业务目标（一条 `project_milestones` 行的客户端投影）。
 *
 * 线协议字段逐条对应：`id` / `project_id` / `name` / `objective_md` / `owner_subject` /
 * `status` / `start_at` / `due_at` / `archived_at` / `version` / `creator_subject` /
 * `created_at` / `updated_at`。
 *
 * ⚠️ `projectId` **不在**这里：目标恒在某个项目的上下文里被读出来，把它再塞进每一行
 * 只会多出一个可以与请求上下文矛盾的字段。服务端的 project 归属由 `project_id` 列与
 * 复合外键保证，客户端不需要也不该拿它做二次判断。
 */
export const ProjectMilestoneSchema = z.strictObject({
  id: entityIdSchema,
  name: authoredName(PROJECT_MILESTONE_MAX_NAME_LENGTH),
  objectiveMd: authoredMarkdown(PROJECT_MILESTONE_MAX_OBJECTIVE_LENGTH),
  /**
   * 负责人。null ＝ 还没指派。
   *
   * 只有 subject，**没有显示名快照**：显示名从授权成员名册（或历史身份）解析，
   * 解析不到显示未知。这样改名之后卡片上不会留着旧名字。
   */
  ownerSubject: subjectSchema.nullable(),
  status: ProjectMilestoneStatusSchema,
  /** 计划起止日期，都可空。它们是**计划**，不是完成事实。 */
  startAt: timestampSchema.nullable(),
  dueAt: timestampSchema.nullable(),
  /**
   * 归档时刻。null ＝ 未归档。
   *
   * 归档是**打标记**而不是删除：归档后子轮次与历史一行不少，只是默认列表不再取它、
   * 也不再接受新绑定。所以这个契约里没有、也不会有 `deletedAt`。
   */
  archivedAt: timestampSchema.nullable(),
  version: versionSchema,
  creatorSubject: subjectSchema,
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
});

/**
 * 单轮迭代（一条 `project_iterations` 行的客户端投影）。
 *
 * 线协议字段逐条对应：`id` / `milestone_id` / `name` / `criteria_md` / `owner_subject` /
 * `priority` / `status` / `due_at` / `archived_at` / `version` / `creator_subject` /
 * `created_at` / `updated_at`。
 */
export const ProjectIterationSchema = z.strictObject({
  id: entityIdSchema,
  /**
   * ⭐ 所属业务目标。**null ＝ 未关联**，这是有意的产品状态，不是脏数据。
   *
   * 旧生产迭代没有业务目标，而当前**没有任何明确映射**可用；界面把这些轮次呈现为
   * 「未关联」，等管理者明确指定后才逐条改绑。⛔ 别在调用点写 `?? someDefault`
   * 把它兜成某个目标，也别从名称或日期去猜归属——判「关不关联」走
   * `isProjectIterationUnlinked`。
   *
   * 服务端侧的同一条纪律：`milestone_id` 列可空，复合外键
   * `(milestone_id, project_id) → project_milestones(id, project_id)` 在它为 NULL 时
   * 直接放行，非 NULL 时强制**同项目**。
   */
  milestoneId: entityIdSchema.nullable(),
  name: authoredName(PROJECT_ITERATION_MAX_NAME_LENGTH),
  criteriaMd: authoredMarkdown(PROJECT_ITERATION_MAX_CRITERIA_LENGTH),
  /** 本轮负责人。null ＝ 还没指派；与业务目标同口径，不带显示名快照。 */
  ownerSubject: subjectSchema.nullable(),
  priority: ProjectIterationPrioritySchema,
  status: ProjectIterationStatusSchema,
  /**
   * ⭐ 到期日，可空，而且**只是一个日期字段**：有值不代表这轮做完了，空值也不代表
   * 没排期。达成事实走 `status`；所以这个契约里刻意没有完成时间字段——否则
   * 「做完了没」会有两个各自能被写的答案。
   */
  dueAt: timestampSchema.nullable(),
  /** 归档时刻。null ＝ 未归档；归档保留本轮与它的历史关联。 */
  archivedAt: timestampSchema.nullable(),
  version: versionSchema,
  creatorSubject: subjectSchema,
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
});

export type ProjectMilestone = z.infer<typeof ProjectMilestoneSchema>;
export type ProjectIteration = z.infer<typeof ProjectIterationSchema>;
export type ProjectMilestoneStatus = z.infer<typeof ProjectMilestoneStatusSchema>;
export type ProjectIterationStatus = z.infer<typeof ProjectIterationStatusSchema>;
export type ProjectIterationPriority = z.infer<typeof ProjectIterationPrioritySchema>;

/**
 * 这一轮有没有归到某个业务目标下。
 *
 * 「未关联」在界面上是一个要显式标出来的状态（旧生产轮次就在这一档），所以判定
 * 收口成一个函数：调用点各写一遍 `iteration.milestoneId === null` 迟早会有人写成
 * `!iteration.milestoneId`，而那条在空串上也成立。
 */
export function isProjectIterationUnlinked(iteration: ProjectIteration): boolean {
  return iteration.milestoneId === null;
}

/** 这条业务目标还能不能接受新的轮次绑定（归档后只读，历史保留）。 */
export function isProjectMilestoneArchived(milestone: ProjectMilestone): boolean {
  return milestone.archivedAt !== null;
}

/**
 * 失败信封的共同形状：与协作面逐字同一套（`projectCollabErrorShape` 未导出，
 * 所以这里按同样的三键 + 可选 serverCode 重新声明，**取值闭集仍是那一份**）。
 *
 * ⚠️ 这不是「又造了一套」：`code` / `referenceCode` / `serverCode` 三个闭集都从
 * `project-collab.ts` 导入，本地只重复了「把它们拼成一个信封」这一步。真要合并成
 * 一处就得把 project-collab.ts 的私有常量导出，那属于另一条线的改动面。
 */
export const projectPlanningErrorShape = {
  code: ProjectCollabErrorCodeSchema,
  message: z.string().max(2_048),
  referenceCode: ProjectCollabReferenceCodeSchema,
  serverCode: ProjectCollabServerCodeSchema.optional(),
} as const;

/* ══════════════════════════════════════════════════════════════════════════════
 * 请求 / 响应契约（CRUD 与权限链路）
 *
 * 失败信封**复用协作面那一套**（`ProjectCollabErrorCodeSchema` +
 * `PROJECT_COLLAB_REFERENCE_CODES`）而不另立一份：规划面与项目其余通道落在同一
 * 批界面、走同一个服务、同一套网络分档。再造一套失败码等于让用户在同一个页面里
 * 拿到两族参考编号，而报障时说不清该抄哪一个。
 * ⚠️ 外部数据源那条线**另起**了一份，是因为它的失败原因集合与协作面正交（白名单
 *    没开 / 仓库没有任务目录 / 票据被拒）；本域没有这种正交面，所以不分家。
 * ═══════════════════════════════════════════════════════════════════════════ */

/**
 * 幂等键（`clientRequestId`）的字符上限，与服务端 `MAX_CLIENT_REQUEST_ID_CHARS` 同界。
 *
 * ⭐ 它在每条写请求里**必填**而不是可选：可选的幂等键等于没有幂等键——漏带的那条
 * 路径会安静地退化成「每次重试都新建一行」，而那正是要防的事。schema 里 `min(1)`
 * 让「传了个空串」也表达不出来。
 */
export const PROJECT_PLANNING_MAX_CLIENT_REQUEST_ID_LENGTH = 128;

/** 列表一页的条数上界，与服务端 `MAX_PAGE_SIZE` 同界。 */
export const PROJECT_PLANNING_MAX_PAGE_SIZE = 100;

const clientRequestIdSchema = z.string().min(1).max(PROJECT_PLANNING_MAX_CLIENT_REQUEST_ID_LENGTH);

/**
 * 乐观锁的期望版本：写请求必带。不匹配时服务端回 409 并带回当前版本。
 * ⛔ 同 `versionSchema`，不设上界。
 */
const expectedVersionSchema = z.number().int().safe().positive();

/**
 * 服务端聚合出来的计数。
 *
 * ⛔ **一律不设上界**（没有 `.max()`）。这不是随手省略：映射层的 `mapArray` 一条坏
 * 全批坏——任一行解析失败即整页返回 null，表现是「列表空白」，看不出是哪一行越界。
 * 已发生过的事故就是给 `childTotal` 加了 `.max(500)`，子树超 500 条时整个看板取不
 * 回来。轮次汇总、关联需求数、分组计数都是服务端计数，同一条纪律。
 */
const serverCountSchema = z.number().int().nonnegative();

/** 排序字段白名单（与服务端 `ITERATION_SORT_COLUMNS` 同一份闭集）。 */
export const ProjectIterationSortSchema = z.enum(['due_at', 'priority', 'created_at', 'name']);

/**
 * 一个业务目标下的轮次汇总。**只数未归档轮次**（归档行不回到进行中）。
 * `total = open + completed` 由服务端保证，客户端不重算也不校验——校验会把一次
 * 正当的服务端口径调整变成「整页取不回来」。
 */
export const ProjectMilestoneIterationSummarySchema = z.strictObject({
  total: serverCountSchema,
  open: serverCountSchema,
  completed: serverCountSchema,
});

/**
 * 列表行：业务目标本体 + 服务端聚合。
 *
 * ⭐ `visibleRequirementCount` 是本目标下**看的人读得到**的需求**去重**条数
 * （服务端 `COUNT(DISTINCT requirement_id)`）。同一条需求在这个目标下经历两轮 ⇒
 * 两行关联，只算一条。
 * ⚠️ 口径是「**涉及过**」（当前排期 + 历史都算，归档轮次也算），不是「当前排着」——
 *    所以移出一条需求之后这个数**不会**降。取这一口径的理由：单需求至多一个 active
 *    排期，按 active 计数时 distinct 恒等于行数，判据里的 distinct 会变成永真的话。
 *    ⚠️ 渲染层给它配文案时别写成「当前关联 N 条」。
 * ⚠️ 0022 之前它结构上恒为 0（关联表还不存在）；旧注释那么写在当时是对的。
 * ⛔ 渲染层不得自算它——本地算不出别人看得见什么。
 */
export const ProjectMilestoneListItemSchema = ProjectMilestoneSchema.extend({
  iterationSummary: ProjectMilestoneIterationSummarySchema,
  visibleRequirementCount: serverCountSchema,
});

/**
 * 迭代列表的分组计数：每个分组各自**按 id 去重的集合势**。
 *
 * ⚠️ 同一轮会同时落进 `mine` 与 `open` ⇒ 三个数**相加不等于** `total`。
 * 要总数用响应里的 `total`，⛔ 别把分组加起来。
 */
export const ProjectIterationGroupCountsSchema = z.strictObject({
  mine: serverCountSchema,
  open: serverCountSchema,
  completed: serverCountSchema,
});

const planningPageShape = {
  total: serverCountSchema,
  page: z.number().int().positive(),
  pageSize: z.number().int().positive(),
} as const;

/* ── 业务目标 ───────────────────────────────────────────────────────────── */

/**
 * `project:milestone-list`：按项目可读权限列出业务目标（viewer 也能读）。
 *
 * ⭐ `planFrom` / `planTo`（CORE-08，ADR-0042）：目标自身起止与时间段交叠，或名下任一未归档迭代的截止日
 *    落在时间段内即命中；与归档、关键字 AND 叠加，在分页之前。两端都给时要求起点早于终点。
 */
export const ProjectMilestoneListRequestSchema = z
  .strictObject({
    projectId: entityIdSchema,
    page: z.number().int().positive().optional(),
    pageSize: z.number().int().positive().max(PROJECT_PLANNING_MAX_PAGE_SIZE).optional(),
    /** 关键字：**只按名称**匹配。目标说明是用户亲笔的长正文，不进搜索面。 */
    q: z.string().min(1).max(PROJECT_MILESTONE_MAX_NAME_LENGTH).optional(),
    /** 归档保留轮次与历史，默认列表不取；要读得到就显式要。 */
    includeArchived: z.boolean().optional(),
    ...projectPlanWindowShape,
  })
  .superRefine(refineProjectPlanWindow);

export const ProjectMilestoneListResultSchema = z.discriminatedUnion('ok', [
  z.strictObject({
    ok: z.literal(true),
    items: z.array(ProjectMilestoneListItemSchema),
    ...planningPageShape,
  }),
  z.strictObject({ ok: z.literal(false), ...projectPlanningErrorShape }),
]);

/**
 * `project:milestone-create`：建业务目标（**manager+**，服务端强判）。
 *
 * `name` / `objectiveMd` 是用户亲笔。⛔ 没有 `status`：新目标恒为进行中，
 * 「已达成」只能由完成动作产生（那条线另有留证要求）。
 */
export const ProjectMilestoneCreateRequestSchema = z.strictObject({
  projectId: entityIdSchema,
  clientRequestId: clientRequestIdSchema,
  name: authoredName(PROJECT_MILESTONE_MAX_NAME_LENGTH),
  objectiveMd: authoredMarkdown(PROJECT_MILESTONE_MAX_OBJECTIVE_LENGTH).optional(),
  /** `null` ＝ 不指派负责人（缺席同义）。 */
  ownerSubject: subjectSchema.nullable().optional(),
  startAt: timestampSchema.nullable().optional(),
  dueAt: timestampSchema.nullable().optional(),
});

export const ProjectMilestoneCreateResultSchema = z.discriminatedUnion('ok', [
  z.strictObject({ ok: z.literal(true), milestone: ProjectMilestoneListItemSchema }),
  z.strictObject({ ok: z.literal(false), ...projectPlanningErrorShape }),
]);

/**
 * `project:milestone-update`：改业务目标，含归档与恢复（**manager+**）。
 *
 * 缺席 ＝ 不改；`null` ＝ 清空（负责人/日期可清）。至少带一项变更。
 * `archived` 是**动作标记**而不是时间戳：true ＝ 归档、false ＝ 恢复，时刻由服务端定。
 *
 * ⛔ 刻意没有 `status`：目标的完成与重开要留达成说明与证据，属另一条线的专用动作，
 *    混进一次普通改单会出现「顺手改了个名字，目标就被标成已达成」。
 */
export const ProjectMilestoneUpdateRequestSchema = z
  .strictObject({
    projectId: entityIdSchema,
    milestoneId: entityIdSchema,
    expectedVersion: expectedVersionSchema,
    clientRequestId: clientRequestIdSchema,
    name: authoredName(PROJECT_MILESTONE_MAX_NAME_LENGTH).optional(),
    objectiveMd: authoredMarkdown(PROJECT_MILESTONE_MAX_OBJECTIVE_LENGTH).optional(),
    ownerSubject: subjectSchema.nullable().optional(),
    startAt: timestampSchema.nullable().optional(),
    dueAt: timestampSchema.nullable().optional(),
    archived: z.boolean().optional(),
  })
  .refine(
    (request) =>
      request.name !== undefined ||
      request.objectiveMd !== undefined ||
      request.ownerSubject !== undefined ||
      request.startAt !== undefined ||
      request.dueAt !== undefined ||
      request.archived !== undefined,
    { message: 'at least one field to update' },
  );

/**
 * 目标更新结果。失败分支的 `currentVersion` **仅** `code === 'conflict'` 时非空
 * （服务端 409 带回的当前版本，UI 据此提示刷新后重试），其余失败码恒为 null。
 *
 * ⚠️ ADR-0040 取代 ADR-0038 决策 5：归档不再因在排需求被拒（服务端连带移出；恢复只经 PATCH，排回规则见 ADR-0040），
 *    失败分支因此**没有**「在排需求条数」这个键——⛔ 界面不显示任何读不到的条数。
 */
export const ProjectMilestoneUpdateResultSchema = z.discriminatedUnion('ok', [
  z.strictObject({ ok: z.literal(true), milestone: ProjectMilestoneListItemSchema }),
  z.strictObject({
    ok: z.literal(false),
    ...projectPlanningErrorShape,
    currentVersion: expectedVersionSchema.nullable(),
  }),
]);

/* ── 迭代 ↔ 需求：关联历史 ─────────────────────────────────────────────────
 *
 * 服务端表 `iteration_requirements`（迁移 0022）：一条需求在一个项目里至多有**一个**
 * active 排期（库层 partial unique），过往轮次以 closed 行**全部保留**。
 * ⇒ 所以这里的形状要同时表达「当前」与「历史」，而不是只给一个当前值。
 */

/**
 * 一条关联记录算不算**当前排期**。
 *
 * ⚠️ 这**不是**待办的四值状态集，也不是轮次的 open/completed：它答的是「这条关联还算
 * 不算数」。三件事各有自己的字段，合成一个就再也表达不出「这条需求做完了，但它是在
 * 第一轮里做的」。
 *
 * ⚠️ 与 `product-contracts-v2.md` 的一处命名差异，以本文件为准：那里把这一栏写成
 *    `current_or_history`，而同一份文档的表定义里列名是 `state(active/closed)`。
 *    两个名字指同一件事，取**与库列同名**的那个——否则线协议与 DDL 会各叫一个名字，
 *    而读日志的人要在两套词之间翻译。
 */
export const ProjectIterationRequirementLinkStateSchema = z.enum(['active', 'closed']);

/**
 * 迭代上一条关联需求的**授权摘要**。
 *
 * ⭐ `requirementId` 是**需求自己的 UUID**（不是关联行的 id）：界面第二列要用它跳回
 *    原需求详情，而跳转认的是需求 id。
 *    ⚠️ 所以它**可以**直接喂给需求详情入口；⛔ 别拿它去查关联表。
 *
 * ⚠️ 服务端只返回**看的人读得到**的需求：别人的个人条目既不出现在这里，也不进任何
 *    计数——「有几条你看不见」本身就是泄露。⛔ 渲染层不得用摘要长度与别处的计数相减
 *    去推断隐藏条数。
 *
 * ⚠️ 与 `product-contracts-v2.md` 的第二处差异，以本文件为准：那里写的是
 *    `linked_requirements:[id,title,status,current_or_history]`，这里用
 *    `requirementId`（`id` 在同一个对象里会与「关联行的 id」混淆）并多带了两个时刻
 *    （定序与「什么时候不算了」都要用它们，而列表定序必须稳定）。
 */
export const ProjectIterationRequirementSchema = z.strictObject({
  requirementId: entityIdSchema,
  /** 需求标题（用户亲笔）。⛔ 它进 REST，但**绝不进事件面**。 */
  title: authoredName(PROJECT_TODO_MAX_TITLE_LENGTH),
  /** 需求自己的四值状态（与待办面**同一份**闭集，⛔ 不在本域另立一套）。 */
  status: TodoStatusSchema,
  linkState: ProjectIterationRequirementLinkStateSchema,
  linkedAt: timestampSchema,
  /** 非空 ⇒ 这一条关联是历史。服务端的 CHECK 保证它与 `linkState` 不会互相矛盾。 */
  unlinkedAt: timestampSchema.nullable(),
});

/**
 * 列表行：轮次本体 + 关联需求的授权摘要。
 *
 * ⚠️ `linkedRequirementsHasMore=true` 的含义是「这里没给全」，**不是**「剩下的被删了」
 * （`product-contracts-v2.md` 原文：不能把未返回的历史关联当成删除）。要全量走
 * `project:iteration-requirement-list`。
 * ⛔ 摘要数组**不设条数上界**：它是服务端截断后的结果，客户端再设一道只会让越界那一页
 *    整体取不回来（`mapArray` 一条坏全批坏）。
 */
export const ProjectIterationListItemSchema = ProjectIterationSchema.extend({
  linkedRequirements: z.array(ProjectIterationRequirementSchema),
  linkedRequirementsHasMore: z.boolean(),
});

/**
 * `project:iteration-requirement-list`：一轮关联需求的**独立分页**。
 *
 * `includeHistory` 缺省 false ＝ 只看当前排期；true ＝ 连过往轮次的 closed 关联一起给。
 * ⚠️ 已归档的轮次照样读得到（归档保留轮次与它的历史关联）。
 */
export const ProjectIterationRequirementListRequestSchema = z.strictObject({
  projectId: entityIdSchema,
  iterationId: entityIdSchema,
  page: z.number().int().positive().optional(),
  pageSize: z.number().int().positive().max(PROJECT_PLANNING_MAX_PAGE_SIZE).optional(),
  includeHistory: z.boolean().optional(),
});

export const ProjectIterationRequirementListResultSchema = z.discriminatedUnion('ok', [
  z.strictObject({
    ok: z.literal(true),
    items: z.array(ProjectIterationRequirementSchema),
    ...planningPageShape,
  }),
  z.strictObject({ ok: z.literal(false), ...projectPlanningErrorShape }),
]);

/**
 * 一条关联记录本体（写请求的出参）。
 *
 * ⭐ 它的 `id` 是**关联行**的 id，与摘要里的 `requirementId` 是两件事——写路径要它是
 *    为了让调用方能指到「刚落下的那一行」，读路径不需要它。
 */
export const ProjectIterationRequirementLinkSchema = z.strictObject({
  id: entityIdSchema,
  iterationId: entityIdSchema,
  requirementId: entityIdSchema,
  state: ProjectIterationRequirementLinkStateSchema,
  linkedAt: timestampSchema,
  unlinkedAt: timestampSchema.nullable(),
  /** 谁把这条需求排进这一轮。⛔ 不带显示名快照（名册是名称的唯一真相源）。 */
  linkedBySubject: subjectSchema,
  version: versionSchema,
});

/** 两条写请求的共同出参形状。 */
const iterationRequirementWriteShape = {
  /**
   * 这次调用**有没有真的改变什么**。
   *
   * false 的三种来路（对用户都不是错误）：幂等重发命中、「本来就排在这一轮」、
   * 「本来就已经不在这一轮」。⛔ 别把它当失败处理，也别据此重试。
   */
  changed: z.boolean(),
  link: ProjectIterationRequirementLinkSchema,
  /** 改完之后那一轮的权威投影（含授权摘要），与列表行**逐字同形**。 */
  iteration: ProjectIterationListItemSchema,
  requirementId: entityIdSchema,
  /**
   * 切排期时被关掉的那一轮。
   *
   * ⭐ 非空 ⇒ **另一张卡也变了**，渲染层要一起刷。⛔ 别只刷当前这一轮。
   */
  previousIterationId: entityIdSchema.nullable(),
} as const;

/**
 * `project:iteration-requirement-link`：把一条需求排进一轮（服务端 **editor+**）。
 *
 * 两个 `expected*Version` 都必填：一次排期同时依赖「你看到的那一轮」与「你看到的那条
 * 需求」都还是当前那一个。任一不匹配 ⇒ conflict，且服务端**零写入**。
 * ⚠️ 它们是**闸**，不是会被推进的计数——排期不改需求本身、也不改轮次的任何字段，
 *    所以成功之后这两个版本号都**不变**。⛔ 别据此判断「服务端没生效」；
 *    生效的信号是 `link` 与 `iteration.linkedRequirements`，以及
 *    `iteration.requirements_changed` 事件。
 *
 * ⛔ 契约里**没有**「要不要保留历史」这种开关：切排期恒是「关旧 + 新增」，
 *    历史一行不少。
 */
export const ProjectIterationRequirementLinkRequestSchema = z.strictObject({
  projectId: entityIdSchema,
  iterationId: entityIdSchema,
  requirementId: entityIdSchema,
  expectedRequirementVersion: expectedVersionSchema,
  expectedIterationVersion: expectedVersionSchema,
  clientRequestId: clientRequestIdSchema,
});

export const ProjectIterationRequirementLinkResultSchema = z.discriminatedUnion('ok', [
  z.strictObject({ ok: z.literal(true), ...iterationRequirementWriteShape }),
  z.strictObject({
    ok: z.literal(false),
    ...projectPlanningErrorShape,
    currentVersion: expectedVersionSchema.nullable(),
  }),
]);

/**
 * `project:iteration-requirement-unlink`：把这一对的当前关联关成历史（**editor+**）。
 *
 * ⛔ 这**不是删除**：关联行留着（`link.state === 'closed'`、`unlinkedAt` 非空），
 *    带 `includeHistory` 的分页照样读得到它。
 * ⚠️ 若这条需求已经换到别的轮次，对**旧**轮次再移出一次是回放（`changed=false`），
 *    新轮次一个字节都不动。
 */
export const ProjectIterationRequirementUnlinkRequestSchema = z.strictObject({
  projectId: entityIdSchema,
  iterationId: entityIdSchema,
  requirementId: entityIdSchema,
  expectedRequirementVersion: expectedVersionSchema,
  expectedIterationVersion: expectedVersionSchema,
  clientRequestId: clientRequestIdSchema,
});

export const ProjectIterationRequirementUnlinkResultSchema = z.discriminatedUnion('ok', [
  z.strictObject({ ok: z.literal(true), ...iterationRequirementWriteShape }),
  z.strictObject({
    ok: z.literal(false),
    ...projectPlanningErrorShape,
    currentVersion: expectedVersionSchema.nullable(),
  }),
]);

/** 这一条关联是不是**当前排期**（呈现与筛选用；判定收口成一个函数）。 */
export function isProjectIterationRequirementCurrent(
  item: Pick<ProjectIterationRequirement, 'linkState'>,
): boolean {
  return item.linkState === 'active';
}

export type ProjectIterationRequirementLinkState = z.infer<
  typeof ProjectIterationRequirementLinkStateSchema
>;
export type ProjectIterationRequirement = z.infer<typeof ProjectIterationRequirementSchema>;
export type ProjectIterationListItem = z.infer<typeof ProjectIterationListItemSchema>;
export type ProjectIterationRequirementLink = z.infer<typeof ProjectIterationRequirementLinkSchema>;
export type ProjectIterationRequirementListRequest = z.infer<
  typeof ProjectIterationRequirementListRequestSchema
>;
export type ProjectIterationRequirementListResult = z.infer<
  typeof ProjectIterationRequirementListResultSchema
>;
export type ProjectIterationRequirementLinkRequest = z.infer<
  typeof ProjectIterationRequirementLinkRequestSchema
>;
export type ProjectIterationRequirementLinkResult = z.infer<
  typeof ProjectIterationRequirementLinkResultSchema
>;
export type ProjectIterationRequirementUnlinkRequest = z.infer<
  typeof ProjectIterationRequirementUnlinkRequestSchema
>;
export type ProjectIterationRequirementUnlinkResult = z.infer<
  typeof ProjectIterationRequirementUnlinkResultSchema
>;

/* ── 多轮迭代 ───────────────────────────────────────────────────────────── */

/**
 * `project:iteration-list`：轮次列表 + 分组计数。
 *
 * ⭐ `milestoneId` 与 `unlinked` 是**两个不同的问题**：前者问「这个目标下有哪几轮」，
 * 后者问「哪些轮次还没归到任何目标」。用 `milestoneId: null` 表达后者会让「不筛」
 * 与「只要未关联」撞在同一个值上。
 */
export const ProjectIterationListRequestSchema = z.strictObject({
  projectId: entityIdSchema,
  milestoneId: entityIdSchema.optional(),
  unlinked: z.boolean().optional(),
  state: ProjectIterationStatusSchema.optional(),
  ownerSubject: subjectSchema.optional(),
  q: z.string().min(1).max(PROJECT_ITERATION_MAX_NAME_LENGTH).optional(),
  sort: ProjectIterationSortSchema.optional(),
  page: z.number().int().positive().optional(),
  pageSize: z.number().int().positive().max(PROJECT_PLANNING_MAX_PAGE_SIZE).optional(),
  includeArchived: z.boolean().optional(),
});

export const ProjectIterationListResultSchema = z.discriminatedUnion('ok', [
  z.strictObject({
    ok: z.literal(true),
    items: z.array(ProjectIterationListItemSchema),
    ...planningPageShape,
    groupCounts: ProjectIterationGroupCountsSchema,
  }),
  z.strictObject({ ok: z.literal(false), ...projectPlanningErrorShape }),
]);

/**
 * `project:iteration-create`：建轮次（**manager+**，服务端强判）。
 *
 * `milestoneId` 缺席或 `null` ＝「未关联」（旧生产轮次那一档，是有意的产品状态）；
 * 给了就必须是**同项目且未归档**的目标——同项目由服务端复合外键强制，未归档是
 * 跨行状态判断、由服务端写路径挡（客户端这一侧不做等价判断，判不准）。
 */
export const ProjectIterationCreateRequestSchema = z.strictObject({
  projectId: entityIdSchema,
  clientRequestId: clientRequestIdSchema,
  milestoneId: entityIdSchema.nullable().optional(),
  name: authoredName(PROJECT_ITERATION_MAX_NAME_LENGTH),
  criteriaMd: authoredMarkdown(PROJECT_ITERATION_MAX_CRITERIA_LENGTH).optional(),
  ownerSubject: subjectSchema.nullable().optional(),
  priority: ProjectIterationPrioritySchema.optional(),
  dueAt: timestampSchema.nullable().optional(),
});

export const ProjectIterationCreateResultSchema = z.discriminatedUnion('ok', [
  z.strictObject({ ok: z.literal(true), iteration: ProjectIterationListItemSchema }),
  z.strictObject({ ok: z.literal(false), ...projectPlanningErrorShape }),
]);

/**
 * `project:iteration-update`：改轮次。
 *
 * 轮次 PATCH 只有 **manager+** 一档（排期归管理者和拥有者，D-MODEL-01 §四）：可改下列
 * 全部字段及 `archived` 与改派；editor / viewer（含正是本轮负责人的 editor）一律 403
 * `forbidden`。客户端这一侧只负责不摆一个点了必错的入口（`canManagePlanning`），
 * ⛔ 真正的门在服务端。
 *
 * ⛔ **刻意没有 `milestoneId`**：首期不支持跨目标移动。服务端库层故意没封这条路
 *    （「未关联」旧轮次的回填要用它），所以拒绝只发生在路由层——客户端契约里连这个
 *    字段都不表达，是同一条纪律在这一层的载体。
 * ⛔ 也没有 `status`：轮次的达成与重开要留证，属另一条线的专用动作。
 */
export const ProjectIterationUpdateRequestSchema = z
  .strictObject({
    projectId: entityIdSchema,
    iterationId: entityIdSchema,
    expectedVersion: expectedVersionSchema,
    clientRequestId: clientRequestIdSchema,
    name: authoredName(PROJECT_ITERATION_MAX_NAME_LENGTH).optional(),
    criteriaMd: authoredMarkdown(PROJECT_ITERATION_MAX_CRITERIA_LENGTH).optional(),
    ownerSubject: subjectSchema.nullable().optional(),
    priority: ProjectIterationPrioritySchema.optional(),
    dueAt: timestampSchema.nullable().optional(),
    archived: z.boolean().optional(),
  })
  .refine(
    (request) =>
      request.name !== undefined ||
      request.criteriaMd !== undefined ||
      request.ownerSubject !== undefined ||
      request.priority !== undefined ||
      request.dueAt !== undefined ||
      request.archived !== undefined,
    { message: 'at least one field to update' },
  );

export const ProjectIterationUpdateResultSchema = z.discriminatedUnion('ok', [
  z.strictObject({ ok: z.literal(true), iteration: ProjectIterationListItemSchema }),
  z.strictObject({
    ok: z.literal(false),
    ...projectPlanningErrorShape,
    currentVersion: expectedVersionSchema.nullable(),
  }),
]);

/**
 * 轮次新建 / PATCH 的**服务端业务码** → 报错条文案（就地覆盖通用文案）。与
 * `projectPlanningLifecycleServerCodeText` 同一条纪律：文案收口在共享层，⛔ 业务码不露给用户；
 * 认不出的码与缺席一律 `null`，调用方退回按 `code` 取的通用句。
 *
 * ⭐ `milestone_archived`：业务目标归档即整条只读（D-MODEL-01 §九）。它和版本冲突一样是 409，
 *    但它是**终态说明**——调用方先查本表，⛔ 别把它当成版本冲突去刷新重试。
 * ⭐ `schedule_out_of_period` / `owner_not_member`（MIL-10，ADR-0040 起服务端强制）：文案与迭代计划表单
 *    `iterationFormProblem` 的对应两句逐字相同（渲染层用例并排钉住）。
 */
export function projectIterationUpdateServerCodeText(
  serverCode: string | null | undefined,
): string | null {
  switch (serverCode) {
    case 'milestone_archived':
      return '所属业务目标已归档，请先恢复业务目标再修改。';
    case 'schedule_out_of_period':
      return '节点日期应在里程碑周期内，请调整日期或先修改里程碑。';
    case 'owner_not_member':
      return '负责人已不在项目中。';
    default:
      return null;
  }
}

/**
 * 业务目标新建 / 修改的**服务端业务码** → 报错条文案（MIL-09 起；MIL-10 补齐）。同上一条纪律：
 * ⛔ 业务码不露给用户，认不出的码一律 `null`。
 * ⭐ 与里程碑表单 `milestoneFormProblem` 的五句**一一对应**（ADR-0040，渲染层用例逐条钉住）：
 *    必填 / 日期顺序 / 同名 / 周期覆盖已有迭代 / 负责人在册，各对应一个服务端码、文案逐字相同。
 *    ⚠️ 服务端的「必填」只判名称去首尾空白后非空（线协议里目标说明与起止日期本来就可空 / 可清），
 *       目标说明与日期的必填仍只在界面判。
 * ⭐ `start_requires_due`（CORE-08，ADR-0042）：写入之后有开始没截止。表单照原型要求填起止，本地先被
 *    「必填」那句挡住，这一句只在服务端拒绝（例如存量只有开始的目标被改了开始）时出现。
 */
export function projectMilestoneWriteServerCodeText(
  serverCode: string | null | undefined,
): string | null {
  switch (serverCode) {
    case 'milestone_name_required':
      return '请填写里程碑名称、目标和起止日期。';
    case 'start_requires_due':
      return '填写开始日期后请同时填写结束日期。';
    case 'invalid_date_range':
      return '结束日期不能早于开始日期。';
    case 'milestone_name_taken':
      return '已有同名业务目标，请使用其他名称。';
    case 'milestone_period_excludes_iterations':
      return '计划周期需覆盖已有迭代计划日期，请先调整节点。';
    case 'owner_not_member':
      return '所选负责人已不在项目中。';
    default:
      return null;
  }
}

export type ProjectMilestoneIterationSummary = z.infer<
  typeof ProjectMilestoneIterationSummarySchema
>;
export type ProjectMilestoneListItem = z.infer<typeof ProjectMilestoneListItemSchema>;
export type ProjectIterationGroupCounts = z.infer<typeof ProjectIterationGroupCountsSchema>;
export type ProjectIterationSort = z.infer<typeof ProjectIterationSortSchema>;
export type ProjectMilestoneListRequest = z.infer<typeof ProjectMilestoneListRequestSchema>;
export type ProjectMilestoneListResult = z.infer<typeof ProjectMilestoneListResultSchema>;
export type ProjectMilestoneCreateRequest = z.infer<typeof ProjectMilestoneCreateRequestSchema>;
export type ProjectMilestoneCreateResult = z.infer<typeof ProjectMilestoneCreateResultSchema>;
export type ProjectMilestoneUpdateRequest = z.infer<typeof ProjectMilestoneUpdateRequestSchema>;
export type ProjectMilestoneUpdateResult = z.infer<typeof ProjectMilestoneUpdateResultSchema>;
export type ProjectIterationListRequest = z.infer<typeof ProjectIterationListRequestSchema>;
export type ProjectIterationListResult = z.infer<typeof ProjectIterationListResultSchema>;
export type ProjectIterationCreateRequest = z.infer<typeof ProjectIterationCreateRequestSchema>;
export type ProjectIterationCreateResult = z.infer<typeof ProjectIterationCreateResultSchema>;
export type ProjectIterationUpdateRequest = z.infer<typeof ProjectIterationUpdateRequestSchema>;
export type ProjectIterationUpdateResult = z.infer<typeof ProjectIterationUpdateResultSchema>;
