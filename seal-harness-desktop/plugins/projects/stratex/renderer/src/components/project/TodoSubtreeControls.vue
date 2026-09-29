<script setup lang="ts">
import type { RequirementSubtreeState } from '../../stores/projectCollabState';
const props = defineProps<{ state?: RequirementSubtreeState | undefined }>();
const emit = defineEmits<{ retry: []; more: [] }>();
</script>
<template>
  <div class="todo-subtree-state" data-testid="todo-subtree-state">
    <span v-if="props.state?.loading" role="status">正在加载子项…</span>
    <template v-else-if="props.state?.error">
      <span role="alert">{{ props.state.error.message }}</span>
      <button type="button" @click="emit('retry')">重试加载子项</button>
    </template>
    <button
      v-else-if="props.state?.hasMore"
      type="button"
      data-testid="todo-subtree-more"
      @click="emit('more')"
    >
      继续加载子项
    </button>
  </div>
</template>
<style scoped>
.todo-subtree-state {
  display: flex;
  flex-wrap: wrap;
  gap: var(--sp-2);
  white-space: normal;
}
.todo-subtree-state button {
  color: var(--accent-text);
  background: transparent;
  border: var(--bw) solid var(--line);
  border-radius: var(--r-sm);
  padding: var(--sp-1) var(--sp-2);
}
</style>
