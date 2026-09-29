import { computed, nextTick, ref, watch } from 'vue';
import type { ComputedRef, Ref } from 'vue';

import { isTodoRequirement } from '@shared/protocol/project-collab.js';
import type { Todo } from '@shared/protocol/project-collab.js';

import { findTodoById } from './todo-hierarchy';

/**
 * 单屏需求详情的**页签内开合**（UX-02）：点需求进详情、返回回到原列表。
 *
 * 详情不是弹层，是同一个页签里把列表换成详情：列表**不卸载**（外层只加一个类把它藏起来），
 * 所以筛选、搜索、展开态、勾选都原样留着；表格 / 看板 / 日历 / 时间轴各自滚动容器的位置也由
 * 浏览器保住（Chromium 实测：藏起来时读作 0，重新显示后回到原值——e2e 布局用例第⑤步钉着）。
 * 本组合式函数只管列表组件自己管不了的三件事：
 *
 *  1. **外层滚动**——详情从顶上看起：打开时把根节点**祖先**里滚过的容器（页签内容区）记下并
 *     归零，返回时写回。后代不碰（那是列表自己的容器，见上）；
 *  2. **焦点**——返回后焦点回到原来那一行：优先还给点进来的那个控件，它不在了就找同一
 *     条需求行上的「查看详情」按钮；
 *  3. **作废**——切项目 / 原地换号（`resetKeys` 变了）直接关掉详情、清掉来源，⛔ 不还焦也
 *     不还滚动（屏上已是另一份清单）。详情所指的需求从清单里消失（被删 / 不再可见）时同样
 *     关掉，按正常返回处理。
 *
 * ⚠️ 为什么作废要单独 watch 身份，而不是只靠「清单里找不到它就关」：原地换号时 store 先清空
 *    再按新账号重取——新账号若恰好也看得见同一条需求，只靠后者详情会原样出现在新账号的屏上。
 */

/** 列表里「查看需求详情」按钮的标记：表格标题格与看板卡标题共用，返回时按它找回焦点。 */
export const REQUIREMENT_OPEN_DETAIL_ATTR = 'data-todo-open-detail';

interface ScrollMark {
  readonly element: Element;
  readonly top: number;
  readonly left: number;
}

export interface RequirementDetailViewOptions {
  /** 列表与详情共同的根节点（看板/表格/日历/时间轴都在它下面）。 */
  readonly root: Readonly<Ref<HTMLElement | null>>;
  /** 权威清单（store.todos）；详情只按 id 从这里取，不另存快照。 */
  readonly todos: () => readonly Todo[];
  /**
   * 这些值一变就作废详情：项目 id、当前身份主体。逐个给取值函数（多源 watch 逐个比原始值），
   * ⛔ 别合成一个返回数组的函数——每次都是新数组，任何一次重算都会被当成「变了」。
   */
  readonly resetKeys: readonly (() => unknown)[];
}

export interface RequirementDetailView {
  readonly detailTodo: ComputedRef<Todo | null>;
  /** 打开（或在详情里切到另一条需求）。非需求一律忽略——任务没有这张单屏详情。 */
  open(todo: Todo, trigger?: EventTarget | null): void;
  /** 返回列表：还滚动、还焦点。 */
  close(): void;
}

function isInside(root: HTMLElement | null, target: EventTarget | null | undefined): boolean {
  return root !== null && target instanceof HTMLElement && root.contains(target);
}

/**
 * 返回时要还给的控件：只认**这一条需求自己那一行 / 卡 / 条目**里的控件。
 *
 * ⚠️ 不能直接拿 `document.activeElement`：点击未必把焦点移到被点的按钮上（部分平台点按钮不
 *    聚焦；点行空白处更不聚焦），此时焦点还停在别处——比如刚输入过的搜索框——还焦就会回到
 *    那里，而不是「原来那一行」。不在这一行里的一律不认，关闭时再按 id 找回这一行的按钮。
 */
function resolveOrigin(
  root: HTMLElement | null,
  todoId: string,
  trigger: EventTarget | null | undefined,
): HTMLElement | null {
  const tree = root?.getRootNode();
  for (const candidate of [trigger, tree instanceof ShadowRoot ? tree.activeElement : null]) {
    if (!isInside(root, candidate)) continue;
    const row = (candidate as HTMLElement).closest<HTMLElement>('[data-todo-id]');
    if (row?.dataset['todoId'] === todoId) return candidate as HTMLElement;
  }
  return null;
}

/** 根节点**祖先**里滚过的容器（不含根自身与后代：那是列表自己的滚动容器，浏览器会保住）。 */
function captureAncestorScroll(root: HTMLElement | null): ScrollMark[] {
  const marks: ScrollMark[] = [];
  for (let node = root?.parentElement ?? null; node !== null; node = node.parentElement) {
    if (node.scrollTop !== 0 || node.scrollLeft !== 0) {
      marks.push({ element: node, top: node.scrollTop, left: node.scrollLeft });
    }
  }
  return marks;
}

function restoreScroll(marks: readonly ScrollMark[]): void {
  for (const { element, top, left } of marks) {
    if (!element.isConnected) continue;
    element.scrollTop = top;
    element.scrollLeft = left;
  }
}

/** 找回同一条需求在列表里的焦点落点：「查看详情」按钮 → 自身可聚焦的条目（日历格 / 时间条）。 */
function findRowFocusTarget(root: HTMLElement | null, todoId: string): HTMLElement | null {
  if (root === null) return null;
  const rows = [...root.querySelectorAll<HTMLElement>('[data-todo-id]')].filter(
    (element) => element.dataset['todoId'] === todoId,
  );
  for (const row of rows) {
    const button = row.matches(`[${REQUIREMENT_OPEN_DETAIL_ATTR}]`)
      ? row
      : row.querySelector<HTMLElement>(`[${REQUIREMENT_OPEN_DETAIL_ATTR}]`);
    if (button !== null) return button;
  }
  return rows.find((row) => row.tabIndex >= 0) ?? null;
}

export function useRequirementDetailView(
  options: RequirementDetailViewOptions,
): RequirementDetailView {
  const detailId = ref<string | null>(null);
  const detailTodo = computed(() => findTodoById(options.todos(), detailId.value));

  let originTodoId: string | null = null;
  let originElement: HTMLElement | null = null;
  let scrollMarks: ScrollMark[] = [];

  function forgetOrigin(): void {
    originTodoId = null;
    originElement = null;
    scrollMarks = [];
  }

  function open(todo: Todo, trigger?: EventTarget | null): void {
    if (!isTodoRequirement(todo)) return;
    // 在详情里点子需求＝换一条看：来源仍是最初那一行，返回回到它。
    if (detailId.value === null) {
      const root = options.root.value;
      originTodoId = todo.id;
      originElement = resolveOrigin(root, todo.id, trigger);
      scrollMarks = captureAncestorScroll(root);
    }
    detailId.value = todo.id;
    // 详情从顶上看起（含在详情里换一条）：祖先滚动归零；原位置已记在 scrollMarks，返回时写回。
    const root = options.root.value;
    void nextTick(() => {
      for (let node = root?.parentElement ?? null; node !== null; node = node.parentElement) {
        if (node.scrollTop !== 0) node.scrollTop = 0;
      }
    });
  }

  function close(): void {
    if (detailId.value === null) return;
    detailId.value = null;
    const marks = scrollMarks;
    const todoId = originTodoId;
    const element = originElement;
    forgetOrigin();
    void nextTick(() => {
      restoreScroll(marks);
      const root = options.root.value;
      const target =
        element !== null && element.isConnected
          ? element
          : todoId === null
            ? null
            : findRowFocusTarget(root, todoId);
      target?.focus({ preventScroll: true });
    });
  }

  watch([...options.resetKeys], () => {
    detailId.value = null;
    forgetOrigin();
  });

  // 所指的需求不在清单里了（被删、不再可见）：按返回处理，别留一张指向虚空的详情。
  watch(detailTodo, (todo) => {
    if (todo === null && detailId.value !== null) close();
  });

  return { detailTodo, open, close };
}
