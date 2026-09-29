<script setup lang="ts">
import type { Todo, TodoItemKind } from '@shared/protocol/project-collab.js';
import { TODO_NO_REQUIREMENT_HINT } from './project-format';
import type { useTodoParentSearch } from './useTodoParentSearch';

defineProps<{
  parentSearch: ReturnType<typeof useTodoParentSearch>;
  parentOptions: readonly Todo[];
  parentMissing: boolean;
  itemKind: TodoItemKind;
}>();
const keyword = defineModel<string>('keyword', { required: true });
const kind = defineModel<TodoItemKind>('kind', { required: true });
const parentId = defineModel<string>({ required: true });
</script>

<template>
  <!-- 父项只表达层级，不参与推断需求/任务种类。 -->
  <div class="todo-field" data-testid="todo-parent">
    <span class="todo-field__label">父项</span>
    <input
      v-model="keyword"
      class="todo-field__input"
      aria-label="搜索父项"
      placeholder="搜索父项标题"
      maxlength="200"
      data-testid="todo-parent-search"
    />
    <select
      v-if="itemKind === 'task'"
      v-model="kind"
      class="todo-field__input"
      aria-label="父项种类"
      data-testid="todo-parent-kind"
    >
      <option value="requirement">需求</option>
      <option value="task">任务</option>
    </select>
    <p v-if="parentSearch.loading.value" role="status">正在读取父项…</p>
    <p v-if="parentSearch.error.value" role="alert">
      {{ parentSearch.error.value }}
      <button type="button" class="btn btn--ghost" @click="parentSearch.load()">重新搜索</button>
    </p>
    <p v-if="parentSearch.selectedError.value" role="alert">
      {{ parentSearch.selectedError.value }}
      <button type="button" class="btn btn--ghost" @click="parentSearch.loadSelected()">
        重试当前父项
      </button>
    </p>
    <p v-if="parentMissing" class="todo-field__hint" data-testid="todo-parent-missing">
      {{ TODO_NO_REQUIREMENT_HINT }}
    </p>
    <select
      v-model="parentId"
      class="todo-field__input"
      data-testid="todo-parent-select"
      aria-label="父项"
    >
      <option
        v-if="parentId && !parentOptions.some((candidate) => candidate.id === parentId)"
        :value="parentId"
        disabled
      >
        当前父项（正在读取或不可用）
      </option>
      <option v-if="itemKind === 'requirement'" value="">不挂靠（顶层需求）</option>
      <option v-else-if="parentId === ''" value="">选一个父项…</option>
      <option v-for="candidate in parentOptions" :key="candidate.id" :value="candidate.id">
        {{ candidate.title }}
      </option>
    </select>
    <div v-if="parentSearch.page.value > 1 || parentSearch.hasNext.value">
      <button
        type="button"
        class="btn btn--ghost"
        :disabled="parentSearch.loading.value || parentSearch.page.value <= 1"
        @click="parentSearch.load(parentSearch.page.value - 1)"
      >
        上一页
      </button>
      <span>第 {{ parentSearch.page.value }} 页</span>
      <button
        type="button"
        class="btn btn--ghost"
        data-testid="todo-parent-next"
        :disabled="parentSearch.loading.value || !parentSearch.hasNext.value"
        @click="parentSearch.load(parentSearch.page.value + 1)"
      >
        下一页
      </button>
    </div>
  </div>
</template>

<style scoped src="./ProjectTodoDialog.css"></style>
