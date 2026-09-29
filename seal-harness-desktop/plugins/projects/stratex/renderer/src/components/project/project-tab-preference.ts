import { projectStorage } from '../../../../../src/ui/runtime';
/**
 * 项目详情页签偏好的持久化（UX-10 判据 2）：**顺序**与**已选页签**两份，都按「账号 × 项目」隔离。
 *
 * 语义收口在 `project-tabs.ts`（集合与合并），本模块只管「存在哪、读坏了怎么办」：
 *  - 读回的顺序一律经 `orderTabsWithPreference` 归一 ⇒ 旧存档里已删除的页签（§6 删掉的
 *    `reports`）被丢弃、不渲染；新增页签只补到末尾、⛔ 不重置用户已存的相对序；
 *  - 读回的已选页签一律经 `isProjectTab` 过滤 ⇒ 废弃 id 读成 null，由调用方回落默认落地页。
 *
 * ## 键：同时含账号与项目（判据 2「退出账号隔离」）
 *
 * 对齐合并产物 `tabsKey24()` 的 `${actor}:${activeId}` 两段：去账号 ⇒ 换号读到上一个人的
 * 排序；去项目 ⇒ 跨项目串味。
 *
 * ⚠️ **账号缺席（`actor === null`）不读不写**——与 `project-views.ts` 用 `anon` 占位**刻意不同**。
 *    `anon` 是本机所有账号共用的一格：主体暂不可得的窗口里（协议允许 `enabled:true` 时
 *    `mySubject` 为 null）存下的排序，会原样出现在下一个同样暂无主体的账号上——那正是
 *    「退出账号隔离」要挡的串味。缺席时读回默认、写入报失败，由调用方决定怎么提示。
 *
 * ## 「恢复默认」＝删存档，不是写一份默认序
 *
 * 存档只记**偏离默认**的部分：写入的顺序归一后等于默认序就 `removeItem`。合并产物的
 * `tabs-reset24` 是把默认序显式写回——那样恢复过默认的人会被钉在**当时的**默认序上，
 * 产品日后再调默认序（本轮 §6 就调过一次）他们跟不上；删存档则与从未自定义过的人一致。
 */

import {
  isDefaultTabOrder,
  isProjectTab,
  orderTabsWithPreference,
  PROJECT_TAB_ORDER,
  type ProjectTab,
} from './project-tabs';

const TAB_ORDER_PREFIX = 'stratex.project.tab-order';
const ACTIVE_TAB_PREFIX = 'stratex.project.active-tab';

/** 持久化后端（默认走 `localStorage`；注入用于测「存储抛异常 / 不可用」这条降级路径）。 */
export interface TabPreferenceStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/** 顺序存档键：账号 × 项目。 */
export function tabOrderPreferenceKey(actor: string, projectId: string): string {
  return `${TAB_ORDER_PREFIX}:${actor}:${projectId}`;
}

/** 已选页签存档键：账号 × 项目。 */
export function activeTabPreferenceKey(actor: string, projectId: string): string {
  return `${ACTIVE_TAB_PREFIX}:${actor}:${projectId}`;
}

function resolveStorage(storage?: TabPreferenceStorage): TabPreferenceStorage | null {
  if (storage) return storage;
  try {
    // 某些环境访问 localStorage 本身就抛（隐私模式 / 无 DOM）——探测也要包 try。
    return projectStorage() ?? null;
  } catch {
    return null;
  }
}

/** 账号与项目都在、存储可用才有归属；任一缺席 ⇒ null（不读不写）。 */
function scopedStorage(
  actor: string | null,
  projectId: string,
  storage?: TabPreferenceStorage,
): { store: TabPreferenceStorage; actor: string } | null {
  if (!actor || !projectId) return null;
  const store = resolveStorage(storage);
  return store ? { store, actor } : null;
}

function parseSavedOrder(raw: string | null): readonly string[] | null {
  if (raw === null) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  // 对齐 tabOrder24：必须是「全为字符串的数组」，否则整份回落默认序（手改过 / 旧格式）。
  if (!Array.isArray(parsed)) return null;
  return parsed.every((item): item is string => typeof item === 'string') ? parsed : null;
}

/**
 * 读回本账号 × 本项目的页签顺序，**恒为完整、合法的八项**。
 *  - 账号缺席 / 存储不可用 / `getItem` 抛 / 没存过 / 坏 JSON / 非字符串数组 ⇒ 默认序；
 *  - 含已删除或未知 id ⇒ 逐项丢弃（⛔ 不整份作废）；缺项 ⇒ 按默认序补到末尾。
 */
export function readTabOrder(
  actor: string | null,
  projectId: string,
  storage?: TabPreferenceStorage,
): ProjectTab[] {
  const scoped = scopedStorage(actor, projectId, storage);
  if (!scoped) return [...PROJECT_TAB_ORDER];
  let raw: string | null;
  try {
    raw = scoped.store.getItem(tabOrderPreferenceKey(scoped.actor, projectId));
  } catch {
    return [...PROJECT_TAB_ORDER];
  }
  return orderTabsWithPreference(parseSavedOrder(raw) ?? []);
}

/**
 * 写回本账号 × 本项目的页签顺序（写前归一，脏值不落盘；等于默认序则删存档，见文件头）。
 * 返回是否真的存下了——⚠️ 调用方据此决定「应用新顺序」还是「提示失败、保留原顺序」，
 * 这样屏上的顺序恒等于刷新后会读回的顺序。
 */
export function writeTabOrder(
  actor: string | null,
  projectId: string,
  order: readonly string[],
  storage?: TabPreferenceStorage,
): boolean {
  const scoped = scopedStorage(actor, projectId, storage);
  if (!scoped) return false;
  const normalized = orderTabsWithPreference(order);
  const key = tabOrderPreferenceKey(scoped.actor, projectId);
  try {
    if (isDefaultTabOrder(normalized)) scoped.store.removeItem(key);
    else scoped.store.setItem(key, JSON.stringify(normalized));
    return true;
  } catch {
    return false;
  }
}

/** 读回本账号 × 本项目上次停留的页签；没存过、读失败或是已删除的 id ⇒ null。 */
export function readActiveTab(
  actor: string | null,
  projectId: string,
  storage?: TabPreferenceStorage,
): ProjectTab | null {
  const scoped = scopedStorage(actor, projectId, storage);
  if (!scoped) return null;
  try {
    const raw = scoped.store.getItem(activeTabPreferenceKey(scoped.actor, projectId));
    return isProjectTab(raw) ? raw : null;
  } catch {
    return null;
  }
}

/**
 * 记下本账号 × 本项目当前停留的页签。存不下只影响下次进入（回到默认落地页），
 * 不改变这一次的切换——选页签是导航，⛔ 不因存档失败而拦住或打扰。
 */
export function writeActiveTab(
  actor: string | null,
  projectId: string,
  tab: ProjectTab,
  storage?: TabPreferenceStorage,
): boolean {
  const scoped = scopedStorage(actor, projectId, storage);
  if (!scoped) return false;
  try {
    scoped.store.setItem(activeTabPreferenceKey(scoped.actor, projectId), tab);
    return true;
  } catch {
    return false;
  }
}
