<script setup lang="ts">
import { computed } from 'vue';

import {
  PROJECT_TODO_ACCEPTANCE_TEXT_MAX_LENGTH,
  PROJECT_TODO_MAX_ACCEPTANCE_ITEMS,
} from '@shared/protocol/project-collab.js';

/**
 * 验收清单的**正文编辑器**（「怎么算做完」逐条可勾的那份规格）。
 *
 * 只管一件事：一组判据正文的增删改。勾选、自述、验收结论都不在这里——那些是
 * 工作单详情弹层的事，此处只负责把「做完的标准」写下来。
 *
 * ⚠️ 空判据不算判据（契约层 `trim` 后非空即拒），所以留空的行在提交前由调用方
 * 剔掉；这里不代替用户删，只在计数上如实反映。
 */
const props = defineProps<{
  /** 判据正文数组（受控）。 */
  items: readonly string[];
  /** 只读（待验收中的单不许改判据：验收方正对着这份清单逐条核对）。 */
  disabled?: boolean;
}>();
const emit = defineEmits<{ 'update:items': [readonly string[]] }>();

const canAdd = computed(
  () => props.disabled !== true && props.items.length < PROJECT_TODO_MAX_ACCEPTANCE_ITEMS,
);

/** 有几条**写了字**的判据——这一条判「是不是工作单」，空行不算。 */
const filledCount = computed(() => props.items.filter((text) => text.trim().length > 0).length);

function updateAt(index: number, value: string): void {
  emit(
    'update:items',
    props.items.map((text, position) => (position === index ? value : text)),
  );
}

function removeAt(index: number): void {
  emit(
    'update:items',
    props.items.filter((_text, position) => position !== index),
  );
}

function append(): void {
  if (!canAdd.value) return;
  emit('update:items', [...props.items, '']);
}

function onInput(index: number, event: Event): void {
  updateAt(index, (event.target as HTMLInputElement).value);
}
</script>

<template>
  <div class="acc-edit" data-testid="acceptance-editor">
    <ol v-if="items.length > 0" class="acc-edit__list">
      <li v-for="(text, index) in items" :key="index" class="acc-edit__row">
        <input
          class="acc-edit__input"
          type="text"
          data-testid="acceptance-item-input"
          :value="text"
          :disabled="disabled"
          :maxlength="PROJECT_TODO_ACCEPTANCE_TEXT_MAX_LENGTH"
          :aria-label="`验收判据第 ${index + 1} 条`"
          placeholder="一条可以逐条核对的判据"
          @input="onInput(index, $event)"
        />
        <button
          v-if="!disabled"
          class="acc-edit__drop"
          type="button"
          data-testid="acceptance-item-remove"
          :aria-label="`删除验收判据第 ${index + 1} 条`"
          @click="removeAt(index)"
        >
          ×
        </button>
      </li>
    </ol>
    <p v-else class="acc-edit__empty" data-testid="acceptance-empty">
      没有验收判据——这条按普通待办处理，完成与否由处理人自己标。
    </p>
    <div class="acc-edit__foot">
      <button
        v-if="canAdd"
        class="acc-edit__add"
        type="button"
        data-testid="acceptance-add"
        @click="append"
      >
        添加一条判据
      </button>
      <span class="acc-edit__count tnum" data-testid="acceptance-count"
        >{{ filledCount }} / {{ PROJECT_TODO_MAX_ACCEPTANCE_ITEMS }}</span
      >
    </div>
  </div>
</template>

<style scoped>
.acc-edit {
  display: flex;
  flex-direction: column;
  gap: var(--sp-2);
}
.acc-edit__list {
  display: flex;
  flex-direction: column;
  gap: var(--sp-2);
  margin: 0;
  padding: 0 0 0 var(--sp-4);
  list-style: decimal;
}
.acc-edit__row {
  display: flex;
  align-items: center;
  gap: var(--sp-2);
  color: var(--muted);
}
.acc-edit__input {
  min-width: 0;
  height: var(--ctl-h);
  flex: 1;
  padding: 0 var(--sp-3);
  border: var(--bw) solid var(--line);
  border-radius: var(--r-md);
  color: var(--ink);
  background: var(--sunken);
  font: inherit;
  font-size: var(--fs-meta);
}
.acc-edit__input:focus {
  border-color: var(--accent);
  outline: none;
  box-shadow: 0 0 0 3px var(--accent-soft);
}
.acc-edit__input:disabled {
  color: var(--muted);
  cursor: not-allowed;
  opacity: 0.7;
}
.acc-edit__drop {
  padding: 0 var(--sp-1);
  border: 0;
  color: var(--muted);
  background: transparent;
  font-size: var(--fs-body);
  line-height: 1;
  cursor: pointer;
  transition: color var(--dur-1) var(--ease-out);
}
.acc-edit__drop:hover {
  color: var(--danger-text);
}
.acc-edit__empty {
  margin: 0;
  color: var(--muted);
  font-size: var(--fs-100);
  line-height: var(--lh-body);
}
.acc-edit__foot {
  display: flex;
  align-items: center;
  gap: var(--sp-3);
}
.acc-edit__add {
  padding: var(--sp-1) var(--sp-2);
  border: var(--bw) dashed var(--line-strong);
  border-radius: var(--r-sm);
  color: var(--muted2);
  background: transparent;
  font-size: var(--fs-100);
  cursor: pointer;
  transition:
    border-color var(--dur-1) var(--ease-out),
    color var(--dur-1) var(--ease-out);
}
.acc-edit__add:hover {
  border-color: var(--accent);
  color: var(--accent-text);
}
.acc-edit__count {
  margin-left: auto;
  color: var(--muted);
  font-size: var(--fs-100);
}
@media (prefers-reduced-motion: reduce) {
  .acc-edit__input,
  .acc-edit__drop,
  .acc-edit__add {
    transition: none;
  }
}
</style>
