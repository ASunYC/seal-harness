<script setup lang="ts">
import type { RequirementIterationEditor } from './use-requirement-iteration-editor';

defineProps<{
  editor: RequirementIterationEditor;
  isNew: boolean;
  busy: boolean;
  placementLine: string;
}>();
const emit = defineEmits<{ open: []; refresh: []; select: [string] }>();
function selectIteration(event: Event): void {
  if (event.target instanceof HTMLSelectElement) emit('select', event.target.value);
}
</script>

<template>
  <div class="todo-field" data-testid="todo-iteration">
    <label class="todo-field__label" for="requirement-iteration">所属迭代</label>
    <p v-if="isNew" class="todo-field__hint">请先保存需求，再编辑安排迭代。</p>
    <template v-else>
      <span data-testid="todo-iteration-text">{{ placementLine }}</span>
      <select
        v-if="editor.editable.value"
        id="requirement-iteration"
        :value="editor.selection.value"
        @change="selectIteration"
        class="todo-field__input"
        data-testid="todo-iteration-select"
        :disabled="
          busy ||
          editor.loading.value ||
          !editor.candidate.value ||
          editor.pending.value ||
          editor.conflict.value
        "
      >
        <option value="">未排入迭代</option>
        <option
          v-if="
            editor.selection.value &&
            !editor.iterations.value.some((row) => row.id === editor.selection.value)
          "
          :value="editor.selection.value"
          disabled
        >
          当前迭代（不可选）
        </option>
        <option v-for="row in editor.iterations.value" :key="row.id" :value="row.id">
          {{ row.name }}{{ row.milestoneId === null ? '（未关联里程碑）' : ''
          }}{{ row.status === 'completed' ? '（已达成）' : '' }}
        </option>
      </select>
      <p v-if="editor.message.value" role="status">{{ editor.message.value }}</p>
      <button
        v-if="editor.editable.value"
        type="button"
        :disabled="busy || editor.pending.value || editor.loading.value"
        data-testid="todo-iteration-refresh"
        @click="emit('refresh')"
      >
        {{ editor.conflict.value ? '读取最新安排并保留选择' : '重新读取迭代' }}
      </button>
      <button
        type="button"
        class="todo-field__link"
        :disabled="busy || editor.dirty.value || editor.pending.value"
        data-testid="todo-iteration-open"
        @click="emit('open')"
      >
        在里程碑页查看
      </button>
    </template>
  </div>
</template>

<style scoped src="./ProjectTodoDialog.css"></style>
