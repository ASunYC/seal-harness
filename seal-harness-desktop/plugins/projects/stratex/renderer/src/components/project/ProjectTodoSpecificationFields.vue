<script setup lang="ts">
import {
  PROJECT_TODO_MAX_DESCRIPTION_LENGTH,
  PROJECT_TODO_MAX_CONSTRAINTS_LENGTH,
} from '@shared/protocol/project-collab.js';
import TodoAcceptanceEditor from './TodoAcceptanceEditor.vue';
import TodoSpecAssistFieldHint from './TodoSpecAssistFieldHint.vue';
import { TODO_ACCEPTANCE_FROZEN_HINT, TODO_ACCEPTANCE_RESET_HINT } from './project-format';
import type { useTodoSpecAssistFill } from './use-todo-spec-assist-fill';

defineProps<{
  acceptanceLoading: boolean;
  acceptanceFrozen: boolean;
  showAcceptanceReset: boolean;
  specAssistFill: ReturnType<typeof useTodoSpecAssistFill>;
}>();
const description = defineModel<string>('description', { required: true });
const constraintsText = defineModel<string>('constraintsText', { required: true });
const acceptanceItems = defineModel<readonly string[]>('acceptanceItems', { required: true });
</script>

<template>
  <label class="todo-field">
    <span class="todo-field__label">描述</span>
    <textarea
      v-model="description"
      class="todo-field__input todo-field__textarea"
      rows="4"
      data-testid="todo-description"
      :maxlength="PROJECT_TODO_MAX_DESCRIPTION_LENGTH"
      placeholder="补充背景与验收口径（可留空）"
    ></textarea>
  </label>
  <TodoSpecAssistFieldHint
    field="description"
    :filled="specAssistFill.isFilled('description')"
    :suggestion="specAssistFill.suggestionFor('description')"
    @undo="specAssistFill.undo('description')"
    @accept="specAssistFill.accept('description')"
    @dismiss="specAssistFill.dismiss('description')"
  />

  <!-- 工作单面：验收清单定义「怎么算做完」，注意事项定义「不许动什么」。
         两项都不填就是一条普通待办，行为与从前逐字一致 -->
  <div class="todo-field" data-testid="todo-acceptance">
    <span class="todo-field__label">怎么算做完</span>
    <p v-if="acceptanceLoading" class="todo-field__hint" data-testid="todo-acceptance-loading">
      正在取这张单的验收判据…
    </p>
    <TodoAcceptanceEditor
      v-else
      :items="acceptanceItems"
      :disabled="acceptanceFrozen"
      @update:items="acceptanceItems = $event"
    />
    <span v-if="acceptanceFrozen" class="todo-field__hint" data-testid="todo-acceptance-frozen">{{
      TODO_ACCEPTANCE_FROZEN_HINT
    }}</span>
    <span
      v-else-if="showAcceptanceReset"
      class="todo-field__hint todo-field__hint--warn"
      data-testid="todo-acceptance-reset"
      >{{ TODO_ACCEPTANCE_RESET_HINT }}</span
    >
    <TodoSpecAssistFieldHint
      field="acceptanceItems"
      :filled="specAssistFill.isFilled('acceptanceItems')"
      :suggestion="specAssistFill.suggestionFor('acceptanceItems')"
      @undo="specAssistFill.undo('acceptanceItems')"
      @accept="specAssistFill.accept('acceptanceItems')"
      @dismiss="specAssistFill.dismiss('acceptanceItems')"
    />
  </div>

  <label class="todo-field">
    <span class="todo-field__label">注意事项</span>
    <textarea
      v-model="constraintsText"
      class="todo-field__input todo-field__textarea"
      rows="3"
      data-testid="todo-constraints"
      :maxlength="PROJECT_TODO_MAX_CONSTRAINTS_LENGTH"
      placeholder="边界与坑：不许动什么、必须遵守什么（可留空）"
    ></textarea>
  </label>
  <TodoSpecAssistFieldHint
    field="constraintsText"
    :filled="specAssistFill.isFilled('constraintsText')"
    :suggestion="specAssistFill.suggestionFor('constraintsText')"
    @undo="specAssistFill.undo('constraintsText')"
    @accept="specAssistFill.accept('constraintsText')"
    @dismiss="specAssistFill.dismiss('constraintsText')"
  />
</template>

<style scoped src="./ProjectTodoDialog.css"></style>
