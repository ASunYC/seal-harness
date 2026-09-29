/**
 * Popover 的翻转与视口夹逼 —— 纯函数，不读 DOM。
 *
 * 判据移植自 `docs/星图工作台高保真交互原型-v1.html` 的 `showPop`：
 * 按上下可用空间自动翻转、`maxHeight` 兜底 120px、横向夹进视口、
 * transform-origin 指回触发器方位（缩放动画要从触发器"长出来"，不是从中心）。
 *
 * 抽成纯函数的理由很硬：happy-dom 的 `getBoundingClientRect` 恒零，
 * 「账号菜单在屏底自动上翻」这件事在组件测试里**证不出来**。判定放这里
 * 才能用九宫格锚点 × 四 placement 穷举，组件只剩「把结果写进 style」。
 */

export type OverlayPlacement = 'bottom-start' | 'bottom-end' | 'top-start' | 'top-end';

export const OVERLAY_PLACEMENTS: readonly OverlayPlacement[] = [
  'bottom-start',
  'bottom-end',
  'top-start',
  'top-end',
];

export interface OverlayRect {
  readonly top: number;
  readonly left: number;
  readonly width: number;
  readonly height: number;
}

export interface OverlaySize {
  readonly width: number;
  readonly height: number;
}

export interface OverlayViewport {
  readonly width: number;
  readonly height: number;
}

/** 算可用空间时给视口上下各留的余量（原型 `showPop` 用的 16）。 */
export const OVERLAY_EDGE_GAP = 16;
/** 面板与锚点之间的间距。 */
export const OVERLAY_ANCHOR_GAP = 8;
/** 横向夹逼时距视口左右边的最小距离。 */
export const OVERLAY_VIEWPORT_MARGIN = 8;
/** 上下都不够时的兜底高度：低于这个值菜单就没法读了，宁可溢出也不再压。 */
export const OVERLAY_MIN_PANEL_HEIGHT = 120;

export interface OverlaySpace {
  readonly above: number;
  readonly below: number;
}

/**
 * 锚点上下各自的可用空间。
 * ⚠️ 不夹到 0：负值要能参与「哪边更大」的比较，夹掉会让两侧都贴边时判错方向。
 */
export function availableSpace(anchor: OverlayRect, viewport: OverlayViewport): OverlaySpace {
  return {
    above: anchor.top - OVERLAY_EDGE_GAP,
    below: viewport.height - (anchor.top + anchor.height) - OVERLAY_EDGE_GAP,
  };
}

/**
 * 是否落到锚点上方。
 *
 * 期望向下：下方装不下、且上方比下方大才翻上；
 * 期望向上：上方装不下、且下方比上方大才翻下。
 * 两侧都装不下时挑更大的那侧——这正是原型 `showPop` 那行三元的展开。
 */
export function shouldFlipUp(
  placement: OverlayPlacement,
  panelHeight: number,
  space: OverlaySpace,
): boolean {
  const wantUp = placement.startsWith('top');
  const { above, below } = space;
  if (wantUp) return !(above < panelHeight && below > above);
  return below < panelHeight && above > below;
}

/** 横向夹进视口：面板比视口还宽时保左边可见（右侧溢出），不让它跑到屏幕外。 */
export function clampLeft(desiredLeft: number, panelWidth: number, viewportWidth: number): number {
  const max = viewportWidth - panelWidth - OVERLAY_VIEWPORT_MARGIN;
  return Math.max(OVERLAY_VIEWPORT_MARGIN, Math.min(desiredLeft, max));
}

/** 缩放动画的原点：纵向指回锚点那一侧，横向看锚点中心落在面板哪半边。 */
export function resolveTransformOrigin(
  side: 'top' | 'bottom',
  anchor: OverlayRect,
  left: number,
  panelWidth: number,
): string {
  const vertical = side === 'top' ? 'bottom' : 'top';
  const anchorCenterOffset = anchor.left + anchor.width / 2 - left;
  const horizontal = anchorCenterOffset < panelWidth / 2 ? 'left' : 'right';
  return `${vertical} ${horizontal}`;
}

export interface OverlayPositionInput {
  readonly anchor: OverlayRect;
  readonly panel: OverlaySize;
  readonly viewport: OverlayViewport;
  readonly placement?: OverlayPlacement;
}

export interface OverlayPositionResult {
  /** 面板落在锚点的哪一侧 */
  readonly side: 'top' | 'bottom';
  /** 是否与 placement 的期望相反（真机走查时用来确认翻转确实发生了） */
  readonly flipped: boolean;
  readonly top: number | null;
  readonly bottom: number | null;
  readonly left: number;
  readonly maxHeight: number;
  readonly transformOrigin: string;
}

export function resolveOverlayPosition(input: OverlayPositionInput): OverlayPositionResult {
  const { anchor, panel, viewport } = input;
  const placement = input.placement ?? 'bottom-start';

  const space = availableSpace(anchor, viewport);
  const up = shouldFlipUp(placement, panel.height, space);
  const side = up ? 'top' : 'bottom';

  const desiredLeft = placement.endsWith('end')
    ? anchor.left + anchor.width - panel.width
    : anchor.left;
  const left = clampLeft(desiredLeft, panel.width, viewport.width);

  return {
    side,
    flipped: up !== placement.startsWith('top'),
    top: up ? null : anchor.top + anchor.height + OVERLAY_ANCHOR_GAP,
    bottom: up ? viewport.height - anchor.top + OVERLAY_ANCHOR_GAP : null,
    left,
    maxHeight: Math.max(OVERLAY_MIN_PANEL_HEIGHT, up ? space.above : space.below),
    transformOrigin: resolveTransformOrigin(side, anchor, left, panel.width),
  };
}
