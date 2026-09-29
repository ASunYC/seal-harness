import {
  PROJECT_COLLAB_REFERENCE_CODES,
  type ProjectCollabErrorCode,
} from '../../shared/protocol/project-collab.js';
import {
  PROJECT_WORK_OVERVIEW_CHANNEL,
  ProjectWorkOverviewRequestSchema,
  ProjectWorkOverviewResultSchema,
  type ProjectWorkOverviewResult,
} from '../../shared/protocol/project-work-overview.js';
import type { CollabWorkOverviewClient } from '../services/collab/collabWorkOverviewClient.js';

export interface ProjectWorkOverviewHandlerOptions {
  readonly dependencies?: {
    readonly overview: Pick<CollabWorkOverviewClient, 'readWorkOverview'>;
    readonly accessToken: () => Promise<string | null>;
  } | null;
  readonly authorize: (event: unknown) => boolean;
  readonly activeAccount: () => { readonly accountKey: string; readonly authEpoch: number } | null;
}
export interface ProjectWorkOverviewIpcRegistrar {
  handle(channel: string, listener: (event: unknown, input: unknown) => Promise<unknown>): void;
}

function failure(code: ProjectCollabErrorCode, serverCode?: string): ProjectWorkOverviewResult {
  const message =
    code === 'authRequired' || code === 'credentialRejected'
      ? '登录状态已失效，请重新登录。'
      : code === 'forbidden'
        ? '没有查看工作概览的权限。'
        : serverCode === 'invalid_cursor'
          ? '工作概览已变化，请刷新。'
          : code === 'invalidRequest'
            ? '工作概览查询无效，请刷新。'
            : '工作概览暂时无法读取，请重试。';
  return ProjectWorkOverviewResultSchema.parse({
    ok: false,
    code,
    message,
    referenceCode: PROJECT_COLLAB_REFERENCE_CODES[code],
    ...(serverCode ? { serverCode } : {}),
  });
}

/** 请求与响应两侧验证发送帧及账号标量，异步换号不能交付旧账号结果。 */
export function registerProjectWorkOverviewHandlers(
  registrar: ProjectWorkOverviewIpcRegistrar,
  options: ProjectWorkOverviewHandlerOptions,
): void {
  registrar.handle(PROJECT_WORK_OVERVIEW_CHANNEL, async (event, input) => {
    const account = options.authorize(event) ? options.activeAccount() : null;
    if (!account) return failure('authRequired');
    const { accountKey, authEpoch } = account;
    const current = (): boolean => {
      const active = options.authorize(event) ? options.activeAccount() : null;
      return active !== null && active.accountKey === accountKey && active.authEpoch === authEpoch;
    };
    const parsed = ProjectWorkOverviewRequestSchema.safeParse(input);
    if (!parsed.success) return failure('invalidRequest');
    const dependencies = options.dependencies;
    if (!dependencies) return failure('unavailable');
    try {
      const token = await dependencies.accessToken();
      if (!current()) return failure('authRequired');
      if (!token) return failure('credentialRejected');
      const result = await dependencies.overview.readWorkOverview(token, parsed.data);
      if (!current()) return failure('authRequired');
      if (!result.ok) return failure(result.code, result.serverCode);
      return ProjectWorkOverviewResultSchema.parse({ ok: true, ...result.value });
    } catch {
      return failure(current() ? 'transient' : 'authRequired');
    }
  });
}
