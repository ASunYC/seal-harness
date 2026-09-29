<script setup lang="ts">
import { ref, watch } from 'vue';
import type { ProjectCollabNotice } from '../../stores/projectCollabErrors';
import ReferenceIdCopy from '../ui/ReferenceIdCopy.vue';
import type { RequirementSubmissionBlock } from './requirement-submission';

/**
 * 单屏需求详情底部的提测块（TST-02，原型 `renderDetail` 的 `.submission`）。
 *
 * 只呈现、只发意图：块的内容（提交 / 等待验证）由 `requirementSubmissionBlock` 算好传进来，
 * 点「提交需求测试 →」上冒 `submit`，由看板层开整条需求提测弹窗。
 * 撤回能力由上层按当前轮次与身份传入，默认隐藏；仅发出带轮次版本的意图，失败保留原因。
 */
const props = withDefaults(
  defineProps<{
    block: RequirementSubmissionBlock;
    canWithdraw?: boolean;
    busy?: boolean;
    error?: ProjectCollabNotice | null;
    currentVersion?: number | null;
  }>(),
  { canWithdraw: false, busy: false, error: null, currentVersion: null },
);
const reason = ref('');
watch(
  () => props.canWithdraw,
  (value) => {
    if (!value) reason.value = '';
  },
);

const emit = defineEmits<{
  submit: [];
  withdraw: [value: { reason: string; expectedVersion: number }];
}>();
function withdraw() {
  if (
    props.block.kind !== 'waiting' ||
    !props.canWithdraw ||
    props.busy ||
    props.currentVersion == null ||
    !reason.value.trim()
  )
    return;
  emit('withdraw', { reason: reason.value.trim(), expectedVersion: props.currentVersion });
}
</script>

<template>
  <div
    class="req-submission"
    :data-kind="block.kind"
    :role="block.kind === 'waiting' ? 'status' : undefined"
    data-testid="requirement-detail-submission"
  >
    <div class="req-submission__text">
      <h3 class="req-submission__title">{{ block.title }}</h3>
      <p class="req-submission__note">{{ block.note }}</p>
    </div>
    <button
      v-if="block.kind === 'submit'"
      class="btn btn--primary req-submission__action"
      type="button"
      data-testid="requirement-detail-submit-test"
      @click="emit('submit')"
    >
      {{ block.actionLabel }}
    </button>
    <div v-if="block.kind === 'waiting' && canWithdraw" class="req-submission__withdraw">
      <label
        >撤回原因<textarea v-model="reason" :disabled="busy" rows="2" maxlength="4000" />
      </label>
      <p v-if="error" role="alert">
        {{ error.message
        }}<ReferenceIdCopy v-if="error.referenceCode" :reference-id="error.referenceCode" />
      </p>
      <button
        type="button"
        class="btn btn--ghost"
        :disabled="busy || currentVersion == null || !reason.trim()"
        data-testid="round-withdraw"
        @click="withdraw"
      >
        撤回本轮
      </button>
    </div>
  </div>
</template>

<style scoped>
.req-submission__withdraw {
  display: grid;
  gap: var(--px-8);
  width: 100%;
}
.req-submission__withdraw label {
  display: grid;
  gap: var(--px-4);
}
textarea {
  color: var(--ink);
  background: var(--panel);
  border: var(--bw) solid var(--line);
  border-radius: var(--r-md);
  padding: var(--px-8);
  font: inherit;
  resize: vertical;
}
/* 原型 .submission：描边卡片、左文右钮、两端对齐；窄时按钮换到下一行。 */
.req-submission {
  display: flex;
  min-width: 0;
  flex: 1;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: var(--px-8) var(--px-12);
  padding: var(--px-10) var(--px-14);
  border: var(--bw) solid var(--line);
  border-radius: var(--r-md);
  background: var(--panel);
}
/* 等待验证是「内容已冻结」的状态说明：警示底，与待验收药丸同一族颜色。 */
.req-submission[data-kind='waiting'] {
  border-color: var(--warn-line);
  background: var(--warn-soft);
}
.req-submission__text {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: var(--px-2);
}
.req-submission__title {
  margin: 0;
  color: var(--ink);
  font-size: var(--fs-300);
  font-weight: var(--fw-title);
  overflow-wrap: anywhere;
}
.req-submission__note {
  margin: 0;
  color: var(--muted);
  font-size: var(--fs-200);
  line-height: var(--lh-1p5);
}
.req-submission__action {
  flex: none;
}
</style>
