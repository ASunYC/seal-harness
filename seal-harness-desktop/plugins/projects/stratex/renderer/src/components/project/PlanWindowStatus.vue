<script setup lang="ts">
import ReferenceIdCopy from '../ui/ReferenceIdCopy.vue';
import type { ProjectCollabNotice } from '../../stores/projectCollabErrors';

/**
 * 日历 / 时间轴按时间段取数的状态行（CORE-08，ADR-0042）：取数失败给可重试的报错条，条目超过取数上限给注明。
 *
 * ⛔ 失败不画成「这一段没有排期」：报错条优先于任何空态；⛔ 截断不静默：只要停在了上限就明说。
 * 加载中不出字（视图网格自己挂 `aria-busy`）。
 */
defineProps<{
  error: ProjectCollabNotice | null;
  truncated: boolean;
}>();
const emit = defineEmits<{ retry: [] }>();
</script>

<template>
  <div
    v-if="error"
    class="plan-window-status plan-window-status--error"
    role="alert"
    data-testid="plan-window-error"
  >
    <span>{{ error.message }}</span>
    <ReferenceIdCopy v-if="error.referenceCode" :reference-id="error.referenceCode" />
    <button
      class="btn btn--secondary"
      type="button"
      data-testid="plan-window-retry"
      @click="emit('retry')"
    >
      重试
    </button>
  </div>
  <p
    v-else-if="truncated"
    class="plan-window-status"
    role="status"
    data-testid="plan-window-truncated"
  >
    这一段的条目过多，只显示了其中一部分。
  </p>
</template>

<style scoped>
.plan-window-status {
  margin: 0;
  color: var(--muted);
  font-size: var(--fs-100);
}
.plan-window-status--error {
  display: flex;
  align-items: center;
  gap: var(--px-8);
  padding: var(--px-8) var(--px-10);
  border: var(--bw) solid var(--danger-line);
  border-radius: var(--r-sm);
  color: var(--danger-text);
  background: var(--danger-soft);
}
</style>
