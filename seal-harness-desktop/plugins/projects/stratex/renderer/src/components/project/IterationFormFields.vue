<script setup lang="ts">
import type { ProjectMember } from '@shared/protocol/project-collab.js';
import {
  PROJECT_ITERATION_MAX_CRITERIA_LENGTH,
  PROJECT_ITERATION_MAX_NAME_LENGTH,
} from '@shared/protocol/project-planning.js';

import PlanningOwnerSelect from './PlanningOwnerSelect.vue';
import type { IterationFormDraft } from './planning-form-view';

/**
 * 迭代计划表单的字段区（无状态）：迭代计划名称 → 计划达成日期 / 负责人 → 完成标准（每行一条）。
 *
 * 「添加 / 编辑迭代计划」弹层（MIL-09）与项目助理迭代计划草案审阅弹层（mil-11）共用这一份。
 * 「关联本里程碑需求」不在这里：它只属于手工弹层（排需求不在草案范围内）。
 * 值只经表单控件显示，⛔ 不渲染 HTML。根是 `display: contents` 的包层。
 */

type IterationTextField = Exclude<keyof IterationFormDraft, 'requirementIds'>;

withDefaults(
  defineProps<{
    draft: IterationFormDraft;
    members: readonly ProjectMember[];
    disabled: boolean;
    testidPrefix?: string;
  }>(),
  { testidPrefix: 'iteration-form' },
);

const emit = defineEmits<{ field: [field: IterationTextField, value: string] }>();

function onInput(field: IterationTextField, event: Event): void {
  emit('field', field, (event.target as HTMLInputElement | HTMLTextAreaElement).value);
}
</script>

<template>
  <div class="planning-fields">
    <label class="planning-form__field">
      <span class="planning-form__label">迭代计划名称</span>
      <input
        class="planning-form__input"
        :value="draft.name"
        :maxlength="PROJECT_ITERATION_MAX_NAME_LENGTH"
        :disabled="disabled"
        :data-testid="`${testidPrefix}-name`"
        @input="onInput('name', $event)"
      />
    </label>
    <div class="planning-form__grid">
      <label class="planning-form__field">
        <span class="planning-form__label">计划达成日期</span>
        <input
          class="planning-form__input"
          type="date"
          :value="draft.dueAt"
          :disabled="disabled"
          :data-testid="`${testidPrefix}-due`"
          @input="onInput('dueAt', $event)"
        />
      </label>
      <label class="planning-form__field">
        <span class="planning-form__label">负责人</span>
        <PlanningOwnerSelect
          class="planning-form__input"
          :model-value="draft.ownerSubject"
          :members="members"
          :disabled="disabled"
          :data-testid="`${testidPrefix}-owner`"
          @update:model-value="emit('field', 'ownerSubject', $event)"
        />
      </label>
    </div>
    <slot name="owner-hint" />
    <label class="planning-form__field">
      <span class="planning-form__label">完成标准（每行一条）</span>
      <textarea
        class="planning-form__textarea"
        rows="4"
        :value="draft.criteriaText"
        :maxlength="PROJECT_ITERATION_MAX_CRITERIA_LENGTH"
        :disabled="disabled"
        :data-testid="`${testidPrefix}-criteria`"
        @input="onInput('criteriaText', $event)"
      ></textarea>
    </label>
  </div>
</template>

<style scoped>
.planning-fields {
  display: contents;
}
.planning-form__grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: var(--sp-3);
}
.planning-form__field {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: var(--sp-1);
}
.planning-form__label {
  padding: 0;
  color: var(--muted);
  font-size: var(--fs-meta);
}
.planning-form__input,
.planning-form__textarea {
  min-width: 0;
  padding: var(--sp-2) var(--sp-3);
  border: var(--bw) solid var(--line);
  border-radius: var(--r-md);
  color: var(--ink);
  background: var(--sunken);
  font: inherit;
  font-size: var(--fs-meta);
  line-height: 1.6;
}
.planning-form__textarea {
  resize: vertical;
}
.planning-form__input:focus,
.planning-form__textarea:focus {
  border-color: var(--accent);
  outline: none;
  box-shadow: var(--focus-ring-flat);
}
</style>
