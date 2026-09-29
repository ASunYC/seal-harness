<script lang="ts">
export type OverlayVariant = 'popover' | 'modal' | 'drawer' | 'toast';
export type OverlaySemantics = 'dialog' | 'alertdialog' | 'menu' | 'listbox' | 'presentation';
export type OverlayEdge = 'right' | 'left' | 'bottom' | 'top';
/** 只接受阶梯名，不接受数值。`modal-child` 用于模态窗口之上的子级 Overlay。 */
export type OverlayZLayer =
  'dropdown' | 'approval' | 'scrim' | 'modal' | 'modal-child' | 'toast' | 'tooltip';

/**
 * `'auto'` = 按形态推导。
 *
 * ⚠️ 不能写成 `boolean | undefined`：Vue 对声明为 Boolean 的 prop 做隐式转型，
 * **缺省会变成 `false` 而不是 `undefined`**，三态就退化成两态了。多一个字符串
 * 成员会让 `withDefaults` 生成真正的 `default`，转型分支随之短路。
 */
export type OverlayAutoBoolean = boolean | 'auto';

/**
 * 还焦目标：`'auto'` 自动记录 opener、`false` 显式不还焦、或直接给元素。
 *
 * ⚠️ 同样不能写成 `HTMLElement | false`（少了 `'auto'` 这一档）：那样运行时
 * 类型里带 Boolean，**缺省会被转型成 `false`**，于是「不还焦」变成了默认行为，
 * 而且完全静默——实测踩过，是 v-model 用法下还焦全线失效的那个根因。
 */
export type OverlayReturnFocus = HTMLElement | false | 'auto';

const SEMANTICS_BY_VARIANT: Readonly<Record<OverlayVariant, OverlaySemantics>> = {
  popover: 'menu',
  modal: 'dialog',
  drawer: 'dialog',
  toast: 'presentation',
};

const SCRIM_BY_VARIANT: Readonly<Record<OverlayVariant, boolean>> = {
  popover: false,
  modal: true,
  drawer: true,
  toast: false,
};

const DISMISS_ON_OUTSIDE_BY_VARIANT: Readonly<Record<OverlayVariant, boolean>> = {
  popover: true,
  // 模态默认点外不关：表单填了一半被误关，比多点一次「取消」贵得多。
  // capability 系 10 个表单框「点外不关」是拍板过的产品约束
  // （CapabilityFormDialogGuards.test.ts），这里是它的默认承载处。
  modal: false,
  drawer: true,
  toast: false,
};

const Z_LAYER_BY_VARIANT: Readonly<Record<OverlayVariant, OverlayZLayer>> = {
  popover: 'dropdown',
  modal: 'modal',
  // --z-drawer 尚未进 tokens.css（须走规范 §2.11 → gen-tokens.py），暂用 --z-scrim。
  // 这是一个显式的临时态，不是遗漏。
  drawer: 'scrim',
  toast: 'toast',
};

const MENU_NAV_KEYS: readonly string[] = ['ArrowDown', 'ArrowUp', 'Home', 'End'];

let surfaceSeq = 0;
</script>

<script setup lang="ts">
/**
 * Overlay 原语 —— 四形态（popover / modal / drawer / toast）共一个组件。
 *
 * 它要替掉的是全仓 51 个组件各写各的那套：18 份手抄焦点陷阱、三套互不兼容的
 * 点外关闭语义（`@click.self` / `@mousedown.self` / 各自注册 pointerdown）、
 * 8 处裸 z-index，以及用布尔量把外层焦点陷阱临时关掉的嵌套 hack。
 *
 * 三条设计取舍，改之前先读：
 *
 * ① **默认 `v-if` 卸载**，只在退场动画那一段上 `inert`。全仓 8+ 条既有测试断言
 *    「关闭后 querySelector 为 null」，而 `v-if` 本来就不在 Tab 序里；`inert`
 *    的真实价值只在「渲染了但视觉隐藏」的退场那一段，以及被上层压住的那一层。
 *
 * ② **`close` 与 `closed` 分开**：`close` 是关闭**意图**，上层可以拦下来做二次
 *    确认（`WorkspaceSurface` 的 pendingGuard 就靠它，不必再自造一层 scrim）；
 *    用 `v-model:open` 的场景则由 `update:open` 直接生效。
 *
 * ③ **点外关闭按 pointerdown 起点 + pointerup 终点两端判定**：两端都在层外才算
 *    点外。`@click.self` 与 `@mousedown.self` 都会把「层内起手拖到层外松手」误判
 *    成关闭——那正是选中文本时的常见动作。
 */
import {
  computed,
  onBeforeUnmount,
  onMounted,
  ref,
  useSlots,
  watch,
  type CSSProperties,
} from 'vue';

import {
  collectFocusable,
  resolveArrowTarget,
  resolveInitialFocus,
  resolveReturnFocus,
  resolveTabTarget,
  resolveTypeaheadTarget,
  restoreFocus,
  type OverlayArrowKey,
  type OverlayInitialFocus,
} from './overlayFocus.js';
import {
  resolveOverlayPosition,
  type OverlayPlacement,
  type OverlayPositionResult,
} from './overlayPosition.js';
import { overlayHostElement } from './overlayHostElement.js';
import { installOverlayDismiss } from './overlayDismiss.js';
import type { OverlayCloseReason } from './overlayStack.js';
import { projectRuntime } from '../../../../../../src/ui/runtime';
const { shadow, overlayStack } = projectRuntime();

const props = withDefaults(
  defineProps<{
    open: boolean;
    variant?: OverlayVariant;
    /** 缺省按 variant 推导；决定 role、aria-modal 与键盘巡航模型 */
    semantics?: OverlaySemantics;
    /** popover 必填：定位基准与 transform-origin 都从它来 */
    anchor?: HTMLElement | null;
    placement?: OverlayPlacement;
    /** drawer 从哪条边进出 */
    edge?: OverlayEdge;
    scrim?: OverlayAutoBoolean;
    /** 逐实例可关，承接 CapabilityFormDialogGuards 的既有产品约束 */
    dismissOnOutside?: OverlayAutoBoolean;
    dismissOnEsc?: boolean;
    /** 进行中：Esc 与点外全部失效 */
    busy?: boolean;
    /** 与 labelledBy 二选一 */
    label?: string;
    labelledBy?: string;
    describedBy?: string;
    initialFocus?: OverlayInitialFocus;
    /** 传 false 表示显式不还焦；缺省 'auto' 自动记录 opener */
    returnFocus?: OverlayReturnFocus;
    width?: string | undefined;
    maxWidth?: string;
    zLayer?: OverlayZLayer;
    /**
     * 面板是否由原语画外框（边框 / 底色 / 阴影 / 内边距）。
     *
     * 传 `false` 时原语只保留**行为**（scrim、叠层栈、焦点陷阱、点外、退场），
     * 外观与布局整个交回内容——迁移那些自带完整卡片样式的既有弹层时用它，
     * 免得跟原语的外框叠成双边框。此时 modal 的面板退化成一个**全视口透明布局盒
     * 且 `pointer-events: none`**，内容必须自己把交互区 `pointer-events: auto`
     * 打开；否则点外判定会把整屏都算成「层内」，点遮罩就关不掉了。
     */
    chrome?: boolean;
  }>(),
  {
    variant: 'modal',
    anchor: null,
    placement: 'bottom-start',
    edge: 'right',
    scrim: 'auto',
    dismissOnOutside: 'auto',
    dismissOnEsc: true,
    busy: false,
    initialFocus: 'first',
    returnFocus: 'auto',
    chrome: true,
  },
);

const emit = defineEmits<{
  'update:open': [boolean];
  opened: [];
  close: [{ reason: OverlayCloseReason }];
  closed: [];
}>();

const slots = useSlots();

const surfaceId = `ovl-${(surfaceSeq += 1)}`;
const titleId = `${surfaceId}-title`;

const panel = ref<HTMLElement | null>(null);
const position = ref<OverlayPositionResult | null>(null);
/** 被上层挡背景的层压住时整层 inert（替掉嵌套 hack，判据在 overlayStack） */
const suppressed = ref(false);
/**
 * Teleport 落点：**模块级共享的同一个元素，setup 期就取到，此后引用永不变**。
 *
 * 三条约束的来历、以及为什么不能退回 `body`、不能挂载后改 `:to`、不能推迟渲染，
 * 全写在 `overlayHostElement.ts` 的文件头注释里（三条各对应一次实机事故）。
 * ⛔ 改这一行之前先读那段。
 */
const teleportTarget: HTMLElement | string = overlayHostElement();

let stopOutsideDismiss: (() => void) | null = null;
let opener: HTMLElement | null = null;
let stopStackWatch: (() => void) | null = null;

const semantics = computed<OverlaySemantics>(
  () => props.semantics ?? SEMANTICS_BY_VARIANT[props.variant],
);
const hasScrim = computed(() =>
  props.scrim === 'auto' ? SCRIM_BY_VARIANT[props.variant] : props.scrim,
);
const dismissOnOutside = computed(() =>
  props.dismissOnOutside === 'auto'
    ? DISMISS_ON_OUTSIDE_BY_VARIANT[props.variant]
    : props.dismissOnOutside,
);
const zLayer = computed<OverlayZLayer>(() => props.zLayer ?? Z_LAYER_BY_VARIANT[props.variant]);
const isDialogLike = computed(
  () => semantics.value === 'dialog' || semantics.value === 'alertdialog',
);
const isMenuLike = computed(() => semantics.value === 'menu' || semantics.value === 'listbox');
/** toast 不是模态，Esc 不该被它吃掉 —— 它不进栈（design.md 形态推导表） */
const joinsStack = computed(() => props.variant !== 'toast');
const blocksBackground = computed(() => isDialogLike.value && hasScrim.value);
/**
 * 缺省标题条由 label 渲染成 h2；给了 header 插槽就没有这个 h2 可指。
 *
 * `chrome=false` 时也不渲染：标题条是**外观**，而 bare 的约定就是外观整个交回内容。
 * 此时 `label` 退化成纯 `aria-label` —— 迁移那些自带标题栏、原本就写着
 * `aria-label="…"` 的既有弹层时正好对上，不必为了拿一个无障碍名字再多长一条 h2。
 */
const rendersOwnTitle = computed(
  () => props.chrome && props.label !== undefined && slots.header === undefined,
);
const rendersHeader = computed(() => slots.header !== undefined || rendersOwnTitle.value);

const rootClasses = computed(() => [
  `ovl--${props.variant}`,
  `ovl--z-${zLayer.value}`,
  props.variant === 'drawer' ? `ovl--drawer-${props.edge}` : null,
  props.chrome ? null : 'ovl--bare',
]);

const labelledBy = computed(
  () => props.labelledBy ?? (rendersOwnTitle.value ? titleId : undefined),
);
const ariaLabel = computed(() => (labelledBy.value === undefined ? props.label : undefined));

const panelStyle = computed<CSSProperties>(() => {
  const size: CSSProperties = { width: props.width, maxWidth: props.maxWidth };
  const placed = position.value;
  if (props.variant !== 'popover' || placed === null) return size;
  return {
    ...size,
    top: placed.top === null ? 'auto' : `${placed.top}px`,
    bottom: placed.bottom === null ? 'auto' : `${placed.bottom}px`,
    left: `${placed.left}px`,
    maxHeight: `${placed.maxHeight}px`,
    overflowY: 'auto',
    transformOrigin: placed.transformOrigin,
  };
});

function currentActiveElement(): HTMLElement | null {
  const active = shadow.activeElement;
  // ⚠️ 必须排掉 body：它是「当前没有元素被聚焦」的表示，不是一个可以还回去的
  // 触发器。把它当 opener 记下来，关闭时那次 `body.focus()` 会**抢走**焦点——
  // 若期间用户已经点到了别处，焦点就被无声地拽回顶层了。
  return active instanceof HTMLElement && active !== document.body ? active : null;
}

function resolveOpener(): HTMLElement | null {
  if (props.returnFocus === false) return null;
  return props.returnFocus === 'auto' ? currentActiveElement() : props.returnFocus;
}

function requestClose(reason: OverlayCloseReason): void {
  if (props.busy) return;
  emit('close', { reason });
  emit('update:open', false);
}

function measure(): void {
  const anchor = props.anchor;
  const element = panel.value;
  if (props.variant !== 'popover' || anchor === null || element === null) return;
  const rect = anchor.getBoundingClientRect();
  position.value = resolveOverlayPosition({
    anchor: { top: rect.top, left: rect.left, width: rect.width, height: rect.height },
    panel: { width: element.offsetWidth, height: element.offsetHeight },
    viewport: { width: window.innerWidth, height: window.innerHeight },
    placement: props.placement,
  });
}

function isInsideSurface(target: EventTarget | null): boolean {
  if (!(target instanceof Node)) return false;
  if (panel.value?.contains(target) === true) return true;
  return props.anchor?.contains(target) === true;
}

/**
 * 触发器状态回写。关闭时置 `aria-expanded="false"` 而不是摘掉——摘掉会让触发器
 * 看上去不是个可展开控件；`aria-haspopup` 是静态属性，同理保留。
 */
function syncTriggerState(expanded: boolean): void {
  const anchor = props.anchor;
  if (anchor === null || props.variant !== 'popover') return;
  anchor.setAttribute('aria-expanded', expanded ? 'true' : 'false');
  // 触发器自己声明过 aria-haspopup 就不覆盖：作者知道弹出来的是 dialog 还是 listbox，
  // 按形态推出来的那个只能给到 menu，覆盖过去反而把更准的说法改差了。
  if (expanded && !anchor.hasAttribute('aria-haspopup')) {
    anchor.setAttribute('aria-haspopup', semantics.value === 'listbox' ? 'listbox' : 'menu');
  }
}

function warnMissingLabel(): void {
  if (!import.meta.env.DEV) return;
  if (!isDialogLike.value || props.label !== undefined || props.labelledBy !== undefined) return;
  console.warn(`[OverlaySurface] ${semantics.value} 缺少 label / labelledBy，读屏听不到标题`);
}

function openSurface(): void {
  // onMounted 那一支是延到下一个 tick 才跑的，期间可能已经被关掉了
  if (!props.open) return;
  warnMissingLabel();
  opener = resolveOpener();

  stopOutsideDismiss?.();
  stopOutsideDismiss = installOverlayDismiss({
    pointerTarget: shadow,
    stack: overlayStack,
    isInside: isInsideSurface,
    canDismiss: () => dismissOnOutside.value && !props.busy,
    onDismiss: () => requestClose('outside'),
    ...(joinsStack.value ? { stackEntryId: surfaceId } : {}),
  });
  if (props.variant === 'popover') {
    window.addEventListener('resize', measure);
    window.addEventListener('scroll', measure, true);
  }
  if (joinsStack.value) {
    overlayStack.push(
      {
        id: surfaceId,
        busy: props.busy,
        dismissOnEsc: props.dismissOnEsc,
        blocksBackground: blocksBackground.value,
      },
      requestClose,
    );
    stopStackWatch = overlayStack.subscribe(() => {
      suppressed.value = overlayStack.isSuppressed(surfaceId);
    });
  }

  syncTriggerState(true);
  measure();
  const container = panel.value;
  if (container !== null) resolveInitialFocus(container, props.initialFocus)?.focus();
}

function closeSurface(): void {
  stopOutsideDismiss?.();
  stopOutsideDismiss = null;
  window.removeEventListener('resize', measure);
  window.removeEventListener('scroll', measure, true);
  stopStackWatch?.();
  stopStackWatch = null;
  overlayStack.remove(surfaceId);
  suppressed.value = false;
  syncTriggerState(false);
}

/* 此处原有一个 pre-flush watcher，在每次 `open` 翻转时重解析 Teleport 落点。
   已删除：那正是「挂载后改 `:to`」的来源，见 `teleportTarget` 的说明。
   ⛔ 别把它加回来——落点必须一次定死。 */

// 开关的副作用要在 DOM 更新之后做（此刻 panel ref 才有值），所以走 post flush；
// 「挂载时就是打开的」这一支 post watcher 收不到，由 onMounted 兜。
watch(
  () => props.open,
  (open) => {
    if (open) openSurface();
    else closeSurface();
  },
  { flush: 'post' },
);

watch(
  () => [props.busy, props.dismissOnEsc, blocksBackground.value] as const,
  ([busy, dismissOnEsc, blocks]) => {
    if (!props.open || !joinsStack.value) return;
    overlayStack.update(surfaceId, { busy, dismissOnEsc, blocksBackground: blocks });
  },
);

watch(
  () => [props.anchor, props.placement, props.width, props.maxWidth] as const,
  () => {
    if (props.open) measure();
  },
  { flush: 'post' },
);

onMounted(() => {
  if (!props.open) return;
  openSurface();
});

onBeforeUnmount(() => {
  const wasOpen = props.open;
  closeSurface();
  // 调用方用 `v-if` 把整个壳摘掉时（ConfirmDialog 的 5 个调用点都是这个形态），
  // Transition 的 leave 根本不会跑，`after-leave` 也就永远不来——还焦全靠这一支。
  // 正常关闭走的是 open→false，那条路上 leave 会跑，两边不会重复触发。
  if (wasOpen) finishClose();
});

function focusInLayer(target: HTMLElement | null, event: KeyboardEvent): void {
  if (target === null) return;
  event.preventDefault();
  target.focus();
}

function onKeydown(event: KeyboardEvent): void {
  const container = panel.value;
  if (container === null) return;

  if (event.key === 'Tab') {
    const focusable = collectFocusable(container);
    focusInLayer(resolveTabTarget(focusable, shadow.activeElement, event.shiftKey), event);
    return;
  }

  if (!isMenuLike.value) return;

  if (MENU_NAV_KEYS.includes(event.key)) {
    const items = collectFocusable(container);
    const key = event.key as OverlayArrowKey;
    focusInLayer(resolveArrowTarget(items, shadow.activeElement, key), event);
    return;
  }

  // 首字母跳转：只认不带修饰键的单字符，别把 Ctrl+F 这类快捷键吃掉
  if (event.key.length !== 1 || event.ctrlKey || event.altKey || event.metaKey) return;
  const items = collectFocusable(container);
  focusInLayer(resolveTypeaheadTarget(items, shadow.activeElement, event.key), event);
}

/** 退场动画期间上 inert —— 这段时间元素还在 DOM 里，但已经不该被 Tab 到。 */
function markLeaving(element: Element): void {
  element.setAttribute('inert', '');
}

/** 退场被打断、元素被复用时要把上一步的 inert 摘掉。 */
function clearLeaving(element: Element): void {
  element.removeAttribute('inert');
}

/** 退场收尾：还焦 + 广播 `closed`。退场跑完与整壳被卸载两条路都汇到这里。 */
function finishClose(): void {
  const target = props.returnFocus === false ? null : resolveReturnFocus(opener);
  opener = null;
  position.value = null;
  // 还焦排进微任务：此刻触发器尚在 DOM 里，直接 focus 会被卸载覆盖
  // （沿用 ConfirmDialog.vue:52-54 已验证的时序）
  restoreFocus(target);
  emit('closed');
}
</script>

<template>
  <Teleport :to="teleportTarget">
    <Transition
      name="ovl"
      @before-enter="clearLeaving"
      @after-enter="emit('opened')"
      @leave="markLeaving"
      @after-leave="finishClose"
    >
      <div v-if="open" class="ovl" :class="rootClasses" :inert="suppressed || undefined">
        <div v-if="hasScrim" class="ovl__scrim" aria-hidden="true" />
        <div
          ref="panel"
          class="ovl__panel"
          :role="semantics"
          :aria-modal="isDialogLike && hasScrim ? 'true' : undefined"
          :aria-label="ariaLabel"
          :aria-labelledby="labelledBy"
          :aria-describedby="describedBy"
          :aria-busy="busy ? 'true' : undefined"
          :style="panelStyle"
          @keydown="onKeydown"
        >
          <header v-if="rendersHeader" class="ovl__header">
            <slot name="header">
              <h2 :id="titleId" class="ovl__title">{{ label }}</h2>
            </slot>
          </header>
          <div class="ovl__body">
            <slot />
          </div>
          <footer v-if="slots.footer" class="ovl__footer">
            <slot name="footer" />
          </footer>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style src="./overlay.css"></style>
