/**
 * Overlay 的焦点判定 —— 集合、循环、初始焦点、还焦目标。
 *
 * 全仓现有 18 份手抄焦点陷阱，可聚焦集合各写各的（`ConfirmDialog` 只收
 * `button:not(:disabled)`，`McpCredentialDialog` 收一大串还带容器参数），
 * 还焦更是 7 处做、11 处不做。这里收成一份，判定与 DOM 读取分开：
 * 集合与还焦要摸 DOM，**循环与落点是纯计算**，可以穷举。
 *
 * 还焦时序沿用 `ConfirmDialog.vue:52-54` 已验证的 `queueMicrotask`：
 * 此刻触发按钮尚在 DOM 里，直接 `focus()` 会被随后的卸载覆盖。
 */

/** `'first'`（首个可聚焦项）/ `'none'`（不移焦）/ 其余按 CSS 选择器解析。 */
export type OverlayInitialFocus = string;

/** 可聚焦集合的唯一口径（design.md 统一内建能力清单第 2 条）。 */
export const OVERLAY_FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not(:disabled)',
  'input:not(:disabled)',
  'select:not(:disabled)',
  'textarea:not(:disabled)',
  '[tabindex]:not([tabindex="-1"])',
].join(', ');

/**
 * 元素当前是否真的可聚焦。
 *
 * ⚠️ `offsetParent` 用严格 `=== null` 判不可见，不能用 falsy：
 * 真实浏览器里 `display:none` 的子树返回 `null`，而 happy-dom **根本不实现
 * 这个属性**（返回 `undefined`）。undefined 的含义是「环境没提供这条信息」，
 * 当成「不可见」会把测试环境里的整棵树判空。
 */
export function isOverlayFocusable(element: HTMLElement): boolean {
  if (element.hasAttribute('disabled')) return false;
  if (element.hasAttribute('hidden')) return false;
  if (element.getAttribute('aria-hidden') === 'true') return false;
  if (element.closest('[inert]') !== null) return false;
  return element.offsetParent !== null;
}

export function collectFocusable(container: ParentNode): HTMLElement[] {
  return [...container.querySelectorAll<HTMLElement>(OVERLAY_FOCUSABLE_SELECTOR)].filter(
    isOverlayFocusable,
  );
}

/**
 * Tab / Shift+Tab 的落点；返回 `null` 表示不拦截、交给浏览器默认行为。
 * 焦点跑到层外（比如被别的脚本移走）时把它收回层内首/末项。
 */
export function resolveTabTarget(
  focusable: readonly HTMLElement[],
  active: Element | null,
  shiftKey: boolean,
): HTMLElement | null {
  const first = focusable[0];
  const last = focusable.at(-1);
  if (first === undefined || last === undefined) return null;

  const index = active === null ? -1 : focusable.indexOf(active as HTMLElement);
  if (index === -1) return shiftKey ? last : first;
  if (shiftKey) return index === 0 ? last : null;
  return index === focusable.length - 1 ? first : null;
}

/**
 * 打开时的初始焦点。选择器串是给破坏性确认用的——D3.50 要求焦点落「取消」。
 * 选择器命中不到时退回第一个可聚焦项，而不是不移焦（不移焦等于陷阱漏了）。
 */
export function resolveInitialFocus(
  container: HTMLElement,
  initialFocus: OverlayInitialFocus,
): HTMLElement | null {
  if (initialFocus === 'none') return null;
  const focusable = collectFocusable(container);
  if (initialFocus !== 'first') {
    const picked = container.querySelector<HTMLElement>(initialFocus);
    if (picked !== null && focusable.includes(picked)) return picked;
  }
  return focusable[0] ?? null;
}

/** 关闭后把焦点还给谁：记录的触发器还在文档里才还，否则不动。 */
export function resolveReturnFocus(recorded: Element | null): HTMLElement | null {
  if (!(recorded instanceof HTMLElement)) return null;
  return recorded.isConnected ? recorded : null;
}

/** 还焦要排在卸载之后，见文件头注释。 */
export function restoreFocus(target: HTMLElement | null): void {
  if (target === null) return;
  queueMicrotask(() => target.focus());
}

export type OverlayArrowKey = 'ArrowDown' | 'ArrowUp' | 'Home' | 'End';

/** 菜单 / 列表的 ↑↓ 巡航与 Home/End，两端回绕。 */
export function resolveArrowTarget(
  items: readonly HTMLElement[],
  active: Element | null,
  key: OverlayArrowKey,
): HTMLElement | null {
  const first = items[0];
  const last = items.at(-1);
  if (first === undefined || last === undefined) return null;
  if (key === 'Home') return first;
  if (key === 'End') return last;

  const index = active === null ? -1 : items.indexOf(active as HTMLElement);
  if (index === -1) return key === 'ArrowDown' ? first : last;
  const step = key === 'ArrowDown' ? 1 : -1;
  return items[(index + step + items.length) % items.length] ?? null;
}

/** 首字母跳转：从当前项之后开始找，绕一圈；无匹配返回 null（不动）。 */
export function resolveTypeaheadTarget(
  items: readonly HTMLElement[],
  active: Element | null,
  char: string,
): HTMLElement | null {
  const needle = char.toLowerCase();
  if (needle.length === 0) return null;
  const start = (active === null ? -1 : items.indexOf(active as HTMLElement)) + 1;
  for (let offset = 0; offset < items.length; offset += 1) {
    const item = items[(start + offset) % items.length];
    if (item !== undefined && (item.textContent ?? '').trim().toLowerCase().startsWith(needle)) {
      return item;
    }
  }
  return null;
}
