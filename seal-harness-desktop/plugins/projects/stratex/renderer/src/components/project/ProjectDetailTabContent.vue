<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useProjectCollabStore } from '../../stores/projectCollab';
import ProjectWorkOverview from './ProjectWorkOverview.vue';
import AppIcon from '../ui/AppIcon.vue';
import ProjectAssetsPane from './ProjectAssetsPane.vue';
import ProjectBoardPane from './ProjectBoardPane.vue';
import ProjectChatPane from './ProjectChatPane.vue';
import ProjectFeedPane from './ProjectFeedPane.vue';
import ProjectMilestonesPane from './ProjectMilestonesPane.vue';
import ProjectSessionsPane from './ProjectSessionsPane.vue';
import ProjectTestRoundPane from './ProjectTestRoundPane.vue';
import ProjectTestingPane from './ProjectTestingPane.vue';
import { useProjectServiceCapabilitiesStore } from '../../stores/projectCollabCapabilities';
import type { ProjectTab } from './project-tabs';
import type { ProjectRefTodoFocus, ProjectRefTodoTab } from './project-ref-navigation';
import type { ProjectRefTarget } from './project-refs';

const store = useProjectCollabStore();
const capabilities = useProjectServiceCapabilitiesStore();

// 此组件只负责业务页签呈现；取数、引用规划和助理草稿仍归项目页。
const props = defineProps<{
  activeTab: ProjectTab;
  projectId: string;
  accountEpoch: number;
  projectEpoch: number;
  todoFocus: { readonly tab: ProjectRefTodoTab; readonly request: ProjectRefTodoFocus } | null;
  assetFocusFileId: string | null;
  hasTestRound: boolean;
  placeholderCopy: { readonly title: string; readonly note: string } | null;
}>();
const requirementTitles = computed<Readonly<Record<string, string>>>(() =>
  Object.fromEntries(
    store.requirementItems
      .filter((item) => item.projectId === props.projectId && item.itemKind === 'requirement')
      .map((item) => [item.id, item.title]),
  ),
);
watch(
  () =>
    [
      props.projectId,
      props.activeTab,
      props.hasTestRound,
      capabilities.supportsRequirementTestCases,
    ] as const,
  ([projectId, tab, hasRound, enabled]) => {
    if (tab === 'tests' && !hasRound && enabled) void store.loadProjectTestRounds(projectId);
  },
  { immediate: true },
);
const emit = defineEmits<{
  openRef: [ProjectRefTarget];
  openExecution: [string];
  decompose: [string];
  openMilestones: [string | null];
  todoFocusHandled: [boolean];
  assetFocusHandled: [boolean];
  start: [];
  back: [];
  openRequirement: [string];
}>();
const overviewOpen = ref(false);
watch(
  () => [props.projectId, props.accountEpoch, props.projectEpoch, props.activeTab],
  () => {
    overviewOpen.value = false;
  },
  { flush: 'sync' },
);
watch(
  () => props.todoFocus,
  (focus) => {
    if (focus?.tab === 'tasks') overviewOpen.value = false;
  },
  { flush: 'sync' },
);
</script>

<template>
  <div class="project-detail__pane">
    <ProjectFeedPane
      v-if="activeTab === 'feed'"
      :project-id="projectId"
      @open-ref="emit('openRef', $event)"
    />
    <ProjectChatPane
      v-else-if="activeTab === 'chat'"
      :project-id="projectId"
      @open-ref="emit('openRef', $event)"
    />
    <ProjectBoardPane
      v-else-if="activeTab === 'requirements'"
      :project-id="projectId"
      scope="requirement"
      :focus-request="todoFocus?.tab === activeTab ? todoFocus.request : null"
      @open-ref="emit('openRef', $event)"
      @open-execution="emit('openExecution', $event)"
      @decompose="emit('decompose', $event)"
      @open-milestones="emit('openMilestones', $event)"
      @focus-handled="emit('todoFocusHandled', $event)"
    />
    <template v-else-if="activeTab === 'tasks'">
      <ProjectWorkOverview
        :project-id="projectId"
        :account-epoch="accountEpoch"
        :project-epoch="projectEpoch"
        :compact="!overviewOpen"
        @toggle-overview="overviewOpen = !overviewOpen"
        @open-ref="emit('openRef', $event)"
      />
      <div v-show="!overviewOpen" class="project-detail__task-list">
        <ProjectBoardPane
          :project-id="projectId"
          scope="task"
          :focus-request="todoFocus?.tab === activeTab ? todoFocus.request : null"
          @open-ref="emit('openRef', $event)"
          @open-execution="emit('openExecution', $event)"
          @decompose="emit('decompose', $event)"
          @open-milestones="emit('openMilestones', $event)"
          @focus-handled="emit('todoFocusHandled', $event)"
        />
      </div>
    </template>
    <ProjectSessionsPane
      v-else-if="activeTab === 'sessions'"
      :project-id="projectId"
      @open="emit('openExecution', $event)"
      @start="emit('start')"
    />
    <ProjectAssetsPane
      v-else-if="activeTab === 'assets'"
      :project-id="projectId"
      :focus-file-id="assetFocusFileId"
      @decompose="emit('decompose', $event)"
      @focus-handled="emit('assetFocusHandled', $event)"
    />

    <ProjectMilestonesPane v-else-if="activeTab === 'milestones'" :project-id="projectId" />

    <ProjectTestRoundPane
      v-else-if="activeTab === 'tests' && hasTestRound"
      :project-id="projectId"
      :snapshot="store.testRoundView?.snapshot ?? null"
      @back="emit('back')"
      @open-requirement="emit('openRequirement', $event)"
    />
    <ProjectTestingPane
      v-else-if="activeTab === 'tests' && capabilities.supportsRequirementTestCases"
      :rounds="store.projectTestRounds?.items ?? []"
      :members="store.detail?.id === projectId ? store.detail.members : []"
      :requirement-titles="requirementTitles"
      :loaded="store.projectTestRounds?.loaded ?? false"
      :loading="store.projectTestRounds?.loading ?? false"
      :error="store.projectTestRounds?.error ?? null"
      :has-more="store.projectTestRounds?.hasMore ?? false"
      @open="store.openTestRound"
      @open-requirement="emit('openRequirement', $event)"
      @load-more="store.loadProjectTestRounds(projectId, true)"
      @retry="store.loadProjectTestRounds(projectId)"
    />

    <div
      v-else-if="placeholderCopy"
      class="project-detail__soon"
      :data-testid="`project-tab-soon-${activeTab}`"
      role="status"
    >
      <span class="project-detail__soonArt" aria-hidden="true">
        <AppIcon name="plan" :size="22" />
      </span>
      <strong class="project-detail__soonTitle">{{ placeholderCopy.title }}</strong>
      <p class="project-detail__soonNote">{{ placeholderCopy.note }}</p>
    </div>
  </div>
</template>

<style scoped>
.project-detail__task-list {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
}
.project-detail__soon {
  display: flex;
  flex: 1;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: var(--sp-3);
  padding: var(--sp-7) var(--sp-5);
  color: var(--muted2);
  text-align: center;
}
.project-detail__soonArt {
  display: grid;
  width: 48px; /* 与 .project-detail__errorArt 同档（48 不在 --px-* 梯，保留字面量） */
  height: 48px;
  place-items: center;
  border-radius: var(--r-lg);
  color: var(--muted2);
  background: var(--sunken);
}
.project-detail__soonTitle {
  color: var(--ink);
  font-size: var(--fs-500);
  font-weight: var(--fw-title);
}
.project-detail__soonNote {
  max-width: 42ch;
  margin: 0;
  color: var(--muted);
  font-size: var(--fs-meta);
  line-height: var(--lh-body);
}
</style>
