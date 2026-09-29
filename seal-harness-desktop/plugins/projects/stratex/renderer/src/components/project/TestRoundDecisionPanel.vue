<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import type {
  ProjectTestRoundDetail,
  ProjectTestRoundHistory,
} from '@shared/protocol/project-testing.js';
import type { ProjectCollabNotice } from '../../stores/projectCollabErrors';
import ReferenceIdCopy from '../ui/ReferenceIdCopy.vue';
import { TEST_ROUND_STATE_LABELS } from './requirement-submission';
const props = defineProps<{
  round: ProjectTestRoundDetail;
  readonly: boolean;
  busy: boolean;
  error?: ProjectCollabNotice | null;
  counts: { totalCases: number; passedCases: number; openDefects: number } | null;
  canWithdraw?: boolean;
  canReassign?: boolean;
  canClaim?: boolean;
  reviewers?: readonly { subject: string; displayName: string }[];
  history?: readonly ProjectTestRoundHistory[];
  historyHasMore?: boolean;
}>();
const emit = defineEmits<{
  decision: [value: { decision: 'passed' | 'returned'; reason: string; expectedVersion: number }];
  withdraw: [value: { reason: string; expectedVersion: number }];
  reviewer: [value: { reviewerSubject: string; reason: string; expectedVersion: number }];
  claim: [];
  moreHistory: [];
}>();
const reason = ref('');
const reviewer = ref('');
const active = computed(() => props.round.state === 'queued' || props.round.state === 'testing');
const writable = computed(() => active.value && !props.readonly && !props.busy);
const canPass = computed(
  () =>
    writable.value &&
    props.counts !== null &&
    props.counts.totalCases > 0 &&
    props.counts.passedCases === props.counts.totalCases &&
    props.counts.openDefects === 0,
);
watch(
  () => props.round.id,
  () => {
    reason.value = '';
  },
);
watch(
  () => props.readonly,
  (value) => {
    if (value) reason.value = '';
  },
);
function decide(decision: 'passed' | 'returned') {
  if (!writable.value || (decision === 'passed' ? !canPass.value : !reason.value.trim())) return;
  emit('decision', { decision, reason: reason.value.trim(), expectedVersion: props.round.version });
}
</script>
<template>
  <section class="round-decision" aria-label="测试结论">
    <h3>测试结论</h3>
    <fieldset v-if="canWithdraw || canReassign" :disabled="busy">
      <legend>轮次操作</legend>
      <label
        >操作原因<textarea v-model="reason" maxlength="8000" data-testid="round-action-reason" />
      </label>
      <button
        v-if="canWithdraw"
        type="button"
        :disabled="!reason.trim()"
        data-testid="round-withdraw"
        @click="emit('withdraw', { reason: reason.trim(), expectedVersion: round.version })"
      >
        撤回本轮
      </button>
      <template v-if="canReassign">
        <label
          >新的测试负责人<select v-model="reviewer">
            <option value="">请选择</option>
            <option v-for="member in reviewers" :key="member.subject" :value="member.subject">
              {{ member.displayName }}
            </option>
          </select></label
        >
        <button
          type="button"
          :disabled="!reason.trim() || !reviewer"
          @click="
            emit('reviewer', {
              reviewerSubject: reviewer,
              reason: reason.trim(),
              expectedVersion: round.version,
            })
          "
        >
          改派测试负责人
        </button>
      </template>
    </fieldset>
    <button v-if="canClaim" type="button" :disabled="busy" @click="emit('claim')">认领测试</button>
    <p v-if="!active">本轮{{ TEST_ROUND_STATE_LABELS[round.state] }}，历史记录只读。</p>
    <p v-else-if="readonly">仅本轮独立测试负责人可以签署结论。</p>
    <p v-if="counts">
      用例通过 {{ counts.passedCases }} / {{ counts.totalCases }}；未关闭缺陷
      {{ counts.openDefects }}。
    </p>
    <p v-else>尚未取得完整测试统计，请刷新后再判断。</p>
    <p>至少一条用例、全部用例通过且没有未关闭缺陷，才能整轮通过。</p>
    <label v-if="active && !readonly"
      >结论说明（退回时必填）<textarea
        v-model="reason"
        :disabled="busy"
        maxlength="4000"
        rows="4"
      />
    </label>
    <p v-if="error" role="alert">
      {{ error.message
      }}<ReferenceIdCopy v-if="error.referenceCode" :reference-id="error.referenceCode" />
    </p>
    <div v-if="active && !readonly" class="round-decision__actions">
      <button
        class="btn btn--primary"
        type="button"
        :disabled="!canPass"
        data-testid="round-decision-pass"
        @click="decide('passed')"
      >
        整轮通过
      </button>
      <button
        class="btn btn--ghost"
        type="button"
        :disabled="!writable || !reason.trim()"
        data-testid="round-decision-return"
        @click="decide('returned')"
      >
        退回修改
      </button>
    </div>
    <ol aria-label="轮次操作历史">
      <li v-for="entry in history" :key="entry.id">
        {{
          entry.action === 'withdraw'
            ? '撤回'
            : entry.action === 'decision'
              ? '签署结论'
              : '改派测试负责人'
        }}
        · {{ entry.actorSubject }} · {{ entry.createdAt }}
        <p>{{ entry.reason }}</p>
      </li>
    </ol>
    <button v-if="historyHasMore" type="button" :disabled="busy" @click="emit('moreHistory')">
      加载更多轮次历史
    </button>
  </section>
</template>
<style scoped>
.round-decision {
  display: grid;
  gap: var(--px-12);
}
h3,
p {
  margin: 0;
}
label {
  display: grid;
  gap: var(--px-4);
}
textarea {
  width: 100%;
  box-sizing: border-box;
  color: var(--ink);
  background: var(--panel);
  border: var(--bw) solid var(--line);
  border-radius: var(--r-md);
  padding: var(--px-8);
  font: inherit;
  resize: vertical;
}
.round-decision__actions {
  display: flex;
  gap: var(--px-8);
  flex-wrap: wrap;
}
</style>
