<script setup lang="ts">
import { ref } from 'vue';

import AppIcon from '../ui/AppIcon.vue';
import OverlaySurface from '../ui/overlay/OverlaySurface.vue';
import type { OverlayCloseReason } from '../ui/overlay/overlayStack.js';
import { PROJECT_MANAGE_ITEMS, type ProjectManageAction } from './project-manage-actions';

/**
 * 页头「⋯ 项目管理」菜单（UX-14）。
 *
 * 位置与形态照协作原型最终层页头的 `header-settings`（⋯ 图标钮 → 「项目管理」浮层菜单）；
 * 条目集合是右栏「项目管理」分区的同一张表（`PROJECT_MANAGE_ITEMS`）。右栏看不见的两种情形
 * ——助理分栏打开、项目页窄于 900px——入口就在这里。
 *
 * 呈现与焦点照 `RequirementDetailMoreMenu`（Overlay 原语 popover + menu 语义）：
 *  - Esc / 再点触发钮收起时焦点还给触发钮；
 *  - 选中一项时**先**把焦点交还触发钮再发意图——随后打开的弹层把触发钮记成还焦目标，
 *    关掉弹层焦点仍回到这里，而不是回到一个已随菜单卸载的条目上。
 *
 * 本组件只发意图，弹层归项目页：右栏与这里打开的是同一个弹层实例。
 */
const emit = defineEmits<{ select: [ProjectManageAction] }>();

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

function select(action: ProjectManageAction): void {
  closeMenu(false);
  trigger.value?.focus();
  emit('select', action);
}
</script>

<template>
  <div class="pj-manage">
    <button
      ref="trigger"
      class="pj-manage__trigger"
      type="button"
      aria-label="项目管理"
      title="项目管理"
      aria-haspopup="menu"
      :aria-expanded="isOpen"
      data-testid="project-manage-menu"
      @click="toggle"
    >
      <AppIcon name="more" :size="16" />
    </button>

    <!-- `chrome=false`：卡片样式在 .pj-manage__list 上；bare 面板不吃指针事件，卡片自己开 auto。 -->
    <OverlaySurface
      :open="isOpen"
      variant="popover"
      semantics="menu"
      :chrome="false"
      :anchor="trigger"
      placement="bottom-end"
      :return-focus="returnFocus"
      label="项目管理"
      @close="onSurfaceClose"
    >
      <div class="pj-manage__list" data-testid="project-manage-menu-list">
        <button
          v-for="item in PROJECT_MANAGE_ITEMS"
          :key="item.id"
          class="pj-manage__item"
          type="button"
          role="menuitem"
          :data-action="item.id"
          @click="select(item.id)"
        >
          <AppIcon :name="item.icon" :size="14" class="pj-manage__icon" aria-hidden="true" />
          <span class="pj-manage__label">{{ item.label }}</span>
        </button>
      </div>
    </OverlaySurface>
  </div>
</template>

<style scoped>
.pj-manage {
  display: inline-flex;
  flex: 0 0 auto;
}
/* 触发钮：与页头其余动作同高档（26px）的方形图标钮，色阶同返回键；展开态点亮。 */
.pj-manage__trigger {
  display: inline-grid;
  width: var(--px-26);
  height: var(--px-26);
  place-items: center;
  padding: 0;
  border: 0;
  border-radius: var(--r-sm);
  color: var(--muted2);
  background: transparent;
  cursor: pointer;
  transition:
    background-color var(--dur-1) var(--ease-out),
    color var(--dur-1) var(--ease-out);
}
.pj-manage__trigger:hover,
.pj-manage__trigger[aria-expanded='true'] {
  color: var(--ink);
  background: var(--sunken);
}
.pj-manage__trigger:focus-visible {
  outline: none;
  box-shadow: var(--focus-ring-flat);
}
/* 菜单卡片：与需求详情「更多操作」同一套卡片（raised 底、弹层阴影、8px 内边距）。
   宽度按内容、下限 220px；125% 文字下长词换行而不是被裁，视口窄时不超出屏幕。 */
.pj-manage__list {
  display: flex;
  width: max-content;
  min-width: 220px; /* 三个四字条目 + 图标的舒适宽度（不在 --px-* 梯，保留字面量） */
  max-width: min(320px, calc(100vw - 32px)); /* 本组件自有的视口夹逼，无原型对应度量 */
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
.pj-manage__item {
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
.pj-manage__item:hover,
.pj-manage__item:focus-visible {
  outline: none;
  background: var(--sunken);
}
.pj-manage__item:focus-visible {
  box-shadow: var(--focus-ring-flat);
}
.pj-manage__icon {
  justify-self: center;
  color: var(--muted2);
}
.pj-manage__label {
  min-width: 0;
  overflow-wrap: anywhere;
}
@media (prefers-reduced-motion: reduce) {
  .pj-manage__trigger {
    transition: none;
  }
}
</style>
