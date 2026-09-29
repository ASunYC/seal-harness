import {
  PROJECT_PLANNING_MAX_PAGE_SIZE,
  type ProjectIterationListItem,
  type ProjectMilestoneListItem,
} from '@shared/protocol/project-planning.js';
import {
  projectRequirementScheduleServerCodeText,
  type ProjectRequirementScheduleItem,
} from '@shared/protocol/project-planning-schedule.js';

import {
  initialScheduleSelection,
  PLANNING_FORM_TEXT,
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
  EMPTY_REQUIREMENT_PLACEMENTS,
  emptyArchivedPlanningList,
  type ArchivedPlanningList,
  type ProjectCollabState,
} from './projectCollabState';

/**
 * 安排需求（MIL-09）与里程碑页的几份只读现状：候选、「未排里程碑 N」、需求编辑器「迭代信息」、已归档列表。
 *
 * 判据载体：
 *  - **一次保存一条请求**（ADR-0038）：`saveRequirementSchedule` 把改过的行收成一份 items 发出去，
 *    ⛔ 不拆成逐条关联 / 移出；空改动不发请求、直接关弹层（原型同）。
 *  - **只列看的人可见的需求**：候选只来自服务端 `requirement-placements`（可见性闸在服务端 SQL 里），
 *    ⛔ 不从本地待办列表拼。
 *  - **未排计数取服务端权威值**：`unscheduledRequirementTotal` 只写服务端的 `unscheduledTotal`，⛔ 不自算。
 *  - **冲突保留选择并提示刷新**：版本冲突 ⇒ 重取候选（选择按需求 id 留着）+ 常驻提示；内容一变换请求号。
 *  - **列表、看板、甘特与需求详情同步刷新**：成功后重取目标列表、涉及目标的迭代、未排计数，
 *    需求编辑器的「迭代信息」缓存作废重取。
 */
export type RequirementScheduleHost = ProjectPlanningHost &
  Pick<
    ProjectCollabState,
    | 'requirementScheduleDialog'
    | 'requirementPlacements'
    | 'unscheduledRequirementTotal'
    | 'archivedMilestones'
    | 'archivedIterations'
    | 'requirementPlacementLookups'
  >;

/** 候选最多取几页（每页一个上界）：超出时弹层注明只显示了前面这些。 */
const PLACEMENT_MAX_PAGES = 10;

/** 服务端「对象或周期已变」一族：重取候选与迭代后让用户在新现状上重下决定。 */
const STALE_SERVER_CODES: ReadonlySet<string> = new Set([
  'milestone_archived',
  'milestone_not_found',
  'iteration_archived',
  'iteration_outside_milestone',
  'iteration_not_found',
  'todo_not_found',
]);

/* ── 读：候选 / 未排计数 / 迭代信息 ────────────────────────────────────────────── */

/** 取满候选（按页，最多 `PLACEMENT_MAX_PAGES` 页）。`epoch` + 请求序号双守作废迟到响应。 */
export async function loadRequirementPlacements(
  host: RequirementScheduleHost,
  projectId: string,
): Promise<void> {
  const epoch = host.projectEpoch;
  const requestId = host.requirementPlacements.requestId + 1;
  host.requirementPlacements = { ...host.requirementPlacements, loading: true, requestId };
  const stale = (): boolean =>
    epoch !== host.projectEpoch || host.requirementPlacements.requestId !== requestId;
  const items: ProjectRequirementScheduleCandidate[] = [];
  try {
    for (let page = 1; page <= PLACEMENT_MAX_PAGES; page += 1) {
      const result = await projectCollabApi.requirementPlacementList({
        projectId,
        page,
        pageSize: PROJECT_PLANNING_MAX_PAGE_SIZE,
      });
      if (stale()) return;
      if (!result.ok) {
        host.requirementPlacements = {
          ...host.requirementPlacements,
          loading: false,
          error: projectCollabErrorNotice(result.code),
        };
        return;
      }
      items.push(...result.items);
      host.unscheduledRequirementTotal = result.unscheduledTotal;
      if (items.length >= result.total || result.items.length === 0) {
        host.requirementPlacements = {
          items,
          total: result.total,
          loaded: true,
          loading: false,
          error: null,
          requestId,
        };
        return;
      }
      host.requirementPlacements = {
        ...host.requirementPlacements,
        items: [...items],
        total: result.total,
      };
    }
    host.requirementPlacements = {
      ...host.requirementPlacements,
      loaded: true,
      loading: false,
      error: null,
    };
  } catch {
    if (!stale()) {
      host.requirementPlacements = {
        ...host.requirementPlacements,
        loading: false,
        error: projectCollabErrorNotice('transient'),
      };
    }
  }
}

type ProjectRequirementScheduleCandidate =
  RequirementScheduleHost['requirementPlacements']['items'][number];

export type RequirementIterationEditorResult =
  | {
      readonly ok: true;
      readonly candidate: ProjectRequirementScheduleCandidate;
      readonly iterations: readonly ProjectIterationListItem[];
    }
  | { readonly ok: false; readonly message: string };

/** 编辑器使用独立的全项目分页读取，不覆盖里程碑页的筛选和页码。 */
export async function loadRequirementIterationEditor(
  host: RequirementScheduleHost & Pick<ProjectCollabState, 'activeProjectId'>,
  projectId: string,
  requirementId: string,
): Promise<RequirementIterationEditorResult> {
  const epoch = host.projectEpoch;
  const failure = { ok: false, message: '迭代信息读取失败，请重试。' } as const;
  const current = (): boolean => epoch === host.projectEpoch && host.activeProjectId === projectId;
  try {
    if (!current()) return failure;
    const placement = await projectCollabApi.requirementPlacementList({
      projectId,
      requirementId,
      pageSize: 1,
    });
    if (!current() || !placement.ok) return failure;
    const candidate = placement.items.find((item) => item.requirementId === requirementId);
    if (!candidate) return failure;
    const iterations: ProjectIterationListItem[] = [];
    for (let page = 1; page <= 100; page += 1) {
      if (!current()) return failure;
      const result = await projectCollabApi.iterationList({
        projectId,
        page,
        pageSize: PROJECT_PLANNING_MAX_PAGE_SIZE,
      });
      if (!current() || !result.ok) return failure;
      iterations.push(...result.items);
      if (iterations.length >= result.total) return { ok: true, candidate, iterations };
      if (result.items.length === 0) return failure;
    }
    return { ok: false, message: '迭代数量超出读取上限，请联系管理员。' };
  } catch {
    return failure;
  }
}

/** 「未排里程碑 N」：只要服务端那个数（取一条就带回来），⛔ 不自算。 */
export async function loadUnscheduledRequirementTotal(
  host: RequirementScheduleHost,
  projectId: string,
): Promise<void> {
  const epoch = host.projectEpoch;
  try {
    const result = await projectCollabApi.requirementPlacementList({ projectId, pageSize: 1 });
    if (epoch !== host.projectEpoch || !result.ok) return;
    host.unscheduledRequirementTotal = result.unscheduledTotal;
  } catch {
    // 计数取不到不出错误条：它只是一个辅助数字，留着上一次的值（或不显示）。
  }
}

/** 需求编辑器「迭代信息」：按需求取那一条的当前排期。 */
export async function loadRequirementPlacementLookup(
  host: RequirementScheduleHost,
  projectId: string,
  requirementId: string,
): Promise<void> {
  const epoch = host.projectEpoch;
  const previous = host.requirementPlacementLookups[requirementId];
  const requestId = (previous?.requestId ?? 0) + 1;
  host.requirementPlacementLookups = {
    ...host.requirementPlacementLookups,
    [requirementId]: {
      placement: previous?.placement ?? null,
      loaded: previous?.loaded ?? false,
      error: null,
      requestId,
    },
  };
  const stale = (): boolean =>
    epoch !== host.projectEpoch ||
    host.requirementPlacementLookups[requirementId]?.requestId !== requestId;
  try {
    const result = await projectCollabApi.requirementPlacementList({
      projectId,
      requirementId,
      pageSize: 1,
    });
    if (stale()) return;
    host.requirementPlacementLookups = {
      ...host.requirementPlacementLookups,
      [requirementId]: result.ok
        ? { placement: result.items[0]?.placement ?? null, loaded: true, error: null, requestId }
        : {
            placement: null,
            loaded: false,
            error: projectCollabErrorNotice(result.code),
            requestId,
          },
    };
  } catch {
    if (stale()) return;
    host.requirementPlacementLookups = {
      ...host.requirementPlacementLookups,
      [requirementId]: {
        placement: null,
        loaded: false,
        error: projectCollabErrorNotice('transient'),
        requestId,
      },
    };
  }
}

/* ── 安排需求弹层 ──────────────────────────────────────────────────────────── */

export function openRequirementScheduleDialog(
  host: RequirementScheduleHost,
  projectId: string,
  milestoneId: string,
  canPlan: boolean,
): void {
  if (!canPlan) return;
  host.requirementScheduleDialog = {
    milestoneId,
    selections: {},
    clientRequestId: crypto.randomUUID(),
    sentFingerprint: null,
    saving: false,
    notice: null,
  };
  void loadRequirementPlacements(host, projectId);
  if (host.milestoneIterations[milestoneId] === undefined) {
    void loadMilestoneIterations(host, projectId, milestoneId);
  }
}

export function closeRequirementScheduleDialog(host: RequirementScheduleHost): void {
  host.requirementScheduleDialog = null;
}

/** 记一行的选择（空串 ＝ 不排）。与这一行当前的排期相同即撤销「改过」标记。 */
export function selectRequirementSchedule(
  host: RequirementScheduleHost,
  requirementId: string,
  selection: string,
): void {
  const dialog = host.requirementScheduleDialog;
  if (dialog === null) return;
  const item = host.requirementPlacements.items.find((row) => row.requirementId === requirementId);
  const next = { ...dialog.selections };
  if (item !== undefined && initialScheduleSelection(item, dialog.milestoneId) === selection) {
    delete next[requirementId];
  } else {
    next[requirementId] = selection;
  }
  host.requirementScheduleDialog = { ...dialog, selections: next };
}

/** 这一行当前在弹层里的选择（改过读改过的，没改过读现状）。 */
export function requirementScheduleSelection(
  host: RequirementScheduleHost,
  item: ProjectRequirementScheduleCandidate,
): string {
  const dialog = host.requirementScheduleDialog;
  if (dialog === null) return '';
  return (
    dialog.selections[item.requirementId] ?? initialScheduleSelection(item, dialog.milestoneId)
  );
}

/** 改过的行 → 整批请求条目（期望值读**当前**候选：冲突刷新之后自动带上新版本与新现状）。 */
export function requirementScheduleItems(
  host: RequirementScheduleHost,
): ProjectRequirementScheduleItem[] {
  const dialog = host.requirementScheduleDialog;
  if (dialog === null) return [];
  return host.requirementPlacements.items.flatMap((item) => {
    const selection = dialog.selections[item.requirementId];
    if (selection === undefined || selection === initialScheduleSelection(item, dialog.milestoneId))
      return [];
    return [scheduleItem(item, selection || null)];
  });
}

function scheduleItem(
  item: ProjectRequirementScheduleCandidate,
  iterationId: string | null,
): ProjectRequirementScheduleItem {
  return {
    requirementId: item.requirementId,
    iterationId,
    expectedRequirementVersion: item.version,
    expectedIterationId: item.placement?.iterationId ?? null,
  };
}

/**
 * 迭代计划表单的「关联本里程碑需求」→ 整批条目：勾上而不在这一轮 ⇒ 排进来；没勾而原来在这一轮 ⇒ 不排。
 */
export function requirementScheduleItemsForIteration(
  host: RequirementScheduleHost,
  iterationId: string,
  checkedIds: readonly string[],
): ProjectRequirementScheduleItem[] {
  const checked = new Set(checkedIds);
  return host.requirementPlacements.items.flatMap((item) => {
    const here = item.placement?.iterationId === iterationId;
    if (checked.has(item.requirementId) && !here) return [scheduleItem(item, iterationId)];
    if (!checked.has(item.requirementId) && here) return [scheduleItem(item, null)];
    return [];
  });
}

export interface ScheduleWriteResult {
  readonly outcomeUnknown?: boolean;
  readonly outcome: 'ok' | 'conflict' | 'error';
  readonly notice: ProjectCollabNotice | null;
  /** 同号异内容（`idempotency_conflict`）：调用方下一次换号。 */
  readonly rotateRequestId: boolean;
}

/**
 * 发一条安排需求整批写，并按结果刷新现状（安排需求弹层与迭代计划表单共用）。
 * ⛔ 不碰任何草稿 / 选择：失败只回提示，由调用方写进自己的弹层。
 */
export async function saveRequirementScheduleItems(
  host: RequirementScheduleHost,
  request: {
    readonly projectId: string;
    readonly milestoneId: string | null;
    readonly clientRequestId: string;
    readonly items: readonly ProjectRequirementScheduleItem[];
  },
): Promise<ScheduleWriteResult> {
  const { projectId, milestoneId } = request;
  const epoch = host.projectEpoch;
  const result = await projectCollabApi.requirementScheduleSave({
    projectId,
    milestoneId,
    clientRequestId: request.clientRequestId,
    items: [...request.items],
  });
  if (epoch !== host.projectEpoch)
    return { outcome: 'error', notice: null, rotateRequestId: false };
  if (result.ok) {
    await refreshAfterSchedule(
      host,
      projectId,
      milestoneId,
      result.moves.map((move) => move.previousIterationId),
    );
    return { outcome: 'ok', notice: null, rotateRequestId: false };
  }
  if (
    result.serverCode === 'version_conflict' ||
    (result.code === 'conflict' && result.serverCode === undefined)
  ) {
    await loadRequirementPlacements(host, projectId);
    const count = result.conflicts.length;
    return {
      outcome: 'conflict',
      notice: projectCollabInfoNotice(
        `${count > 0 ? `${count} 条需求` : '安排'}已被他人更新或改排，已刷新到最新；你的安排已保留，请核对后重新保存。`,
      ),
      rotateRequestId: false,
    };
  }
  const text = projectRequirementScheduleServerCodeText(result.serverCode);
  if (result.serverCode !== undefined && STALE_SERVER_CODES.has(result.serverCode)) {
    await Promise.all([
      loadRequirementPlacements(host, projectId),
      ...(milestoneId === null ? [] : [loadMilestoneIterations(host, projectId, milestoneId)]),
      loadMilestones(host, projectId),
    ]);
  }
  return {
    outcome: 'error',
    outcomeUnknown: result.code === 'transient' || result.serverCode === 'idempotency_retry',
    notice: projectCollabErrorNotice(result.code, text ?? undefined),
    rotateRequestId: result.serverCode === 'idempotency_conflict',
  };
}

/** 安排需求弹层的「保存安排」。没有改动 ⇒ 直接关弹层（原型同），⛔ 不发请求。 */
export async function saveRequirementSchedule(
  host: RequirementScheduleHost,
  projectId: string,
): Promise<'ok' | 'conflict' | 'error' | 'noop'> {
  const dialog = host.requirementScheduleDialog;
  if (dialog === null || dialog.saving) return 'noop';
  const items = requirementScheduleItems(host);
  if (items.length === 0) {
    host.requirementScheduleDialog = null;
    return 'noop';
  }
  const fingerprint = JSON.stringify(items);
  const clientRequestId =
    dialog.sentFingerprint === null || dialog.sentFingerprint === fingerprint
      ? dialog.clientRequestId
      : crypto.randomUUID();
  host.requirementScheduleDialog = {
    ...dialog,
    clientRequestId,
    sentFingerprint: fingerprint,
    saving: true,
    notice: null,
  };
  const epoch = host.projectEpoch;
  try {
    const saved = await saveRequirementScheduleItems(host, {
      projectId,
      milestoneId: dialog.milestoneId,
      clientRequestId,
      items,
    });
    if (epoch !== host.projectEpoch) return 'error';
    if (saved.outcome === 'ok') {
      host.requirementScheduleDialog = null;
      host.iterationActionNotice = projectCollabInfoNotice(PLANNING_FORM_TEXT.scheduleSaved);
      return 'ok';
    }
    const current = host.requirementScheduleDialog;
    if (current !== null) {
      host.requirementScheduleDialog = {
        ...current,
        notice: saved.notice,
        ...(saved.rotateRequestId
          ? { clientRequestId: crypto.randomUUID(), sentFingerprint: null }
          : {}),
      };
    }
    return saved.outcome;
  } catch {
    const current = host.requirementScheduleDialog;
    if (epoch === host.projectEpoch && current !== null) {
      host.requirementScheduleDialog = {
        ...current,
        notice: projectCollabErrorNotice('transient'),
      };
    }
    return 'error';
  } finally {
    const current = host.requirementScheduleDialog;
    if (epoch === host.projectEpoch && current !== null) {
      host.requirementScheduleDialog = { ...current, saving: false };
    }
  }
}

/**
 * 保存之后：目标列表（关联需求数）、本目标迭代（关联摘要）、被移出的原轮次所在的已载入目标、未排计数，
 * 候选与「迭代信息」缓存作废（下次打开 / 事件到达时重取）。
 */
async function refreshAfterSchedule(
  host: RequirementScheduleHost,
  projectId: string,
  milestoneId: string | null,
  previousIterationIds: readonly (string | null)[],
): Promise<void> {
  const touched = new Set<string>(milestoneId === null ? [] : [milestoneId]);
  for (const previous of previousIterationIds) {
    if (previous === null) continue;
    for (const [otherId, rows] of Object.entries(host.milestoneIterations)) {
      if (rows.some((row) => row.id === previous)) touched.add(otherId);
    }
  }
  host.requirementPlacements = EMPTY_REQUIREMENT_PLACEMENTS;
  host.requirementPlacementLookups = {};
  await Promise.all([
    loadMilestones(host, projectId),
    loadUnscheduledRequirementTotal(host, projectId),
    ...[...touched].map((id) => loadMilestoneIterations(host, projectId, id)),
  ]);
}

/**
 * `iteration.requirements_changed` 到达：⛔ 负载一个字段都不读，按 state 里已持有的 id 走 REST——
 * 未排计数、开着的安排需求弹层的候选、需求编辑器已查过的「迭代信息」。目标列表与迭代的重取由调用方
 * 与 `milestone.updated` 共用那一处。
 */
export async function refreshRequirementScheduleForEvent(
  host: RequirementScheduleHost,
  projectId: string,
): Promise<void> {
  const tasks: Promise<void>[] = [loadUnscheduledRequirementTotal(host, projectId)];
  if (host.requirementScheduleDialog !== null || host.requirementPlacements.loaded) {
    tasks.push(loadRequirementPlacements(host, projectId));
  }
  for (const requirementId of Object.keys(host.requirementPlacementLookups)) {
    tasks.push(loadRequirementPlacementLookup(host, projectId, requirementId));
  }
  await Promise.all(tasks);
}

/* ── 已归档列表（只读）─────────────────────────────────────────────────────── */

/**
 * 「已归档里程碑 N」：`includeArchived` 取一页（上界），只留已归档的；N ＝ 含归档的总数 − 未归档总数
 * （两个都是服务端权威数）。
 */
export async function loadArchivedMilestones(
  host: RequirementScheduleHost,
  projectId: string,
): Promise<void> {
  const epoch = host.projectEpoch;
  const requestId = host.archivedMilestones.requestId + 1;
  host.archivedMilestones = { ...host.archivedMilestones, loading: true, requestId };
  const stale = (): boolean =>
    epoch !== host.projectEpoch || host.archivedMilestones.requestId !== requestId;
  try {
    const [all, open] = await Promise.all([
      projectCollabApi.milestoneList({
        projectId,
        includeArchived: true,
        pageSize: PROJECT_PLANNING_MAX_PAGE_SIZE,
      }),
      projectCollabApi.milestoneList({ projectId, pageSize: 1 }),
    ]);
    if (stale()) return;
    if (!all.ok || !open.ok) {
      const code = !all.ok ? all.code : open.ok ? 'transient' : open.code;
      host.archivedMilestones = {
        ...host.archivedMilestones,
        loading: false,
        error: projectCollabErrorNotice(code),
      };
      return;
    }
    host.archivedMilestones = archivedList(
      all.items.filter((row: ProjectMilestoneListItem) => row.archivedAt !== null),
      Math.max(0, all.total - open.total),
      requestId,
    );
  } catch {
    if (!stale()) {
      host.archivedMilestones = {
        ...host.archivedMilestones,
        loading: false,
        error: projectCollabErrorNotice('transient'),
      };
    }
  }
}

/** 「已归档迭代计划 N」：一个目标下 `includeArchived` 取满一页，只留已归档的。 */
export async function loadArchivedIterations(
  host: RequirementScheduleHost,
  projectId: string,
  milestoneId: string,
): Promise<void> {
  const epoch = host.projectEpoch;
  const previous =
    host.archivedIterations[milestoneId] ?? emptyArchivedPlanningList<ProjectIterationListItem>();
  const requestId = previous.requestId + 1;
  host.archivedIterations = {
    ...host.archivedIterations,
    [milestoneId]: { ...previous, loading: true, requestId },
  };
  const stale = (): boolean =>
    epoch !== host.projectEpoch || host.archivedIterations[milestoneId]?.requestId !== requestId;
  try {
    const result = await projectCollabApi.iterationList({
      projectId,
      milestoneId,
      includeArchived: true,
      pageSize: PROJECT_PLANNING_MAX_PAGE_SIZE,
    });
    if (stale()) return;
    const next: ArchivedPlanningList<ProjectIterationListItem> = result.ok
      ? archivedList(
          result.items.filter((row) => row.archivedAt !== null),
          result.items.filter((row) => row.archivedAt !== null).length,
          requestId,
        )
      : { ...previous, loading: false, error: projectCollabErrorNotice(result.code), requestId };
    host.archivedIterations = { ...host.archivedIterations, [milestoneId]: next };
  } catch {
    if (!stale()) {
      host.archivedIterations = {
        ...host.archivedIterations,
        [milestoneId]: {
          ...previous,
          loading: false,
          error: projectCollabErrorNotice('transient'),
          requestId,
        },
      };
    }
  }
}

function archivedList<Row>(
  items: readonly Row[],
  total: number,
  requestId: number,
): ArchivedPlanningList<Row> {
  return { items, total, loaded: true, loading: false, error: null, requestId };
}
