<script setup lang="ts">
import { computed } from 'vue';
import type { RequirementPageSize } from '../../stores/projectCollabState';
const props = defineProps<{
  page: number;
  pageSize: RequirementPageSize;
  total: number;
  loading: boolean;
}>();
const emit = defineEmits<{ page: [number]; size: [RequirementPageSize] }>();
const pages = computed(() => Math.max(1, Math.ceil(props.total / props.pageSize)));
function changeSize(event: Event): void {
  if (!(event.target instanceof HTMLSelectElement)) return;
  const value = Number(event.target.value);
  if (value === 5 || value === 10 || value === 20) emit('size', value);
}
</script>
<template>
  <nav class="requirement-pager" aria-label="需求列表分页" data-testid="requirement-pagination">
    <span v-if="props.loading" role="status">正在加载…</span>
    <span v-else role="status">共 {{ props.total }} 条 · 第 {{ props.page }} / {{ pages }} 页</span>
    <label
      >每页
      <select
        aria-label="每页条数"
        :value="props.pageSize"
        :disabled="props.loading"
        @change="changeSize"
      >
        <option v-for="size in [5, 10, 20]" :key="size" :value="size">{{ size }}</option>
      </select>
      条</label
    >
    <button
      class="btn btn--secondary"
      type="button"
      :disabled="props.loading || props.page <= 1"
      @click="emit('page', props.page - 1)"
    >
      上一页
    </button>
    <button
      class="btn btn--secondary"
      type="button"
      :disabled="props.loading || props.page >= pages"
      @click="emit('page', props.page + 1)"
    >
      下一页
    </button>
  </nav>
</template>
<style scoped>
.requirement-pager {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: flex-end;
  gap: var(--sp-3);
  padding: var(--sp-2);
  color: var(--muted);
  font-size: var(--fs-meta);
}
.requirement-pager select {
  color: var(--ink);
  background: var(--panel);
  border: var(--bw) solid var(--line);
  border-radius: var(--r-sm);
  padding: var(--sp-1);
}
</style>
