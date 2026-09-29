import type { ProjectIterationScheduleSaveResult } from '@shared/protocol/project-planning-schedule.js';

import {
  ITERATION_PLAN_VIEW_SAVE_FAILED_MESSAGE,
  readIterationPlanView,
  writeIterationPlanView,
  type IterationPlanPreferenceStorage,
} from '../components/project/iteration-plan-preference';
import {
  dropScheduleDraftEntry,
  EMPTY_ITERATION_SCHEDULE_DRAFT,
  isScheduleDraftSavable,
  milestonePeriod,
  queueScheduleDraft,
  rebaseScheduleDraft,
  SCHEDULE_QUEUE_REJECTED_MESSAGE,
  SCHEDULE_SAVED_MESSAGE,
  SCHEDULE_STALE_MESSAGE,
  SCHEDULE_UNSCHEDULED_DROP_MESSAGE,
  scheduleDraftItems,
  scheduleDraftSize,
  scheduleRequestFingerprint,
  type IterationPlanView,
  type IterationScheduleDraft,
} from '../components/project/iteration-schedule-view';
import { projectCollabApi } from '../sdk/projectCollab';
import { projectCollabErrorNotice, projectCollabInfoNotice } from './projectCollabErrors';
import {
  loadMilestoneIterations,
  loadMilestones,
  setIterationView,
  type ProjectPlanningHost,
} from './projectCollabPlanning';
import type { ProjectCollabState } from './projectCollabState';

/**
 * 迭代计划看板 / 甘特的**排期草案**与**视图偏好**动作（MIL-06）。
 *
 * ⭐ 判据 1「拖动仅修改本地排期草案，保存后才持久化并广播」的客户端载体就在这里：
 *    `queueIterationSchedule` **只写** `iterationScheduleDrafts`，⛔ 不调用任何 SDK；
 *    只有 `saveIterationSchedule` 发出**一条**整批请求（服务端单事务全有或全无，成功后按条广播）。
 *    ⛔ 变异锚点：在 queue 里直接调 `iterationScheduleSave` / `iterationUpdate`（拖动即落盘），
 *       「拖动不发请求」的用例立即转红。
 * ⭐ 判据 2「取消恢复原日期，409 提示刷新且保留草案」：
 *    · `cancelIterationSchedule` 丢弃整份草案 ⇒ 三视图读回服务端原日期；
 *    · 409 版本冲突 ⇒ 重取该目标迭代 + 草案**对齐到新快照**（日期一个不丢）+ 常驻提示，
 *      ⛔ 不清草案、⛔ 不拿旧版本自动重试。
 *
 * ⚠️ 草案按 `milestoneId` 隔离（切目标不串）；切项目 / 换号时由 `clearProjectScopedState` 整表清。
 */
export type ProjectScheduleHost = ProjectPlanningHost &
  Pick<
    ProjectCollabState,
    | 'mySubject'
    | 'iterationScheduleDrafts'
    | 'iterationScheduleNotices'
    | 'iterationScheduleSaving'
    | 'iterationScheduleRequests'
  >;

export type ScheduleSaveOutcome = 'ok' | 'conflict' | 'error' | 'noop';

/** 服务端「节点或周期已变」一族业务码：刷新目标与迭代后提示取消调整重试。 */
const STALE_SCHEDULE_SERVER_CODES: ReadonlySet<string> = new Set([
  'iteration_completed',
  'iteration_archived',
  'milestone_archived',
  'schedule_out_of_period',
  'iteration_outside_milestone',
  'iteration_not_found',
  'milestone_not_found',
]);

export function getIterationScheduleDraft(
  host: ProjectScheduleHost,
  milestoneId: string,
): IterationScheduleDraft {
  return host.iterationScheduleDrafts[milestoneId] ?? EMPTY_ITERATION_SCHEDULE_DRAFT;
}

function setDraft(
  host: ProjectScheduleHost,
  milestoneId: string,
  draft: IterationScheduleDraft,
): void {
  const next = { ...host.iterationScheduleDrafts };
  if (scheduleDraftSize(draft) === 0) delete next[milestoneId];
  else next[milestoneId] = draft;
  host.iterationScheduleDrafts = next;
}

function setNotice(
  host: ProjectScheduleHost,
  milestoneId: string,
  notice: ProjectScheduleHost['iterationScheduleNotices'][string],
): void {
  host.iterationScheduleNotices = { ...host.iterationScheduleNotices, [milestoneId]: notice };
}

function forgetRequest(host: ProjectScheduleHost, milestoneId: string): void {
  if (host.iterationScheduleRequests[milestoneId] === undefined) return;
  const next = { ...host.iterationScheduleRequests };
  delete next[milestoneId];
  host.iterationScheduleRequests = next;
}

/* ── 视图偏好 ─────────────────────────────────────────────────────────────── */

/**
 * 首次展开某个目标时读回它的视图偏好（内存里已有这一目标的视图态就不覆盖——本次会话里的
 * 选择优先）。
 */
export function hydrateIterationPlanView(
  host: ProjectScheduleHost,
  projectId: string,
  milestoneId: string,
  storage?: IterationPlanPreferenceStorage,
): void {
  if (host.iterationViews[milestoneId] !== undefined) return;
  setIterationView(host, milestoneId, {
    view: readIterationPlanView(host.mySubject, projectId, milestoneId, storage),
  });
}

/**
 * 切视图：**先写偏好、写成功才切**（原型 `stage-view28`）。写失败 ⇒ 原视图保留 +
 * 「视图偏好保存失败，原视图保留。」⛔ 查询态（关键字/筛选/排序）与草案一个字都不动。
 */
export function selectIterationPlanView(
  host: ProjectScheduleHost,
  request: {
    readonly projectId: string;
    readonly milestoneId: string;
    readonly view: IterationPlanView;
    readonly storage?: IterationPlanPreferenceStorage;
  },
): boolean {
  const saved = writeIterationPlanView(
    host.mySubject,
    request.projectId,
    request.milestoneId,
    request.view,
    request.storage,
  );
  if (!saved) {
    setNotice(
      host,
      request.milestoneId,
      projectCollabInfoNotice(ITERATION_PLAN_VIEW_SAVE_FAILED_MESSAGE),
    );
    return false;
  }
  setIterationView(host, request.milestoneId, { view: request.view });
  return true;
}

/* ── 草案 ─────────────────────────────────────────────────────────────────── */

/**
 * 记一次拖动 / 方向键调整进草案。⛔ **不发任何请求**（判据 1 的客户端载体）。
 * 被拒（无权限 / 已达成 / 周期外）⇒ 提示「日期需在里程碑周期内，且节点尚未达成。」并回 false。
 */
export function queueIterationSchedule(
  host: ProjectScheduleHost,
  request: {
    readonly milestoneId: string;
    readonly iterationId: string;
    readonly dueAt: string;
    readonly canPlan: boolean;
  },
): boolean {
  const rows = host.milestoneIterations[request.milestoneId] ?? [];
  const outcome = queueScheduleDraft(getIterationScheduleDraft(host, request.milestoneId), {
    row: rows.find((row) => row.id === request.iterationId),
    dueAt: request.dueAt,
    period: milestonePeriod(host.milestones.find((m) => m.id === request.milestoneId)),
    canPlan: request.canPlan,
  });
  if (!outcome.ok) {
    setNotice(host, request.milestoneId, projectCollabInfoNotice(SCHEDULE_QUEUE_REJECTED_MESSAGE));
    return false;
  }
  setDraft(host, request.milestoneId, outcome.draft);
  setNotice(host, request.milestoneId, null);
  return true;
}

/**
 * 看板把卡片拖进「未安排」：排期必须保留日期 ⇒ 拒绝并提示（原型 `wireBoard28`）。⛔ 草案不动。
 */
export function rejectUnscheduledDrop(host: ProjectScheduleHost, milestoneId: string): void {
  setNotice(host, milestoneId, projectCollabInfoNotice(SCHEDULE_UNSCHEDULED_DROP_MESSAGE));
}

/** 取消调整：丢弃整份草案 ⇒ 三视图读回服务端原日期（判据 2「取消恢复原日期」）。 */
export function cancelIterationSchedule(host: ProjectScheduleHost, milestoneId: string): void {
  setDraft(host, milestoneId, EMPTY_ITERATION_SCHEDULE_DRAFT);
  forgetRequest(host, milestoneId);
  setNotice(host, milestoneId, null);
}

/** 行内直接改日期保存成功后：那一轮已不是草案（原型 `saveInlineStage28` 同步删草案条目）。 */
export function dropIterationScheduleEntry(
  host: ProjectScheduleHost,
  milestoneId: string,
  iterationId: string,
): void {
  setDraft(
    host,
    milestoneId,
    dropScheduleDraftEntry(getIterationScheduleDraft(host, milestoneId), iterationId),
  );
}

/* ── 保存 ─────────────────────────────────────────────────────────────────── */

/**
 * 保存排期：整份草案**一条**请求。
 *  - `ok`：服务端权威轮次替换回列表、清草案、提示「迭代计划排期已保存。」；
 *  - `conflict`（版本冲突）：重取该目标迭代、草案对齐新快照并**保留**、常驻提示；
 *  - `error`：在途 / 编号冲突 / 节点或周期已变 / 其它失败——草案一律保留。
 * ⚠️ 幂等键：同一份草案（指纹相同）的重试沿用同一个 `clientRequestId`；草案一变就换新键。
 */
export async function saveIterationSchedule(
  host: ProjectScheduleHost,
  request: { readonly projectId: string; readonly milestoneId: string; readonly canPlan: boolean },
): Promise<ScheduleSaveOutcome> {
  const { projectId, milestoneId } = request;
  const draft = getIterationScheduleDraft(host, milestoneId);
  if (!request.canPlan || scheduleDraftSize(draft) === 0) return 'noop';
  if (host.iterationScheduleSaving[milestoneId] === true) return 'noop';
  const rows = host.milestoneIterations[milestoneId] ?? [];
  const period = milestonePeriod(host.milestones.find((m) => m.id === milestoneId));
  if (!isScheduleDraftSavable(draft, rows, period)) {
    setNotice(host, milestoneId, projectCollabInfoNotice(SCHEDULE_STALE_MESSAGE));
    return 'error';
  }
  const items = scheduleDraftItems(draft);
  const fingerprint = scheduleRequestFingerprint(milestoneId, items);
  const previous = host.iterationScheduleRequests[milestoneId];
  const clientRequestId =
    previous !== undefined && previous.fingerprint === fingerprint
      ? previous.clientRequestId
      : crypto.randomUUID();
  host.iterationScheduleRequests = {
    ...host.iterationScheduleRequests,
    [milestoneId]: { fingerprint, clientRequestId },
  };
  const epoch = host.projectEpoch;
  host.iterationScheduleSaving = { ...host.iterationScheduleSaving, [milestoneId]: true };
  try {
    const result = await projectCollabApi.iterationScheduleSave({
      projectId,
      milestoneId,
      clientRequestId,
      items,
    });
    if (epoch !== host.projectEpoch) return 'error';
    if (result.ok) {
      const saved = new Map(result.iterations.map((iteration) => [iteration.id, iteration]));
      host.milestoneIterations = {
        ...host.milestoneIterations,
        [milestoneId]: (host.milestoneIterations[milestoneId] ?? []).map(
          (row) => saved.get(row.id) ?? row,
        ),
      };
      setDraft(host, milestoneId, EMPTY_ITERATION_SCHEDULE_DRAFT);
      forgetRequest(host, milestoneId);
      setNotice(host, milestoneId, projectCollabInfoNotice(SCHEDULE_SAVED_MESSAGE));
      return 'ok';
    }
    return await handleScheduleFailure(host, { projectId, milestoneId, epoch, result });
  } catch {
    // 网络异常：草案与幂等键都保留（同一份草案再点保存即是同一个请求）。
    if (epoch === host.projectEpoch)
      setNotice(host, milestoneId, projectCollabErrorNotice('transient'));
    return 'error';
  } finally {
    if (epoch === host.projectEpoch) {
      host.iterationScheduleSaving = { ...host.iterationScheduleSaving, [milestoneId]: false };
    }
  }
}

async function handleScheduleFailure(
  host: ProjectScheduleHost,
  context: {
    readonly projectId: string;
    readonly milestoneId: string;
    readonly epoch: number;
    readonly result: Extract<ProjectIterationScheduleSaveResult, { ok: false }>;
  },
): Promise<ScheduleSaveOutcome> {
  const { projectId, milestoneId, epoch, result } = context;
  const serverCode = result.serverCode;
  if (serverCode === 'idempotency_retry') {
    // 同一次保存还在服务端事务里：原样再点一次（同键）就会拿到结果。
    setNotice(
      host,
      milestoneId,
      projectCollabInfoNotice('上一次保存仍在处理中，请稍后再点一次保存排期。'),
    );
    return 'error';
  }
  if (serverCode === 'idempotency_conflict') {
    forgetRequest(host, milestoneId);
    setNotice(
      host,
      milestoneId,
      projectCollabErrorNotice(
        'conflict',
        '保存请求已失效，请重新点击保存排期（你的调整已保留）。',
      ),
    );
    return 'error';
  }
  if (serverCode !== undefined && STALE_SCHEDULE_SERVER_CODES.has(serverCode)) {
    forgetRequest(host, milestoneId);
    await Promise.all([
      loadMilestones(host, projectId),
      loadMilestoneIterations(host, projectId, milestoneId),
    ]);
    if (epoch === host.projectEpoch) {
      setNotice(host, milestoneId, projectCollabInfoNotice(SCHEDULE_STALE_MESSAGE));
    }
    return 'error';
  }
  if (result.code === 'conflict') {
    // ⭐ 版本冲突（含拿不到业务码的冲突）：刷新 + 草案对齐新快照 + 常驻提示。
    //    ⛔ 不清草案、⛔ 不拿旧版本自动重试——让用户在新数据上确认后再保存。
    forgetRequest(host, milestoneId);
    await loadMilestoneIterations(host, projectId, milestoneId);
    if (epoch !== host.projectEpoch) return 'conflict';
    setDraft(
      host,
      milestoneId,
      rebaseScheduleDraft(
        getIterationScheduleDraft(host, milestoneId),
        host.milestoneIterations[milestoneId] ?? [],
      ),
    );
    const stale = result.conflicts.length;
    setNotice(
      host,
      milestoneId,
      projectCollabInfoNotice(
        `${stale > 0 ? `${stale} 个节点` : '排期'}已被他人更新，已刷新到最新；你的调整已保留，请核对后重新保存。`,
      ),
    );
    return 'conflict';
  }
  setNotice(host, milestoneId, projectCollabErrorNotice(result.code));
  return 'error';
}
