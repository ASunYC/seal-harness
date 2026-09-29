<script setup lang="ts">
import { ref } from 'vue';

import AppIcon from '../ui/AppIcon.vue';
import OverlaySurface from '../ui/overlay/OverlaySurface.vue';
import type { OverlayCloseReason } from '../ui/overlay/overlayStack.js';
import type { RequirementMenuActionId, RequirementMenuItem } from './requirement-actions';

/**
 * 单屏需求详情的「更多操作」菜单（UX-02 判据 2）。
 *
 * 原型 `.req-more12` 是一个 `<details>`：条目按内容宽度居中排、菜单贴右边往左撑出卡片外
 * （渲染实测 x=169，压到左侧导航下面）。产品版改走 Overlay 原语的 popover + menu 语义：
 *  - **单列**：每项占满菜单宽度、图标与文字左对齐，长词换行不挤压相邻项；
 *  - **图标都有名称**：图标是装饰（aria-hidden），名称就是那一行看得见的字；
 *  - **焦点可返回**：Esc 与再点触发按钮收起时还给触发按钮；选中一项时**先**把焦点交还触发
 *    按钮再发意图——随后打开的弹层会把触发按钮记成还焦目标，关掉弹层焦点仍回到这里，
 *    而不是回到一个已随菜单卸载的条目上（那样焦点会掉到页面最顶层）。
 *
 * 条目集合与顺序由 `requirementDetailMenuItems` 决定，本组件只负责呈现与键盘/焦点。
 */
const props = defineProps<{ items: readonly RequirementMenuItem[] }>();

const emit = defineEmits<{ select: [RequirementMenuActionId] }>();

const trigger = ref<HTMLButtonElement | null>(null);
const isOpen = ref(false);
/** 原语在关闭那一刻才读它：`false`＝不还焦（点外关、选中一项），元素＝还给它。 */
const returnFocus = ref<HTMLElement | false>(false);

function openMenu(): void {
  returnFocus.value = trigger.value ?? false;
  isOpen.value = true;
}

function closeMenu(restoreFocus: boolean): void {
  returnFocus.value = restoreFocus ? (trigger.value ?? false) : false;
  isOpen.value = false;
}

function toggle(): void {
  if (isOpen.value) closeMenu(true);
  else openMenu();
}

function onSurfaceClose(event: { reason: OverlayCloseReason }): void {
  closeMenu(event.reason === 'esc');
}

function select(id: RequirementMenuActionId): void {
  closeMenu(false);
  trigger.value?.focus();
  emit('select', id);
}
</script>

<template>
  <div class="req-more">
    <button
      ref="trigger"
      class="req-more__trigger"
      type="button"
      aria-haspopup="menu"
      :aria-expanded="isOpen"
      data-testid="requirement-detail-more"
      @click="toggle"
    >
      <AppIcon name="chevron-down" :size="13" class="req-more__caret" aria-hidden="true" />
      <span>更多操作</span>
    </button>

    <!-- `chrome=false`：菜单卡片样式在 .req-more__menu 上；bare 面板不吃指针事件，卡片自己开 auto。 -->
    <OverlaySurface
      :open="isOpen"
      variant="popover"
      semantics="menu"
      :chrome="false"
      :anchor="trigger"
      placement="bottom-start"
      :return-focus="returnFocus"
      label="更多操作"
      @close="onSurfaceClose"
    >
      <div class="req-more__menu" data-testid="requirement-detail-more-menu">
        <button
          v-for="item in props.items"
          :key="item.id"
          class="req-more__item"
          :class="{ 'is-danger': item.danger }"
          type="button"
          role="menuitem"
          :data-action="item.id"
          @click="select(item.id)"
        >
          <AppIcon :name="item.icon" :size="14" class="req-more__icon" aria-hidden="true" />
          <span class="req-more__label">{{ item.label }}</span>
        </button>
      </div>
    </OverlaySurface>
  </div>
</template>

<style scoped>
.req-more {
  display: inline-flex;
}
/* 触发按钮（原型 .req-more12>summary：描边、6px 10px、小圆角）。 */
.req-more__trigger {
  display: inline-flex;
  min-height: var(--ctl-h);
  align-items: center;
  gap: var(--sp-1);
  padding: var(--px-6) var(--px-10);
  border: var(--bw) solid var(--line-strong);
  border-radius: var(--r-sm);
  color: var(--ink);
  background: var(--panel);
  font: inherit;
  font-size: var(--fs-300);
  white-space: nowrap;
  cursor: pointer;
  transition:
    border-color var(--dur-1) var(--ease-out),
    background-color var(--dur-1) var(--ease-out);
}
.req-more__trigger:hover {
  background: var(--sunken);
}
.req-more__trigger[aria-expanded='true'] {
  border-color: var(--accent-line);
  color: var(--accent-text);
  background: var(--accent-soft);
}
.req-more__trigger:focus-visible {
  outline: none;
  box-shadow: var(--focus-ring-flat);
}
/* 展开标记在字前（原型 <summary> 的 ▸）：收起时朝右，展开转朝下。 */
.req-more__caret {
  transform: rotate(-90deg);
  transition: transform var(--dur-1) var(--ease-out);
}
.req-more__trigger[aria-expanded='true'] .req-more__caret {
  transform: none;
}
/* 菜单卡片（原型最终层 .req-more-menu12：260px、8px 内边距、raised 底、弹层阴影）。
   宽度用 min/max 夹：125% 文字下长词换行而不是被裁；视口窄时不超出屏幕。 */
.req-more__menu {
  display: flex;
  width: max-content;
  min-width: 260px; /* 原型最终层 .req-more-menu12 width=260px（不在 --px-* 梯，保留字面量） */
  max-width: min(360px, calc(100vw - 32px)); /* 本组件自有的视口夹逼，无原型对应度量 */
  flex-direction: column;
  align-items: stretch;
  gap: var(--px-3);
  padding: var(--px-8);
  border: var(--bw) solid var(--line-strong);
  border-radius: var(--r-md);
  background: var(--raised);
  box-shadow: var(--sh-3);
  pointer-events: auto;
}
/* 单列：每项撑满菜单宽、左对齐，图标定宽一格，文字可换行。 */
.req-more__item {
  display: grid;
  width: 100%;
  min-height: var(--ctl-h);
  grid-template-columns: var(--px-16) minmax(0, 1fr);
  align-items: center;
  gap: var(--px-8);
  padding: var(--px-8) var(--px-10);
  border: 0;
  border-radius: var(--r-sm);
  color: var(--ink);
  background: transparent;
  font: inherit;
  font-size: var(--fs-body);
  line-height: var(--lh-body);
  text-align: left;
  cursor: pointer;
}
.req-more__item:hover,
.req-more__item:focus-visible {
  outline: none;
  background: var(--sunken);
}
.req-more__item:focus-visible {
  box-shadow: var(--focus-ring-flat);
}
.req-more__icon {
  justify-self: center;
  color: var(--muted2);
}
.req-more__label {
  min-width: 0;
  overflow-wrap: anywhere;
}
.req-more__item.is-danger {
  color: var(--danger-text);
}
.req-more__item.is-danger .req-more__icon {
  color: currentcolor;
}
@media (prefers-reduced-motion: reduce) {
  .req-more__trigger,
  .req-more__caret {
    transition: none;
  }
}
</style>
