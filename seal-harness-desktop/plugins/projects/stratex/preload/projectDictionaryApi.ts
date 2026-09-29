import type { ProjectApi } from '../shared/ipc/api.js';
import { IPC } from '../shared/ipc/channels.js';
import {
  ProjectDictionaryListRequestSchema,
  ProjectDictionaryListResultSchema,
} from '../shared/protocol/project-dictionary-api.js';

export function createProjectDictionaryPreloadApi(
  invoke: (channel: string, request: unknown) => Promise<unknown>,
): Pick<ProjectApi, 'listProjectDictionaries'> {
  return {
    listProjectDictionaries: async (input) =>
      ProjectDictionaryListResultSchema.parse(
        await invoke(IPC.PROJECT_DICTIONARY_LIST, ProjectDictionaryListRequestSchema.parse(input)),
      ),
  };
}
