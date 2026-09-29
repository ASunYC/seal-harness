import { defineStore } from 'pinia';

import type { ProjectCollabErrorCode, ProjectDetail } from '@shared/protocol/project-collab.js';
import type {
  ProjectIterationCreateResult,
  ProjectMilestoneCreateResult,
  ProjectMilestoneListItem,
} from '@shared/protocol/project-planning.js';
import type {
  ProjectIterationDraft,
  ProjectMilestoneDraft,
  ProjectPlanningDraft,
} from '@shared/protocol/project-planning-draft.js';

import {
  activeMemberSubjects,
  criteriaLines,
  iterationFormProblem,
  milestoneFormProblem,
  planningDayKey,
  PLANNING_FORM_TEXT,
  type IterationFormDraft,
  type MilestoneFormDraft,
} from '../components/project/planning-form-view';
import { projectCollabApi } from '../sdk/projectCollab';
import { useProjectCollabStore } from './projectCollab';
import {
  projectCollabErrorNotice,
  projectCollabInfoNotice,
  type ProjectCollabNotice,
} from './projectCollabErrors';
import {
  iterationWriteFailureNotice,
  milestoneWriteFailureNotice,
} from './projectCollabPlanningForms';
import { useToastStore } from './toasts';

/**
 * 项目助理规划草案（mil-11，ADR-0045）的渲染层动作：取本会话草案、审阅、确认新建、忽略。
 *
 * ⭐ 确认新建走**手工新建同一个 sdk 方法**（`milestoneCreate` / `iterationCreate` → 同一条 IPC 与服务端路由），
 *    提交的是审阅表单的**当前值**（草案是模型产出的，用户可以改），幂等键取草案编号：
 *    同一份草案重复确认，服务端回放原行或回 `idempotency_conflict`，⛔ 不会建出第二条。
 * ⭐ 本地校验、失败文案与手工表单同一份（`milestoneFormProblem` / `iterationFormProblem`、
 *    `milestoneWriteFailureNotice` / `iterationWriteFailureNotice`）；草案路径只多两条：403 说清只有管理者和拥有者能调整，
 *    幂等冲突说这份草案已新建过。
 * ⚠️ 草案按会话取；换会话、换号的迟到响应一律不写回（`loadSequence` / 协作 store 的 `accountEpoch`）。
 */

export const PLANNING_DRAFT_TEXT = {
  cardTitle: '助手提出的规划草案',
  cardHint: '助手提出的草案，确认后才会新建。',
  milestoneKind: '里程碑草案',
  iterationKind: '迭代计划草案',
  reviewAction: '检查并确认',
  dismissAction: '忽略',
  milestoneReviewTitle: '确认里程碑草案',
  iterationReviewTitle: '确认迭代计划草案',
  reviewNote: '项目助理提出的草案，确认新建后才会出现在「里程碑」页。',
  parentMilestone: '所属里程碑',
  confirm: '确认新建',
  confirming: '新建中…',
  milestoneCreated: '里程碑已新建，可在项目「里程碑」页查看。',
  iterationCreated: '迭代计划已新建，可在项目「里程碑」页查看。',
  alreadyCreated: '这份草案已确认新建过，不会重复新建。',
  dismissed: '已忽略草案。',
} as const;

export interface PlanningDraftReview {
  readonly draftId: string;
  /** 里程碑草案的审阅表单（迭代计划草案为 null）。 */
  readonly milestone: MilestoneFormDraft | null;
  /** 迭代计划草案的审阅表单（里程碑草案为 null）。`requirementIds` 恒空：排需求不在草案范围。 */
  readonly iteration: IterationFormDraft | null;
  readonly saving: boolean;
  readonly notice: ProjectCollabNotice | null;
}

interface PlanningDraftsState {
  sessionId: string | null;
  drafts: ProjectPlanningDraft[];
  loadSequence: number;
  review: PlanningDraftReview | null;
  dismissingDraftId: string | null;
}

export type PlanningDraftConfirmOutcome = 'ok' | 'error';

function milestoneReviewDraft(draft: ProjectMilestoneDraft): MilestoneFormDraft {
  return {
    name: draft.name,
    objectiveMd: draft.objectiveMd,
    startAt: draft.startAt ?? '',
    dueAt: draft.dueAt ?? '',
    ownerSubject: draft.ownerSubject ?? '',
  };
}

function iterationReviewDraft(draft: ProjectIterationDraft): IterationFormDraft {
  return {
    name: draft.name,
    dueAt: draft.dueAt ?? '',
    ownerSubject: draft.ownerSubject ?? '',
    criteriaText: draft.criteriaMd,
    requirementIds: [],
  };
}

/** 草案确认失败的提示：403 说清谁能调整；其余与手工表单同一份映射。 */
function confirmFailureNotice(
  kind: ProjectPlanningDraft['kind'],
  failure: { readonly code: ProjectCollabErrorCode; readonly serverCode?: string | undefined },
): ProjectCollabNotice {
  if (
    failure.code === 'forbidden' &&
    (failure.serverCode === undefined || failure.serverCode === 'forbidden')
  ) {
    return projectCollabErrorNotice('forbidden', PLANNING_FORM_TEXT.readOnly);
  }
  return kind === 'milestone'
    ? milestoneWriteFailureNotice(failure)
    : iterationWriteFailureNotice(failure);
}

function milestonePeriod(milestone: ProjectMilestoneListItem | undefined) {
  if (milestone === undefined) return {};
  return {
    start: planningDayKey(milestone.startAt),
    end: planningDayKey(milestone.dueAt),
  };
}

/** 审阅表单的本地校验：与手工新建同一套判定（新建没有「活行负责人」，负责人一旦设置就判在册）。 */
function reviewProblem(
  draft: ProjectPlanningDraft,
  review: PlanningDraftReview,
  context: {
    readonly detail: ProjectDetail;
    readonly milestones: readonly ProjectMilestoneListItem[];
  },
): string | null {
  const memberSubjects = activeMemberSubjects(context.detail.members);
  if (draft.kind === 'milestone') {
    return review.milestone === null
      ? PLANNING_FORM_TEXT.milestoneRequired
      : milestoneFormProblem(review.milestone, {
          selfId: null,
          milestones: context.milestones,
          iterationDueDays: [],
          memberSubjects,
          currentOwnerSubject: '',
        });
  }
  return review.iteration === null
    ? PLANNING_FORM_TEXT.iterationRequired
    : iterationFormProblem(review.iteration, {
        period: milestonePeriod(context.milestones.find((row) => row.id === draft.milestoneId)),
        memberSubjects,
        currentOwnerSubject: '',
      });
}

type DraftCreateResult = ProjectMilestoneCreateResult | ProjectIterationCreateResult;

/**
 * 按草案种类拼出与手工新建**同形**的新建请求（名称去首尾空白、负责人空串即不指派、完成标准按行拼接），
 * 幂等键取草案编号。表单缺席（不该发生）⇒ null。
 */
function draftSubmitter(
  draft: ProjectPlanningDraft,
  review: PlanningDraftReview,
): (() => Promise<DraftCreateResult>) | null {
  if (draft.kind === 'milestone') {
    const form = review.milestone;
    if (form === null) return null;
    return () =>
      projectCollabApi.milestoneCreate({
        projectId: draft.projectId,
        clientRequestId: draft.draftId,
        name: form.name.trim(),
        objectiveMd: form.objectiveMd.trim(),
        ownerSubject: form.ownerSubject || null,
        startAt: form.startAt,
        dueAt: form.dueAt,
      });
  }
  const form = review.iteration;
  if (form === null) return null;
  return () =>
    projectCollabApi.iterationCreate({
      projectId: draft.projectId,
      milestoneId: draft.milestoneId,
      clientRequestId: draft.draftId,
      name: form.name.trim(),
      dueAt: form.dueAt,
      ownerSubject: form.ownerSubject || null,
      criteriaMd: criteriaLines(form.criteriaText).join('\n'),
    });
}

export const useProjectPlanningDraftsStore = defineStore('projectPlanningDrafts', {
  state: (): PlanningDraftsState => ({
    sessionId: null,
    drafts: [],
    loadSequence: 0,
    review: null,
    dismissingDraftId: null,
  }),
  getters: {
    reviewDraft(state): ProjectPlanningDraft | null {
      const review = state.review;
      return review === null
        ? null
        : (state.drafts.find((draft) => draft.draftId === review.draftId) ?? null);
    },
  },
  actions: {
    /** 取本会话待审阅草案。换会话即清空旧的；迟到响应（换会话 / reset / 换号）不写回。 */
    async load(sessionId: string): Promise<void> {
      const collab = useProjectCollabStore();
      const sequence = ++this.loadSequence;
      if (this.sessionId !== sessionId) {
        this.sessionId = sessionId;
        this.drafts = [];
        this.review = null;
      }
      const accountEpoch = collab.accountEpoch;
      const current = () =>
        sequence === this.loadSequence &&
        this.sessionId === sessionId &&
        accountEpoch === collab.accountEpoch;
      try {
        const result = await projectCollabApi.planningDraftList({ sessionId });
        if (!current()) return;
        if (!result.ok) {
          // 会话不属于当前账号、未登录：⛔ 不留任何草案；网络抖动等保留已取到的。
          if (result.code === 'rejected' || result.code === 'authRequired') {
            this.drafts = [];
            this.review = null;
          }
          return;
        }
        this.drafts = [...result.drafts];
        const review = this.review;
        if (
          review !== null &&
          !review.saving &&
          !result.drafts.some((draft) => draft.draftId === review.draftId)
        ) {
          this.review = null;
        }
      } catch {
        // 取不到就维持现状：卡片不因一次抖动凭空出现或消失。
      }
    },

    /** 换号 / 离开项目会话：清空并作废在途请求。 */
    reset(): void {
      this.loadSequence += 1;
      this.sessionId = null;
      this.drafts = [];
      this.review = null;
      this.dismissingDraftId = null;
    },

    openReview(draftId: string): void {
      const draft = this.drafts.find((item) => item.draftId === draftId);
      if (draft === undefined) return;
      this.review = {
        draftId,
        milestone: draft.kind === 'milestone' ? milestoneReviewDraft(draft) : null,
        iteration: draft.kind === 'iteration' ? iterationReviewDraft(draft) : null,
        saving: false,
        notice: null,
      };
    },

    closeReview(): void {
      if (this.review?.saving) return;
      this.review = null;
    },

    setMilestoneField(field: keyof MilestoneFormDraft, value: string): void {
      const review = this.review;
      if (review === null || review.milestone === null) return;
      this.review = { ...review, milestone: { ...review.milestone, [field]: value } };
    },

    setIterationField(
      field: Exclude<keyof IterationFormDraft, 'requirementIds'>,
      value: string,
    ): void {
      const review = this.review;
      if (review === null || review.iteration === null) return;
      this.review = { ...review, iteration: { ...review.iteration, [field]: value } };
    },

    /**
     * 确认新建：本地校验 → 手工新建同一个 sdk 方法（幂等键＝草案编号）→ 成功或已新建过则清暂存。
     * ⛔ 失败只写提示，从不碰表单输入；换号后迟到的结果一律丢弃。
     */
    async confirmReview(): Promise<PlanningDraftConfirmOutcome> {
      const review = this.review;
      const sessionId = this.sessionId;
      const draft = this.reviewDraft;
      if (review === null || review.saving || sessionId === null || draft === null) return 'error';
      const collab = useProjectCollabStore();
      const detail = collab.activeProjectId === draft.projectId ? collab.detail : null;
      if (detail === null || !collab.canManagePlanning) {
        this.review = { ...review, notice: projectCollabInfoNotice(PLANNING_FORM_TEXT.readOnly) };
        return 'error';
      }
      const problem = reviewProblem(draft, review, { detail, milestones: collab.milestones });
      const submit = draftSubmitter(draft, review);
      if (problem !== null || submit === null) {
        this.review = {
          ...review,
          notice: projectCollabInfoNotice(problem ?? PLANNING_FORM_TEXT.readOnly),
        };
        return 'error';
      }
      this.review = { ...review, saving: true, notice: null };
      const accountEpoch = collab.accountEpoch;
      const stillCurrent = () =>
        accountEpoch === collab.accountEpoch &&
        this.sessionId === sessionId &&
        this.review?.draftId === draft.draftId;
      try {
        const result = await submit();
        if (!stillCurrent()) return 'error';
        if (result.ok) {
          await this.settleConfirmed(sessionId, draft, false);
          return 'ok';
        }
        if (result.serverCode === 'idempotency_conflict') {
          await this.settleConfirmed(sessionId, draft, true);
          return 'ok';
        }
        this.writeReviewNotice(draft.draftId, confirmFailureNotice(draft.kind, result));
        return 'error';
      } catch {
        if (stillCurrent()) {
          this.writeReviewNotice(draft.draftId, projectCollabErrorNotice('transient'));
        }
        return 'error';
      } finally {
        const latest = this.review;
        if (latest !== null && latest.draftId === draft.draftId && latest.saving) {
          this.review = { ...latest, saving: false };
        }
      }
    },

    /** 忽略一份草案：清主进程暂存（dismissed）；清不掉就重取，以主进程为准。 */
    async dismiss(draftId: string): Promise<void> {
      const sessionId = this.sessionId;
      if (sessionId === null || this.dismissingDraftId !== null) return;
      const collab = useProjectCollabStore();
      const accountEpoch = collab.accountEpoch;
      this.dismissingDraftId = draftId;
      try {
        const result = await projectCollabApi.planningDraftDiscard({
          sessionId,
          draftId,
          outcome: 'dismissed',
        });
        if (accountEpoch !== collab.accountEpoch || this.sessionId !== sessionId) return;
        if (!result.ok) {
          await this.load(sessionId);
          return;
        }
        this.removeDraft(draftId);
        useToastStore().push({ level: 'info', text: PLANNING_DRAFT_TEXT.dismissed });
      } catch {
        if (accountEpoch === collab.accountEpoch && this.sessionId === sessionId) {
          await this.load(sessionId);
        }
      } finally {
        this.dismissingDraftId = null;
      }
    },

    async settleConfirmed(
      sessionId: string,
      draft: ProjectPlanningDraft,
      alreadyCreated: boolean,
    ): Promise<void> {
      this.removeDraft(draft.draftId);
      useToastStore().push({
        level: 'info',
        text: alreadyCreated
          ? PLANNING_DRAFT_TEXT.alreadyCreated
          : draft.kind === 'milestone'
            ? PLANNING_DRAFT_TEXT.milestoneCreated
            : PLANNING_DRAFT_TEXT.iterationCreated,
      });
      const collab = useProjectCollabStore();
      if (collab.activeProjectId === draft.projectId) void collab.loadMilestones(draft.projectId);
      try {
        // 清不掉也不回滚：本地已移出，下次取回来再确认时服务端回放或回幂等冲突，不会重复新建。
        await projectCollabApi.planningDraftDiscard({
          sessionId,
          draftId: draft.draftId,
          outcome: 'confirmed',
        });
      } catch {
        // 同上：暂存区只活在主进程内存里，清除失败不影响已完成的新建。
      }
    },

    removeDraft(draftId: string): void {
      this.drafts = this.drafts.filter((draft) => draft.draftId !== draftId);
      if (this.review?.draftId === draftId) this.review = null;
    },

    writeReviewNotice(draftId: string, notice: ProjectCollabNotice): void {
      const review = this.review;
      if (review !== null && review.draftId === draftId) this.review = { ...review, notice };
    },
  },
});
