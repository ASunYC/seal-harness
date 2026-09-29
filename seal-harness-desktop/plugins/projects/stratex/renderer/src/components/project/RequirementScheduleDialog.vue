<script setup lang="ts">
import { computed } from 'vue';

import type { ProjectRequirementPlacementItem } from '@shared/protocol/project-planning-schedule.js';

import ReferenceIdCopy from '../ui/ReferenceIdCopy.vue';
import ProjectDialogShell from './ProjectDialogShell.vue';
import { PLANNING_FORM_TEXT, scheduleRoundLabel, scheduleRowHint } from './planning-form-view';
import { shortRequirementId } from './project-planning-view';
import { useProjectCollabStore } from '../../stores/projectCollab';

/**
 * 「安排里程碑需求」弹层（MIL-09）。结构与文案逐字照原型 `arrangeRequirementsM1`：说明句 →（本里程碑还没有
 * 迭代计划时的提示）→ 每条需求一行：编号 + 标题、下拉（「不排」+ 本里程碑各轮迭代，已达成的标「（已达成）」）、
 * 就地提示（「已排在『…』」/「将从『…』移出」）→ 取消 / 保存安排。
 *
 * ⭐ 一次「保存安排」只发**一条**整批请求（ADR-0038），⛔ 不逐条关联 / 移出；没有改动直接关弹层。
 * ⭐ 候选只来自服务端现状（看得见的活需求），⛔ 不从本地待办列表拼——隐藏需求不会出现在这里。
 * ⭐ 选择放 store（`requirementScheduleDialog.selections`，只记改过的行）：冲突刷新候选之后选择原样保留。
 */

const props = defineProps<{ projectId: string }>();

const store = useProjectCollabStore();

const dialog = computed(() => store.requirementScheduleDialog);
const saving = computed(() => dialog.value?.saving === true);
const placements = computed(() => store.requirementPlacements);

/** 本里程碑下的轮次（未归档的，列表缓存；按创建先后，同原型下拉的次序）。 */
const rounds = computed(() => {
  const milestoneId = dialog.value?.milestoneId;
  if (!milestoneId) return [];
  return [...(store.milestoneIterations[milestoneId] ?? [])]
    .filter((row) => row.archivedAt === null)
    .sort(
      (left, right) =>
        left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id),
    );
});

function selectionOf(item: ProjectRequirementPlacementItem): string {
  return store.requirementScheduleSelectionFor(item);
}

function hintOf(item: ProjectRequirementPlacementItem) {
  return scheduleRowHint(item, dialog.value?.milestoneId ?? '', selectionOf(item));
}

function onSelect(item: ProjectRequirementPlacementItem, event: Event): void {
  store.selectRequirementSchedule(item.requirementId, (event.target as HTMLSelectElement).value);
}

function close(): void {
  if (saving.value) return;
  store.closeRequirementScheduleDialog();
}

function save(): void {
  void store.saveRequirementSchedule(props.projectId);
}
</script>

<template>
  <ProjectDialogShell
    v-if="dialog"
    :title="PLANNING_FORM_TEXT.scheduleTitle"
    size="wide"
    @close="close"
  >
    <div class="schedule-dialog" data-testid="requirement-schedule-dialog">
      <p class="schedule-dialog__intro">{{ PLANNING_FORM_TEXT.scheduleIntro }}</p>
      <p
        v-if="rounds.length === 0"
        class="schedule-dialog__subline"
        data-testid="requirement-schedule-no-rounds"
      >
        {{ PLANNING_FORM_TEXT.scheduleNoRounds }}
      </p>

      <p
        v-if="placements.loading && placements.items.length === 0"
        class="schedule-dialog__subline"
        role="status"
      >
        正在加载需求…
      </p>
      <p
        v-else-if="placements.error && placements.items.length === 0"
        class="schedule-dialog__alert"
        role="alert"
        data-testid="requirement-schedule-load-error"
      >
        <span>{{ placements.error.message }}</span>
        <ReferenceIdCopy
          v-if="placements.error.referenceCode"
          :reference-id="placements.error.referenceCode"
        />
      </p>
      <p
        v-else-if="placements.items.length === 0"
        class="schedule-dialog__subline"
        data-testid="requirement-schedule-empty"
      >
        {{ PLANNING_FORM_TEXT.scheduleEmpty }}
      </p>
      <ul v-else class="schedule-dialog__list" data-testid="requirement-schedule-list">
        <li
          v-for="item in placements.items"
          :key="item.requirementId"
          class="schedule-dialog__row"
          :data-requirement-row="item.requirementId"
        >
          <label class="schedule-dialog__title" :for="`schedule-${item.requirementId}`">
            <code>{{ shortRequirementId(item.requirementId) }}</code>
            {{ item.title }}
          </label>
          <select
            :id="`schedule-${item.requirementId}`"
            class="schedule-dialog__select"
            :value="selectionOf(item)"
            :disabled="saving"
            :data-testid="`requirement-schedule-select-${item.requirementId}`"
            @change="onSelect(item, $event)"
          >
            <option value="">{{ PLANNING_FORM_TEXT.scheduleNotScheduled }}</option>
            <option v-for="round in rounds" :key="round.id" :value="round.id">
              {{ scheduleRoundLabel(round) }}
            </option>
          </select>
          <small
            class="schedule-dialog__hint"
            :class="{ 'is-moving': hintOf(item).moving }"
            aria-live="polite"
            :data-testid="`requirement-schedule-hint-${item.requirementId}`"
          >
            {{ hintOf(item).text }}
          </small>
        </li>
      </ul>
      <p v-if="placements.items.length < placements.total" class="schedule-dialog__subline">
        共 {{ placements.total }} 条需求，仅列出前 {{ placements.items.length }} 条。
      </p>

      <p
        v-if="dialog.notice"
        class="schedule-dialog__alert"
        role="alert"
        data-testid="requirement-schedule-notice"
      >
        <span>{{ dialog.notice.message }}</span>
        <ReferenceIdCopy
          v-if="dialog.notice.referenceCode"
          :reference-id="dialog.notice.referenceCode"
        />
      </p>
    </div>

    <template #foot>
      <button
        class="btn btn--ghost"
        type="button"
        :disabled="saving"
        data-testid="requirement-schedule-cancel"
        @click="close"
      >
        取消
      </button>
      <button
        class="btn btn--primary"
        type="button"
        :disabled="saving || placements.loading"
        data-testid="requirement-schedule-save"
        @click="save"
      >
        {{ saving ? '保存中…' : '保存安排' }}
      </button>
    </template>
  </ProjectDialogShell>
</template>

<style scoped>
.schedule-dialog {
  display: flex;
  flex-direction: column;
  gap: var(--sp-3);
}
.schedule-dialog__intro {
  margin: 0;
  color: var(--muted);
  font-size: var(--fs-meta);
  line-height: var(--lh-body);
}
.schedule-dialog__subline {
  margin: 0;
  color: var(--muted2);
  font-size: var(--fs-200);
}
.schedule-dialog__list {
  display: flex;
  max-height: min(52vh, 480px);
  flex-direction: column;
  margin: 0;
  padding: 0;
  overflow: auto;
  list-style: none;
}
.schedule-dialog__row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(160px, 220px);
  align-items: center;
  gap: var(--sp-1) var(--sp-3);
  padding: var(--sp-2) 0;
  border-bottom: var(--bw) solid var(--line);
}
.schedule-dialog__row:last-child {
  border-bottom: 0;
}
.schedule-dialog__title {
  min-width: 0;
  color: var(--ink);
  font-size: var(--fs-meta);
  line-height: 1.5;
  overflow-wrap: anywhere;
}
.schedule-dialog__title code {
  margin-right: var(--sp-1);
  color: var(--muted2);
}
.schedule-dialog__select {
  min-width: 0;
  padding: var(--sp-1) var(--sp-2);
  border: var(--bw) solid var(--line);
  border-radius: var(--r-md);
  color: var(--ink);
  background: var(--sunken);
  font: inherit;
  font-size: var(--fs-meta);
}
.schedule-dialog__select:focus-visible {
  border-color: var(--accent);
  outline: none;
  box-shadow: var(--focus-ring-flat);
}
/* 提示占满整行（原型 `.schedule-hint-m1{grid-column:1/-1}`）；将移出时换警示色。 */
.schedule-dialog__hint {
  grid-column: 1 / -1;
  color: var(--muted2);
  font-size: var(--fs-200);
  line-height: 1.5;
}
.schedule-dialog__hint:empty {
  display: none;
}
.schedule-dialog__hint.is-moving {
  color: var(--warn-text);
}
.schedule-dialog__alert {
  display: flex;
  align-items: center;
  gap: var(--sp-2);
  margin: 0;
  color: var(--danger-text);
  font-size: var(--fs-meta);
}
</style>
