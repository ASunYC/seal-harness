<script setup lang="ts">
import { computed } from 'vue';

import ReferenceIdCopy from '../ui/ReferenceIdCopy.vue';
import IterationFormFields from './IterationFormFields.vue';
import MilestoneFormFields from './MilestoneFormFields.vue';
import ProjectDialogShell from './ProjectDialogShell.vue';
import {
  PLANNING_FORM_TEXT,
  type IterationFormDraft,
  type MilestoneFormDraft,
} from './planning-form-view';
import { useProjectCollabStore } from '../../stores/projectCollab';
import {
  PLANNING_DRAFT_TEXT,
  useProjectPlanningDraftsStore,
} from '../../stores/projectPlanningDrafts';

/**
 * 项目助理规划草案的审阅弹层（mil-11，ADR-0045）：「确认里程碑草案」/「确认迭代计划草案」。
 *
 * ⭐ 字段区就是手工新建那一份（`MilestoneFormFields` / `IterationFormFields`），负责人下拉只列在册成员；
 *    迭代计划草案不含「关联本里程碑需求」（排需求不在草案范围）。
 * ⭐ 草案内容来自模型，一律按纯文本走：表单控件的值与插值，⛔ 不渲染 HTML、不按 markdown 排版。
 * ⭐ 确认提交的是表单**当前值**（store 的 `confirmReview`，与手工新建同一条通道）；409 / 422 时弹层与输入原样保留。
 * ⚠️ 非管理者照常能看：字段与「确认新建」禁用，旁边说清只有管理者和拥有者能调整。
 *    本项目详情还没取到时同样不给确认（点了必错），但不说「没有权限」——那句只在确知角色不够时出现。
 */

const props = defineProps<{ projectId: string }>();

const collab = useProjectCollabStore();
const drafts = useProjectPlanningDraftsStore();

const review = computed(() => drafts.review);
const draft = computed(() => drafts.reviewDraft);
const saving = computed(() => review.value?.saving === true);

const detailReady = computed(
  () => collab.activeProjectId === props.projectId && collab.detail !== null,
);
const canConfirm = computed(() => detailReady.value && collab.canManagePlanning);
const readOnly = computed(() => detailReady.value && !collab.canManagePlanning);
const members = computed(() => (detailReady.value ? (collab.detail?.members ?? []) : []));
/** 详情取失败时确认钮是灰的，得说清为什么，⛔ 不留一个无解释的禁用态。 */
const detailNotice = computed(() =>
  collab.activeProjectId === props.projectId ? collab.detailError : null,
);

const title = computed(() =>
  draft.value?.kind === 'iteration'
    ? PLANNING_DRAFT_TEXT.iterationReviewTitle
    : PLANNING_DRAFT_TEXT.milestoneReviewTitle,
);

function onMilestoneField(field: keyof MilestoneFormDraft, value: string): void {
  drafts.setMilestoneField(field, value);
}

function onIterationField(
  field: Exclude<keyof IterationFormDraft, 'requirementIds'>,
  value: string,
): void {
  drafts.setIterationField(field, value);
}

function close(): void {
  drafts.closeReview();
}

function submit(): void {
  void drafts.confirmReview();
}
</script>

<template>
  <ProjectDialogShell v-if="review && draft" :title="title" @close="close">
    <div
      class="planning-form"
      data-testid="planning-draft-review-dialog"
      :data-draft-kind="draft.kind"
    >
      <p class="planning-form__note">{{ PLANNING_DRAFT_TEXT.reviewNote }}</p>
      <p
        v-if="draft.kind === 'iteration'"
        class="planning-draft__parent"
        data-testid="planning-draft-parent-milestone"
      >
        <span class="planning-draft__parentLabel">{{ PLANNING_DRAFT_TEXT.parentMilestone }}</span>
        <span class="planning-draft__parentName">{{ draft.milestoneName }}</span>
      </p>
      <MilestoneFormFields
        v-if="review.milestone"
        :draft="review.milestone"
        :members="members"
        :disabled="saving || !canConfirm"
        testid-prefix="planning-draft-milestone"
        @field="onMilestoneField"
      />
      <IterationFormFields
        v-else-if="review.iteration"
        :draft="review.iteration"
        :members="members"
        :disabled="saving || !canConfirm"
        testid-prefix="planning-draft-iteration"
        @field="onIterationField"
      />
      <p
        v-if="review.notice"
        class="planning-form__alert"
        role="alert"
        data-testid="planning-draft-notice"
      >
        <span>{{ review.notice.message }}</span>
        <ReferenceIdCopy
          v-if="review.notice.referenceCode"
          :reference-id="review.notice.referenceCode"
        />
      </p>
      <p
        v-else-if="detailNotice"
        class="planning-form__alert"
        role="alert"
        data-testid="planning-draft-detail-notice"
      >
        <span>{{ detailNotice.message }}</span>
        <ReferenceIdCopy
          v-if="detailNotice.referenceCode"
          :reference-id="detailNotice.referenceCode"
        />
      </p>
    </div>

    <template #foot>
      <p v-if="readOnly" class="planning-draft__readOnly" data-testid="planning-draft-readonly">
        {{ PLANNING_FORM_TEXT.readOnly }}
      </p>
      <button
        class="btn btn--ghost"
        type="button"
        :disabled="saving"
        data-testid="planning-draft-cancel"
        @click="close"
      >
        取消
      </button>
      <button
        class="btn btn--primary"
        type="button"
        :disabled="saving || !canConfirm"
        data-testid="planning-draft-confirm"
        @click="submit"
      >
        {{ saving ? PLANNING_DRAFT_TEXT.confirming : PLANNING_DRAFT_TEXT.confirm }}
      </button>
    </template>
  </ProjectDialogShell>
</template>

<style scoped>
.planning-form {
  display: flex;
  flex-direction: column;
  gap: var(--sp-3);
}
.planning-form__note {
  margin: 0;
  color: var(--muted2);
  font-size: var(--fs-200);
  line-height: var(--lh-body);
}
/* 放不下一行就让参考编号另起一行：「只有管理者和拥有者…」这句较长，挤在同一行会把编号从中间折断。 */
.planning-form__alert {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--sp-1) var(--sp-2);
  margin: 0;
  color: var(--danger-text);
  font-size: var(--fs-meta);
}
.planning-draft__parent {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: var(--sp-1);
  margin: 0;
}
.planning-draft__parentLabel {
  color: var(--muted);
  font-size: var(--fs-meta);
}
.planning-draft__parentName {
  color: var(--ink);
  font-size: var(--fs-meta);
  line-height: 1.6;
  overflow-wrap: anywhere;
}
/* 与底栏按钮同一行、靠左：说的就是右边那颗灰掉的「确认新建」。 */
.planning-draft__readOnly {
  min-width: 0;
  margin: 0 auto 0 0;
  color: var(--muted2);
  font-size: var(--fs-200);
  line-height: var(--lh-body);
}
</style>
