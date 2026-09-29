import { basename, join } from 'node:path';
import type { ReadStream } from 'node:fs';
import { mkdir, open, rm } from 'node:fs/promises';
import { Readable } from 'node:stream';
import type {
  ProjectTodoCollaboratorsRequest,
  ProjectTodoCollaboratorsReplaceRequest,
  ProjectTodoCommentsRequest,
  ProjectTodoCommentCreateRequest,
  ProjectTodoDeletePreviewRequest,
} from '../../../shared/protocol/project-todo-collaboration.js';
import { CollabTodoCollaborationClient } from './collabTodoCollaborationClient.js';
import type {
  ProjectWorkOverview,
  ProjectWorkOverviewRequest,
} from '../../../shared/protocol/project-work-overview.js';
import { CollabWorkOverviewClient } from './collabWorkOverviewClient.js';

import {
  PROJECT_FILE_MAX_BYTES,
  ProjectChatHistoryRequestSchema,
  ProjectChatSearchDataSchema,
  type ChatMessage,
  type FeedComment,
  type FeedEntry,
  type ProjectChatHistoryRequest,
  type ProjectChatSearchData,
  type ProjectAssignableRole,
  type ProjectChatSendRequest,
  type ProjectCollabErrorCode,
  type ProjectCommentPostRequest,
  type ProjectConventions,
  type ProjectDetail,
  type ProjectFeedPostRequest,
  type ProjectFile,
  type ProjectFileKind,
  type ProjectFileQuota,
  type ProjectInvitationKind,
  type ProjectInvitationRole,
  type ProjectOpenInvitation,
  type ProjectOpenInvitationTtlHours,
  type ProjectRole,
  type ProjectSummary,
  type ProjectRequirementPageRequest,
  type ProjectTodoAcceptanceSetRequest,
  type ProjectTodoCreateRequest,
  type ProjectTodoDetailRequest,
  type ProjectTodoDraftCreateRequest,
  type ProjectTodoDraftDropRequest,
  type ProjectTodoDraftListRequest,
  type ProjectTodoDraftResolveRequest,
  type ProjectRequirementClaimRequest,
  type ProjectTodoReviewRequest,
  type ProjectTodoSubmitReviewRequest,
  type ProjectTodoUpdateRequest,
  type Todo,
  type TodoAcceptanceItem,
  type TodoCompletionRecord,
  type TodoDraftBatch,
  type TodoSource,
  type TodoVisibility,
} from '../../../shared/protocol/project-collab.js';
import type {
  ProjectAssetCatalogueEntry,
  ProjectAssetVersionChain,
  ProjectAssetVersionResolution,
} from '../../../shared/protocol/project-collab-assets.js';
import {
  ProjectTestModeSchema,
  SERVICE_CAPABILITY,
  dictionaryWriteRequiresUpgrade,
  hasCapability,
  type ProjectTestMode,
  type ServiceCapabilities,
} from '../../../shared/protocol/project-collab-capabilities.js';
import { mapTestRound } from './collabTestingWireMapping.js';
import {
  assetVersionConflictWireSchema,
  conflictWireSchema,
  invitationWireSchema,
  mapAcceptanceItem,
  mapArray,
  mapChatMessage,
  mapCompletionRecord,
  mapDraftBatch,
  mapFeedComment,
  mapFeedEntry,
  mapOpenInvitation,
  mapProjectAssetCatalogueEntry,
  mapProjectAssetVersionChain,
  mapProjectAssetVersionResolution,
  mapProjectConventions,
  mapProjectDetail,
  mapProjectFile,
  mapProjectSummary,
  mapTodo,
  quotaWireSchema,
  readServerErrorCode,
  recordOf,
  redeemWireSchema,
  revokeInvitationWireSchema,
  todoDeleteWireSchema,
} from './collabWireMapping.js';
import { projectDocumentMimeType } from '../localDocumentParser.js';
import { CollabSubmissionGateClient } from './collabSubmissionGateClient.js';
import type {
  ProjectSubmissionGate,
  ProjectSubmissionGateRequest,
  ProjectSubmissionGateUpdateRequest,
} from '../../../shared/protocol/project-submission-gate.js';

/** 单条工作单的完整投影（本体 + 逐条判据 + 完成记录时间线）。 */
export interface TodoPage {
  readonly todos: readonly Todo[];
  readonly hasMore: boolean;
  readonly nextCursor: string | null;
}

/** 需求页码查询的投影（CORE-07）：本页需求 + 总数 + 页码事实 + 业务修订号。 */
export interface RequirementPageView {
  readonly items: readonly Todo[];
  readonly total: number;
  readonly page: number;
  readonly pageSize: 5 | 10 | 20;
  readonly queryRevision: string;
}

export interface TodoDetailView {
  readonly todo: Todo;
  readonly acceptanceItems: readonly TodoAcceptanceItem[];
  readonly completionRecords: readonly TodoCompletionRecord[];
}

/** 验收清单替换后的投影。 */
export interface AcceptanceSetView {
  readonly todo: Todo;
  readonly acceptanceItems: readonly TodoAcceptanceItem[];
}

/** 提交验收 / 验收打回的共同投影（通过时 completionRecord 为 null）。 */
export interface TodoReviewView {
  readonly todo: Todo;
  readonly completionRecord: TodoCompletionRecord | null;
}

/** 整批确认 / 丢弃后的投影（丢弃时 todos 为空数组）。 */
export interface DraftResolveView {
  readonly batch: TodoDraftBatch;
  readonly todos: readonly Todo[];
}

/** 删除后的投影：整棵子树被删的 id 全集与条数（单条与批量同形）。 */
export interface TodoDeleteView {
  readonly deletedIds: readonly string[];
  readonly count: number;
}

/** 删除响应体 `{deleted_ids, count}` → camelCase 投影；形状不过即 null（上层归 transient）。 */
function mapTodoDelete(body: unknown): TodoDeleteView | null {
  const wire = todoDeleteWireSchema.safeParse(body);
  return wire.success ? { deletedIds: wire.data.deleted_ids, count: wire.data.count } : null;
}

function mapTodoDetail(body: unknown): TodoDetailView | null {
  const record = recordOf(body);
  const todo = mapTodo(record?.todo);
  const acceptanceItems = mapArray(record?.acceptance_items, mapAcceptanceItem);
  const completionRecords = mapArray(record?.completion_records, mapCompletionRecord);
  if (!todo || !acceptanceItems || !completionRecords) return null;
  return { todo, acceptanceItems, completionRecords };
}

function mapTodoReview(body: unknown): TodoReviewView | null {
  const record = recordOf(body);
  const todo = mapTodo(record?.todo);
  if (!todo) return null;
  // 验收通过不写完成记录（写的是验收动作本身），服务端回 null——那是正常出参，
  // 不是不可信响应。⚠️ 只有「非 null 但映射不出来」才当不可信。
  const raw = record?.completion_record ?? null;
  if (raw === null) return { todo, completionRecord: null };
  const completionRecord = mapCompletionRecord(raw);
  return completionRecord ? { todo, completionRecord } : null;
}

/**
 * 项目组多人协作服务的 HTTP 客户端——**协作链路的唯一网络面**（事件流除外，
 * 见 `collabStreamClient`）。形态照 `feedbackUploader` 先例：
 *
 *  - 单次尝试、不自行重试；状态码 → 语义分档收在这里（与 implement.md 契约一致）：
 *    413→tooLarge / 429→rateLimited / 409→conflict（待办 PATCH 另带 currentVersion）/
 *    401→credentialRejected / 403→forbidden / 其余 4xx→rejected / ≥500 与网络→transient。
 *  - 响应体是不可信输入：snake_case 线格式逐字段挑选映射为 camelCase 后，再过一遍
 *    **共享协议 schema**（strictObject，enum/长度/上界封顶）——两道门都过不去即当
 *    不可信（transient），绝不把服务端原文透传给上层。
 *  - 文件上传：主进程 `fs` 读盘 → **裸字节请求体** `POST .../files?filename=&kind=`
 *    （⛔ multipart——服务端按字节流魔数判型，multipart 首字节是 boundary 必 415，
 *    feedback 附件线已实测）。1 GiB 上限先 stat 后判，超限不读全量。
 *  - 文件下载：流式写到目标目录（O_EXCL 原子占位防覆盖），只回落盘绝对路径。
 *
 * 【白标】标识符、注释、路径一律中性词。【凭据】令牌只进 `Authorization` 头，
 * 本模块不记录、不打印它。【账号】请求体由调用方逐字段组好，本模块不添字段。
 */

const DEFAULT_TIMEOUT_MS = 20_000;
/** 上传包含完整请求体传输，独立于普通 JSON 请求的 20 秒建立/响应预算。 */
const DEFAULT_UPLOAD_TIMEOUT_MS = 30 * 60_000;
/** 下载响应体的整体预算（连接建立后另计）：64 MiB 内网传输的宽裕上界。 */
const DEFAULT_DOWNLOAD_BODY_TIMEOUT_MS = 120_000;
/** JSON 响应体读取上界（字符）：列表投影再大也远低于此；超出即当不可信 → transient。 */
const MAX_RESPONSE_BODY_CHARS = 4_000_000;
/** 下载落盘的同名回避尝试上界（`名 (n).扩展`）；耗尽视为落盘失败。 */
const MAX_FILENAME_ATTEMPTS = 100;

const API_PREFIX = 'api/v1/';

/**
 * 客户端失败码 ⊂ 共享协议 `ProjectCollabErrorCode`：上层（IPC handler）可原样嵌进
 * 结果信封，不需要二次映射。`invalidRequest` = 本地文件不可读等调用侧问题；
 * `writeFailed` = 服务端响应正常但本地落盘失败（仅下载）。
 */
export type CollabClientFailureCode = Extract<
  ProjectCollabErrorCode,
  | 'tooLarge'
  | 'rateLimited'
  | 'conflict'
  | 'quotaExceeded'
  | 'credentialRejected'
  | 'forbidden'
  | 'rejected'
  | 'transient'
  | 'invalidRequest'
  | 'writeFailed'
>;

export type CollabClientFailure = {
  readonly ok: false;
  readonly code: CollabClientFailureCode;
  /** 仅待办 PATCH 409 时非空：服务端带回的当前版本。 */
  readonly currentVersion?: number;
  /** 仅临时文件上传触顶时非空：服务端带回的上限与已用量（字节）。 */
  readonly quota?: ProjectFileQuota;
  /**
   * 仅「登记资产版本」撞上 `file_already_versioned` 时非空：服务端指出这次上传**已经**
   * 是哪一版。上层据此把一次重试收敛成成功（⛔ 不重复落库、不重传字节），而不是
   * 把一个已经完成的动作报成失败。
   */
  readonly existingVersionId?: string;
  /**
   * 服务端业务码（HTTP 体的 `error` 串）：**仅 4xx 且响应体形如 `{ "error": "<code>" }`**
   * 时非空，供上层原样嵌进结果信封（渲染层据此就地覆盖通用文案）。⛔ 不含用户内容，
   * 闭集与拒收规则由共享层 `ProjectCollabServerCodeSchema` 收口。与 `code` 正交：
   * `code` 的判定一字不改，本字段只是附带透传。
   */
  readonly serverCode?: string;
};

export type CollabClientOutcome<T> = { readonly ok: true; readonly value: T } | CollabClientFailure;

export interface CollabClientOptions {
  /** 构建期注入并已校验的服务基地址（末尾带 `/`）。 */
  readonly baseUrl: string;
  readonly fetchImpl?: typeof fetch;
  readonly timeoutMs?: number;
  /** 下载响应体的整体预算（连接建立后另计）。 */
  readonly downloadBodyTimeoutMs?: number;
  /** 上传请求（含请求体传输）的总预算。 */
  readonly uploadTimeoutMs?: number;
}

export function createCollabClient(options: CollabClientOptions): CollabClient {
  return new CollabClient(options);
}

interface SendInit {
  readonly method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  readonly accessToken: string;
  readonly query?: Readonly<Record<string, string | number | undefined>>;
  readonly jsonBody?: unknown;
  readonly streamBody?: ReadableStream<Uint8Array>;
  readonly contentLength?: number;
  readonly contentType?: string;
  readonly signal?: AbortSignal;
  readonly timeoutMs?: number;
}

export class CollabClient {
  private readonly submissionGate: CollabSubmissionGateClient;
  private readonly todoCollaboration: CollabTodoCollaborationClient;
  private readonly workOverview: CollabWorkOverviewClient;
  private readonly baseUrl: URL;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;
  private readonly downloadBodyTimeoutMs: number;
  private readonly uploadTimeoutMs: number;
  /**
   * 本连接协商到的服务能力（CORE-05）：`fetchCapabilities` 填入，归类写门（createTodo /
   * updateTodo）据此判断能不能发 `module_id`/`category_id`。null＝尚未协商（不拦，服务端
   * 仍是最终权威）；空清单＝确知是旧服务（拦，回升级信号）。
   */
  private negotiatedCapabilities: ServiceCapabilities | null = null;

  constructor(options: CollabClientOptions) {
    this.submissionGate = new CollabSubmissionGateClient(options);
    this.todoCollaboration = new CollabTodoCollaborationClient(options);
    this.workOverview = new CollabWorkOverviewClient(options);
    this.baseUrl = new URL(options.baseUrl.endsWith('/') ? options.baseUrl : `${options.baseUrl}/`);
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.downloadBodyTimeoutMs = options.downloadBodyTimeoutMs ?? DEFAULT_DOWNLOAD_BODY_TIMEOUT_MS;
    this.uploadTimeoutMs = options.uploadTimeoutMs ?? DEFAULT_UPLOAD_TIMEOUT_MS;
  }

  getTodoCollaborators(
    token: string,
    input: ProjectTodoCollaboratorsRequest,
  ): ReturnType<CollabTodoCollaborationClient['getTodoCollaborators']> {
    return this.todoCollaboration.getTodoCollaborators(token, input);
  }

  replaceTodoCollaborators(
    token: string,
    input: ProjectTodoCollaboratorsReplaceRequest,
  ): ReturnType<CollabTodoCollaborationClient['replaceTodoCollaborators']> {
    return this.todoCollaboration.replaceTodoCollaborators(token, input);
  }

  listTodoComments(
    token: string,
    input: ProjectTodoCommentsRequest,
  ): ReturnType<CollabTodoCollaborationClient['listTodoComments']> {
    return this.todoCollaboration.listTodoComments(token, input);
  }

  createTodoComment(
    token: string,
    input: ProjectTodoCommentCreateRequest,
  ): ReturnType<CollabTodoCollaborationClient['createTodoComment']> {
    return this.todoCollaboration.createTodoComment(token, input);
  }

  previewTodoDeletion(
    token: string,
    input: ProjectTodoDeletePreviewRequest,
  ): ReturnType<CollabTodoCollaborationClient['previewTodoDeletion']> {
    return this.todoCollaboration.previewTodoDeletion(token, input);
  }

  /* ------------------------------- 项目 ------------------------------- */

  readWorkOverview(
    accessToken: string,
    input: ProjectWorkOverviewRequest,
  ): Promise<CollabClientOutcome<ProjectWorkOverview>> {
    return this.workOverview.readWorkOverview(accessToken, input);
  }

  readSubmissionGate(
    accessToken: string,
    input: ProjectSubmissionGateRequest,
  ): Promise<CollabClientOutcome<ProjectSubmissionGate>> {
    return this.submissionGate.readSubmissionGate(accessToken, input);
  }

  updateSubmissionGate(
    accessToken: string,
    input: ProjectSubmissionGateUpdateRequest,
  ): Promise<CollabClientOutcome<ProjectSubmissionGate>> {
    return this.submissionGate.updateSubmissionGate(accessToken, input);
  }

  async listProjects(
    accessToken: string,
    input: { readonly includeArchived?: boolean | undefined } = {},
  ): Promise<CollabClientOutcome<readonly ProjectSummary[]>> {
    return this.requestEntity(
      'projects',
      {
        method: 'GET',
        accessToken,
        // 缺省不带该参数：服务端默认即「不含归档」，少一个查询串少一条歧义。
        query: { include_archived: input.includeArchived === true ? 'true' : undefined },
      },
      (body) => mapArray(recordOf(body)?.projects, mapProjectSummary),
    );
  }

  async createProject(
    accessToken: string,
    input: { readonly name: string },
  ): Promise<CollabClientOutcome<ProjectDetail>> {
    return this.requestEntity(
      'projects',
      { method: 'POST', accessToken, jsonBody: { name: input.name } },
      (body) => mapProjectDetail(recordOf(body)?.project),
    );
  }

  async readProjectDetail(
    accessToken: string,
    input: { readonly projectId: string },
  ): Promise<CollabClientOutcome<ProjectDetail>> {
    return this.requestEntity(
      `projects/${encodeURIComponent(input.projectId)}`,
      { method: 'GET', accessToken },
      (body) => mapProjectDetail(recordOf(body)?.project),
    );
  }

  async updateProject(
    accessToken: string,
    input: {
      readonly projectId: string;
      readonly name?: string | undefined;
      readonly instructionsText?: string | undefined;
    },
  ): Promise<CollabClientOutcome<ProjectDetail>> {
    return this.requestEntity(
      `projects/${encodeURIComponent(input.projectId)}`,
      {
        method: 'PATCH',
        accessToken,
        jsonBody: {
          ...(input.name !== undefined ? { name: input.name } : {}),
          ...(input.instructionsText !== undefined
            ? { instructions_text: input.instructionsText }
            : {}),
        },
      },
      (body) => mapProjectDetail(recordOf(body)?.project),
    );
  }

  /** 读取项目约定（AI 录入规则）。成员可读；缺席按缺省投影（空规则 / v0 / 未发布）。 */
  async readConventions(
    accessToken: string,
    input: { readonly projectId: string },
  ): Promise<CollabClientOutcome<ProjectConventions>> {
    return this.requestEntity(
      `projects/${encodeURIComponent(input.projectId)}/conventions`,
      { method: 'GET', accessToken },
      (body) => mapProjectConventions(recordOf(body)?.conventions),
    );
  }

  /**
   * 发布新一版 AI 录入规则（manager+）。乐观锁 `expected_version`；409 时把服务端
   * `current_version` 带回（`conflict` + currentVersion），供上层保留草稿并提示刷新。
   * ⛔ 与 `updateProject`（改说明/改名）是两条独立路径——各走各的端点，互不覆写。
   */
  async updateConventions(
    accessToken: string,
    input: {
      readonly projectId: string;
      readonly aiEntryRules: string;
      readonly expectedVersion: number;
    },
  ): Promise<CollabClientOutcome<ProjectConventions>> {
    return this.requestEntity(
      `projects/${encodeURIComponent(input.projectId)}/conventions`,
      {
        method: 'PATCH',
        accessToken,
        jsonBody: {
          ai_entry_rules: input.aiEntryRules,
          expected_version: input.expectedVersion,
        },
      },
      (body) => mapProjectConventions(recordOf(body)?.conventions),
      { readConflictVersion: true },
    );
  }

  /**
   * 签发邀请。`kind='open'` 时透传 `ttl_hours` / `max_uses`（snake_case 到线上）；
   * `single`（缺省）不带这两项，行为逐字不变。响应 `id → invitationId`。
   */
  async createInvitation(
    accessToken: string,
    input: {
      readonly projectId: string;
      readonly role: ProjectInvitationRole;
      readonly kind?: ProjectInvitationKind;
      readonly ttlHours?: ProjectOpenInvitationTtlHours;
      readonly maxUses?: number;
    },
  ): Promise<
    CollabClientOutcome<{
      readonly code: string;
      readonly expiresAt: string;
      readonly invitationId: string;
      readonly kind: ProjectInvitationKind;
      readonly maxUses: number | null;
    }>
  > {
    return this.requestEntity(
      `projects/${encodeURIComponent(input.projectId)}/invitations`,
      {
        method: 'POST',
        accessToken,
        jsonBody: {
          role: input.role,
          // kind 缺省即不发（老服务端不认这个键，落缺省 single）；open 才带有效期与上限。
          ...(input.kind !== undefined ? { kind: input.kind } : {}),
          ...(input.ttlHours !== undefined ? { ttl_hours: input.ttlHours } : {}),
          ...(input.maxUses !== undefined ? { max_uses: input.maxUses } : {}),
        },
      },
      (body) => {
        const wire = invitationWireSchema.safeParse(body);
        return wire.success
          ? {
              code: wire.data.code,
              expiresAt: wire.data.expires_at,
              invitationId: wire.data.id,
              kind: wire.data.kind,
              maxUses: wire.data.max_uses,
            }
          : null;
      },
    );
  }

  /** 列出本项目进行中的开放邀请（manager+）。⛔ 服务端不回 code。 */
  async listOpenInvitations(
    accessToken: string,
    input: { readonly projectId: string },
  ): Promise<CollabClientOutcome<readonly ProjectOpenInvitation[]>> {
    return this.requestEntity(
      `projects/${encodeURIComponent(input.projectId)}/invitations`,
      { method: 'GET', accessToken, query: { kind: 'open' } },
      (body) => mapArray(recordOf(body)?.invitations, mapOpenInvitation),
    );
  }

  /** 提前关闭一条邀请（manager+，同项目；服务端幂等）。 */
  async revokeInvitation(
    accessToken: string,
    input: { readonly invitationId: string },
  ): Promise<CollabClientOutcome<{ readonly projectId: string; readonly invitationId: string }>> {
    return this.requestEntity(
      `invitations/${encodeURIComponent(input.invitationId)}/revoke`,
      { method: 'POST', accessToken },
      (body) => {
        const wire = revokeInvitationWireSchema.safeParse(body);
        return wire.success
          ? { projectId: wire.data.project_id, invitationId: wire.data.id }
          : null;
      },
    );
  }

  async redeemInvitation(
    accessToken: string,
    input: { readonly code: string },
  ): Promise<CollabClientOutcome<{ readonly projectId: string; readonly role: ProjectRole }>> {
    return this.requestEntity(
      'invitations/redeem',
      { method: 'POST', accessToken, jsonBody: { code: input.code } },
      (body) => {
        const wire = redeemWireSchema.safeParse(body);
        return wire.success ? { projectId: wire.data.project_id, role: wire.data.role } : null;
      },
    );
  }

  /* -------------------- 成员管理（改角色/移除 manager+；转让/归档 owner） -------------------- */
  /*
   * 四个方法同形：调用后服务端回权威项目详情（成员名册 + 归档态），映射失败即
   * transient。`subject` 进路径段必须 encodeURIComponent——它是服务端身份主体，
   * 不是 uuid，可能带 `/` 一类会改变路由含义的字符。
   */

  async updateMemberRole(
    accessToken: string,
    input: {
      readonly projectId: string;
      readonly subject: string;
      // ⛔ 别在这里手写 `'editor' | 'viewer'`：它是协议闭集的**第二份拷贝**，
      // 加一档角色时两份会各说各话（本次实测：它是唯一被编译器拦下的一处）。
      readonly role: ProjectAssignableRole;
    },
  ): Promise<CollabClientOutcome<ProjectDetail>> {
    return this.requestEntity(
      `projects/${encodeURIComponent(input.projectId)}/members/${encodeURIComponent(input.subject)}`,
      { method: 'PATCH', accessToken, jsonBody: { role: input.role } },
      (body) => mapProjectDetail(recordOf(body)?.project),
    );
  }

  async removeMember(
    accessToken: string,
    input: { readonly projectId: string; readonly subject: string },
  ): Promise<CollabClientOutcome<ProjectDetail>> {
    return this.requestEntity(
      `projects/${encodeURIComponent(input.projectId)}/members/${encodeURIComponent(input.subject)}`,
      { method: 'DELETE', accessToken },
      (body) => mapProjectDetail(recordOf(body)?.project),
    );
  }

  async transferOwnership(
    accessToken: string,
    input: { readonly projectId: string; readonly subject: string },
  ): Promise<CollabClientOutcome<ProjectDetail>> {
    return this.requestEntity(
      `projects/${encodeURIComponent(input.projectId)}/transfer`,
      { method: 'POST', accessToken, jsonBody: { subject: input.subject } },
      (body) => mapProjectDetail(recordOf(body)?.project),
    );
  }

  /** 归档与恢复走两条服务端路径（动作在路径上，不在请求体里的开关上）。 */
  async setProjectArchived(
    accessToken: string,
    input: { readonly projectId: string; readonly archived: boolean },
  ): Promise<CollabClientOutcome<ProjectDetail>> {
    const action = input.archived ? 'archive' : 'unarchive';
    return this.requestEntity(
      `projects/${encodeURIComponent(input.projectId)}/${action}`,
      { method: 'POST', accessToken },
      (body) => mapProjectDetail(recordOf(body)?.project),
    );
  }

  /* ------------------------------- 动态 ------------------------------- */

  async listFeed(
    accessToken: string,
    input: {
      readonly projectId: string;
      readonly beforeId?: string | undefined;
      readonly limit?: number | undefined;
    },
  ): Promise<CollabClientOutcome<readonly FeedEntry[]>> {
    return this.requestEntity(
      `projects/${encodeURIComponent(input.projectId)}/feed`,
      { method: 'GET', accessToken, query: { before_id: input.beforeId, limit: input.limit } },
      (body) => mapArray(recordOf(body)?.entries, mapFeedEntry),
    );
  }

  async postFeedEntry(
    accessToken: string,
    input: ProjectFeedPostRequest,
  ): Promise<CollabClientOutcome<FeedEntry>> {
    return this.requestEntity(
      `projects/${encodeURIComponent(input.projectId)}/feed`,
      {
        method: 'POST',
        accessToken,
        jsonBody: {
          body_md: input.bodyMd,
          ...(input.refs !== undefined ? { refs: input.refs } : {}),
        },
      },
      (body) => mapFeedEntry(recordOf(body)?.entry),
    );
  }

  async postFeedComment(
    accessToken: string,
    input: ProjectCommentPostRequest,
  ): Promise<CollabClientOutcome<FeedComment>> {
    return this.requestEntity(
      `feed/${encodeURIComponent(input.entryId)}/comments`,
      {
        method: 'POST',
        accessToken,
        jsonBody: {
          body_md: input.bodyMd,
          // @ 提及（0011）：缺席即不发（老服务端不认这个键，落缺省空数组）。
          ...(input.refs !== undefined ? { refs: input.refs } : {}),
        },
      },
      (body) => mapFeedComment(recordOf(body)?.comment),
    );
  }

  /* ------------------------------- 讨论 ------------------------------- */

  async searchChatHistory(
    accessToken: string,
    input: ProjectChatHistoryRequest,
  ): Promise<CollabClientOutcome<ProjectChatSearchData>> {
    const parsed = ProjectChatHistoryRequestSchema.safeParse(input);
    if (!parsed.success || parsed.data.search === undefined) {
      return { ok: false, code: 'invalidRequest' };
    }
    const request = parsed.data;
    return this.requestEntity(
      `projects/${encodeURIComponent(request.projectId)}/messages/search`,
      {
        method: 'POST',
        accessToken,
        jsonBody: {
          query: parsed.data.search.query,
          ...(parsed.data.search.cursor !== undefined ? { cursor: parsed.data.search.cursor } : {}),
          ...(request.limit !== undefined ? { limit: request.limit } : {}),
          ...(request.authorSubject !== undefined ? { author_subject: request.authorSubject } : {}),
          ...(request.createdAfter !== undefined ? { created_after: request.createdAfter } : {}),
          ...(request.createdBefore !== undefined ? { created_before: request.createdBefore } : {}),
        },
      },
      (body) => {
        const wire = recordOf(body);
        const data = ProjectChatSearchDataSchema.safeParse({
          messages: mapArray(wire?.messages, mapChatMessage),
          searchPage: { nextCursor: wire?.next_cursor },
        });
        return data.success ? data.data : null;
      },
    );
  }

  async listChatHistory(
    accessToken: string,
    input: ProjectChatHistoryRequest,
  ): Promise<CollabClientOutcome<readonly ChatMessage[]>> {
    return this.requestEntity(
      `projects/${encodeURIComponent(input.projectId)}/messages`,
      {
        method: 'GET',
        accessToken,
        query: {
          after_seq: input.afterSeq,
          before_seq: input.beforeSeq,
          limit: input.limit,
          author_subject: input.authorSubject,
          created_after: input.createdAfter,
          created_before: input.createdBefore,
        },
      },
      (body) => mapArray(recordOf(body)?.messages, mapChatMessage),
    );
  }

  async sendChatMessage(
    accessToken: string,
    input: ProjectChatSendRequest,
    isCurrent?: () => boolean,
  ): Promise<CollabClientOutcome<ChatMessage>> {
    if (input.clientMessageId !== undefined) {
      // 每次显式重试重新协商，不能把旧连接/账号的能力缓存当成本次发送保证。
      const capabilities = await this.fetchCapabilities(accessToken);
      if (!capabilities.ok) return capabilities;
      if (!hasCapability(capabilities.value, SERVICE_CAPABILITY.chatIdempotency)) {
        return { ok: false, code: 'rejected', serverCode: 'service_upgrade_required' };
      }
    }
    // 能力协商期间可能换号或撤销发起帧授权，写入前复核 Main 捕获的上下文。
    if (isCurrent && !isCurrent()) return { ok: false, code: 'forbidden' };
    return this.requestEntity(
      `projects/${encodeURIComponent(input.projectId)}/messages`,
      {
        method: 'POST',
        accessToken,
        jsonBody: {
          body_md: input.bodyMd,
          ...(input.refs !== undefined ? { refs: input.refs } : {}),
          ...(input.clientMessageId !== undefined
            ? { client_message_id: input.clientMessageId }
            : {}),
        },
      },
      (body) => mapChatMessage(recordOf(body)?.message),
    );
  }

  async revokeChatMessage(
    accessToken: string,
    input: { readonly messageId: string },
  ): Promise<CollabClientOutcome<ChatMessage>> {
    return this.requestEntity(
      `messages/${encodeURIComponent(input.messageId)}/revoke`,
      { method: 'POST', accessToken },
      (body) => mapChatMessage(recordOf(body)?.message),
    );
  }

  async setReadCursor(
    accessToken: string,
    input: { readonly projectId: string; readonly lastReadSeq: number },
  ): Promise<CollabClientOutcome<true>> {
    return this.requestVoid(`projects/${encodeURIComponent(input.projectId)}/read-cursor`, {
      method: 'PUT',
      accessToken,
      jsonBody: { last_read_seq: input.lastReadSeq },
    });
  }

  /* ------------------------------- 待办 ------------------------------- */

  /**
   * 待办列表。`parentId` 三态映射到线协议的两个查询参数：
   *  - 缺席      → 一个参数都不发（与两级化之前的请求逐字一致，老服务端也认）；
   *  - `null`    → `top_level=true`（只要顶层需求）；
   *  - uuid      → `parent_id=<uuid>`（只要那条需求下的任务）。
   * 线上刻意用两个参数而不是给 uuid 字段塞一个魔法串——查询参数只有字符串，
   * `parent_id=null` 与一条真叫 "null" 的 id 在线上分不开。
   */
  async listTodos(
    accessToken: string,
    input: {
      readonly projectId: string;
      readonly parentId?: string | null | undefined;
      readonly source?: TodoSource | undefined;
      readonly visibility?: TodoVisibility | undefined;
      readonly cursor?: string | undefined;
      readonly limit?: number | undefined;
    },
  ): Promise<CollabClientOutcome<TodoPage>> {
    return this.requestEntity(
      `projects/${encodeURIComponent(input.projectId)}/todos`,
      {
        method: 'GET',
        accessToken,
        query: {
          top_level: input.parentId === null ? 'true' : undefined,
          parent_id: typeof input.parentId === 'string' ? input.parentId : undefined,
          source: input.source,
          visibility: input.visibility,
          cursor: input.cursor,
          limit: input.limit,
        },
      },
      (body) => {
        const record = recordOf(body);
        const todos = mapArray(record?.todos, mapTodo);
        if (todos === null || typeof record?.has_more !== 'boolean') return null;
        const nextCursor = record.next_cursor;
        if (nextCursor !== null && typeof nextCursor !== 'string') return null;
        if (record.has_more !== (nextCursor !== null)) return null;
        return { todos, hasMore: record.has_more, nextCursor };
      },
    );
  }

  /**
   * 需求页码查询（CORE-07）：过滤 + 分页；与 listTodos 游标端点并存、走不同的服务端路由。
   * 客户端 camelCase 请求映射到服务端 snake_case 查询参数（`keyword` → `q`）；undefined 的
   * 参数不发（省略＝不筛）。响应逐字校验 items/total/page/page_size/query_revision——任一格
   * 形状不符整条判空（`mapArray` 见 null 即整批判空，与 listTodos 同款纵深防御）。
   */
  async readRequirementPage(
    accessToken: string,
    input: ProjectRequirementPageRequest,
  ): Promise<CollabClientOutcome<RequirementPageView>> {
    return this.requestEntity(
      `projects/${encodeURIComponent(input.projectId)}/requirement-page`,
      {
        method: 'GET',
        accessToken,
        query: {
          page: input.page,
          page_size: input.pageSize,
          item_kind: input.itemKind,
          assignee_subject: input.assigneeSubject,
          creator_subject: input.creatorSubject,
          view: input.view,
          sort_by: input.sortBy,
          sort_direction: input.sortDirection,
          q: input.keyword,
          status: input.status,
          iteration_id: input.iterationId,
          module_id: input.moduleId,
          category_id: input.categoryId,
          // 计划区间交叠（ADR-0042）：含左不含右的两个时刻，缺席即不限那一端。
          plan_from: input.planFrom,
          plan_to: input.planTo,
        },
      },
      (body) => {
        const record = recordOf(body);
        if (
          (input.view !== undefined ||
            input.sortBy !== undefined ||
            input.sortDirection !== undefined) &&
          record?.query_contract !== 'table-v1'
        )
          return null;
        const items = mapArray(record?.items, mapTodo);
        if (items === null) return null;
        const total = record?.total;
        const page = record?.page;
        const pageSize = record?.page_size;
        const queryRevision = record?.query_revision;
        if (typeof total !== 'number' || !Number.isSafeInteger(total) || total < 0) return null;
        if (typeof page !== 'number' || !Number.isSafeInteger(page) || page < 1) return null;
        if (pageSize !== 5 && pageSize !== 10 && pageSize !== 20) return null;
        if (typeof queryRevision !== 'string' || queryRevision.length === 0) return null;
        return { items, total, page, pageSize, queryRevision };
      },
    );
  }

  /**
   * 服务能力协商（CORE-05）：拉取对面支持的能力清单并缓存进本连接。
   *
   * ⭐ 旧服务端**没有**这个端点 → 404：这不是错误，而是「旧服务」这一态本身——缓存空
   *    能力集（legacy）并返回成功，让归类写门就地拦下新字段、渲染层显示升级提示。
   *    其余非 2xx（401/403/5xx/断线）才是真失败，⛔ 不缓存（下次仍可重协商）。
   */
  async fetchCapabilities(accessToken: string): Promise<CollabClientOutcome<ServiceCapabilities>> {
    const response = await this.send('capabilities', { method: 'GET', accessToken });
    if (response === null) return { ok: false, code: 'transient' };
    if (response.status === 404) {
      const legacy: ServiceCapabilities = { capabilities: [], serviceVersion: 'legacy' };
      this.negotiatedCapabilities = legacy;
      return { ok: true, value: legacy };
    }
    if (response.status >= 200 && response.status < 300) {
      const body = await readBoundedJson(response);
      const record = body === undefined ? null : recordOf(body);
      const caps = record?.capabilities;
      const version = record?.service_version;
      if (!Array.isArray(caps) || !caps.every((entry) => typeof entry === 'string')) {
        return { ok: false, code: 'transient' };
      }
      if (typeof version !== 'string' || version.length === 0) {
        return { ok: false, code: 'transient' };
      }
      const value: ServiceCapabilities = { capabilities: caps, serviceVersion: version };
      this.negotiatedCapabilities = value;
      return { ok: true, value };
    }
    return failureFromResponse(response);
  }

  /**
   * 新旧测试模式判定（CORE-05 判据 2 + TST-02）：只读。
   *
   * `mode` 放开 `legacy | rounds`；`test_rounds` 逐条走轮次摘要映射（与轮次列表**同一个**
   * `mapTestRound`，⛔ 不写第二份）——任一条不是轮次形状、条数越过服务端上界，整条判不可信
   * （⛔ 不采信虚构的历史轮次）。
   */
  async fetchProjectTestMode(
    accessToken: string,
    input: { readonly projectId: string },
  ): Promise<CollabClientOutcome<ProjectTestMode>> {
    return this.requestEntity(
      `projects/${encodeURIComponent(input.projectId)}/test-mode`,
      { method: 'GET', accessToken },
      (body) => {
        const record = recordOf(body);
        if (!record) return null;
        const rounds = mapArray(record.test_rounds, mapTestRound);
        if (rounds === null) return null;
        const view = ProjectTestModeSchema.safeParse({
          mode: record.mode,
          canEnableNewMode: record.can_enable_new_mode,
          blockedReasons: record.blocked_reasons,
          legacyOpenReviewCount: record.legacy_open_review_count,
          testRounds: rounds,
        });
        return view.success ? view.data : null;
      },
    );
  }

  async createTodo(
    accessToken: string,
    input: ProjectTodoCreateRequest,
  ): Promise<CollabClientOutcome<Todo>> {
    // 判据 1「旧服务禁发新增写字段」：确知对面不支持归类写字段就**不发**（发了老服务端
    // 一律 422、或静默忽略），回升级信号供上层显示升级提示。⛔ 门在这一处（写路径唯一
    // 出口），不靠渲染层自觉。
    if (
      dictionaryWriteRequiresUpgrade(this.negotiatedCapabilities, {
        moduleId: input.moduleId,
        categoryId: input.categoryId,
      })
    ) {
      return { ok: false, code: 'rejected', serverCode: 'service_upgrade_required' };
    }
    return this.requestEntity(
      `projects/${encodeURIComponent(input.projectId)}/todos`,
      {
        method: 'POST',
        accessToken,
        jsonBody: {
          title: input.title,
          item_kind: input.itemKind,
          // 父项 / 来源 / 可见性：缺席即不发；itemKind 始终显式发送。
          ...(input.parentId !== undefined ? { parent_id: input.parentId } : {}),
          ...(input.source !== undefined ? { source: input.source } : {}),
          ...(input.visibility !== undefined ? { visibility: input.visibility } : {}),
          ...(input.status !== undefined ? { status: input.status } : {}),
          // 处理人档位（0010）：缺席即不发（老服务端不认这个键；服务端落缺省 member）。
          ...(input.assigneeKind !== undefined ? { assignee_kind: input.assigneeKind } : {}),
          ...(input.assigneeSubject !== undefined
            ? { assignee_subject: input.assigneeSubject }
            : {}),
          ...(input.priority !== undefined ? { priority: input.priority } : {}),
          ...(input.labels !== undefined ? { labels: input.labels } : {}),
          ...(input.startAt !== undefined ? { start_at: input.startAt } : {}),
          ...(input.dueAt !== undefined ? { due_at: input.dueAt } : {}),
          ...(input.description !== undefined ? { description: input.description } : {}),
          ...(input.sessionRef !== undefined ? { session_ref: input.sessionRef } : {}),
          ...(input.refs !== undefined ? { refs: input.refs } : {}),
          // 工作单面：缺席即不发（老服务端不认这两个键；服务端落缺省＝普通待办）。
          ...(input.constraintsText !== undefined
            ? { constraints_text: input.constraintsText }
            : {}),
          ...(input.acceptanceItems !== undefined
            ? { acceptance_items: input.acceptanceItems }
            : {}),
          // 归类面（0021）：缺席即不发（老服务端不认这两个键；新服务端落「未分类」）。
          ...(input.moduleId !== undefined ? { module_id: input.moduleId } : {}),
          ...(input.categoryId !== undefined ? { category_id: input.categoryId } : {}),
        },
      },
      (body) => mapTodo(recordOf(body)?.todo),
    );
  }

  /** 乐观锁部分更新；409 时把服务端 `current_version` 带回（`conflict` + currentVersion）。 */
  async updateTodo(
    accessToken: string,
    input: ProjectTodoUpdateRequest,
  ): Promise<CollabClientOutcome<Todo>> {
    // 判据 1：与建单同一道门。显式 `null`（清空归类）在旧服务端上也发不出去，一并拦。
    if (
      dictionaryWriteRequiresUpgrade(this.negotiatedCapabilities, {
        moduleId: input.moduleId,
        categoryId: input.categoryId,
      })
    ) {
      return { ok: false, code: 'rejected', serverCode: 'service_upgrade_required' };
    }
    return this.requestEntity(
      `todos/${encodeURIComponent(input.todoId)}`,
      {
        method: 'PATCH',
        accessToken,
        jsonBody: {
          expected_version: input.expectedVersion,
          // 改挂靠同样区分 null（摘回顶层）与 undefined（不改）。
          ...(input.parentId !== undefined ? { parent_id: input.parentId } : {}),
          ...(input.title !== undefined ? { title: input.title } : {}),
          ...(input.status !== undefined ? { status: input.status } : {}),
          // 改派档位（0010）：缺席＝不改档位。
          ...(input.assigneeKind !== undefined ? { assignee_kind: input.assigneeKind } : {}),
          // null＝清空，须保留；undefined＝缺席，须省略（JSON.stringify 只丢 undefined）。
          ...(input.assigneeSubject !== undefined
            ? { assignee_subject: input.assigneeSubject }
            : {}),
          ...(input.priority !== undefined ? { priority: input.priority } : {}),
          ...(input.labels !== undefined ? { labels: input.labels } : {}),
          ...(input.startAt !== undefined ? { start_at: input.startAt } : {}),
          ...(input.dueAt !== undefined ? { due_at: input.dueAt } : {}),
          ...(input.description !== undefined ? { description: input.description } : {}),
          // 关联面同样区分 null（解绑）与 undefined（不改）。
          ...(input.sessionRef !== undefined ? { session_ref: input.sessionRef } : {}),
          ...(input.refs !== undefined ? { refs: input.refs } : {}),
          ...(input.constraintsText !== undefined
            ? { constraints_text: input.constraintsText }
            : {}),
          // 归类面（0021）同样区分 null（清空归类）与 undefined（不改）。
          // ⚠️⚠️ 这两行的 `!== undefined` 是「省略不改」的**唯一载体**：写成
          // `input.moduleId ? ... : {}` 会把 null 一起吃掉，于是「清空归类」这个动作
          // 在线上永远发不出去，而界面看起来点了、也没报错。
          ...(input.moduleId !== undefined ? { module_id: input.moduleId } : {}),
          ...(input.categoryId !== undefined ? { category_id: input.categoryId } : {}),
        },
      },
      (body) => mapTodo(recordOf(body)?.todo),
      { readConflictVersion: true },
    );
  }

  /**
   * 认领无主需求并写计划日期（FLOW-02）。端点 `POST /todos/{id}/claim`，与改单分开。
   * 计划日期复用 start_at/due_at：`null`＝写空须保留，`undefined`＝缺席须省略。
   * ⛔ **不传 `readConflictVersion`**：认领没有版本号，409 的语义是「已被他人认领」而非
   *    「版本过期」。失败经 `failureFromResponse` 带出 `serverCode`
   *    （`requirement_already_claimed`），供上层给出真实失败提示、⛔ 不伪成功。
   */
  async claimRequirement(
    accessToken: string,
    input: ProjectRequirementClaimRequest,
  ): Promise<CollabClientOutcome<Todo>> {
    return this.requestEntity(
      `todos/${encodeURIComponent(input.todoId)}/claim`,
      {
        method: 'POST',
        accessToken,
        jsonBody: {
          ...(input.startAt !== undefined ? { start_at: input.startAt } : {}),
          ...(input.dueAt !== undefined ? { due_at: input.dueAt } : {}),
        },
      },
      (body) => mapTodo(recordOf(body)?.todo),
    );
  }

  /**
   * 软删一条需求/任务及其**整棵子树**（manager+）。单条端点 `DELETE /todos/{id}`，无请求体。
   * 幂等：已删再删仍回相同 `{deleted_ids, count}`。失败经 `failureFromResponse` 带出
   * `serverCode`（404 `todo_not_found` / 409 `draft_source_deleted` / 403 `project_archived` …）。
   */
  async deleteTodo(
    accessToken: string,
    input: { readonly todoId: string },
  ): Promise<CollabClientOutcome<TodoDeleteView>> {
    return this.requestEntity(
      `todos/${encodeURIComponent(input.todoId)}`,
      { method: 'DELETE', accessToken },
      (body) => mapTodoDelete(body),
    );
  }

  /**
   * 批量软删多条需求/任务及各自子树（manager+）。批量端点
   * `POST /projects/{id}/todos/delete-batch`，body `{ids:[<根 id>...]}`（1–100 个根，
   * 级联总数不受此限）。响应各根子树并集、升序去重。任一 id 不属该项目 → 404 整批不动
   * （服务端事务）；失败经 `failureFromResponse` 带出 `serverCode`。
   */
  async deleteTodosBatch(
    accessToken: string,
    input: { readonly projectId: string; readonly ids: readonly string[] },
  ): Promise<CollabClientOutcome<TodoDeleteView>> {
    return this.requestEntity(
      `projects/${encodeURIComponent(input.projectId)}/todos/delete-batch`,
      { method: 'POST', accessToken, jsonBody: { ids: [...input.ids] } },
      (body) => mapTodoDelete(body),
    );
  }

  /* ----------------------------- 工作单 ------------------------------- */

  /** 单条读取：待办本体 + 验收清单逐条 + 完成记录时间线。 */
  async getTodoDetail(
    accessToken: string,
    input: ProjectTodoDetailRequest,
  ): Promise<CollabClientOutcome<TodoDetailView>> {
    return this.requestEntity(
      `todos/${encodeURIComponent(input.todoId)}`,
      { method: 'GET', accessToken },
      (body) => mapTodoDetail(body),
    );
  }

  /** 整表替换验收清单（乐观锁；已勾条目随之作废——勾的是旧判据）。 */
  async setAcceptanceItems(
    accessToken: string,
    input: ProjectTodoAcceptanceSetRequest,
  ): Promise<CollabClientOutcome<AcceptanceSetView>> {
    return this.requestEntity(
      `todos/${encodeURIComponent(input.todoId)}/acceptance-items`,
      {
        method: 'PUT',
        accessToken,
        jsonBody: { expected_version: input.expectedVersion, items: input.items },
      },
      (body) => {
        const record = recordOf(body);
        const todo = mapTodo(record?.todo);
        const items = mapArray(record?.acceptance_items, mapAcceptanceItem);
        return todo && items ? { todo, acceptanceItems: items } : null;
      },
      { readConflictVersion: true },
    );
  }

  /** 提交验收：推到「待验收」并写完成记录（进入该档的唯一入口）。 */
  async submitTodoReview(
    accessToken: string,
    input: ProjectTodoSubmitReviewRequest,
  ): Promise<CollabClientOutcome<TodoReviewView>> {
    return this.requestEntity(
      `todos/${encodeURIComponent(input.todoId)}/submit`,
      {
        method: 'POST',
        accessToken,
        jsonBody: {
          expected_version: input.expectedVersion,
          summary: input.summary,
          ...(input.artifacts !== undefined ? { artifacts: input.artifacts } : {}),
          ...(input.itemNotes !== undefined
            ? {
                item_notes: input.itemNotes.map((note) => ({
                  ordinal: note.ordinal,
                  note: note.note,
                })),
              }
            : {}),
        },
      },
      (body) => mapTodoReview(body),
      { readConflictVersion: true },
    );
  }

  /** 验收（→已完成）或打回（→进行中，理由必填）。 */
  async reviewTodo(
    accessToken: string,
    input: ProjectTodoReviewRequest,
  ): Promise<CollabClientOutcome<TodoReviewView>> {
    return this.requestEntity(
      `todos/${encodeURIComponent(input.todoId)}/review`,
      {
        method: 'POST',
        accessToken,
        jsonBody: {
          expected_version: input.expectedVersion,
          decision: input.decision,
          ...(input.reason !== undefined ? { reason: input.reason } : {}),
          ...(input.checkedOrdinals !== undefined
            ? { checked_ordinals: input.checkedOrdinals }
            : {}),
        },
      },
      (body) => mapTodoReview(body),
      { readConflictVersion: true },
    );
  }

  /* --------------------------- 拆解草案闸 ----------------------------- */

  async listDraftBatches(
    accessToken: string,
    input: ProjectTodoDraftListRequest,
  ): Promise<CollabClientOutcome<readonly TodoDraftBatch[]>> {
    return this.requestEntity(
      `projects/${encodeURIComponent(input.projectId)}/todo-drafts`,
      { method: 'GET', accessToken },
      (body) => mapArray(recordOf(body)?.batches, mapDraftBatch),
    );
  }

  async createDraftBatch(
    accessToken: string,
    input: ProjectTodoDraftCreateRequest,
  ): Promise<CollabClientOutcome<TodoDraftBatch>> {
    return this.requestEntity(
      `projects/${encodeURIComponent(input.projectId)}/todo-drafts`,
      {
        method: 'POST',
        accessToken,
        jsonBody: {
          ...(input.sourceTodoId !== undefined ? { source_todo_id: input.sourceTodoId } : {}),
          target_item_kind: input.targetItemKind,
          parent_id: input.parentId,
          items: input.items.map((item) => ({
            title: item.title,
            ...(item.description !== undefined ? { description: item.description } : {}),
            ...(item.constraintsText !== undefined
              ? { constraints_text: item.constraintsText }
              : {}),
            ...(item.acceptanceItems !== undefined
              ? { acceptance_items: item.acceptanceItems }
              : {}),
            ...(item.priority !== undefined ? { priority: item.priority } : {}),
            ...(item.basis !== undefined ? { basis: item.basis } : {}),
          })),
        },
      },
      (body) => mapDraftBatch(recordOf(body)?.batch),
    );
  }

  async dropDraft(
    accessToken: string,
    input: ProjectTodoDraftDropRequest,
  ): Promise<CollabClientOutcome<TodoDraftBatch>> {
    return this.requestEntity(
      `todo-drafts/${encodeURIComponent(input.draftId)}/drop`,
      { method: 'POST', accessToken },
      (body) => mapDraftBatch(recordOf(body)?.batch),
    );
  }

  /**
   * 整批确认成单 / 整批丢弃。失败经 `failureFromResponse` 带出 `serverCode`——409 有四种来路
   * （`requirement_not_claimed` / `draft_source_deleted` / `draft_source_not_found` /
   * `draft_batch_closed`），要用户做的事各不相同，⛔ 不塌缩成无码 `conflict`。
   */
  async resolveDraftBatch(
    accessToken: string,
    input: ProjectTodoDraftResolveRequest,
  ): Promise<CollabClientOutcome<DraftResolveView>> {
    return this.requestEntity(
      `todo-draft-batches/${encodeURIComponent(input.batchId)}/resolve`,
      { method: 'POST', accessToken, jsonBody: { decision: input.decision } },
      (body) => {
        const record = recordOf(body);
        const batch = mapDraftBatch(record?.batch);
        const todos = mapArray(record?.todos, mapTodo);
        return batch && todos ? { batch, todos } : null;
      },
    );
  }

  /* ------------------------------- 文件 ------------------------------- */

  async listFiles(
    accessToken: string,
    input: { readonly projectId: string; readonly kind?: ProjectFileKind | undefined },
  ): Promise<CollabClientOutcome<readonly ProjectFile[]>> {
    return this.requestEntity(
      `projects/${encodeURIComponent(input.projectId)}/files`,
      { method: 'GET', accessToken, query: { kind: input.kind } },
      (body) => mapArray(recordOf(body)?.files, mapProjectFile),
    );
  }

  /**
   * 上传：打开只读文件句柄后以 Node stream → Web stream 裸字节直发；任何路径都不整读。
   * 本地文件不可读/不是普通文件 → invalidRequest（调用侧问题，不当网络瞬时）。
   *
   * 临时件另有**项目级总量配额**：触顶时服务端回 409 + 两个数，这里读出来归
   * `quotaExceeded`（形态照待办 PATCH 的 `readConflictVersion` 先例）。
   * 认不出那个体就退回通用 `conflict`——⛔ 不拿状态码当语义。
   */
  async uploadFile(
    accessToken: string,
    input: {
      readonly projectId: string;
      readonly filePath: string;
      readonly kind: ProjectFileKind;
      /** 存进项目时用的名字；缺省沿用本地文件名（人点上传的那条路不改名）。 */
      readonly filename?: string;
      /**
       * 来源声明（缺省 ＝ 成员手工上传）。助手工具面恒填 `'assistant'`——
       * 服务端分辨不出是谁按的键，这里如实声明，由服务端落进 `files.source`。
       */
      readonly source?: 'manual' | 'assistant';
      readonly signal?: AbortSignal;
      readonly onProgress?: (uploadedBytes: number, totalBytes: number) => void;
    },
  ): Promise<CollabClientOutcome<ProjectFile>> {
    let handle: Awaited<ReturnType<typeof open>> | undefined;
    try {
      handle = await open(input.filePath, 'r');
      const stats = await handle.stat();
      if (!stats.isFile()) return { ok: false, code: 'invalidRequest' };
      if (stats.size > PROJECT_FILE_MAX_BYTES) return { ok: false, code: 'tooLarge' };
      if (stats.size <= 0) return { ok: false, code: 'invalidRequest' };
      const nodeStream = handle.createReadStream({ autoClose: false });
      const streamBody = progressReadableStream(nodeStream, stats.size, input.onProgress);
      try {
        return await this.requestEntity(
          `projects/${encodeURIComponent(input.projectId)}/files`,
          {
            method: 'POST',
            accessToken,
            query: {
              filename: input.filename ?? basename(input.filePath),
              kind: input.kind,
              ...(input.source ? { source: input.source } : {}),
            },
            streamBody,
            contentLength: stats.size,
            contentType: projectDocumentMimeType(input.filename ?? basename(input.filePath)),
            ...(input.signal ? { signal: input.signal } : {}),
            timeoutMs: this.uploadTimeoutMs,
          },
          (body) => mapProjectFile(recordOf(body)?.file),
          { readTempQuota: true },
        );
      } finally {
        nodeStream.destroy();
      }
    } catch {
      return { ok: false, code: 'invalidRequest' };
    } finally {
      await handle?.close().catch(() => undefined);
    }
  }

  /**
   * 下载：字节流写到目标目录（O_EXCL 原子占位、同名回避、调用侧独立封顶），
   * 只回落盘绝对路径。本地写失败 → writeFailed（尽力清掉半成品）。
   */
  async downloadFile(
    accessToken: string,
    input: {
      readonly fileId: string;
      readonly targetDirectory: string;
      readonly maxBytes?: number;
    },
  ): Promise<CollabClientOutcome<{ readonly savedPath: string }>> {
    const response = await this.send(`files/${encodeURIComponent(input.fileId)}`, {
      method: 'GET',
      accessToken,
    });
    if (response === null) return { ok: false, code: 'transient' };
    if (response.status < 200 || response.status >= 300 || !response.body) {
      return failureFromResponse(response);
    }
    const downloadLimit = Math.min(
      input.maxBytes ?? PROJECT_FILE_MAX_BYTES,
      PROJECT_FILE_MAX_BYTES,
    );
    const declaredLength = response.headers.get('content-length');
    if (declaredLength !== null) {
      const declared = Number(declaredLength);
      if (!Number.isSafeInteger(declared) || declared < 0 || declared > downloadLimit) {
        await drainBody(response);
        return { ok: false, code: declared > downloadLimit ? 'tooLarge' : 'transient' };
      }
    }
    const filename = safeDownloadFilename(
      response.headers.get('content-disposition'),
      input.fileId,
    );
    let reserved: { readonly path: string; readonly handle: Awaited<ReturnType<typeof open>> };
    try {
      reserved = await reserveTargetFile(input.targetDirectory, filename);
    } catch {
      await drainBody(response);
      return { ok: false, code: 'writeFailed' };
    }
    const reader = response.body.getReader();
    let timedOut = false;
    const deadline = setTimeout(() => {
      timedOut = true;
      void reader.cancel().catch(() => undefined);
    }, this.downloadBodyTimeoutMs);
    (deadline as { unref?: () => void }).unref?.();
    let written = 0;
    try {
      for (;;) {
        const chunk = await reader.read();
        if (chunk.done) break;
        written += chunk.value.byteLength;
        // 超过协议上界的响应当不可信：停写、清半成品，归 transient（服务端形态异常）。
        if (written > downloadLimit) {
          await abandonDownload(reserved.handle, reserved.path);
          return { ok: false, code: 'transient' };
        }
        await reserved.handle.write(chunk.value);
      }
      if (timedOut) {
        await abandonDownload(reserved.handle, reserved.path);
        return { ok: false, code: 'transient' };
      }
      if (declaredLength !== null && written !== Number(declaredLength)) {
        await abandonDownload(reserved.handle, reserved.path);
        return { ok: false, code: 'transient' };
      }
      await reserved.handle.close();
      return { ok: true, value: { savedPath: reserved.path } };
    } catch {
      await abandonDownload(reserved.handle, reserved.path);
      return { ok: false, code: 'writeFailed' };
    } finally {
      clearTimeout(deadline);
      void reader.cancel().catch(() => undefined);
    }
  }

  /**
   * 取字节到内存：**预览用**，⛔ 不落盘。
   *
   * 与上面的 `downloadFile` 分开而不是给它加一个「别落盘」开关，是因为两者的取舍相反：
   *  · `downloadFile` 是用户要的那份**副本**，落到下载目录、要安全文件名、要 O_EXCL 占位；
   *  · 本方法只为了在 Main 里解析出一段文本给预览看，产出一个本机副本是**净损失**
   *    （多一份未加密的项目材料留在磁盘上，还要负责删）。
   *
   * `maxBytes` 是**必填**的调用侧预算（预览上限远小于 1 GiB 的协议上界）：
   *  · 声明长度超预算 ⇒ `tooLarge`，体一字不读；
   *  · 没有声明长度但体超预算 ⇒ 停读并归 `transient`（服务端形态异常），⛔ 不回半截字节；
   *  · 声明长度与实收不符 ⇒ `transient`（截断的字节喂进解析器只会得到看似成功的胡话）。
   */
  async downloadFileBytes(
    accessToken: string,
    input: { readonly fileId: string; readonly maxBytes: number },
  ): Promise<CollabClientOutcome<{ readonly bytes: Uint8Array }>> {
    const response = await this.send(`files/${encodeURIComponent(input.fileId)}`, {
      method: 'GET',
      accessToken,
    });
    if (response === null) return { ok: false, code: 'transient' };
    if (response.status < 200 || response.status >= 300 || !response.body) {
      return failureFromResponse(response);
    }
    const limit = Math.min(input.maxBytes, PROJECT_FILE_MAX_BYTES);
    const declaredLength = response.headers.get('content-length');
    if (declaredLength !== null) {
      const declared = Number(declaredLength);
      if (!Number.isSafeInteger(declared) || declared < 0 || declared > limit) {
        await drainBody(response);
        return { ok: false, code: declared > limit ? 'tooLarge' : 'transient' };
      }
    }
    const reader = response.body.getReader();
    let timedOut = false;
    const deadline = setTimeout(() => {
      timedOut = true;
      void reader.cancel().catch(() => undefined);
    }, this.downloadBodyTimeoutMs);
    (deadline as { unref?: () => void }).unref?.();
    const chunks: Uint8Array[] = [];
    let read = 0;
    try {
      for (;;) {
        const chunk = await reader.read();
        if (chunk.done) break;
        read += chunk.value.byteLength;
        if (read > limit) return { ok: false, code: 'transient' };
        chunks.push(chunk.value);
      }
      if (timedOut) return { ok: false, code: 'transient' };
      if (declaredLength !== null && read !== Number(declaredLength)) {
        return { ok: false, code: 'transient' };
      }
      const bytes = new Uint8Array(read);
      let offset = 0;
      for (const chunk of chunks) {
        bytes.set(chunk, offset);
        offset += chunk.byteLength;
      }
      return { ok: true, value: { bytes } };
    } catch {
      return { ok: false, code: 'transient' };
    } finally {
      clearTimeout(deadline);
      void reader.cancel().catch(() => undefined);
    }
  }

  async promoteFile(
    accessToken: string,
    input: { readonly fileId: string },
  ): Promise<CollabClientOutcome<ProjectFile>> {
    return this.requestEntity(
      `files/${encodeURIComponent(input.fileId)}/promote`,
      { method: 'POST', accessToken },
      (body) => mapProjectFile(recordOf(body)?.file),
    );
  }

  async deleteFile(
    accessToken: string,
    input: { readonly fileId: string },
  ): Promise<CollabClientOutcome<true>> {
    return this.requestVoid(`files/${encodeURIComponent(input.fileId)}`, {
      method: 'DELETE',
      accessToken,
    });
  }

  /* --------------------------- 资产版本（不可变引用）--------------------------- */

  /**
   * 资产目录：只回未删除的血统，每条带当前版本。
   *
   * ⛔ 上面五条文件方法一个字都没改——新版本的字节仍走 `uploadFile`，本组方法只负责
   * 「把那一行登记成一个版本」与「按版本 id 解析冻结引用」。旧上传的回归因此是结构性的。
   */
  async listProjectAssets(
    accessToken: string,
    input: { readonly projectId: string },
  ): Promise<CollabClientOutcome<readonly ProjectAssetCatalogueEntry[]>> {
    return this.requestEntity(
      `projects/${encodeURIComponent(input.projectId)}/assets`,
      { method: 'GET', accessToken },
      (body) => mapArray(recordOf(body)?.assets, mapProjectAssetCatalogueEntry),
    );
  }

  /**
   * 一条血统的完整版本链（新版在前，服务端定序）。
   *
   * ⚠️ 血统被软删之后这条路**照旧返回全部版本**——它是「已冻结的引用仍读得到它引用的
   * 那一版」的读侧载体。血统的 `deletedAt` 非空即明确反馈，不是空结果。
   */
  async listAssetVersions(
    accessToken: string,
    input: { readonly projectId: string; readonly assetId: string },
  ): Promise<CollabClientOutcome<ProjectAssetVersionChain>> {
    return this.requestEntity(
      `projects/${encodeURIComponent(input.projectId)}/assets/` +
        `${encodeURIComponent(input.assetId)}/versions`,
      { method: 'GET', accessToken },
      mapProjectAssetVersionChain,
    );
  }

  /**
   * ⭐ 解析一个**冻结引用**：入参是版本 id，不是文件 id、不是资产 id。
   *
   * 报告/测试轮次附件存下来的就是这个 id，所以这条路不带 project 段——它读到的永远是
   * 那一版，与「当前版本」无关。⛔ 用资产 id 调它拿不到东西是**对的**（404），不要在
   * 调用侧「顺手回落到当前版本」：那等于把冻结悄悄取消掉。
   */
  async getAssetVersion(
    accessToken: string,
    input: { readonly versionId: string },
  ): Promise<CollabClientOutcome<ProjectAssetVersionResolution>> {
    return this.requestEntity(
      `asset-versions/${encodeURIComponent(input.versionId)}`,
      { method: 'GET', accessToken },
      mapProjectAssetVersionResolution,
    );
  }

  /**
   * 把一行既有上传登记成一个版本。`assetId` 省略 ＝ 新建血统（这次上传成为第 1 版）。
   *
   * 失败码里有两个业务码值得调用侧分辨（经失败信封的 `serverCode` 透传）：
   * `file_already_versioned`（这次上传已经是某个版本）与 `asset_deleted`（血统已删，
   * 不能再追加）。⛔ 两者都不是「重试就会好」的瞬时故障。
   */
  async registerAssetVersion(
    accessToken: string,
    input: {
      readonly projectId: string;
      readonly fileId: string;
      readonly assetId?: string | undefined;
    },
  ): Promise<CollabClientOutcome<ProjectAssetVersionResolution>> {
    return this.requestEntity(
      `projects/${encodeURIComponent(input.projectId)}/asset-versions`,
      {
        method: 'POST',
        accessToken,
        jsonBody: {
          file_id: input.fileId,
          ...(input.assetId ? { asset_id: input.assetId } : {}),
        },
      },
      mapProjectAssetVersionResolution,
      // 409 `file_already_versioned` 时另读 `version_id`：那是续传「只补登记」这一段
      // 能收敛的唯一凭据（形态照 `readTempQuota` 先例）。
      { readVersionedConflict: true },
    );
  }

  /** 资产软删（本人或 owner；服务端保留整条版本链）。 */
  async deleteAsset(
    accessToken: string,
    input: { readonly projectId: string; readonly assetId: string },
  ): Promise<CollabClientOutcome<true>> {
    return this.requestVoid(
      `projects/${encodeURIComponent(input.projectId)}/assets/` +
        `${encodeURIComponent(input.assetId)}`,
      { method: 'DELETE', accessToken },
    );
  }

  /* ------------------ 回收站与历史版本恢复（RPT-08 通道侧）------------------ */

  /**
   * 资产回收站：只列已软删的血统，最近删的在前（服务端定序）。
   *
   * 服务端的目录与回收站是**同一句存活谓词的正反两面**，出参形状逐字相同，所以投影复用
   * `mapProjectAssetCatalogueEntry`。⛔ 不在这里另断言 `deletedAt` 非空：读侧不得严于写侧，
   * 多一道断言只会让一次合法的服务端变更把整个回收站变成解析失败。
   * ⚠️ 路径是 `asset-trash`，**不是** `assets/trash`（服务端文件头写了为什么）。
   */
  async listDeletedProjectAssets(
    accessToken: string,
    input: { readonly projectId: string },
  ): Promise<CollabClientOutcome<readonly ProjectAssetCatalogueEntry[]>> {
    return this.requestEntity(
      `projects/${encodeURIComponent(input.projectId)}/asset-trash`,
      { method: 'GET', accessToken },
      (body) => mapArray(recordOf(body)?.assets, mapProjectAssetCatalogueEntry),
    );
  }

  /**
   * 回收站恢复（`deleted_at := NULL`）。未删资产恢复一次仍是成功（服务端幂等）。
   *
   * 出参是恢复后的**目录行**。权限（本人或拥有者，管理者不在此列）只在服务端判：
   * 403 `forbidden` / 404 `asset_not_found` 经 `failureFromResponse` 带出业务码。
   */
  async restoreAsset(
    accessToken: string,
    input: { readonly projectId: string; readonly assetId: string },
  ): Promise<CollabClientOutcome<ProjectAssetCatalogueEntry>> {
    return this.requestEntity(
      `projects/${encodeURIComponent(input.projectId)}/assets/` +
        `${encodeURIComponent(input.assetId)}/restore`,
      { method: 'POST', accessToken },
      (body) => mapProjectAssetCatalogueEntry(recordOf(body)?.asset),
    );
  }

  /**
   * 把一个历史版本恢复成链上**新的一版**（201 `{asset, version}`，与登记新版本同形）。
   *
   * ⭐ 这条路的 409 有四种来路，要用户做的事各不相同：血统已在回收站（`asset_deleted`）、
   *    这一版字节已删、复制出的字节与冻结指纹不符、项目配额已满。所以 409 **一律读业务码**；
   *    配额那一种另把上限与已用量读出来（形态照临时件上传）。⛔ 塌缩成无码的 `conflict`
   *    就等于告诉用户「数据已被他人更新，请刷新后重试」——四种里没有一种是重试能好的。
   * 404 `file_not_found`（盘上字节缺失）与 `asset_version_not_found` 走通用分档并带业务码。
   */
  async restoreAssetVersion(
    accessToken: string,
    input: { readonly projectId: string; readonly versionId: string },
  ): Promise<CollabClientOutcome<ProjectAssetVersionResolution>> {
    return this.requestEntity(
      `projects/${encodeURIComponent(input.projectId)}/asset-versions/` +
        `${encodeURIComponent(input.versionId)}/restore`,
      { method: 'POST', accessToken },
      mapProjectAssetVersionResolution,
      { readCodedConflict: true },
    );
  }

  /* ------------------------------ 请求底座 ------------------------------ */

  /**
   * JSON 响应端点的统一流程：发请求 → 2xx 读有界体并投影校验（失败即 transient）
   * → 非 2xx 按状态分档；`readConflictVersion` 时 409 另读 `current_version`。
   */
  private async requestEntity<T>(
    path: string,
    init: SendInit,
    project: (body: unknown) => T | null,
    options?: {
      readonly readConflictVersion?: boolean;
      readonly readTempQuota?: boolean;
      readonly readVersionedConflict?: boolean;
      readonly readCodedConflict?: boolean;
    },
  ): Promise<CollabClientOutcome<T>> {
    const response = await this.send(path, init);
    if (response === null) return { ok: false, code: 'transient' };
    if (response.status >= 200 && response.status < 300) {
      const body = await readBoundedJson(response);
      const value = body === undefined ? null : project(body);
      return value === null ? { ok: false, code: 'transient' } : { ok: true, value };
    }
    if (response.status === 409 && options?.readConflictVersion) {
      const body = await readBoundedJson(response);
      const conflict = conflictWireSchema.safeParse(body);
      if (conflict.success) {
        return { ok: false, code: 'conflict', currentVersion: conflict.data.current_version };
      }
      // ⚠️ 这几条写路径的 409 不只版本冲突一种（TST-02 起：新测试模式挡旧工作单提交
      //    `requirement_test_mode_required`、在测需求挡旧验收 / 取消 `test_round_in_progress`）。
      //    读不到版本时照常透传业务码（与 `collabPlanningClient` 同一支），⛔ 塌缩成无码 conflict
      //    就只剩「已被他人更新」那句，而这两种都不是刷新重试能好的。
      const serverCode = readServerErrorCode(body);
      return serverCode === undefined
        ? { ok: false, code: 'conflict' }
        : { ok: false, code: 'conflict', serverCode };
    }
    if (response.status === 409 && options?.readTempQuota) {
      const body = await readBoundedJson(response);
      const quota = quotaWireSchema.safeParse(body);
      return quota.success
        ? {
            ok: false,
            code: 'quotaExceeded',
            quota: {
              limitBytes: quota.data.quota_limit_bytes,
              usedBytes: quota.data.quota_used_bytes,
            },
          }
        : { ok: false, code: 'conflict' };
    }
    if (response.status === 409 && options?.readVersionedConflict) {
      // 体只读一次：业务码与 version_id 都从这一份里取（⛔ 不二次读流）。
      const body = await readBoundedJson(response);
      const versioned = assetVersionConflictWireSchema.safeParse(body);
      if (versioned.success) {
        return {
          ok: false,
          code: 'conflict',
          serverCode: versioned.data.error,
          existingVersionId: versioned.data.version_id,
        };
      }
      // 另一种 409（如 asset_deleted）或形状不认：照常透传业务码，**不附** version_id。
      const serverCode = readServerErrorCode(body);
      return serverCode === undefined
        ? { ok: false, code: 'conflict' }
        : { ok: false, code: 'conflict', serverCode };
    }
    if (response.status === 409 && options?.readCodedConflict) {
      // 体只读一次：业务码与配额数都从这一份里取（⛔ 不二次读流）。
      const body = await readBoundedJson(response);
      const serverCode = readServerErrorCode(body);
      if (serverCode === 'project_file_quota_exceeded') {
        const quota = quotaWireSchema.safeParse(body);
        // 判据是业务码而不是「体里恰好有两个数」；数读不出来也仍是配额档，⛔ 不编数。
        return quota.success
          ? {
              ok: false,
              code: 'quotaExceeded',
              serverCode,
              quota: {
                limitBytes: quota.data.quota_limit_bytes,
                usedBytes: quota.data.quota_used_bytes,
              },
            }
          : { ok: false, code: 'quotaExceeded', serverCode };
      }
      return serverCode === undefined
        ? { ok: false, code: 'conflict' }
        : { ok: false, code: 'conflict', serverCode };
    }
    return failureFromResponse(response);
  }

  /** 无实体响应端点（读游标/删除）：任何 2xx 即成功，体一律丢弃。 */
  private async requestVoid(path: string, init: SendInit): Promise<CollabClientOutcome<true>> {
    const response = await this.send(path, init);
    if (response === null) return { ok: false, code: 'transient' };
    if (response.status >= 200 && response.status < 300) {
      await drainBody(response);
      return { ok: true, value: true };
    }
    return failureFromResponse(response);
  }

  /** 单次请求；网络不可达/超时/连接层错误返回 null（＝瞬时）。 */
  private async send(path: string, init: SendInit): Promise<Response | null> {
    const url = new URL(`${API_PREFIX}${path}`, this.baseUrl);
    for (const [key, value] of Object.entries(init.query ?? {})) {
      if (value !== undefined) url.searchParams.set(key, String(value));
    }
    const headers: Record<string, string> = { authorization: `Bearer ${init.accessToken}` };
    let body: string | ReadableStream<Uint8Array> | undefined;
    if (init.streamBody !== undefined) {
      // 裸字节体（⛔ multipart）：服务端按流首字节魔数判型，boundary 前缀必 415。
      headers['content-type'] = init.contentType ?? 'application/octet-stream';
      if (init.contentLength === undefined) throw new Error('stream body requires content length');
      headers['content-length'] = String(init.contentLength);
      body = init.streamBody;
    } else if (init.jsonBody !== undefined) {
      headers['content-type'] = 'application/json';
      body = JSON.stringify(init.jsonBody);
    }
    const controller = new AbortController();
    const abort = (): void => controller.abort(init.signal?.reason);
    if (init.signal?.aborted) abort();
    else init.signal?.addEventListener('abort', abort, { once: true });
    const timer = setTimeout(() => controller.abort(), init.timeoutMs ?? this.timeoutMs);
    try {
      const requestInit = streamingFetchInit({
        method: init.method,
        headers,
        ...(body === undefined ? {} : { body }),
        signal: controller.signal,
      });
      return await this.fetchImpl(url, requestInit);
    } catch {
      return null;
    } finally {
      clearTimeout(timer);
      init.signal?.removeEventListener('abort', abort);
    }
  }
}

/** Node fetch 对流式请求体要求 `duplex: 'half'`；DOM 类型尚未公开该窄字段。 */
function streamingFetchInit(init: RequestInit): RequestInit {
  if (!(init.body instanceof ReadableStream)) return init;
  return { ...init, duplex: 'half' } as RequestInit & { readonly duplex: 'half' };
}

/** 文件流的有界进度投影；取消 Web stream 会向下游销毁 Node stream。 */
function progressReadableStream(
  nodeStream: ReadStream,
  totalBytes: number,
  onProgress?: (uploadedBytes: number, totalBytes: number) => void,
): ReadableStream<Uint8Array> {
  const source = Readable.toWeb(nodeStream) as ReadableStream<Uint8Array>;
  const reader = source.getReader();
  let uploadedBytes = 0;
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      const chunk = await reader.read();
      if (chunk.done) {
        controller.close();
        return;
      }
      uploadedBytes += chunk.value.byteLength;
      onProgress?.(uploadedBytes, totalBytes);
      controller.enqueue(chunk.value);
    },
    async cancel(reason) {
      await reader.cancel(reason).catch(() => undefined);
      nodeStream.destroy();
    },
  });
}

/* ------------------------------ 状态分档 ------------------------------ */

/** 状态码 → 失败分档（**判定一字不改**；serverCode 由 `statusToFailure` 另附）。 */
function statusToFailureCode(status: number): CollabClientFailureCode {
  if (status === 413) return 'tooLarge';
  if (status === 429) return 'rateLimited';
  if (status === 409) return 'conflict';
  if (status === 401) return 'credentialRejected';
  if (status === 403) return 'forbidden';
  if (status >= 500) return 'transient';
  if (status >= 400) return 'rejected';
  // 其它 2xx/3xx 非预期形态：当作瞬时不确定，不误报为成功。
  return 'transient';
}

/**
 * 状态分档 + 可选服务端业务码。`serverCode` 只在调用方读到（仅 4xx）时附带——
 * 通用码 `code` 与之正交，不因它变化。
 */
function statusToFailure(status: number, serverCode?: string): CollabClientFailure {
  const code = statusToFailureCode(status);
  return serverCode === undefined ? { ok: false, code } : { ok: false, code, serverCode };
}

/**
 * 失败路径统一收尾：读一次**有界**响应体（沿用 `readBoundedJson` 的上限），
 * **仅 4xx** 时从 `{ "error": "<code>" }` 挑出服务端业务码挂进信封；5xx / 非 JSON /
 * 无 `error` / 不合正则一律不带 serverCode。适用于所有端点的通用失败分档。
 */
export async function failureFromResponse(response: Response): Promise<CollabClientFailure> {
  return failureFromBody(response.status, await readBoundedJson(response));
}

/**
 * 同一张分档表的「体已读出」版本：调用方要从同一份失败体里再挑附加字段（如整需求提交的
 * `unfinished_task_ids`）时用它——体只读一次，⛔ 不为了挑附加字段在别的文件里抄一份状态分档。
 */
export function failureFromBody(status: number, body: unknown): CollabClientFailure {
  const serverCode = status >= 400 && status < 500 ? readServerErrorCode(body) : undefined;
  return statusToFailure(status, serverCode);
}

/* ------------------------------ 响应体读取 ------------------------------ */

/** 丢弃响应体，避免占用连接/内存；任何异常忽略（只影响资源回收，不影响判定）。 */
async function drainBody(response: Response): Promise<void> {
  try {
    await response.body?.cancel();
  } catch {
    /* ignore */
  }
}

/**
 * 读有界 JSON 体；超界/不可解析返回 undefined（上层归 transient）。
 *
 * ⭐ 与 `failureFromResponse` 一起导出，供同目录里**按域分文件**的客户端复用
 * （`collabPlanningClient`）。⛔ 别在那些文件里各抄一份状态分档——分档表一旦两处，
 * 「409 算什么」这类判定就会各自演化。
 */
export async function readBoundedJson(response: Response): Promise<unknown | undefined> {
  let text: string;
  try {
    text = await response.text();
  } catch {
    return undefined;
  }
  if (text.length > MAX_RESPONSE_BODY_CHARS) return undefined;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

/* ------------------------------ 下载落盘 ------------------------------ */

/**
 * 从 `content-disposition` 提取安全的落盘文件名：剥路径分隔符与控制字符、
 * 拒空名/点名/超长名；取不到就用服务端文件 id（uuid，天然安全）。
 */
function safeDownloadFilename(contentDisposition: string | null, fallback: string): string {
  let name: string | null = null;
  if (contentDisposition) {
    const star = /filename\*=UTF-8''([^;]+)/iu.exec(contentDisposition);
    if (star?.[1]) {
      try {
        name = decodeURIComponent(star[1]);
      } catch {
        name = null;
      }
    }
    if (name === null) {
      const plain = /filename="?([^";]+)"?/iu.exec(contentDisposition);
      if (plain?.[1]) name = plain[1];
    }
  }
  const cleaned = (name ?? '').replace(/[\\/:*?"<>|\u0000-\u001f]/gu, '_').trim();
  if (!cleaned || cleaned === '.' || cleaned === '..' || cleaned.length > 200) return fallback;
  return cleaned;
}

/** `wx`（O_EXCL）原子占位目标文件；同名时回避为 `名 (n).扩展`，耗尽即抛。 */
async function reserveTargetFile(
  directory: string,
  filename: string,
): Promise<{ readonly path: string; readonly handle: Awaited<ReturnType<typeof open>> }> {
  await mkdir(directory, { recursive: true });
  const dot = filename.lastIndexOf('.');
  const stem = dot > 0 ? filename.slice(0, dot) : filename;
  const extension = dot > 0 ? filename.slice(dot) : '';
  for (let attempt = 0; attempt < MAX_FILENAME_ATTEMPTS; attempt += 1) {
    const candidate = attempt === 0 ? filename : `${stem} (${attempt})${extension}`;
    const path = join(directory, candidate);
    try {
      const handle = await open(path, 'wx');
      return { path, handle };
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== 'EEXIST') throw error;
    }
  }
  throw new Error('download filename exhausted');
}

/** 尽力关句柄并删半成品；失败静默（半成品残留不如中断本身重要）。 */
async function abandonDownload(
  handle: Awaited<ReturnType<typeof open>>,
  path: string,
): Promise<void> {
  try {
    await handle.close();
  } catch {
    /* ignore */
  }
  try {
    await rm(path, { force: true });
  } catch {
    /* ignore */
  }
}
