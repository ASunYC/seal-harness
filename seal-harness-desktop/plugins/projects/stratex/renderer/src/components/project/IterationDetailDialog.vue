<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';

import { planningLifecycleActionFor } from '@shared/protocol/project-planning-lifecycle.js';

import ReferenceIdCopy from '../ui/ReferenceIdCopy.vue';
import ProjectDialogShell from './ProjectDialogShell.vue';
import { PLANNING_FORM_TEXT } from './planning-form-view';
import {
  formatPlanningTime,
  latestAcceptanceRecord,
  PLANNING_LIFECYCLE_COPY,
  planningEvidenceLabel,
  planningStageRecordAction,
} from './planning-lifecycle-view';
import { TODO_STATUS_LABELS } from './project-format';
import {
  formatPlanningDate,
  ITERATION_STATUS_LABELS,
  PLANNING_UNASSIGNED_OWNER_LABEL,
} from './project-planning-view';
import type { ProjectCollabNotice } from '../../stores/projectCollabErrors';
import { livePlanningRow } from '../../stores/projectCollabPlanningLifecycle';
import type { PlanningLifecycleSubject } from '../../stores/projectCollabState';
import { useProjectCollabStore } from '../../stores/projectCollab';

/**
 * 「迭代计划详情」弹层（MIL-07 · C3）：照原型 `stageDetail28`（:2694）——名称、状态 · 到期 ·
 * 负责人、完成标准与关联需求、**阶段记录**（时间 · 动作 · 说明），manager+ 另有「记录达成 /
 * 重新打开」工具条。
 *
 * ⭐ 阶段记录**只经 REST**（`store.planningStageRecordsFor` ← `.../events`）：说明、证据、原因是
 *    用户亲笔正文，事件流负载里没有，⛔ 本组件也不从任何事件里拼。事件到达时 store 按 id 重取。
 * ⭐ 已归档的迭代计划照样读得到阶段记录：本组件持有打开时的快照，行从列表里消失（被他人归档）
 *    也不关，只把工具条收起（归档＝这条线收口了，不再摆动作入口）。
 * ⭐ MIL-09 补齐原型工具条：「编辑迭代计划」打开整条表单弹层（已达成的轮次照原型提示先重新打开），
 *    「归档此迭代计划」走二次确认（已达成的迭代可直接归档，不必先重开；MIL-10 起在排需求随归档一并移出，
 *    不再就地拒绝，见 ADR-0040）。
 */

const props = defineProps<{ projectId: string }>();

const store = useProjectCollabStore();

const subject = computed(() => {
  const current = store.planningDetail;
  return current !== null && current.kind === 'iteration'
    ? (current as Extract<PlanningLifecycleSubject, { kind: 'iteration' }>)
    : null;
});
const row = computed(() => (subject.value ? livePlanningRow(store, subject.value) : null));
const records = computed(() =>
  subject.value ? store.planningStageRecordsFor(subject.value) : null,
);
const archived = computed(() => row.value?.archivedAt != null);
const canAct = computed(() => store.canManagePlanning && !archived.value);
const nextAction = computed(() => planningLifecycleActionFor(row.value?.status ?? 'open'));

const memberNames = computed(() => {
  const map = new Map<string, string>();
  for (const member of store.detail?.members ?? []) map.set(member.subject, member.displayName);
  return map;
});
const ownerLabel = computed(() => {
  const owner = row.value?.ownerSubject ?? null;
  return owner ? memberNames.value.get(owner) || owner : PLANNING_UNASSIGNED_OWNER_LABEL;
});
const acceptance = computed(() =>
  records.value && row.value ? latestAcceptanceRecord(records.value, row.value.status) : null,
);
const evidenceSources = computed(() => ({
  linkedRequirements: row.value?.linkedRequirements ?? [],
  members: store.detail?.members ?? [],
  files: store.files,
  todos: store.todos,
}));
function evidenceChips(tokens: readonly string[]) {
  return tokens.map((token) => {
    const label = planningEvidenceLabel(token, evidenceSources.value);
    // 「类别 · 名称」：分隔符连同尾随空格放进类别文字里，读屏与复制出来的文字都是完整一句。
    return { token, ...label, kindPrefix: label.kindLabel ? `${label.kindLabel} · ` : null };
  });
}

// 证据芯片要认得出资产与待办的名字：未取过就补取（与动态页的引用同一做法）。
onMounted(() => {
  if (store.files.length === 0) void store.loadFiles(props.projectId);
  if (store.todos.length === 0) void store.loadTodos(props.projectId);
});

function retryRecords(): void {
  if (subject.value) void store.loadPlanningStageRecords(props.projectId, subject.value);
}

function openLifecycle(): void {
  if (!subject.value || !row.value || !canAct.value) return;
  store.openPlanningLifecycle({ ...subject.value, row: row.value }, nextAction.value);
}

/** 打开证据里的外部链接失败时的回执（成功不提示：系统浏览器自己会出来）。 */
const linkNotice = ref<ProjectCollabNotice | null>(null);
async function openLink(href: string): Promise<void> {
  linkNotice.value = null;
  linkNotice.value = await store.openPlanningEvidenceLink(href);
}

/* MIL-09：编辑与归档。 */
function openEdit(): void {
  if (!subject.value || !row.value || !canAct.value || subject.value.milestoneId === null) return;
  store.openIterationForm(props.projectId, subject.value.milestoneId, row.value);
}

const confirmArchive = ref(false);
const archiving = ref(false);
const archiveNotice = ref<ProjectCollabNotice | null>(null);

function askArchive(): void {
  archiveNotice.value = null;
  confirmArchive.value = true;
}
function cancelArchive(): void {
  archiveNotice.value = null;
  confirmArchive.value = false;
}
async function submitArchive(): Promise<void> {
  if (!subject.value || !row.value || archiving.value || subject.value.milestoneId === null) return;
  archiving.value = true;
  try {
    const result = await store.confirmIterationArchive({
      projectId: props.projectId,
      milestoneId: subject.value.milestoneId,
      iteration: row.value,
    });
    if (result.outcome !== 'ok') archiveNotice.value = result.notice;
  } finally {
    archiving.value = false;
  }
}
</script>

<template>
  <ProjectDialogShell
    v-if="subject && row && records"
    title="迭代计划详情"
    @close="store.closePlanningDetail()"
  >
    <div class="stage-detail" data-testid="iteration-detail-dialog">
      <h3 class="stage-detail__name">{{ row.name }}</h3>
      <p class="stage-detail__meta" data-testid="iteration-detail-meta">
        {{ ITERATION_STATUS_LABELS[row.status] }} · {{ formatPlanningDate(row.dueAt) }} ·
        {{ ownerLabel }}
        <span v-if="archived" class="stage-detail__tag">已归档</span>
      </p>

      <section class="stage-detail__block">
        <p class="stage-detail__criteria">
          <b>完成标准</b> {{ row.criteriaMd.trim() || '待补充' }}
        </p>
        <ul v-if="row.linkedRequirements.length > 0" class="stage-detail__requirements">
          <li v-for="item in row.linkedRequirements" :key="item.requirementId">
            <span class="stage-detail__requirementTitle">{{ item.title }}</span>
            <span class="stage-detail__badge">{{ TODO_STATUS_LABELS[item.status] }}</span>
          </li>
        </ul>
        <p v-else class="stage-detail__muted">暂无关联需求。</p>
        <p
          v-if="acceptance"
          class="stage-detail__acceptance"
          data-testid="iteration-detail-acceptance"
        >
          验收：{{ acceptance.reason }} · {{ formatPlanningTime(acceptance.occurredAt) }}
        </p>
      </section>

      <section class="stage-detail__records" data-testid="iteration-stage-records">
        <h4 class="stage-detail__recordsTitle">
          阶段记录
          <span data-testid="iteration-stage-record-count" :data-count="records.total">{{
            records.total
          }}</span>
        </h4>
        <p v-if="records.loading && !records.loaded" class="stage-detail__muted" role="status">
          正在加载阶段记录…
        </p>
        <p
          v-else-if="records.error && !records.loaded"
          class="stage-detail__error"
          role="alert"
          data-testid="iteration-stage-records-error"
        >
          <span>{{ records.error?.message }}</span>
          <ReferenceIdCopy
            v-if="records.error?.referenceCode"
            :reference-id="records.error.referenceCode"
          />
          <button class="btn btn--secondary btn--xs" type="button" @click="retryRecords">
            重试
          </button>
        </p>
        <p v-else-if="records.items.length === 0" class="stage-detail__muted">暂无阶段记录。</p>
        <ol v-else class="stage-detail__list">
          <li
            v-for="record in records.items"
            :key="record.id"
            class="stage-detail__record"
            data-testid="iteration-stage-record"
          >
            <p class="stage-detail__recordLine">
              {{ formatPlanningTime(record.occurredAt) }} ·
              {{ planningStageRecordAction(record) }} ·
              {{ record.reason }}
            </p>
            <div v-if="record.evidenceRefs.length > 0" class="stage-detail__refs">
              <template v-for="chip in evidenceChips(record.evidenceRefs)" :key="chip.token">
                <!-- 外部链接：交主进程二次校验后给系统浏览器，⛔ 不渲染成会自己跳转的超链接。 -->
                <button
                  v-if="chip.href"
                  class="stage-detail__ref stage-detail__ref--link"
                  type="button"
                  :title="chip.href"
                  data-testid="iteration-stage-record-link"
                  @click="openLink(chip.href)"
                >
                  <span class="stage-detail__refKind">{{ chip.kindPrefix }}</span>
                  <b>{{ chip.name }}</b>
                </button>
                <span v-else class="stage-detail__ref" data-testid="iteration-stage-record-ref">
                  <span v-if="chip.kindPrefix" class="stage-detail__refKind">{{
                    chip.kindPrefix
                  }}</span>
                  <b>{{ chip.name }}</b>
                </span>
              </template>
            </div>
          </li>
        </ol>
        <p v-if="records.items.length < records.total" class="stage-detail__muted">
          共 {{ records.total }} 条，仅显示前 {{ records.items.length }} 条。
        </p>
        <p
          v-if="linkNotice"
          class="stage-detail__error"
          role="alert"
          data-testid="iteration-detail-link-notice"
        >
          <span>{{ linkNotice.message }}</span>
          <ReferenceIdCopy
            v-if="linkNotice.referenceCode"
            :reference-id="linkNotice.referenceCode"
          />
        </p>
      </section>
    </div>

    <section
      v-if="canAct && confirmArchive"
      class="stage-detail__archive"
      data-testid="iteration-detail-archive-confirm"
    >
      <p class="stage-detail__muted">{{ PLANNING_FORM_TEXT.iterationArchiveConfirm }}</p>
      <p
        v-if="archiveNotice"
        class="stage-detail__error"
        role="alert"
        data-testid="iteration-detail-archive-notice"
      >
        <span>{{ archiveNotice.message }}</span>
        <ReferenceIdCopy
          v-if="archiveNotice.referenceCode"
          :reference-id="archiveNotice.referenceCode"
        />
      </p>
    </section>

    <template v-if="canAct" #foot>
      <template v-if="confirmArchive">
        <button
          class="btn btn--ghost"
          type="button"
          :disabled="archiving"
          data-testid="iteration-detail-archive-cancel"
          @click="cancelArchive"
        >
          取消
        </button>
        <button
          class="btn btn--primary btn--danger"
          type="button"
          :disabled="archiving"
          data-testid="iteration-detail-archive-submit"
          @click="submitArchive"
        >
          {{ archiving ? '归档中…' : '确认归档' }}
        </button>
      </template>
      <template v-else>
        <button
          class="btn btn--ghost stage-detail__archiveEntry"
          type="button"
          data-testid="iteration-detail-archive"
          @click="askArchive"
        >
          归档此迭代计划
        </button>
        <button
          class="btn btn--ghost"
          type="button"
          data-testid="iteration-detail-edit"
          @click="openEdit"
        >
          编辑迭代计划
        </button>
        <button
          class="btn btn--primary"
          type="button"
          data-testid="iteration-detail-lifecycle"
          @click="openLifecycle"
        >
          {{ PLANNING_LIFECYCLE_COPY[nextAction].entry }}
        </button>
      </template>
    </template>
  </ProjectDialogShell>
</template>

<style scoped>
.stage-detail__archive {
  display: flex;
  flex-direction: column;
  gap: var(--sp-2);
  margin-top: var(--sp-3);
}
.stage-detail__archiveEntry {
  margin-right: auto;
  color: var(--danger-text);
}
.stage-detail {
  display: flex;
  flex-direction: column;
  gap: var(--sp-3);
}
.stage-detail__name {
  margin: 0;
  color: var(--ink);
  font-size: var(--fs-body);
  font-weight: var(--fw-title);
}
.stage-detail__meta {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--sp-1);
  margin: 0;
  color: var(--muted);
  font-size: var(--fs-meta);
}
.stage-detail__tag,
.stage-detail__badge {
  padding: 0 var(--sp-2);
  border-radius: var(--r-pill);
  color: var(--muted2);
  background: var(--sunken);
  font-size: var(--fs-100);
}
.stage-detail__block {
  display: flex;
  flex-direction: column;
  gap: var(--sp-2);
  padding: var(--sp-3);
  border: var(--bw) solid var(--line);
  border-radius: var(--r-md);
  background: var(--sunken);
}
.stage-detail__criteria,
.stage-detail__acceptance {
  margin: 0;
  color: var(--ink);
  font-size: var(--fs-meta);
  line-height: 1.7;
  white-space: pre-wrap;
}
.stage-detail__requirements {
  display: flex;
  flex-direction: column;
  gap: var(--sp-1);
  margin: 0;
  padding: 0;
  list-style: none;
}
.stage-detail__requirements li {
  display: flex;
  align-items: center;
  gap: var(--sp-2);
  font-size: var(--fs-meta);
}
.stage-detail__requirementTitle {
  overflow: hidden;
  color: var(--ink);
  text-overflow: ellipsis;
  white-space: nowrap;
}
.stage-detail__records {
  display: flex;
  flex-direction: column;
  gap: var(--sp-2);
}
.stage-detail__recordsTitle {
  display: flex;
  align-items: center;
  gap: var(--sp-2);
  margin: 0;
  color: var(--ink);
  font-size: var(--fs-meta);
  font-weight: var(--fw-title);
}
.stage-detail__list {
  display: flex;
  flex-direction: column;
  gap: var(--sp-2);
  margin: 0;
  padding: 0;
  list-style: none;
}
.stage-detail__record {
  display: flex;
  flex-direction: column;
  gap: var(--sp-1);
  padding-bottom: var(--sp-2);
  border-bottom: var(--bw) solid var(--line);
}
.stage-detail__recordLine {
  margin: 0;
  color: var(--ink);
  font-size: var(--fs-meta);
  line-height: 1.7;
  overflow-wrap: anywhere;
  white-space: pre-wrap;
}
.stage-detail__refs {
  display: flex;
  flex-wrap: wrap;
  gap: var(--sp-2);
}
.stage-detail__ref {
  display: inline-flex;
  align-items: center;
  gap: var(--sp-1);
  padding: 0 var(--sp-2);
  border: var(--bw) solid var(--line);
  border-radius: var(--r-md);
  color: var(--ink);
  background: var(--panel);
  font-size: var(--fs-100);
}
.stage-detail__refKind {
  color: var(--muted);
}
/* 链接芯片是按钮（交主进程打开），外形与其它芯片同一行同一套，只多可点的反馈。 */
.stage-detail__ref--link {
  font: inherit;
  font-size: var(--fs-100);
  line-height: inherit;
  cursor: pointer;
  transition:
    border-color var(--dur-1) var(--ease-out),
    color var(--dur-1) var(--ease-out);
}
.stage-detail__ref--link b {
  color: var(--accent);
  font-weight: var(--fw-label);
}
.stage-detail__ref--link:hover {
  border-color: var(--accent);
}
.stage-detail__ref--link:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 1px;
}
.stage-detail__muted {
  margin: 0;
  color: var(--muted2);
  font-size: var(--fs-meta);
}
.stage-detail__error {
  display: flex;
  align-items: center;
  gap: var(--sp-2);
  margin: 0;
  color: var(--danger-text);
  font-size: var(--fs-meta);
}
</style>
