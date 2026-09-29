import { defineStore } from 'pinia';

import type {
  ProjectWorkspaceBindingRef,
  ProjectWorkspaceResult,
  ProjectWorkspaceSnapshot,
  ProjectLinkedDirectory,
  ProjectLinkedDirectoriesResult,
} from '@shared/protocol/project-workspace.js';

import { projectWorkspaceApi } from '../sdk/projectWorkspace';
import {
  linkedDirectoryNotice,
  type DirectoryNotice,
  type LinkedDirectoryAction,
} from '../components/workspace/project-linked-directories';

type ProjectWorkspaceStatus = 'idle' | 'loading' | 'bound' | 'unbound' | 'unavailable' | 'error';
interface ProjectWorkspaceDisplay {
  projectId: string | null;
  status: ProjectWorkspaceStatus;
  snapshot: ProjectWorkspaceSnapshot | null;
}

export const useProjectWorkspaceStore = defineStore('project-workspace', {
  state: () => ({
    projectId: null as string | null,
    status: 'idle' as ProjectWorkspaceStatus,
    snapshot: null as ProjectWorkspaceSnapshot | null,
    generation: 0,
    pending: null as Promise<ProjectWorkspaceSnapshot | null> | null,
    directoryProjectId: null as string | null,
    directories: [] as ProjectLinkedDirectory[],
    directoryNotice: null as DirectoryNotice | null,
    directoryBusy: false,
    directoryGeneration: 0,
  }),
  getters: {
    binding(state): ProjectWorkspaceBindingRef | null {
      return state.snapshot?.status === 'bound' ? state.snapshot.binding : null;
    },
    displayName(state): string | null {
      return state.snapshot?.displayName ?? null;
    },
  },
  actions: {
    async openProject(collabProjectId: string): Promise<ProjectWorkspaceSnapshot | null> {
      if (this.directoryProjectId !== collabProjectId) this.clearDirectories();
      if (this.projectId === collabProjectId && this.pending && this.status === 'loading') {
        return this.pending;
      }
      const previous: ProjectWorkspaceDisplay = {
        projectId: this.projectId,
        status: this.status,
        snapshot: this.snapshot,
      };
      const generation = ++this.generation;
      this.projectId = collabProjectId;
      this.status = 'loading';
      this.snapshot = null;
      const request = this.resolveProject(collabProjectId, generation, previous);
      this.pending = request;
      try {
        return await request;
      } finally {
        if (generation === this.generation) this.pending = null;
      }
    },
    async ensureProject(collabProjectId: string): Promise<ProjectWorkspaceSnapshot | null> {
      if (this.projectId === collabProjectId) {
        if (this.pending) return this.pending;
        if (this.snapshot) return this.snapshot;
      }
      return this.openProject(collabProjectId);
    },
    /**
     * 执行入口必须重新向 Main 取精确 bindingId + revision，不能复用页面打开时的快照。
     * `ensureProject` 只适合展示层去重；发送、重试等有副作用的入口走这里。
     */
    async refreshProject(collabProjectId: string): Promise<ProjectWorkspaceSnapshot | null> {
      return this.openProject(collabProjectId);
    },
    async selectProject(collabProjectId: string): Promise<ProjectWorkspaceSnapshot | null> {
      return this.runSelection(collabProjectId, () => projectWorkspaceApi.select(collabProjectId));
    },
    /**
     * A3 控件对等（2026-09-22 放开）：从最近工作空间列表**直接点选**一个本地项目作为该协作项目
     * 偏好。仍经 Main 偏好服务的并行入口（`selectLocal`）——不弹系统选择器，但归属校验/失败回滚/
     * 偏好落库全在服务侧执行；⛔ 渲染层不直接操作绑定。
     */
    async selectLocalProject(
      collabProjectId: string,
      localProjectId: string,
    ): Promise<ProjectWorkspaceSnapshot | null> {
      return this.runSelection(collabProjectId, () =>
        projectWorkspaceApi.selectLocal(collabProjectId, localProjectId),
      );
    },
    /** select / selectLocal 共用的乐观切换 + 代次防串 + 取消回滚；只有绑定来源不同。 */
    async runSelection(
      collabProjectId: string,
      operation: () => Promise<ProjectWorkspaceResult>,
    ): Promise<ProjectWorkspaceSnapshot | null> {
      this.clearDirectories();
      const previous: ProjectWorkspaceDisplay = {
        projectId: this.projectId,
        status: this.status,
        snapshot: this.snapshot,
      };
      const generation = ++this.generation;
      this.pending = null;
      this.projectId = collabProjectId;
      this.status = 'loading';
      this.snapshot = null;
      try {
        const result = await operation();
        if (generation !== this.generation || this.projectId !== collabProjectId) return null;
        if (!result.ok) {
          if (
            previous.status !== 'loading' &&
            result.error.referenceCode === 'project-workspace:selectionCancelled'
          ) {
            this.$patch(previous);
            return null;
          }
          this.status = 'error';
          return null;
        }
        this.applySnapshot(result.snapshot);
        return result.snapshot;
      } catch {
        if (generation === this.generation && this.projectId === collabProjectId) {
          this.status = 'error';
        }
        return null;
      }
    },
    resetForAccountChange(): void {
      this.clearDirectories();
      this.generation += 1;
      this.projectId = null;
      this.status = 'idle';
      this.snapshot = null;
      this.pending = null;
    },
    clearDirectories(): void {
      this.directoryGeneration += 1;
      this.directoryProjectId = null;
      this.directories = [];
      this.directoryNotice = null;
      this.directoryBusy = false;
    },
    async refreshDirectories(projectId: string): Promise<void> {
      if (this.directoryProjectId !== projectId) this.clearDirectories();
      return this.runDirectoryAction(projectId, 'refresh', () =>
        projectWorkspaceApi.listDirectories(projectId),
      );
    },
    async addDirectory(projectId: string): Promise<void> {
      return this.runDirectoryAction(projectId, 'add', () =>
        projectWorkspaceApi.addDirectory(projectId),
      );
    },
    async removeDirectory(projectId: string, refId: string): Promise<void> {
      return this.runDirectoryAction(projectId, 'remove', () =>
        projectWorkspaceApi.removeDirectory(projectId, refId),
      );
    },
    /**
     * 本地绑定维度的只读关联目录（A3 / 更正2）：键 `bindingId`（当前窗口本地绑定 id），
     * 归属校验由 Main 强判 bindingId 命中当前窗口绑定。与协作侧共用同一份清单态与三态提示，
     * 差别只在授权维度：协作按 `collabProjectId`、本地按 `bindingId`，各走各的守卫。
     *
     * ⚠️ 本地侧**不**受协作 `this.projectId` 约束（那是协作项目的解析游标）：一个窗口可能先
     *    开过某协作项目、再切到本地任务管关联目录，若沿用协作守卫会被 `this.projectId` 命中而
     *    静默拦掉。所以按 `directoryProjectId(=bindingId)` 归属，见 `runLocalDirectoryAction`。
     */
    async refreshLocalDirectories(bindingId: string): Promise<void> {
      if (this.directoryProjectId !== bindingId) this.clearDirectories();
      return this.runLocalDirectoryAction(bindingId, 'refresh', () =>
        projectWorkspaceApi.listLocalDirectories(bindingId),
      );
    },
    async addLocalDirectory(bindingId: string): Promise<void> {
      return this.runLocalDirectoryAction(bindingId, 'add', () =>
        projectWorkspaceApi.addLocalDirectory(bindingId),
      );
    },
    async removeLocalDirectory(bindingId: string, refId: string): Promise<void> {
      return this.runLocalDirectoryAction(bindingId, 'remove', () =>
        projectWorkspaceApi.removeLocalDirectory(bindingId, refId),
      );
    },
    async runDirectoryAction(
      projectId: string,
      action: LinkedDirectoryAction,
      operation: () => Promise<ProjectLinkedDirectoriesResult>,
    ): Promise<void> {
      // 协作维度：受协作解析游标 `this.projectId` 约束（换项目即作废在途操作）。
      if (this.directoryBusy || (this.projectId !== null && this.projectId !== projectId)) return;
      return this.applyDirectoryOperation(projectId, action, operation);
    },
    async runLocalDirectoryAction(
      bindingId: string,
      action: LinkedDirectoryAction,
      operation: () => Promise<ProjectLinkedDirectoriesResult>,
    ): Promise<void> {
      // 本地维度：只按 `directoryProjectId(=bindingId)` 归属 + busy 闸，不看协作解析游标。
      if (
        this.directoryBusy ||
        (this.directoryProjectId !== null && this.directoryProjectId !== bindingId)
      )
        return;
      return this.applyDirectoryOperation(bindingId, action, operation);
    },
    /** 协作/本地共用的清单态推进：代次防串 + 归属回执核对 + 三态提示映射。 */
    async applyDirectoryOperation(
      key: string,
      action: LinkedDirectoryAction,
      operation: () => Promise<ProjectLinkedDirectoriesResult>,
    ): Promise<void> {
      this.directoryProjectId = key;
      const generation = ++this.directoryGeneration;
      this.directoryBusy = true;
      this.directoryNotice = null;
      try {
        const result = await operation();
        if (generation !== this.directoryGeneration || this.directoryProjectId !== key) return;
        this.directoryNotice = linkedDirectoryNotice(action, result);
        if (result.ok) this.directories = [...result.directories];
        else if (result.error.code === 'authentication') this.directories = [];
      } catch {
        if (generation === this.directoryGeneration) {
          this.directoryNotice = { tone: 'error', text: '关联目录操作未完成，请稍后重试。' };
        }
      } finally {
        if (generation === this.directoryGeneration) this.directoryBusy = false;
      }
    },
    async resolveProject(
      collabProjectId: string,
      generation: number,
      previous?: ProjectWorkspaceDisplay,
    ): Promise<ProjectWorkspaceSnapshot | null> {
      try {
        const result = await projectWorkspaceApi.resolve(collabProjectId);
        if (generation !== this.generation || this.projectId !== collabProjectId) return null;
        if (!result.ok) {
          // A cancelled Main transition leaves its authority intact. Restore only
          // the display, and still return null so execution cannot reuse old authority.
          if (
            previous &&
            previous.status !== 'loading' &&
            result.error.referenceCode === 'project-workspace:selectionCancelled'
          ) {
            this.$patch(previous);
            return null;
          }
          this.status = 'error';
          return null;
        }
        this.applySnapshot(result.snapshot);
        return result.snapshot;
      } catch {
        if (generation === this.generation && this.projectId === collabProjectId) {
          this.status = 'error';
        }
        return null;
      }
    },
    applySnapshot(snapshot: ProjectWorkspaceSnapshot): void {
      this.snapshot = snapshot;
      this.status = snapshot.status;
    },
  },
});
