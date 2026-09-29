<script setup lang="ts">
import { computed, ref } from 'vue';

import type {
  ProjectIterationListItem,
  ProjectMilestoneListItem,
} from '@shared/protocol/project-planning.js';

import ReferenceIdCopy from '../ui/ReferenceIdCopy.vue';
import PlanningRecordList from './PlanningRecordList.vue';
import { formatPlanningTime } from './planning-lifecycle-view';
import { formatPlanningPeriod, ITERATION_STATUS_LABELS } from './project-planning-view';
import type { PlanningLifecycleSubject } from '../../stores/projectCollabState';
import { useProjectCollabStore } from '../../stores/projectCollab';

/**
 * 「已归档里程碑 N」/「已归档迭代计划 N」（MIL-09）：原型两段都是折叠的 `<details>`，**所有身份只读**，
 * 没有恢复入口。展开一条才按 id 取它的阶段记录（正文只经 REST）；已归档的里程碑另列它下面的迭代计划。
 * 每条记录照原型 `archiveRecordsM1`：时刻 · 动作 · 操作人、说明、证据引用（外部链接走 ADR-0036 两道校验）。
 *
 * ⚠️ 与原型的偏离：原型条目里有「归档人」，服务端业务目标 / 迭代计划行上没有归档人字段，本期不显示。
 */

const props = defineProps<{
  projectId: string;
  kind: 'milestone' | 'iteration';
  /** `kind === 'iteration'` 时必填：哪个业务目标下的已归档迭代计划。 */
  milestoneId?: string;
}>();

const store = useProjectCollabStore();

const list = computed(() =>
  props.kind === 'milestone'
    ? store.archivedMilestones
    : (store.archivedIterations[props.milestoneId ?? ''] ?? null),
);
const heading = computed(() => (props.kind === 'milestone' ? '已归档里程碑' : '已归档迭代计划'));
const opened = ref<ReadonlySet<string>>(new Set());

function subjectOf(
  row: ProjectMilestoneListItem | ProjectIterationListItem,
): PlanningLifecycleSubject {
  return props.kind === 'milestone'
    ? { kind: 'milestone', row: row as ProjectMilestoneListItem }
    : {
        kind: 'iteration',
        milestoneId: props.milestoneId ?? null,
        row: row as ProjectIterationListItem,
      };
}

function recordsOf(row: ProjectMilestoneListItem | ProjectIterationListItem) {
  return store.planningStageRecordsFor(subjectOf(row));
}

/** 迭代计划的记录按它自己的关联需求摘要认证据名字；业务目标没有这份摘要。 */
function linkedRequirementsOf(row: ProjectMilestoneListItem | ProjectIterationListItem) {
  return props.kind === 'iteration' ? (row as ProjectIterationListItem).linkedRequirements : [];
}

/** 已归档里程碑下的迭代计划：未归档的（列表缓存）与已归档的一起列。 */
function roundsOf(milestoneId: string): readonly ProjectIterationListItem[] {
  return [
    ...(store.milestoneIterations[milestoneId] ?? []),
    ...(store.archivedIterations[milestoneId]?.items ?? []),
  ];
}

function onToggle(row: ProjectMilestoneListItem | ProjectIterationListItem, event: Event): void {
  const open = (event.target as HTMLDetailsElement).open;
  const next = new Set(opened.value);
  if (open) next.add(row.id);
  else next.delete(row.id);
  opened.value = next;
  if (!open) return;
  void store.loadPlanningStageRecords(props.projectId, subjectOf(row));
  // 证据芯片要认得出需求与资产的名字：未取过就补取（与迭代计划详情同一做法）。
  if (store.files.length === 0) void store.loadFiles(props.projectId);
  if (store.todos.length === 0) void store.loadTodos(props.projectId);
  if (props.kind === 'milestone') {
    void store.loadMilestoneIterations(props.projectId, row.id);
    void store.loadArchivedIterations(props.projectId, row.id);
  }
}

function archivedLine(row: ProjectMilestoneListItem | ProjectIterationListItem): string {
  const archivedAt = row.archivedAt ? `归档于 ${formatPlanningTime(row.archivedAt)}` : '';
  if (props.kind === 'milestone') {
    const milestone = row as ProjectMilestoneListItem;
    return [milestone.name, formatPlanningPeriod(milestone.startAt, milestone.dueAt), archivedAt]
      .filter(Boolean)
      .join(' · ');
  }
  const iteration = row as ProjectIterationListItem;
  return [iteration.name, iteration.status === 'completed' ? '已达成' : '未达成', archivedAt]
    .filter(Boolean)
    .join(' · ');
}
</script>

<template>
  <details
    v-if="list && list.loaded && list.total > 0"
    class="archived-planning"
    :data-testid="
      kind === 'milestone' ? 'archived-milestones' : `archived-iterations-${milestoneId}`
    "
  >
    <summary class="archived-planning__summary">
      {{ heading }} <b class="tnum" :data-count="list.total">{{ list.total }}</b>
    </summary>
    <p v-if="list.error" class="archived-planning__error" role="alert">
      <span>{{ list.error.message }}</span>
      <ReferenceIdCopy v-if="list.error.referenceCode" :reference-id="list.error.referenceCode" />
    </p>
    <ul class="archived-planning__list">
      <li v-for="row in list.items" :key="row.id" class="archived-planning__item">
        <details :data-testid="`archived-planning-item-${row.id}`" @toggle="onToggle(row, $event)">
          <summary class="archived-planning__line">{{ archivedLine(row) }}</summary>
          <template v-if="opened.has(row.id)">
            <p
              v-if="recordsOf(row).loading && !recordsOf(row).loaded"
              class="archived-planning__muted"
              role="status"
            >
              正在加载阶段记录…
            </p>
            <!-- 取不到不说成「暂无」：没加载成功过就是失败态。 -->
            <p
              v-else-if="recordsOf(row).error && !recordsOf(row).loaded"
              class="archived-planning__error"
              role="alert"
              :data-testid="`archived-planning-records-error-${row.id}`"
            >
              <span>{{ recordsOf(row).error?.message }}</span>
              <ReferenceIdCopy
                v-if="recordsOf(row).error?.referenceCode"
                :reference-id="recordsOf(row).error?.referenceCode ?? ''"
              />
            </p>
            <p v-else-if="recordsOf(row).items.length === 0" class="archived-planning__muted">
              暂无阶段记录
            </p>
            <PlanningRecordList
              v-else
              :records="recordsOf(row).items"
              :linked-requirements="linkedRequirementsOf(row)"
              :test-id="`archived-planning-records-${row.id}`"
            />
            <ul v-if="kind === 'milestone'" class="archived-planning__rounds">
              <li v-if="roundsOf(row.id).length === 0" class="archived-planning__muted">
                暂无迭代计划
              </li>
              <li v-for="round in roundsOf(row.id)" :key="round.id">
                {{ round.name }} · {{ ITERATION_STATUS_LABELS[round.status] }}
                <template v-if="round.archivedAt"> · 已归档</template>
              </li>
            </ul>
          </template>
        </details>
      </li>
    </ul>
    <p v-if="list.items.length < list.total" class="archived-planning__muted">
      共 {{ list.total }} 条，仅列出前 {{ list.items.length }} 条。
    </p>
  </details>
</template>

<style scoped>
.archived-planning {
  margin-top: var(--px-12);
  color: var(--muted);
  font-size: var(--fs-meta);
}
.archived-planning__summary {
  cursor: pointer;
  color: var(--muted);
}
.archived-planning__summary b {
  color: var(--ink);
}
.archived-planning__summary:focus-visible,
.archived-planning__line:focus-visible {
  outline: none;
  box-shadow: var(--focus-ring-flat);
}
.archived-planning__list,
.archived-planning__rounds {
  display: flex;
  flex-direction: column;
  gap: var(--px-6);
  margin: var(--px-8) 0 0;
  padding: 0 0 0 var(--px-14);
  list-style: none;
}
.archived-planning__line {
  color: var(--ink);
  cursor: pointer;
  overflow-wrap: anywhere;
}
.archived-planning__muted {
  margin: var(--px-6) 0 0;
  color: var(--muted2);
  font-size: var(--fs-200);
}
.archived-planning__error {
  display: flex;
  align-items: center;
  gap: var(--sp-2);
  color: var(--danger-text);
}
</style>
