<script setup lang="ts">
import { PROJECT_TODO_PLAN_DATE_TEXT } from '@shared/protocol/project-collab-plan-dates.js';

defineProps<{ startWithoutDue: boolean; invalidDateRange: boolean }>();
const startDate = defineModel<string>('startDate', { required: true });
const dueDate = defineModel<string>('dueDate', { required: true });
</script>

<template>
  <div class="todo-grid" data-testid="todo-plan-dates">
    <label class="todo-field">
      <span class="todo-field__label">计划开始时间</span>
      <input
        v-model="startDate"
        class="todo-field__input"
        type="date"
        data-testid="todo-start-date"
        :max="dueDate || undefined"
      />
    </label>
    <label class="todo-field">
      <span class="todo-field__label">计划完成时间</span>
      <input
        v-model="dueDate"
        class="todo-field__input"
        type="date"
        data-testid="todo-due-date"
        :min="startDate || undefined"
      />
      <span
        v-if="startWithoutDue"
        class="todo-field__hint"
        role="alert"
        data-testid="todo-date-pair-hint"
        >{{ PROJECT_TODO_PLAN_DATE_TEXT.startRequiresDue }}</span
      >
      <span v-else-if="invalidDateRange" class="todo-field__hint" role="alert">{{
        PROJECT_TODO_PLAN_DATE_TEXT.dateOrder
      }}</span>
    </label>
  </div>
</template>

<style scoped src="./ProjectTodoDialog.css"></style>
