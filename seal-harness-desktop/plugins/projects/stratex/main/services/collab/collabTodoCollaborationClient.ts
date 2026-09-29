import { z } from 'zod';

import {
  ProjectTodoCollaboratorsSchema,
  ProjectTodoCommentsSchema,
  ProjectTodoCommentSchema,
  ProjectTodoDeletePreviewSchema,
  ProjectTodoCollaboratorsRequestSchema,
  ProjectTodoCollaboratorsReplaceRequestSchema,
  ProjectTodoCommentsRequestSchema,
  ProjectTodoCommentCreateRequestSchema,
  ProjectTodoDeletePreviewRequestSchema,
  type ProjectTodoCollaboratorsRequest,
  type ProjectTodoCollaboratorsReplaceRequest,
  type ProjectTodoCommentsRequest,
  type ProjectTodoCommentCreateRequest,
  type ProjectTodoDeletePreviewRequest,
  type ProjectTodoCollaborators,
  type ProjectTodoComments,
  type ProjectTodoComment,
  type ProjectTodoDeletePreview,
} from '../../../shared/protocol/project-todo-collaboration.js';
import { failureFromBody, readBoundedJson, type CollabClientOutcome } from './collabClient.js';
import { conflictWireSchema } from './collabWireMapping.js';
import {
  mapCollaboratorsWire,
  mapCollaboratorsReplaceWire,
  mapTodoCommentsWire,
  mapTodoCommentCreateWire,
  mapTodoDeletePreviewWire,
} from './collabTodoCollaborationWireMapping.js';

export interface CollabTodoCollaborationClientOptions {
  readonly baseUrl: string;
  readonly fetchImpl?: typeof fetch;
  readonly timeoutMs?: number;
}

const replacedSchema = ProjectTodoCollaboratorsSchema.extend({ replayed: z.boolean() });
const createdSchema = z.strictObject({ comment: ProjectTodoCommentSchema, replayed: z.boolean() });

/** 业务协作域：单次请求，不重生成幂等键，不回显服务端正文或令牌。 */
export class CollabTodoCollaborationClient {
  private readonly baseUrl: URL;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;

  constructor(options: CollabTodoCollaborationClientOptions) {
    this.baseUrl = new URL(options.baseUrl.endsWith('/') ? options.baseUrl : `${options.baseUrl}/`);
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.timeoutMs = options.timeoutMs ?? 20_000;
  }

  async getTodoCollaborators(
    token: string,
    input: ProjectTodoCollaboratorsRequest,
  ): Promise<CollabClientOutcome<ProjectTodoCollaborators>> {
    const parsed = ProjectTodoCollaboratorsRequestSchema.safeParse(input);
    if (!parsed.success) return { ok: false, code: 'invalidRequest' };
    return this.request(
      `todos/${encodeURIComponent(parsed.data.todoId)}/collaborators`,
      token,
      ProjectTodoCollaboratorsSchema,
      { method: 'GET' },
      (value) => value.todoId === parsed.data.todoId,
      mapCollaboratorsWire,
    );
  }

  async replaceTodoCollaborators(
    token: string,
    input: ProjectTodoCollaboratorsReplaceRequest,
  ): Promise<CollabClientOutcome<ProjectTodoCollaborators & { replayed: boolean }>> {
    const parsed = ProjectTodoCollaboratorsReplaceRequestSchema.safeParse(input);
    if (!parsed.success) return { ok: false, code: 'invalidRequest' };
    const request = parsed.data;
    return this.request(
      `todos/${encodeURIComponent(request.todoId)}/collaborators`,
      token,
      replacedSchema,
      {
        method: 'PUT',
        body: {
          expected_version: request.expectedVersion,
          client_request_id: request.clientRequestId,
          subjects: request.subjects,
        },
      },
      (value) => value.todoId === request.todoId,
      mapCollaboratorsReplaceWire,
    );
  }

  async listTodoComments(
    token: string,
    input: ProjectTodoCommentsRequest,
  ): Promise<CollabClientOutcome<ProjectTodoComments>> {
    const parsed = ProjectTodoCommentsRequestSchema.safeParse(input);
    if (!parsed.success) return { ok: false, code: 'invalidRequest' };
    const request = parsed.data;
    const query = new URLSearchParams();
    if (request.beforeId != null) query.set('before_id', request.beforeId);
    if (request.limit !== undefined) query.set('limit', String(request.limit));
    const suffix = query.size > 0 ? `?${query.toString()}` : '';
    return this.request(
      `todos/${encodeURIComponent(request.todoId)}/comments${suffix}`,
      token,
      ProjectTodoCommentsSchema,
      { method: 'GET' },
      (value) =>
        value.comments.length <= (request.limit ?? 20) &&
        value.comments.every((comment) => comment.todoId === request.todoId) &&
        new Set(value.comments.map((comment) => comment.id)).size === value.comments.length,
      mapTodoCommentsWire,
    );
  }

  async createTodoComment(
    token: string,
    input: ProjectTodoCommentCreateRequest,
  ): Promise<CollabClientOutcome<{ comment: ProjectTodoComment; replayed: boolean }>> {
    const parsed = ProjectTodoCommentCreateRequestSchema.safeParse(input);
    if (!parsed.success) return { ok: false, code: 'invalidRequest' };
    const request = parsed.data;
    return this.request(
      `todos/${encodeURIComponent(request.todoId)}/comments`,
      token,
      createdSchema,
      {
        method: 'POST',
        body: {
          body_md: request.bodyMd,
          refs: request.refs,
          client_request_id: request.clientRequestId,
        },
        statuses: [200, 201],
      },
      (value, status) =>
        value.comment.todoId === request.todoId && value.replayed === (status === 200),
      mapTodoCommentCreateWire,
    );
  }

  async previewTodoDeletion(
    token: string,
    input: ProjectTodoDeletePreviewRequest,
  ): Promise<CollabClientOutcome<ProjectTodoDeletePreview>> {
    const parsed = ProjectTodoDeletePreviewRequestSchema.safeParse(input);
    if (!parsed.success) return { ok: false, code: 'invalidRequest' };
    const request = parsed.data;
    const requested = new Set(request.ids);
    return this.request(
      `projects/${encodeURIComponent(request.projectId)}/todos/delete-preview`,
      token,
      ProjectTodoDeletePreviewSchema,
      { method: 'POST', body: { ids: request.ids } },
      (value) =>
        value.rootIds.length === requested.size && value.rootIds.every((id) => requested.has(id)),
      mapTodoDeletePreviewWire,
    );
  }

  private async request<T>(
    path: string,
    token: string,
    schema: z.ZodType<T>,
    init: { method: 'GET' | 'PUT' | 'POST'; body?: Record<string, unknown>; statuses?: number[] },
    matches: (value: T, status: number) => boolean,
    mapWire: (body: unknown) => unknown,
  ): Promise<CollabClientOutcome<T>> {
    const controller = new AbortController();
    // 保持计时器直到响应体读完，避免响应头已到而正文永久挂起。
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.fetchImpl(new URL(`api/v1/${path}`, this.baseUrl), {
        method: init.method,
        headers: {
          authorization: `Bearer ${token}`,
          ...(init.body ? { 'content-type': 'application/json' } : {}),
        },
        ...(init.body ? { body: JSON.stringify(init.body) } : {}),
        signal: controller.signal,
      });
      const body = await readBoundedJson(response);
      if (controller.signal.aborted) return { ok: false, code: 'transient' };
      if (!response.ok) {
        const failure = failureFromBody(response.status, body);
        const conflict = response.status === 409 ? conflictWireSchema.safeParse(body) : null;
        return {
          ...failure,
          ...(conflict?.success ? { currentVersion: conflict.data.current_version } : {}),
        };
      }
      if (!(init.statuses ?? [200]).includes(response.status))
        return { ok: false, code: 'transient' };
      const result = schema.safeParse(mapWire(body));
      return result.success && matches(result.data, response.status)
        ? { ok: true, value: result.data }
        : { ok: false, code: 'transient' };
    } catch {
      return { ok: false, code: 'transient' };
    } finally {
      clearTimeout(timer);
    }
  }
}

export function createCollabTodoCollaborationClient(
  options: CollabTodoCollaborationClientOptions,
): CollabTodoCollaborationClient {
  return new CollabTodoCollaborationClient(options);
}
