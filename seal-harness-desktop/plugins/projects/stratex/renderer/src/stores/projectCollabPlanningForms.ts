import type { ProjectCollabErrorCode } from '@shared/protocol/project-collab.js';
import {
  projectIterationUpdateServerCodeText,
  projectMilestoneWriteServerCodeText,
  type ProjectIterationListItem,
  type ProjectMilestoneListItem,
} from '@shared/protocol/project-planning.js';

import {
  activeMemberSubjects,
  criteriaLines,
  departedOwnerHint,
  iterationFormDraftFrom,
  iterationFormProblem,
  milestoneFormDraftFrom,
  milestoneFormProblem,
  planningDayKey,
  PLANNING_FORM_TEXT,
  type IterationFormDraft,
  type MilestoneFormDraft,
} from '../components/project/planning-form-view';
import { projectCollabApi } from '../sdk/projectCollab';
import {
  projectCollabErrorNotice,
  projectCollabInfoNotice,
  type ProjectCollabNotice,
} from './projectCollabErrors';
import {
  loadMilestoneIterations,
  loadMilestones,
  type ProjectPlanningHost,
} from './projectCollabPlanning';
import {
  archivePlanningSubject,
  planningFailureNotice,
  type PlanningLifecycleHost,
} from './projectCollabPlanningLifecycle';
import {
  loadRequirementPlacements,
  loadUnscheduledRequirementTotal,
  requirementScheduleItemsForIteration,
  saveRequirementScheduleItems,
  type RequirementScheduleHost,
} from './projectCollabRequirementSchedule';
import type { ProjectCollabState } from './projectCollabState';

/**
 * 里程碑页写入口（MIL-09）：新建 / 编辑 / 归档里程碑与迭代计划的弹层动作。
 *
 * 判据载体全部落在这里（组件只做绑定）：
 *  - **本地校验逐字照原型**（`planning-form-view`）：没过就不发请求，提示落在弹层里；
 *  - **409 保留表单输入并提示刷新**：失败分支只写 `notice`，⛔ 从不碰 `draft`；版本冲突就地重取列表，
 *    下一次提交读活行上的新版本；
 *  - **切目标不串数据**：弹层态只属一个目标，打开另一个目标就是一份新草稿；
 *  - **改名不改 UUID 与关联**：编辑走 PATCH，同一个 id；
 *  - **归档连带移出在排需求**：复用生命周期那一处的归档动作；确认框沿用原型用词说清「仍可在历史中查看、
 *    在排需求一并移出」，⛔ 不显示条数（ADR-0040 取代 ADR-0038 决策 5），⛔ 不提恢复（界面没有恢复入口）；
 *  - **负责人只在设置 / 更换时判在册**：原负责人已离开项目时给非阻塞提示「负责人已离开项目，请改派」；
 *  - **仅管理者 / 拥有者**：`canPlan` 为假时打开即拒（入口本身由组件按 `canManagePlanning` 收起；
 *    真正的门在服务端）。
 */
export type PlanningFormsHost = PlanningLifecycleHost &
  RequirementScheduleHost &
  Pick<ProjectCollabState, 'detail' | 'milestoneForm' | 'iterationForm' | 'planningPageNotice'>;

export type PlanningFormOutcome = 'ok' | 'conflict' | 'error';

function newRequestId(): string {
  return crypto.randomUUID();
}

/**
 * 判负责人在册用的主体集合：**只算在册（active）成员**，与负责人下拉同一口径（mil-11 D5）。
 * 受邀未加入、已移出的人服务端以 `owner_not_member` 拒收，本地先挡、不白跑一趟。
 */
function memberSubjects(host: Pick<ProjectCollabState, 'detail'>): ReadonlySet<string> {
  return activeMemberSubjects(host.detail?.members ?? []);
}

/** 请求号复用规则（与生命周期弹层同一条）：这份内容与上一次随行的一样（或还没发过）⇒ 复用，否则换号。 */
function requestIdFor(
  current: { readonly clientRequestId: string; readonly sentFingerprint: string | null },
  fingerprint: string,
): string {
  return current.sentFingerprint === null || current.sentFingerprint === fingerprint
    ? current.clientRequestId
    : newRequestId();
}

/* ══ 里程碑 ══════════════════════════════════════════════════════════════════ */

export function openMilestoneForm(
  host: PlanningFormsHost,
  projectId: string,
  milestone: ProjectMilestoneListItem | null,
  canPlan: boolean,
): void {
  if (!canPlan) return;
  host.milestoneForm = {
    milestoneId: milestone?.id ?? null,
    draft: milestoneFormDraftFrom(milestone),
    clientRequestId: newRequestId(),
    sentFingerprint: null,
    saving: false,
    confirmArchive: false,
    notice: null,
  };
  // 「周期需覆盖已有迭代日期」要看这个目标下的全部轮次：没取过就补取（展开过的目标已有缓存）。
  if (milestone !== null && host.milestoneIterations[milestone.id] === undefined) {
    void loadMilestoneIterations(host, projectId, milestone.id);
  }
}

export function setMilestoneFormDraft(
  host: PlanningFormsHost,
  patch: Partial<MilestoneFormDraft>,
): void {
  const form = host.milestoneForm;
  if (form === null) return;
  host.milestoneForm = { ...form, draft: { ...form.draft, ...patch } };
}

export function closeMilestoneForm(host: PlanningFormsHost): void {
  host.milestoneForm = null;
}

export function setMilestoneArchiveConfirm(host: PlanningFormsHost, confirm: boolean): void {
  const form = host.milestoneForm;
  if (form === null || form.milestoneId === null) return;
  host.milestoneForm = { ...form, confirmArchive: confirm, notice: null };
}

function openIterationDueDays(rows: readonly ProjectIterationListItem[] | undefined): string[] {
  return (rows ?? [])
    .filter((row) => row.archivedAt === null && row.dueAt !== null)
    .map((row) => planningDayKey(row.dueAt))
    .filter(Boolean);
}

/** 正在编辑的里程碑**活行**上的负责人（新建为空串）：负责人没改就不判在册（ADR-0040）。 */
function milestoneFormCurrentOwner(host: PlanningFormsHost): string {
  const milestoneId = host.milestoneForm?.milestoneId ?? null;
  if (milestoneId === null) return '';
  return host.milestones.find((row) => row.id === milestoneId)?.ownerSubject ?? '';
}

/** 正在编辑的迭代计划**活行**上的负责人（新建为空串）。 */
function iterationFormCurrentOwner(host: PlanningFormsHost): string {
  const form = host.iterationForm;
  if (form === null || form.iterationId === null) return '';
  return iterationRowFor(host, form.milestoneId, form.iterationId)?.ownerSubject ?? '';
}

/** 里程碑弹层的非阻塞提示：负责人没改、却已离开项目 ⇒「负责人已离开项目，请改派」。 */
export function milestoneFormOwnerHint(host: PlanningFormsHost): string | null {
  const form = host.milestoneForm;
  if (form === null) return null;
  return departedOwnerHint(
    form.draft.ownerSubject,
    milestoneFormCurrentOwner(host),
    memberSubjects(host),
  );
}

/** 迭代计划弹层的非阻塞提示（同上一条）。 */
export function iterationFormOwnerHint(host: PlanningFormsHost): string | null {
  const form = host.iterationForm;
  if (form === null) return null;
  return departedOwnerHint(
    form.draft.ownerSubject,
    iterationFormCurrentOwner(host),
    memberSubjects(host),
  );
}

/** 保存里程碑（新建或编辑）。三态回执；⛔ 两种失败都不碰草稿。 */
export async function submitMilestoneForm(
  host: PlanningFormsHost,
  projectId: string,
): Promise<PlanningFormOutcome> {
  const form = host.milestoneForm;
  if (form === null || form.saving) return 'error';
  const problem = milestoneFormProblem(form.draft, {
    selfId: form.milestoneId,
    milestones: host.milestones,
    iterationDueDays:
      form.milestoneId === null
        ? []
        : openIterationDueDays(host.milestoneIterations[form.milestoneId]),
    memberSubjects: memberSubjects(host),
    currentOwnerSubject: milestoneFormCurrentOwner(host),
  });
  if (problem !== null) {
    host.milestoneForm = { ...form, notice: projectCollabInfoNotice(problem) };
    return 'error';
  }
  const fields = {
    name: form.draft.name.trim(),
    objectiveMd: form.draft.objectiveMd.trim(),
    ownerSubject: form.draft.ownerSubject || null,
    startAt: form.draft.startAt,
    dueAt: form.draft.dueAt,
  };
  const fingerprint = JSON.stringify(fields);
  const clientRequestId = requestIdFor(form, fingerprint);
  host.milestoneForm = {
    ...form,
    clientRequestId,
    sentFingerprint: fingerprint,
    saving: true,
    notice: null,
  };
  const epoch = host.projectEpoch;
  try {
    const live =
      form.milestoneId === null ? null : host.milestones.find((row) => row.id === form.milestoneId);
    const result =
      form.milestoneId === null
        ? await projectCollabApi.milestoneCreate({ projectId, clientRequestId, ...fields })
        : await projectCollabApi.milestoneUpdate({
            projectId,
            milestoneId: form.milestoneId,
            expectedVersion: live?.version ?? 1,
            clientRequestId,
            ...fields,
          });
    if (epoch !== host.projectEpoch) return 'error';
    if (!result.ok) {
      // 只有「编辑」的失败信封带当前版本（新建没有这个键）。
      const { currentVersion = null } = result as { readonly currentVersion?: number | null };
      return await applyMilestoneFailure(host, projectId, { ...result, currentVersion });
    }
    host.milestoneForm = null;
    host.planningPageNotice = projectCollabInfoNotice(PLANNING_FORM_TEXT.milestoneSaved);
    await loadMilestones(host, projectId);
    // 原型：新建之后选中并展开它。
    if (form.milestoneId === null && epoch === host.projectEpoch) {
      host.expandedMilestoneId = result.milestone.id;
      void loadMilestoneIterations(host, projectId, result.milestone.id);
    }
    return 'ok';
  } catch {
    if (epoch === host.projectEpoch && host.milestoneForm !== null) {
      host.milestoneForm = { ...host.milestoneForm, notice: projectCollabErrorNotice('transient') };
    }
    return 'error';
  } finally {
    if (epoch === host.projectEpoch && host.milestoneForm !== null) {
      host.milestoneForm = { ...host.milestoneForm, saving: false };
    }
  }
}

async function applyMilestoneFailure(
  host: PlanningFormsHost,
  projectId: string,
  failure: {
    readonly code: ProjectCollabErrorCode;
    readonly serverCode?: string | undefined;
    readonly currentVersion: number | null;
  },
): Promise<PlanningFormOutcome> {
  const form = host.milestoneForm;
  if (form === null) return 'error';
  if (failure.serverCode === 'idempotency_conflict') {
    host.milestoneForm = { ...form, clientRequestId: newRequestId(), sentFingerprint: null };
  }
  const versionConflict = failure.code === 'conflict' && failure.currentVersion !== null;
  const notice = versionConflict
    ? projectCollabInfoNotice(
        '该里程碑已被他人更新，已刷新到最新版本；你填写的内容已保留，确认后可再次保存。',
      )
    : milestoneWriteFailureNotice(failure);
  host.milestoneForm = { ...(host.milestoneForm ?? form), notice };
  if (failure.code === 'conflict') await loadMilestones(host, projectId);
  return versionConflict ? 'conflict' : 'error';
}

/**
 * 里程碑写失败（版本冲突之外）的提示：服务端强制的必填 / 起止 / 同名 / 周期 / 负责人码先给表单同一句人话
 * （`projectMilestoneWriteServerCodeText`），其余退回生命周期那张表（幂等冲突、目标不在、项目归档……）。
 * 手工弹层与规划草案审阅弹层共用这一份（mil-11），⛔ 两边不各写一套映射。
 */
export function milestoneWriteFailureNotice(failure: {
  readonly code: ProjectCollabErrorCode;
  readonly serverCode?: string | undefined;
}): ProjectCollabNotice {
  const text = projectMilestoneWriteServerCodeText(failure.serverCode);
  return text === null
    ? planningFailureNotice(failure)
    : projectCollabErrorNotice(failure.code, text);
}

/** 「归档里程碑」确认之后。成功：关弹层、收起它（归档后不在列表里）、页级回执；失败提示留在确认步。 */
export async function confirmMilestoneArchive(
  host: PlanningFormsHost,
  projectId: string,
): Promise<PlanningFormOutcome> {
  const form = host.milestoneForm;
  const row = form?.milestoneId
    ? host.milestones.find((item) => item.id === form.milestoneId)
    : undefined;
  if (form === null || row === undefined || form.saving) return 'error';
  host.milestoneForm = { ...form, saving: true, notice: null };
  const epoch = host.projectEpoch;
  const { outcome, notice } = await archivePlanningSubject(host, {
    projectId,
    subject: { kind: 'milestone', row },
    clientRequestId: newRequestId(),
  });
  if (epoch !== host.projectEpoch) return 'error';
  if (outcome !== 'ok') {
    if (host.milestoneForm !== null)
      host.milestoneForm = { ...host.milestoneForm, saving: false, notice };
    return outcome;
  }
  host.milestoneForm = null;
  if (host.expandedMilestoneId === row.id) host.expandedMilestoneId = null;
  host.planningPageNotice = projectCollabInfoNotice(PLANNING_FORM_TEXT.milestoneArchived);
  host.archivedMilestones = { ...host.archivedMilestones, loaded: false };
  // 名下迭代的在排需求随归档一并移出（ADR-0040）：「未排里程碑 N」当场重取，⛔ 不本地猜移出了几条。
  void loadUnscheduledRequirementTotal(host, projectId);
  return 'ok';
}

/* ══ 迭代计划 ════════════════════════════════════════════════════════════════ */

/**
 * 打开添加 / 编辑迭代计划。已达成的轮次不开（原型：先重新打开节点再调整完成标准），提示落列表回执。
 * 关联需求的候选要全量现状：没取过就取（两种弹层共用一份候选）。
 */
export function openIterationForm(
  host: PlanningFormsHost,
  request: {
    readonly projectId: string;
    readonly milestoneId: string;
    readonly iteration: ProjectIterationListItem | null;
    readonly canPlan: boolean;
  },
): void {
  if (!request.canPlan) return;
  const { iteration } = request;
  if (iteration !== null && iteration.status === 'completed') {
    host.iterationActionNotice = projectCollabInfoNotice(
      PLANNING_FORM_TEXT.iterationCompletedLocked,
    );
    return;
  }
  const milestone = host.milestones.find((row) => row.id === request.milestoneId);
  host.iterationForm = {
    milestoneId: request.milestoneId,
    iterationId: iteration?.id ?? null,
    draft: iterationFormDraftFrom(iteration, {
      ownerSubject: milestone?.ownerSubject ?? '',
      requirementIds: currentRequirementIds(host, iteration?.id ?? null),
    }),
    clientRequestId: newRequestId(),
    sentFingerprint: null,
    scheduleRequestId: newRequestId(),
    scheduleFingerprint: null,
    saving: false,
    confirmArchive: false,
    notice: null,
  };
  void loadRequirementPlacements(host, request.projectId).then(() => {
    // 候选到手后把「排在这一轮」的勾上（只在用户还没动过勾选时补，⛔ 不覆盖用户的选择）。
    const form = host.iterationForm;
    if (form === null || form.iterationId !== (iteration?.id ?? null)) return;
    if (form.draft.requirementIds.length > 0 || iteration === null) return;
    host.iterationForm = {
      ...form,
      draft: { ...form.draft, requirementIds: currentRequirementIds(host, iteration.id) },
    };
  });
}

function currentRequirementIds(
  host: RequirementScheduleHost,
  iterationId: string | null,
): string[] {
  if (iterationId === null) return [];
  return host.requirementPlacements.items
    .filter((item) => item.placement?.iterationId === iterationId)
    .map((item) => item.requirementId);
}

export function setIterationFormDraft(
  host: PlanningFormsHost,
  patch: Partial<IterationFormDraft>,
): void {
  const form = host.iterationForm;
  if (form === null) return;
  host.iterationForm = { ...form, draft: { ...form.draft, ...patch } };
}

export function toggleIterationFormRequirement(
  host: PlanningFormsHost,
  requirementId: string,
  checked: boolean,
): void {
  const form = host.iterationForm;
  if (form === null) return;
  const others = form.draft.requirementIds.filter((id) => id !== requirementId);
  setIterationFormDraft(host, { requirementIds: checked ? [...others, requirementId] : others });
}

export function closeIterationForm(host: PlanningFormsHost): void {
  host.iterationForm = null;
}

export function setIterationArchiveConfirm(host: PlanningFormsHost, confirm: boolean): void {
  const form = host.iterationForm;
  if (form === null || form.iterationId === null) return;
  host.iterationForm = { ...form, confirmArchive: confirm, notice: null };
}

/**
 * 保存迭代计划：轮次本体一条请求（新建或 PATCH），关联需求变化再走**一条**安排需求整批写（ADR-0038）。
 *
 * ⚠️ 两步不是一个事务：本体成功而关联需求被拒时，弹层留在原地、切到已建那一轮（再点保存走 PATCH，
 *    不重复建），提示说清哪一步没成；⛔ 输入与勾选一个不丢。
 */
export async function submitIterationForm(
  host: PlanningFormsHost,
  projectId: string,
): Promise<PlanningFormOutcome> {
  const form = host.iterationForm;
  if (form === null || form.saving) return 'error';
  const milestone = host.milestones.find((row) => row.id === form.milestoneId);
  const problem = iterationFormProblem(form.draft, {
    period: {
      start: planningDayKey(milestone?.startAt ?? null),
      end: planningDayKey(milestone?.dueAt ?? null),
    },
    memberSubjects: memberSubjects(host),
    currentOwnerSubject: iterationFormCurrentOwner(host),
  });
  if (problem !== null) {
    host.iterationForm = { ...form, notice: projectCollabInfoNotice(problem) };
    return 'error';
  }
  const fields = {
    name: form.draft.name.trim(),
    dueAt: form.draft.dueAt,
    ownerSubject: form.draft.ownerSubject || null,
    criteriaMd: criteriaLines(form.draft.criteriaText).join('\n'),
  };
  const fingerprint = JSON.stringify([form.iterationId, fields]);
  const clientRequestId = requestIdFor(form, fingerprint);
  host.iterationForm = {
    ...form,
    clientRequestId,
    sentFingerprint: fingerprint,
    saving: true,
    notice: null,
  };
  const epoch = host.projectEpoch;
  try {
    const body = await saveIterationBody(host, projectId, form, fields, clientRequestId);
    if (epoch !== host.projectEpoch) return 'error';
    if (!('iterationId' in body)) return body.outcome;
    const { iterationId } = body;
    const items = requirementScheduleItemsForIteration(
      host,
      iterationId,
      form.draft.requirementIds,
    );
    if (items.length > 0) {
      const current = host.iterationForm ?? form;
      const scheduleFingerprint = JSON.stringify([iterationId, items]);
      const scheduleRequestId =
        current.scheduleFingerprint === null || current.scheduleFingerprint === scheduleFingerprint
          ? current.scheduleRequestId
          : newRequestId();
      host.iterationForm = { ...current, scheduleRequestId, scheduleFingerprint };
      const saved = await saveRequirementScheduleItems(host, {
        projectId,
        milestoneId: form.milestoneId,
        clientRequestId: scheduleRequestId,
        items,
      });
      if (epoch !== host.projectEpoch) return 'error';
      if (saved.outcome !== 'ok') {
        // 本体已落盘：说清只有关联需求没成，并刷新列表（新建的那一轮要出现在列表里）。
        if (host.iterationForm !== null) {
          host.iterationForm = {
            ...host.iterationForm,
            notice:
              saved.notice === null
                ? null
                : {
                    ...saved.notice,
                    message: `${PLANNING_FORM_TEXT.iterationSavedRequirementsNot}${saved.notice.message}`,
                  },
            ...(saved.rotateRequestId
              ? { scheduleRequestId: newRequestId(), scheduleFingerprint: null }
              : {}),
          };
        }
        await Promise.all([
          loadMilestoneIterations(host, projectId, form.milestoneId),
          loadMilestones(host, projectId),
        ]);
        return saved.outcome;
      }
    }
    host.iterationForm = null;
    host.iterationActionNotice = projectCollabInfoNotice(PLANNING_FORM_TEXT.iterationSaved);
    await Promise.all([
      loadMilestoneIterations(host, projectId, form.milestoneId),
      loadMilestones(host, projectId),
    ]);
    return 'ok';
  } catch {
    if (epoch === host.projectEpoch && host.iterationForm !== null) {
      host.iterationForm = { ...host.iterationForm, notice: projectCollabErrorNotice('transient') };
    }
    return 'error';
  } finally {
    if (epoch === host.projectEpoch && host.iterationForm !== null) {
      host.iterationForm = { ...host.iterationForm, saving: false };
    }
  }
}

/** 轮次本体那一步：成功回轮次 id；失败把提示写进弹层（⛔ 不碰草稿）并回失败档。 */
async function saveIterationBody(
  host: PlanningFormsHost,
  projectId: string,
  form: NonNullable<PlanningFormsHost['iterationForm']>,
  fields: { name: string; dueAt: string; ownerSubject: string | null; criteriaMd: string },
  clientRequestId: string,
): Promise<{ readonly iterationId: string } | { readonly outcome: 'conflict' | 'error' }> {
  if (form.iterationId === null) {
    const created = await projectCollabApi.iterationCreate({
      projectId,
      milestoneId: form.milestoneId,
      clientRequestId,
      ...fields,
    });
    if (!created.ok) {
      writeIterationNotice(host, iterationWriteFailureNotice(created));
      return { outcome: created.code === 'conflict' ? 'conflict' : 'error' };
    }
    // 切到已建那一轮：关联需求那一步若失败，再点保存走 PATCH（⛔ 不重复建）。
    if (host.iterationForm !== null) {
      host.iterationForm = { ...host.iterationForm, iterationId: created.iteration.id };
    }
    return { iterationId: created.iteration.id };
  }
  // 期望版本读活行：冲突刷新之后下一次提交自动带上新版本。
  const live = (host.milestoneIterations[form.milestoneId] ?? []).find(
    (row) => row.id === form.iterationId,
  );
  if (live === undefined) {
    writeIterationNotice(
      host,
      projectCollabErrorNotice('conflict', '该迭代计划已不在列表中，请刷新后重试。'),
    );
    return { outcome: 'error' };
  }
  const updated = await projectCollabApi.iterationUpdate({
    projectId,
    iterationId: form.iterationId,
    expectedVersion: live.version,
    clientRequestId,
    ...fields,
  });
  if (updated.ok) return { iterationId: updated.iteration.id };
  if (updated.code === 'conflict' && updated.currentVersion !== null) {
    writeIterationNotice(
      host,
      projectCollabInfoNotice(
        '该迭代计划已被他人更新，已刷新到最新版本；你填写的内容已保留，确认后可再次保存。',
      ),
    );
    await loadMilestoneIterations(host, projectId, form.milestoneId);
    return { outcome: 'conflict' };
  }
  if (updated.serverCode === 'idempotency_conflict' && host.iterationForm !== null) {
    host.iterationForm = {
      ...host.iterationForm,
      clientRequestId: newRequestId(),
      sentFingerprint: null,
    };
  }
  writeIterationNotice(host, iterationWriteFailureNotice(updated));
  return { outcome: 'error' };
}

function writeIterationNotice(host: PlanningFormsHost, notice: ProjectCollabNotice): void {
  if (host.iterationForm !== null) host.iterationForm = { ...host.iterationForm, notice };
}

/**
 * 迭代计划本体写失败的提示：服务端强制的日期 / 负责人 / 目标归档先按业务码给表单同一句人话
 * （`projectIterationUpdateServerCodeText`，与 `iterationFormProblem` 逐字相同），其余退回生命周期那张表。
 * 手工弹层与规划草案审阅弹层共用这一份（mil-11）。
 */
export function iterationWriteFailureNotice(failure: {
  readonly code: ProjectCollabErrorCode;
  readonly serverCode?: string | undefined;
}): ProjectCollabNotice {
  const text = projectIterationUpdateServerCodeText(failure.serverCode);
  return text === null
    ? planningFailureNotice(failure)
    : projectCollabErrorNotice(failure.code, text);
}

/**
 * 「归档此迭代计划」确认之后（编辑弹层与详情弹层共用）。成功关弹层 + 列表回执；失败提示回给调用方就地显示。
 */
export async function confirmIterationArchive(
  host: PlanningFormsHost,
  request: {
    readonly projectId: string;
    readonly milestoneId: string;
    readonly iteration: ProjectIterationListItem;
  },
): Promise<{ readonly outcome: PlanningFormOutcome; readonly notice: ProjectCollabNotice | null }> {
  const epoch = host.projectEpoch;
  const result = await archivePlanningSubject(host, {
    projectId: request.projectId,
    subject: { kind: 'iteration', milestoneId: request.milestoneId, row: request.iteration },
    clientRequestId: newRequestId(),
  });
  if (epoch !== host.projectEpoch) return { outcome: 'error', notice: null };
  if (result.outcome === 'ok') {
    if (host.iterationForm?.iterationId === request.iteration.id) host.iterationForm = null;
    if (
      host.planningDetail?.kind === 'iteration' &&
      host.planningDetail.row.id === request.iteration.id
    ) {
      host.planningDetail = null;
    }
    host.iterationActionNotice = projectCollabInfoNotice(PLANNING_FORM_TEXT.iterationArchived);
    const archived = host.archivedIterations[request.milestoneId];
    if (archived !== undefined) {
      host.archivedIterations = {
        ...host.archivedIterations,
        [request.milestoneId]: { ...archived, loaded: false },
      };
    }
    void loadUnscheduledRequirementTotal(host, request.projectId);
  }
  return result;
}

/** 列表 / 详情里「编辑迭代计划」需要的那一行（没有则 null）。 */
export function iterationRowFor(
  host: Pick<ProjectPlanningHost, 'milestoneIterations'>,
  milestoneId: string,
  iterationId: string,
): ProjectIterationListItem | null {
  return (
    (host.milestoneIterations[milestoneId] ?? []).find((row) => row.id === iterationId) ?? null
  );
}
