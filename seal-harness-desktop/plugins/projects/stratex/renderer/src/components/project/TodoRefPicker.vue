<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue';

import OverlaySurface from '../ui/overlay/OverlaySurface.vue';
import type { OverlayCloseReason } from '../ui/overlay/overlayStack.js';

/**
 * 「关联材料」的选择器：触发按钮 + 锚定浮层里的可搜索列表。
 *
 * ## 为什么不用原生 `<select>`
 *
 * 主窗是无边框窗口，原生下拉在页面内绘制，被对话框边界裁掉、滚轮也滚不动——项目资产一多
 * （十几份需求书加安装包）就选不到后面的项（2026-09-08 现场）。这里改走 Overlay 原语：
 * 非模态锚定浮层，列表自己滚，点外 / Esc 关，还焦回触发按钮。
 *
 * ## 套在模态对话框里的两条硬要求（本组件只在 ProjectTodoDialog 内用）
 *
 * 两条都漏过一次，表现完全不同、但都只在真机可见——组件测试不注入 scoped 样式，
 * 所以这两类回归在 vitest 里必然全绿，别拿"测试通过"当它们的证据：
 *
 * 1. **`z-layer="modal-child"`**：`popover` 形态默认落在 `dropdown` 档，低于 `modal`，
 *    浮层会被对话框压在下面、只露出底下半截。仓库里另外两处模态内浮层同样显式传它。
 * 2. **面板自己收回 `pointer-events: auto`**：见下方 `.refpick__panel` 的注释。
 *
 * ## 键盘
 *
 * 搜索框里 ↑↓ 移动高亮、Enter 选中、Esc 交给原语关闭；列表项本身是按钮，Tab 也能到。
 * 选中即 emit `select(token)` 并关闭；候选、上限、禁用条件由调用方决定，这里不碰业务。
 */
export interface TodoRefPickerOption {
  readonly token: string;
  readonly kindLabel: string;
  readonly name: string;
}

const props = defineProps<{
  options: readonly TodoRefPickerOption[];
  disabled?: boolean;
  /** 触发按钮上的占位文案（候选为空时调用方给「暂无可关联」那句）。 */
  placeholder: string;
  testId: string;
}>();
const emit = defineEmits<{ select: [token: string] }>();

const trigger = ref<HTMLButtonElement | null>(null);
const searchInput = ref<HTMLInputElement | null>(null);
const isOpen = ref(false);
const query = ref('');
const activeIndex = ref(0);
const returnFocus = ref<HTMLElement | false>(false);

const filtered = computed(() => {
  const needle = query.value.trim().toLowerCase();
  if (!needle) return props.options;
  return props.options.filter(
    (option) =>
      option.name.toLowerCase().includes(needle) || option.kindLabel.toLowerCase().includes(needle),
  );
});

watch(filtered, () => {
  activeIndex.value = 0;
});

function open(): void {
  if (props.disabled || isOpen.value) return;
  query.value = '';
  activeIndex.value = 0;
  returnFocus.value = trigger.value ?? false;
  isOpen.value = true;
  void nextTick(() => searchInput.value?.focus());
}

function close(restoreFocus: boolean): void {
  if (!isOpen.value) return;
  returnFocus.value = restoreFocus ? (trigger.value ?? false) : false;
  isOpen.value = false;
}

function onSurfaceClose(event: { reason: OverlayCloseReason }): void {
  close(event.reason === 'esc');
}

function choose(token: string): void {
  emit('select', token);
  close(true);
}

function onSearchKeydown(event: KeyboardEvent): void {
  const total = filtered.value.length;
  if (event.key === 'ArrowDown' && total > 0) {
    event.preventDefault();
    activeIndex.value = (activeIndex.value + 1) % total;
    return;
  }
  if (event.key === 'ArrowUp' && total > 0) {
    event.preventDefault();
    activeIndex.value = (activeIndex.value - 1 + total) % total;
    return;
  }
  if (event.key === 'Enter') {
    event.preventDefault();
    const option = filtered.value[activeIndex.value];
    if (option) choose(option.token);
  }
}
</script>

<template>
  <div class="refpick">
    <button
      ref="trigger"
      class="refpick__trigger"
      type="button"
      aria-haspopup="dialog"
      :aria-expanded="isOpen"
      :disabled="props.disabled"
      :data-testid="`${props.testId}-trigger`"
      @click="open"
    >
      <span class="refpick__placeholder">{{ props.placeholder }}</span>
      <span class="refpick__caret" aria-hidden="true">▾</span>
    </button>
    <!-- 非模态锚定浮层：列表自己滚（max-height），不受对话框边界裁切。 -->
    <OverlaySurface
      :open="isOpen"
      variant="popover"
      z-layer="modal-child"
      semantics="dialog"
      :chrome="false"
      :anchor="trigger"
      placement="bottom-start"
      :return-focus="returnFocus"
      label="选择关联材料"
      @close="onSurfaceClose"
    >
      <div class="refpick__panel" :data-testid="`${props.testId}-panel`">
        <input
          ref="searchInput"
          v-model="query"
          class="refpick__search"
          type="text"
          placeholder="搜索资产或待办…"
          aria-label="搜索关联材料"
          :data-testid="`${props.testId}-search`"
          @keydown="onSearchKeydown"
        />
        <ul class="refpick__list" role="listbox" aria-label="关联材料候选">
          <li v-if="filtered.length === 0" class="refpick__empty">没有匹配的资产或待办</li>
          <li
            v-for="(option, index) in filtered"
            :key="option.token"
            role="option"
            :aria-selected="index === activeIndex"
          >
            <button
              class="refpick__option"
              :class="{ 'is-active': index === activeIndex }"
              type="button"
              :data-testid="`${props.testId}-option`"
              :data-token="option.token"
              @mouseenter="activeIndex = index"
              @click="choose(option.token)"
            >
              <span class="refpick__kind">{{ option.kindLabel }}</span>
              <span class="refpick__name">{{ option.name }}</span>
            </button>
          </li>
        </ul>
      </div>
    </OverlaySurface>
  </div>
</template>

<style scoped>
.refpick {
  position: relative;
  display: block;
}
/* 触发件长得和表单里其它输入件一样，只是多一个下拉指示 */
.refpick__trigger {
  display: flex;
  width: 100%;
  height: var(--ctl-h);
  align-items: center;
  justify-content: space-between;
  gap: var(--sp-2);
  padding: 0 var(--sp-3);
  border: var(--bw) solid var(--line);
  border-radius: var(--r-md);
  color: var(--muted);
  background: var(--sunken);
  font: inherit;
  font-size: var(--fs-meta);
  text-align: left;
  cursor: pointer;
}
.refpick__trigger:focus-visible {
  border-color: var(--accent);
  outline: none;
  box-shadow: 0 0 0 3px var(--accent-soft);
}
.refpick__trigger[aria-expanded='true'] {
  border-color: var(--accent-line);
}
.refpick__trigger:disabled {
  cursor: not-allowed;
  opacity: 0.7;
}
.refpick__placeholder {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.refpick__caret {
  flex: 0 0 auto;
  color: var(--muted);
}
.refpick__panel {
  display: flex;
  /* ⛔ 别删：bare 层的 .ovl__panel 是 pointer-events: none（外观与交互都交回内容），
     而 pointer-events 会继承，所以面板不显式收回 auto 的话，点击会穿透到下面、被
     浮层自己的「点外即关」判定接住——表现是弹出来立刻又关掉，看着像点不开
     （2026-09-08 现场 preview.3133）。⚠️ 单测挡不住这条：组件测试不注入 scoped 样式。 */
  pointer-events: auto;
  width: min(360px, 90vw);
  flex-direction: column;
  gap: var(--sp-2);
  padding: var(--sp-2);
  border: var(--bw) solid var(--line-strong);
  border-radius: var(--r-md);
  background: var(--panel);
  box-shadow: var(--sh-2);
}
.refpick__search {
  height: var(--ctl-h);
  padding: 0 var(--sp-3);
  border: var(--bw) solid var(--line);
  border-radius: var(--r-md);
  color: var(--ink);
  background: var(--sunken);
  font: inherit;
  font-size: var(--fs-meta);
}
.refpick__search:focus {
  border-color: var(--accent);
  outline: none;
  box-shadow: 0 0 0 3px var(--accent-soft);
}
/* 列表自己滚：这正是原生下拉在无边框窗口里做不到的那件事 */
.refpick__list {
  max-height: 260px;
  overflow: auto;
  margin: 0;
  padding: 0;
  list-style: none;
}
.refpick__option {
  display: flex;
  width: 100%;
  align-items: center;
  gap: var(--sp-2);
  padding: var(--sp-2) var(--sp-3);
  border: 0;
  border-radius: var(--r-sm);
  background: transparent;
  font: inherit;
  text-align: left;
  cursor: pointer;
  transition: background-color var(--dur-1) var(--ease-out);
}
.refpick__option:hover,
.refpick__option.is-active {
  background: var(--accent-soft);
}
.refpick__kind {
  flex: 0 0 auto;
  padding: 0 var(--sp-1);
  border: var(--bw) solid var(--line);
  border-radius: var(--r-sm);
  color: var(--muted);
  font-size: var(--fs-100);
}
.refpick__name {
  overflow: hidden;
  color: var(--ink);
  font-size: var(--fs-meta);
  text-overflow: ellipsis;
  white-space: nowrap;
}
.refpick__empty {
  padding: var(--sp-2) var(--sp-3);
  color: var(--muted);
  font-size: var(--fs-meta);
}
</style>
