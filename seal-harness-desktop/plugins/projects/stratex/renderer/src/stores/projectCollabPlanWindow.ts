import type {
  ProjectCollabErrorCode,
  Todo,
  TodoItemKind,
} from '@shared/protocol/project-collab.js';

import { projectCollabErrorNotice } from './projectCollabErrors';
import type { PlanWindowQuery, ProjectCollabState } from './projectCollabState';

import { projectCollabApi } from '../sdk/projectCollab';

/**
 * 按计划时间段读取（CORE-08，ADR-0042）：日历与时间轴**当前可见的那一段**向服务端取数。
 *
 * ⭐ 日期由服务端判：`planFrom` / `planTo` 走需求分页的计划区间交叠筛选（含左不含右、按 UTC 日展开，
 *    只有截止按截止当天算，截止为空不进结果），本模块把这一段**逐页取全**落进 `planWindowItems`。
 *    ⛔ 不在这里、也不在视图里再按日期筛一遍——那正是本条要去掉的「对一页结果本地筛选」。
 * ⭐ 一致性：跨页的项目修订号（`queryRevision`）变了＝取数途中有人改了数据，整段重取（至多三次，
 *    最后一次照单全收，随后的 `todo.changed` 事件还会再取一次）；同一 id 在两页里出现只留一份。
 * ⭐ 作废：进函数即推进 `planWindowRequestId`；await 回来 epoch（切项目 / 换号）或请求序号对不上就整段丢弃。
 * ⚠️ 上限：单种类最多取 `PLAN_WINDOW_MAX_PAGES` 页（每页 20 条），到顶即停并置 `planWindowTruncated`，
 *    视图注明「只显示前 N 条」——⛔ 不静默截断。
 */
export type ProjectPlanWindowHost = Pick<
  ProjectCollabState,
  | 'projectEpoch'
  | 'todos'
  | 'planWindowQuery'
  | 'planWindowItems'
  | 'planWindowLoading'
  | 'planWindowError'
  | 'planWindowTruncated'
  | 'planWindowRequestId'
>;

/** 需求分页每页条数的上界（协议闭集 5 / 10 / 20 里最大的那个）。 */
const PLAN_WINDOW_PAGE_SIZE = 20;
/** 单种类最多取几页（500 条）；再多就要专用的时间段读取端点了（ADR-0042 后果）。 */
export const PLAN_WINDOW_MAX_PAGES = 25;
/** 单种类最多显示的条数（视图的截断注明读它）。 */
export const PLAN_WINDOW_MAX_ITEMS_PER_KIND = PLAN_WINDOW_PAGE_SIZE * PLAN_WINDOW_MAX_PAGES;
/** 跨页修订号变了时整段重取的总次数上限。 */
const PLAN_WINDOW_MAX_ATTEMPTS = 3;

/** 需求页只取需求；任务页需求与任务都取（归属收窄在渲染层按需求树判，服务端表达不了子树）。 */
function kindsFor(scope: PlanWindowQuery['scope']): readonly TodoItemKind[] {
  return scope === 'task' ? ['requirement', 'task'] : ['requirement'];
}

function sameQuery(a: PlanWindowQuery | null, b: PlanWindowQuery): boolean {
  return a !== null && a.scope === b.scope && a.planFrom === b.planFrom && a.planTo === b.planTo;
}

type CollectOutcome =
  | { readonly kind: 'stale' }
  | { readonly kind: 'failed'; readonly code: ProjectCollabErrorCode }
  | { readonly kind: 'revisionChanged' }
  | { readonly kind: 'done'; readonly items: readonly Todo[]; readonly truncated: boolean };

/**
 * 把这一段逐页取一遍。`stopOnRevisionChange` 为真时修订号一变就提前收手（还有重取机会，
 * 省掉剩下的请求）；最后一次尝试传假，照单取完。
 */
async function collectOnce(
  projectId: string,
  query: PlanWindowQuery,
  stale: () => boolean,
  stopOnRevisionChange: boolean,
): Promise<CollectOutcome> {
  let revision: string | null = null;
  let truncated = false;
  const byId = new Map<string, Todo>();
  for (const itemKind of kindsFor(query.scope)) {
    for (let page = 1; ; page += 1) {
      const result = await projectCollabApi.requirementPage({
        projectId,
        page,
        pageSize: PLAN_WINDOW_PAGE_SIZE,
        itemKind,
        planFrom: query.planFrom,
        planTo: query.planTo,
      });
      if (stale()) return { kind: 'stale' };
      if (!result.ok) return { kind: 'failed', code: result.code };
      if (revision === null) revision = result.queryRevision;
      else if (revision !== result.queryRevision && stopOnRevisionChange) {
        return { kind: 'revisionChanged' };
      }
      for (const item of result.items) byId.set(item.id, item);
      if (result.items.length === 0 || page * PLAN_WINDOW_PAGE_SIZE >= result.total) break;
      if (page >= PLAN_WINDOW_MAX_PAGES) {
        truncated = true;
        break;
      }
    }
  }
  return { kind: 'done', items: [...byId.values()], truncated };
}

/**
 * 取这一段。换了一段（层级或两端任一不同）先清空旧结果——上一段的条目不属于这一段，留着会在
 * 时间轴上被裁切画出来；同一段重取（事件 / 写入之后）保留旧结果直到新结果落地，不闪空。
 */
export async function loadPlanWindow(
  host: ProjectPlanWindowHost,
  projectId: string,
  query: PlanWindowQuery,
): Promise<void> {
  const epoch = host.projectEpoch;
  const requestId = host.planWindowRequestId + 1;
  host.planWindowRequestId = requestId;
  const stale = (): boolean =>
    epoch !== host.projectEpoch || requestId !== host.planWindowRequestId;
  if (!sameQuery(host.planWindowQuery, query)) {
    host.planWindowItems = [];
    host.planWindowTruncated = false;
    host.planWindowError = null;
  }
  host.planWindowQuery = query;
  host.planWindowLoading = true;
  try {
    for (let attempt = 1; attempt <= PLAN_WINDOW_MAX_ATTEMPTS; attempt += 1) {
      const outcome = await collectOnce(
        projectId,
        query,
        stale,
        attempt < PLAN_WINDOW_MAX_ATTEMPTS,
      );
      if (outcome.kind === 'stale') return;
      if (outcome.kind === 'revisionChanged') continue;
      if (outcome.kind === 'failed') {
        host.planWindowError = projectCollabErrorNotice(outcome.code);
        return;
      }
      host.planWindowItems = outcome.items;
      host.planWindowTruncated = outcome.truncated;
      host.planWindowError = null;
      return;
    }
  } catch {
    if (!stale()) host.planWindowError = projectCollabErrorNotice('transient');
  } finally {
    if (!stale()) host.planWindowLoading = false;
  }
}

/**
 * 按当前这一段重取（清单重取、本端写入之后）；没有视图持有时间段（还没报过，或已离屏交还）就什么都不做。
 */
export async function reloadPlanWindow(
  host: ProjectPlanWindowHost,
  projectId: string,
): Promise<void> {
  const query = host.planWindowQuery;
  if (query === null) return;
  return loadPlanWindow(host, projectId, query);
}

/**
 * 日历 / 时间轴离屏（切到别的视图、页签卸载）时交还这一段：作废在途请求、清空结果。之后的 `todo.changed`、
 * 清单重取与切项目都不再为一段没人看的时间段发请求；视图再挂载时会重新报一段、重新取。
 */
export function releasePlanWindow(host: ProjectPlanWindowHost): void {
  host.planWindowRequestId += 1;
  host.planWindowQuery = null;
  host.planWindowItems = [];
  host.planWindowLoading = false;
  host.planWindowError = null;
  host.planWindowTruncated = false;
}

/**
 * 本端改单成功后，把 `todos` 里那条的新版本就地换进这一段（在它还在这一段里的前提下）。
 * 时间轴拖动落库回来时撤掉乐观预览，条要停在新区间而不是先弹回旧区间再等重取；
 * 换进来之后仍以随即发起的重取为准（它可能已移出这一段）。
 */
export function syncPlanWindowTodo(host: ProjectPlanWindowHost, todoId: string): void {
  const fresh = host.todos.find((todo) => todo.id === todoId);
  if (fresh === undefined) return;
  if (!host.planWindowItems.some((todo) => todo.id === todoId)) return;
  host.planWindowItems = host.planWindowItems.map((todo) => (todo.id === todoId ? fresh : todo));
}
