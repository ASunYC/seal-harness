<script setup lang="ts">
import type { ProjectMember } from '@shared/protocol/project-collab.js';
import {
  PROJECT_MILESTONE_MAX_NAME_LENGTH,
  PROJECT_MILESTONE_MAX_OBJECTIVE_LENGTH,
} from '@shared/protocol/project-planning.js';

import PlanningOwnerSelect from './PlanningOwnerSelect.vue';
import type { MilestoneFormDraft } from './planning-form-view';

/**
 * 里程碑表单的字段区（无状态）：业务目标名称 → 目标说明与交付范围 → 计划开始 / 计划结束 → 负责人。
 *
 * 「新建 / 编辑里程碑」弹层（MIL-09）与项目助理里程碑草案审阅弹层（mil-11）共用这一份：字段、顺序、上限、
 * 负责人下拉逐字一致。值只经表单控件显示，⛔ 不渲染 HTML（草案内容来自模型，按纯文本对待）。
 * ⚠️ 根是 `display: contents` 的包层：字段照旧是外层 `.planning-form` 纵向排布的直接子项。
 */

withDefaults(
  defineProps<{
    draft: MilestoneFormDraft;
    members: readonly ProjectMember[];
    disabled: boolean;
    testidPrefix?: string;
  }>(),
  { testidPrefix: 'milestone-form' },
);

const emit = defineEmits<{ field: [field: keyof MilestoneFormDraft, value: string] }>();

function onInput(field: keyof MilestoneFormDraft, event: Event): void {
  emit('field', field, (event.target as HTMLInputElement | HTMLTextAreaElement).value);
}
</script>

<template>
  <div class="planning-fields">
    <label class="planning-form__field">
      <span class="planning-form__label">业务目标名称</span>
      <input
        class="planning-form__input"
        :value="draft.name"
        :maxlength="PROJECT_MILESTONE_MAX_NAME_LENGTH"
        :disabled="disabled"
        :data-testid="`${testidPrefix}-name`"
        @input="onInput('name', $event)"
      />
    </label>
    <label class="planning-form__field">
      <span class="planning-form__label">目标说明与交付范围</span>
      <textarea
        class="planning-form__textarea"
        rows="4"
        :value="draft.objectiveMd"
        :maxlength="PROJECT_MILESTONE_MAX_OBJECTIVE_LENGTH"
        :disabled="disabled"
        :data-testid="`${testidPrefix}-objective`"
        @input="onInput('objectiveMd', $event)"
      ></textarea>
    </label>
    <div class="planning-form__grid">
      <label class="planning-form__field">
        <span class="planning-form__label">计划开始</span>
        <input
          class="planning-form__input"
          type="date"
          :value="draft.startAt"
          :disabled="disabled"
          :data-testid="`${testidPrefix}-start`"
          @input="onInput('startAt', $event)"
        />
      </label>
      <label class="planning-form__field">
        <span class="planning-form__label">计划结束</span>
        <input
          class="planning-form__input"
          type="date"
          :value="draft.dueAt"
          :disabled="disabled"
          :data-testid="`${testidPrefix}-due`"
          @input="onInput('dueAt', $event)"
        />
      </label>
    </div>
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
    <slot name="owner-hint" />
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
