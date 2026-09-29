import {
  ProjectWorkOverviewRequestSchema,
  ProjectWorkOverviewSchema,
  type ProjectWorkOverviewRequest,
  type ProjectWorkOverview,
} from '../../../shared/protocol/project-work-overview.js';
import { z } from 'zod';
import { failureFromBody, type CollabClientOutcome } from './collabClient.js';
import { mapTodo } from './collabWireMapping.js';

const wireSchema = z.strictObject({
  counts: z.strictObject({
    overdue: z.number(),
    due_today: z.number(),
    incomplete: z.number(),
    participating: z.number(),
  }),
  total: z.number(),
  items: z.array(z.unknown()).max(50),
  next_cursor: z.string().nullable(),
});
const MAX_OVERVIEW_BYTES = 64 * 1024;

async function readOverviewBody(response: Response): Promise<unknown> {
  const reader = response.body?.getReader();
  if (!reader) return undefined;
  const decoder = new TextDecoder('utf-8', { fatal: true });
  let bytes = 0;
  let text = '';
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      bytes += chunk.value.byteLength;
      if (bytes > MAX_OVERVIEW_BYTES) {
        await reader.cancel();
        return undefined;
      }
      text += decoder.decode(chunk.value, { stream: true });
    }
    text += decoder.decode();
    const value: unknown = JSON.parse(text);
    return value;
  } catch {
    // 解码/读取失败时响应可能仍开放；取消失败也交外层请求映射为统一可恢复错误。
    await reader.cancel();
    return undefined;
  } finally {
    reader.releaseLock();
  }
}

export interface CollabWorkOverviewClientOptions {
  readonly baseUrl: string;
  readonly fetchImpl?: typeof fetch;
  readonly timeoutMs?: number;
}

/** 工作概览只读请求；身份来自 Main，网络失败不回显服务端原文。 */
export class CollabWorkOverviewClient {
  private readonly baseUrl: URL;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;

  constructor(options: CollabWorkOverviewClientOptions) {
    this.baseUrl = new URL(options.baseUrl.endsWith('/') ? options.baseUrl : `${options.baseUrl}/`);
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.timeoutMs = options.timeoutMs ?? 20_000;
  }

  async readWorkOverview(
    token: string,
    input: ProjectWorkOverviewRequest,
  ): Promise<CollabClientOutcome<ProjectWorkOverview>> {
    const parsed = ProjectWorkOverviewRequestSchema.safeParse(input);
    if (!parsed.success) return { ok: false, code: 'invalidRequest' };
    const request = parsed.data;
    const query = new URLSearchParams({
      group: request.group ?? 'incomplete',
      limit: String(request.limit ?? 20),
    });
    if (request.cursor != null) query.set('cursor', request.cursor);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.fetchImpl(
        new URL(`api/v1/projects/${request.projectId}/work-overview?${query}`, this.baseUrl),
        {
          method: 'GET',
          headers: { authorization: `Bearer ${token}` },
          signal: controller.signal,
        },
      );
      const body = await readOverviewBody(response);
      if (controller.signal.aborted) return { ok: false, code: 'transient' };
      if (!response.ok) return failureFromBody(response.status, body);
      const wire = wireSchema.safeParse(body);
      if (!wire.success) return { ok: false, code: 'transient' };
      const result = ProjectWorkOverviewSchema.safeParse({
        counts: {
          overdue: wire.data.counts.overdue,
          dueToday: wire.data.counts.due_today,
          incomplete: wire.data.counts.incomplete,
          participating: wire.data.counts.participating,
        },
        total: wire.data.total,
        items: wire.data.items.map(mapTodo),
        nextCursor: wire.data.next_cursor,
      });
      return response.status === 200 &&
        result.success &&
        result.data.items.length <= (request.limit ?? 20) &&
        result.data.items.length <=
          result.data.counts[
            request.group === 'due_today' ? 'dueToday' : (request.group ?? 'incomplete')
          ] &&
        result.data.items.every((item) => item.projectId === request.projectId) &&
        (result.data.nextCursor === null || result.data.nextCursor !== request.cursor)
        ? { ok: true, value: result.data }
        : { ok: false, code: 'transient' };
    } catch {
      return { ok: false, code: 'transient' };
    } finally {
      clearTimeout(timer);
    }
  }
}
