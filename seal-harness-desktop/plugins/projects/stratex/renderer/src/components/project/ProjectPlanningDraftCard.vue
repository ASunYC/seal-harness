<script setup lang="ts">
import { computed, onMounted, onUnmounted, watch } from 'vue';

import type { ProjectPlanningDraft } from '@shared/protocol/project-planning-draft.js';

import ProjectPlanningDraftReviewDialog from './ProjectPlanningDraftReviewDialog.vue';
import { projectRuntime } from '../../../../../src/ui/runtime';
import { useProjectCollabStore } from '../../stores/projectCollab';
import {
  PLANNING_DRAFT_TEXT,
  useProjectPlanningDraftsStore,
} from '../../stores/projectPlanningDrafts';

/**
 * 项目会话里「助手提出的规划草案」卡（mil-11，ADR-0045）：每份草案一行，「检查并确认」开审阅弹层，「忽略」清暂存。
 *
 * ## 草案从哪来
 *
 * 草案只暂存在主进程（按账号×会话），渲染层看不见工具回包：进页、换会话、以及本会话的两件草案工具
 * 完成（`planningDraftSignal`）时各拉一次。⚠️ 拉之前把协作 store 的当前项目对齐到本会话的项目
 * （走 `openProject`，与需求草案卡同一个理由）：审阅弹层的负责人名单与角色判定都读当前项目详情。
 *
 * ## 不自动弹层
 *
 * 照原型：卡片摆在会话里等人来点。⛔ 没有草案时一格不占。
 *
 * ## 换号 / 换会话
 *
 * 清空并作废在途响应（store 的 `reset`）；拉取按请求者账号在主进程核对会话归属，别人会话的草案拿不到。
 */
const props = defineProps<{
  /** 本会话 id：草案按会话暂存。 */
  sessionId: string;
  /** 本会话挂靠的项目组 id；不挂项目的会话不该渲染本组件。 */
  projectId: string;
}>();

const collab = useProjectCollabStore();
const drafts = useProjectPlanningDraftsStore();
const runtime = projectRuntime();

let hydrateGeneration = 0;

const rows = computed(() => (drafts.sessionId === props.sessionId ? drafts.drafts : []));
/** ⛔ 0 份不出；能力未启用时也不出（fail-safe：宁可无入口）。 */
const visible = computed(() => collab.availability === true && rows.value.length > 0);
const reviewOpen = computed(
  () => drafts.sessionId === props.sessionId && drafts.reviewDraft !== null,
);

function kindLabel(draft: ProjectPlanningDraft): string {
  return draft.kind === 'milestone'
    ? PLANNING_DRAFT_TEXT.milestoneKind
    : PLANNING_DRAFT_TEXT.iterationKind;
}

async function hydrate(): Promise<void> {
  const { sessionId, projectId } = props;
  const generation = ++hydrateGeneration;
  const enabled = await collab.hydrateAvailability();
  if (!enabled || generation !== hydrateGeneration) return;
  if (collab.activeProjectId !== projectId) await collab.openProject(projectId);
  if (generation !== hydrateGeneration) return;
  await drafts.load(sessionId);
}

function restart(): void {
  hydrateGeneration += 1;
  drafts.reset();
  void hydrate();
}

function openReview(draftId: string): void {
  drafts.openReview(draftId);
  // 本地同名 / 周期校验读里程碑列表：只在真要审阅时取，进会话页不多打一次请求。
  if (collab.activeProjectId === props.projectId) void collab.loadMilestones(props.projectId);
}

function dismiss(draftId: string): void {
  void drafts.dismiss(draftId);
}

onMounted(() => {
  void hydrate();
});

onUnmounted(() => {
  hydrateGeneration += 1;
  drafts.reset();
});

watch(() => `${props.sessionId}\n${props.projectId}`, restart);

watch(
  () => collab.accountEpoch,
  () => restart(),
);

const stopAgent = runtime.api.onProjectAgentChanged(event => {
  if (event.projectId === props.projectId && event.sessionId === props.sessionId) void hydrate();
});
onUnmounted(stopAgent);

</script>

<template>
  <section
    v-if="visible"
    class="plancard"
    data-testid="session-planning-draft-card"
    role="status"
    :aria-label="PLANNING_DRAFT_TEXT.cardTitle"
  >
    <p class="plancard__hint">{{ PLANNING_DRAFT_TEXT.cardHint }}</p>
    <ul class="plancard__list">
      <li
        v-for="draft in rows"
        :key="draft.draftId"
        class="plancard__row"
        data-testid="session-planning-draft-row"
        :data-draft-id="draft.draftId"
      >
        <span class="plancard__text">
          <span class="plancard__kind">{{ kindLabel(draft) }}</span>
          <span class="plancard__sep" aria-hidden="true">·</span>
          <span class="plancard__name" data-testid="session-planning-draft-name">{{
            draft.name
          }}</span>
          <span
            v-if="draft.kind === 'iteration'"
            class="plancard__parent"
            data-testid="session-planning-draft-parent"
            >（{{ draft.milestoneName }}）</span
          >
        </span>
        <button
          class="btn btn--secondary plancard__action"
          type="button"
          data-testid="session-planning-draft-review"
          @click="openReview(draft.draftId)"
        >
          {{ PLANNING_DRAFT_TEXT.reviewAction }}
        </button>
        <button
          class="btn btn--ghost plancard__action"
          type="button"
          :disabled="drafts.dismissingDraftId !== null"
          data-testid="session-planning-draft-dismiss"
          @click="dismiss(draft.draftId)"
        >
          {{ PLANNING_DRAFT_TEXT.dismissAction }}
        </button>
      </li>
    </ul>
  </section>

  <ProjectPlanningDraftReviewDialog v-if="reviewOpen" :project-id="props.projectId" />
</template>

<style scoped>
/* 与需求草案卡同一套配色：讲的是「有东西等你决定」，不是故障，所以用 accent 而不是 warn/danger。 */
.plancard {
  display: flex;
  flex-direction: column;
  gap: var(--sp-2);
  padding: var(--sp-2) var(--sp-3);
  border: var(--bw) solid var(--accent-line);
  border-radius: var(--r-lg);
  background: var(--accent-soft);
}
.plancard__hint {
  margin: 0;
  color: var(--muted2);
  font-size: var(--fs-100);
  line-height: var(--lh-body);
}
.plancard__list {
  display: flex;
  flex-direction: column;
  gap: var(--sp-1);
  margin: 0;
  padding: 0;
  list-style: none;
}
.plancard__row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--sp-2) var(--sp-3);
}
.plancard__text {
  min-width: 0;
  flex: 1;
  color: var(--ink);
  font-size: var(--fs-meta);
  line-height: var(--lh-body);
  overflow-wrap: anywhere;
}
.plancard__kind {
  color: var(--accent-text);
  font-weight: var(--fw-label);
  white-space: nowrap;
}
.plancard__sep {
  margin: 0 var(--sp-1);
  color: var(--muted2);
}
.plancard__parent {
  color: var(--muted2);
}
.plancard__action {
  flex: 0 0 auto;
}
</style>
