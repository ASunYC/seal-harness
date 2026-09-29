import type { ProjectApi } from '../shared/ipc/api.js';
import { IPC } from '../shared/ipc/channels.js';
import {
  ProjectSpecAssistCancelRequestSchema,
  ProjectSpecAssistCancelResultSchema,
  ProjectSpecAssistReadinessRequestSchema,
  ProjectSpecAssistReadinessResultSchema,
  ProjectSpecAssistRequestSchema,
  ProjectSpecAssistResultSchema,
} from '../shared/protocol/project-spec-assist.js';

/**
 * 派单表单「让助理补全」（`project:todo-spec-assist*`，ADR-0043）的预加载桥。
 *
 * 纪律同全局：入参在此收敛、出参在此校验（边界两侧都不信任对方）。请求 schema 里没有账号与
 * 模型选择字段——渲染层即便想塞也塞不进（strictObject 拒多余键）。
 */

export type ProjectSpecAssistApi = Pick<
  ProjectApi,
  'generateProjectTodoSpec' | 'cancelProjectTodoSpec' | 'readProjectTodoSpecReadiness'
>;

export type ProjectSpecAssistInvoke = (channel: string, request: unknown) => Promise<unknown>;

export function createProjectSpecAssistPreloadApi(
  invoke: ProjectSpecAssistInvoke,
): ProjectSpecAssistApi {
  return {
    generateProjectTodoSpec: async (input) =>
      ProjectSpecAssistResultSchema.parse(
        await invoke(IPC.PROJECT_TODO_SPEC_ASSIST, ProjectSpecAssistRequestSchema.parse(input)),
      ),
    cancelProjectTodoSpec: async (input) =>
      ProjectSpecAssistCancelResultSchema.parse(
        await invoke(
          IPC.PROJECT_TODO_SPEC_ASSIST_CANCEL,
          ProjectSpecAssistCancelRequestSchema.parse(input),
        ),
      ),
    readProjectTodoSpecReadiness: async () =>
      ProjectSpecAssistReadinessResultSchema.parse(
        await invoke(
          IPC.PROJECT_TODO_SPEC_ASSIST_READINESS,
          ProjectSpecAssistReadinessRequestSchema.parse({}),
        ),
      ),
  };
}
