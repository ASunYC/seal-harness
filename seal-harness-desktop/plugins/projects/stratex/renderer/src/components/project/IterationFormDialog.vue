<script setup lang="ts">
import { computed, ref } from 'vue';

import ReferenceIdCopy from '../ui/ReferenceIdCopy.vue';
import IterationFormFields from './IterationFormFields.vue';
import ProjectDialogShell from './ProjectDialogShell.vue';
import {
  PLANNING_FORM_TEXT,
  requirementCheckHint,
  type IterationFormDraft,
} from './planning-form-view';
import { shortRequirementId } from './project-planning-view';
import type { ProjectCollabNotice } from '../../stores/projectCollabErrors';
import { useProjectCollabStore } from '../../stores/projectCollab';

/**
 * 「添加迭代计划 / 编辑迭代计划」弹层（MIL-09）。字段逐字照原型 `editMilestone27` 覆盖层：迭代计划名称 →
 * 计划达成日期 / 负责人 → 完成标准（每行一条）→ 关联本里程碑需求（从项目需求中选；已排在别处的就地提示）；
 * 编辑态底部「归档此迭代计划」（二次确认）。
 *
 * ⭐ 关联需求的保存走**安排需求整批写**（ADR-0038），⛔ 不逐条关联 / 移出；候选只来自服务端现状（看得见的
 *    活需求），⛔ 不从本地待办列表拼。
 * ⭐ 草稿全在 store（`iterationForm`）：409 时弹层留在原地、输入与勾选一个不丢。
 * ⭐ 名称 / 达成日期 / 负责人 / 完成标准是 `IterationFormFields`（与迭代计划草案审阅弹层共用，负责人只列在册成员）。
 */

const props = defineProps<{ projectId: string }>();

const store = useProjectCollabStore();

const form = computed(() => store.iterationForm);
const editing = computed(() => form.value?.iterationId != null);
const saving = computed(() => form.value?.saving === true || archiving.value);
const title = computed(() => {
  if (form.value?.confirmArchive) return '归档迭代计划';
  return editing.value ? '编辑迭代计划' : '添加迭代计划';
});

const members = computed(() => store.detail?.members ?? []);

const candidates = computed(() => store.requirementPlacements.items);
const checked = computed(() => new Set(form.value?.draft.requirementIds ?? []));

function hintFor(requirementId: string) {
  const item = candidates.value.find((row) => row.requirementId === requirementId);
  if (!item || !form.value) return { text: '', moving: false };
  return requirementCheckHint(
    item,
    form.value.milestoneId,
    form.value.iterationId,
    checked.value.has(requirementId),
  );
}

function onField(field: Exclude<keyof IterationFormDraft, 'requirementIds'>, value: string): void {
  store.setIterationFormDraft({ [field]: value });
}

function onCheck(requirementId: string, event: Event): void {
  store.toggleIterationFormRequirement(requirementId, (event.target as HTMLInputElement).checked);
}

function close(): void {
  if (saving.value) return;
  store.closeIterationForm();
}

function submit(): void {
  void store.submitIterationForm(props.projectId);
}

/* 归档（二次确认）：归档动作与详情弹层共用 store 那一处；提示就地显示在确认步。 */
const archiving = ref(false);
const archiveNotice = ref<ProjectCollabNotice | null>(null);

function askArchive(): void {
  archiveNotice.value = null;
  store.setIterationArchiveConfirm(true);
}

function cancelArchive(): void {
  archiveNotice.value = null;
  store.setIterationArchiveConfirm(false);
}

async function confirmArchive(): Promise<void> {
  const current = form.value;
  if (!current || current.iterationId === null || archiving.value) return;
  const row = (store.milestoneIterations[current.milestoneId] ?? []).find(
    (item) => item.id === current.iterationId,
  );
  if (!row) return;
  archiving.value = true;
  try {
    const result = await store.confirmIterationArchive({
      projectId: props.projectId,
      milestoneId: current.milestoneId,
      iteration: row,
    });
    if (result.outcome !== 'ok') archiveNotice.value = result.notice;
  } finally {
    archiving.value = false;
  }
}
</script>

<template>
  <ProjectDialogShell v-if="form" :title="title" size="wide" @close="close">
    <div class="planning-form" data-testid="iteration-form-dialog">
      <template v-if="form.confirmArchive">
        <p class="planning-form__note" data-testid="iteration-archive-confirm">
          {{ PLANNING_FORM_TEXT.iterationArchiveConfirm }}
        </p>
        <p
          v-if="archiveNotice"
          class="planning-form__alert"
          role="alert"
          data-testid="iteration-archive-notice"
        >
          <span>{{ archiveNotice.message }}</span>
          <ReferenceIdCopy
            v-if="archiveNotice.referenceCode"
            :reference-id="archiveNotice.referenceCode"
          />
        </p>
      </template>
      <template v-else>
        <IterationFormFields
          :draft="form.draft"
          :members="members"
          :disabled="saving"
          @field="onField"
        >
          <template #owner-hint>
            <p
              v-if="store.iterationFormOwnerHint"
              class="planning-form__ownerHint"
              data-testid="iteration-form-owner-hint"
            >
              {{ store.iterationFormOwnerHint }}
            </p>
          </template>
        </IterationFormFields>
        <fieldset
          class="planning-form__field planning-form__refs"
          data-testid="iteration-form-requirements"
        >
          <legend class="planning-form__label">关联本里程碑需求</legend>
          <p class="planning-form__note">{{ PLANNING_FORM_TEXT.iterationRequirementsNote }}</p>
          <p
            v-if="store.requirementPlacements.loading && candidates.length === 0"
            class="planning-form__note"
            role="status"
          >
            正在加载需求…
          </p>
          <p
            v-else-if="store.requirementPlacements.error && candidates.length === 0"
            class="planning-form__alert"
            role="alert"
          >
            {{ store.requirementPlacements.error.message }}
          </p>
          <p v-else-if="candidates.length === 0" class="planning-form__note">
            {{ PLANNING_FORM_TEXT.scheduleEmpty }}
          </p>
          <ul v-else class="planning-form__checks">
            <li v-for="item in candidates" :key="item.requirementId">
              <label class="planning-form__check">
                <input
                  type="checkbox"
                  :checked="checked.has(item.requirementId)"
                  :disabled="saving"
                  :data-testid="`iteration-form-requirement-${item.requirementId}`"
                  @change="onCheck(item.requirementId, $event)"
                />
                <span class="planning-form__checkText">
                  <code>{{ shortRequirementId(item.requirementId) }}</code>
                  {{ item.title }}
                  <small
                    v-if="hintFor(item.requirementId).text"
                    class="planning-form__hint"
                    :class="{ 'is-moving': hintFor(item.requirementId).moving }"
                    aria-live="polite"
                    :data-testid="`iteration-form-requirement-hint-${item.requirementId}`"
                  >
                    {{ hintFor(item.requirementId).text }}
                  </small>
                </span>
              </label>
            </li>
          </ul>
        </fieldset>
        <p
          v-if="form.notice"
          class="planning-form__alert"
          role="alert"
          data-testid="iteration-form-notice"
        >
          <span>{{ form.notice.message }}</span>
          <ReferenceIdCopy
            v-if="form.notice.referenceCode"
            :reference-id="form.notice.referenceCode"
          />
        </p>
      </template>
    </div>

    <template #foot>
      <template v-if="form.confirmArchive">
        <button
          class="btn btn--ghost"
          type="button"
          :disabled="saving"
          data-testid="iteration-archive-cancel"
          @click="cancelArchive"
        >
          取消
        </button>
        <button
          class="btn btn--primary btn--danger"
          type="button"
          :disabled="saving"
          data-testid="iteration-archive-submit"
          @click="confirmArchive"
        >
          {{ archiving ? '归档中…' : '确认归档' }}
        </button>
      </template>
      <template v-else>
        <button
          v-if="editing"
          class="btn btn--ghost planning-form__archive"
          type="button"
          :disabled="saving"
          data-testid="iteration-form-archive"
          @click="askArchive"
        >
          归档此迭代计划
        </button>
        <button
          class="btn btn--ghost"
          type="button"
          :disabled="saving"
          data-testid="iteration-form-cancel"
          @click="close"
        >
          取消
        </button>
        <button
          class="btn btn--primary"
          type="button"
          :disabled="saving"
          data-testid="iteration-form-submit"
          @click="submit"
        >
          {{ form.saving ? '保存中…' : '保存迭代计划' }}
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
.planning-form__field {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: var(--sp-1);
}
.planning-form__refs {
  margin: 0;
  padding: 0;
  border: 0;
}
.planning-form__label {
  padding: 0;
  color: var(--muted);
  font-size: var(--fs-meta);
}
.planning-form__checks {
  display: flex;
  max-height: 240px;
  flex-direction: column;
  gap: var(--sp-1);
  margin: 0;
  padding: 0;
  overflow: auto;
  list-style: none;
}
/* 勾选框固定尺寸、文字列占满（原型这一格曾把勾选框拉成整行宽，文字挤成 13px——这里不照抄那个缺陷）。 */
.planning-form__check {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  align-items: start;
  gap: var(--sp-2);
  padding: var(--sp-1) var(--sp-2);
  border-radius: var(--r-sm);
  font-size: var(--fs-meta);
  cursor: pointer;
}
.planning-form__check:hover {
  background: var(--sunken);
}
.planning-form__check input {
  margin-top: 3px;
}
.planning-form__checkText {
  min-width: 0;
  color: var(--ink);
  line-height: 1.5;
  overflow-wrap: anywhere;
}
.planning-form__checkText code {
  margin-right: var(--sp-1);
  color: var(--muted2);
}
.planning-form__ownerHint {
  margin: 0;
  color: var(--warn-text);
  font-size: var(--fs-200);
}
.planning-form__hint {
  display: block;
  color: var(--muted2);
  font-size: var(--fs-200);
}
.planning-form__hint.is-moving {
  color: var(--warn-text);
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
