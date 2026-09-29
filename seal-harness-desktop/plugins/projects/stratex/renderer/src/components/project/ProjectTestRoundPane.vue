<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';

import type {
  ProjectTestRoundSnapshot,
  ProjectTestRoundActionRequest,
} from '@shared/protocol/project-testing.js';
import type { ProjectTestDefectActionRequest } from '@shared/protocol/project-testing-defects.js';
import type { ProjectTestCaseExecuteRequest } from '@shared/protocol/project-testing-cases.js';
import TestRoundSnapshotPanel from './TestRoundSnapshotPanel.vue';
import TestRoundDecisionPanel from './TestRoundDecisionPanel.vue';
import TestDefectPanel from './TestDefectPanel.vue';
import type { TestingWriteOutcome } from '../../stores/projectCollabTesting';
import type { Todo } from '@shared/protocol/project-collab.js';

import type {
  ProjectTestCase,
  ProjectTestExecution,
} from '@shared/protocol/project-testing-cases.js';

import ReferenceIdCopy from '../ui/ReferenceIdCopy.vue';
import ProjectDialogShell from './ProjectDialogShell.vue';
import TestCaseDialog from './TestCaseDialog.vue';
import TestRoundCaseTable from './TestRoundCaseTable.vue';
import { TEST_ROUND_STATE_LABELS } from './requirement-submission';
import {
  TEST_ROUND_PANES,
  TEST_ROUND_VIEW_TEXT,
  isTestRoundCaseActor,
  testCaseRows,
  testRoundCopyPrompt,
  testRoundHeading,
  testRoundMetas,
  testRoundSubline,
  type TestRoundPaneId,
} from './test-round-view';
import { useProjectCollabStore } from '../../stores/projectCollab';
import type { ProjectCollabNotice } from '../../stores/projectCollabErrors';

/** 测试轮次的用例、缺陷与结论共用权威 store；身份只收窄入口，服务端最终判定。 */
const props = withDefaults(
  defineProps<{
    projectId: string;
    snapshot?: ProjectTestRoundSnapshot | null;
    executionEnabled?: boolean;
    executionHistory?: readonly ProjectTestExecution[];
    executionHistoryHasMore?: boolean;
    executionSavedRevision?: number;
    executionBusy?: boolean;
    executionError?: ProjectCollabNotice | null;
  }>(),
  { executionEnabled: true },
);
const emit = defineEmits<{
  back: [];
  caseOpened: [caseId: string];
  moreExecutions: [caseId: string];
  openRequirement: [string];
  execute: [
    value: {
      caseId: string;
      expectedVersion: number;
      result: 'passed' | 'failed' | 'blocked';
      actualResult: string;
      evidenceRefs: string[];
    },
  ];
}>();

const store = useProjectCollabStore();

const view = computed(() => store.testRoundView);
const round = computed(() => view.value?.round ?? null);
const cases = computed(() =>
  view.value === null ? null : (store.roundTestCases[view.value.submissionId] ?? null),
);
const requirement = computed(() =>
  view.value === null ? null : (store.todosById.get(view.value.requirementId) ?? null),
);
const claimRequirement = ref<Todo | null>(null);
watch(
  () =>
    [
      props.projectId,
      store.activeProjectId,
      store.projectEpoch,
      view.value?.submissionId,
      view.value?.requirementId,
      round.value?.version,
    ] as const,
  async (
    [projectId, activeProjectId, epoch, submissionId, requirementId],
    _previous,
    onCleanup,
  ) => {
    let current = true;
    onCleanup(() => {
      current = false;
    });
    claimRequirement.value = null;
    if (!requirementId || projectId !== activeProjectId || !submissionId) return;
    const detail = await store.loadTodoDetail(requirementId);
    if (
      current &&
      epoch === store.projectEpoch &&
      projectId === store.activeProjectId &&
      submissionId === view.value?.submissionId &&
      detail?.todo.id === requirementId &&
      detail.todo.itemKind === 'requirement'
    )
      claimRequirement.value = detail.todo;
  },
  { immediate: true },
);

const actor = computed(() =>
  isTestRoundCaseActor(round.value, {
    mySubject: store.mySubject,
    canWrite: store.canWrite,
    assigneeSubject: requirement.value?.assigneeSubject ?? null,
  }),
);
const rows = computed(() => testCaseRows(cases.value?.items ?? [], { actor: actor.value }));
const metas = computed(() =>
  testRoundMetas({
    total: cases.value?.total ?? 0,
    hasMore: cases.value?.hasMore ?? false,
    items: cases.value?.items ?? [],
  }),
);
const subline = computed(() =>
  round.value === null ? '' : testRoundSubline(round.value, store.detail?.members ?? []),
);
const copySource = computed(() => (actor.value ? (cases.value?.copySource ?? null) : null));
const defects = computed(() => (view.value ? store.testDefects[view.value.submissionId] : null));
const selectedDefectId = ref<string | null>(null);
const defectDetail = computed(() =>
  selectedDefectId.value ? store.testDefectDetails[selectedDefectId.value] : null,
);
const history = computed(() =>
  view.value ? store.testRoundActions[view.value.submissionId] : null,
);
const active = computed(() => round.value?.state === 'queued' || round.value?.state === 'testing');
const manager = computed(() => store.canManageMembers);
const reviewers = computed(() =>
  (store.detail?.members ?? []).filter(
    (member) =>
      member.state === 'active' &&
      member.role !== 'viewer' &&
      member.subject !== round.value?.submittedBySubject &&
      member.subject !== requirement.value?.assigneeSubject,
  ),
);
const canReassign = computed(
  () =>
    active.value &&
    manager.value &&
    !(store.detail?.members ?? []).some(
      (member) => member.subject === round.value?.reviewerSubject && member.state === 'active',
    ),
);
const canClaim = computed(
  () =>
    active.value &&
    round.value?.reviewerSubject === null &&
    store.canWrite &&
    !store.isArchived &&
    store.mySubject !== null &&
    claimRequirement.value !== null &&
    store.mySubject !== round.value?.submittedBySubject &&
    store.mySubject !== claimRequirement.value?.assigneeSubject,
);
function claimRound(): void {
  if (!canClaim.value || !round.value || !store.mySubject) return;
  roundAction({
    action: 'reviewer',
    reviewerSubject: store.mySubject,
    claim: true,
    reason: '认领测试',
    expectedVersion: round.value.version,
  });
}
const canWithdraw = computed(
  () =>
    round.value?.state === 'queued' &&
    store.canWrite &&
    (manager.value || store.mySubject === round.value.submittedBySubject),
);
const counts = computed(() =>
  cases.value?.loaded &&
  !cases.value.error &&
  !cases.value.hasMore &&
  defects.value?.loaded &&
  !defects.value.error &&
  !defects.value.hasMore
    ? {
        totalCases: cases.value.total,
        passedCases: cases.value.items.filter((item) => item.result === 'passed').length,
        openDefects: defects.value.items.filter((item) => item.state !== 'closed').length,
      }
    : null,
);
const actionBusy = ref(false);
const actionError = ref<ProjectCollabNotice | null>(null);
let requestSignature = '';
let requestKey = '';
function keyFor(value: unknown): string {
  const signature = JSON.stringify(value);
  if (signature !== requestSignature) {
    requestSignature = signature;
    requestKey = crypto.randomUUID();
  }
  return requestKey;
}
async function perform(action: () => Promise<TestingWriteOutcome>, close = false): Promise<void> {
  if (actionBusy.value) return;
  const epoch = store.projectEpoch;
  const roundId = view.value?.submissionId;
  actionBusy.value = true;
  actionError.value = null;
  try {
    const result = await action();
    if (epoch !== store.projectEpoch || roundId !== view.value?.submissionId) return;
    if (!result.ok) actionError.value = result.notice;
    else {
      requestSignature = '';
      if (close) closeDialogs();
    }
  } finally {
    if (epoch === store.projectEpoch && roundId === view.value?.submissionId)
      actionBusy.value = false;
  }
}
type RoundInput = ProjectTestRoundActionRequest extends infer T
  ? T extends ProjectTestRoundActionRequest
    ? Omit<T, 'projectId' | 'submissionId' | 'clientRequestId'>
    : never
  : never;
function roundAction(value: RoundInput): void {
  if (!view.value) return;
  const request = { ...value, projectId: props.projectId, submissionId: view.value.submissionId };
  void perform(() =>
    store.performTestRoundAction({ ...request, clientRequestId: keyFor(request) }),
  );
}
type DefectInput = ProjectTestDefectActionRequest extends infer T
  ? T extends ProjectTestDefectActionRequest
    ? Omit<T, 'projectId' | 'clientRequestId'>
    : never
  : never;
function defectAction(value: DefectInput): void {
  const request = { ...value, projectId: props.projectId };
  void perform(() =>
    store.performTestDefectAction({ ...request, clientRequestId: keyFor(request) }),
  );
}
function execute(
  value: Omit<ProjectTestCaseExecuteRequest, 'projectId' | 'clientRequestId'>,
): void {
  emit('execute', value);
  const request = { ...value, projectId: props.projectId };
  void perform(() => store.executeTestCase({ ...request, clientRequestId: keyFor(request) }), true);
}
function selectDefect(id: string): void {
  selectedDefectId.value = id;
  void store.loadTestDefectDetail(props.projectId, id);
}
function reloadLifecycle(): void {
  if (!view.value) return;
  void store.reloadTestRound();
  void store.loadTestDefects(props.projectId, view.value.submissionId);
  void store.loadTestRoundActions(props.projectId, view.value.submissionId);
  if (selectedDefectId.value)
    void store.loadTestDefectDetail(props.projectId, selectedDefectId.value);
}

const pane = ref<TestRoundPaneId>('cases');
watch(
  () => view.value?.submissionId,
  () => {
    pane.value = 'cases';
    closeDialogs();
    selectedDefectId.value = null;
    actionError.value = null;
    actionBusy.value = false;
    requestSignature = '';
    if (view.value) {
      void store.loadTestDefects(props.projectId, view.value.submissionId);
      void store.loadTestRoundActions(props.projectId, view.value.submissionId);
    }
  },
);

/* ── 用例弹层 ── */
const dialogCase = ref<ProjectTestCase | null>(null);
const dialogOpen = ref(false);
watch(
  () => cases.value?.items,
  (items) => {
    if (!dialogCase.value || !items) return;
    const current = items.find((item) => item.id === dialogCase.value?.id);
    if (current) dialogCase.value = current;
    else if (!cases.value?.loaded && cases.value?.error) closeDialogs();
  },
);

function openCase(caseId: string): void {
  dialogCase.value = cases.value?.items.find((item) => item.id === caseId) ?? null;
  dialogOpen.value = dialogCase.value !== null;
  if (dialogCase.value) emit('caseOpened', dialogCase.value.id);
  if (dialogCase.value) void store.loadTestExecutions(props.projectId, dialogCase.value.id);
}

function newCase(): void {
  dialogCase.value = null;
  dialogOpen.value = true;
}

watch(
  () => props.executionSavedRevision,
  () => closeDialogs(),
);

/* ── 复用上轮 ── */
const copyOpen = ref(false);
const copyBusy = ref(false);
const copyNotice = ref<ProjectCollabNotice | null>(null);

function openCopy(): void {
  copyNotice.value = null;
  copyOpen.value = true;
}

async function confirmCopy(): Promise<void> {
  if (view.value === null || copyBusy.value) return;
  copyBusy.value = true;
  try {
    const outcome = await store.copyPreviousRoundTestCases(
      props.projectId,
      view.value.submissionId,
    );
    if (outcome.ok) {
      copyOpen.value = false;
      return;
    }
    if (outcome.notice === null) {
      copyOpen.value = false;
      return;
    }
    copyNotice.value = outcome.notice;
  } finally {
    copyBusy.value = false;
  }
}

function closeDialogs(): void {
  dialogOpen.value = false;
  dialogCase.value = null;
  copyOpen.value = false;
}

function loadMore(): void {
  if (view.value === null) return;
  void store.loadMoreRoundTestCases(props.projectId, view.value.submissionId);
}

function retryCases(): void {
  if (view.value === null) return;
  void store.loadRoundTestCases(props.projectId, view.value.submissionId);
}
onMounted(() => {
  if (!view.value) return;
  void store.loadTestDefects(props.projectId, view.value.submissionId);
  void store.loadTestRoundActions(props.projectId, view.value.submissionId);
});
</script>

<template>
  <section
    v-if="view"
    class="test-round"
    data-testid="test-round-pane"
    aria-labelledby="test-round-heading"
  >
    <button
      class="test-round__back"
      type="button"
      data-testid="test-round-back"
      @click="emit('back')"
    >
      {{ TEST_ROUND_VIEW_TEXT.back }}
    </button>

    <p v-if="view.loading && round === null" class="test-round__status" role="status">
      {{ TEST_ROUND_VIEW_TEXT.loadingRound }}
    </p>
    <p v-if="view.error" class="test-round__alert" role="alert" data-testid="test-round-error">
      <span>{{ view.error.message }}</span>
      <ReferenceIdCopy v-if="view.error.referenceCode" :reference-id="view.error.referenceCode" />
      <button class="test-round__link" type="button" @click="store.reloadTestRound()">
        {{ TEST_ROUND_VIEW_TEXT.retry }}
      </button>
    </p>

    <header v-if="round" class="test-round__head">
      <div class="test-round__line">
        <span id="test-round-heading" class="test-round__heading" data-testid="test-round-heading">
          <ReferenceIdCopy :reference-id="view.requirementId" label="需求标识" label-hidden />
          <span class="tnum"> · {{ testRoundHeading(round) }}</span>
        </span>
        <span class="test-round__state" :data-state="round.state" data-testid="test-round-state">{{
          TEST_ROUND_STATE_LABELS[round.state]
        }}</span>
      </div>
      <h2 v-if="view.requirementTitle" class="test-round__title" data-testid="test-round-title">
        {{ view.requirementTitle }}
      </h2>
      <p class="test-round__subline tnum">{{ subline }}</p>
      <dl class="test-round__metas">
        <div class="test-round__meta">
          <dt>{{ TEST_ROUND_VIEW_TEXT.metaCases }}</dt>
          <dd class="tnum" data-testid="test-round-meta-cases">{{ metas.cases }}</dd>
        </div>
        <div class="test-round__meta">
          <dt>{{ TEST_ROUND_VIEW_TEXT.metaPassed }}</dt>
          <dd class="tnum">{{ metas.passed }}</dd>
        </div>
      </dl>
      <div class="test-round__toolbar">
        <button
          class="btn btn--ghost"
          type="button"
          data-testid="test-round-open-requirement"
          @click="emit('openRequirement', view.requirementId)"
        >
          {{ TEST_ROUND_VIEW_TEXT.openRequirement }}
        </button>
      </div>
    </header>

    <details v-if="props.snapshot">
      <summary>查看提交时快照</summary>
      <TestRoundSnapshotPanel :snapshot="props.snapshot" />
    </details>

    <div class="test-round__tabs" role="tablist" aria-label="测试用例、缺陷记录与测试结论">
      <button
        v-for="item in TEST_ROUND_PANES"
        :key="item.id"
        class="test-round__tab"
        type="button"
        role="tab"
        :aria-selected="pane === item.id"
        data-testid="test-round-pane-tab"
        @click="pane = item.id"
      >
        {{ item.label }}
      </button>
    </div>

    <div
      v-if="pane === 'cases'"
      class="test-round__panel"
      role="tabpanel"
      data-testid="test-round-cases"
    >
      <div class="test-round__panelBar">
        <span class="test-round__hint">{{ TEST_ROUND_VIEW_TEXT.casesHint }}</span>
        <span class="test-round__grow"></span>
        <button
          v-if="actor"
          class="btn btn--primary"
          type="button"
          data-testid="test-case-new"
          @click="newCase"
        >
          {{ TEST_ROUND_VIEW_TEXT.newCase }}
        </button>
        <button
          v-if="copySource"
          class="btn btn--ghost"
          type="button"
          data-testid="test-case-copy-previous"
          @click="openCopy"
        >
          {{ TEST_ROUND_VIEW_TEXT.copyPrevious }}
        </button>
      </div>

      <p
        v-if="cases?.notice"
        class="test-round__status"
        role="status"
        data-testid="test-case-notice"
      >
        {{ cases.notice.message }}
      </p>
      <p
        v-if="cases?.error"
        class="test-round__alert"
        role="alert"
        data-testid="test-case-load-error"
      >
        <span>{{ cases.error.message }}</span>
        <ReferenceIdCopy
          v-if="cases.error.referenceCode"
          :reference-id="cases.error.referenceCode"
        />
        <button
          v-if="!cases.loaded"
          class="test-round__link"
          type="button"
          :disabled="cases.loading"
          @click="retryCases"
        >
          {{ TEST_ROUND_VIEW_TEXT.retry }}
        </button>
      </p>

      <TestRoundCaseTable v-if="rows.length > 0" :rows="rows" @open="openCase" />
      <p v-else-if="cases?.loaded" class="test-round__empty" data-testid="test-case-empty">
        <span>{{ TEST_ROUND_VIEW_TEXT.empty[0] }}</span>
        <br />
        <span>{{ TEST_ROUND_VIEW_TEXT.empty[1] }}</span>
      </p>
      <p v-else-if="cases?.loading" class="test-round__status" role="status">
        {{ TEST_ROUND_VIEW_TEXT.loading }}
      </p>

      <button
        v-if="cases?.hasMore"
        class="test-round__more"
        type="button"
        :disabled="cases.loading"
        data-testid="test-case-load-more"
        @click="loadMore"
      >
        {{ TEST_ROUND_VIEW_TEXT.loadMore }}
      </button>
    </div>
    <div v-else-if="round" class="test-round__panel" role="tabpanel">
      <button type="button" :disabled="actionBusy" @click="reloadLifecycle">刷新记录</button>
      <TestDefectPanel
        v-if="pane === 'bugs'"
        :defects="defects?.items ?? []"
        :selected="defectDetail?.defect ?? null"
        :history="defectDetail?.items ?? []"
        :round-version="round.version"
        :readonly="!active || !store.canWrite"
        :busy="actionBusy || (defects?.loading ?? false) || (defectDetail?.loading ?? false)"
        :error="actionError ?? defectDetail?.error ?? defects?.error ?? null"
        :has-more="defects?.hasMore ?? false"
        :history-has-more="defectDetail?.hasMore ?? false"
        :can-create="actor"
        :can-assign="actor"
        :can-retest="actor"
        :can-fix="store.canWrite && store.mySubject === defectDetail?.defect?.assigneeSubject"
        @select="selectDefect"
        @load-more="store.loadTestDefects(projectId, round.id, true)"
        @more-history="
          selectedDefectId && store.loadTestDefectDetail(projectId, selectedDefectId, true)
        "
        @create="defectAction({ action: 'create', submissionId: round.id, ...$event })"
        @assign="defectAction({ action: 'assign', ...$event })"
        @fix="defectAction({ action: 'fix', ...$event })"
        @retest="defectAction({ action: 'retest', ...$event })"
      />
      <TestRoundDecisionPanel
        v-else
        :round="round"
        :readonly="!actor"
        :busy="actionBusy"
        :error="actionError ?? history?.error ?? null"
        :counts="counts"
        :can-withdraw="canWithdraw"
        :can-reassign="canReassign"
        :can-claim="canClaim"
        :reviewers="reviewers"
        :history="history?.items ?? []"
        :history-has-more="history?.hasMore ?? false"
        @decision="roundAction({ action: 'decision', ...$event })"
        @withdraw="roundAction({ action: 'withdraw', ...$event })"
        @reviewer="roundAction({ action: 'reviewer', ...$event })"
        @claim="claimRound"
        @more-history="store.loadTestRoundActions(projectId, round.id, true)"
      />
      <button
        v-if="pane === 'result' && cases?.hasMore"
        type="button"
        :disabled="cases.loading"
        @click="loadMore"
      >
        加载更多用例以核对全部结果
      </button>
      <button
        v-if="pane === 'result' && defects?.hasMore"
        type="button"
        :disabled="defects.loading"
        @click="store.loadTestDefects(projectId, round.id, true)"
      >
        加载更多缺陷以核对全部结果
      </button>
    </div>

    <TestCaseDialog
      v-if="dialogOpen && round"
      :project-id="props.projectId"
      :submission-id="view.submissionId"
      :round-no="round.roundNo"
      :requirement-id="view.requirementId"
      :test-case="dialogCase"
      :readonly="!actor"
      :execution-enabled="props.executionEnabled ?? true"
      :execution-history="
        (
          props.executionHistory ??
          (dialogCase ? store.testExecutions[dialogCase.id]?.items : []) ??
          []
        ).filter((entry) => entry.caseId === dialogCase?.id)
      "
      :execution-history-has-more="
        props.executionHistoryHasMore ??
        (dialogCase ? store.testExecutions[dialogCase.id]?.hasMore : false) ??
        false
      "
      @more-executions="dialogCase && store.loadTestExecutions(projectId, dialogCase.id, true)"
      :execution-busy="props.executionBusy ?? actionBusy"
      :execution-error="
        props.executionError ??
        actionError ??
        (dialogCase ? store.testExecutions[dialogCase.id]?.error : null) ??
        null
      "
      @execute="execute"
      @close="closeDialogs"
      @done="closeDialogs"
    />

    <ProjectDialogShell
      v-if="copyOpen && copySource"
      :title="TEST_ROUND_VIEW_TEXT.copyTitle"
      @close="copyOpen = false"
    >
      <div class="test-round__copy" data-testid="test-case-copy-dialog">
        <p>{{ testRoundCopyPrompt(copySource) }}</p>
        <p v-if="copyNotice" class="test-round__alert" role="alert">
          <span>{{ copyNotice.message }}</span>
          <ReferenceIdCopy
            v-if="copyNotice.referenceCode"
            :reference-id="copyNotice.referenceCode"
          />
        </p>
      </div>
      <template #foot>
        <button
          class="btn btn--ghost"
          type="button"
          :disabled="copyBusy"
          data-testid="test-case-copy-cancel"
          @click="copyOpen = false"
        >
          {{ TEST_ROUND_VIEW_TEXT.cancel }}
        </button>
        <button
          class="btn btn--primary"
          type="button"
          :disabled="copyBusy"
          data-testid="test-case-copy-confirm"
          @click="confirmCopy"
        >
          {{ copyBusy ? TEST_ROUND_VIEW_TEXT.copying : TEST_ROUND_VIEW_TEXT.copyConfirm }}
        </button>
      </template>
    </ProjectDialogShell>
  </section>
</template>

<style scoped>
.test-round {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: var(--px-12);
  padding: var(--px-16) 0;
}
.test-round__back,
.test-round__link,
.test-round__more {
  align-self: flex-start;
  padding: 0 var(--px-4);
  border: 0;
  border-radius: var(--r-sm);
  color: var(--accent-text);
  background: transparent;
  font: inherit;
  font-size: var(--fs-300);
  cursor: pointer;
}
.test-round__back:hover,
.test-round__link:hover,
.test-round__more:hover {
  background: var(--accent-soft);
}
.test-round__back:focus-visible,
.test-round__link:focus-visible,
.test-round__more:focus-visible,
.test-round__tab:focus-visible {
  outline: none;
  box-shadow: var(--focus-ring-flat);
}
.test-round__head {
  display: flex;
  flex-direction: column;
  gap: var(--px-6);
}
.test-round__line {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: var(--px-8);
}
.test-round__heading {
  display: inline-flex;
  flex-wrap: wrap;
  align-items: center;
  color: var(--muted);
  font-size: var(--fs-200);
}
.test-round__state {
  padding: 0 var(--px-6);
  border: var(--bw) solid var(--line);
  border-radius: var(--r-sm);
  color: var(--muted2);
  background: var(--sunken);
  font-size: var(--fs-200);
}
.test-round__state[data-state='queued'],
.test-round__state[data-state='testing'] {
  border-color: var(--warn-line);
  color: var(--warn-text);
  background: var(--warn-soft);
}
.test-round__state[data-state='passed'] {
  border-color: var(--ok-line);
  color: var(--ok-text);
  background: var(--ok-soft);
}
.test-round__title {
  margin: 0;
  color: var(--ink);
  font-size: var(--fs-600);
  font-weight: var(--fw-title);
  overflow-wrap: anywhere;
}
.test-round__subline {
  margin: 0;
  color: var(--muted);
  font-size: var(--fs-200);
}
/* 原型 .detail-meta：标签在上、值在下的横排格。 */
.test-round__metas {
  display: flex;
  flex-wrap: wrap;
  gap: var(--px-8) var(--px-24);
  margin: var(--px-4) 0 0;
}
.test-round__meta dt {
  color: var(--muted2);
  font-size: var(--fs-200);
}
.test-round__meta dd {
  margin: 0;
  color: var(--ink);
  font-size: var(--fs-300);
}
.test-round__toolbar {
  display: flex;
  flex-wrap: wrap;
  gap: var(--px-8);
}
/* 原型 .detail-tabs：底线页签。 */
.test-round__tabs {
  display: flex;
  flex-wrap: wrap;
  gap: var(--px-8);
  border-bottom: var(--bw) solid var(--line);
}
.test-round__tab {
  margin-bottom: calc(-1 * var(--bw));
  padding: var(--px-8) var(--px-5);
  border: 0;
  border-bottom: var(--bw-rule) solid transparent;
  color: var(--muted);
  background: transparent;
  font: inherit;
  font-size: var(--fs-300);
  white-space: nowrap;
  cursor: pointer;
}
.test-round__tab[aria-selected='true'] {
  border-bottom-color: var(--accent);
  color: var(--ink);
  font-weight: var(--fw-label);
}
.test-round__panel {
  display: flex;
  flex-direction: column;
  gap: var(--px-8);
}
.test-round__panelBar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--px-8);
}
.test-round__grow {
  flex: 1;
}
.test-round__hint,
.test-round__status {
  margin: 0;
  color: var(--muted);
  font-size: var(--fs-200);
}
.test-round__alert {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--px-6);
  margin: 0;
  color: var(--danger-text);
  font-size: var(--fs-200);
}
.test-round__empty {
  margin: 0;
  padding: var(--px-32) var(--px-16);
  border: var(--bw) solid var(--line);
  border-radius: var(--r-md);
  color: var(--muted2);
  font-size: var(--fs-300);
  line-height: var(--lh-body);
  text-align: center;
}
.test-round__copy p {
  margin: 0 0 var(--px-8);
}
</style>
