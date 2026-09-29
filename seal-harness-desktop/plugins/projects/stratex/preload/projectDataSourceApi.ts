import type { ProjectApi } from '../shared/ipc/api.js';
import { IPC } from '../shared/ipc/channels.js';
import {
  ProjectDataSourceCreateRequestSchema,
  ProjectDataSourceCreateResultSchema,
  ProjectDataSourceDeleteRequestSchema,
  ProjectDataSourceDeleteResultSchema,
  ProjectDataSourceListRequestSchema,
  ProjectDataSourceListResultSchema,
  ProjectDataSourceSyncRequestSchema,
  ProjectDataSourceSyncResultSchema,
  ProjectDataSourceTicketClearRequestSchema,
  ProjectDataSourceTicketResultSchema,
  ProjectDataSourceTicketSaveRequestSchema,
  ProjectDataSourceUpdateRequestSchema,
  ProjectDataSourceUpdateResultSchema,
  ProjectExternalLinkListRequestSchema,
  ProjectExternalLinkListResultSchema,
} from '../shared/protocol/project-datasource.js';

/**
 * 项目组**外部数据源**（`project:data-source-*`）的预加载桥。
 *
 * 纪律同全局：入参在此收敛、出参在此校验（边界两侧都不信任对方）。
 * 同步请求的 schema 里没有票据字段——渲染层即便想塞也塞不进（strictObject 拒多余键），
 * 票据的唯一上行路径是用户亲手填写的那一次保存。
 */

export type ProjectDataSourceApi = Pick<
  ProjectApi,
  | 'listProjectDataSources'
  | 'createProjectDataSource'
  | 'updateProjectDataSource'
  | 'deleteProjectDataSource'
  | 'syncProjectDataSource'
  | 'saveProjectDataSourceTicket'
  | 'clearProjectDataSourceTicket'
  | 'listProjectExternalLinks'
>;

export type ProjectDataSourceInvoke = (channel: string, request: unknown) => Promise<unknown>;

export function createProjectDataSourcePreloadApi(
  invoke: ProjectDataSourceInvoke,
): ProjectDataSourceApi {
  const api: ProjectDataSourceApi = {
    listProjectDataSources: async (input) =>
      ProjectDataSourceListResultSchema.parse(
        await invoke(IPC.PROJECT_DATA_SOURCE_LIST, ProjectDataSourceListRequestSchema.parse(input)),
      ),
    createProjectDataSource: async (input) =>
      ProjectDataSourceCreateResultSchema.parse(
        await invoke(
          IPC.PROJECT_DATA_SOURCE_CREATE,
          ProjectDataSourceCreateRequestSchema.parse(input),
        ),
      ),
    updateProjectDataSource: async (input) =>
      ProjectDataSourceUpdateResultSchema.parse(
        await invoke(
          IPC.PROJECT_DATA_SOURCE_UPDATE,
          ProjectDataSourceUpdateRequestSchema.parse(input),
        ),
      ),
    deleteProjectDataSource: async (input) =>
      ProjectDataSourceDeleteResultSchema.parse(
        await invoke(
          IPC.PROJECT_DATA_SOURCE_DELETE,
          ProjectDataSourceDeleteRequestSchema.parse(input),
        ),
      ),
    syncProjectDataSource: async (input) =>
      ProjectDataSourceSyncResultSchema.parse(
        await invoke(IPC.PROJECT_DATA_SOURCE_SYNC, ProjectDataSourceSyncRequestSchema.parse(input)),
      ),
    saveProjectDataSourceTicket: async (input) =>
      ProjectDataSourceTicketResultSchema.parse(
        await invoke(
          IPC.PROJECT_DATA_SOURCE_TICKET_SAVE,
          ProjectDataSourceTicketSaveRequestSchema.parse(input),
        ),
      ),
    clearProjectDataSourceTicket: async (input) =>
      ProjectDataSourceTicketResultSchema.parse(
        await invoke(
          IPC.PROJECT_DATA_SOURCE_TICKET_CLEAR,
          ProjectDataSourceTicketClearRequestSchema.parse(input),
        ),
      ),
    listProjectExternalLinks: async (input) =>
      ProjectExternalLinkListResultSchema.parse(
        await invoke(
          IPC.PROJECT_EXTERNAL_LINK_LIST,
          ProjectExternalLinkListRequestSchema.parse(input),
        ),
      ),
  };
  return Object.freeze(api);
}
