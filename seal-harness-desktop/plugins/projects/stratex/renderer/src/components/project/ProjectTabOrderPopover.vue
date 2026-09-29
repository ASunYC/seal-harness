<script setup lang="ts">
import { nextTick, ref } from 'vue';

import AppIcon from '../ui/AppIcon.vue';
import TodoToolPopover from './TodoToolPopover.vue';
import type { ProjectTab, ProjectTabDef } from './project-tabs';

/**
 * 「自定义页签顺序」浮层（UX-10 判据 1 的「恢复默认」入口，对齐合并产物 `tabs-settings24`）。
 *
 * 拖动与 Alt+←→ 都在页签条上；这里补一条**看得见、点得到**的路：逐行上移 / 下移与
 * 「恢复默认顺序」。拖动对键盘与读屏用户不可达，Alt 组合键又没人会自己发现——⛔ 别只留那两条。
 *
 * 本组件只发意图（`move` / `reset`），顺序本身与「先存、存下了才应用」都在
 * `useProjectTabPreferences`；外壳（非模态 dialog、Esc 还焦、点外关闭）归 `TodoToolPopover`。
 */
const props = defineProps<{
  /** 当前顺序下的页签（已归一，恒为现行集合）。 */
  tabs: readonly ProjectTabDef[];
  isDefaultOrder: boolean;
}>();

const emit = defineEmits<{ move: [id: ProjectTab, delta: -1 | 1]; reset: [] }>();

const list = ref<HTMLOListElement | null>(null);

/**
 * 行重排后 DOM 节点搬家会丢焦点：焦点跟着这一行的同向按钮走；走到头按钮禁用了就换到另一侧。
 * 存档失败时顺序没动，节点也没搬，焦点本就还在。
 */
function refocusRow(id: ProjectTab, delta: -1 | 1): void {
  const row = list.value?.querySelector<HTMLElement>(`[data-tab-order-row="${id}"]`);
  const same = row?.querySelector<HTMLButtonElement>(`[data-dir="${delta}"]`);
  const other = row?.querySelector<HTMLButtonElement>(`[data-dir="${-delta}"]`);
  (same && !same.disabled ? same : other)?.focus();
}

function move(id: ProjectTab, delta: -1 | 1): void {
  emit('move', id, delta);
  void nextTick(() => refocusRow(id, delta));
}

/** 恢复默认后按钮自己变禁用会丢焦点：落到首行的「下移」上，焦点不掉出浮层。 */
function reset(): void {
  emit('reset');
  void nextTick(() => list.value?.querySelector<HTMLButtonElement>('[data-dir="1"]')?.focus());
}
</script>

<template>
  <TodoToolPopover label="自定义页签顺序" test-id="project-tab-order">
    <template #icon>
      <AppIcon name="more" :size="16" />
    </template>

    <p class="tab-order__hint">拖动页签或在这里上下调整，自动保存为你在本项目的个人布局。</p>
    <ol ref="list" class="tab-order__list">
      <li
        v-for="(tab, index) in props.tabs"
        :key="tab.id"
        class="tab-order__row"
        :data-tab-order-row="tab.id"
      >
        <span class="tab-order__label">{{ tab.label }}</span>
        <button
          class="tab-order__btn"
          type="button"
          data-dir="-1"
          :aria-label="`上移${tab.label}`"
          :title="`上移${tab.label}`"
          :disabled="index === 0"
          @click="move(tab.id, -1)"
        >
          <AppIcon name="arrow-down" :size="14" class="tab-order__up" />
        </button>
        <button
          class="tab-order__btn"
          type="button"
          data-dir="1"
          :aria-label="`下移${tab.label}`"
          :title="`下移${tab.label}`"
          :disabled="index === props.tabs.length - 1"
          @click="move(tab.id, 1)"
        >
          <AppIcon name="arrow-down" :size="14" />
        </button>
      </li>
    </ol>
    <button
      class="tab-order__reset"
      type="button"
      data-testid="project-tab-order-reset"
      :disabled="props.isDefaultOrder"
      @click="reset"
    >
      恢复默认顺序
    </button>
  </TodoToolPopover>
</template>

<style scoped>
.tab-order__hint {
  margin: 0;
  color: var(--muted);
  font-size: var(--fs-meta);
  line-height: var(--lh-body);
}
.tab-order__list {
  display: flex;
  margin: 0;
  padding: 0;
  flex-direction: column;
  gap: var(--px-2);
  list-style: none;
}
.tab-order__row {
  display: grid;
  min-height: var(--px-30);
  grid-template-columns: minmax(0, 1fr) auto auto;
  align-items: center;
  gap: var(--px-4);
  padding: 0 var(--px-6);
  border-radius: var(--r-sm);
}
.tab-order__row:hover {
  background: var(--sunken);
}
.tab-order__label {
  min-width: 0;
  overflow: hidden;
  color: var(--ink);
  font-size: var(--fs-200);
  text-overflow: ellipsis;
  white-space: nowrap;
}
.tab-order__btn {
  display: inline-grid;
  width: var(--px-24);
  height: var(--px-24);
  place-items: center;
  padding: 0;
  border: var(--bw) solid transparent;
  border-radius: var(--r-sm);
  color: var(--muted2);
  background: transparent;
  cursor: pointer;
  transition:
    color var(--dur-1) var(--ease-out),
    background-color var(--dur-1) var(--ease-out);
}
.tab-order__btn:hover:not(:disabled) {
  color: var(--ink);
  background: var(--panel);
}
.tab-order__btn:focus-visible {
  outline: none;
  box-shadow: var(--focus-ring-flat);
}
.tab-order__btn:disabled {
  cursor: default;
  opacity: 0.35;
}
/* 上移复用「向下」箭头翻转：AppIcon 映射里没有向上箭头，⛔ 不为此新增映射键或第二图标库。 */
.tab-order__up {
  transform: rotate(180deg);
}
.tab-order__reset {
  align-self: flex-start;
  height: var(--px-26);
  padding: 0 var(--px-8);
  border: 0;
  border-radius: var(--r-sm);
  color: var(--accent-text);
  background: transparent;
  font: inherit;
  font-size: var(--fs-200);
  font-weight: var(--fw-label);
  cursor: pointer;
}
.tab-order__reset:hover:not(:disabled) {
  background: var(--accent-soft);
}
.tab-order__reset:focus-visible {
  outline: none;
  box-shadow: var(--focus-ring-flat);
}
.tab-order__reset:disabled {
  color: var(--muted);
  cursor: default;
}
</style>
