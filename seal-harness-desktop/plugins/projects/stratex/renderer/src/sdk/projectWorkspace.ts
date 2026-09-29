import { projectApi } from '../../../../src/ui/runtime';
import type { ProjectWorkspaceRequest } from '@shared/protocol/project-workspace.js';

export const projectWorkspaceApi = Object.freeze({
  listDirectories: (collabProjectId: string) =>
    projectApi().listProjectLinkedDirectories({ collabProjectId }),
  addDirectory: (collabProjectId: string) =>
    projectApi().addProjectLinkedDirectory({ collabProjectId }),
  removeDirectory: (collabProjectId: string, refId: string) =>
    projectApi().removeProjectLinkedDirectory({ collabProjectId, refId }),
  /**
   * A3 本地侧：本地工作空间绑定的只读关联目录，键 bindingId（＝当前窗口本地绑定 id）。
   * ⚠️ 服务端强判 bindingId 命中当前窗口绑定，渲染层传对值只是前置便利、非授权依据。
   */
  listLocalDirectories: (bindingId: string) =>
    projectApi().listWorkspaceLinkedDirectories({ bindingId }),
  addLocalDirectory: (bindingId: string) =>
    projectApi().addWorkspaceLinkedDirectory({ bindingId }),
  removeLocalDirectory: (bindingId: string, refId: string) =>
    projectApi().removeWorkspaceLinkedDirectory({ bindingId, refId }),
  resolve: (collabProjectId: string) => {
    const request: ProjectWorkspaceRequest = { collabProjectId };
    return projectApi().resolveProjectWorkspace(request);
  },
  select: (collabProjectId: string) => {
    const request: ProjectWorkspaceRequest = { collabProjectId };
    return projectApi().selectProjectWorkspace(request);
  },
  /** A3 控件对等：从最近列表直接点选一个本地项目作为该协作项目偏好（经 Main 偏好服务）。 */
  selectLocal: (collabProjectId: string, localProjectId: string) =>
    projectApi().selectProjectLocalWorkspace({ collabProjectId, localProjectId }),
});
