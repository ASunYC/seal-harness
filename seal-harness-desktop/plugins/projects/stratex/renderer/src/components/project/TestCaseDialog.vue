<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue';

import {
  PROJECT_TEST_CASE_FIELDS_REQUIRED_TEXT,
  PROJECT_TEST_CASE_MAX_EXPECTED_LENGTH,
  PROJECT_TEST_CASE_MAX_PRECONDITIONS_LENGTH,
  PROJECT_TEST_CASE_MAX_STEPS_LENGTH,
  PROJECT_TEST_CASE_MAX_TITLE_LENGTH,
  projectTestCaseMissingFields,
  type ProjectTestCase,
  type ProjectTestExecution,
  type ProjectTestCaseField,
} from '@shared/protocol/project-testing-cases.js';

import ReferenceIdCopy from '../ui/ReferenceIdCopy.vue';
import ProjectDialogShell from './ProjectDialogShell.vue';
import {
  TEST_CASE_RESULT_LABELS,
  TEST_ROUND_VIEW_TEXT,
  testCaseDraftFrom,
  parseTestEvidenceRefs,
} from './test-round-view';
import { useProjectCollabStore } from '../../stores/projectCollab';
import type { ProjectCollabNotice } from '../../stores/projectCollabErrors';

/**
 * 测试用例弹层（TST-04，原型 `caseEditor`）：名称 / 前置条件 / 操作步骤 · 每行一步 / 预期结果，执行结果只读。
 *
 * ⛔ **取消零写入**：取消只 `emit('close')`。⛔ **失败不伪成功**：失败就地显示（业务码文案 + 参考编号），
 *    弹层留在原地、输入一个字不丢；只有成功才 `emit('done')`。
 * ⭐ 缺必填（名称 / 步骤 / 预期去空白后为空）就地给原型那一句、⛔ 不发请求——与服务端同一套规则。
 * ⭐ 新建的 `clientRequestId` 每次打开生成一次、同一次打开内的重试沿用（幂等）；409 `idempotency_conflict`
 *    时换号（内容变了，同号必然再冲突）。
 * ⭐ 409 版本冲突：store 已重取到最新版本并回出当前版本号——这里把期望版本改基到它、保留填写内容，
 *    用户确认后再存（共享层那句文案承诺的恢复路径）。
 * ⚠️ `readonly`（不是本轮测试负责人、或轮次已结束）时全部输入禁用、没有保存钮。
 * ⚠️ 登出 / 登入是原地换号、视图不卸载：身份或项目一变弹层即关，上一个账号的草稿不留到下一个账号。
 * ⚠️【埋点红线】用例正文是用户亲笔：⛔ 不进日志与埋点。
 */
const props = defineProps<{
  projectId: string;
  submissionId: string;
  roundNo: number;
  requirementId: string;
  /** null ＝ 新建。 */
  testCase: ProjectTestCase | null;
  readonly: boolean;
  executionEnabled?: boolean;
  executionHistory?: readonly ProjectTestExecution[];
  executionHistoryHasMore?: boolean;
  executionBusy?: boolean;
  executionError?: ProjectCollabNotice | null;
}>();
const emit = defineEmits<{
  close: [];
  done: [];
  moreExecutions: [];
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

const executionResult = ref<'passed' | 'failed' | 'blocked' | ''>('');
const actualResult = ref('');
const evidenceText = ref('');
const executionValidation = ref('');
const executionVersion = ref(props.testCase?.version ?? 1);
const executionChanged = computed(() => props.testCase?.version !== executionVersion.value);
const executionRefreshing = ref(false);
const executionReviewReady = ref(false);
watch(
  () => props.testCase?.version,
  () => {
    executionReviewReady.value = false;
  },
);
watch(
  () => props.readonly,
  (value) => {
    if (value) {
      actualResult.value = '';
      evidenceText.value = '';
    }
  },
);
function execute() {
  if (
    props.readonly ||
    !props.executionEnabled ||
    props.executionBusy ||
    executionRefreshing.value ||
    executionReviewReady.value ||
    executionChanged.value ||
    props.testCase === null ||
    !executionResult.value
  )
    return;
  const evidenceRefs = parseTestEvidenceRefs(evidenceText.value);
  if (evidenceRefs === null) {
    executionValidation.value = '证据须为文件版本引用或不含账号密码的网页链接。';
    return;
  }
  executionValidation.value = '';
  emit('execute', {
    caseId: props.testCase.id,
    expectedVersion: executionVersion.value,
    result: executionResult.value,
    actualResult: actualResult.value,
    evidenceRefs,
  });
}

const store = useProjectCollabStore();
async function refreshExecutionCase(): Promise<void> {
  if (!props.testCase || executionRefreshing.value) return;
  const caseId = props.testCase.id;
  const epoch = store.projectEpoch;
  executionRefreshing.value = true;
  executionReviewReady.value = false;
  executionValidation.value = '';
  try {
    await store.loadRoundTestCases(props.projectId, props.submissionId);
    const seen = new Set<string>();
    while (epoch === store.projectEpoch) {
      const page = store.roundTestCases[props.submissionId];
      if (!page || page.error) {
        executionValidation.value = page?.error?.message ?? '无法读取最新用例，请重试。';
        return;
      }
      if (page.items.some((item) => item.id === caseId)) {
        await nextTick();
        executionReviewReady.value = true;
        return;
      }
      if (!page.hasMore || !page.nextCursor || seen.has(page.nextCursor)) break;
      seen.add(page.nextCursor);
      await store.loadMoreRoundTestCases(props.projectId, props.submissionId);
    }
    if (epoch === store.projectEpoch)
      executionValidation.value = '未能找到最新用例，请刷新轮次后重试。';
  } finally {
    executionRefreshing.value = false;
  }
}
function acknowledgeExecutionCase(): void {
  if (!executionReviewReady.value || !props.testCase) return;
  executionVersion.value = props.testCase.version;
  executionReviewReady.value = false;
}

const initial = testCaseDraftFrom(props.testCase);
const title = ref(initial.title);
const preconditions = ref(initial.preconditions);
const steps = ref(initial.steps);
const expected = ref(initial.expected);
let clientRequestId = crypto.randomUUID();
const expectedVersion = ref(props.testCase?.version ?? 1);
const busy = ref(false);
const notice = ref<ProjectCollabNotice | null>(null);
const missing = ref<readonly ProjectTestCaseField[]>([]);

const dialogTitle = computed(() =>
  props.testCase === null ? TEST_ROUND_VIEW_TEXT.dialogCreate : TEST_ROUND_VIEW_TEXT.dialogDetail,
);
const resultLabel = computed(() => TEST_CASE_RESULT_LABELS[props.testCase?.result ?? 'notrun']);

watch([() => store.mySubject, () => store.activeProjectId], () => emit('close'));

function isMissing(field: ProjectTestCaseField): boolean {
  return missing.value.includes(field);
}

function cancel(): void {
  if (busy.value) return;
  emit('close');
}

async function save(): Promise<void> {
  if (props.readonly || busy.value) return;
  const draft = {
    title: title.value,
    preconditions: preconditions.value,
    steps: steps.value,
    expected: expected.value,
  };
  const absent = projectTestCaseMissingFields(draft);
  if (absent.length > 0) {
    missing.value = absent;
    notice.value = { message: PROJECT_TEST_CASE_FIELDS_REQUIRED_TEXT, referenceCode: null };
    return;
  }
  busy.value = true;
  notice.value = null;
  missing.value = [];
  try {
    const outcome =
      props.testCase === null
        ? await store.createRoundTestCase({
            projectId: props.projectId,
            submissionId: props.submissionId,
            clientRequestId,
            ...draft,
          })
        : await store.updateTestCase({
            projectId: props.projectId,
            caseId: props.testCase.id,
            expectedVersion: expectedVersion.value,
            ...draft,
          });
    if (outcome.ok) {
      emit('done');
      return;
    }
    // 作废的结果（在途换号 / 切项目）不提示：弹层随之关闭。
    if (outcome.notice === null) return;
    notice.value = outcome.notice;
    missing.value = outcome.missingFields ?? [];
    if (outcome.serverCode === 'version_conflict' && outcome.currentVersion !== null) {
      expectedVersion.value = outcome.currentVersion;
    }
    if (outcome.serverCode === 'idempotency_conflict') clientRequestId = crypto.randomUUID();
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <ProjectDialogShell :title="dialogTitle" @close="cancel">
    <form class="case-dialog" data-testid="test-case-dialog" @submit.prevent="save">
      <p class="case-dialog__context">
        <ReferenceIdCopy :reference-id="props.requirementId" label="需求标识" label-hidden />
        <span class="tnum"> · {{ TEST_ROUND_VIEW_TEXT.dialogContext(props.roundNo) }}</span>
      </p>

      <label class="case-dialog__field">
        <span class="case-dialog__label">{{ TEST_ROUND_VIEW_TEXT.fieldTitle }}</span>
        <input
          v-model="title"
          class="case-dialog__input"
          type="text"
          :maxlength="PROJECT_TEST_CASE_MAX_TITLE_LENGTH"
          :disabled="props.readonly || busy"
          :aria-invalid="isMissing('title') || undefined"
          data-testid="test-case-title"
        />
      </label>
      <label class="case-dialog__field">
        <span class="case-dialog__label">{{ TEST_ROUND_VIEW_TEXT.fieldPreconditions }}</span>
        <textarea
          v-model="preconditions"
          class="case-dialog__textarea"
          rows="2"
          :maxlength="PROJECT_TEST_CASE_MAX_PRECONDITIONS_LENGTH"
          :disabled="props.readonly || busy"
          data-testid="test-case-preconditions"
        ></textarea>
      </label>
      <label class="case-dialog__field">
        <span class="case-dialog__label">{{ TEST_ROUND_VIEW_TEXT.fieldSteps }}</span>
        <textarea
          v-model="steps"
          class="case-dialog__textarea"
          rows="4"
          :maxlength="PROJECT_TEST_CASE_MAX_STEPS_LENGTH"
          :disabled="props.readonly || busy"
          :aria-invalid="isMissing('steps') || undefined"
          data-testid="test-case-steps"
        ></textarea>
      </label>
      <label class="case-dialog__field">
        <span class="case-dialog__label">{{ TEST_ROUND_VIEW_TEXT.fieldExpected }}</span>
        <textarea
          v-model="expected"
          class="case-dialog__textarea"
          rows="3"
          :maxlength="PROJECT_TEST_CASE_MAX_EXPECTED_LENGTH"
          :disabled="props.readonly || busy"
          :aria-invalid="isMissing('expected') || undefined"
          data-testid="test-case-expected"
        ></textarea>
      </label>

      <div class="case-dialog__result">
        <span class="case-dialog__label">{{ TEST_ROUND_VIEW_TEXT.fieldResult }}</span>
        <span class="case-dialog__resultValue" data-testid="test-case-result">{{
          resultLabel
        }}</span>
        <small v-if="!executionEnabled" class="case-dialog__hint">{{
          TEST_ROUND_VIEW_TEXT.resultPendingNote
        }}</small>
      </div>

      <section v-if="testCase?.actualResult !== undefined" aria-label="最近执行记录">
        <p>实际结果：{{ testCase.actualResult || '无' }}</p>
        <p v-if="testCase.testedBySubject">
          执行人：{{ testCase.testedBySubject }} · {{ testCase.testedAt }}
        </p>
        <ul>
          <li v-for="(reference, index) in testCase.evidenceRefs ?? []" :key="index">
            {{ reference }}
          </li>
        </ul>
      </section>
      <section v-if="executionHistory" aria-label="执行历史">
        <h4>执行历史</h4>
        <ol>
          <li v-for="entry in executionHistory" :key="entry.id">
            <strong>{{ TEST_CASE_RESULT_LABELS[entry.result] }}</strong> ·
            {{ entry.testedBySubject }} · {{ entry.testedAt }}
            <p>{{ entry.actualResult }}</p>
            <details>
              <summary>当次用例内容</summary>
              <p>{{ entry.caseSnapshot.title }}</p>
              <p>{{ entry.caseSnapshot.preconditions }}</p>
              <p>{{ entry.caseSnapshot.steps }}</p>
              <p>{{ entry.caseSnapshot.expected }}</p>
            </details>
            <ul>
              <li v-for="(reference, index) in entry.evidenceRefs" :key="index">{{ reference }}</li>
            </ul>
          </li>
        </ol>
        <button
          v-if="executionHistoryHasMore"
          type="button"
          class="btn btn--ghost"
          @click="emit('moreExecutions')"
        >
          加载更早执行记录
        </button>
      </section>
      <fieldset
        v-if="testCase && executionEnabled && !readonly"
        :disabled="executionBusy || busy"
        class="case-dialog__execution"
      >
        <legend>记录本次执行</legend>
        <label
          >执行结果<select v-model="executionResult" data-testid="case-execution-result">
            <option disabled value="">请选择执行结果</option>
            <option value="passed">通过</option>
            <option value="failed">失败</option>
            <option value="blocked">受阻</option>
          </select></label
        >
        <label
          >实际结果<textarea
            v-model="actualResult"
            rows="4"
            maxlength="4000"
            data-testid="case-execution-actual"
          />
        </label>
        <label
          >证据引用（每行一项）<textarea
            v-model="evidenceText"
            rows="2"
            data-testid="case-execution-evidence"
          />
        </label>
        <p v-if="executionValidation" role="alert">{{ executionValidation }}</p>
        <p v-if="executionChanged" role="alert">
          用例已更新，填写内容已保留。请刷新并核对新步骤后再记录执行。
        </p>
        <button
          v-if="executionChanged || executionError"
          type="button"
          :disabled="executionRefreshing"
          data-testid="case-execution-refresh"
          @click="refreshExecutionCase"
        >
          刷新最新用例并核对
        </button>
        <section v-if="executionReviewReady && testCase" aria-label="待核对的最新用例">
          <h4>{{ testCase.title }}</h4>
          <p>{{ testCase.preconditions }}</p>
          <p>{{ testCase.steps }}</p>
          <p>{{ testCase.expected }}</p>
          <button
            type="button"
            data-testid="case-execution-acknowledge"
            @click="acknowledgeExecutionCase"
          >
            已核对，使用此版本重试
          </button>
        </section>
        <p v-if="executionError" role="alert">
          {{ executionError.message
          }}<ReferenceIdCopy
            v-if="executionError.referenceCode"
            :reference-id="executionError.referenceCode"
          />
        </p>
        <button
          type="button"
          class="btn btn--primary"
          data-testid="case-execute"
          :disabled="
            !executionResult || executionChanged || executionRefreshing || executionReviewReady
          "
          @click="execute"
        >
          保存执行结果
        </button>
      </fieldset>
      <div v-if="notice" class="case-dialog__error" role="alert" data-testid="test-case-error">
        <span>{{ notice.message }}</span>
        <ReferenceIdCopy v-if="notice.referenceCode" :reference-id="notice.referenceCode" />
      </div>
    </form>

    <template #foot>
      <button class="btn btn--ghost" type="button" :disabled="busy" @click="cancel">
        {{ props.readonly ? TEST_ROUND_VIEW_TEXT.close : TEST_ROUND_VIEW_TEXT.cancel }}
      </button>
      <button
        v-if="!props.readonly"
        class="btn btn--primary"
        type="button"
        :disabled="busy"
        data-testid="test-case-save"
        @click="save"
      >
        {{ busy ? TEST_ROUND_VIEW_TEXT.saving : TEST_ROUND_VIEW_TEXT.save }}
      </button>
    </template>
  </ProjectDialogShell>
</template>

<style scoped>
.case-dialog__execution {
  display: grid;
  gap: var(--px-8);
  border: var(--bw) solid var(--line);
}
.case-dialog__execution label {
  display: grid;
  gap: var(--px-4);
}
.case-dialog {
  display: flex;
  min-width: min(560px, 100%);
  flex-direction: column;
  gap: var(--px-12);
}
.case-dialog__context {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  margin: 0;
  color: var(--muted);
  font-size: var(--fs-200);
}
.case-dialog__field {
  display: flex;
  flex-direction: column;
  gap: var(--px-4);
}
.case-dialog__label {
  color: var(--ink);
  font-size: var(--fs-200);
  font-weight: var(--fw-label);
}
.case-dialog__input,
.case-dialog__textarea {
  width: 100%;
  padding: var(--px-6) var(--px-8);
  border: var(--bw) solid var(--line);
  border-radius: var(--r-sm);
  color: var(--ink);
  background: var(--sunken);
  font: inherit;
  font-size: var(--fs-300);
}
.case-dialog__textarea {
  resize: vertical;
  line-height: var(--lh-body);
}
.case-dialog__input:focus-visible,
.case-dialog__textarea:focus-visible {
  outline: none;
  box-shadow: var(--focus-ring-flat);
}
.case-dialog__input[aria-invalid='true'],
.case-dialog__textarea[aria-invalid='true'] {
  border-color: var(--danger-line);
}
.case-dialog__input:disabled,
.case-dialog__textarea:disabled {
  color: var(--muted);
  background: var(--sunken);
}
.case-dialog__result {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: var(--px-4) var(--px-8);
}
.case-dialog__resultValue {
  color: var(--muted);
  font-size: var(--fs-300);
}
.case-dialog__hint {
  color: var(--muted2);
  font-size: var(--fs-200);
}
.case-dialog__error {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--px-6);
  margin: 0;
  color: var(--danger-text);
  font-size: var(--fs-200);
  line-height: var(--lh-1p5);
}
</style>
