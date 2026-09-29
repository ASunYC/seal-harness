import { defineStore } from 'pinia';
import type {
  ProjectSubmissionGate,
  ProjectSubmissionGateValues,
} from '@shared/protocol/project-submission-gate.js';
import { projectSubmissionGateApi } from '../sdk/projectSubmissionGate';
import { projectCollabErrorNotice } from './projectCollabErrors';

interface SubmissionGateScope {
  readonly projectId: string;
  readonly projectEpoch: number;
  readonly accountEpoch: number;
}

/** 规则草稿和服务端投影分开持有。 */
export const useProjectSubmissionGateStore = defineStore('projectSubmissionGate', {
  state: () => ({
    gate: null as ProjectSubmissionGate | null,
    draft: null as ProjectSubmissionGateValues | null,
    loading: false,
    saving: false,
    notice: null as string | null,
    projectId: null as string | null,
    epoch: 0,
    requestId: 0,
    draftRevision: 0,
    refreshRequired: false,
    scope: null as SubmissionGateScope | null,
  }),
  actions: {
    /** 两个约定入口共享草稿；仅真实账号或项目范围变更才清理。 */
    activateScope(scope: SubmissionGateScope): void {
      if (
        this.scope?.projectId === scope.projectId &&
        this.scope.projectEpoch === scope.projectEpoch &&
        this.scope.accountEpoch === scope.accountEpoch
      )
        return;
      this.reset();
      this.projectId = scope.projectId;
      this.scope = { ...scope };
    },
    async load(projectId: string): Promise<void> {
      if (this.projectId !== projectId) {
        this.reset();
        this.projectId = projectId;
      }
      const epoch = this.epoch;
      const requestId = ++this.requestId;
      this.loading = true;
      try {
        const result = await projectSubmissionGateApi.read({ projectId });
        if (epoch !== this.epoch || requestId !== this.requestId) return;
        if (result.ok) {
          this.gate = result.gate;
          this.refreshRequired = false;
          this.notice = null;
        } else {
          this.notice = `${result.message}（${result.referenceCode}）`;
          if (
            result.code === 'forbidden' ||
            result.code === 'authRequired' ||
            result.code === 'credentialRejected'
          )
            this.gate = null;
        }
      } catch {
        if (epoch === this.epoch && requestId === this.requestId)
          this.notice = projectCollabErrorNotice('transient').message;
      } finally {
        if (epoch === this.epoch && requestId === this.requestId) this.loading = false;
      }
    },
    async save(projectId: string): Promise<boolean> {
      if (
        this.saving ||
        this.loading ||
        this.refreshRequired ||
        this.projectId !== projectId ||
        !this.gate ||
        !this.draft
      )
        return false;
      const epoch = this.epoch;
      const revision = this.draftRevision;
      this.saving = true;
      this.notice = null;
      // 使任何写入前已出发的读取失效，避免旧响应覆盖本次权威结果。
      this.requestId += 1;
      try {
        const result = await projectSubmissionGateApi.update({
          projectId,
          submissionGate: { ...this.draft },
          expectedVersion: this.gate.ruleVersion,
        });
        if (epoch !== this.epoch) return false;
        if (result.ok) {
          this.requestId += 1;
          this.loading = false;
          this.gate = result.gate;
          if (revision === this.draftRevision) this.draft = null;
          return true;
        }
        this.notice = `${result.message}（${result.referenceCode}）`;
        if (
          result.code === 'forbidden' ||
          result.code === 'authRequired' ||
          result.code === 'credentialRejected'
        )
          this.gate = null;
        if (result.code === 'conflict') {
          this.refreshRequired = true;
          await this.load(projectId);
          if (epoch === this.epoch)
            this.notice = this.refreshRequired
              ? '规则已被更新，但刷新失败。草稿已保留，请刷新规则成功后再保存。'
              : '规则已被更新，草稿已保留。请核对当前版本后再次保存。';
        }
        return false;
      } catch {
        if (epoch === this.epoch) this.notice = projectCollabErrorNotice('transient').message;
        return false;
      } finally {
        if (epoch === this.epoch) this.saving = false;
      }
    },
    setDraft(value: ProjectSubmissionGateValues): void {
      this.draft = { ...value };
      this.draftRevision += 1;
    },
    reset(): void {
      const epoch = this.epoch + 1;
      this.$reset();
      this.epoch = epoch;
    },
  },
});
