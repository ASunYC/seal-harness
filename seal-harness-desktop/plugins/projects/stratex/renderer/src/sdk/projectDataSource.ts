import { projectApi } from '../../../../src/ui/runtime';
import type {
  ProjectDataSourceCreateRequest,
  ProjectDataSourceCreateResult,
  ProjectDataSourceDeleteRequest,
  ProjectDataSourceDeleteResult,
  ProjectDataSourceListRequest,
  ProjectDataSourceListResult,
  ProjectDataSourceSyncRequest,
  ProjectDataSourceSyncResult,
  ProjectDataSourceTicketClearRequest,
  ProjectDataSourceTicketResult,
  ProjectDataSourceTicketSaveRequest,
  ProjectDataSourceUpdateRequest,
  ProjectDataSourceUpdateResult,
  ProjectExternalLinkListRequest,
  ProjectExternalLinkListResult,
} from '@shared/protocol/project-datasource.js';

/**
 * renderer 消费项目组外部数据源能力（`project:data-source-*`）的唯一入口。
 *
 * 校验发生在 preload 桥两侧，此处只做薄转发（同 `projectCollab.ts` 口径）。
 * 【红线】渲染层不碰服务地址与平台令牌；外部访问票据也只在**保存那一次**经过这里，
 * 之后任何读路径都回不出它——同步请求里结构性没有票据字段。
 */
export const projectDataSourceApi = {
  list(request: ProjectDataSourceListRequest): Promise<ProjectDataSourceListResult> {
    return projectApi().listProjectDataSources(request);
  },
  create(request: ProjectDataSourceCreateRequest): Promise<ProjectDataSourceCreateResult> {
    return projectApi().createProjectDataSource(request);
  },
  update(request: ProjectDataSourceUpdateRequest): Promise<ProjectDataSourceUpdateResult> {
    return projectApi().updateProjectDataSource(request);
  },
  remove(request: ProjectDataSourceDeleteRequest): Promise<ProjectDataSourceDeleteResult> {
    return projectApi().deleteProjectDataSource(request);
  },
  /** 长动作：界面必须给「进行中」，不能点完没反应。 */
  sync(request: ProjectDataSourceSyncRequest): Promise<ProjectDataSourceSyncResult> {
    return projectApi().syncProjectDataSource(request);
  },
  saveTicket(request: ProjectDataSourceTicketSaveRequest): Promise<ProjectDataSourceTicketResult> {
    return projectApi().saveProjectDataSourceTicket(request);
  },
  clearTicket(
    request: ProjectDataSourceTicketClearRequest,
  ): Promise<ProjectDataSourceTicketResult> {
    return projectApi().clearProjectDataSourceTicket(request);
  },
  externalLinks(request: ProjectExternalLinkListRequest): Promise<ProjectExternalLinkListResult> {
    return projectApi().listProjectExternalLinks(request);
  },
};
