import { projectStorage } from '../../../../../src/ui/runtime';
/**
 * 项目详情「视图」的集合、默认视图、额外视图的开启偏好与安全恢复（UX-03 判据 1/2）。
 *
 * ## 权威来源（⚠️ 别读错层）
 *
 * 集合、默认、增删语义、文案的唯一收口是项目组原型
 * `docs/prototypes/project-collaboration-v1/index.html`——它是分层增量打补丁的 HTML
 * （约 18 层 `render=function` 覆写，后定义的层最外、最后生效），查这两个动作一律找
 * **最后一层**（`:1751` 起那一层）：
 *  - 「表格、看板始终保留，其他面板按当前项目需要添加」= `addViewPanel`（`:1760`）；
 *  - 额外视图集合 = `addedViews()` ＝ `data.project.extraViews||[]`（`:1753`）；额外视图只有
 *    日历（`calendar`）与时间轴（`timeline`）两项；
 *  - 「＋」勾选后才启用、取消勾选即移除 = `:1760` 保存回调；
 *  - 移除面板只调整显示、**不删需求/日期** = `:1760`「移除面板只调整显示，需求和日期记录保留」
 *    与 `helpGroups.views`（`:1773`）「移除面板不删除需求或日期」；
 *  - 当前视图不在启用集时**回落表格** = `:1756`/`:1760` 的 `view='table'`。
 *
 * todos.json 的 ux-03 acceptance 是从原型**派生**的副本；⛔ 两者将来不一致以原型为准、
 * 回头修 todos.json，不是反过来。
 *
 * ## 与 project-tabs.ts 的偏好语义关系（判据 2 报告要点 4）
 *
 * 「已有偏好保留」这一族与 `orderTabsWithPreference`（`:2541` `tabOrder24()`）**同族**：
 * 未知/废弃 id **逐项丢弃**（不整份作废）、保留相对序、去重、解析失败整份回落默认。
 * ⚠️ 只有一处**刻意不同**：页签是「全部恒在，只排序」，故 `orderTabsWithPreference` 会把
 * 缺失项补到末尾；视图里**表格/看板是固定视图恒在**，额外视图是 opt-in——「不在偏好里」
 * ＝「没启用」，所以 `orderEnabledExtraViews` **不补齐**缺失项。除这一步外语义逐条对齐。
 */

/** 项目详情里可切换的全部视图。 */
export type ProjectView = 'table' | 'board' | 'calendar' | 'timeline';

/** 由「＋」增删的额外视图（固定视图不在此列）。 */
export type ProjectExtraView = 'calendar' | 'timeline';

export interface ProjectViewDef {
  readonly id: ProjectView;
  readonly label: string;
  /** 固定视图（表格/看板）始终保留、不受偏好增删；额外视图（日历/时间轴）由「＋」管理。 */
  readonly fixed: boolean;
  /** 额外视图在「添加或管理面板」里的一句说明（逐字取自原型 `addViewPanel` 的 desc）。 */
  readonly description?: string;
}

/**
 * 全部视图定义。文案逐字对照原型 `:1760` `addViewPanel` 的 `[{id,name,desc}]`。
 * ⛔ 改这里等于改产品口径，须回原型核对（todos.json 只是派生副本）。
 */
export const PROJECT_VIEWS: readonly ProjectViewDef[] = [
  { id: 'table', label: '表格', fixed: true },
  { id: 'board', label: '看板', fixed: true },
  {
    id: 'calendar',
    label: '日历',
    fixed: false,
    description: '按计划完成日期查看安排，切换月份后打开需求。',
  },
  {
    id: 'timeline',
    label: '时间轴',
    fixed: false,
    description: '横向查看开始到完成日期，名称与完整日期始终可读。',
  },
];

/** 固定视图（恒在、恒在最前）——判据 1「首次仅表格+看板」。 */
export const FIXED_VIEWS: readonly ProjectView[] = ['table', 'board'];

/** 可由「＋」添加的额外视图——判据 1「＋添加日历时间轴」。 */
export const EXTRA_VIEWS: readonly ProjectExtraView[] = ['calendar', 'timeline'];

/**
 * 新用户（无任何偏好）看到的视图集合 = 只有两个固定视图。
 * ⚠️ 判据 1 铁律：**首次仅表格+看板**，⛔ 不是四个；日历/时间轴要走「＋」主动加。
 */
export const DEFAULT_ENABLED_VIEWS: readonly ProjectView[] = [...FIXED_VIEWS];

/**
 * 当前视图无法确定（偏好缺失 / 当前视图被移除）时的安全落点。
 * 依据原型 `:1756`/`:1760`：`if(!enabled.includes(view)) view='table'`。表格是固定视图、恒在。
 */
export const DEFAULT_PROJECT_VIEW: ProjectView = 'table';

/** `value` 是不是一个合法的项目视图 id（读回持久化的裸串时用它把脏值挡在门外）。 */
export function isProjectView(value: unknown): value is ProjectView {
  return typeof value === 'string' && PROJECT_VIEWS.some((def) => def.id === value);
}

/** 视图 id → 定义。认不出返回 null（脏值不该崩，交由调用方回落）。 */
export function projectViewDef(id: string): ProjectViewDef | null {
  return PROJECT_VIEWS.find((def) => def.id === id) ?? null;
}

/**
 * 「已有偏好保留」的纯函数（判据 2）——**逐条对齐** `orderTabsWithPreference`，除末尾补齐外：
 *
 * - 只保留 `all`（默认＝两个额外视图）里认得的 id：偏好里**已废弃/未知的视图 id 逐项丢弃**
 *   （⛔ 不整份作废）——判据 2「旧偏好里含已废弃视图 id 时丢弃那一项」；
 * - 保留偏好里的**相对序**、并**去重**；
 * - ⚠️ **不补齐**缺失项：额外视图是 opt-in，「不在偏好里」＝「没启用」——这是与页签唯一的差别。
 */
export function orderEnabledExtraViews(
  saved: readonly string[],
  all: readonly ProjectExtraView[] = EXTRA_VIEWS,
): ProjectExtraView[] {
  const valid = new Set<ProjectExtraView>(all);
  const seen = new Set<ProjectExtraView>();
  const ordered: ProjectExtraView[] = [];
  for (const id of saved) {
    const view = id as ProjectExtraView;
    if (valid.has(view) && !seen.has(view)) {
      ordered.push(view);
      seen.add(view);
    }
  }
  return ordered;
}

/**
 * 由「已启用的额外视图」推出**完整视图集合** = 固定视图（恒在最前）＋ 干净的额外视图。
 *
 * - `resolveEnabledViews([])` ⇒ `['table','board']`（判据 1 首次仅两视图）；
 * - `resolveEnabledViews(['timeline','calendar'])` ⇒ `['table','board','timeline','calendar']`；
 * - `resolveEnabledViews(['calendar','gantt-legacy'])` ⇒ `['table','board','calendar']`（丢未知项）。
 */
export function resolveEnabledViews(savedExtra: readonly string[]): ProjectView[] {
  return [...FIXED_VIEWS, ...orderEnabledExtraViews(savedExtra)];
}

/**
 * 增删单个额外视图（「＋」面板保存时的纯计算；保留相对序、启用时追加到末尾）。
 * ⛔ **签名里没有 todos**——移除视图只动视图集合，一条需求都碰不到（判据 2「移除面板不删需求」
 * 的结构性证据：这个函数根本拿不到需求数据）。
 */
export function setExtraViewEnabled(
  current: readonly ProjectExtraView[],
  view: ProjectExtraView,
  enabled: boolean,
): ProjectExtraView[] {
  const base = orderEnabledExtraViews(current).filter((id) => id !== view);
  return enabled ? [...base, view] : base;
}

/**
 * 把「持久化的当前视图」对齐到「当前启用集」：在集合里就用它，否则回落表格。
 * 依据原型 `:1756`：移除某个额外视图后，若正停在它上面就 `view='table'`。
 */
export function resolveActiveView(
  active: string | null | undefined,
  enabled: readonly ProjectView[],
): ProjectView {
  if (active != null && (enabled as readonly string[]).includes(active)) {
    return active as ProjectView;
  }
  return enabled.includes(DEFAULT_PROJECT_VIEW)
    ? DEFAULT_PROJECT_VIEW
    : ((enabled[0] as ProjectView | undefined) ?? DEFAULT_PROJECT_VIEW);
}

/**
 * 额外视图偏好的持久化键——⚠️ **同时含账号与项目**（判据 1「偏好按账号项目隔离」）。
 *
 * ⛔ 去掉其中任一段都会串味：去账号 ⇒ 换号看到别人的面板集合；去项目 ⇒ 跨项目串味。
 * 账号缺席（未登录 / 尚未取到 subject）时用 `anon` 占位——它与任何真实账号天然隔离，
 * 且键仍良构、不会与项目段黏连。
 */
const VIEW_PREF_PREFIX = 'stratex.project.views';
const ANON_ACTOR = 'anon';

export function viewPreferenceKey(actor: string | null, projectId: string): string {
  return `${VIEW_PREF_PREFIX}:${actor ?? ANON_ACTOR}:${projectId}`;
}

/** 持久化后端（默认走 `localStorage`；注入用于测「存储抛异常/不可用」这条恢复路径）。 */
export interface ViewPreferenceStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

function resolveStorage(storage?: ViewPreferenceStorage): ViewPreferenceStorage | null {
  if (storage) return storage;
  try {
    // 某些环境访问 localStorage 本身就抛（隐私模式 / 无 DOM）——探测也要包 try。
    return projectStorage() ?? null;
  } catch {
    return null;
  }
}

/**
 * 读回本账号 × 本项目已启用的额外视图。**断网/旧偏好安全恢复**（判据 2）：
 *  - 存储不可用 / `getItem` 抛 ⇒ 回落 `[]`（当作没启用任何额外视图，不崩）；
 *  - 没存过（null）⇒ `[]`；
 *  - 坏 JSON（手改过 / 旧格式）⇒ `[]`（整份回落，等下次写入覆盖）；
 *  - 不是字符串数组 ⇒ `[]`；
 *  - 数组里含未知/废弃视图 id ⇒ 经 `orderEnabledExtraViews` **逐项丢弃**、保留合法项
 *    （⛔ 不因一个脏项把整份偏好作废）。
 */
export function readEnabledExtraViews(
  actor: string | null,
  projectId: string,
  storage?: ViewPreferenceStorage,
): ProjectExtraView[] {
  const store = resolveStorage(storage);
  if (!store) return [];
  let raw: string | null;
  try {
    raw = store.getItem(viewPreferenceKey(actor, projectId));
  } catch {
    return [];
  }
  if (raw === null) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  const ids = parsed.filter((item): item is string => typeof item === 'string');
  return orderEnabledExtraViews(ids);
}

/**
 * 写回本账号 × 本项目已启用的额外视图（写前先 `orderEnabledExtraViews` 归一，脏值不落盘）。
 * 存储不可用只影响下次进入，不改变当前会话的视图集合（与既有偏好写入同一降级口径）。
 */
export function writeEnabledExtraViews(
  actor: string | null,
  projectId: string,
  extra: readonly ProjectExtraView[],
  storage?: ViewPreferenceStorage,
): void {
  const store = resolveStorage(storage);
  if (!store) return;
  try {
    store.setItem(
      viewPreferenceKey(actor, projectId),
      JSON.stringify(orderEnabledExtraViews(extra)),
    );
  } catch {
    // 存不下：本次视图照常工作，下次进入回到默认（两个固定视图）。
  }
}
