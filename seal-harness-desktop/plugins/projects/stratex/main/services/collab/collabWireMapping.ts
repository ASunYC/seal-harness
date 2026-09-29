import { z } from 'zod';

import {
  ChatMessageSchema,
  FeedCommentSchema,
  FeedEntrySchema,
  ProjectConventionsSchema,
  ProjectDetailSchema,
  ProjectFileSchema,
  InboundProjectRoleSchema,
  ProjectCollabServerCodeSchema,
  ProjectOpenInvitationSchema,
  ProjectSummarySchema,
  PROJECT_OPEN_INVITATION_MAX_USES,
  TodoAcceptanceItemSchema,
  TodoCompletionRecordSchema,
  TodoDraftBatchSchema,
  TodoSchema,
  type ChatMessage,
  type FeedComment,
  type FeedEntry,
  type ProjectConventions,
  type ProjectDetail,
  type ProjectFile,
  type ProjectOpenInvitation,
  type ProjectSummary,
  type Todo,
  type TodoAcceptanceItem,
  type TodoCompletionRecord,
  type TodoDraftBatch,
} from '../../../shared/protocol/project-collab.js';
import {
  ProjectAssetCatalogueEntrySchema,
  ProjectAssetVersionChainSchema,
  ProjectAssetVersionResolutionSchema,
  ProjectAssetVersionSchema,
  ProjectFileAssetSchema,
  type ProjectAssetCatalogueEntry,
  type ProjectAssetVersion,
  type ProjectAssetVersionChain,
  type ProjectAssetVersionResolution,
  type ProjectFileAsset,
} from '../../../shared/protocol/project-collab-assets.js';

/**
 * 项目组协作服务的线格式（snake_case）→ 客户端投影（camelCase）映射。
 *
 * 纪律照 `feedbackUploader` 的回看映射：**逐字段挑选**已知项（服务端后续新增
 * 字段进不了投影），映射后再过一遍共享协议 schema（strictObject + enum/上界
 * 封顶）——两道门任一不过即回 null，上层当不可信响应（transient）处理。
 * 数组不做部分采信：任何一项不可信即整体拒绝。
 */

export const invitationWireSchema = z.object({
  code: z.string().min(1).max(128),
  expires_at: z.string().max(64),
  // 迁移 0016：签发响应新增这三个键（服务端恒回）。id → invitationId 供列表/撤销引用；
  // kind/max_uses 供渲染层区分「一次性 / 开放」与人数上限（不限为 null）。
  id: z.string().uuid(),
  kind: z.enum(['single', 'open']),
  max_uses: z.number().int().positive().max(PROJECT_OPEN_INVITATION_MAX_USES).nullable(),
});

/** 撤销开放邀请的响应体：`{"project_id": <uuid>, "id": <uuid>}`。 */
export const revokeInvitationWireSchema = z.object({
  project_id: z.string().uuid(),
  id: z.string().uuid(),
});

/**
 * 一条开放邀请（列表投影）snake_case → camelCase 映射，再过共享协议 schema。
 * ⛔ 服务端不回 code（库里也没有），映射里也不挑它。
 */
export function mapOpenInvitation(raw: unknown): ProjectOpenInvitation | null {
  const record = recordOf(raw);
  if (!record) return null;
  const view = ProjectOpenInvitationSchema.safeParse({
    id: record.id,
    role: record.role,
    expiresAt: record.expires_at,
    maxUses: record.max_uses ?? null,
    usesCount: record.uses_count,
    createdBySubject: record.created_by_subject,
    createdByDisplayName: record.created_by_display_name ?? '',
    createdAt: record.created_at,
  });
  return view.success ? view.data : null;
}

export const redeemWireSchema = z.object({
  project_id: z.string().uuid(),
  // 入站角色走容错档：未知角色降级为观察者，不让一次本该成功的兑换因为一个新角色而
  // 变成「兑换失败」。见协议里 InboundProjectRoleSchema 的说明。
  role: InboundProjectRoleSchema,
});

/** 待办 PATCH 409 的冲突体：`{"error":"version_conflict","current_version":n}`。 */
export const conflictWireSchema = z.object({
  current_version: z.number().int().positive(),
});

/**
 * 删除响应体（单条 `DELETE /todos/{id}` 与批量 `POST .../todos/delete-batch` 同形）：
 * `{"deleted_ids":[<uuid>...],"count":<int>}`——整棵子树按 `(created_at,id)` 升序。
 *
 * ⛔ `deleted_ids` 不设数组长度上界：级联总数不受根上界约束，封顶会把一次删大树的
 * 正常响应误判为不可信。响应体总大小另由 `readBoundedJson` 兜底。
 */
export const todoDeleteWireSchema = z.object({
  deleted_ids: z.array(z.string().uuid()),
  count: z.number().int().nonnegative(),
});

/**
 * 临时文件上传 409 的配额体：
 * `{"error":"temp_quota_exceeded","quota_limit_bytes":n,"quota_used_bytes":m}`。
 *
 * ⚠️ 判据是 **error 码**而不是「409 就当配额」：409 在这条通道上目前只有配额一种
 * 来路，但把状态码当语义会在服务端哪天多一种 409 时静默认错——那时用户会看到
 * 一句「已达容量上限（上限 2 GB，已用 0 B）」的胡话。认不出就退回通用 `conflict`。
 */
export const quotaWireSchema = z.object({
  error: z.enum(['temp_quota_exceeded', 'project_file_quota_exceeded']),
  quota_limit_bytes: z.number().int().nonnegative(),
  quota_used_bytes: z.number().int().nonnegative(),
});

/**
 * 「这次上传已经是某个版本了」的 409 体：
 * `{"error":"file_already_versioned","version_id":"<uuid>"}`（服务端
 * `asset_versions.ensure_upload_not_already_versioned` 的 `extra`）。
 *
 * ⭐ 它是**上传失败恢复**能收敛的全部理由：补登记那一段重试一次时，若上一次其实
 * 已经落库（响应丢在路上），服务端会以这一条回绝，而体里的 `version_id` 正是那一版。
 * 读出来就能把这次重试判成成功，而不是让用户以为失败、再传一遍字节。
 *
 * ⚠️ 判据是 **error 码**而不是「409 就读 version_id」：同一个通道上 `asset_deleted`
 * 也是 409，把它一起采信会把一次真实失败说成收敛成功。
 */
export const assetVersionConflictWireSchema = z.object({
  error: z.literal('file_already_versioned'),
  version_id: z.string().uuid(),
});

export function recordOf(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/**
 * 从失败响应体里挑出**服务端业务码**（`{ "error": "<code>", ... }` 里的那个 `<code>`）。
 *
 * 非对象 / 无 `error` / 不合形状（含大写、非 snake_case、空串、超长）→ `undefined`（不带 serverCode）。
 * ⛔ 只挑 `error` 这一个短标识符：`detail` 文案、请求回显、任何用户内容一律不碰
 *    （闭集与拒收规则由共享层 `ProjectCollabServerCodeSchema` 唯一收口，两端不各造一份）。
 */
export function readServerErrorCode(body: unknown): string | undefined {
  const record = recordOf(body);
  if (!record) return undefined;
  const parsed = ProjectCollabServerCodeSchema.safeParse(record.error);
  return parsed.success ? parsed.data : undefined;
}

/** 逐项映射数组；任何一项不可信即整体拒绝（不信任的响应不做部分采信）。 */
export function mapArray<T>(
  raw: unknown,
  mapItem: (item: unknown) => T | null,
): readonly T[] | null {
  if (!Array.isArray(raw)) return null;
  const mapped: T[] = [];
  for (const item of raw) {
    const value = mapItem(item);
    if (value === null) return null;
    mapped.push(value);
  }
  return mapped;
}

function mapMemberPreviewInput(raw: unknown): unknown {
  const record = recordOf(raw);
  if (!record) return null;
  return { subject: record.subject, displayName: record.display_name };
}

export function mapProjectSummary(raw: unknown): ProjectSummary | null {
  const record = recordOf(raw);
  if (!record) return null;
  const memberPreview = Array.isArray(record.member_preview)
    ? record.member_preview.map(mapMemberPreviewInput)
    : [];
  const view = ProjectSummarySchema.safeParse({
    id: record.id,
    name: record.name,
    // 卡片信息面：老服务端没有这两个键，缺席按「没写说明 / 没有预览」投影——
    // 卡片少两行，其余照常（与 todo 那几组历史行兜底同款）。
    // ⚠️ 预览的条数上界由 schema 的 .max() 守：服务端哪天回了全量名册，
    // 这里整体解析失败（不做部分采信），而不是让列表随成员数膨胀。
    summary: record.summary ?? '',
    myRole: record.my_role,
    archivedAt: record.archived_at ?? null,
    memberCount: record.member_count,
    memberPreview,
    unreadCount: record.unread_count,
    lastActivityAt: record.last_activity_at ?? null,
    createdAt: record.created_at,
  });
  return view.success ? view.data : null;
}

function mapProjectMemberInput(raw: unknown): unknown {
  const record = recordOf(raw);
  if (!record) return null;
  return {
    subject: record.subject,
    displayName: record.display_name,
    role: record.role,
    state: record.state,
    joinedAt: record.joined_at ?? null,
  };
}

export function mapProjectDetail(raw: unknown): ProjectDetail | null {
  const record = recordOf(raw);
  if (!record) return null;
  const members = Array.isArray(record.members) ? record.members.map(mapProjectMemberInput) : [];
  const view = ProjectDetailSchema.safeParse({
    id: record.id,
    name: record.name,
    instructionsText: record.instructions_text ?? '',
    myRole: record.my_role,
    archivedAt: record.archived_at ?? null,
    createdAt: record.created_at,
    members,
  });
  return view.success ? view.data : null;
}

/**
 * 项目约定（AI 录入规则）线格式 → 客户端投影（CTX-01）。
 *
 * 老服务端/尚无发布时缺席按缺省投影：`ai_entry_rules` 缺 → 空串，`rule_version` 缺 → 0
 * （未发布），`published_at` 缺 → null。逐字段挑选 + 过一遍 schema，任一不过回 null
 * （上层当不可信响应 → transient）。
 */
export function mapProjectConventions(raw: unknown): ProjectConventions | null {
  const record = recordOf(raw);
  if (!record) return null;
  const view = ProjectConventionsSchema.safeParse({
    aiEntryRules: record.ai_entry_rules ?? '',
    ruleVersion: record.rule_version ?? 0,
    publishedAt: record.published_at ?? null,
  });
  return view.success ? view.data : null;
}

function mapFeedCommentInput(raw: unknown): unknown {
  const record = recordOf(raw);
  if (!record) return null;
  return {
    id: record.id,
    authorSubject: record.author_subject,
    authorDisplayName: record.author_display_name,
    bodyMd: record.body_md,
    // 评论级 @ 提及（服务端迁移 0011）：老服务端/历史行没有这个键，
    // 缺席按「无引用」投影——旧数据照样解析得出来。
    refs: record.refs ?? [],
    createdAt: record.created_at,
  };
}

export function mapFeedComment(raw: unknown): FeedComment | null {
  const view = FeedCommentSchema.safeParse(mapFeedCommentInput(raw));
  return view.success ? view.data : null;
}

export function mapFeedEntry(raw: unknown): FeedEntry | null {
  const record = recordOf(raw);
  if (!record) return null;
  const comments = Array.isArray(record.comments) ? record.comments.map(mapFeedCommentInput) : [];
  const view = FeedEntrySchema.safeParse({
    id: record.id,
    kind: record.kind,
    authorSubject: record.author_subject ?? null,
    authorDisplayName: record.author_display_name ?? null,
    bodyMd: record.body_md ?? '',
    refs: record.refs ?? [],
    comments,
    createdAt: record.created_at,
  });
  return view.success ? view.data : null;
}

export function mapChatMessage(raw: unknown): ChatMessage | null {
  const record = recordOf(raw);
  if (!record) return null;
  const view = ChatMessageSchema.safeParse({
    id: record.id,
    seq: record.seq,
    authorSubject: record.author_subject,
    authorDisplayName: record.author_display_name,
    // 撤回后的消息正文已被服务端置空（可能缺席）——投影为 ''。
    bodyMd: record.body_md ?? '',
    refs: record.refs ?? [],
    revoked: record.revoked,
    createdAt: record.created_at,
  });
  return view.success ? view.data : null;
}

export function mapTodo(raw: unknown): Todo | null {
  const record = recordOf(raw);
  if (!record) return null;
  const view = TodoSchema.safeParse({
    id: record.id,
    // 0015 起业务类型是必读事实；缺失时整条拒绝，绝不再从 parent_id 猜。
    itemKind: record.item_kind,
    // 两级面（0007）：0007 之前的历史行/老服务端没有这三列，缺席按缺省投影
    // （顶层 / 人建 / 协同）——与服务端 serialize_todo 的历史行兜底同口径。
    parentId: record.parent_id ?? null,
    source: record.source ?? 'manual',
    visibility: record.visibility ?? 'shared',
    title: record.title,
    status: record.status,
    // 处理人档位（0010）：老服务端/历史行没有这个键，缺席按 member 投影
    // （＝0010 之前的全部行为）。这就是向后兼容的载体。
    assigneeKind: record.assignee_kind ?? 'member',
    assigneeSubject: record.assignee_subject ?? null,
    assigneeDisplayName: record.assignee_display_name ?? null,
    projectId: record.project_id,
    creatorSubject: record.creator_subject,
    creatorDisplayName: record.creator_display_name,
    priority: record.priority,
    labels: record.labels ?? [],
    startAt: record.start_at ?? null,
    dueAt: record.due_at ?? null,
    description: record.description ?? '',
    // 关联面（G-10）：0006 之前的历史行没有这两列，缺席按「未关联」投影。
    sessionRef: record.session_ref ?? null,
    refs: record.refs ?? [],
    // 工作单面（0009）：老服务端/历史行没有这三个键，缺席按「不是工作单」投影
    // （没写注意事项、零条验收判据）——与 source/visibility 的历史行兜底同款。
    // 这就是向后兼容的载体：旧服务端回来的待办照样解析得出来。
    constraintsText: record.constraints_text ?? '',
    acceptanceTotal: record.acceptance_total ?? 0,
    acceptanceChecked: record.acceptance_checked ?? 0,
    // 进度汇总：老服务端没有这两个键，缺席按 0/0 投影（＝需求行不显示进度），
    // 与工作单面的历史行兜底同款。⛔ 不在这里替服务端算——本地算不出别人看得见
    // 什么，算出来的分母必然与服务端不一致。
    childTotal: record.child_total ?? 0,
    childDone: record.child_done ?? 0,
    // 需求专属子任务统计（CORE-04）：**可选**，只有列表读路径的服务端才回它。
    // ⛔ 这里**不做 `?? 0` 兜底**——缺席（旧服务端 / detail / 写路径不回）要投影成
    //    `undefined`，与服务端明确给的 0（需求下无 task）分得开。带了却是坏形状
    //    （非数字 / 负 / 非整）由 schema 判整条 null（mapArray 一条坏全批坏）。
    requirementTaskTotal: record.requirement_task_total,
    // 归类面（0021）与排期面：这六个键**刻意不写 `?? null`**。
    //
    // ⚠️⚠️ 这是本函数里唯一一处**不做缺席兜底**的投影，而且正因为周围全是 `?? …`，
    // 它最容易被后来的人"顺手补齐"。别补：
    //   · 旧服务端（0021 之前）根本不回这几个键 ⇒ `undefined`；
    //   · 新服务端回了、值是空 ⇒ `null` ＝「未分类 / 未排期」。
    // 兜成 null 就是把第一种情况说成第二种——替服务端宣布「这条没归类」，
    // 而界面据此会把一个未知显示成一个事实。三态判定走
    // `projectDictionaryBindingState`（契约层唯一出处）。
    //
    // ⚠️ 引用摘要（module / category / iteration）同理：缺席与 null 都合法，但形状
    // **不合法就整条拒**（`mapArray` 一条坏全批坏）——带了 id 却给一个畸形摘要只可能
    // 是服务端故障，不做部分采信。
    moduleId: record.module_id,
    module: mapNullableRef(record.module),
    categoryId: record.category_id,
    category: mapNullableRef(record.category),
    iterationId: record.iteration_id,
    iteration: mapNullableRef(record.iteration),
    // 时间事实面（服务端迁移 0023）：**同归类六键一样刻意不写 `?? null`**。
    //   · 旧服务端（0023 之前）根本不回这两个键 ⇒ `undefined`；
    //   · 新服务端回了、值是 null ⇒ statusChangedAt=「早于 0023，未知」/
    //     actualCompletedAt=「当前没有通过」（从未通过或通过后被重开）。
    // 兜成 null 就是替旧服务端宣布「这条从没通过过」——把一个未知说成一个事实。
    // 三态与上面几组同理，判定复用同一套（契约层 TodoSchema 那段已逐条写死）。
    statusChangedAt: record.status_changed_at,
    actualCompletedAt: record.actual_completed_at,
    version: record.version,
    createdAt: record.created_at,
    updatedAt: record.updated_at,
  });
  return view.success ? view.data : null;
}

/**
 * 嵌套引用摘要的 snake→camel 投影（模块 / 分类 / 迭代共用一份）。
 *
 * 三态照原样传下去：`undefined`（旧服务端没这个键）/ `null`（未绑定）/ 对象。
 * ⛔ 不在这里兜 null：理由见 `mapTodo` 里那段。
 * ⛔ 不在这里 `safeParse`：形状校验由 `TodoSchema` 那一次整体解析做，拆成两处会让
 *    「哪一层拒的」变成两个答案（而失败信封只有一个）。
 */
function mapNullableRef(raw: unknown): unknown {
  if (raw === undefined || raw === null) return raw;
  const record = recordOf(raw);
  if (!record) return raw;
  return {
    id: record.id,
    name: record.name,
    // 迭代摘要多一个 due_at；字典摘要没有这个键 ⇒ undefined，被 pick 出来的
    // 契约里也没有它，strictObject 因此不会因为多带一个 undefined 而拒。
    ...(record.due_at !== undefined ? { dueAt: record.due_at } : {}),
    archivedAt: record.archived_at,
  };
}

export function mapAcceptanceItem(raw: unknown): TodoAcceptanceItem | null {
  const record = recordOf(raw);
  if (!record) return null;
  const view = TodoAcceptanceItemSchema.safeParse({
    ordinal: record.ordinal,
    text: record.text,
    checked: record.checked,
    checkedBySubject: record.checked_by_subject ?? null,
    checkedAt: record.checked_at ?? null,
    executorNote: record.executor_note ?? '',
  });
  return view.success ? view.data : null;
}

export function mapCompletionRecord(raw: unknown): TodoCompletionRecord | null {
  const record = recordOf(raw);
  if (!record) return null;
  const view = TodoCompletionRecordSchema.safeParse({
    id: record.id,
    entryKind: record.entry_kind,
    authorSubject: record.author_subject,
    authorDisplayName: record.author_display_name ?? '',
    summary: record.summary,
    artifacts: record.artifacts ?? [],
    createdAt: record.created_at,
  });
  return view.success ? view.data : null;
}

function mapDraftInput(raw: unknown): unknown {
  const record = recordOf(raw);
  if (!record) return null;
  return {
    id: record.id,
    ordinal: record.ordinal,
    title: record.title,
    description: record.description ?? '',
    constraintsText: record.constraints_text ?? '',
    acceptanceItems: record.acceptance_items ?? [],
    priority: record.priority,
    // 老服务端不返回这个键：按「有依据」兜底。⛔ 不能兜成 assumed——那会把
    // 一批本来正当的草案全部染成可疑，区分不出来就等于没有区分。
    basis: record.basis ?? 'input',
    state: record.state,
    todoId: record.todo_id ?? null,
    droppedAt: record.dropped_at ?? null,
    droppedBySubject: record.dropped_by_subject ?? null,
  };
}

export function mapDraftBatch(raw: unknown): TodoDraftBatch | null {
  const record = recordOf(raw);
  if (!record) return null;
  const drafts = Array.isArray(record.drafts) ? record.drafts.map(mapDraftInput) : [];
  const view = TodoDraftBatchSchema.safeParse({
    id: record.id,
    projectId: record.project_id,
    sourceTodoId: record.source_todo_id ?? null,
    targetItemKind: record.target_item_kind,
    parentId: record.parent_id ?? null,
    createdBySubject: record.created_by_subject,
    dispatcherSubject: record.dispatcher_subject ?? null,
    state: record.state,
    confirmedAt: record.confirmed_at ?? null,
    discardedAt: record.discarded_at ?? null,
    discardedBySubject: record.discarded_by_subject ?? null,
    createdAt: record.created_at,
    updatedAt: record.updated_at,
    drafts,
  });
  return view.success ? view.data : null;
}

export function mapProjectFile(raw: unknown): ProjectFile | null {
  const record = recordOf(raw);
  if (!record) return null;
  const view = ProjectFileSchema.safeParse({
    id: record.id,
    kind: record.kind,
    // 老服务端不回这个键 ⇒ 没有声明来源 ＝ 成员上传，呈现与本列上线前逐字一致。
    // ⛔ 不因缺键判整条不可用：来源徽标缺席远好过文件列表整块消失。
    source: record.source ?? 'manual',
    filename: record.filename,
    mime: record.mime,
    bytes: record.bytes,
    sha256: record.sha256,
    uploaderSubject: record.uploader_subject,
    uploaderDisplayName: record.uploader_display_name ?? '',
    createdAt: record.created_at,
    expiresAt: record.expires_at ?? null,
  });
  return view.success ? view.data : null;
}

/* ------------------- 资产版本（迁移 0020：血统 + 冻结版本）------------------- */

/**
 * 一个**冻结版本**。引用方存的是 `id`，所以这一行的解析失败等于「一份已提交报告的
 * 附件解析不出来」——比一页列表取不回来严重得多。
 *
 * ⛔ `content_deleted_at` **不补默认值**：它是「字节已删」的唯一判据，缺键时补 null
 * 等于把「已删除」悄悄说成「还在」，呈现层会放行一次注定失败的下载。服务端恒回这个键
 * （真仓储的 LEFT JOIN 永远给出它），取不到就是投影漏列，整条判不可信是对的。
 * ⚠️ 这与 `mapProjectFile` 给 `source` 补 `'manual'` 的取舍相反，因为代价不对称：
 *    来源徽标缺席只是少个标，删除状态错了会误导用户。
 */
export function mapProjectAssetVersion(raw: unknown): ProjectAssetVersion | null {
  const record = recordOf(raw);
  if (!record) return null;
  const view = ProjectAssetVersionSchema.safeParse({
    id: record.id,
    assetId: record.asset_id,
    versionNo: record.version_no,
    fileId: record.file_id,
    contentSha256: record.content_sha256,
    bytes: record.bytes,
    filename: record.filename,
    mime: record.mime,
    source: record.source ?? 'manual',
    authorSubject: record.author_subject,
    authorDisplayName: record.author_display_name ?? '',
    createdAt: record.created_at,
    // ⛔ 刻意**不写** `?? null`：缺键时让它落成 undefined，schema 直接判整条不可信。
    //    写了 `?? null` 就把「服务端没给这个键」悄悄说成「字节还在」。
    contentDeletedAt: record.content_deleted_at,
  });
  return view.success ? view.data : null;
}

function assetFields(record: Record<string, unknown>): Record<string, unknown> {
  return {
    id: record.id,
    projectId: record.project_id,
    currentVersionId: record.current_version_id ?? null,
    versionCount: record.version_count,
    createdBySubject: record.created_by_subject,
    createdAt: record.created_at,
    deletedAt: record.deleted_at ?? null,
  };
}

/** 资产血统（不含当前版本内嵌体）。 */
export function mapProjectFileAsset(raw: unknown): ProjectFileAsset | null {
  const record = recordOf(raw);
  if (!record) return null;
  const view = ProjectFileAssetSchema.safeParse(assetFields(record));
  return view.success ? view.data : null;
}

/** 目录行：血统 + 它当前那一版（服务端回 `current_version`，可为 null）。 */
export function mapProjectAssetCatalogueEntry(raw: unknown): ProjectAssetCatalogueEntry | null {
  const record = recordOf(raw);
  if (!record) return null;
  // 当前版本存在但**投影不过**时不能降级成 null：那会把「有当前版本但形状可疑」
  // 说成「还没有版本」，目录上看起来像一条空血统。整条判不可信才是对的。
  const embedded =
    record.current_version === undefined || record.current_version === null
      ? null
      : mapProjectAssetVersion(record.current_version);
  if (record.current_version !== undefined && record.current_version !== null && !embedded) {
    return null;
  }
  const view = ProjectAssetCatalogueEntrySchema.safeParse({
    ...assetFields(record),
    currentVersion: embedded,
  });
  return view.success ? view.data : null;
}

/** 一条完整版本链（新版在前，服务端定序；客户端不重排）。 */
export function mapProjectAssetVersionChain(raw: unknown): ProjectAssetVersionChain | null {
  const record = recordOf(raw);
  if (!record) return null;
  const asset = mapProjectFileAsset(record.asset);
  const versions = mapArray(record.versions, mapProjectAssetVersion);
  if (!asset || !versions) return null;
  const view = ProjectAssetVersionChainSchema.safeParse({ asset, versions });
  return view.success ? view.data : null;
}

/** 单个冻结引用的解析结果。 */
export function mapProjectAssetVersionResolution(
  raw: unknown,
): ProjectAssetVersionResolution | null {
  const record = recordOf(raw);
  if (!record) return null;
  const asset = mapProjectFileAsset(record.asset);
  const version = mapProjectAssetVersion(record.version);
  if (!asset || !version) return null;
  const view = ProjectAssetVersionResolutionSchema.safeParse({ asset, version });
  return view.success ? view.data : null;
}
