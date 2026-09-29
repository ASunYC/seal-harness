<script setup lang="ts">
import { computed, onMounted, watch } from 'vue';

import type { ProjectMilestoneListItem } from '@shared/protocol/project-planning.js';
import { PLANNING_EVIDENCE_LINK_PREFIX } from '@shared/protocol/project-planning-lifecycle.js';

import ReferenceIdCopy from '../ui/ReferenceIdCopy.vue';
import PlanningEvidenceRefs from './PlanningEvidenceRefs.vue';
import PlanningRecordList from './PlanningRecordList.vue';
import { GOAL_TEXT, goalAchievedAtText, goalHistoryTitle } from './planning-goal-view';
import { latestAcceptanceRecord } from './planning-lifecycle-view';
import type { PlanningLifecycleSubject } from '../../stores/projectCollabState';
import { useProjectCollabStore } from '../../stores/projectCollab';

/**
 * 业务目标展开卡里的「达成信息」与「目标记录 N」（MIL-07 界面段，原型 `goalRecordG1`）：**所有身份可读**。
 *
 * - 已达成：「已达成 · 达成时间 …」「验收说明 …」+ 证据引用（取最近一次确认达成的记录）；
 * - 「目标记录 N」可展开：每条「时刻 · 动作 · 操作人」、说明、证据引用。
 *
 * ⭐ 正文只经 REST：挂上即按 id 取这个目标的阶段记录（`.../events`）；记录达成 / 重新打开成功与
 *    `milestone.updated` 事件到达时由 store 按 id 重取（⛔ 事件负载里没有说明与证据，也不许从那里拼）。
 * ⭐ 证据里的外部链接走 `PlanningEvidenceRefs`（ADR-0036 两道校验），⛔ 本组件不碰地址。
 * ⚠️ 达成时刻不在目标行上（服务端刻意不加完成时间列）：记录没取全（`items < total`）时宁可不显示达成
 *    信息，也不把一条旧记录当成最近一次。
 */

const props = defineProps<{ projectId: string; milestone: ProjectMilestoneListItem }>();

const store = useProjectCollabStore();

const subject = computed<PlanningLifecycleSubject>(() => ({
  kind: 'milestone',
  row: props.milestone,
}));
const records = computed(() => store.planningStageRecordsFor(subject.value));
const acceptance = computed(() => latestAcceptanceRecord(records.value, props.milestone.status));

function reload(): void {
  void store.loadPlanningStageRecords(props.projectId, subject.value);
}
onMounted(reload);

// 证据芯片要认得出需求与资产的名字：记录里有非链接的引用、且还没取过时补取（与迭代计划详情同一做法）。
watch(
  () => records.value.items,
  (items) => {
    const needsNames = items.some((record) =>
      record.evidenceRefs.some((token) => !token.startsWith(PLANNING_EVIDENCE_LINK_PREFIX)),
    );
    if (!needsNames) return;
    if (store.files.length === 0) void store.loadFiles(props.projectId);
    if (store.todos.length === 0) void store.loadTodos(props.projectId);
  },
  { immediate: true },
);
</script>

<template>
  <section
    v-if="acceptance"
    class="goal-record__achieved"
    :aria-label="GOAL_TEXT.achievedRegion"
    :data-testid="`goal-achieved-${milestone.id}`"
  >
    <p class="goal-record__achievedHead">
      <b>{{ GOAL_TEXT.achieved }}</b>
      <span>{{ goalAchievedAtText(acceptance.occurredAt) }}</span>
    </p>
    <p class="goal-record__acceptance">
      <b>{{ GOAL_TEXT.acceptanceLabel }}</b
      >{{ acceptance.reason }}
    </p>
    <PlanningEvidenceRefs
      :tokens="acceptance.evidenceRefs"
      :test-id="`goal-achieved-${milestone.id}-evidence`"
    />
  </section>

  <p
    v-if="records.error && !records.loaded"
    class="goal-record__error"
    role="alert"
    :data-testid="`goal-records-error-${milestone.id}`"
  >
    <span>{{ records.error?.message }}</span>
    <ReferenceIdCopy
      v-if="records.error?.referenceCode"
      :reference-id="records.error?.referenceCode ?? ''"
    />
    <button class="btn btn--secondary btn--xs" type="button" @click="reload">重试</button>
  </p>

  <details
    v-if="records.total > 0"
    class="goal-record__history"
    :data-testid="`goal-history-${milestone.id}`"
  >
    <summary class="goal-record__historyTitle">{{ goalHistoryTitle(records.total) }}</summary>
    <PlanningRecordList
      :records="records.items"
      :test-id="`goal-history-${milestone.id}-records`"
    />
    <p v-if="records.items.length < records.total" class="goal-record__muted">
      共 {{ records.total }} 条，仅显示前 {{ records.items.length }} 条。
    </p>
  </details>
</template>

<style scoped>
.goal-record__achieved {
  margin-top: var(--px-12);
  padding: var(--px-10) var(--px-12);
  border: var(--bw) solid var(--line);
  border-radius: var(--r-md);
  color: var(--ink);
  background: var(--ok-soft);
}
.goal-record__achieved > p {
  margin: 0;
  font-size: var(--fs-200);
  line-height: 1.7;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
.goal-record__achievedHead {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 2px var(--px-12);
}
.goal-record__achievedHead b {
  color: var(--ok-text);
  font-size: var(--fs-300);
}
.goal-record__achievedHead span {
  color: var(--muted);
}
.goal-record__acceptance b {
  margin-right: var(--px-6);
  color: var(--muted);
  font-weight: var(--fw-label);
}
.goal-record__history {
  margin-top: var(--px-12);
  padding-top: var(--px-8);
  border-top: var(--bw) solid var(--line);
  font-size: var(--fs-200);
}
.goal-record__historyTitle {
  color: var(--muted);
  font-weight: var(--fw-label);
  cursor: pointer;
}
.goal-record__historyTitle:focus-visible {
  outline: none;
  box-shadow: var(--focus-ring-flat);
}
.goal-record__error {
  display: flex;
  align-items: center;
  gap: var(--sp-2);
  margin: var(--px-12) 0 0;
  color: var(--danger-text);
  font-size: var(--fs-200);
}
.goal-record__muted {
  margin: var(--px-6) 0 0;
  color: var(--muted2);
}
</style>
