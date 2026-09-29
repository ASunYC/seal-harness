import type { ProjectCollabErrorCode } from '@shared/protocol/project-collab.js';
import {
  PROJECT_PLANNING_MAX_PAGE_SIZE,
  type ProjectIterationListItem,
  type ProjectMilestoneListItem,
} from '@shared/protocol/project-planning.js';
import {
  openablePlanningEvidenceLink,
  planningLifecycleRequiredStatus,
  projectPlanningLifecycleServerCodeText,
  type ProjectPlanningLifecycleAction,
} from '@shared/protocol/project-planning-lifecycle.js';

import {
  GOAL_LIFECYCLE_COPY,
  GOAL_TEXT,
  goalCompletionGate,
  goalGateBlockedText,
} from '../components/project/planning-goal-view';
import {
  projectCollabErrorNotice,
  projectCollabInfoNotice,
  type ProjectCollabNotice,
} from './projectCollabErrors';
import {
  loadMilestoneIterations,
  loadMilestones,
  replaceIteration,
  type ProjectPlanningHost,
} from './projectCollabPlanning';
import type {
  PlanningLifecycleDraft,
  PlanningLifecycleSubject,
  PlanningStageRecords,
  ProjectCollabState,
} from './projectCollabState';

import { projectCollabApi } from '../sdk/projectCollab';

/**
 * 业务目标 / 迭代计划的**记录达成 · 重新打开 · 阶段记录**（MIL-07 客户端段）。
 *
 * 判据载体全部落在这里（组件只做绑定）：
 *  - **输入一个字不丢**（422 / 409）：草稿在 store（`planningLifecycleDraft`），失败分支只写
 *    提示、⛔ 从不碰 `reason` / `evidenceRefs` / `confirmed`；冲突就地重取列表只换行对象，
 *    草稿不随行对象走。
 *  - **幂等**：同一份内容的重试复用 `clientRequestId`（服务端回原结果）；内容改过再提交换新号
 *    （同号异内容服务端回 `idempotency_conflict`，是死路）。判据是提交时的内容指纹。
 *  - **版本冲突提示刷新**：`currentVersion` 非空 ⇒ 就地重取 + 常驻提示，下一次提交带新版本。
 *  - **成功即时更新分组**：权威轮次替换回列表，「我的 / 未完成 / 已完成」由列表派生链当场重算。
 *  - **阶段记录只经 REST**：`loadPlanningStageRecords` 读 `.../events`；事件流到达时
 *    `refreshPlanningForEvent` ⛔ 一个负载字段都不读，只按 state 里已持有的 id 重取。
 *  - **归档连带移出**（ADR-0040）：归档不再因在排需求被拒，服务端把在排需求一并移出；
 *    界面只在确认框里说清这件事，⛔ 不显示任何条数（看的人读不到的那几条不能从数字里漏出去）。
 *    恢复只经 PATCH 可达（排回规则见 ADR-0040），界面不给恢复入口，文案也不提恢复。
 *  - **业务目标记录达成 / 重新打开**（MIL-07 界面段，原型 `completeGoalG1` / `reopenGoalG1`）：本地核对照原型
 *    次序「验收说明 → 证据 → 门槛」，门槛读活行上的服务端聚合 `iterationSummary`；成功给页级回执；
 *    展开着的目标的目标记录随 `milestone.updated` 按 id 重取。
 *
 * ⚠️ 权限只收入口（manager+ 才可点，见组件）；真正的门在服务端，这里不预判角色。
 */
export type PlanningLifecycleHost = ProjectPlanningHost &
  Pick<
    ProjectCollabState,
    | 'planningLifecycleDraft'
    | 'planningLifecycleSubmitting'
    | 'planningLifecycleNotice'
    | 'planningDetail'
    | 'planningStageRecords'
    | 'planningPageNotice'
  >;

/**
 * 三态回执：`ok` 已记录；`conflict` 版本冲突（已就地刷新，确认后可再提交）；
 * `error` 其余失败（含本地核对未过）。⛔ 两种失败都保留草稿。
 */
export type PlanningLifecycleOutcome = 'ok' | 'conflict' | 'error';

/** 阶段记录一次取满一页上界：一个对象的完成 / 重开次数远小于它。 */
export const PLANNING_STAGE_RECORD_PAGE_SIZE = PROJECT_PLANNING_MAX_PAGE_SIZE;

const EMPTY_STAGE_RECORDS: PlanningStageRecords = {
  items: [],
  total: 0,
  loaded: false,
  loading: false,
  error: null,
  requestId: 0,
};

/** 阶段记录按对象各存一份的键（目标与轮次的 id 空间不同，前缀分开）。 */
export function planningRecordKey(subject: PlanningLifecycleSubject): string {
  return `${subject.kind}:${subject.row.id}`;
}

/** 取某对象的阶段记录（没有则给空态，⛔ 不写回——读不该有副作用）。 */
export function getPlanningStageRecords(
  host: Pick<PlanningLifecycleHost, 'planningStageRecords'>,
  subject: PlanningLifecycleSubject,
): PlanningStageRecords {
  return host.planningStageRecords[planningRecordKey(subject)] ?? EMPTY_STAGE_RECORDS;
}

type IterationSubject = Extract<PlanningLifecycleSubject, { kind: 'iteration' }>;
type MilestoneSubject = Extract<PlanningLifecycleSubject, { kind: 'milestone' }>;
type LiveRowHost = Pick<ProjectPlanningHost, 'milestones' | 'milestoneIterations'>;

/**
 * 活行：列表里那一行的**当前**投影；列表里已经没有（被他人归档、所在目标未展开）时退回
 * 打开那一刻的快照。版本号、状态、名称一律读它——冲突刷新之后下一次提交自动带上新版本。
 */
export function livePlanningRow(
  host: LiveRowHost,
  subject: IterationSubject,
): ProjectIterationListItem;
export function livePlanningRow(
  host: LiveRowHost,
  subject: MilestoneSubject,
): ProjectMilestoneListItem;
export function livePlanningRow(
  host: LiveRowHost,
  subject: PlanningLifecycleSubject,
): ProjectIterationListItem | ProjectMilestoneListItem;
export function livePlanningRow(
  host: LiveRowHost,
  subject: PlanningLifecycleSubject,
): ProjectIterationListItem | ProjectMilestoneListItem {
  if (subject.kind === 'milestone') {
    return host.milestones.find((row) => row.id === subject.row.id) ?? subject.row;
  }
  const rows =
    subject.milestoneId === null ? undefined : host.milestoneIterations[subject.milestoneId];
  return rows?.find((row) => row.id === subject.row.id) ?? subject.row;
}

/** 每次打开弹层一个新请求号（⛔ 不复用上一次弹层的号——那是另一次提交）。 */
function newClientRequestId(): string {
  return crypto.randomUUID();
}

/**
 * 请求内容的指纹：服务端判「同号同内容」比的正是这两个字段（数组顺序敏感）。
 * ⚠️ 版本号与「已核对」勾选不进指纹：前者不参与服务端的幂等比对，后者不上送。
 */
export function planningLifecycleFingerprint(
  reason: string,
  evidenceRefs: readonly string[],
): string {
  return JSON.stringify([reason, [...evidenceRefs]]);
}

/* ── 弹层草稿 ─────────────────────────────────────────────────────────────── */

/** 打开记录达成 / 重新打开弹层：一份空草稿 + 新请求号。 */
export function openPlanningLifecycle(
  host: PlanningLifecycleHost,
  subject: PlanningLifecycleSubject,
  action: ProjectPlanningLifecycleAction,
): void {
  host.planningLifecycleDraft = {
    subject,
    action,
    reason: '',
    evidenceRefs: [],
    linkText: '',
    linkError: null,
    confirmed: false,
    clientRequestId: newClientRequestId(),
    sentFingerprint: null,
  };
  host.planningLifecycleNotice = null;
}

/** 取消：丢弃草稿不留痕，⛔ 不发任何请求。 */
export function closePlanningLifecycle(host: PlanningLifecycleHost): void {
  host.planningLifecycleDraft = null;
  host.planningLifecycleNotice = null;
}

/** 就地合并输入（说明 / 证据 / 外部链接输入行 / 核对勾选）。⛔ 不在这里换请求号——换不换在提交时按指纹判。 */
export function setPlanningLifecycleDraft(
  host: PlanningLifecycleHost,
  patch: Partial<
    Pick<PlanningLifecycleDraft, 'reason' | 'evidenceRefs' | 'linkText' | 'linkError' | 'confirmed'>
  >,
): void {
  const draft = host.planningLifecycleDraft;
  if (draft === null) return;
  host.planningLifecycleDraft = { ...draft, ...patch };
}

/** 本地核对不过时的提示（照原型 `milestoneTransition27` 的那句）。 */
const DRAFT_INCOMPLETE_TEXT = '请填写记录，并核对全部完成标准。';
/** 完成标准为空时不许达成（原型：「请先编辑迭代计划，补充完成标准。」）。 */
export const PLANNING_CRITERIA_MISSING_TEXT = '请先编辑迭代计划，补充完成标准。';

/**
 * 提交前的本地核对：没写记录、完成标准为空、没勾核对、没挂证据都不发请求；对象状态已经
 * 被别人改过（活行不再是这个动作要求的状态）同样不发。返回给人看的一句，通过为 null。
 *
 * ⚠️ 只为不白跑一趟必错的请求——必填与状态闸的**权威在服务端**（422 / 409 照样映射成人话）。
 */
export function planningLifecycleDraftProblem(
  host: LiveRowHost,
  draft: PlanningLifecycleDraft,
): string | null {
  const row = livePlanningRow(host, draft.subject);
  if (row.status !== planningLifecycleRequiredStatus(draft.action)) {
    const code = `${draft.subject.kind}_${draft.action === 'complete' ? 'already_completed' : 'not_completed'}`;
    return projectPlanningLifecycleServerCodeText(code);
  }
  if (draft.action === 'reopen') {
    return draft.reason.trim()
      ? null
      : projectPlanningLifecycleServerCodeText('reopen_reason_required');
  }
  const subject = draft.subject;
  if (subject.kind === 'milestone') {
    // 业务目标（原型 `completeGoalG1` 的次序）：验收说明 → 证据 → 门槛。门槛读**活行**上的服务端聚合：
    // 弹层开着时别人重开了一轮，确认时照样挡下。⛔ 变异锚点：跳过这道门槛 ⇒ 门槛用例转红。
    if (!draft.reason.trim()) return GOAL_TEXT.noteRequired;
    if (draft.evidenceRefs.length === 0) return GOAL_TEXT.evidenceRequired;
    const gate = goalCompletionGate(livePlanningRow(host, subject).iterationSummary);
    return gate.ok ? null : goalGateBlockedText(gate.reason);
  }
  if (!livePlanningRow(host, subject).criteriaMd.trim()) return PLANNING_CRITERIA_MISSING_TEXT;
  if (!draft.reason.trim() || !draft.confirmed) return DRAFT_INCOMPLETE_TEXT;
  return draft.evidenceRefs.length > 0
    ? null
    : projectPlanningLifecycleServerCodeText('completion_evidence_required');
}

/* ── 提交 ─────────────────────────────────────────────────────────────────── */

interface LifecycleFailure {
  readonly code: ProjectCollabErrorCode;
  readonly serverCode?: string | undefined;
  readonly currentVersion: number | null;
}

type LifecycleSendOutcome =
  | { readonly ok: true; readonly kind: 'iteration'; readonly iteration: ProjectIterationListItem }
  | { readonly ok: true; readonly kind: 'milestone'; readonly milestone: ProjectMilestoneListItem }
  | { readonly ok: false; readonly failure: LifecycleFailure };

interface LifecycleBody {
  readonly projectId: string;
  readonly expectedVersion: number;
  readonly clientRequestId: string;
  readonly reason: string;
  readonly evidenceRefs: string[];
}

async function sendPlanningLifecycle(
  subject: PlanningLifecycleSubject,
  action: ProjectPlanningLifecycleAction,
  body: LifecycleBody,
): Promise<LifecycleSendOutcome> {
  if (subject.kind === 'iteration') {
    const request = { ...body, iterationId: subject.row.id };
    const result =
      action === 'complete'
        ? await projectCollabApi.iterationComplete(request)
        : await projectCollabApi.iterationReopen(request);
    return result.ok
      ? { ok: true, kind: 'iteration', iteration: result.iteration }
      : { ok: false, failure: result };
  }
  const request = { ...body, milestoneId: subject.row.id };
  const result =
    action === 'complete'
      ? await projectCollabApi.milestoneComplete(request)
      : await projectCollabApi.milestoneReopen(request);
  return result.ok
    ? { ok: true, kind: 'milestone', milestone: result.milestone }
    : { ok: false, failure: result };
}

/**
 * 提交当前草稿（记录达成 / 重新打开），三态回执见 `PlanningLifecycleOutcome`。
 *
 * ⭐ 幂等键：本份内容与这个号上一次随行的内容相同（或这个号还没发过）⇒ 复用；不同 ⇒ 换新号。
 *    ⛔ 变异锚点：改成每次提交都换新号 ⇒「同一次提交的重试复用请求号」用例转红；改成永不换号
 *       ⇒「改了内容再提交换新号」用例转红。
 * ⭐ 期望版本读**活行**：冲突刷新之后的下一次提交自动带上新版本。
 */
export async function submitPlanningLifecycle(
  host: PlanningLifecycleHost,
  projectId: string,
): Promise<PlanningLifecycleOutcome> {
  const draft = host.planningLifecycleDraft;
  if (draft === null || host.planningLifecycleSubmitting) return 'error';
  const problem = planningLifecycleDraftProblem(host, draft);
  if (problem !== null) {
    host.planningLifecycleNotice = projectCollabInfoNotice(problem);
    return 'error';
  }
  const reason = draft.reason.trim();
  // 证据只随「记录达成」上送：重开弹层没有证据输入，⛔ 不夹带上一份草稿的残留。
  const evidenceRefs = draft.action === 'complete' ? [...draft.evidenceRefs] : [];
  const fingerprint = planningLifecycleFingerprint(reason, evidenceRefs);
  const clientRequestId =
    draft.sentFingerprint === null || draft.sentFingerprint === fingerprint
      ? draft.clientRequestId
      : newClientRequestId();
  host.planningLifecycleDraft = { ...draft, clientRequestId, sentFingerprint: fingerprint };
  host.planningLifecycleSubmitting = true;
  host.planningLifecycleNotice = null;
  const epoch = host.projectEpoch;
  try {
    const sent = await sendPlanningLifecycle(draft.subject, draft.action, {
      projectId,
      expectedVersion: livePlanningRow(host, draft.subject).version,
      clientRequestId,
      reason,
      evidenceRefs,
    });
    if (epoch !== host.projectEpoch) return 'error';
    if (!sent.ok) return await applyLifecycleFailure(host, projectId, draft.subject, sent.failure);
    applyLifecycleSuccess(host, projectId, draft, clientRequestId, sent);
    return 'ok';
  } catch {
    if (epoch === host.projectEpoch) {
      host.planningLifecycleNotice = projectCollabErrorNotice('transient');
    }
    return 'error';
  } finally {
    if (epoch === host.projectEpoch) host.planningLifecycleSubmitting = false;
  }
}

function applyLifecycleSuccess(
  host: PlanningLifecycleHost,
  projectId: string,
  draft: PlanningLifecycleDraft,
  clientRequestId: string,
  sent: Extract<LifecycleSendOutcome, { ok: true }>,
): void {
  const subject = draft.subject;
  if (sent.kind === 'iteration') {
    // ⭐ 权威轮次替换回列表 ⇒ 分组（我的 / 未完成 / 已完成）由派生链当场重算。
    if (subject.kind === 'iteration' && subject.milestoneId !== null) {
      replaceIteration(host, subject.milestoneId, sent.iteration);
    }
    // 目标卡上「迭代计划 X / Y」是服务端聚合：轮次状态变了就重取，⛔ 不本地加减。
    if (host.milestonesLoaded) void loadMilestones(host, projectId);
    host.iterationActionNotice = projectCollabInfoNotice(
      draft.action === 'complete' ? '迭代计划已记录达成。' : '节点已重新打开，历史记录保留。',
    );
  } else {
    host.milestones = host.milestones.map((row) =>
      row.id === sent.milestone.id ? sent.milestone : row,
    );
    // 业务目标的回执落页级（原型 `planSave27` 的回执句），与迭代列表的回执分开摆。
    host.planningPageNotice = projectCollabInfoNotice(GOAL_LIFECYCLE_COPY[draft.action].success);
  }
  // 只收起**这一份**草稿：在途期间若已关掉又开了另一份，别把新的一并关了。
  if (host.planningLifecycleDraft?.clientRequestId === clientRequestId) {
    host.planningLifecycleDraft = null;
    host.planningLifecycleNotice = null;
  }
  // 阶段记录多了一行：详情开着或曾经载过 ⇒ 按 id 重取（正文只经 REST）。
  if (shouldReloadStageRecords(host, subject)) {
    void loadPlanningStageRecords(host, projectId, subject);
  }
}

/**
 * 失败：⛔ 草稿里用户写的字一个都不动（变异锚点：在这里清空 reason / evidenceRefs ⇒
 * 「422 / 409 输入一个字不丢」用例转红）。只写提示；409 一律就地重取——版本冲突要新版本号，
 * 状态冲突要让弹层看见现状。
 */
async function applyLifecycleFailure(
  host: PlanningLifecycleHost,
  projectId: string,
  subject: PlanningLifecycleSubject,
  failure: LifecycleFailure,
): Promise<'conflict' | 'error'> {
  if (failure.code !== 'conflict') {
    host.planningLifecycleNotice = planningFailureNotice(failure);
    return 'error';
  }
  if (failure.serverCode === 'idempotency_conflict') rotateLifecycleRequestId(host);
  const versionConflict = failure.currentVersion !== null;
  host.planningLifecycleNotice = versionConflict
    ? projectCollabInfoNotice(
        `${subjectNoun(subject)}已被他人更新，已刷新到最新版本；你填写的内容已保留，确认后可再次提交。`,
      )
    : planningFailureNotice(failure);
  await refreshPlanningSubject(host, projectId, subject);
  return versionConflict ? 'conflict' : 'error';
}

/** 同号异内容：这个号已经绑死在另一份内容上，换新号（下一次提交用它）。 */
function rotateLifecycleRequestId(host: PlanningLifecycleHost): void {
  const draft = host.planningLifecycleDraft;
  if (draft === null) return;
  host.planningLifecycleDraft = {
    ...draft,
    clientRequestId: newClientRequestId(),
    sentFingerprint: null,
  };
}

function subjectNoun(subject: PlanningLifecycleSubject): string {
  return subject.kind === 'iteration' ? '该迭代计划' : '该业务目标';
}

/**
 * 失败信封 → 报错条：服务端业务码认得出就换成那一句人话（参考编号照旧），认不出退回通用句。
 * ⛔ 业务码本身不进文案。
 */
export function planningFailureNotice(failure: {
  readonly code: ProjectCollabErrorCode;
  readonly serverCode?: string | undefined;
}): ProjectCollabNotice {
  const text = projectPlanningLifecycleServerCodeText(failure.serverCode);
  return text === null
    ? projectCollabErrorNotice(failure.code)
    : projectCollabErrorNotice(failure.code, text);
}

/** 重取这个对象所在的列表（与阶段记录，若已载过）。 */
async function refreshPlanningSubject(
  host: PlanningLifecycleHost,
  projectId: string,
  subject: PlanningLifecycleSubject,
): Promise<void> {
  const tasks: Promise<void>[] = [];
  if (subject.kind === 'milestone') tasks.push(loadMilestones(host, projectId));
  else if (subject.milestoneId !== null) {
    tasks.push(loadMilestoneIterations(host, projectId, subject.milestoneId));
  }
  if (shouldReloadStageRecords(host, subject)) {
    tasks.push(loadPlanningStageRecords(host, projectId, subject));
  }
  await Promise.all(tasks);
}

function shouldReloadStageRecords(
  host: PlanningLifecycleHost,
  subject: PlanningLifecycleSubject,
): boolean {
  const key = planningRecordKey(subject);
  const detail = host.planningDetail;
  return (
    host.planningStageRecords[key]?.loaded === true ||
    (detail !== null && planningRecordKey(detail) === key)
  );
}

/* ── 阶段记录（只经 REST）──────────────────────────────────────────────────── */

function writeStageRecords(
  host: PlanningLifecycleHost,
  key: string,
  records: PlanningStageRecords,
): void {
  host.planningStageRecords = { ...host.planningStageRecords, [key]: records };
}

/**
 * 取一个对象的阶段记录（`GET .../events`，viewer 也能读；**已归档照样读得到**）。
 *
 * `epoch` 守切项目、`requestId` 守同对象并发乱序；⛔ 失败**不清**已有记录（保留旧内容 + 出错误条）。
 * ⛔ 本函数是阶段记录正文的**唯一**来源：事件流负载里没有、也不许从那里拼。
 */
export async function loadPlanningStageRecords(
  host: PlanningLifecycleHost,
  projectId: string,
  subject: PlanningLifecycleSubject,
): Promise<void> {
  const key = planningRecordKey(subject);
  const epoch = host.projectEpoch;
  const requestId = (host.planningStageRecords[key]?.requestId ?? 0) + 1;
  writeStageRecords(host, key, {
    ...getPlanningStageRecords(host, subject),
    loading: true,
    requestId,
  });
  const stale = (): boolean =>
    epoch !== host.projectEpoch || host.planningStageRecords[key]?.requestId !== requestId;
  try {
    const result =
      subject.kind === 'milestone'
        ? await projectCollabApi.milestoneEventList({
            projectId,
            milestoneId: subject.row.id,
            pageSize: PLANNING_STAGE_RECORD_PAGE_SIZE,
          })
        : await projectCollabApi.iterationEventList({
            projectId,
            iterationId: subject.row.id,
            pageSize: PLANNING_STAGE_RECORD_PAGE_SIZE,
          });
    if (stale()) return;
    if (!result.ok) {
      writeStageRecords(host, key, {
        ...getPlanningStageRecords(host, subject),
        loading: false,
        error: planningFailureNotice(result),
      });
      return;
    }
    writeStageRecords(host, key, {
      items: result.items,
      total: result.total,
      loaded: true,
      loading: false,
      error: null,
      requestId,
    });
  } catch {
    if (stale()) return;
    writeStageRecords(host, key, {
      ...getPlanningStageRecords(host, subject),
      loading: false,
      error: projectCollabErrorNotice('transient'),
    });
  }
}

/** 打开迭代计划详情（含阶段记录）：记下对象并按 id 取阶段记录。 */
export async function openPlanningDetail(
  host: PlanningLifecycleHost,
  projectId: string,
  subject: PlanningLifecycleSubject,
): Promise<void> {
  host.planningDetail = subject;
  await loadPlanningStageRecords(host, projectId, subject);
}

export function closePlanningDetail(host: PlanningLifecycleHost): void {
  host.planningDetail = null;
}

/**
 * `milestone.updated` / `iteration.updated` 合帧落地后的重取。
 *
 * ⛔ **负载一个字段都不读**（服务端负载里本来就没有说明 / 证据 / 原因）：只按 state 里已持有的
 *    id 走 REST——目标列表（已载过才取）、展开目标的迭代、打开着的详情的阶段记录。
 *    变异锚点：改成把事件负载拼进阶段记录（不走 REST）⇒ 事件用例转红。
 */
export async function refreshPlanningForEvent(
  host: PlanningLifecycleHost,
  projectId: string,
): Promise<void> {
  const tasks: Promise<void>[] = [];
  if (host.milestonesLoaded) tasks.push(loadMilestones(host, projectId));
  if (host.expandedMilestoneId !== null) {
    tasks.push(loadMilestoneIterations(host, projectId, host.expandedMilestoneId));
  }
  if (host.planningDetail !== null) {
    tasks.push(loadPlanningStageRecords(host, projectId, host.planningDetail));
  }
  // 展开着的业务目标：卡里的达成信息与「目标记录 N」已载过才重取（与开着的详情是同一对象时不重复取）。
  const expanded = host.milestones.find((row) => row.id === host.expandedMilestoneId);
  if (expanded !== undefined) {
    const goal: PlanningLifecycleSubject = { kind: 'milestone', row: expanded };
    const key = planningRecordKey(goal);
    const detailKey = host.planningDetail === null ? null : planningRecordKey(host.planningDetail);
    if (host.planningStageRecords[key]?.loaded === true && detailKey !== key) {
      tasks.push(loadPlanningStageRecords(host, projectId, goal));
    }
  }
  await Promise.all(tasks);
}

/* ── 归档（在排需求随归档一并移出）──────────────────────────────────────────── */

/**
 * 归档一轮迭代 / 一个业务目标（更新请求 `archived: true`，manager+）。
 *
 * ⭐ MIL-09 给了界面入口（编辑里程碑 / 编辑迭代计划 / 迭代计划详情的「归档」二次确认）。MIL-10 起在排需求
 *    **不再挡住归档**：服务端在同一个事务里把它们移出（ADR-0040），确认框的文案说清这件事。
 *    失败仍按业务码给人话（`planningFailureNotice`），⛔ 不吞成通用失败。
 * 提示随结果带回，由入口决定摆在哪（弹层里就地显示）；迭代的提示同时落 `iterationActionNotice`
 * （迭代列表已经渲染它）。
 */
export async function archivePlanningSubject(
  host: PlanningLifecycleHost,
  request: {
    readonly projectId: string;
    readonly subject: PlanningLifecycleSubject;
    readonly clientRequestId: string;
  },
): Promise<{
  readonly outcome: PlanningLifecycleOutcome;
  readonly notice: ProjectCollabNotice | null;
}> {
  const { projectId, subject, clientRequestId } = request;
  const epoch = host.projectEpoch;
  const expectedVersion = livePlanningRow(host, subject).version;
  const publish = (notice: ProjectCollabNotice | null): void => {
    if (subject.kind === 'iteration') host.iterationActionNotice = notice;
  };
  try {
    const result =
      subject.kind === 'iteration'
        ? await projectCollabApi.iterationUpdate({
            projectId,
            iterationId: subject.row.id,
            expectedVersion,
            clientRequestId,
            archived: true,
          })
        : await projectCollabApi.milestoneUpdate({
            projectId,
            milestoneId: subject.row.id,
            expectedVersion,
            clientRequestId,
            archived: true,
          });
    if (epoch !== host.projectEpoch) return { outcome: 'error', notice: null };
    if (!result.ok) {
      const versionConflict = result.code === 'conflict' && result.currentVersion !== null;
      const notice = versionConflict
        ? projectCollabInfoNotice(`${subjectNoun(subject)}已被他人更新，已为你刷新到最新版本。`)
        : planningFailureNotice(result);
      publish(notice);
      if (result.code === 'conflict') await refreshPlanningSubject(host, projectId, subject);
      return { outcome: versionConflict ? 'conflict' : 'error', notice };
    }
    publish(null);
    // 归档后默认列表不再取它：重取所在列表（⛔ 不本地猜还剩几条）。
    await refreshPlanningSubject(host, projectId, subject);
    if (subject.kind === 'iteration' && host.milestonesLoaded) void loadMilestones(host, projectId);
    return { outcome: 'ok', notice: null };
  } catch {
    const notice = projectCollabErrorNotice('transient');
    if (epoch === host.projectEpoch) publish(notice);
    return { outcome: 'error', notice };
  }
}

/**
 * 打开证据引用里的外部链接（ADR-0036）：先按与主进程同一份判定（共享文法 + 浏览器的解析器）挡掉认不出的
 * 地址，再经 `project:evidence-link-open` 交主进程二次校验后给系统浏览器。
 *
 * ⛔ 渲染层**不自己导航**：不 `window.open`、不改 `location`、不渲染可跳转的超链接。
 * ⭐ 回执随结果带回（`null` ＝ 已交出去），由调用方就地摆放——弹层与详情各有各的提示位。
 *    失败提示只带失败码的通用句与参考编号，⛔ 不回显地址（地址是用户写的正文）。
 */
export async function openPlanningEvidenceLink(url: string): Promise<ProjectCollabNotice | null> {
  if (openablePlanningEvidenceLink(url, (raw) => new URL(raw)) === null) {
    return projectCollabErrorNotice('invalidRequest');
  }
  try {
    const result = await projectCollabApi.evidenceLinkOpen({ url });
    return result.ok ? null : projectCollabErrorNotice(result.code);
  } catch {
    return projectCollabErrorNotice('transient');
  }
}
