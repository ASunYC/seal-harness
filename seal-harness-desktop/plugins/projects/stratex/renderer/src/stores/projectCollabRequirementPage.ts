import type { Todo } from '@shared/protocol/project-collab.js';

import { projectCollabErrorNotice } from './projectCollabErrors';
import type {
  ProjectCollabState,
  RequirementPageFilters,
  RequirementPageSize,
  RequirementSubtreeState,
} from './projectCollabState';

import { projectCollabApi } from '../sdk/projectCollab';

/**
 * 需求页码查询（CORE-07）的看板动作——服务端分页 + 过滤 + 按需子树。
 *
 * 与 `projectCollabBoard.loadTodos`（游标全量投影，拉满翻页后本地成树）**并存**：本模块
 * 只拿**一页**（服务端 items/total/page/pageSize/queryRevision），界面翻页不再把 40 页
 * 拉满本地切。⚠️ 让界面真正改用这套需要 UX 线重接 `components/project/*`
 * （它们现在读扁平 `store.todos` 自己筛/排/分页），那不在本包 scope 内——本模块把
 * store 侧的分页引擎连同判据一起落地并自验，接线交 UX 线（ux-03/08/09）。
 *
 * 判据 3 的五个子项都落在这里：
 *  - **不再拉满 40 页后 slice**：`fetchPage` 一次只取一页；
 *  - **切筛选回第 1 页**：`setRequirementPageFilters` / `setRequirementPageSize` 复位 page=1；
 *  - **删除末页回退**：`reloadRequirementPageAfterDelete` 空页且非首页时退到有效末页；
 *  - **切项目迟到响应丢弃**：`projectEpoch` + `requirementPageRequestId` 双守（真乱序也挡）；
 *  - **子任务按需查询不占需求分页**：`loadRequirementSubtree` 走游标端点单独取、落子树字段，
 *    ⛔ 不动任何 requirement* 分页字段。
 */
export type ProjectRequirementPageHost = Pick<
  ProjectCollabState,
  | 'projectEpoch'
  | 'requirementItems'
  | 'requirementTotal'
  | 'requirementPage'
  | 'requirementPageSize'
  | 'requirementQueryRevision'
  | 'requirementPageLoading'
  | 'requirementPageActive'
  | 'requirementPageError'
  | 'requirementFilters'
  | 'requirementPageRequestId'
  | 'requirementSubtrees'
  | 'requirementSubtreeRequestIds'
  | 'requirementSubtreeStates'
>;

/** 子树按需取数的翻页封顶（照 board.loadTodos 的封顶纪律，防失控游标死循环）。 */
const SUBTREE_PAGE_LIMIT = 50;

/**
 * 取当前 page/pageSize/filters 对应的那一页。
 *
 * ⛔ 迟到/乱序作废：进函数即推进 `requirementPageRequestId`；await 回来后 epoch 或
 * requestId 但凡对不上就整段丢弃（不写 items/total/error/loading）——切到项目 B 之后，
 * 项目 A 的迟到响应绝不覆盖 B 的数据；同项目并发重取只让最后发出的那次落地。
 */
async function fetchPage(host: ProjectRequirementPageHost, projectId: string): Promise<void> {
  const epoch = host.projectEpoch;
  const requestId = host.requirementPageRequestId + 1;
  host.requirementPageRequestId = requestId;
  const stale = (): boolean =>
    epoch !== host.projectEpoch || requestId !== host.requirementPageRequestId;
  host.requirementPageActive = true;
  host.requirementPageLoading = true;
  try {
    const result = await projectCollabApi.requirementPage({
      projectId,
      page: host.requirementPage,
      pageSize: host.requirementPageSize,
      ...host.requirementFilters,
    });
    if (stale()) return;
    if (!result.ok) {
      if (
        result.code === 'authRequired' ||
        result.code === 'credentialRejected' ||
        result.code === 'forbidden' ||
        (result.code === 'rejected' && result.serverCode === 'todo_not_found')
      ) {
        host.requirementItems = [];
        host.requirementTotal = 0;
        host.requirementQueryRevision = null;
        clearSubtrees(host);
      }
      host.requirementPageError = projectCollabErrorNotice(result.code);
      return;
    }
    host.requirementItems = result.items;
    host.requirementTotal = result.total;
    host.requirementPage = result.page;
    host.requirementPageSize = result.pageSize;
    host.requirementQueryRevision = result.queryRevision;
    host.requirementPageError = null;
  } catch {
    if (!stale()) host.requirementPageError = projectCollabErrorNotice('transient');
  } finally {
    if (!stale()) host.requirementPageLoading = false;
  }
}

/** 按当前 page/pageSize/filters 重取当前页。 */
export async function loadRequirementPage(
  host: ProjectRequirementPageHost,
  projectId: string,
): Promise<void> {
  return fetchPage(host, projectId);
}

/** 切筛选：整组替换筛选并**回第 1 页**（判据 3），再取。 */
export async function setRequirementPageFilters(
  host: ProjectRequirementPageHost,
  projectId: string,
  filters: RequirementPageFilters,
): Promise<void> {
  host.requirementFilters = { ...filters };
  host.requirementPage = 1;
  return fetchPage(host, projectId);
}

/** 改每页条数：同样回第 1 页（第 3 页 20 条 ≠ 第 3 页 5 条，页码语义变了）。 */
export async function setRequirementPageSize(
  host: ProjectRequirementPageHost,
  projectId: string,
  pageSize: RequirementPageSize,
): Promise<void> {
  host.requirementPageSize = pageSize;
  host.requirementPage = 1;
  return fetchPage(host, projectId);
}

/** 跳页（页码下界收在 1；上界非法由服务端回 400 落到 error 面）。 */
export async function goToRequirementPage(
  host: ProjectRequirementPageHost,
  projectId: string,
  page: number,
): Promise<void> {
  host.requirementPage = Math.max(1, Math.trunc(page));
  return fetchPage(host, projectId);
}

/**
 * 删除后重取当前页；若当前页删空了而前面还有页（判据 3「删除末页回退」），退到有效末页再取。
 * 用 total/pageSize 推末页（比「空了就退一页」稳：一次删掉整页多条也对）。
 */
export async function reloadRequirementPageAfterDelete(
  host: ProjectRequirementPageHost,
  projectId: string,
): Promise<void> {
  const epoch = host.projectEpoch;
  await fetchPage(host, projectId);
  if (epoch !== host.projectEpoch || host.requirementPageError) return;
  if (host.requirementItems.length === 0 && host.requirementTotal > 0 && host.requirementPage > 1) {
    const lastPage = Math.max(1, Math.ceil(host.requirementTotal / host.requirementPageSize));
    if (lastPage < host.requirementPage) {
      host.requirementPage = lastPage;
      await fetchPage(host, projectId);
    }
  }
}

/**
 * 展开一条需求，按需取它的直接子项（子需求 + 任务）。⛔ **不占需求分页**：走游标端点
 * 单独查、落 `requirementSubtrees[requirementId]`，全程不碰任何 requirement* 分页字段。
 * 每条子树各有请求序号，同一条需求并发重取时只让最后一次落地。
 */
export async function loadRequirementSubtree(
  host: ProjectRequirementPageHost,
  projectId: string,
  requirementId: string,
): Promise<void> {
  return fetchSubtreePage(host, projectId, requirementId, false);
}

export async function loadMoreRequirementSubtree(
  host: ProjectRequirementPageHost,
  projectId: string,
  requirementId: string,
): Promise<void> {
  const state = host.requirementSubtreeStates[requirementId];
  if (!state?.hasMore || !state.nextCursor || state.loading) return;
  return fetchSubtreePage(host, projectId, requirementId, true);
}

const emptySubtreeState = (): RequirementSubtreeState => ({
  loading: false,
  error: null,
  hasMore: false,
  nextCursor: null,
  seenCursors: [],
});

/** 换账号、项目或撤权时清理分页及在途请求；旧响应不能重新填回。 */
export function clearRequirementPages(host: ProjectRequirementPageHost): void {
  host.requirementPageActive = false;
  host.requirementItems = [];
  host.requirementTotal = 0;
  host.requirementPage = 1;
  host.requirementQueryRevision = null;
  host.requirementFilters = {};
  host.requirementPageLoading = false;
  host.requirementPageError = null;
  host.requirementPageRequestId += 1;
  clearSubtrees(host);
}

function clearSubtrees(host: ProjectRequirementPageHost): void {
  host.requirementSubtrees = {};
  host.requirementSubtreeStates = {};
  // 清空后同项目立即重开仍不能复用旧请求编号。
  host.requirementSubtreeRequestIds = Object.fromEntries(
    Object.entries(host.requirementSubtreeRequestIds).map(([id, requestId]) => [id, requestId + 1]),
  );
}

/** 数据变更后重取当前页及已经展开过的子树首页；继续加载仍由成员显式触发。 */
export async function refreshRequirementPage(
  host: ProjectRequirementPageHost,
  projectId: string,
): Promise<void> {
  const epoch = host.projectEpoch;
  const roots = Object.keys(host.requirementSubtreeStates);
  await reloadRequirementPageAfterDelete(host, projectId);
  if (epoch !== host.projectEpoch || !host.requirementPageActive || host.requirementPageError)
    return;
  await Promise.all(roots.map((id) => loadRequirementSubtree(host, projectId, id)));
}

async function fetchSubtreePage(
  host: ProjectRequirementPageHost,
  projectId: string,
  requirementId: string,
  append: boolean,
): Promise<void> {
  const epoch = host.projectEpoch;
  const requestId = (host.requirementSubtreeRequestIds[requirementId] ?? 0) + 1;
  host.requirementSubtreeRequestIds = {
    ...host.requirementSubtreeRequestIds,
    [requirementId]: requestId,
  };
  const stale = (): boolean =>
    epoch !== host.projectEpoch || requestId !== host.requirementSubtreeRequestIds[requirementId];
  const previous = append
    ? (host.requirementSubtreeStates[requirementId] ?? emptySubtreeState())
    : emptySubtreeState();
  const cursor = append ? previous.nextCursor : null;
  const setState = (state: RequirementSubtreeState): void => {
    host.requirementSubtreeStates = { ...host.requirementSubtreeStates, [requirementId]: state };
  };
  setState({ ...previous, loading: true, error: null });
  try {
    const result = await projectCollabApi.todoList({
      projectId,
      parentId: requirementId,
      limit: SUBTREE_PAGE_LIMIT,
      ...(cursor ? { cursor } : {}),
    });
    if (stale()) return;
    if (!result.ok) {
      const revoked =
        result.code === 'authRequired' ||
        result.code === 'credentialRejected' ||
        result.code === 'forbidden' ||
        (result.code === 'rejected' && result.serverCode === 'todo_not_found');
      if (revoked) host.requirementSubtrees = { ...host.requirementSubtrees, [requirementId]: [] };
      setState({
        ...(revoked ? emptySubtreeState() : previous),
        loading: false,
        error: projectCollabErrorNotice(result.code),
      });
      return;
    }
    const seen = cursor ? [...previous.seenCursors, cursor] : [];
    if (
      result.hasMore !== (result.nextCursor !== null) ||
      (result.nextCursor !== null && seen.includes(result.nextCursor))
    ) {
      setState({ ...previous, loading: false, error: projectCollabErrorNotice('transient') });
      return;
    }
    const current = new Map(
      (host.requirementSubtrees[requirementId] ?? []).map((item) => [item.id, item]),
    );
    const rows = new Map<string, Todo>(append ? current : []);
    for (const item of result.todos) {
      const cached = current.get(item.id);
      rows.set(item.id, cached && cached.version > item.version ? cached : item);
    }
    host.requirementSubtrees = { ...host.requirementSubtrees, [requirementId]: [...rows.values()] };
    setState({
      loading: false,
      error: null,
      hasMore: result.hasMore,
      nextCursor: result.nextCursor,
      seenCursors: seen,
    });
  } catch {
    if (!stale())
      setState({ ...previous, loading: false, error: projectCollabErrorNotice('transient') });
  }
}
