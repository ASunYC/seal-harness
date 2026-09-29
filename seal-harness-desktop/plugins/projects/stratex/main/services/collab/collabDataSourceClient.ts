import type {
  ProjectDataSource,
  ProjectDataSourceErrorCode,
  ProjectDataSourceSyncSummary,
  ProjectDataSourceTicketScheme,
  ProjectExternalLink,
} from '../../../shared/protocol/project-datasource.js';
import { mapArray, recordOf } from './collabWireMapping.js';
import {
  mapDataSource,
  mapDataSourceFailure,
  mapExternalLink,
  mapSyncSummary,
  ticketSchemeToWire,
} from './collabDataSourceWireMapping.js';

/**
 * 项目组**外部数据源**面的 HTTP 客户端（六个端点）。
 *
 * 与 `collabClient` 分文件而不是续在它后面，是因为两条**行为**上的差别，不是体量：
 *  ① 失败分档不同：协作面按状态码分档就够；本面必须先读服务端错误体里的稳定
 *     `error` 码再分档，否则「白名单没开」「仓库里没有任务目录」「票据被拒」会
 *     一起塌缩成「请求被拒绝」——那正是这条线最要紧的三个可读原因。
 *  ② 有一条**票据**要过手：只有 `syncDataSource` 收票据，且它只把票据拼进这一次
 *     外发请求体。其余五个方法的签名里结构性没有票据入口——递不进，也就漏不出。
 *
 * 其余纪律与协作面一致：单次尝试不自行重试；响应体是不可信输入（逐字段挑选映射
 * + 共享协议 schema 两道门，任一不过即 transient）；令牌只进 `Authorization` 头，
 * 本模块不记录、不打印任何凭据。
 */

const DEFAULT_TIMEOUT_MS = 20_000;
/**
 * 同步是**长动作**：服务端要拉一整棵 `.trellis` 目录树再落库，20 秒的常规预算不够。
 * 给它单独一档（服务端自己也有单次请求数上限，不会无限跑）。
 */
const DEFAULT_SYNC_TIMEOUT_MS = 180_000;
/** JSON 响应体读取上界（字符）：对账行列表再大也远低于此；超出即当不可信。 */
const MAX_RESPONSE_BODY_CHARS = 4_000_000;

const API_PREFIX = 'api/v1/';

export type CollabDataSourceFailure = {
  readonly ok: false;
  readonly code: ProjectDataSourceErrorCode;
};

export type CollabDataSourceOutcome<T> =
  { readonly ok: true; readonly value: T } | CollabDataSourceFailure;

export interface CollabDataSourceClientOptions {
  /** 构建期注入并已校验的服务基地址（末尾带 `/`）。 */
  readonly baseUrl: string;
  readonly fetchImpl?: typeof fetch;
  readonly timeoutMs?: number;
  readonly syncTimeoutMs?: number;
}

interface SendInit {
  readonly method: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  readonly accessToken: string;
  readonly query?: Readonly<Record<string, string | undefined>>;
  readonly jsonBody?: Readonly<Record<string, unknown>>;
  readonly timeoutMs?: number;
}

export function createCollabDataSourceClient(
  options: CollabDataSourceClientOptions,
): CollabDataSourceClient {
  return new CollabDataSourceClient(options);
}

export class CollabDataSourceClient {
  private readonly baseUrl: URL;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;
  private readonly syncTimeoutMs: number;

  constructor(options: CollabDataSourceClientOptions) {
    this.baseUrl = new URL(options.baseUrl.endsWith('/') ? options.baseUrl : `${options.baseUrl}/`);
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.syncTimeoutMs = options.syncTimeoutMs ?? DEFAULT_SYNC_TIMEOUT_MS;
  }

  /** `GET /projects/{id}/data-sources`（成员即可读，服务端不走 owner 门）。 */
  async listDataSources(
    accessToken: string,
    input: { readonly projectId: string },
  ): Promise<CollabDataSourceOutcome<readonly ProjectDataSource[]>> {
    return this.request(
      `projects/${encodeURIComponent(input.projectId)}/data-sources`,
      { method: 'GET', accessToken },
      (body) => mapArray(recordOf(body)?.data_sources, mapDataSource),
    );
  }

  /** `POST /projects/{id}/data-sources`（owner-only，服务端强判）。 */
  async createDataSource(
    accessToken: string,
    input: {
      readonly projectId: string;
      readonly baseUrl: string;
      readonly repoPath: string;
      readonly gitRef?: string | null | undefined;
      readonly enabled?: boolean | undefined;
      readonly includeDocuments?: boolean | undefined;
    },
  ): Promise<CollabDataSourceOutcome<ProjectDataSource>> {
    return this.request(
      `projects/${encodeURIComponent(input.projectId)}/data-sources`,
      {
        method: 'POST',
        accessToken,
        jsonBody: {
          // 闭集当前只有一个取值；显式发出去，别让默认值成为隐含约定。
          kind: 'gitlab',
          base_url: input.baseUrl,
          repo_path: input.repoPath,
          git_ref: input.gitRef ?? null,
          ...(input.enabled === undefined ? {} : { enabled: input.enabled }),
          ...(input.includeDocuments === undefined
            ? {}
            : { include_documents: input.includeDocuments }),
        },
      },
      (body) => mapDataSource(recordOf(body)?.data_source),
    );
  }

  /**
   * `PATCH /projects/{id}/data-sources/{sid}`（owner-only）。
   *
   * ⚠️ `git_ref` 的两档语义靠**键在不在**表达：显式 null ＝ 改回默认分支，
   * 缺席 ＝ 不动。服务端 `changed_fields()` 用的就是 `model_fields_set`，
   * 所以这里必须按 `'gitRef' in input` 判，不能按 `!== undefined` 判。
   */
  async updateDataSource(
    accessToken: string,
    input: {
      readonly projectId: string;
      readonly dataSourceId: string;
      readonly baseUrl?: string | undefined;
      readonly repoPath?: string | undefined;
      readonly gitRef?: string | null | undefined;
      readonly enabled?: boolean | undefined;
      readonly includeDocuments?: boolean | undefined;
    },
  ): Promise<CollabDataSourceOutcome<ProjectDataSource>> {
    return this.request(
      `projects/${encodeURIComponent(input.projectId)}/data-sources/${encodeURIComponent(
        input.dataSourceId,
      )}`,
      {
        method: 'PATCH',
        accessToken,
        jsonBody: {
          ...(input.baseUrl === undefined ? {} : { base_url: input.baseUrl }),
          ...(input.repoPath === undefined ? {} : { repo_path: input.repoPath }),
          ...('gitRef' in input ? { git_ref: input.gitRef ?? null } : {}),
          ...(input.enabled === undefined ? {} : { enabled: input.enabled }),
          ...(input.includeDocuments === undefined
            ? {}
            : { include_documents: input.includeDocuments }),
        },
      },
      (body) => mapDataSource(recordOf(body)?.data_source),
    );
  }

  /**
   * `DELETE /projects/{id}/data-sources/{sid}`（owner-only）。
   * 断开来源，**不删已导入的需求、任务与文档**——服务端语义如此，界面也要这么说。
   */
  async deleteDataSource(
    accessToken: string,
    input: { readonly projectId: string; readonly dataSourceId: string },
  ): Promise<CollabDataSourceOutcome<string>> {
    return this.request(
      `projects/${encodeURIComponent(input.projectId)}/data-sources/${encodeURIComponent(
        input.dataSourceId,
      )}`,
      { method: 'DELETE', accessToken },
      (body) => {
        const record = recordOf(body);
        return record?.deleted === true && typeof record.id === 'string' ? record.id : null;
      },
    );
  }

  /**
   * `POST /projects/{id}/data-sources/{sid}/sync`（owner-only，只读导入不写回）。
   *
   * **本客户端唯一收票据的方法**。票据来自主进程本机加密库，在这里拼进请求体、
   * 随请求发出，不落任何本地存储、不进日志、不进回执——回执里只有计数与诊断。
   */
  async syncDataSource(
    accessToken: string,
    input: {
      readonly projectId: string;
      readonly dataSourceId: string;
      readonly ticket: string;
      readonly ticketScheme: ProjectDataSourceTicketScheme;
    },
  ): Promise<CollabDataSourceOutcome<ProjectDataSourceSyncSummary>> {
    return this.request(
      `projects/${encodeURIComponent(input.projectId)}/data-sources/${encodeURIComponent(
        input.dataSourceId,
      )}/sync`,
      {
        method: 'POST',
        accessToken,
        jsonBody: {
          access_token: input.ticket,
          token_scheme: ticketSchemeToWire(input.ticketScheme),
        },
        timeoutMs: this.syncTimeoutMs,
      },
      (body) => mapSyncSummary(recordOf(body)?.sync),
    );
  }

  /** `GET /projects/{id}/external-links`：对账行只读面（成员即可读）。 */
  async listExternalLinks(
    accessToken: string,
    input: { readonly projectId: string; readonly dataSourceId?: string | undefined },
  ): Promise<CollabDataSourceOutcome<readonly ProjectExternalLink[]>> {
    return this.request(
      `projects/${encodeURIComponent(input.projectId)}/external-links`,
      { method: 'GET', accessToken, query: { data_source_id: input.dataSourceId } },
      (body) => mapArray(recordOf(body)?.links, mapExternalLink),
    );
  }

  /**
   * 统一流程：发请求 → 2xx 读有界体并投影校验（失败即 transient）→ 非 2xx
   * **先读错误体里的稳定码**再退回状态分档。
   */
  private async request<T>(
    path: string,
    init: SendInit,
    project: (body: unknown) => T | null,
  ): Promise<CollabDataSourceOutcome<T>> {
    const response = await this.send(path, init);
    if (response === null) return { ok: false, code: 'transient' };
    const body = await readBoundedJson(response);
    if (response.status >= 200 && response.status < 300) {
      const value = body === undefined ? null : project(body);
      return value === null ? { ok: false, code: 'transient' } : { ok: true, value };
    }
    return { ok: false, code: mapDataSourceFailure(body, response.status) };
  }

  /** 单次请求；网络不可达/超时/连接层错误返回 null（＝瞬时）。 */
  private async send(path: string, init: SendInit): Promise<Response | null> {
    const url = new URL(`${API_PREFIX}${path}`, this.baseUrl);
    for (const [key, value] of Object.entries(init.query ?? {})) {
      if (value !== undefined) url.searchParams.set(key, value);
    }
    const headers: Record<string, string> = { authorization: `Bearer ${init.accessToken}` };
    let body: string | undefined;
    if (init.jsonBody !== undefined) {
      headers['content-type'] = 'application/json';
      body = JSON.stringify(init.jsonBody);
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), init.timeoutMs ?? this.timeoutMs);
    try {
      return await this.fetchImpl(url, {
        method: init.method,
        headers,
        ...(body === undefined ? {} : { body }),
        signal: controller.signal,
      });
    } catch {
      return null;
    } finally {
      clearTimeout(timer);
    }
  }
}

/** 读有界 JSON 体；超界/不可解析返回 undefined（上层按状态分档或归 transient）。 */
async function readBoundedJson(response: Response): Promise<unknown | undefined> {
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
