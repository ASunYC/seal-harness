import { projectApi } from '../../../../src/ui/runtime';
import type {
  ProjectSpecAssistCancelResult,
  ProjectSpecAssistReadinessResult,
  ProjectSpecAssistRequest,
  ProjectSpecAssistResult,
} from '@shared/protocol/project-spec-assist.js';

/**
 * renderer 消费派单表单「让助理补全」（`project:todo-spec-assist*`，ADR-0043）的唯一入口。
 *
 * 校验发生在 preload 桥两侧，此处只做薄转发（同 `projectDataSource.ts` 口径）。
 * 【红线】渲染层不选模型、不碰凭据；建议只进表单本地字段，写入仍走保存那一次。
 */
export const projectSpecAssistApi = {
  readiness(): Promise<ProjectSpecAssistReadinessResult> {
    return projectApi().readProjectTodoSpecReadiness();
  },
  generate(request: ProjectSpecAssistRequest): Promise<ProjectSpecAssistResult> {
    return projectApi().generateProjectTodoSpec(request);
  },
  cancel(requestId: string): Promise<ProjectSpecAssistCancelResult> {
    return projectApi().cancelProjectTodoSpec({ requestId });
  },
};
