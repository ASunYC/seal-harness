<script setup lang="ts">
import { computed } from 'vue';

import ReferenceIdCopy from '../ui/ReferenceIdCopy.vue';
import MilestoneFormFields from './MilestoneFormFields.vue';
import ProjectDialogShell from './ProjectDialogShell.vue';
import { PLANNING_FORM_TEXT } from './planning-form-view';
import type { MilestoneFormDraft } from './planning-form-view';
import { useProjectCollabStore } from '../../stores/projectCollab';

/**
 * 「新建里程碑 / 编辑里程碑」弹层（MIL-09）。字段与顺序逐字照原型 `editPlan27`：业务目标名称 → 目标说明
 * 与交付范围 → 计划开始 / 计划结束 → 负责人 → 说明句；编辑态底部另有「归档里程碑」（二次确认步照原型
 * `[里程碑管理·已定稿]`）。
 *
 * ⭐ 草稿与提示全在 store（`milestoneForm`）：本组件只绑定。409 / 422 时弹层留在原地、输入一个字不动。
 * ⭐ 字段区是 `MilestoneFormFields`（与里程碑草案审阅弹层共用）：负责人下拉只列在册成员；原负责人已离开项目时
 *    仍保留那一项「xxx（已离组）」，没改负责人就照常保存，下拉下方提示「负责人已离开项目，请改派」；
 *    换成一个不在项目里的人才挡「所选负责人已不在项目中。」（ADR-0040）。
 * ⚠️ 入口只对 `canManagePlanning` 摆出来（页头「新建里程碑」、展开卡「编辑里程碑」）；真正的门在服务端。
 */

const props = defineProps<{ projectId: string }>();

const store = useProjectCollabStore();

const form = computed(() => store.milestoneForm);
const editing = computed(() => form.value?.milestoneId != null);
const title = computed(() => {
  if (form.value?.confirmArchive) return '归档里程碑';
  return editing.value ? '编辑里程碑' : '新建里程碑';
});
const saving = computed(() => form.value?.saving === true);

const members = computed(() => store.detail?.members ?? []);

function onField(field: keyof MilestoneFormDraft, value: string): void {
  store.setMilestoneFormDraft({ [field]: value });
}

function close(): void {
  if (saving.value) return;
  store.closeMilestoneForm();
}

function submit(): void {
  void store.submitMilestoneForm(props.projectId);
}

function askArchive(): void {
  store.setMilestoneArchiveConfirm(true);
}

function cancelArchive(): void {
  store.setMilestoneArchiveConfirm(false);
}

function confirmArchive(): void {
  void store.confirmMilestoneArchive(props.projectId);
}
</script>

<template>
  <ProjectDialogShell v-if="form" :title="title" @close="close">
    <div class="planning-form" data-testid="milestone-form-dialog">
      <template v-if="form.confirmArchive">
        <p class="planning-form__note" data-testid="milestone-archive-confirm">
          {{ PLANNING_FORM_TEXT.milestoneArchiveConfirm }}
        </p>
      </template>
      <template v-else>
        <MilestoneFormFields
          :draft="form.draft"
          :members="members"
          :disabled="saving"
          @field="onField"
        >
          <template #owner-hint>
            <p
              v-if="store.milestoneFormOwnerHint"
              class="planning-form__ownerHint"
              data-testid="milestone-form-owner-hint"
            >
              {{ store.milestoneFormOwnerHint }}
            </p>
          </template>
        </MilestoneFormFields>
        <p class="planning-form__note">{{ PLANNING_FORM_TEXT.milestoneNote }}</p>
      </template>
      <p
        v-if="form.notice"
        class="planning-form__alert"
        role="alert"
        data-testid="milestone-form-notice"
      >
        <span>{{ form.notice.message }}</span>
        <ReferenceIdCopy
          v-if="form.notice.referenceCode"
          :reference-id="form.notice.referenceCode"
        />
      </p>
    </div>

    <template #foot>
      <template v-if="form.confirmArchive">
        <button
          class="btn btn--ghost"
          type="button"
          :disabled="saving"
          data-testid="milestone-archive-cancel"
          @click="cancelArchive"
        >
          取消
        </button>
        <button
          class="btn btn--primary btn--danger"
          type="button"
          :disabled="saving"
          data-testid="milestone-archive-submit"
          @click="confirmArchive"
        >
          {{ saving ? '归档中…' : '确认归档' }}
        </button>
      </template>
      <template v-else>
        <button
          v-if="editing"
          class="btn btn--ghost planning-form__archive"
          type="button"
          :disabled="saving"
          data-testid="milestone-form-archive"
          @click="askArchive"
        >
          归档里程碑
        </button>
        <button
          class="btn btn--ghost"
          type="button"
          :disabled="saving"
          data-testid="milestone-form-cancel"
          @click="close"
        >
          取消
        </button>
        <button
          class="btn btn--primary"
          type="button"
          :disabled="saving"
          data-testid="milestone-form-submit"
          @click="submit"
        >
          {{ saving ? '保存中…' : '保存里程碑' }}
        </button>
      </template>
    </template>
  </ProjectDialogShell>
</template>

<style scoped>
.planning-form {
  display: flex;
  flex-direction: column;
  gap: var(--sp-3);
}
.planning-form__ownerHint {
  margin: 0;
  color: var(--warn-text);
  font-size: var(--fs-200);
}
.planning-form__note {
  margin: 0;
  color: var(--muted2);
  font-size: var(--fs-200);
  line-height: var(--lh-body);
}
.planning-form__alert {
  display: flex;
  align-items: center;
  gap: var(--sp-2);
  margin: 0;
  color: var(--danger-text);
  font-size: var(--fs-meta);
}
.planning-form__archive {
  margin-right: auto;
  color: var(--danger-text);
}
</style>
