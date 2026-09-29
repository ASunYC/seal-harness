<script setup lang="ts">
import { computed } from 'vue';

import type { SpecAssistField } from './todo-spec-assist';

/**
 * 一个规格字段下方的「助理建议」提示（ADR-0043）：
 *  - 已填入：标出这段是助理建议，给「撤销」；
 *  - 未采用的建议：只读预览 + 「用这版替换」「忽略」——已填的字段⛔ 不被静默覆盖。
 */
const props = defineProps<{
  field: SpecAssistField;
  filled: boolean;
  suggestion: string | readonly string[] | null;
}>();
const emit = defineEmits<{ undo: []; accept: []; dismiss: [] }>();

/** 验收清单的建议逐条列出；文本字段整段预览。 */
const suggestionLines = computed<readonly string[] | null>(() =>
  props.suggestion === null || typeof props.suggestion === 'string' ? null : props.suggestion,
);
</script>

<template>
  <p v-if="filled" class="spec-hint" :data-testid="`todo-spec-assist-filled-${field}`">
    <span class="spec-hint__badge">助理建议</span>
    <span class="spec-hint__text">已按建议填入，可直接修改</span>
    <button
      class="spec-hint__link"
      type="button"
      :data-testid="`todo-spec-assist-undo-${field}`"
      @click="emit('undo')"
    >
      撤销
    </button>
  </p>
  <div
    v-if="suggestion !== null"
    class="spec-hint spec-hint--offer"
    :data-testid="`todo-spec-assist-suggestion-${field}`"
  >
    <p class="spec-hint__head">
      <span class="spec-hint__badge">助理建议（未采用）</span>
      <span class="spec-hint__text">你已填写的内容保持不变</span>
    </p>
    <ul v-if="suggestionLines !== null" class="spec-hint__list">
      <li v-for="(line, index) in suggestionLines" :key="index">{{ line }}</li>
    </ul>
    <p v-else class="spec-hint__preview">{{ suggestion }}</p>
    <p class="spec-hint__actions">
      <button
        class="spec-hint__link"
        type="button"
        :data-testid="`todo-spec-assist-accept-${field}`"
        @click="emit('accept')"
      >
        用这版替换
      </button>
      <button
        class="spec-hint__link spec-hint__link--quiet"
        type="button"
        :data-testid="`todo-spec-assist-dismiss-${field}`"
        @click="emit('dismiss')"
      >
        忽略
      </button>
    </p>
  </div>
</template>

<style scoped>
.spec-hint {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: var(--sp-2);
  margin: 0;
  font-size: var(--fs-100);
  line-height: var(--lh-body);
}
.spec-hint--offer {
  flex-direction: column;
  align-items: stretch;
  padding: var(--sp-2) var(--sp-3);
  border-left: 2px solid var(--accent-line);
  border-radius: var(--r-sm);
  background: var(--sunken);
}
.spec-hint__head,
.spec-hint__actions {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: var(--sp-2);
  margin: 0;
}
.spec-hint__badge {
  padding: 0 var(--sp-2);
  border-radius: var(--r-pill);
  color: var(--accent-text);
  background: var(--accent-soft);
  font-weight: var(--fw-label);
}
.spec-hint__text {
  color: var(--muted);
}
.spec-hint__preview {
  margin: 0;
  color: var(--ink);
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
.spec-hint__list {
  margin: 0;
  padding-left: var(--sp-5);
  color: var(--ink);
}
.spec-hint__link {
  padding: 0;
  border: 0;
  color: var(--accent-text);
  background: transparent;
  font: inherit;
  cursor: pointer;
}
.spec-hint__link--quiet {
  color: var(--muted);
}
.spec-hint__link:hover {
  text-decoration: underline;
}
.spec-hint__link:focus-visible {
  outline: none;
  box-shadow: var(--focus-ring-flat);
}
</style>
