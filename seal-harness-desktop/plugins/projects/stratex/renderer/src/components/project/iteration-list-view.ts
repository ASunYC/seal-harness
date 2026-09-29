import type {
  ProjectIterationListItem,
  ProjectIterationPriority,
  ProjectIterationSort,
} from '@shared/protocol/project-planning.js';

/**
 * 迭代列表（MIL-05）的**纯展示/派生**辅助：分组、筛选、排序、去重汇总。
 *
 * ⚠️ 权威来自项目组原型 `index.html` 的**终版**（第 28 层 `milestones-v28`，
 *    `renderIterationPlan26` 在 `:2765` 被 v31 覆写、v31 展开时调 v28 的 `milestoneList28`）：
 *    - 分组 `milestoneList28`（`:2681`）＝**我的 / 未完成 / 已完成**（`mine/open/done`）；
 *    - 筛选下拉 `stage-filter28`（`:2691`）＝ `全部 / 我负责的 / 未计划 / 已逾期 / 已完成`
 *      （`all/mine/unplanned/overdue/done`）——这是一个**单独**的下拉，不是分组本身；
 *    - `visibleMilestones28`（`:2676`）先按关键字 + 下拉筛，再排序；`milestoneList28`
 *      把筛完的结果再切成三组。
 *  ⛔ 别照 `:2599/:2630/:2690` 那几层做——它们是被覆写的中间态，页面照样渲染但行为是旧的。
 *
 * ⭐ 判据 3：同一迭代会**同时**落进「我的」与「未完成」两组 ⇒ 汇总必须**按 id 去重**，
 *    ⛔ 不许把各组的行数相加当总数（载体＝`distinctIterationCount`）。
 *
 * ⚠️ 这里出现的一切都在客户端算：筛选/排序/分组按原型都在前端做（后端另有服务端
 *    `group_counts` 去重势，作为「共 N 条」的权威口径由 store 保留）。本模块不发请求。
 */

/** 迭代分组的键（与原型 `milestoneList28` 的三组逐一对应）。 */
export type IterationGroupKey = 'mine' | 'open' | 'done';

/** 迭代筛选下拉的档位（与原型 `stage-filter28` 逐字对应）。 */
export type IterationFilter = 'all' | 'mine' | 'unplanned' | 'overdue' | 'done';

/** 分组标题（原型 `milestoneList28` 的三个 label）。 */
export const ITERATION_GROUP_LABELS: Readonly<Record<IterationGroupKey, string>> = {
  mine: '我的迭代计划',
  open: '未完成迭代计划',
  done: '已完成迭代计划',
};

/**
 * 筛选下拉的档位与文案（顺序即下拉顺序，与原型一致）。
 *
 * ⚠️ 与判据文字（「我的 / 未完成 / 已完成」）**不完全对应**：判据那三个词是**分组**
 *    （见 `ITERATION_GROUP_LABELS`），而这里是**筛选下拉**——原型把「未完成」拆成
 *    `未计划` + `已逾期` 两档、没有单独的「未完成」档。差异照原型实现，交负责人裁。
 */
export const ITERATION_FILTER_OPTIONS: ReadonlyArray<{
  readonly value: IterationFilter;
  readonly label: string;
}> = [
  { value: 'all', label: '全部' },
  { value: 'mine', label: '我负责的' },
  { value: 'unplanned', label: '未计划' },
  { value: 'overdue', label: '已逾期' },
  { value: 'done', label: '已完成' },
];

/** 排序方向：1 升序、-1 降序（与原型 `s.direction` 同义）。 */
export type IterationSortDirection = 1 | -1;

/** 优先级排序权重：高在前（与原型 `rank={高:0,中:1,低:2}` 同序，值改用英文闭集）。 */
const PRIORITY_RANK: Readonly<Record<ProjectIterationPriority, number>> = {
  high: 0,
  medium: 1,
  low: 2,
};

/**
 * 这一轮是否**已逾期**：仅进行中（`open`）且有到期日且到期日早于今天。
 *
 * ⚠️ 已达成（`completed`）**永不**算逾期——达成与逾期是两件事（原型 `milestoneStatus27`
 *    先判 `completedAt` 再判 `due<today`）。`today` 由调用方传入（`YYYY-MM-DD`），
 *    ⛔ 本模块不读时钟（纯函数、可测）。
 */
export function isIterationOverdue(item: ProjectIterationListItem, today: string): boolean {
  return item.status === 'open' && item.dueAt != null && dueDay(item.dueAt) < today;
}

/** 取到期日的日历日（`YYYY-MM-DD`）；用于与 `today` 同粒度比较。null → 空串（排最后）。 */
function dueDay(dueAt: string | null): string {
  return dueAt ? dueAt.slice(0, 10) : '';
}

/**
 * 关键字匹配：名称 **或** 达成标准的大小写无关子串（原型 `visibleMilestones28` 同口径：
 * `${m.title} ${m.criteria.join(' ')}`）。空关键字恒真。
 */
export function iterationMatchesQuery(item: ProjectIterationListItem, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return `${item.name} ${item.criteriaMd}`.toLowerCase().includes(q);
}

/**
 * 筛选下拉匹配（原型 `visibleMilestones28` 的五档）。
 *
 * ⚠️ `mine` ＝「负责人是我」（判据里的「负责人过滤」在原型就是这一档）；`subject` 为
 *    null（未登录/未知）时 `mine`/`overdue` 判负责人那部分恒不命中，⛔ 不放行全部。
 */
export function iterationMatchesFilter(
  item: ProjectIterationListItem,
  filter: IterationFilter,
  options: { readonly subject: string | null; readonly today: string },
): boolean {
  switch (filter) {
    case 'all':
      return true;
    case 'mine':
      return item.ownerSubject != null && item.ownerSubject === options.subject;
    case 'unplanned':
      return item.dueAt == null;
    case 'overdue':
      return isIterationOverdue(item, options.today);
    case 'done':
      return item.status === 'completed';
    default:
      return true;
  }
}

/**
 * 排序（原型 `visibleMilestones28` 末尾的 `sort`）：
 *  - `priority`：按 `PRIORITY_RANK`（高→低）；
 *  - 其它（`due_at`/`created_at`/`name`）：按对应字段字典序，**到期日 null 排最后**。
 * `direction` 乘在比较结果上（1 升 / -1 降）。返回**新数组**（不改入参）。
 */
export function sortIterations(
  items: readonly ProjectIterationListItem[],
  sort: ProjectIterationSort,
  direction: IterationSortDirection,
): ProjectIterationListItem[] {
  const key = (item: ProjectIterationListItem): string | number => {
    switch (sort) {
      case 'priority':
        return PRIORITY_RANK[item.priority];
      case 'due_at':
        return item.dueAt ? dueDay(item.dueAt) : '9999-99-99';
      case 'name':
        return item.name;
      case 'created_at':
      default:
        return item.createdAt;
    }
  };
  return [...items].sort((a, b) => {
    const ka = key(a);
    const kb = key(b);
    const cmp = ka < kb ? -1 : ka > kb ? 1 : 0;
    return cmp * direction;
  });
}

/**
 * 应用关键字 + 筛选下拉 + 排序，得到**可见列表**（分组之前的那一步）。
 *
 * ⭐ 「可联动」（判据 1）：四件事在同一条链上依次作用——关键字与筛选各自缩小集合、
 *    排序重排结果，⛔ 后者不覆盖前者（改排序不清关键字，改关键字不复位排序）。
 */
export function visibleIterations(
  items: readonly ProjectIterationListItem[],
  options: {
    readonly query: string;
    readonly filter: IterationFilter;
    readonly subject: string | null;
    readonly today: string;
    readonly sort: ProjectIterationSort;
    readonly direction: IterationSortDirection;
  },
): ProjectIterationListItem[] {
  const filtered = items.filter(
    (item) =>
      iterationMatchesQuery(item, options.query) &&
      iterationMatchesFilter(item, options.filter, options),
  );
  return sortIterations(filtered, options.sort, options.direction);
}

/** 一个分组：键、标题、命中的行。 */
export interface IterationGroup {
  readonly key: IterationGroupKey;
  readonly label: string;
  readonly rows: readonly ProjectIterationListItem[];
}

/**
 * 把可见列表切成三组（原型 `milestoneList28`）：
 *  - `mine`：负责人是我，且（勾了「显示已完成」时才含已达成，否则只含进行中）；
 *  - `open`：进行中（`status==='open'`）；
 *  - `done`：已达成（`status==='completed'`）。
 *
 * ⚠️ **三组会重叠**：一条「我负责的进行中」轮次同时进 `mine` 与 `open`——这是有意的，
 *    也正是判据 3 的来源。所以「共几条」必须走 `distinctIterationCount`（去重），
 *    ⛔ 不能把三组行数相加。
 */
export function groupIterations(
  items: readonly ProjectIterationListItem[],
  options: { readonly subject: string | null; readonly showDone: boolean },
): IterationGroup[] {
  const isMine = (item: ProjectIterationListItem): boolean =>
    item.ownerSubject != null && item.ownerSubject === options.subject;
  return [
    {
      key: 'mine',
      label: ITERATION_GROUP_LABELS.mine,
      rows: items.filter(
        (item) => isMine(item) && (options.showDone || item.status !== 'completed'),
      ),
    },
    {
      key: 'open',
      label: ITERATION_GROUP_LABELS.open,
      rows: items.filter((item) => item.status === 'open'),
    },
    {
      key: 'done',
      label: ITERATION_GROUP_LABELS.done,
      rows: items.filter((item) => item.status === 'completed'),
    },
  ];
}

/**
 * 汇总条数：**按 id 去重的并集势**（判据 3 的机器载体）。
 *
 * ⭐ 因为分组重叠，`mine.length + open.length + done.length` 会**大于**真实条数；本函数
 *    把所有组的 id 并进一个集合再数，得到不重复的迭代数。
 * ⛔ 变异锚点：把它改成 `groups.reduce((n,g)=>n+g.rows.length,0)`（各组求和）——只要夹具里
 *    有一条同时落进「我的」与「未完成」，本值就会偏大，判据用例立即转红。
 */
export function distinctIterationCount(groups: readonly IterationGroup[]): number {
  const ids = new Set<string>();
  for (const group of groups) {
    for (const row of group.rows) ids.add(row.id);
  }
  return ids.size;
}
