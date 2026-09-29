import { ProjectDictionaryEntrySchema } from '../../../shared/protocol/project-collab-dictionaries.js';
import {
  ProjectDictionaryListRequestSchema,
  ProjectDictionaryPageSchema,
  type ProjectDictionaryListRequest,
  type ProjectDictionaryPage,
} from '../../../shared/protocol/project-dictionary-api.js';
import { failureFromResponse, readBoundedJson, type CollabClientOutcome } from './collabClient.js';
import { mapArray, recordOf } from './collabWireMapping.js';

export class CollabDictionaryClient {
  private readonly baseUrl: URL;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;

  constructor(options: {
    readonly baseUrl: string;
    readonly fetchImpl?: typeof fetch;
    readonly timeoutMs?: number;
  }) {
    this.baseUrl = new URL(options.baseUrl.endsWith('/') ? options.baseUrl : `${options.baseUrl}/`);
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.timeoutMs = options.timeoutMs ?? 20_000;
  }

  /** 服务端逐页校验项目成员权限；凭据只进入请求头，不进入渲染层数据。 */
  async list(
    accessToken: string,
    input: ProjectDictionaryListRequest,
  ): Promise<CollabClientOutcome<ProjectDictionaryPage>> {
    const parsed = ProjectDictionaryListRequestSchema.safeParse(input);
    if (!parsed.success) return { ok: false, code: 'invalidRequest' };
    const request = parsed.data;
    const url = new URL(
      `api/v1/projects/${encodeURIComponent(request.projectId)}/${request.kind}`,
      this.baseUrl,
    );
    url.searchParams.set('page', String(request.page));
    url.searchParams.set('page_size', String(request.pageSize));
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.fetchImpl(url, {
        method: 'GET',
        headers: { authorization: `Bearer ${accessToken}` },
        redirect: 'error',
        signal: controller.signal,
      });
      if (!response.ok) return await failureFromResponse(response);
      const body = recordOf(await readBoundedJson(response));
      const items = mapArray(body?.items, (raw) => {
        const row = recordOf(raw);
        if (!row) return null;
        const entry = ProjectDictionaryEntrySchema.safeParse({
          id: row.id,
          name: row.name,
          archivedAt: row.archived_at,
          version: row.version,
          creatorSubject: row.creator_subject,
          createdAt: row.created_at,
          updatedAt: row.updated_at,
        });
        return entry.success ? entry.data : null;
      });
      const page = ProjectDictionaryPageSchema.safeParse({
        items,
        total: body?.total,
        page: body?.page,
        pageSize: body?.page_size,
      });
      if (
        !page.success ||
        page.data.page !== request.page ||
        page.data.pageSize !== request.pageSize
      )
        return { ok: false, code: 'transient' };
      return { ok: true, value: page.data };
    } catch {
      return { ok: false, code: 'transient' };
    } finally {
      clearTimeout(timer);
    }
  }
}
