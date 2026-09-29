/**
 * §3.7 Toast 的队列策略 —— 纯函数，不碰 DOM、不起定时器。
 *
 * 为什么把这段抽出来而不是写进 `ToastStack.vue`：
 * D3.36 的三档时长、"最多 3 条 + 超出排队"、悬停/聚焦暂停都是**判定**，
 * 塞进组件后只能靠肉眼看动画来验证。抽成纯函数 + 注入时钟后可以穷举。
 *
 * 全部函数返回新状态，不修改入参（代码规范：不可变）。
 */

export type ToastLevel = 'info' | 'warn' | 'error';

/**
 * D3.36：info 3s、warn 6s、**error 不自动消失**（必须用户关闭）。
 * `null` 表示"永不到期"，不是"立即到期"。
 */
export const TOAST_AUTO_DISMISS_MS: Readonly<Record<ToastLevel, number | null>> = {
  info: 3000,
  warn: 6000,
  error: null,
};

/** D3.36：打断性的才用 alert，其余用 status（不打断读屏当前朗读）。 */
export const TOAST_ROLE: Readonly<Record<ToastLevel, 'status' | 'alert'>> = {
  info: 'status',
  warn: 'status',
  error: 'alert',
};

/** 同时最多可见 3 条，超出排队 —— 再多用户读不过来。 */
export const TOAST_MAX_VISIBLE = 3;

export interface ToastAction {
  /** 文案由上层传入（D3.3：组件层不自造文案） */
  readonly label: string;
  readonly onSelect: () => void;
}

/**
 * D3.35【铁律】：只有这五个字段。
 * 没有 `defaultText`、没有 `fallback`、没有承接原始异常的入口 ——
 * 未映射的错误由上层走兜底码，不是由这里"实在不行就显示原文"。
 */
export interface ToastInput {
  readonly id: string;
  readonly level: ToastLevel;
  readonly text: string;
  readonly code?: string;
  readonly actions?: readonly ToastAction[];
}

export interface VisibleToast extends ToastInput {
  /** 剩余毫秒；`null` = 不自动消失 */
  readonly remainingMs: number | null;
}

export interface ToastQueueState {
  readonly visible: readonly VisibleToast[];
  readonly pending: readonly ToastInput[];
  /** 上次结算时刻，用于把"经过时长"算准 */
  readonly lastTickMs: number;
  /** 非 null 即处于暂停（悬停 / Tab 聚焦） */
  readonly pausedAtMs: number | null;
}

export function createToastQueue(nowMs: number): ToastQueueState {
  return { visible: [], pending: [], lastTickMs: nowMs, pausedAtMs: null };
}

function toVisible(item: ToastInput): VisibleToast {
  return { ...item, remainingMs: TOAST_AUTO_DISMISS_MS[item.level] };
}

/** 可见位有空缺时按队首递补；递补进来的从此刻重新计时。 */
function refill(
  visible: readonly VisibleToast[],
  pending: readonly ToastInput[],
): { visible: readonly VisibleToast[]; pending: readonly ToastInput[] } {
  if (visible.length >= TOAST_MAX_VISIBLE || pending.length === 0) {
    return { visible, pending };
  }
  const slots = TOAST_MAX_VISIBLE - visible.length;
  const promoted = pending.slice(0, slots);
  return {
    visible: [...visible, ...promoted.map(toVisible)],
    pending: pending.slice(promoted.length),
  };
}

/**
 * 把状态推进到 `nowMs`：先扣减剩余时长、移除到期项，再递补排队项。
 * 暂停期间不扣减（但仍更新 `lastTickMs`，避免恢复后一次性补扣）。
 */
export function advanceToasts(state: ToastQueueState, nowMs: number): ToastQueueState {
  const elapsed = state.pausedAtMs === null ? Math.max(0, nowMs - state.lastTickMs) : 0;

  const ticked = state.visible.map((t) =>
    t.remainingMs === null ? t : { ...t, remainingMs: t.remainingMs - elapsed },
  );
  const alive = ticked.filter((t) => t.remainingMs === null || t.remainingMs > 0);
  const filled = refill(alive, state.pending);

  return { ...state, ...filled, lastTickMs: nowMs };
}

export function enqueueToast(
  state: ToastQueueState,
  item: ToastInput,
  nowMs: number,
): ToastQueueState {
  const advanced = advanceToasts(state, nowMs);
  if (advanced.visible.length < TOAST_MAX_VISIBLE) {
    return { ...advanced, visible: [...advanced.visible, toVisible(item)] };
  }
  return { ...advanced, pending: [...advanced.pending, item] };
}

export function dismissToast(state: ToastQueueState, id: string, nowMs: number): ToastQueueState {
  const advanced = advanceToasts(state, nowMs);
  const kept = advanced.visible.filter((t) => t.id !== id);
  if (kept.length === advanced.visible.length) {
    return { ...advanced, pending: advanced.pending.filter((t) => t.id !== id) };
  }
  return { ...advanced, ...refill(kept, advanced.pending) };
}

/** Esc 关闭"当前"一条 —— 取可见列表末尾，也就是最新弹出的那条。 */
export function dismissNewestToast(state: ToastQueueState, nowMs: number): ToastQueueState {
  const advanced = advanceToasts(state, nowMs);
  const newest = advanced.visible[advanced.visible.length - 1];
  if (newest === undefined) return advanced;
  return dismissToast(advanced, newest.id, nowMs);
}

/** 悬停 / Tab 进入时调用。先结算到此刻再冻结，重复调用不额外扣减。 */
export function pauseToasts(state: ToastQueueState, nowMs: number): ToastQueueState {
  if (state.pausedAtMs !== null) return state;
  const advanced = advanceToasts(state, nowMs);
  return { ...advanced, pausedAtMs: nowMs };
}

export function resumeToasts(state: ToastQueueState, nowMs: number): ToastQueueState {
  if (state.pausedAtMs === null) return state;
  return { ...state, lastTickMs: nowMs, pausedAtMs: null };
}

/**
 * 下一次到期还需多少毫秒；`null` = 无需定时器。
 * 暂停中、或可见项全是 error 时都返回 `null`，让调用方直接不挂 timer。
 */
export function nextExpiryMs(state: ToastQueueState): number | null {
  if (state.pausedAtMs !== null) return null;
  const remaining = state.visible
    .map((t) => t.remainingMs)
    .filter((ms): ms is number => ms !== null);
  return remaining.length === 0 ? null : Math.min(...remaining);
}
