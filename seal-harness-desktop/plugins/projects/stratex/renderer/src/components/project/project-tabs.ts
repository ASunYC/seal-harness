/**
 * 项目详情页签的集合、默认顺序、默认落地页与偏好合并（UX-01 判据 2 / UX-10）。
 *
 * ## 权威来源（⚠️ 权威不在源原型）
 *
 * 集合与顺序的**唯一收口**是负责人 2026-09-13 的口述裁决，记录在
 * `.trellis/tasks/09-10-project-iteration-core/decisions/D-PROTO-01.md` **§6**：
 *
 *     动态 → 里程碑 → 需求池 → 任务 → 测试 → 讨论 → 会话 → 资产（共八个，「工作报告」已删）
 *
 * ⛔ **不要引源原型 `docs/prototypes/project-collaboration-v1/index.html` 的 `defaultTabs24`
 *    论证顺序**：源原型由负责人手绘、本次未改，里面仍是旧顺序且含 `reports`，引它会引到
 *    过时出处。已按新口径改过的参照实现是合并产物 `docs/星图工作台高保真交互原型-v1.html`
 *    （其 `defaultTabs24` 用产品原型自己的 id：iterations＝里程碑、mine＝任务、
 *    verification＝测试，其余同名）。todos.json 里抄着旧九项的判据同样是过时副本，
 *    ⛔ 冲突时以 §6 为准。
 *
 *  - 偏好合并语义 = 合并产物的 `tabOrder24()`（见 `orderTabsWithPreference`）；
 *  - 默认落地页 = 需求池（§6「默认落地页」：与原型对齐，本轮不改；见 `DEFAULT_PROJECT_TAB`）。
 *
 * ⚠️ 合并产物由并发会话在改，行号会漂——引它按**函数名**找，别抄行号。
 *
 * ## 业务 ID 冻结
 *
 * UX-10 的拖拽重排只动展示顺序，⛔ 绝不改这些 id——它们进取数分支（`loadTab` 的
 * `TODO_TABS`、`ProjectBoardPane` 的 `scope`）和按账号×项目的偏好存档
 * （`project-tab-preference.ts`）。`reports`（工作报告）按 §6 **整个删除**，不是隐藏：
 * 旧存档里的 `reports` 由 `orderTabsWithPreference` 丢弃，⛔ 不补回、不渲染。
 */

export type ProjectTab =
  'feed' | 'milestones' | 'requirements' | 'tasks' | 'tests' | 'chat' | 'sessions' | 'assets';

export interface ProjectTabDef {
  readonly id: ProjectTab;
  readonly label: string;
  /** AppIcon 既有映射名（见 `components/ui/AppIcon.vue` 的 icons 表）。⛔ 不新增图标库。 */
  readonly icon: string;
}

/**
 * 新用户默认页签顺序。逐项逐序照 D-PROTO-01 §6 的口述裁决——
 * ⛔ 改这里等于改产品口径，须先改那份决定档（源原型与 todos.json 都是旧口径副本）。
 * 图标沿用各业务 id 既有的 AppIcon 映射，本轮只动集合与顺序。
 */
export const PROJECT_TABS: readonly ProjectTabDef[] = [
  { id: 'feed', label: '日志', icon: 'feed' },
  { id: 'milestones', label: '迭代', icon: 'pin' },
  { id: 'requirements', label: '需求', icon: 'board' },
  { id: 'tasks', label: '任务', icon: 'check' },
  { id: 'tests', label: '测试', icon: 'shield' },
  { id: 'chat', label: '交流', icon: 'message' },
  { id: 'sessions', label: '会话', icon: 'session' },
  { id: 'assets', label: '文件', icon: 'box' },
];

/** 默认顺序的 id 序列（新用户即用此序）。等于 D-PROTO-01 §6 的八项。 */
export const PROJECT_TAB_ORDER: readonly ProjectTab[] = PROJECT_TABS.map((tab) => tab.id);

/**
 * 新用户（无任何偏好）的默认落地页 = 需求池。
 * 依据：D-PROTO-01 §6「默认落地页」——负责人定「和原型对齐」，合并产物实测落在需求池，
 * 与客户端现状一致，本轮不改。⚠️ 它不再是首格（首格是「动态」）：落地页与默认序是两件事。
 */
export const DEFAULT_PROJECT_TAB: ProjectTab = 'requirements';

/** `value` 是不是现行集合里的页签 id（读回存档裸串时用它把废弃 id 挡在门外）。 */
export function isProjectTab(value: unknown): value is ProjectTab {
  return typeof value === 'string' && (PROJECT_TAB_ORDER as readonly string[]).includes(value);
}

/**
 * 解析初始激活页签：给得出合法偏好就**用偏好**（⛔ 默认不覆盖它），否则回落默认落地页。
 *
 * UX-10「刷新保持已选 tab」的入口：视图进入项目时把按账号×项目存下的已选页签传进来
 * （`readActiveTab`）。存档里是已删除的 `reports` 或任何未知 id ⇒ 回落需求池，⛔ 不认脏值。
 */
export function resolveInitialTab(preferred?: string | null): ProjectTab {
  return isProjectTab(preferred) ? preferred : DEFAULT_PROJECT_TAB;
}

/**
 * 「已有偏好保留 / 新增页签只补入缺项」的纯函数（UX-10 判据 2）——
 * **逐条对齐合并产物的 `tabOrder24()`**：
 *
 * ```
 * [...new Set([...saved.filter(id => defaultTabs24.includes(id)), ...defaultTabs24])]
 * ```
 *
 * - `saved.filter(id => defaults.includes(id))`：偏好里**已不存在的页签 id 直接丢掉**
 *   （老偏好不把废弃页签带回来，典型即 §6 删掉的 `reports`）——这里由 `valid.has` 落实。
 * - `new Set([...saved, ...defaults])`：**保留偏好的相对序，缺的按默认序补到尾部**
 *   ⇒ 新增页签一律出现在**末尾、不插队**，⛔ 不因补项而把用户排序重置成默认——
 *   这里由两趟循环 + `seen` 落实。
 * - 解析失败 / 无偏好 ⇒ 整份回落默认序（原型的 `catch` 与末尾 `return`）——调用方传 `[]`。
 *
 * 本函数只做纯粹的合并；存档键（按账号×项目）与读写降级在 `project-tab-preference.ts`，
 * 拖动 / Alt 方向键 / 恢复默认在 `useProjectTabPreferences.ts`。
 */
export function orderTabsWithPreference(
  saved: readonly string[],
  all: readonly ProjectTab[] = PROJECT_TAB_ORDER,
): ProjectTab[] {
  const valid = new Set<ProjectTab>(all);
  const seen = new Set<ProjectTab>();
  const ordered: ProjectTab[] = [];
  for (const id of saved) {
    const tab = id as ProjectTab;
    if (valid.has(tab) && !seen.has(tab)) {
      ordered.push(tab);
      seen.add(tab);
    }
  }
  for (const id of all) {
    if (!seen.has(id)) {
      ordered.push(id);
      seen.add(id);
    }
  }
  return ordered;
}

/** 两份页签顺序逐位相同（用于「没动就不写存档」与「是否已是默认序」）。 */
export function isSameTabOrder(a: readonly ProjectTab[], b: readonly ProjectTab[]): boolean {
  return a.length === b.length && a.every((id, index) => id === b[index]);
}

/** 当前顺序是否就是默认序（「恢复默认顺序」据此禁用）。 */
export function isDefaultTabOrder(order: readonly ProjectTab[]): boolean {
  return isSameTabOrder(order, PROJECT_TAB_ORDER);
}

/**
 * Alt + ←/→（以及顺序弹层的上移/下移）：与相邻页签**交换一位**，返回新数组。
 * 对齐合并产物 `moveTab24`：越界（首格再左移 / 末格再右移）或 id 不在序列里 ⇒ 原样返回副本。
 * ⛔ 只动顺序，不碰业务 id。
 */
export function moveTabByOffset(
  order: readonly ProjectTab[],
  id: ProjectTab,
  delta: -1 | 1,
): ProjectTab[] {
  const next = [...order];
  const from = next.indexOf(id);
  const to = from + delta;
  if (from < 0 || to < 0 || to >= next.length) return next;
  const displaced = next[to] as ProjectTab;
  next[to] = id;
  next[from] = displaced;
  return next;
}

/**
 * 拖放：把 `source` 放到 `target` **原来的位置**上（arrayMove 语义），返回新数组。
 *
 * ⚠️ 与合并产物刻意不同：它是「先删源、再插到目标之前」——向右拖到**相邻**页签上时
 *    源又落回原位，是空操作。这里按目标原位落点，左右两个方向对称（向右拖越过目标、
 *    向左拖停在目标之前），与浏览器标签页的拖动手感一致。
 * 源与目标相同、或任一不在序列里 ⇒ 原样返回副本。
 */
export function moveTabOnto(
  order: readonly ProjectTab[],
  source: ProjectTab,
  target: ProjectTab,
): ProjectTab[] {
  const from = order.indexOf(source);
  const to = order.indexOf(target);
  if (from < 0 || to < 0 || from === to) return [...order];
  const next = order.filter((id) => id !== source);
  next.splice(to, 0, source);
  return next;
}
