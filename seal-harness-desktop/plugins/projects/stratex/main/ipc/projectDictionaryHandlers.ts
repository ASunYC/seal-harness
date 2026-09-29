import { IPC } from '../../shared/ipc/channels.js';
import {
  PROJECT_COLLAB_REFERENCE_CODES,
  type ProjectCollabErrorCode,
} from '../../shared/protocol/project-collab.js';
import {
  ProjectDictionaryListRequestSchema,
  ProjectDictionaryListResultSchema,
  type ProjectDictionaryListResult,
} from '../../shared/protocol/project-dictionary-api.js';
import type { CollabDictionaryClient } from '../services/collab/collabDictionaryClient.js';

export interface ProjectDictionaryIpcDependencies {
  readonly client: Pick<CollabDictionaryClient, 'list'>;
  readonly accessToken: () => Promise<string | null>;
}
interface Account {
  readonly accountKey: string;
  readonly authEpoch: number;
}
export function registerProjectDictionaryHandlers(
  registrar: {
    handle(channel: string, listener: (event: unknown, input: unknown) => Promise<unknown>): void;
  },
  options: {
    readonly dependencies?: ProjectDictionaryIpcDependencies | null;
    readonly authorize: (event: unknown) => boolean;
    readonly activeAccount: () => Account | null;
  },
): void {
  const failure = (code: ProjectCollabErrorCode): ProjectDictionaryListResult => ({
    ok: false,
    code,
    referenceCode: PROJECT_COLLAB_REFERENCE_CODES[code],
    message:
      code === 'forbidden'
        ? '当前账号无权读取该项目的模块与分类，请刷新项目权限。'
        : code === 'authRequired' || code === 'credentialRejected'
          ? '登录状态已变化，请重新登录后读取模块与分类。'
          : code === 'unavailable' || code === 'rejected'
            ? '模块与分类列表当前不可用，请确认服务支持后重试。'
            : '模块与分类加载失败，请重试。',
  });
  registrar.handle(IPC.PROJECT_DICTIONARY_LIST, async (event, input) => {
    const account = options.authorize(event) ? options.activeAccount() : null;
    if (!account) return failure('authRequired');
    const request = ProjectDictionaryListRequestSchema.safeParse(input);
    if (!request.success) return failure('invalidRequest');
    const deps = options.dependencies;
    if (!deps) return failure('unavailable');
    const currentRequest = (): boolean => {
      const current = options.authorize(event) ? options.activeAccount() : null;
      return (
        current !== null &&
        current.accountKey === account.accountKey &&
        current.authEpoch === account.authEpoch
      );
    };
    try {
      const token = await deps.accessToken();
      if (!currentRequest()) return failure('authRequired');
      if (!token) return failure('credentialRejected');
      const result = await deps.client.list(token, request.data);
      if (!currentRequest()) return failure('authRequired');
      return result.ok
        ? ProjectDictionaryListResultSchema.parse({ ok: true, ...result.value })
        : failure(result.code);
    } catch {
      return failure(currentRequest() ? 'transient' : 'authRequired');
    }
  });
}
