import { projectApi } from '../../../../src/ui/runtime';
import type {
  ProjectDictionaryListRequest,
  ProjectDictionaryListResult,
} from '@shared/protocol/project-dictionary-api.js';

export const projectDictionariesApi = {
  list(request: ProjectDictionaryListRequest): Promise<ProjectDictionaryListResult> {
    return projectApi().listProjectDictionaries(request);
  },
};
