<script setup lang="ts">
import type { TodoSpecAssistError } from './use-todo-spec-assist';

/**
 * 派单表单规格区顶部的「让助理补全」一行（测试提单 2541，ADR-0043）。
 *
 * 只管呈现与两个意图（生成 / 取消）；可用条件、请求与回填都由对话框决定。
 * ⚠️ 按钮刻意用次级样式：底栏的主按钮是「保存」，这里再摆一个主按钮会让「点哪个才算存」
 *    变得不确定——测试里也按 `.btn--primary` 找保存。
 */
defineProps<{
  /** 为 true 时按钮置灰；`hint` 说明为什么。 */
  disabled: boolean;
  hint: string | null;
  generating: boolean;
  error: TodoSpecAssistError | null;
}>();
const emit = defineEmits<{ run: []; cancel: [] }>();
</script>

<template>
  <div class="spec-assist" data-testid="todo-spec-assist">
    <div class="spec-assist__row">
      <button
        class="btn btn--secondary spec-assist__run"
        type="button"
        data-testid="todo-spec-assist-run"
        :disabled="disabled || generating"
        :aria-describedby="hint ? 'todo-spec-assist-hint' : undefined"
        @click="emit('run')"
      >
        让助理补全
      </button>
      <template v-if="generating">
        <span class="spec-assist__status" role="status" data-testid="todo-spec-assist-status">
          <span class="spec-assist__spinner" aria-hidden="true"></span>
          助理正在补全目标、验收清单和注意事项…
        </span>
        <button
          class="btn btn--ghost spec-assist__cancel"
          type="button"
          data-testid="todo-spec-assist-cancel"
          @click="emit('cancel')"
        >
          取消
        </button>
      </template>
      <span
        v-else-if="hint"
        id="todo-spec-assist-hint"
        class="spec-assist__hint"
        data-testid="todo-spec-assist-hint"
      >
        {{ hint }}
      </span>
      <span v-else class="spec-assist__hint"
        >按标题补全目标、验收清单和注意事项，填入后仍可修改</span
      >
    </div>
    <p v-if="error" class="spec-assist__error" role="alert" data-testid="todo-spec-assist-error">
      {{ error.message }}
      <span v-if="error.referenceCode" class="spec-assist__ref">{{ error.referenceCode }}</span>
    </p>
  </div>
</template>

<style scoped>
.spec-assist {
  display: flex;
  flex-direction: column;
  gap: var(--sp-2);
  padding: var(--sp-3);
  border: var(--bw) dashed var(--accent-line);
  border-radius: var(--r-md);
  background: color-mix(in srgb, var(--accent-soft) 45%, transparent);
}
.spec-assist__row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--sp-3);
}
.spec-assist__run {
  flex: none;
}
.spec-assist__hint,
.spec-assist__status {
  color: var(--muted);
  font-size: var(--fs-100);
  line-height: var(--lh-body);
}
.spec-assist__status {
  display: inline-flex;
  align-items: center;
  gap: var(--sp-2);
  color: var(--accent-text);
}
.spec-assist__spinner {
  width: 10px;
  height: 10px;
  border: 2px solid var(--accent-line);
  border-top-color: var(--accent-text);
  border-radius: var(--r-pill);
  animation: spec-assist-spin 0.9s linear infinite;
}
@media (prefers-reduced-motion: reduce) {
  .spec-assist__spinner {
    animation: none;
  }
}
@keyframes spec-assist-spin {
  to {
    transform: rotate(360deg);
  }
}
.spec-assist__error {
  margin: 0;
  color: var(--danger-text);
  font-size: var(--fs-100);
  line-height: var(--lh-body);
}
.spec-assist__ref {
  margin-left: var(--sp-2);
  color: var(--muted);
  font-family: var(--font-mono);
}
</style>
