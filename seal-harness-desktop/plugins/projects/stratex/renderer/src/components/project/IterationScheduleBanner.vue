<script setup lang="ts">
import ReferenceIdCopy from '../ui/ReferenceIdCopy.vue';
import type { ProjectCollabNotice } from '../../stores/projectCollabErrors';

/**
 * 排期草案横幅（MIL-06，原型 `scheduleBanner28`）：「已调整 N 个节点，尚未保存」+ 取消调整 + 保存排期，
 * 以及这一目标的排期回执（草案被拒 / 保存成功 / 保存失败）。
 *
 * ⚠️ 回执**不依附于草案条数**：409 刷新后草案可能被对齐成空、保存成功后草案清空——那时横幅的
 *    按钮行消失，但「已被他人更新」「已保存」这句话仍要让人看见。带参考编号的是失败（alert），
 *    其余是状态回执（status）。
 */

const props = defineProps<{
  milestoneId: string;
  count: number;
  saving: boolean;
  canPlan: boolean;
  notice: ProjectCollabNotice | null;
}>();
const emit = defineEmits<{ cancel: []; save: [] }>();
</script>

<template>
  <div
    v-if="props.count > 0 || props.notice"
    class="schedule-banner"
    :data-testid="`iteration-schedule-banner-${milestoneId}`"
  >
    <div v-if="props.count > 0" class="schedule-banner__draft">
      <span :data-testid="`iteration-schedule-count-${milestoneId}`" :data-count="props.count">
        已调整 <b class="tnum">{{ props.count }}</b> 个节点，尚未保存
      </span>
      <span class="schedule-banner__grow"></span>
      <button
        class="btn btn--ghost"
        type="button"
        :disabled="props.saving"
        :data-testid="`iteration-schedule-cancel-${milestoneId}`"
        @click="emit('cancel')"
      >
        取消调整
      </button>
      <button
        class="btn btn--primary"
        type="button"
        :disabled="props.saving || !props.canPlan"
        :data-testid="`iteration-schedule-save-${milestoneId}`"
        @click="emit('save')"
      >
        {{ props.saving ? '正在保存…' : '保存排期' }}
      </button>
    </div>
    <p
      v-if="props.notice"
      class="schedule-banner__notice"
      :class="{ 'is-error': props.notice.referenceCode !== null }"
      :role="props.notice.referenceCode !== null ? 'alert' : 'status'"
      :data-testid="`iteration-schedule-notice-${milestoneId}`"
    >
      <span>{{ props.notice.message }}</span>
      <ReferenceIdCopy
        v-if="props.notice.referenceCode"
        :reference-id="props.notice.referenceCode"
      />
    </p>
  </div>
</template>

<style scoped>
.schedule-banner {
  display: flex;
  flex-direction: column;
  gap: var(--px-6);
}
.schedule-banner__draft {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--px-8);
  padding: var(--px-8) var(--px-10);
  border: var(--bw) solid var(--accent-line);
  border-radius: var(--r-sm);
  color: var(--ink);
  background: var(--accent-soft);
  font-size: var(--fs-200);
}
.schedule-banner__grow {
  flex: 1 1 auto;
}
.schedule-banner__notice {
  display: flex;
  align-items: center;
  gap: var(--px-8);
  margin: 0;
  padding: var(--px-6) var(--px-10);
  border: var(--bw) solid var(--line);
  border-radius: var(--r-sm);
  color: var(--muted);
  background: var(--sunken);
  font-size: var(--fs-200);
}
.schedule-banner__notice.is-error {
  border-color: var(--danger-line);
  color: var(--danger-text);
  background: var(--danger-soft);
}
</style>
