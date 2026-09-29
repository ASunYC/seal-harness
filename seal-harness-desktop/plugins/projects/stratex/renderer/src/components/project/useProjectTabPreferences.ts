import { computed, ref, watch } from 'vue';
import type { ComputedRef, Ref } from 'vue';

import {
  isDefaultTabOrder,
  isSameTabOrder,
  moveTabByOffset,
  moveTabOnto,
  PROJECT_TAB_ORDER,
  PROJECT_TABS,
  resolveInitialTab,
} from './project-tabs';
import type { ProjectTab, ProjectTabDef } from './project-tabs';
import {
  readActiveTab,
  readTabOrder,
  writeActiveTab,
  writeTabOrder,
} from './project-tab-preference';
import type { TabPreferenceStorage } from './project-tab-preference';

/**
 * 项目详情页签的**个人布局**（UX-10）：拖动 / Alt+←→ / 顺序弹层重排、恢复默认，
 * 以及「刷新保持已选页签」——全部按「账号 × 项目」隔离（存档规则见 `project-tab-preference.ts`）。
 *
 * ⭐ 不变式：**屏上的顺序恒等于刷新后会读回的顺序**。任何重排都是「先存、存下了才应用」
 *    （对齐合并产物 `saveTabOrder24` 成功才 `arrangeTabs24`）；存不下 ⇒ 原顺序不动并提示。
 *    ⛔ 别改成「先改屏上、再尽力存」——那样刷新一下排序就悄悄回去了。
 *
 * ⭐ 换号 / 换项目即重读顺序。MainWindow 登出/登入**不卸载**项目页，而是就地重置 store、
 *    `mySubject` 走 A → null → B：不重读的话，B 屏上挂着 A 的排序，B 一拖就把 A 的布局存进
 *    B 自己的存档。已选页签归视图持有，视图在进入项目**与换号**两个时刻都调 `initialTab`
 *    按当前账号重解析（与顺序对称）；选页签的写入恒落当前账号的键。
 */

export interface ProjectTabPreferencesOptions {
  /** 当前账号主体（`store.mySubject`）。 */
  readonly actor: () => string | null;
  readonly projectId: () => string;
  /** 顺序没存下时的提示出口（原顺序已保留）。 */
  readonly onOrderSaveFailed?: () => void;
  /** 键盘 / 拖放重排成功后把焦点还给被移动的页签（DOM 节点搬家会丢焦点）。 */
  readonly focusTab?: (id: ProjectTab) => void;
  readonly storage?: TabPreferenceStorage;
}

/** 拖放事件里用得到的那几样（真实 `DragEvent` 满足；测试可给最小替身）。 */
export interface TabDragEventLike {
  preventDefault(): void;
  readonly dataTransfer?: Pick<DataTransfer, 'effectAllowed' | 'dropEffect' | 'setData'> | null;
}

export interface ProjectTabPreferences {
  readonly tabs: ComputedRef<ProjectTabDef[]>;
  readonly isDefaultOrder: ComputedRef<boolean>;
  readonly dragSourceId: ComputedRef<ProjectTab | null>;
  readonly dropTargetId: Readonly<Ref<ProjectTab | null>>;
  initialTab(projectId: string): ProjectTab;
  rememberActiveTab(tab: ProjectTab): void;
  moveTab(id: ProjectTab, delta: -1 | 1): boolean;
  resetTabOrder(): boolean;
  onTabKeydown(id: ProjectTab, event: KeyboardEvent): void;
  onTabDragStart(id: ProjectTab, event: TabDragEventLike): void;
  onTabDragOver(id: ProjectTab, event: TabDragEventLike): void;
  onTabDragLeave(id: ProjectTab): void;
  onTabDrop(id: ProjectTab, event: TabDragEventLike): void;
  onTabDragEnd(): void;
}

const TAB_BY_ID = Object.fromEntries(PROJECT_TABS.map((tab) => [tab.id, tab])) as Record<
  ProjectTab,
  ProjectTabDef
>;

interface DragSource {
  readonly id: ProjectTab;
  readonly actor: string | null;
  readonly projectId: string;
}

/** 应用一份新顺序（先存、存下了才应用）；第二参是成功后要还焦点的页签。 */
type CommitOrder = (next: ProjectTab[], focusId?: ProjectTab) => boolean;

type TabDrag = Pick<
  ProjectTabPreferences,
  | 'dragSourceId'
  | 'dropTargetId'
  | 'onTabDragStart'
  | 'onTabDragOver'
  | 'onTabDragLeave'
  | 'onTabDrop'
> & { endDrag(): void };

/** 拖放重排：只认同一账号 × 同一项目里起的拖动（对齐合并产物 `draggingTab24.scope` 校验）。 */
function useTabDrag(
  options: ProjectTabPreferencesOptions,
  order: Readonly<Ref<ProjectTab[]>>,
  commitOrder: CommitOrder,
): TabDrag {
  const dragSource = ref<DragSource | null>(null);
  const dropTargetId = ref<ProjectTab | null>(null);

  function endDrag(): void {
    dragSource.value = null;
    dropTargetId.value = null;
  }

  function acceptsDrop(): DragSource | null {
    const source = dragSource.value;
    if (!source) return null;
    return source.actor === options.actor() && source.projectId === options.projectId()
      ? source
      : null;
  }

  return {
    dragSourceId: computed(() => dragSource.value?.id ?? null),
    dropTargetId,
    endDrag,
    onTabDragStart: (id, event) => {
      dragSource.value = { id, actor: options.actor(), projectId: options.projectId() };
      const transfer = event.dataTransfer;
      if (!transfer) return;
      transfer.effectAllowed = 'move';
      transfer.setData('text/plain', id);
    },
    onTabDragOver: (id, event) => {
      // 不认的拖动不 preventDefault ⇒ 浏览器不许在这里放下。
      if (!acceptsDrop()) return;
      event.preventDefault();
      if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
      dropTargetId.value = id;
    },
    onTabDragLeave: (id) => {
      if (dropTargetId.value === id) dropTargetId.value = null;
    },
    onTabDrop: (id, event) => {
      event.preventDefault();
      const source = acceptsDrop();
      endDrag();
      if (source) commitOrder(moveTabOnto(order.value, source.id, id), source.id);
    },
  };
}

export function useProjectTabPreferences(
  options: ProjectTabPreferencesOptions,
): ProjectTabPreferences {
  const order = ref<ProjectTab[]>(
    readTabOrder(options.actor(), options.projectId(), options.storage),
  );

  /** 先存、存下了才应用（见文件头不变式）。没动就不写——免得把「跟随默认」的人钉成显式序。 */
  function commitOrder(next: ProjectTab[], focusId?: ProjectTab): boolean {
    if (isSameTabOrder(next, order.value)) return false;
    if (!writeTabOrder(options.actor(), options.projectId(), next, options.storage)) {
      options.onOrderSaveFailed?.();
      return false;
    }
    order.value = next;
    if (focusId) options.focusTab?.(focusId);
    return true;
  }

  const drag = useTabDrag(options, order, commitOrder);

  watch([options.actor, options.projectId], ([actor, projectId]) => {
    drag.endDrag();
    order.value = readTabOrder(actor, projectId, options.storage);
  });

  function onTabKeydown(id: ProjectTab, event: KeyboardEvent): void {
    if (!event.altKey || (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight')) return;
    event.preventDefault();
    commitOrder(moveTabByOffset(order.value, id, event.key === 'ArrowLeft' ? -1 : 1), id);
  }

  return {
    tabs: computed(() => order.value.map((id) => TAB_BY_ID[id])),
    isDefaultOrder: computed(() => isDefaultTabOrder(order.value)),
    dragSourceId: drag.dragSourceId,
    dropTargetId: drag.dropTargetId,
    initialTab: (projectId) =>
      resolveInitialTab(readActiveTab(options.actor(), projectId, options.storage)),
    rememberActiveTab: (tab) => {
      writeActiveTab(options.actor(), options.projectId(), tab, options.storage);
    },
    moveTab: (id, delta) => commitOrder(moveTabByOffset(order.value, id, delta)),
    resetTabOrder: () => commitOrder([...PROJECT_TAB_ORDER]),
    onTabKeydown,
    onTabDragStart: drag.onTabDragStart,
    onTabDragOver: drag.onTabDragOver,
    onTabDragLeave: drag.onTabDragLeave,
    onTabDrop: drag.onTabDrop,
    onTabDragEnd: drag.endDrag,
  };
}
