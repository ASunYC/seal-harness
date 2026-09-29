import { z } from 'zod';

import {
  ProjectDataSourceSchema,
  ProjectDataSourceSyncSummarySchema,
  ProjectExternalLinkSchema,
  type ProjectDataSource,
  type ProjectDataSourceErrorCode,
  type ProjectDataSourceSyncSummary,
  type ProjectDataSourceTicketScheme,
  type ProjectExternalLink,
  type ProjectExternalLinkKind,
} from '../../../shared/protocol/project-datasource.js';
import { recordOf } from './collabWireMapping.js';

/**
 * 外部数据源面的线格式（snake_case）→ 客户端投影（camelCase）映射。
 *
 * 纪律与 `collabWireMapping` 一致：**逐字段挑选**已知项，映射后再过一遍共享协议
 * schema（strictObject + enum/上界封顶）；两道门任一不过即回 null，上层当不可信
 * 响应（transient）处理，绝不把服务端原文透传给渲染层。
 *
 * 多出来的一件事是**失败码映射**：协作面按状态码分档就够，本面不够——400 上同时
 * 挂着「地址不在名单内」「地址内嵌凭据」「票据被外部仓库拒了」三种处置完全不同的
 * 拒绝。所以这里读服务端错误体里的稳定 `error` 码，按**闭集表**翻成客户端失败码；
 * 表外的码退回按状态分档。⛔ 服务端的 `detail` 文本一律丢弃（不可信输入，也可能
 * 夹带内部细节），用户看到的文案由客户端按码自己出。
 */

/** 服务端错误体：`{"error": "<code>", "detail"?: str}`（协作服务统一信封）。 */
export const dataSourceErrorWireSchema = z.object({
  error: z.string().min(1).max(128),
});

/** 对账行的外部条目类别：线格式 `todo_item` → 投影 `todoItem`，其余同名。 */
const EXTERNAL_LINK_KINDS: Readonly<Record<string, ProjectExternalLinkKind>> = {
  task: 'task',
  subtask: 'subtask',
  todo_item: 'todoItem',
  document: 'document',
};

/** 票据携带方式：客户端投影 → 线格式（出参方向，本面唯一的反向映射）。 */
const TICKET_SCHEME_WIRE: Readonly<Record<ProjectDataSourceTicketScheme, string>> = {
  privateToken: 'private_token',
  bearer: 'bearer',
};

export function ticketSchemeToWire(scheme: ProjectDataSourceTicketScheme): string {
  return TICKET_SCHEME_WIRE[scheme];
}

/**
 * 服务端稳定错误码 → 客户端失败码（闭集表）。
 *
 * ⚠️ 逐条对着服务端取值，不是照文档抄的：
 *  - `routes_datasources.py`：files_unavailable
 *  - `domain.py`：forbidden / not_a_member / project_archived / invalid_endpoint /
 *    credential_in_endpoint / external_sources_disabled / endpoint_not_allowed
 *  - `repository_datasources.py`：data_source_exists / data_source_not_found /
 *    data_source_disabled / no_changes
 *  - `repository_external_sync.py`：file_too_large
 *  - `gitlab_files.py`：external_budget_exhausted / external_credential_rejected /
 *    external_rejected / external_unavailable / external_repo_not_found /
 *    trellis_directory_missing
 *  - `app.py`：unauthorized / rate_limited / validation_error / internal_error
 */
const ERROR_CODE_MAP: Readonly<Record<string, ProjectDataSourceErrorCode>> = {
  unauthorized: 'credentialRejected',
  rate_limited: 'rateLimited',
  validation_error: 'invalidRequest',
  internal_error: 'transient',
  forbidden: 'forbidden',
  not_a_member: 'forbidden',
  project_archived: 'forbidden',
  project_not_found: 'notFound',
  data_source_not_found: 'notFound',
  data_source_exists: 'alreadyExists',
  data_source_disabled: 'sourceDisabled',
  no_changes: 'noChanges',
  external_sources_disabled: 'externalSourcesDisabled',
  endpoint_not_allowed: 'endpointNotAllowed',
  invalid_endpoint: 'invalidEndpoint',
  credential_in_endpoint: 'credentialInEndpoint',
  files_unavailable: 'documentsUnavailable',
  external_credential_rejected: 'ticketRejected',
  external_repo_not_found: 'repositoryNotFound',
  trellis_directory_missing: 'taskDirectoryMissing',
  external_rejected: 'externalRejected',
  external_budget_exhausted: 'externalBudgetExhausted',
  external_unavailable: 'externalUnavailable',
  file_too_large: 'tooLarge',
};

/** 表外错误码（或读不出错误体）时的退路：按状态码粗分档。 */
export function statusToDataSourceFailure(status: number): ProjectDataSourceErrorCode {
  if (status === 401) return 'credentialRejected';
  if (status === 403) return 'forbidden';
  if (status === 404) return 'notFound';
  if (status === 409) return 'alreadyExists';
  if (status === 413) return 'tooLarge';
  if (status === 429) return 'rateLimited';
  if (status >= 500) return 'transient';
  if (status >= 400) return 'rejected';
  // 非预期的 2xx/3xx 形态：当作瞬时不确定，不误报为成功。
  return 'transient';
}

/**
 * 错误体 + 状态码 → 客户端失败码。**先认码再认状态**：同一个 400 上挂着好几种
 * 处置不同的拒绝，只看状态就把它们塌缩成一句「请求被拒绝」了。
 */
export function mapDataSourceFailure(body: unknown, status: number): ProjectDataSourceErrorCode {
  const wire = dataSourceErrorWireSchema.safeParse(body);
  if (wire.success) {
    const mapped = ERROR_CODE_MAP[wire.data.error];
    if (mapped !== undefined) return mapped;
  }
  return statusToDataSourceFailure(status);
}

export function mapDataSource(raw: unknown): ProjectDataSource | null {
  const record = recordOf(raw);
  if (!record) return null;
  const view = ProjectDataSourceSchema.safeParse({
    id: record.id,
    kind: record.kind,
    baseUrl: record.base_url,
    repoPath: record.repo_path,
    gitRef: record.git_ref ?? null,
    enabled: record.enabled,
    includeDocuments: record.include_documents,
    includeProcessDocs: record.include_process_docs ?? false,
    lastSyncedAt: record.last_synced_at ?? null,
    lastSyncStatus: record.last_sync_status ?? null,
    lastSyncDetail: record.last_sync_detail ?? null,
    createdBySubject: record.created_by_subject,
    createdAt: record.created_at,
    updatedAt: record.updated_at,
  });
  return view.success ? view.data : null;
}

export function mapExternalLink(raw: unknown): ProjectExternalLink | null {
  const record = recordOf(raw);
  if (!record) return null;
  const kind = typeof record.external_kind === 'string' ? record.external_kind : '';
  const externalKind = EXTERNAL_LINK_KINDS[kind];
  // 闭集外的类别＝服务端加了我们不认的档：整条拒收，不猜、也不塞个「其它」进去。
  if (externalKind === undefined) return null;
  const view = ProjectExternalLinkSchema.safeParse({
    id: record.id,
    dataSourceId: record.data_source_id,
    externalKind,
    externalKey: record.external_key,
    todoId: record.todo_id ?? null,
    fileId: record.file_id ?? null,
    linkState: record.link_state,
    orphanedAt: record.orphaned_at ?? null,
    externalUpdatedAt: record.external_updated_at ?? null,
    updatedAt: record.updated_at,
  });
  return view.success ? view.data : null;
}

export function mapSyncSummary(raw: unknown): ProjectDataSourceSyncSummary | null {
  const record = recordOf(raw);
  if (!record) return null;
  const view = ProjectDataSourceSyncSummarySchema.safeParse({
    todosCreated: record.todos_created,
    todosUpdated: record.todos_updated,
    todosUnchanged: record.todos_unchanged,
    documentsCreated: record.documents_created,
    documentsUpdated: record.documents_updated,
    documentsUnchanged: record.documents_unchanged,
    orphaned: record.orphaned,
    detail: record.detail ?? '',
    diagnostics: record.diagnostics ?? [],
    // 缺席时退回数组长度：宁可说「就这些」，也不谎报成 0 条。
    diagnosticsTotal:
      record.diagnostics_total ??
      (Array.isArray(record.diagnostics) ? record.diagnostics.length : 0),
  });
  return view.success ? view.data : null;
}
