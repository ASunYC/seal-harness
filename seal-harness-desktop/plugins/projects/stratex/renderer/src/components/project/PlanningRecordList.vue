<script setup lang="ts">
import type { ProjectIterationRequirement } from '@shared/protocol/project-planning.js';

import PlanningEvidenceRefs from './PlanningEvidenceRefs.vue';
import { formatPlanningTime, planningStageRecordAction } from './planning-lifecycle-view';
import type { PlanningStageRecords } from '../../stores/projectCollabState';
import { useProjectCollabStore } from '../../stores/projectCollab';

/**
 * 只读的阶段记录 / 目标记录列表（原型 `goalRecordG1` 与 `archiveRecordsM1` 同一形态）：每条
 * 「时刻 · **动作** · 操作人」、说明、证据引用。业务目标的「目标记录 N」与已归档区共用。
 *
 * ⭐ 正文只经 REST（调用方传进来的就是 `.../events` 的读回）；操作人名字取名册，解析不到回落 subject。
 */

withDefaults(
  defineProps<{
    records: PlanningStageRecords['items'];
    /** 记录所属迭代的关联需求摘要（业务目标的记录不传）。 */
    linkedRequirements?: readonly ProjectIterationRequirement[];
    testId: string;
  }>(),
  { linkedRequirements: () => [] },
);

const store = useProjectCollabStore();

function actorName(subject: string): string {
  return store.detail?.members.find((member) => member.subject === subject)?.displayName || subject;
}
</script>

<template>
  <ol class="planning-records" :data-testid="testId">
    <li
      v-for="record in records"
      :key="record.id"
      class="planning-records__item"
      :data-testid="`${testId}-item`"
    >
      <p class="planning-records__head">
        {{ formatPlanningTime(record.occurredAt) }} ·
        <b>{{ planningStageRecordAction(record) }}</b>
        · {{ actorName(record.actorSubject) }}
      </p>
      <p v-if="record.reason" class="planning-records__note">{{ record.reason }}</p>
      <PlanningEvidenceRefs
        :tokens="record.evidenceRefs"
        :linked-requirements="linkedRequirements"
        :test-id="`${testId}-evidence`"
      />
    </li>
  </ol>
</template>

<style scoped>
.planning-records {
  display: flex;
  flex-direction: column;
  gap: var(--sp-2);
  margin: var(--sp-2) 0 0;
  padding: 0;
  list-style: none;
}
.planning-records__item {
  padding: var(--sp-2) var(--sp-3);
  border: var(--bw) solid var(--line);
  border-radius: var(--r-sm);
  color: var(--ink);
  background: var(--sunken);
  font-size: var(--fs-200);
}
.planning-records__head,
.planning-records__note {
  margin: 0;
  line-height: 1.7;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
.planning-records__head {
  color: var(--muted);
}
.planning-records__head b {
  color: var(--ink);
  font-weight: var(--fw-label);
}
</style>
