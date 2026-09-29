<script setup lang="ts">
import { computed, onMounted, watch } from 'vue';

import { PROJECT_MAX_REFS } from '@shared/protocol/project-collab.js';
import type {
  ProjectIterationListItem,
  ProjectIterationRequirement,
} from '@shared/protocol/project-planning.js';
import {
  PROJECT_PLANNING_LIFECYCLE_REASON_MAX_LENGTH,
  planningLifecycleRequiredStatus,
  projectPlanningLifecycleServerCodeText,
} from '@shared/protocol/project-planning-lifecycle.js';

import ReferenceIdCopy from '../ui/ReferenceIdCopy.vue';
import ProjectDialogShell from './ProjectDialogShell.vue';
import TodoRefPicker from './TodoRefPicker.vue';
import {
  GOAL_LIFECYCLE_COPY,
  GOAL_TEXT,
  goalReopenSubline,
  goalRoundLine,
} from './planning-goal-view';
import {
  latestAcceptanceRecord,
  PLANNING_EVIDENCE_HINT,
  PLANNING_EVIDENCE_LABEL,
  PLANNING_EVIDENCE_LINK_COPY,
  PLANNING_LIFECYCLE_CONFIRM_LABEL,
  PLANNING_LIFECYCLE_COPY,
  PLANNING_LIFECYCLE_SCOPE_NOTE,
  planningEvidenceLabel,
  planningEvidenceLinkAddition,
  planningEvidenceOptions,
} from './planning-lifecycle-view';
import { appendRef, removeRef } from './project-refs';
import {
  livePlanningRow,
  PLANNING_CRITERIA_MISSING_TEXT,
} from '../../stores/projectCollabPlanningLifecycle';
import type { PlanningLifecycleSubject } from '../../stores/projectCollabState';
import { useProjectCollabStore } from '../../stores/projectCollab';

/**
 * 「记录达成 / 重新打开」弹层（MIL-07 · C2），迭代计划与业务目标共用这一份。
 *
 * - 迭代计划：结构与文案逐字照原型 `milestoneTransition27`（:2657-2660）：名称 → 完成标准（为空时提示先补
 *   标准）→ 记录输入 → 核对勾选（仅达成）→ 范围说明 → 失败提示 → 确认 / 取消。
 * - 业务目标（MIL-07 界面段，原型 `[业务目标达成·已定稿 2026-09-13]` `completeGoalG1` / `reopenGoalG1`）：
 *   记录达成＝名称 → 目标说明 →「各轮迭代达成情况」→ 验收说明 → 证据引用 → 范围说明；重新打开＝名称 →
 *   「已于 … 记录达成。」→ 重新打开原因 → 范围说明。⛔ 没有核对勾选（原型没有）。
 *
 * ⭐ 「证据引用」一格照原型定稿层 `evidenceInnerG1`（2026-09-13）：标签 + 说明、芯片、候选、「外部链接」
 *    输入行（点「添加」或回车；回车 ⛔ 不触发弹层确认）与输入框下方的就地错误（⛔ 不弹 toast、不清输入）。
 *    ⚠️ 与原型的偏离：需求 / 资产候选沿用待办的关联材料选择器（`TodoRefPicker`），原型是「＃ 引用需求、
 *    任务或资产」展开的列表。重新打开不需要证据（服务端非必填），⛔ 所以重开弹层不摆这一格。
 *
 * ⭐ 草稿全在 store（`planningLifecycleDraft`）：本组件只绑定。422 / 409 时弹层留在原地、
 *    输入一个字不动；冲突刷新列表只换活行，⛔ 不卸掉本弹层。
 * ⭐ 入口只对 `canManagePlanning`（manager+）可点：迭代列表勾选钮对非管理者渲染成 disabled（照原型
 *    `:2680`），迭代详情工具条与业务目标头部入口只对管理者显示。本组件被打开即说明入口已过那道收窄，
 *    真正的门在服务端。
 */

const props = defineProps<{ projectId: string }>();

const store = useProjectCollabStore();

const draft = computed(() => store.planningLifecycleDraft);
const subject = computed<PlanningLifecycleSubject | null>(() => draft.value?.subject ?? null);
const isGoal = computed(() => subject.value?.kind === 'milestone');
/** 活行优先（冲突刷新后读到新版本与现状），列表里没有时退回打开时的快照。 */
const row = computed(() => (subject.value ? livePlanningRow(store, subject.value) : null));
const iterationRow = computed(() => {
  const current = subject.value;
  return current?.kind === 'iteration' ? livePlanningRow(store, current) : null;
});
const goalRow = computed(() => {
  const current = subject.value;
  return current?.kind === 'milestone' ? livePlanningRow(store, current) : null;
});

const action = computed(() => draft.value?.action ?? 'complete');
const copy = computed(() =>
  isGoal.value ? GOAL_LIFECYCLE_COPY[action.value] : PLANNING_LIFECYCLE_COPY[action.value],
);
const scopeNote = computed(() =>
  isGoal.value ? GOAL_LIFECYCLE_COPY[action.value].scopeNote : PLANNING_LIFECYCLE_SCOPE_NOTE,
);
const isComplete = computed(() => action.value === 'complete');
const submitting = computed(() => store.planningLifecycleSubmitting);
const criteria = computed(() => iterationRow.value?.criteriaMd.trim() ?? '');
/** 完成标准为空时不许达成（原型：先编辑迭代计划补标准）。业务目标没有完成标准这一格。 */
const criteriaMissing = computed(
  () => iterationRow.value !== null && isComplete.value && criteria.value.length === 0,
);
/** 对象状态已被别人改过（活行不再是这个动作要求的状态）：不许再提交这个动作。 */
const stale = computed(
  () => row.value !== null && row.value.status !== planningLifecycleRequiredStatus(action.value),
);
/**
 * 状态已变时说清现状（冲突刷新后最常见）：否则按钮禁用了，提示却还停在「确认后可再次提交」。
 * 文案与服务端状态闸那几个码同一出处（按对象种类取）。
 */
const staleText = computed(() =>
  stale.value && subject.value
    ? projectPlanningLifecycleServerCodeText(
        `${subject.value.kind}_${isComplete.value ? 'already_completed' : 'not_completed'}`,
      )
    : null,
);

/* ── 业务目标：各轮迭代达成情况 / 上一次达成时刻 ─────────────────────────────── */

/** 本目标下未归档的迭代（列表缓存；门槛本身按服务端聚合判，这里只做呈现）。 */
const goalRounds = computed<readonly ProjectIterationListItem[]>(() =>
  goalRow.value
    ? (store.milestoneIterations[goalRow.value.id] ?? []).filter(
        (round) => round.archivedAt === null,
      )
    : [],
);
/** 今天的日历日（`YYYY-MM-DD`）：只供「已逾期」呈现，纯呈现边界读一次时钟。 */
const today = computed(() => {
  const now = new Date();
  const pad = (part: number): string => String(part).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
});
function roundSubject(round: ProjectIterationListItem): PlanningLifecycleSubject {
  return { kind: 'iteration', milestoneId: round.milestoneId, row: round };
}
const goalRoundLines = computed(() =>
  goalRounds.value.map((round) =>
    goalRoundLine(round, {
      acceptedAt:
        latestAcceptanceRecord(store.planningStageRecordsFor(roundSubject(round)), round.status)
          ?.occurredAt ?? null,
      today: today.value,
    }),
  ),
);
/** 重新打开弹层的副标题：这个目标最近一次记录达成的时刻（阶段记录没取全时不写）。 */
const goalCompletedAt = computed(() => {
  const current = subject.value;
  if (current?.kind !== 'milestone' || goalRow.value === null) return null;
  return (
    latestAcceptanceRecord(store.planningStageRecordsFor(current), goalRow.value.status)
      ?.occurredAt ?? null
  );
});

/* ── 证据引用 ─────────────────────────────────────────────────────────────── */

/** 候选里的「关联需求」：迭代计划取本轮；业务目标取名下各轮的并集（按需求去重）。 */
const linkedRequirements = computed<readonly ProjectIterationRequirement[]>(() => {
  if (iterationRow.value) return iterationRow.value.linkedRequirements;
  const seen = new Set<string>();
  const merged: ProjectIterationRequirement[] = [];
  for (const round of goalRounds.value) {
    for (const item of round.linkedRequirements) {
      if (seen.has(item.requirementId)) continue;
      seen.add(item.requirementId);
      merged.push(item);
    }
  }
  return merged;
});
const evidenceSources = computed(() => ({
  linkedRequirements: linkedRequirements.value,
  members: store.detail?.members ?? [],
  files: store.files,
  todos: store.todos,
}));
const evidenceOptions = computed(() =>
  planningEvidenceOptions({ ...evidenceSources.value, attached: draft.value?.evidenceRefs ?? [] }),
);
const evidenceChips = computed(() =>
  (draft.value?.evidenceRefs ?? []).map((token) => {
    const label = planningEvidenceLabel(token, evidenceSources.value);
    // 「类别 · 名称」：分隔符连同尾随空格放进类别文字里，读屏与复制出来的文字都是完整一句。
    const kindPrefix = label.kindLabel ? `${label.kindLabel} · ` : null;
    return { token, ...label, kindPrefix, text: `${kindPrefix ?? ''}${label.name}` };
  }),
);
const evidenceFull = computed(() => (draft.value?.evidenceRefs.length ?? 0) >= PROJECT_MAX_REFS);

// 候选要有东西可挑：资产与待办未必取过（从里程碑页直接进来时就没有）。
onMounted(() => {
  // 业务目标自己的阶段记录（重新打开的副标题要读上一次达成时刻）：展开卡通常已经在取，
  // 没有人取过、也不在途时由本弹层补取——⛔ 不指望别的组件一定先挂上。
  const current = subject.value;
  if (current?.kind === 'milestone') {
    const records = store.planningStageRecordsFor(current);
    if (!records.loaded && !records.loading) {
      void store.loadPlanningStageRecords(props.projectId, current);
    }
  }
  if (!isComplete.value) return;
  if (store.files.length === 0) void store.loadFiles(props.projectId);
  if (store.todos.length === 0) void store.loadTodos(props.projectId);
});

// 业务目标记录达成：已达成那几轮的达成时刻读它们的阶段记录（没取过才取；迭代列表后到也补）。
watch(
  goalRounds,
  (rounds) => {
    if (!isGoal.value || !isComplete.value) return;
    for (const round of rounds) {
      if (round.status !== 'completed') continue;
      const records = store.planningStageRecordsFor(roundSubject(round));
      if (!records.loaded && !records.loading) {
        void store.loadPlanningStageRecords(props.projectId, roundSubject(round));
      }
    }
  },
  { immediate: true },
);

function onReason(event: Event): void {
  store.setPlanningLifecycleDraft({ reason: (event.target as HTMLTextAreaElement).value });
}
function onConfirmed(event: Event): void {
  store.setPlanningLifecycleDraft({ confirmed: (event.target as HTMLInputElement).checked });
}
function attachEvidence(token: string): void {
  if (!draft.value || !token) return;
  store.setPlanningLifecycleDraft({ evidenceRefs: appendRef(draft.value.evidenceRefs, token) });
}
function dropEvidence(token: string): void {
  if (!draft.value) return;
  store.setPlanningLifecycleDraft({ evidenceRefs: removeRef(draft.value.evidenceRefs, token) });
}
function onLinkInput(event: Event): void {
  store.setPlanningLifecycleDraft({ linkText: (event.target as HTMLInputElement).value });
}
/** 添加外部链接：校验结果就地摆在输入框下方；成功或判为重复都清空输入与错误（原型 `addEvidenceLinkG1`）。 */
function addLink(): void {
  if (!draft.value || submitting.value) return;
  const outcome = planningEvidenceLinkAddition(draft.value.linkText, draft.value.evidenceRefs);
  store.setPlanningLifecycleDraft(
    outcome.ok
      ? { evidenceRefs: outcome.refs, linkText: '', linkError: null }
      : { linkText: outcome.text, linkError: outcome.error },
  );
}
/** 回车＝添加：⛔ 必须 preventDefault，不许冒成弹层确认；输入法组字中的回车不算。 */
function onLinkKeydown(event: KeyboardEvent): void {
  if (event.key !== 'Enter' || event.isComposing) return;
  event.preventDefault();
  addLink();
}

/** 取消：在途时不收（结果回来要落在这层上）；其余时候丢弃草稿不留痕。 */
function close(): void {
  if (submitting.value) return;
  store.closePlanningLifecycle();
}

async function submit(): Promise<void> {
  if (submitting.value || criteriaMissing.value || stale.value) return;
  // ok ⇒ store 收起草稿并出成功回执；conflict / error ⇒ 草稿与弹层原样留着。
  await store.submitPlanningLifecycle(props.projectId);
}
</script>

<template>
  <ProjectDialogShell v-if="draft && row" :title="copy.title" @close="close">
    <div class="lifecycle" data-testid="planning-lifecycle-dialog" :data-action="action">
      <h3 class="lifecycle__name">{{ row.name }}</h3>
      <!-- 业务目标：记录达成＝目标说明 + 各轮迭代达成情况；重新打开＝上一次记录达成的时刻（原型 completeGoalG1 / reopenGoalG1）。 -->
      <template v-if="goalRow">
        <p
          v-if="isComplete"
          class="lifecycle__criteria"
          data-testid="planning-lifecycle-goal-objective"
        >
          {{ goalRow.objectiveMd.trim() || GOAL_TEXT.objectiveMissing }}
        </p>
        <p
          v-else-if="goalCompletedAt"
          class="lifecycle__criteria"
          data-testid="planning-lifecycle-goal-completed-at"
        >
          {{ goalReopenSubline(goalCompletedAt) }}
        </p>
        <section
          v-if="isComplete"
          class="lifecycle__rounds"
          :aria-label="GOAL_TEXT.roundsHeading"
          data-testid="planning-lifecycle-goal-rounds"
        >
          <b class="lifecycle__roundsTitle">{{ GOAL_TEXT.roundsHeading }}</b>
          <ul class="lifecycle__roundList">
            <li
              v-for="line in goalRoundLines"
              :key="line.id"
              class="lifecycle__round"
              :data-testid="`planning-lifecycle-goal-round-${line.id}`"
            >
              <span aria-hidden="true">{{ line.mark }}</span>
              <span class="lifecycle__roundName">{{ line.name }}</span>
              <small>{{ line.detail }}</small>
            </li>
          </ul>
        </section>
      </template>
      <p
        v-else
        class="lifecycle__criteria"
        :class="{ 'is-missing': criteria.length === 0 }"
        data-testid="planning-lifecycle-criteria"
      >
        {{ criteria || PLANNING_CRITERIA_MISSING_TEXT }}
      </p>

      <label class="lifecycle__field">
        <span class="lifecycle__label">{{ copy.reasonLabel }}</span>
        <textarea
          class="lifecycle__textarea"
          rows="4"
          :value="draft.reason"
          :maxlength="PROJECT_PLANNING_LIFECYCLE_REASON_MAX_LENGTH"
          :disabled="submitting"
          data-testid="planning-lifecycle-reason"
          @input="onReason"
        ></textarea>
      </label>

      <!-- 证据引用：原型定稿层 evidenceInnerG1；需求 / 资产候选沿用待办的关联材料选择器。 -->
      <div v-if="isComplete" class="lifecycle__field" data-testid="planning-lifecycle-evidence">
        <span class="lifecycle__label">{{ PLANNING_EVIDENCE_LABEL }}</span>
        <p class="lifecycle__hint">{{ PLANNING_EVIDENCE_HINT }}</p>
        <div v-if="evidenceChips.length > 0" class="lifecycle__refs">
          <span
            v-for="chip in evidenceChips"
            :key="chip.token"
            class="lifecycle__ref"
            data-testid="planning-lifecycle-evidence-chip"
            :data-token="chip.token"
            :title="chip.href ?? undefined"
          >
            <span v-if="chip.kindPrefix" class="lifecycle__refKind">{{ chip.kindPrefix }}</span>
            <b class="lifecycle__refName">{{ chip.name }}</b>
            <button
              class="lifecycle__refDrop"
              type="button"
              :aria-label="`移除证据引用：${chip.text}`"
              :disabled="submitting"
              data-testid="planning-lifecycle-evidence-remove"
              @click="dropEvidence(chip.token)"
            >
              ×
            </button>
          </span>
        </div>
        <TodoRefPicker
          :options="evidenceOptions"
          :disabled="submitting || evidenceFull || evidenceOptions.length === 0"
          :placeholder="
            evidenceOptions.length === 0 ? '暂无可关联的需求或资产' : '关联一份需求或资产…'
          "
          test-id="planning-lifecycle-evidence-add"
          @select="attachEvidence"
        />
        <div class="lifecycle__link">
          <label class="lifecycle__label" for="planning-lifecycle-link-input">
            {{ PLANNING_EVIDENCE_LINK_COPY.label }}
          </label>
          <div class="lifecycle__linkRow">
            <input
              id="planning-lifecycle-link-input"
              class="lifecycle__linkInput"
              type="url"
              inputmode="url"
              autocomplete="off"
              :placeholder="PLANNING_EVIDENCE_LINK_COPY.placeholder"
              :value="draft.linkText"
              :disabled="submitting"
              :aria-invalid="draft.linkError ? 'true' : undefined"
              aria-describedby="planning-lifecycle-link-error"
              data-testid="planning-lifecycle-link-input"
              @input="onLinkInput"
              @keydown="onLinkKeydown"
            />
            <button
              class="btn btn--secondary lifecycle__linkAdd"
              type="button"
              :disabled="submitting"
              data-testid="planning-lifecycle-link-add"
              @click="addLink"
            >
              {{ PLANNING_EVIDENCE_LINK_COPY.add }}
            </button>
          </div>
          <p
            id="planning-lifecycle-link-error"
            class="lifecycle__linkError"
            role="alert"
            data-testid="planning-lifecycle-link-error"
          >
            {{ draft.linkError ?? '' }}
          </p>
        </div>
      </div>

      <label v-if="isComplete && !isGoal" class="lifecycle__check">
        <input
          type="checkbox"
          :checked="draft.confirmed"
          :disabled="submitting || criteriaMissing"
          data-testid="planning-lifecycle-confirmed"
          @change="onConfirmed"
        />
        {{ PLANNING_LIFECYCLE_CONFIRM_LABEL }}
      </label>

      <p class="lifecycle__note">{{ scopeNote }}</p>

      <p
        v-if="staleText"
        class="lifecycle__stale"
        role="status"
        data-testid="planning-lifecycle-stale"
      >
        {{ staleText }}
      </p>

      <p
        v-if="store.planningLifecycleNotice"
        class="lifecycle__alert"
        role="alert"
        data-testid="planning-lifecycle-notice"
      >
        <span>{{ store.planningLifecycleNotice?.message }}</span>
        <ReferenceIdCopy
          v-if="store.planningLifecycleNotice?.referenceCode"
          :reference-id="store.planningLifecycleNotice.referenceCode"
        />
      </p>
    </div>

    <template #foot>
      <button
        class="btn btn--ghost"
        type="button"
        :disabled="submitting"
        data-testid="planning-lifecycle-cancel"
        @click="close"
      >
        取消
      </button>
      <button
        class="btn btn--primary"
        type="button"
        :disabled="submitting || criteriaMissing || stale"
        data-testid="planning-lifecycle-submit"
        @click="submit"
      >
        {{ submitting ? '提交中…' : copy.submit }}
      </button>
    </template>
  </ProjectDialogShell>
</template>

<style scoped>
.lifecycle {
  display: flex;
  flex-direction: column;
  gap: var(--sp-3);
}
.lifecycle__name {
  margin: 0;
  color: var(--ink);
  font-size: var(--fs-body);
  font-weight: var(--fw-title);
  line-height: 1.5;
}
.lifecycle__criteria {
  margin: 0;
  color: var(--muted);
  font-size: var(--fs-meta);
  line-height: 1.7;
  white-space: pre-wrap;
}
.lifecycle__criteria.is-missing {
  color: var(--warn-text);
}
.lifecycle__rounds {
  padding: var(--sp-2) var(--sp-3);
  border: var(--bw) solid var(--line);
  border-radius: var(--r-md);
  background: var(--sunken);
}
.lifecycle__roundsTitle {
  display: block;
  margin-bottom: var(--sp-1);
  color: var(--muted);
  font-size: var(--fs-meta);
  font-weight: var(--fw-label);
}
.lifecycle__roundList {
  display: flex;
  flex-direction: column;
  gap: var(--sp-1);
  margin: 0;
  padding: 0;
  list-style: none;
}
.lifecycle__round {
  display: grid;
  grid-template-columns: 16px minmax(0, 1fr) auto;
  align-items: baseline;
  gap: var(--sp-2);
  color: var(--ink);
  font-size: var(--fs-meta);
}
.lifecycle__roundName {
  overflow-wrap: anywhere;
}
.lifecycle__round small {
  color: var(--muted);
  font-size: var(--fs-100);
}
.lifecycle__field {
  display: flex;
  flex-direction: column;
  gap: var(--sp-1);
}
.lifecycle__label {
  color: var(--muted);
  font-size: var(--fs-meta);
}
.lifecycle__textarea {
  padding: var(--sp-2) var(--sp-3);
  border: var(--bw) solid var(--line);
  border-radius: var(--r-md);
  color: var(--ink);
  background: var(--sunken);
  font: inherit;
  font-size: var(--fs-meta);
  line-height: 1.6;
  resize: vertical;
}
.lifecycle__textarea:focus {
  border-color: var(--accent);
  outline: none;
  box-shadow: 0 0 0 3px var(--accent-soft);
}
.lifecycle__hint {
  margin: 0;
  color: var(--muted);
  font-size: var(--fs-100);
  line-height: 1.6;
}
.lifecycle__refs {
  display: flex;
  flex-wrap: wrap;
  gap: var(--sp-2);
}
.lifecycle__link {
  display: flex;
  flex-direction: column;
  gap: var(--sp-1);
  margin-top: var(--sp-2);
}
.lifecycle__linkRow {
  display: flex;
  align-items: center;
  gap: var(--sp-2);
}
.lifecycle__linkInput {
  flex: 1;
  min-width: 0;
  padding: var(--sp-2) var(--sp-3);
  border: var(--bw) solid var(--line);
  border-radius: var(--r-md);
  color: var(--ink);
  background: var(--sunken);
  font: inherit;
  font-size: var(--fs-meta);
}
.lifecycle__linkInput:focus {
  border-color: var(--accent);
  outline: none;
  box-shadow: 0 0 0 3px var(--accent-soft);
}
.lifecycle__linkInput[aria-invalid='true'] {
  border-color: var(--danger-text);
}
.lifecycle__linkAdd {
  flex: none;
}
/* 错误行常驻（空着时高度为 0）：播报区域要先在页面上，内容出现时读屏才会念。 */
.lifecycle__linkError {
  margin: 0;
  color: var(--danger-text);
  font-size: var(--fs-100);
  line-height: 1.5;
}
.lifecycle__ref {
  display: inline-flex;
  align-items: center;
  gap: var(--sp-2);
  padding: var(--sp-1) var(--sp-2);
  border: var(--bw) solid var(--line);
  border-radius: var(--r-md);
  color: var(--muted2);
  background: var(--sunken);
  font-size: var(--fs-100);
}
.lifecycle__refKind {
  color: var(--muted);
}
.lifecycle__refName {
  overflow-wrap: anywhere;
  color: var(--ink);
  font-weight: var(--fw-label);
}
.lifecycle__refDrop {
  padding: 0 2px;
  border: 0;
  color: var(--muted);
  background: transparent;
  font-size: var(--fs-meta);
  line-height: 1;
  cursor: pointer;
  transition: color var(--dur-1) var(--ease-out);
}
.lifecycle__refDrop:hover:not(:disabled) {
  color: var(--danger-text);
}
.lifecycle__check {
  display: inline-flex;
  align-items: center;
  gap: var(--sp-2);
  color: var(--ink);
  font-size: var(--fs-meta);
}
.lifecycle__note {
  margin: 0;
  color: var(--muted);
  font-size: var(--fs-100);
  line-height: 1.7;
}
.lifecycle__stale {
  margin: 0;
  color: var(--warn-text);
  font-size: var(--fs-meta);
  line-height: 1.6;
}
.lifecycle__alert {
  display: flex;
  align-items: center;
  gap: var(--sp-2);
  margin: 0;
  color: var(--danger-text);
  font-size: var(--fs-meta);
  line-height: 1.6;
}
</style>
