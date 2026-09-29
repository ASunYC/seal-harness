import { projectApi } from '../../../../src/ui/runtime';
import {
  ProjectWorkOverviewRequestSchema,
  ProjectWorkOverviewResultSchema,
  type ProjectWorkOverviewRequest,
  type ProjectWorkOverviewResult,
} from '@shared/protocol/project-work-overview.js';

/** 注入类型化 preload 端口；没有网络、账号参数或不安全类型转换。 */
export interface ProjectWorkOverviewPort {
  readonly readProjectWorkOverview: (
    request: ProjectWorkOverviewRequest,
  ) => Promise<ProjectWorkOverviewResult>;
}
export interface ProjectWorkOverviewApi {
  readonly read: (request: ProjectWorkOverviewRequest) => Promise<ProjectWorkOverviewResult>;
}
export function createProjectWorkOverviewApi(
  port: ProjectWorkOverviewPort,
): ProjectWorkOverviewApi {
  return {
    async read(request): Promise<ProjectWorkOverviewResult> {
      return ProjectWorkOverviewResultSchema.parse(
        await port.readProjectWorkOverview(ProjectWorkOverviewRequestSchema.parse(request)),
      );
    },
  };
}

/** 当前桌面提供的类型化端口；调用时读取，避免持有上一窗口会话对象。 */
export const projectWorkOverviewApi: ProjectWorkOverviewApi = createProjectWorkOverviewApi({
  readProjectWorkOverview: (request) => projectApi().readProjectWorkOverview(request),
});
