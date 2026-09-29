<script setup lang="ts">
import { ref } from 'vue';

import OverlaySurface from '../ui/overlay/OverlaySurface.vue';
import type { OverlayCloseReason } from '../ui/overlay/overlayStack.js';

/**
 * 工具栏浮层外壳（筛选 / 视图设置共用）。
 *
 * 外壳只管两件事，内容由默认插槽给：把触发按钮与它的计数徽标摆出来，
 * 再用**非模态**的 dialog 语义把内容挂成锚定浮层。其余（Esc 还焦、点外关闭、
 * 焦点陷阱、叠层号、退场）全在 Overlay 原语里。
 *
 * ⚠️ 用 popover 变体（不铺遮罩），不是 modal：工具栏浮层开着时表格仍应可读可滚。
 *    语义交给原语的 `semantics="dialog"`——它据此给出 role 与键盘巡航模型，
 *    且因 popover 无 scrim 而**不加** aria-modal（正是非模态想要的）。
 *
 * 迁移前这里自注册了一条文档级 pointerdown 做点外关闭、一个 root 上的 Esc 监听，
 * 以及裸写的 `role="dialog"` 与手挑落点——那三样现在都归原语。
 */
const props = defineProps<{
  /** 浮层标题，同时作为触发按钮与 dialog 的无障碍名。 */
  label: string;
  testId: string;
  /** 触发按钮右上角的计数（如筛选条件数）；空串＝不显示。 */
  badge?: string;
}>();

const emit = defineEmits<{ open: []; close: [] }>();

const trigger = ref<HTMLButtonElement | null>(null);
const isOpen = ref(false);

/**
 * 还焦目标：Esc 与从触发器收起时把焦点还给触发按钮（不还的话关掉浮层后 Tab
 * 会从文档头重来）；点外关不还焦。原语在关闭那一刻才读这个值判 `false`。
 */
const returnFocus = ref<HTMLElement | false>(false);

function open(): void {
  if (isOpen.value) return;
  returnFocus.value = trigger.value ?? false;
  isOpen.value = true;
  emit('open');
}

function close(restoreFocus = false): void {
  if (!isOpen.value) return;
  returnFocus.value = restoreFocus ? (trigger.value ?? false) : false;
  isOpen.value = false;
  emit('close');
}

function toggle(): void {
  if (isOpen.value) close(true);
  else open();
}

function onSurfaceClose(event: { reason: OverlayCloseReason }): void {
  close(event.reason === 'esc');
}

defineExpose({ open, close: () => close(false) });
</script>

<template>
  <div class="tpop">
    <button
      ref="trigger"
      class="tpop__trigger"
      type="button"
      aria-haspopup="dialog"
      :aria-expanded="isOpen"
      :aria-label="props.label"
      :data-testid="`${props.testId}-trigger`"
      @click="toggle"
    >
      <slot name="icon"></slot>
      <span v-if="props.badge" class="tpop__badge tnum">{{ props.badge }}</span>
    </button>

    <!--
      非模态锚定浮层：popover 变体不铺遮罩，浮层开着时表格仍可读可滚。
      `chrome=false`：`.tpop__panel` 自带完整卡片样式；role="dialog" 与键盘巡航归原语的 semantics。
      `label` 在 bare 下退化成纯 aria-label（迁移前这里本就写 aria-label），可见标题仍由 .tpop__title 给。
    -->
    <OverlaySurface
      :open="isOpen"
      variant="popover"
      semantics="dialog"
      :chrome="false"
      :anchor="trigger"
      placement="bottom-end"
      :return-focus="returnFocus"
      :label="props.label"
      @close="onSurfaceClose"
    >
      <div class="tpop__panel" :data-testid="`${props.testId}-panel`">
        <p class="tpop__title">{{ props.label }}</p>
        <slot></slot>
      </div>
    </OverlaySurface>
  </div>
</template>

<style scoped>
.tpop {
  position: relative;
  display: inline-flex;
}
/* 触发件是「工具」而不是「按钮」：平时只有图标，指到才浮起一层底 */
.tpop__trigger {
  display: inline-flex;
  width: var(--ctl-h);
  height: var(--ctl-h);
  align-items: center;
  justify-content: center;
  border: var(--bw) solid transparent;
  border-radius: var(--r-md);
  color: var(--muted2);
  background: transparent;
  cursor: pointer;
  transition:
    color var(--dur-1) var(--ease-out),
    background-color var(--dur-1) var(--ease-out),
    border-color var(--dur-1) var(--ease-out);
}
.tpop__trigger:hover {
  color: var(--ink);
  background: var(--sunken);
}
.tpop__trigger[aria-expanded='true'] {
  border-color: var(--accent-line);
  color: var(--accent-text);
  background: var(--accent-soft);
}
.tpop__trigger:focus-visible {
  outline: none;
  box-shadow: var(--focus-ring-flat);
}
.tpop__trigger :deep(svg) {
  display: block;
  width: 16px; /* 图标固有尺寸（D2.15 例外）；触发器 .tbtn 本身走 --ctl 档 */
  height: 16px;
}
/* 计数贴在图标右上：不占一行，但「已经筛了几条」在收起状态也看得见。
   ⚠️ 原型 .tbtn 只用 5px 圆点表「已筛」（.tbtn.active-dot::after），不显条数；
   本处的计数徽标为程序增量，无对应度量，保留（14/2/3 均为该徽标自有值）。 */
.tpop__badge {
  position: absolute;
  top: 2px;
  right: 2px;
  min-width: 14px;
  height: 14px;
  padding: 0 3px;
  border-radius: var(--r-pill);
  color: var(--panel);
  background: var(--accent);
  font-size: var(--fs-100);
  line-height: 14px;
  text-align: center;
}
/* 定位（翻转 / 夹逼 / transform-origin）与叠层号都归 Overlay 原语——迁移前这里
   死写 absolute 落点。这张卡片自己是滚动容器（max-height + overflow-y），
   ⚠️ 原语的 bare 面板不吃指针事件（见 overlay.css），所以自己开 auto。 */
/* 面板尺寸为可滚动设置浮层的响应式夹逼（原型 .ov-pop 无 max-height，宽度按内容 min-width:200）；
   340/460/48/120 是本组件自有的视口约束，无原型对应度量，保留。radius/padding 已用 --r-lg / --sp-3，
   与原型 .ov-pop（radius 12px、padding 7px）一致。 */
.tpop__panel {
  display: flex;
  width: min(340px, calc(100vw - 48px));
  max-height: min(460px, calc(100vh - 120px));
  flex-direction: column;
  gap: var(--sp-2);
  padding: var(--sp-3);
  overflow-y: auto;
  border: var(--bw) solid var(--line-strong);
  border-radius: var(--r-lg);
  background: var(--raised);
  box-shadow: var(--sh-3);
  pointer-events: auto;
}
.tpop__title {
  margin: 0;
  color: var(--muted);
  font: var(--fw-label) var(--fs-100) / 1 var(--font-sans);
  letter-spacing: 0.06em;
}
</style>
