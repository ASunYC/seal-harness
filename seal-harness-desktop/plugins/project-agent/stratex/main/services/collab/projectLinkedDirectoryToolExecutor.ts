import {
  ProjectLinkedDirectoryListArgumentsSchema as listSchema,
  ProjectLinkedDirectorySearchArgumentsSchema as searchSchema,
  ProjectLinkedDirectoryReadArgumentsSchema as readSchema,
} from '../../../../../projects/stratex/shared/protocol/project-workspace.js';
type AccountKey = string;
type WorkspaceBindingRef = { bindingId: string; revision: number };
import type { ProjectCollabToolResponse as WorkspaceDynamicToolResult } from './projectCollabToolContract.js';
import type { ProjectCollabToolBinding } from './projectCollabToolContract.js';
import type { ProjectLinkedDirectoryService } from '../projectWorkspacePreferenceLinkedDirectories.js';
import type { ProjectLinkedDirectoryReadAccess } from './projectLinkedDirectoryReadAccess.js';

export interface ProjectLinkedDirectoryToolScope {
  readonly sessionId: string;
  readonly accountKey: AccountKey;
  readonly collabProjectId: string;
  readonly binding: WorkspaceBindingRef;
  readonly workspaceRoot: string;
}

export interface ProjectLinkedDirectoryToolInput extends Omit<
  ProjectLinkedDirectoryToolScope,
  'collabProjectId'
> {
  readonly projectBinding: ProjectCollabToolBinding;
  readonly signal: AbortSignal;
  readonly assertCurrent: () => void;
  readonly tool: string;
  readonly arguments: unknown;
}

interface ProjectLinkedDirectoryToolDependencies {
  readonly service: Pick<ProjectLinkedDirectoryService, 'list' | 'captureReferences'>;
  readonly readAccess: Pick<ProjectLinkedDirectoryReadAccess, 'list' | 'search' | 'read'>;
  /** Fresh membership and workspace binding checks, never a cached authorization verdict. */
  readonly isAuthorized: (scope: ProjectLinkedDirectoryToolScope) => Promise<boolean>;
}

function failure(text: string): WorkspaceDynamicToolResult {
  return { success: false, contentItems: [{ type: 'inputText', text }] };
}

/** A read-only adapter: authority is provided by Main; model arguments never select an account or root. */
export class ProjectLinkedDirectoryToolExecutor {
  constructor(private readonly dependencies: ProjectLinkedDirectoryToolDependencies) {}

  async execute(input: ProjectLinkedDirectoryToolInput): Promise<WorkspaceDynamicToolResult> {
    const scope: ProjectLinkedDirectoryToolScope = {
      accountKey: input.accountKey,
      sessionId: input.sessionId,
      collabProjectId: input.projectBinding.projectId,
      binding: input.binding,
      workspaceRoot: input.workspaceRoot,
    };
    const isCurrentContext = (): boolean => {
      try {
        input.assertCurrent();
        return !input.signal.aborted && input.projectBinding.isCurrentContext();
      } catch {
        return false;
      }
    };
    const isAuthorized = async (): Promise<boolean> =>
      isCurrentContext() && (await this.dependencies.isAuthorized(scope)) && isCurrentContext();
    const finalReadChecks: (() => void)[] = [];
    const context = {
      ...scope,
      isCurrentContext,
      isAuthorized,
      registerFinalReadCheck: (check: () => void): void => {
        finalReadChecks.push(check);
      },
    };
    try {
      if (!(await isAuthorized()))
        return failure('账号、项目或工作空间已变化，关联目录读取已停止。');
      const referencesAreCurrent = this.dependencies.service.captureReferences(context);
      const result = await this.read(context, input.tool, input.arguments);
      if (!(await isAuthorized()) || !referencesAreCurrent())
        return failure('账号、项目或工作空间已变化，关联目录读取已停止。');
      for (const check of finalReadChecks) check();
      if (!result) return failure('关联目录参数无效；请使用已授权的目录编号和相对路径。');
      const text = JSON.stringify(result);
      // The wire limit includes JSON escaping. Never split a JSON result into invalid fragments.
      if (Buffer.byteLength(text, 'utf8') > 60 * 1024) {
        return failure('关联目录结果过大；请缩小读取范围或减少返回数量。');
      }
      return { success: result.ok, contentItems: [{ type: 'inputText', text }] };
    } catch {
      // Filesystem paths and remote error bodies must not escape into the model conversation.
      return failure('关联目录当前不可读取，请重新检查目录授权及项目权限。');
    }
  }

  private async read(
    context: Parameters<ProjectLinkedDirectoryService['list']>[0],
    tool: string,
    args: unknown,
  ) {
    if (tool === 'project_list_reference_files') {
      const parsed = listSchema.safeParse(args);
      if (!parsed.success) return null;
      if (!parsed.data.refId) {
        if (parsed.data.relativePath !== undefined || parsed.data.limit !== undefined) return null;
        return this.dependencies.service.list(context);
      }
      return this.dependencies.readAccess.list(context, {
        ...parsed.data,
        refId: parsed.data.refId,
      });
    }
    if (tool === 'project_search_reference_files') {
      const parsed = searchSchema.safeParse(args);
      return parsed.success ? this.dependencies.readAccess.search(context, parsed.data) : null;
    }
    if (tool === 'project_read_reference_file') {
      const parsed = readSchema.safeParse(args);
      return parsed.success ? this.dependencies.readAccess.read(context, parsed.data) : null;
    }
    return null;
  }
}
