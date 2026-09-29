import { z } from 'zod';

/**
 * 项目组**外部数据源**（`project:data-source-*`）的两端契约。
 *
 * 与 `project-collab.ts` 分文件而不是续在它后面，有两条实打实的理由：
 *  ① 失败码是**另一套**——外部数据源要把「白名单未开」「仓库里没有任务目录」
 *     「票据被外部仓库拒了」这些**分得开的原因**如实说给用户听；协作面那套
 *     十一档（rejected/transient 两个大筐）在这里会把它们全塌缩掉。
 *  ② 参考编号另起一族（`STRX-DSRC-0xx`）：编号标的是「哪一类失败」，两族各自
 *     连续续号，不与协作面抢号段。
 *
 * ⚠️ 三条红线，由本文件的 schema **结构性**承载：
 *
 *  1. 【账号】请求契约里没有账号字段（同协作面）。账号由 Main 从会话态推导。
 *
 *  2. 【授权票据】`ProjectDataSourceSyncRequestSchema` 里**没有票据字段**——
 *     渲染层触发同步时递交的只是「同步哪个数据源」这个意图，票据由主进程从
 *     本机 safeStorage 取。票据**只有一条**上行路径：用户亲手在授权表单里敲进去
 *     的那一次（`ProjectDataSourceTicketSaveRequestSchema`），存进本机加密库后
 *     再不回传——出参里结构性没有票据字段，`ticketedDataSourceIds` 只答
 *     「哪几个存过票据」这个布尔量。
 *
 *  3. 【白标】标识符、注释与用户可见文案一律中性词。
 */

/* ------------------------------ 上界与闭集 ------------------------------ */

/**
 * 实例地址长度界，与服务端 `models.py` 的 `MAX_ENDPOINT_CHARS`／
 * `Field(min_length=8)` 逐字同界。客户端拒绝的服务端必拒，反向不成立。
 */
export const PROJECT_DATA_SOURCE_BASE_URL_MIN_LENGTH = 8;
export const PROJECT_DATA_SOURCE_BASE_URL_MAX_LENGTH = 512;
/** 仓库标识（group/subgroup/repo 或数字项目 id）长度界。 */
export const PROJECT_DATA_SOURCE_REPO_PATH_MAX_LENGTH = 512;
/** 分支/标签长度界；null ＝ 用仓库默认分支。 */
export const PROJECT_DATA_SOURCE_GIT_REF_MAX_LENGTH = 256;
/** 授权票据长度界（服务端 `MAX_EXTERNAL_TOKEN_CHARS`）。 */
export const PROJECT_DATA_SOURCE_TICKET_MAX_LENGTH = 4_096;
/** 上次同步摘要长度界（服务端 DDL `length(last_sync_detail) <= 2000`）。 */
export const PROJECT_DATA_SOURCE_SYNC_DETAIL_MAX_LENGTH = 2_000;
/** 单项目数据源条数的防御性上界（服务端无分页）。 */
export const PROJECT_DATA_SOURCE_MAX_ENTRIES = 50;
/** 对账行一次返回的防御性上界（服务端无分页，防无界读取）。 */
export const PROJECT_EXTERNAL_LINK_MAX_ENTRIES = 2_000;
/** 单次同步回执里最多带几条诊断——服务端就是 `diagnostics[:50]`，同界。 */
export const PROJECT_DATA_SOURCE_MAX_DIAGNOSTICS = 50;
/** 单条诊断的字符上界（服务端逐条拼的是一句人话，不是一篇日志）。 */
export const PROJECT_DATA_SOURCE_DIAGNOSTIC_MAX_LENGTH = 1_000;

const projectIdSchema = z.string().uuid();
const dataSourceIdSchema = z.string().uuid();
const entityIdSchema = z.string().uuid();
const subjectSchema = z.string().min(1).max(256);
const timestampSchema = z.string().max(64);

/**
 * 数据源类型闭集。**只有 GitLab**（方案 §6 定案）；留成闭集而不是写死，是因为
 * 「只做一种」是产品定案而不是结构限制。
 */
export const ProjectDataSourceKindSchema = z.enum(['gitlab']);

/**
 * 票据的携带方式。线格式是 snake（`private_token` / `bearer`），客户端投影用
 * camel——映射表在 `collabDataSourceWireMapping.ts`，两端各自穷尽。
 */
export const ProjectDataSourceTicketSchemeSchema = z.enum(['privateToken', 'bearer']);

/** 上次同步结果。null（字段缺席）＝ 从没跑过——与「跑了但失败」是两件事。 */
export const ProjectDataSourceSyncStatusSchema = z.enum(['ok', 'failed']);

/**
 * 对账行的外部条目类别。线格式 `todo_item` 投影为 `todoItem`，其余同名。
 */
export const ProjectExternalLinkKindSchema = z.enum(['task', 'subtask', 'todoItem', 'document']);

/**
 * 对账行状态。`orphaned` ＝ 外部侧已经看不见它了——⚠️ 本地条目**不删**，
 * 只标记来源失效，所以界面必须有地方把这一档显示出来。
 */
export const ProjectExternalLinkStateSchema = z.enum(['active', 'orphaned']);

/* ------------------------------- 投影 ------------------------------- */

/**
 * 数据源投影。
 *
 * ⛔ **没有票据字段，因为它压根不存在**：服务端迁移 0008 建的表里没有任何凭据列，
 * 数据源存的是「去哪儿取」（地址 / 仓库 / 分支），不存「凭什么取」。
 */
export const ProjectDataSourceSchema = z.strictObject({
  id: dataSourceIdSchema,
  kind: ProjectDataSourceKindSchema,
  baseUrl: z
    .string()
    .min(PROJECT_DATA_SOURCE_BASE_URL_MIN_LENGTH)
    .max(PROJECT_DATA_SOURCE_BASE_URL_MAX_LENGTH),
  repoPath: z.string().min(1).max(PROJECT_DATA_SOURCE_REPO_PATH_MAX_LENGTH),
  /** null ＝ 仓库默认分支（服务端 ref 缺省语义），出参原样保留 null。 */
  gitRef: z.string().min(1).max(PROJECT_DATA_SOURCE_GIT_REF_MAX_LENGTH).nullable(),
  enabled: z.boolean(),
  includeDocuments: z.boolean(),
  /**
   * 过程件导入开关：服务端是**预留位且被 DB CHECK 钉死在 false**。出参带着它，
   * 是为了让界面能如实说「这个开关存在但关着」，而不是让人以为我们悄悄导了。
   */
  includeProcessDocs: z.boolean(),
  lastSyncedAt: timestampSchema.nullable(),
  lastSyncStatus: ProjectDataSourceSyncStatusSchema.nullable(),
  /** 上次同步的可读摘要（导了多少 / 跳了多少 / 为什么跳）。 */
  lastSyncDetail: z.string().max(PROJECT_DATA_SOURCE_SYNC_DETAIL_MAX_LENGTH).nullable(),
  createdBySubject: subjectSchema,
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
});

/**
 * 对账行投影（只读面）。
 *
 * ⚠️ 刻意**不投影** `external_meta`：它装的是外部侧原始 owner/assignee/status/
 * priority，键随条目类别而变、值是开放 JSON。把一坨开放结构塞进 strictObject 只能
 * 靠 passthrough，那等于在契约上开个洞。界面要的是「哪条来源失效了」，那由
 * `linkState` 答；真要人工对应身份时，服务端已经把原值写进了条目描述里的备注行。
 */
export const ProjectExternalLinkSchema = z.strictObject({
  id: entityIdSchema,
  dataSourceId: dataSourceIdSchema,
  externalKind: ProjectExternalLinkKindSchema,
  externalKey: z.string().min(1).max(512),
  /** 本地载体二选一：待办或文件资产，恰好一个非空（服务端 CHECK 保证）。 */
  todoId: entityIdSchema.nullable(),
  fileId: entityIdSchema.nullable(),
  linkState: ProjectExternalLinkStateSchema,
  orphanedAt: timestampSchema.nullable(),
  externalUpdatedAt: timestampSchema.nullable(),
  updatedAt: timestampSchema,
});

/**
 * 一次同步的回执。
 *
 * `diagnostics` 是**必须显示出来**的那一段：服务端把超限跳过的文档逐条写成
 * 「哪一份、多大、上限多少」放在这里。静默丢掉它＝让用户以为全导进来了。
 * `diagnosticsTotal` 大于数组长度时说明还有没列出来的，界面要如实说有多少条。
 */
export const ProjectDataSourceSyncSummarySchema = z.strictObject({
  todosCreated: z.number().int().nonnegative(),
  todosUpdated: z.number().int().nonnegative(),
  todosUnchanged: z.number().int().nonnegative(),
  documentsCreated: z.number().int().nonnegative(),
  documentsUpdated: z.number().int().nonnegative(),
  documentsUnchanged: z.number().int().nonnegative(),
  /** 本轮之后在外部侧消失的条目数——本地数据保留，只标记来源失效。 */
  orphaned: z.number().int().nonnegative(),
  detail: z.string().max(PROJECT_DATA_SOURCE_SYNC_DETAIL_MAX_LENGTH),
  diagnostics: z
    .array(z.string().max(PROJECT_DATA_SOURCE_DIAGNOSTIC_MAX_LENGTH))
    .max(PROJECT_DATA_SOURCE_MAX_DIAGNOSTICS),
  diagnosticsTotal: z.number().int().nonnegative(),
});

/* ------------------------------ 失败分档 ------------------------------ */

/**
 * 公开失败码。**逐条对着服务端的稳定错误码取**（`routes_datasources.py` /
 * `domain.py` / `gitlab_files.py` / `repository_datasources.py`），不是按状态码猜的：
 * 400 上就挂着「地址不在名单内」「地址内嵌了凭据」「票据被拒」三种完全不同的处置，
 * 塌缩成一句「请求被拒绝」等于把用户该做的下一步抹掉。
 *
 *  - `unavailable`             项目组能力未装配。
 *  - `authRequired`            工作台未登录。
 *  - `invalidRequest`          本地入参非法 / 服务端 422 validation_error。
 *  - `forbidden`               403：非拥有者、已被移出项目、或项目已归档。
 *  - `rateLimited`             429。
 *  - `credentialRejected`      401：工作台登录态失效（**不是**外部仓库票据）。
 *  - `notFound`                404 data_source_not_found。
 *  - `alreadyExists`           409 data_source_exists：同一仓库同一分支已接入。
 *  - `sourceDisabled`          409 data_source_disabled：该数据源被停用了。
 *  - `noChanges`               400 no_changes：一个字段都没改。
 *  - `externalSourcesDisabled` 503 external_sources_disabled：**本部署没开外部数据源**。
 *                              这不是故障，是 fail-closed 的设计（白名单缺省为空）。
 *  - `endpointNotAllowed`      400 endpoint_not_allowed：地址不在本部署的实例名单内。
 *  - `invalidEndpoint`         400 invalid_endpoint：地址形状不对。
 *  - `credentialInEndpoint`    400 credential_in_endpoint：地址里内嵌了账号或令牌。
 *  - `documentsUnavailable`    503 files_unavailable：本部署没配文件存储，导不了文档。
 *  - `ticketMissing`           本地判定：这个数据源还没存过授权票据。
 *  - `ticketRejected`          400 external_credential_rejected：外部仓库拒了这枚票据。
 *  - `repositoryNotFound`      422 external_repo_not_found：仓库不存在或票据看不到它。
 *  - `taskDirectoryMissing`    422 trellis_directory_missing：目标分支上没有任务目录。
 *  - `externalRejected`        400 external_rejected：外部仓库拒了本次请求。
 *  - `externalBudgetExhausted` 400 external_budget_exhausted：单次同步的外部请求数超限。
 *  - `externalUnavailable`     502 external_unavailable：外部仓库暂时不可达。
 *  - `tooLarge`                413 file_too_large。
 *  - `ticketStoreUnavailable`  本地判定：本机凭据加密不可用 / 票据存取失败。
 *  - `rejected`                其余 4xx。
 *  - `transient`               ≥500 / 网络不可达 / 超时 / 响应不可信。
 */
export const ProjectDataSourceErrorCodeSchema = z.enum([
  'unavailable',
  'authRequired',
  'invalidRequest',
  'forbidden',
  'rateLimited',
  'credentialRejected',
  'notFound',
  'alreadyExists',
  'sourceDisabled',
  'noChanges',
  'externalSourcesDisabled',
  'endpointNotAllowed',
  'invalidEndpoint',
  'credentialInEndpoint',
  'documentsUnavailable',
  'ticketMissing',
  'ticketRejected',
  'repositoryNotFound',
  'taskDirectoryMissing',
  'externalRejected',
  'externalBudgetExhausted',
  'externalUnavailable',
  'tooLarge',
  'ticketStoreUnavailable',
  'rejected',
  'transient',
]);

export type ProjectDataSourceErrorCode = z.infer<typeof ProjectDataSourceErrorCodeSchema>;

/**
 * 失败码 → 参考编号（`STRX-DSRC-0xx`）。**唯一登记处**：签发方（Main 的
 * `dataSourceFailureBody`）与展示方（渲染层报错条）都从这里取。
 *
 * ⛔ 已发出的号不得改写含义、不得回收复用；新增失败码在末尾续号。
 */
export const PROJECT_DATA_SOURCE_REFERENCE_CODES = {
  unavailable: 'STRX-DSRC-001',
  authRequired: 'STRX-DSRC-002',
  invalidRequest: 'STRX-DSRC-003',
  forbidden: 'STRX-DSRC-004',
  rateLimited: 'STRX-DSRC-005',
  credentialRejected: 'STRX-DSRC-006',
  notFound: 'STRX-DSRC-007',
  alreadyExists: 'STRX-DSRC-008',
  sourceDisabled: 'STRX-DSRC-009',
  noChanges: 'STRX-DSRC-010',
  externalSourcesDisabled: 'STRX-DSRC-011',
  endpointNotAllowed: 'STRX-DSRC-012',
  invalidEndpoint: 'STRX-DSRC-013',
  credentialInEndpoint: 'STRX-DSRC-014',
  documentsUnavailable: 'STRX-DSRC-015',
  ticketMissing: 'STRX-DSRC-016',
  ticketRejected: 'STRX-DSRC-017',
  repositoryNotFound: 'STRX-DSRC-018',
  taskDirectoryMissing: 'STRX-DSRC-019',
  externalRejected: 'STRX-DSRC-020',
  externalBudgetExhausted: 'STRX-DSRC-021',
  externalUnavailable: 'STRX-DSRC-022',
  tooLarge: 'STRX-DSRC-023',
  ticketStoreUnavailable: 'STRX-DSRC-024',
  rejected: 'STRX-DSRC-025',
  transient: 'STRX-DSRC-026',
} as const satisfies Record<ProjectDataSourceErrorCode, string>;

export const ProjectDataSourceReferenceCodeSchema = z.string().regex(/^STRX-DSRC-\d{3}$/u);

const dataSourceErrorShape = {
  code: ProjectDataSourceErrorCodeSchema,
  message: z.string().max(2_048),
  referenceCode: ProjectDataSourceReferenceCodeSchema,
} as const;

/* --------------------------- 各通道 Request/Result --------------------------- */

/** `project:data-source-list`：列出本项目已配数据源（**成员即可读**）。 */
export const ProjectDataSourceListRequestSchema = z.strictObject({
  projectId: projectIdSchema,
});

export const ProjectDataSourceListResultSchema = z.discriminatedUnion('ok', [
  z.strictObject({
    ok: z.literal(true),
    dataSources: z.array(ProjectDataSourceSchema).max(PROJECT_DATA_SOURCE_MAX_ENTRIES),
    /**
     * 本机、本账号已存过授权票据的数据源 id。
     * ⛔ 只答「存没存过」，**不回传票据本身**——契约里没有承载它的字段。
     */
    ticketedDataSourceIds: z.array(dataSourceIdSchema).max(PROJECT_DATA_SOURCE_MAX_ENTRIES),
  }),
  z.strictObject({ ok: z.literal(false), ...dataSourceErrorShape }),
]);

/** `project:data-source-create`：接一个数据源（owner-only，服务端强判）。 */
export const ProjectDataSourceCreateRequestSchema = z.strictObject({
  projectId: projectIdSchema,
  baseUrl: z
    .string()
    .min(PROJECT_DATA_SOURCE_BASE_URL_MIN_LENGTH)
    .max(PROJECT_DATA_SOURCE_BASE_URL_MAX_LENGTH),
  repoPath: z.string().min(1).max(PROJECT_DATA_SOURCE_REPO_PATH_MAX_LENGTH),
  /** 缺席或 null ＝ 用仓库默认分支。 */
  gitRef: z.string().min(1).max(PROJECT_DATA_SOURCE_GIT_REF_MAX_LENGTH).nullable().optional(),
  enabled: z.boolean().optional(),
  includeDocuments: z.boolean().optional(),
});

export const ProjectDataSourceCreateResultSchema = z.discriminatedUnion('ok', [
  z.strictObject({ ok: z.literal(true), dataSource: ProjectDataSourceSchema }),
  z.strictObject({ ok: z.literal(false), ...dataSourceErrorShape }),
]);

/**
 * `project:data-source-update`：改数据源（owner-only）。
 *
 * `gitRef` 显式 `null` ＝ 改回默认分支；**缺席 ＝ 不动**——这条语义与服务端
 * `DataSourcePatchModel.changed_fields()` 的 `model_fields_set` 判据是同一件事，
 * 所以主进程组请求体时必须按「键在不在」而不是「值是不是 undefined」来判。
 */
export const ProjectDataSourceUpdateRequestSchema = z
  .strictObject({
    projectId: projectIdSchema,
    dataSourceId: dataSourceIdSchema,
    baseUrl: z
      .string()
      .min(PROJECT_DATA_SOURCE_BASE_URL_MIN_LENGTH)
      .max(PROJECT_DATA_SOURCE_BASE_URL_MAX_LENGTH)
      .optional(),
    repoPath: z.string().min(1).max(PROJECT_DATA_SOURCE_REPO_PATH_MAX_LENGTH).optional(),
    gitRef: z.string().min(1).max(PROJECT_DATA_SOURCE_GIT_REF_MAX_LENGTH).nullable().optional(),
    enabled: z.boolean().optional(),
    includeDocuments: z.boolean().optional(),
  })
  // 一个字段都不给的 PATCH 服务端会回 400 no_changes；在边界就拒掉，少一次空跑。
  .refine(
    (value) =>
      value.baseUrl !== undefined ||
      value.repoPath !== undefined ||
      'gitRef' in value ||
      value.enabled !== undefined ||
      value.includeDocuments !== undefined,
    { message: 'at least one field is required' },
  );

export const ProjectDataSourceUpdateResultSchema = z.discriminatedUnion('ok', [
  z.strictObject({ ok: z.literal(true), dataSource: ProjectDataSourceSchema }),
  z.strictObject({ ok: z.literal(false), ...dataSourceErrorShape }),
]);

/**
 * `project:data-source-delete`：断开来源（owner-only）。
 * ⚠️ **不删已导入的需求、任务与文档**——那些是用户看得见的数据。
 */
export const ProjectDataSourceDeleteRequestSchema = z.strictObject({
  projectId: projectIdSchema,
  dataSourceId: dataSourceIdSchema,
});

export const ProjectDataSourceDeleteResultSchema = z.discriminatedUnion('ok', [
  z.strictObject({ ok: z.literal(true), dataSourceId: dataSourceIdSchema }),
  z.strictObject({ ok: z.literal(false), ...dataSourceErrorShape }),
]);

/**
 * `project:data-source-sync`：拉一次（owner-only，只读导入不写回）。
 *
 * ⛔ **结构性没有票据字段**：渲染层表达的是「同步哪一个」，票据由主进程从本机
 * 加密库取出后只拼进这一次外发请求。渲染层递不进票据，也就无从把它送到别处去。
 */
export const ProjectDataSourceSyncRequestSchema = z.strictObject({
  projectId: projectIdSchema,
  dataSourceId: dataSourceIdSchema,
});

export const ProjectDataSourceSyncResultSchema = z.discriminatedUnion('ok', [
  z.strictObject({
    ok: z.literal(true),
    dataSourceId: dataSourceIdSchema,
    summary: ProjectDataSourceSyncSummarySchema,
  }),
  z.strictObject({ ok: z.literal(false), ...dataSourceErrorShape }),
]);

/** `project:external-link-list`：对账行只读面（成员即可读）。 */
export const ProjectExternalLinkListRequestSchema = z.strictObject({
  projectId: projectIdSchema,
  /** 缺席 ＝ 全项目；给了就只看这一个数据源的对账行。 */
  dataSourceId: dataSourceIdSchema.optional(),
});

export const ProjectExternalLinkListResultSchema = z.discriminatedUnion('ok', [
  z.strictObject({
    ok: z.literal(true),
    links: z.array(ProjectExternalLinkSchema).max(PROJECT_EXTERNAL_LINK_MAX_ENTRIES),
  }),
  z.strictObject({ ok: z.literal(false), ...dataSourceErrorShape }),
]);

/**
 * `project:data-source-ticket-save`：把**本人的**外部访问票据存进本机加密库。
 *
 * 这是票据**唯一**的上行路径（用户亲手敲的那一次）。存完即止：结果里没有票据
 * 字段，后续任何读路径也回不出它——主进程只在组同步请求时把它取出来用一次。
 */
export const ProjectDataSourceTicketSaveRequestSchema = z.strictObject({
  projectId: projectIdSchema,
  dataSourceId: dataSourceIdSchema,
  ticket: z.string().min(1).max(PROJECT_DATA_SOURCE_TICKET_MAX_LENGTH),
  scheme: ProjectDataSourceTicketSchemeSchema,
});

/** `project:data-source-ticket-clear`：撤掉本机保存的票据。 */
export const ProjectDataSourceTicketClearRequestSchema = z.strictObject({
  projectId: projectIdSchema,
  dataSourceId: dataSourceIdSchema,
});

/** 票据存/撤的结果：只答「现在还存不存着」，⛔ 不回显票据。 */
export const ProjectDataSourceTicketResultSchema = z.discriminatedUnion('ok', [
  z.strictObject({
    ok: z.literal(true),
    dataSourceId: dataSourceIdSchema,
    ticketed: z.boolean(),
  }),
  z.strictObject({ ok: z.literal(false), ...dataSourceErrorShape }),
]);

/* --------------------------------- 类型 --------------------------------- */

export type ProjectDataSourceKind = z.infer<typeof ProjectDataSourceKindSchema>;
export type ProjectDataSourceTicketScheme = z.infer<typeof ProjectDataSourceTicketSchemeSchema>;
export type ProjectDataSourceSyncStatus = z.infer<typeof ProjectDataSourceSyncStatusSchema>;
export type ProjectExternalLinkKind = z.infer<typeof ProjectExternalLinkKindSchema>;
export type ProjectExternalLinkState = z.infer<typeof ProjectExternalLinkStateSchema>;
export type ProjectDataSource = z.infer<typeof ProjectDataSourceSchema>;
export type ProjectExternalLink = z.infer<typeof ProjectExternalLinkSchema>;
export type ProjectDataSourceSyncSummary = z.infer<typeof ProjectDataSourceSyncSummarySchema>;

export type ProjectDataSourceListRequest = z.infer<typeof ProjectDataSourceListRequestSchema>;
export type ProjectDataSourceListResult = z.infer<typeof ProjectDataSourceListResultSchema>;
export type ProjectDataSourceCreateRequest = z.infer<typeof ProjectDataSourceCreateRequestSchema>;
export type ProjectDataSourceCreateResult = z.infer<typeof ProjectDataSourceCreateResultSchema>;
export type ProjectDataSourceUpdateRequest = z.infer<typeof ProjectDataSourceUpdateRequestSchema>;
export type ProjectDataSourceUpdateResult = z.infer<typeof ProjectDataSourceUpdateResultSchema>;
export type ProjectDataSourceDeleteRequest = z.infer<typeof ProjectDataSourceDeleteRequestSchema>;
export type ProjectDataSourceDeleteResult = z.infer<typeof ProjectDataSourceDeleteResultSchema>;
export type ProjectDataSourceSyncRequest = z.infer<typeof ProjectDataSourceSyncRequestSchema>;
export type ProjectDataSourceSyncResult = z.infer<typeof ProjectDataSourceSyncResultSchema>;
export type ProjectExternalLinkListRequest = z.infer<typeof ProjectExternalLinkListRequestSchema>;
export type ProjectExternalLinkListResult = z.infer<typeof ProjectExternalLinkListResultSchema>;
export type ProjectDataSourceTicketSaveRequest = z.infer<
  typeof ProjectDataSourceTicketSaveRequestSchema
>;
export type ProjectDataSourceTicketClearRequest = z.infer<
  typeof ProjectDataSourceTicketClearRequestSchema
>;
export type ProjectDataSourceTicketResult = z.infer<typeof ProjectDataSourceTicketResultSchema>;
