import {
  PROJECT_PLANNING_MAX_PAGE_SIZE,
  projectIterationUpdateServerCodeText,
  type ProjectIterationListItem,
} from '@shared/protocol/project-planning.js';
import type { ProjectPlanWindow } from '@shared/protocol/project-collab-plan-dates.js';

import { projectCollabErrorNotice, projectCollabInfoNotice } from './projectCollabErrors';
import {
  createIterationViewState,
  EMPTY_ITERATION_DRAFT,
  MILESTONE_PAGE_SIZE,
  type IterationDraft,
  type IterationViewState,
  type ProjectCollabState,
} from './projectCollabState';

import { projectCollabApi } from '../sdk/projectCollab';

/**
 * 里程碑（业务目标）总览的渲染层动作（MIL-04）——服务端分页 + 展开取多轮迭代。
 *
 * 与 `projectCollabRequirementPage`（需求页码查询）同一套骨架：`projectEpoch` +
 * 请求序号双守作废迟到/乱序响应；界面翻页只拿**一页**、不再拉满本地切。
 *
 * 判据全部落在这里：
 *  - **首页罗列多个业务目标**：`loadMilestones` 一次取一页 `milestoneList`，界面 `v-for`
 *    平铺（⛔ 不做下拉单选）；
 *  - **数字来自后端授权聚合**：列表行自带 `iterationSummary` 与 `visibleRequirementCount`
 *    （服务端聚合、过 viewer 可见性门），本模块**原样写入 state**，⛔ 不本地重算，
 *    也⛔ 不遍历需求——本地算不出别人看得见什么；
 *  - **切换 / 刷新 / 分页保持状态**：`expandedMilestoneId`、`milestonesPage` 都在 state 里，
 *    重取列表不动它们（只有切项目的 `clearProjectScopedState` 才清）；
 *  - **无结果 ≠ 加载失败**：`milestonesLoaded` 把「还没加载」与「加载后为空」分成两态，
 *    错误落 `milestonesError`（渲染层据此出 alert），空结果不写 error（出 status 空态）；
 *  - **展开一个目标不串别的目标的详情**：迭代按 `milestoneId` 各存一份，渲染层只读
 *    `expandedMilestoneId` 那一份。
 */
export type ProjectPlanningHost = Pick<
  ProjectCollabState,
  | 'projectEpoch'
  | 'milestones'
  | 'milestonesTotal'
  | 'milestonesPage'
  | 'milestonesLoaded'
  | 'milestonesLoading'
  | 'milestonesError'
  | 'milestonesRequestId'
  | 'milestonesPlanWindow'
  | 'expandedMilestoneId'
  | 'milestoneIterations'
  | 'milestoneIterationsLoading'
  | 'milestoneIterationsError'
  | 'milestoneIterationsRequestIds'
  | 'iterationViews'
  | 'iterationActionNotice'
>;

/** 迭代行内可编辑的三个字段（MIL-05）：负责人 / 优先级 / 日期。闭集，与服务端同界。 */
export type IterationEditableField = 'ownerSubject' | 'priority' | 'dueAt';

/** 单目标迭代一次取满（分组/筛选/排序在客户端做，需要全部轮次）。取服务端一页上界。 */
const ITERATION_LIST_PAGE_SIZE = PROJECT_PLANNING_MAX_PAGE_SIZE;

/**
 * 取当前 `milestonesPage` 对应的那一页业务目标。
 *
 * ⛔ 迟到/乱序作废：进函数即推进 `milestonesRequestId`；await 回来后 epoch 或 requestId
 * 但凡对不上就整段丢弃（不写 items/total/error/loading）——切到项目 B 之后，项目 A 的迟到
 * 响应绝不覆盖 B；同项目并发重取只让最后发出的那次落地。
 *
 * ⛔ **不动** `expandedMilestoneId`：刷新（含事件驱动重取、重连补拉）与翻页都要保住展开态。
 * ⛔ 失败**不清**已有列表：保留旧内容 + 出错误条（错误态优先于空态，不谎报「暂无」）。
 */
async function fetchMilestones(host: ProjectPlanningHost, projectId: string): Promise<void> {
  const epoch = host.projectEpoch;
  const requestId = host.milestonesRequestId + 1;
  host.milestonesRequestId = requestId;
  const stale = (): boolean =>
    epoch !== host.projectEpoch || requestId !== host.milestonesRequestId;
  host.milestonesLoading = true;
  try {
    const result = await projectCollabApi.milestoneList({
      projectId,
      page: host.milestonesPage,
      pageSize: MILESTONE_PAGE_SIZE,
      // 计划时间段（CORE-08）：设了才带，缺席＝不按时间段读。
      ...(host.milestonesPlanWindow ?? {}),
    });
    if (stale()) return;
    if (!result.ok) {
      host.milestonesError = projectCollabErrorNotice(result.code);
      return;
    }
    // 服务端授权聚合原样落地：items 每行自带 iterationSummary / visibleRequirementCount。
    host.milestones = result.items;
    host.milestonesTotal = result.total;
    host.milestonesPage = result.page;
    host.milestonesLoaded = true;
    host.milestonesError = null;
  } catch {
    if (!stale()) host.milestonesError = projectCollabErrorNotice('transient');
  } finally {
    if (!stale()) host.milestonesLoading = false;
  }
}

/** 按当前页重取业务目标列表（首次进入、刷新、重连补拉都走它；展开态与页码保留）。 */
export async function loadMilestones(host: ProjectPlanningHost, projectId: string): Promise<void> {
  return fetchMilestones(host, projectId);
}

/**
 * 翻页（页码下界收在 1；上界非法由服务端回 400 落到 error 面）。
 * ⛔ **不动** `expandedMilestoneId`：翻走再翻回来，原先展开的那个目标仍是展开态。
 */
export async function goToMilestonePage(
  host: ProjectPlanningHost,
  projectId: string,
  page: number,
): Promise<void> {
  host.milestonesPage = Math.max(1, Math.trunc(page));
  return fetchMilestones(host, projectId);
}

/**
 * 按计划时间段读业务目标列表（CORE-08，ADR-0042）：目标自身起止或名下未归档迭代的截止日与这一段交叠即命中。
 * 换段回到第 1 页（上一段的页码在这一段里没有意义）；传 null 回到不按时间段读。
 * ⛔ **不动** `expandedMilestoneId`（与翻页同一条「保持状态」纪律）。
 */
export async function setMilestonesPlanWindow(
  host: ProjectPlanningHost,
  projectId: string,
  window: ProjectPlanWindow | null,
): Promise<void> {
  host.milestonesPlanWindow = window;
  host.milestonesPage = 1;
  return fetchMilestones(host, projectId);
}

/**
 * 展开 / 收起一个业务目标（单开：展开 B 时 A 自动收起）。
 *
 * 展开时顺手取它的多轮迭代（`loadMilestoneIterations`）。收起时**不清**已缓存的迭代
 * （下次展开先亮缓存再刷新，不闪空）。⛔ 收起返回后不触发任何取数。
 */
export async function toggleMilestone(
  host: ProjectPlanningHost,
  projectId: string,
  milestoneId: string,
): Promise<void> {
  if (host.expandedMilestoneId === milestoneId) {
    host.expandedMilestoneId = null;
    return;
  }
  host.expandedMilestoneId = milestoneId;
  return loadMilestoneIterations(host, projectId, milestoneId);
}

/**
 * 取一个业务目标下的多轮迭代（含每轮的授权关联需求摘要）。
 *
 * 按 `milestoneId` 各存一份、各有请求序号：`epoch` 守切项目、`requestId` 守同目标并发乱序。
 * ⛔ 失败**不清**该目标已缓存的迭代（保留旧内容 + 该目标出错误条）。
 */
export async function loadMilestoneIterations(
  host: ProjectPlanningHost,
  projectId: string,
  milestoneId: string,
): Promise<void> {
  const epoch = host.projectEpoch;
  const requestId = (host.milestoneIterationsRequestIds[milestoneId] ?? 0) + 1;
  host.milestoneIterationsRequestIds = {
    ...host.milestoneIterationsRequestIds,
    [milestoneId]: requestId,
  };
  const stale = (): boolean =>
    epoch !== host.projectEpoch || requestId !== host.milestoneIterationsRequestIds[milestoneId];
  host.milestoneIterationsLoading = { ...host.milestoneIterationsLoading, [milestoneId]: true };
  try {
    // ⭐ 一次取满一页（100）：MIL-05 的分组/筛选/排序都在客户端做，需要该目标下的**全部**
    //    轮次（一个目标下轮次数远小于 100）。⛔ 别只取默认 20 页，否则分组会缺行。
    const result = await projectCollabApi.iterationList({
      projectId,
      milestoneId,
      pageSize: ITERATION_LIST_PAGE_SIZE,
    });
    if (stale()) return;
    if (!result.ok) {
      host.milestoneIterationsError = {
        ...host.milestoneIterationsError,
        [milestoneId]: projectCollabErrorNotice(result.code),
      };
      return;
    }
    host.milestoneIterations = { ...host.milestoneIterations, [milestoneId]: result.items };
    host.milestoneIterationsError = { ...host.milestoneIterationsError, [milestoneId]: null };
  } catch {
    if (!stale()) {
      host.milestoneIterationsError = {
        ...host.milestoneIterationsError,
        [milestoneId]: projectCollabErrorNotice('transient'),
      };
    }
  } finally {
    if (!stale()) {
      host.milestoneIterationsLoading = {
        ...host.milestoneIterationsLoading,
        [milestoneId]: false,
      };
    }
  }
}

/* ══════════════════════════════════════════════════════════════════════════════
 * MIL-05：迭代列表的视图态（分组/搜索/排序/显示已完成）+ 行内编辑 + 快速添加
 *
 * ⭐ 视图态**按 milestoneId 各存一份**（`host.iterationViews[milestoneId]`）——切到另一个
 *    目标就是另一份键，A 目标的筛选/草稿绝不串到 B（判据「切目标不串数据」的载体）。
 *    ⛔ 变异锚点：若改成一份**全局**视图态（不按 milestoneId 分键），切目标会带出上一个
 *       目标的筛选/草稿，`getIterationView(B)` 立即读到 A 的态 —— 负向用例转红。
 * ═══════════════════════════════════════════════════════════════════════════ */

/** 取某目标的视图态（没有则返回默认，⛔ 不写回——读不该有副作用）。 */
export function getIterationView(
  host: ProjectPlanningHost,
  milestoneId: string,
): IterationViewState {
  return host.iterationViews[milestoneId] ?? createIterationViewState();
}

/** 就地合并某目标的视图态（关键字/筛选/排序/显示已完成/快速添加开关等）。 */
export function setIterationView(
  host: ProjectPlanningHost,
  milestoneId: string,
  patch: Partial<IterationViewState>,
): void {
  host.iterationViews = {
    ...host.iterationViews,
    [milestoneId]: { ...getIterationView(host, milestoneId), ...patch },
  };
}

/** 排序：点同一列切方向，点别的列换列并复位升序（照原型 `stage-sort28`）。 */
export function toggleIterationSort(
  host: ProjectPlanningHost,
  milestoneId: string,
  field: IterationViewState['sort'],
): void {
  const view = getIterationView(host, milestoneId);
  if (view.sort === field) {
    setIterationView(host, milestoneId, { direction: view.direction === 1 ? -1 : 1 });
  } else {
    setIterationView(host, milestoneId, { sort: field, direction: 1 });
  }
}

/** 合并某目标的快速添加草稿（⛔ 不动其它视图字段）。 */
export function setIterationQuickDraft(
  host: ProjectPlanningHost,
  milestoneId: string,
  patch: Partial<IterationDraft>,
): void {
  const view = getIterationView(host, milestoneId);
  setIterationView(host, milestoneId, { quickDraft: { ...view.quickDraft, ...patch } });
}

/** 打开/关闭快速添加行；关闭时清空草稿（用户主动取消 ⇒ 不留痕）。 */
export function setIterationQuickAddOpen(
  host: ProjectPlanningHost,
  milestoneId: string,
  open: boolean,
): void {
  setIterationView(host, milestoneId, {
    quickAddOpen: open,
    ...(open ? {} : { quickDraft: EMPTY_ITERATION_DRAFT }),
  });
}

/**
 * 行内编辑保存（负责人 / 优先级 / 日期），乐观锁。三态回执（照 `projectCollabBoard.updateTodo`）：
 *  - `ok`：把返回的权威轮次替换进 `milestoneIterations[milestoneId]`；
 *  - `conflict`：版本冲突（409）**不是普通失败**——就地重取该目标最新迭代 + 常驻提示，
 *    让用户在新版本上重下决定；⛔ 不拿旧版本重试；调用方据此保留输入、别当成功；
 *  - `error`：真实失败，设错误提示。
 *
 * ⚠️ `clientRequestId` 由调用方生成并在重试时保持不变（服务端幂等键）。
 */
export async function saveIterationField(
  host: ProjectPlanningHost,
  request: {
    readonly projectId: string;
    readonly milestoneId: string;
    readonly iterationId: string;
    readonly field: IterationEditableField;
    readonly value: string | null;
    readonly expectedVersion: number;
    readonly clientRequestId: string;
  },
): Promise<'ok' | 'conflict' | 'error'> {
  const epoch = host.projectEpoch;
  try {
    const result = await projectCollabApi.iterationUpdate({
      projectId: request.projectId,
      iterationId: request.iterationId,
      expectedVersion: request.expectedVersion,
      clientRequestId: request.clientRequestId,
      [request.field]: request.value,
    });
    if (epoch !== host.projectEpoch) return 'error';
    if (!result.ok) {
      // 业务目标归档即整条只读（409 `milestone_archived`）：终态说明，⛔ 不当成版本冲突去重取重试。
      const serverText = projectIterationUpdateServerCodeText(result.serverCode);
      if (serverText !== null) {
        host.iterationActionNotice = projectCollabErrorNotice(result.code, serverText);
        return 'error';
      }
      if (result.code === 'conflict') {
        host.iterationActionNotice =
          projectCollabInfoNotice('该迭代已被他人更新，已为你刷新到最新版本。');
        await loadMilestoneIterations(host, request.projectId, request.milestoneId);
        return 'conflict';
      }
      host.iterationActionNotice = projectCollabErrorNotice(result.code);
      return 'error';
    }
    replaceIteration(host, request.milestoneId, result.iteration);
    host.iterationActionNotice = null;
    return 'ok';
  } catch {
    if (epoch === host.projectEpoch) {
      host.iterationActionNotice = projectCollabErrorNotice('transient');
    }
    return 'error';
  }
}

/**
 * 快速添加一轮迭代（草稿 → 新建）。三态回执：
 *  - `ok`：把新轮次并进列表、清空草稿并收起快速添加行；
 *  - `conflict` / `error`：⛔ **保留草稿**（`quickDraft` 一个字不动），只设提示 ——
 *    这是判据「409 保留草稿」的载体：不吞掉用户填的内容。
 *
 * ⛔ 变异锚点：在 `conflict`/`error` 分支里清掉草稿（`setIterationQuickAddOpen(false)` 之类）
 *    ⇒ 判据「409 保留草稿」立即转红。
 */
export async function saveQuickIteration(
  host: ProjectPlanningHost,
  request: {
    readonly projectId: string;
    readonly milestoneId: string;
    readonly clientRequestId: string;
  },
): Promise<'ok' | 'conflict' | 'error'> {
  const epoch = host.projectEpoch;
  const draft = getIterationView(host, request.milestoneId).quickDraft;
  try {
    const result = await projectCollabApi.iterationCreate({
      projectId: request.projectId,
      milestoneId: request.milestoneId,
      clientRequestId: request.clientRequestId,
      name: draft.name,
      dueAt: draft.dueAt ? draft.dueAt : null,
      criteriaMd: draft.criteriaMd,
    });
    if (epoch !== host.projectEpoch) return 'error';
    if (!result.ok) {
      // ⛔ 保留草稿：conflict / error 都不清 quickDraft（不吞用户输入）。
      host.iterationActionNotice =
        result.code === 'conflict'
          ? projectCollabInfoNotice('该请求已被使用，请稍后重试（你填的内容已保留）。')
          : projectCollabErrorNotice(result.code);
      return result.code === 'conflict' ? 'conflict' : 'error';
    }
    // 成功才清草稿并收起快速添加行。
    host.milestoneIterations = {
      ...host.milestoneIterations,
      [request.milestoneId]: [
        ...(host.milestoneIterations[request.milestoneId] ?? []),
        result.iteration,
      ],
    };
    setIterationView(host, request.milestoneId, {
      quickAddOpen: false,
      quickDraft: EMPTY_ITERATION_DRAFT,
    });
    host.iterationActionNotice = null;
    return 'ok';
  } catch {
    if (epoch === host.projectEpoch) {
      host.iterationActionNotice = projectCollabErrorNotice('transient');
    }
    // ⛔ 草稿同样保留（网络异常也不该吞掉用户输入）。
    return 'error';
  }
}

/**
 * 把一条更新后的轮次替换回某目标的迭代列表（不动别条、不动别的目标）。
 * 生命周期（MIL-07，`projectCollabPlanningLifecycle`）的成功回写也走这一处。
 */
export function replaceIteration(
  host: ProjectPlanningHost,
  milestoneId: string,
  iteration: ProjectIterationListItem,
): void {
  const current = host.milestoneIterations[milestoneId] ?? [];
  host.milestoneIterations = {
    ...host.milestoneIterations,
    [milestoneId]: current.map((row) => (row.id === iteration.id ? iteration : row)),
  };
}
