import { z } from 'zod';
import { IPC } from '../../shared/ipc/channels.js';
import {
  PROJECT_COLLAB_REFERENCE_CODES,
  type ProjectCollabErrorCode,
} from '../../shared/protocol/project-collab.js';
import {
  ProjectTodoCollaboratorsRequestSchema,
  ProjectTodoCollaboratorsResultSchema,
  ProjectTodoCollaboratorsReplaceRequestSchema,
  ProjectTodoCollaboratorsReplaceResultSchema,
  ProjectTodoCommentsRequestSchema,
  ProjectTodoCommentsResultSchema,
  ProjectTodoCommentCreateRequestSchema,
  ProjectTodoCommentCreateResultSchema,
  ProjectTodoDeletePreviewRequestSchema,
  ProjectTodoDeletePreviewResultSchema,
} from '../../shared/protocol/project-todo-collaboration.js';
import type { CollabTodoCollaborationClient } from '../services/collab/collabTodoCollaborationClient.js';
import type { CollabClientOutcome } from '../services/collab/collabClient.js';

/** 通道名称来自共享白名单；本模块不直接接触ipcMain。 */
export const PROJECT_TODO_COLLABORATION_CHANNELS = {
  collaborators: IPC.PROJECT_TODO_COLLABORATORS,
  replaceCollaborators: IPC.PROJECT_TODO_COLLABORATORS_REPLACE,
  comments: IPC.PROJECT_TODO_COMMENTS,
  createComment: IPC.PROJECT_TODO_COMMENT_CREATE,
  deletePreview: IPC.PROJECT_TODO_DELETE_PREVIEW,
} as const;

export type ProjectTodoCollaborationClientPort = Pick<
  CollabTodoCollaborationClient,
  | 'getTodoCollaborators'
  | 'replaceTodoCollaborators'
  | 'listTodoComments'
  | 'createTodoComment'
  | 'previewTodoDeletion'
>;
export interface ProjectTodoCollaborationIpcDependencies {
  readonly collaboration: ProjectTodoCollaborationClientPort;
  readonly accessToken: () => Promise<string | null>;
}
export interface ProjectTodoCollaborationHandlerOptions {
  readonly dependencies?: ProjectTodoCollaborationIpcDependencies | null;
  readonly authorize: (event: unknown) => boolean;
  readonly activeAccount: () => { readonly accountKey: string; readonly authEpoch: number } | null;
}
export interface ProjectTodoCollaborationIpcRegistrar {
  handle(channel: string, listener: (event: unknown, input: unknown) => Promise<unknown>): void;
}

const FAILURE_MESSAGES: Readonly<Record<ProjectCollabErrorCode, string>> = {
  unavailable: '项目组功能当前不可用。',
  authRequired: '请先登录后再操作。',
  invalidRequest: '填写的内容不合法，请检查后重试。',
  tooLarge: '内容超出大小上限。',
  rateLimited: '操作过于频繁，请稍后再试。',
  conflict: '内容已被更新，请刷新后重试。',
  quotaExceeded: '已达容量上限。',
  credentialRejected: '登录状态已失效，请重新登录。',
  forbidden: '没有执行该操作的权限。',
  rejected: '请求被服务端拒绝。',
  transient: '网络暂时不可用，请稍后重试。',
  writeFailed: '保存失败，请稍后重试。',
};

/** 身份从Main会话推导；取令牌与网络await两侧均重新验证账号、epoch和发送帧。 */
export function registerProjectTodoCollaborationHandlers(
  registrar: ProjectTodoCollaborationIpcRegistrar,
  options: ProjectTodoCollaborationHandlerOptions,
): void {
  const register = <Input, Value>(
    channel: string,
    requestSchema: z.ZodType<Input>,
    resultSchema: z.ZodType,
    action: (
      client: ProjectTodoCollaborationClientPort,
      token: string,
      input: Input,
    ) => Promise<CollabClientOutcome<Value>>,
    includeVersion = false,
  ): void => {
    const fail = (code: ProjectCollabErrorCode, serverCode?: string, currentVersion?: number) =>
      resultSchema.parse({
        ok: false,
        code,
        message: FAILURE_MESSAGES[code],
        referenceCode: PROJECT_COLLAB_REFERENCE_CODES[code],
        ...(serverCode === undefined ? {} : { serverCode }),
        ...(includeVersion
          ? { currentVersion: code === 'conflict' ? (currentVersion ?? null) : null }
          : {}),
      });
    registrar.handle(channel, async (event, input) => {
      const account = options.authorize(event) ? options.activeAccount() : null;
      if (!account) return fail('authRequired');
      // 提供器可能返回可变会话对象；捕获标量，不让原对象变化改写比较基线。
      const { accountKey, authEpoch } = account;
      const current = (): boolean => {
        const active = options.authorize(event) ? options.activeAccount() : null;
        return (
          active !== null && active.accountKey === accountKey && active.authEpoch === authEpoch
        );
      };
      const deps = options.dependencies;
      if (!deps) return fail('unavailable');
      const parsed = requestSchema.safeParse(input);
      if (!parsed.success) return fail('invalidRequest');
      try {
        let token: string | null;
        try {
          token = await deps.accessToken();
        } catch {
          token = null;
        }
        if (!current()) return fail('authRequired');
        if (token === null) return fail('credentialRejected');
        const result = await action(deps.collaboration, token, parsed.data);
        if (!current()) return fail('authRequired');
        if (!result.ok) return fail(result.code, result.serverCode, result.currentVersion);
        return resultSchema.parse({ ok: true, ...result.value });
      } catch {
        return fail(current() ? 'transient' : 'authRequired');
      }
    });
  };

  register(
    PROJECT_TODO_COLLABORATION_CHANNELS.collaborators,
    ProjectTodoCollaboratorsRequestSchema,
    ProjectTodoCollaboratorsResultSchema,
    (client, token, input) => client.getTodoCollaborators(token, input),
  );
  register(
    PROJECT_TODO_COLLABORATION_CHANNELS.replaceCollaborators,
    ProjectTodoCollaboratorsReplaceRequestSchema,
    ProjectTodoCollaboratorsReplaceResultSchema,
    (client, token, input) => client.replaceTodoCollaborators(token, input),
    true,
  );
  register(
    PROJECT_TODO_COLLABORATION_CHANNELS.comments,
    ProjectTodoCommentsRequestSchema,
    ProjectTodoCommentsResultSchema,
    (client, token, input) => client.listTodoComments(token, input),
  );
  register(
    PROJECT_TODO_COLLABORATION_CHANNELS.createComment,
    ProjectTodoCommentCreateRequestSchema,
    ProjectTodoCommentCreateResultSchema,
    (client, token, input) => client.createTodoComment(token, input),
  );
  register(
    PROJECT_TODO_COLLABORATION_CHANNELS.deletePreview,
    ProjectTodoDeletePreviewRequestSchema,
    ProjectTodoDeletePreviewResultSchema,
    (client, token, input) => client.previewTodoDeletion(token, input),
  );
}
