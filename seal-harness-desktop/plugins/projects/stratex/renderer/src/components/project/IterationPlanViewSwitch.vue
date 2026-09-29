<script setup lang="ts">
import { ITERATION_PLAN_VIEW_OPTIONS, type IterationPlanView } from './iteration-schedule-view';

/**
 * 迭代计划视图切换组（MIL-06）：看板 / 列表 / 甘特图（顺序与文案逐字对齐原型 `:2691`）。
 *
 * 只负责呈现与发出选择；**先写偏好、写成功才切**的判定在 store 的 `selectIterationPlanView`。
 */

defineProps<{ milestoneId: string; modelValue: IterationPlanView }>();
const emit = defineEmits<{ select: [view: IterationPlanView] }>();
</script>

<template>
  <div class="plan-views" role="group" aria-label="迭代计划视图">
    <button
      v-for="option in ITERATION_PLAN_VIEW_OPTIONS"
      :key="option.value"
      type="button"
      class="plan-views__button"
      :class="{ 'is-active': modelValue === option.value }"
      :aria-pressed="modelValue === option.value"
      :data-testid="`iteration-view-${option.value}-${milestoneId}`"
      @click="emit('select', option.value)"
    >
      {{ option.label }}
    </button>
  </div>
</template>

<style scoped>
.plan-views {
  display: inline-flex;
  padding: var(--px-2);
  border: var(--bw) solid var(--line);
  border-radius: var(--r-sm);
  background: var(--sunken);
}
.plan-views__button {
  padding: var(--px-4) var(--px-10);
  border: 0;
  border-radius: var(--r-sm);
  color: var(--muted2);
  background: transparent;
  font: inherit;
  font-size: var(--fs-200);
  cursor: pointer;
  transition:
    background-color var(--dur-1) var(--ease-out),
    color var(--dur-1) var(--ease-out);
}
.plan-views__button:hover {
  color: var(--ink);
}
.plan-views__button:focus-visible {
  outline: none;
  box-shadow: var(--focus-ring-flat);
}
.plan-views__button.is-active {
  color: var(--ink);
  background: var(--panel);
  font-weight: var(--fw-label);
}
</style>
