import { projectApi } from '../../../../src/ui/runtime';
import type {
  ProjectTodoCollaboratorsRequest,
  ProjectTodoCollaboratorsResult,
  ProjectTodoCollaboratorsReplaceRequest,
  ProjectTodoCollaboratorsReplaceResult,
  ProjectTodoCommentsRequest,
  ProjectTodoCommentsResult,
  ProjectTodoCommentCreateRequest,
  ProjectTodoCommentCreateResult,
  ProjectTodoDeletePreviewRequest,
  ProjectTodoDeletePreviewResult,
} from '@shared/protocol/project-todo-collaboration.js';

/** 仅调用类型化 preload；身份与网络始终由 Main 管理。 */
export const projectTodoCollaborationApi = {
  collaborators(request: ProjectTodoCollaboratorsRequest): Promise<ProjectTodoCollaboratorsResult> {
    return projectApi().getProjectTodoCollaborators(request);
  },
  replaceCollaborators(
    request: ProjectTodoCollaboratorsReplaceRequest,
  ): Promise<ProjectTodoCollaboratorsReplaceResult> {
    return projectApi().replaceProjectTodoCollaborators(request);
  },
  comments(request: ProjectTodoCommentsRequest): Promise<ProjectTodoCommentsResult> {
    return projectApi().listProjectTodoComments(request);
  },
  createComment(request: ProjectTodoCommentCreateRequest): Promise<ProjectTodoCommentCreateResult> {
    return projectApi().createProjectTodoComment(request);
  },
  deletePreview(request: ProjectTodoDeletePreviewRequest): Promise<ProjectTodoDeletePreviewResult> {
    return projectApi().previewProjectTodoDeletion(request);
  },
};
