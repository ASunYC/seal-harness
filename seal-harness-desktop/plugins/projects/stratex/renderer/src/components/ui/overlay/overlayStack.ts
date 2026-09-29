/**
 * Overlay 叠层栈 —— 纯判定，不碰 DOM 布局。
 *
 * 为什么要有这一层：现状 51 个弹层各自管各自的 Esc，嵌套框靠
 * `|| permissionConfirmOpen.value` 这种布尔量把外层的焦点陷阱临时关掉；
 * 背景 inert 也是各写各的布尔开关，于是「关内层顺手把外层的 inert 摘了」
 * 是必然发生的事。**引用计数是这里唯一正确的记账方式**，而计数天然等于
 * 栈里要求背景不可达的层数——所以栈本身就是计数器，不需要另设一个变量。
 *
 * 分工照抄 `toastQueue.ts`：判定是不修改入参的纯函数（可穷举），
 * 有状态的那点东西收在一个薄控制器里（负责派发关闭回调与装卸键盘监听）。
 */

export type OverlayCloseReason = 'esc' | 'outside' | 'action' | 'programmatic' | 'stack';

export interface OverlayStackEntry {
  /** 层的稳定标识；同 id 重复压栈视为「重新打开」而不是压出第二份 */
  readonly id: string;
  /** 进行中：关闭入口全部失效。busy 的层**吃掉** Esc 但不向下透传 */
  readonly busy: boolean;
  /** 该层是否响应 Esc */
  readonly dismissOnEsc: boolean;
  /** 该层是否要求背景不可达（modal 与带 scrim 的 drawer） */
  readonly blocksBackground: boolean;
}

/** 栈底在前、栈顶在后。 */
export type OverlayStackState = readonly OverlayStackEntry[];

export const EMPTY_OVERLAY_STACK: OverlayStackState = [];

export function pushOverlay(state: OverlayStackState, entry: OverlayStackEntry): OverlayStackState {
  return [...state.filter((item) => item.id !== entry.id), entry];
}

export function popOverlay(state: OverlayStackState, id: string): OverlayStackState {
  const next = state.filter((item) => item.id !== id);
  return next.length === state.length ? state : next;
}

export function updateOverlay(
  state: OverlayStackState,
  id: string,
  patch: Partial<Omit<OverlayStackEntry, 'id'>>,
): OverlayStackState {
  if (!state.some((item) => item.id === id)) return state;
  return state.map((item) => (item.id === id ? { ...item, ...patch } : item));
}

export function topOverlay(state: OverlayStackState): OverlayStackEntry | null {
  return state.at(-1) ?? null;
}

export function isTopOverlay(state: OverlayStackState, id: string): boolean {
  return topOverlay(state)?.id === id;
}

/** 背景 inert 的引用计数：要求背景不可达的层数。归零才摘 inert。 */
export function backgroundInertCount(state: OverlayStackState): number {
  return state.filter((item) => item.blocksBackground).length;
}

export function isBackgroundInert(state: OverlayStackState): boolean {
  return backgroundInertCount(state) > 0;
}

/**
 * 某一层是否被压在别人下面而应当整层 inert。
 *
 * 判据是「**它上面**有挡背景的层」，不是「它不在栈顶」——后者会把
 * 「模态上面弹了个不挡背景的菜单」误判成模态该失效。这条正是用来替掉
 * `McpToolWorkbench.vue:242` 的 `|| permissionConfirmOpen.value`
 * 与 `McpRuntimePanel.vue:173` 的 `|| confirmAction.value` 那两个嵌套 hack 的。
 */
export function isOverlaySuppressed(state: OverlayStackState, id: string): boolean {
  const index = state.findIndex((item) => item.id === id);
  if (index === -1) return false;
  return state.slice(index + 1).some((item) => item.blocksBackground);
}

export type OverlayEscapeOutcome =
  /** 栈空：Esc 不归弹层管，调用方（如 ToastStack）可以自行响应 */
  | { readonly kind: 'idle' }
  /** 栈顶吃掉了这次 Esc（busy 或显式关掉），**不向下透传**，防止误关外层 */
  | { readonly kind: 'absorbed'; readonly id: string }
  | { readonly kind: 'close'; readonly id: string };

export function resolveEscape(state: OverlayStackState): OverlayEscapeOutcome {
  const top = topOverlay(state);
  if (top === null) return { kind: 'idle' };
  if (top.busy || !top.dismissOnEsc) return { kind: 'absorbed', id: top.id };
  return { kind: 'close', id: top.id };
}

export interface OverlayStackOptions {
  /**
   * Esc 监听的挂载点。传 `null` 表示不挂（纯逻辑测试用）；
   * 缺省取 `window`（无 window 的环境自动为 null）。
   */
  readonly keyboardTarget?: EventTarget | null;
}

export interface OverlayStackController {
  readonly state: OverlayStackState;
  push(entry: OverlayStackEntry, close: (reason: OverlayCloseReason) => void): void;
  update(id: string, patch: Partial<Omit<OverlayStackEntry, 'id'>>): void;
  remove(id: string): void;
  top(): OverlayStackEntry | null;
  isTop(id: string): boolean;
  isEmpty(): boolean;
  isBackgroundInert(): boolean;
  isSuppressed(id: string): boolean;
  /** 处置一次 Esc；返回 `idle` 表示栈空、这次 Esc 不归弹层管 */
  handleEscape(): OverlayEscapeOutcome;
  subscribe(listener: (state: OverlayStackState) => void): () => void;
}

function defaultKeyboardTarget(): EventTarget | null {
  return typeof window === 'undefined' ? null : window;
}

export function createOverlayStack(options: OverlayStackOptions = {}): OverlayStackController {
  const target =
    options.keyboardTarget === undefined ? defaultKeyboardTarget() : options.keyboardTarget;

  let state: OverlayStackState = EMPTY_OVERLAY_STACK;
  const closers = new Map<string, (reason: OverlayCloseReason) => void>();
  const listeners = new Set<(state: OverlayStackState) => void>();
  let attached = false;

  // 捕获阶段：叠层顺序由栈决定，不能被某个组件自己的 keydown 抢先关掉。
  const onKeydown = (event: Event): void => {
    if ((event as KeyboardEvent).key !== 'Escape') return;
    const outcome = handleEscape();
    if (outcome.kind === 'idle') return;
    event.preventDefault();
    event.stopPropagation();
  };

  function syncListener(): void {
    if (target === null) return;
    const wanted = state.length > 0;
    if (wanted === attached) return;
    if (wanted) target.addEventListener('keydown', onKeydown, true);
    else target.removeEventListener('keydown', onKeydown, true);
    attached = wanted;
  }

  function commit(next: OverlayStackState): void {
    if (next === state) return;
    state = next;
    syncListener();
    for (const listener of listeners) listener(state);
  }

  function handleEscape(): OverlayEscapeOutcome {
    const outcome = resolveEscape(state);
    if (outcome.kind === 'close') closers.get(outcome.id)?.('esc');
    return outcome;
  }

  return {
    get state() {
      return state;
    },
    push(entry, close) {
      closers.set(entry.id, close);
      commit(pushOverlay(state, entry));
    },
    update(id, patch) {
      commit(updateOverlay(state, id, patch));
    },
    remove(id) {
      closers.delete(id);
      commit(popOverlay(state, id));
    },
    top: () => topOverlay(state),
    isTop: (id) => isTopOverlay(state, id),
    isEmpty: () => state.length === 0,
    isBackgroundInert: () => isBackgroundInert(state),
    isSuppressed: (id) => isOverlaySuppressed(state, id),
    handleEscape,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

/** 全应用共用的一份栈。三个窗口各自一个 renderer 进程，天然互不干扰。 */
export const overlayStack: OverlayStackController = createOverlayStack();
