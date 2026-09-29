import type { ProjectApi } from '../shared/ipc/api.js';
import { IPC } from '../shared/ipc/channels.js';
import {
  ProjectWorkspaceRequestSchema,
  ProjectWorkspaceSelectLocalRequestSchema,
  ProjectWorkspaceResultSchema,
  ProjectLinkedDirectoriesResultSchema,
  ProjectLinkedDirectoryListRequestSchema,
  ProjectLinkedDirectoryAddRequestSchema,
  ProjectLinkedDirectoryRemoveRequestSchema,
  WorkspaceLinkedDirectoryListRequestSchema,
  WorkspaceLinkedDirectoryAddRequestSchema,
  WorkspaceLinkedDirectoryRemoveRequestSchema,
} from '../shared/protocol/project-workspace.js';

type ProjectWorkspaceApi = Pick<
  ProjectApi,
  | 'resolveProjectWorkspace'
  | 'selectProjectWorkspace'
  | 'selectProjectLocalWorkspace'
  | 'listProjectLinkedDirectories'
  | 'addProjectLinkedDirectory'
  | 'removeProjectLinkedDirectory'
  | 'listWorkspaceLinkedDirectories'
  | 'addWorkspaceLinkedDirectory'
  | 'removeWorkspaceLinkedDirectory'
>;

export function createProjectWorkspacePreloadApi(
  invoke: (channel: string, request: unknown) => Promise<unknown>,
): ProjectWorkspaceApi {
  const invokeProjectWorkspace = async (
    channel: typeof IPC.PROJECT_WORKSPACE_RESOLVE | typeof IPC.PROJECT_WORKSPACE_SELECT,
    input: unknown,
  ) =>
    ProjectWorkspaceResultSchema.parse(
      await invoke(channel, ProjectWorkspaceRequestSchema.parse(input)),
    );

  return Object.freeze({
    listProjectLinkedDirectories: async (input) =>
      ProjectLinkedDirectoriesResultSchema.parse(
        await invoke(
          IPC.PROJECT_LINKED_DIRECTORY_LIST,
          ProjectLinkedDirectoryListRequestSchema.parse(input),
        ),
      ),
    addProjectLinkedDirectory: async (input) =>
      ProjectLinkedDirectoriesResultSchema.parse(
        await invoke(
          IPC.PROJECT_LINKED_DIRECTORY_ADD,
          ProjectLinkedDirectoryAddRequestSchema.parse(input),
        ),
      ),
    removeProjectLinkedDirectory: async (input) =>
      ProjectLinkedDirectoriesResultSchema.parse(
        await invoke(
          IPC.PROJECT_LINKED_DIRECTORY_REMOVE,
          ProjectLinkedDirectoryRemoveRequestSchema.parse(input),
        ),
      ),
    resolveProjectWorkspace: (input) =>
      invokeProjectWorkspace(IPC.PROJECT_WORKSPACE_RESOLVE, input),
    selectProjectWorkspace: (input) => invokeProjectWorkspace(IPC.PROJECT_WORKSPACE_SELECT, input),
    selectProjectLocalWorkspace: async (input) =>
      ProjectWorkspaceResultSchema.parse(
        await invoke(
          IPC.PROJECT_WORKSPACE_SELECT_LOCAL,
          ProjectWorkspaceSelectLocalRequestSchema.parse(input),
        ),
      ),
    listWorkspaceLinkedDirectories: async (input) =>
      ProjectLinkedDirectoriesResultSchema.parse(
        await invoke(
          IPC.WORKSPACE_LINKED_DIRECTORY_LIST,
          WorkspaceLinkedDirectoryListRequestSchema.parse(input),
        ),
      ),
    addWorkspaceLinkedDirectory: async (input) =>
      ProjectLinkedDirectoriesResultSchema.parse(
        await invoke(
          IPC.WORKSPACE_LINKED_DIRECTORY_ADD,
          WorkspaceLinkedDirectoryAddRequestSchema.parse(input),
        ),
      ),
    removeWorkspaceLinkedDirectory: async (input) =>
      ProjectLinkedDirectoriesResultSchema.parse(
        await invoke(
          IPC.WORKSPACE_LINKED_DIRECTORY_REMOVE,
          WorkspaceLinkedDirectoryRemoveRequestSchema.parse(input),
        ),
      ),
  });
}
