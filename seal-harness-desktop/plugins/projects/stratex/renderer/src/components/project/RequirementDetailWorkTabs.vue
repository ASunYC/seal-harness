<script setup lang="ts">
import { computed, ref, watch } from 'vue';

import type { Todo, TodoItemKind } from '@shared/protocol/project-collab.js';

import AppIcon from '../ui/AppIcon.vue';
import RequirementDetailChildren from './RequirementDetailChildren.vue';
import RequirementDetailPanel from './RequirementDetailPanel.vue';
import RequirementTestRecordList from './RequirementTestRecordList.vue';
import { todoProgressHint } from './project-format';
import { decomposeActionLabel } from './requirement-actions';
import {
  REQUIREMENT_EXECUTOR_HINT,
  REQUIREMENT_WORK_TAB_UNAVAILABLE,
  requirementChildrenEmptyText,
  requirementDetailProgressText,
  requirementWorkTabs,
} from './requirement-detail';
import type { RequirementChildSummary, RequirementWorkTabId } from './requirement-detail';
import type { RequirementTestRecordsView } from './requirement-submission';
import { useProjectCollabStore } from '../../stores/projectCollab';
import { useProjectServiceCapabilitiesStore } from '../../stores/projectCollabCapabilities';

/**
 * 单屏需求详情右栏：「子任务｜测试记录｜需求讨论」三个页签（原型 `.req-card-work12 .detail-tabs`，
 * 负责人目标画面）。
 *
 * 键盘照 WAI-ARIA 页签模式：页签组只占一个 Tab 位，←/→ 循环、Home/End 到头尾，选中随焦点走
 * （面板内容轻，自动激活）。三个面板都在 DOM 里、未选的 `hidden`，`aria-controls` 才指得到东西。
 * 在详情里换一条需求（点子需求）回到「子任务」。
 *
 * 只呈现、只发意图：点子项上冒 `open`、拆解上冒 `decompose`、测试记录取失败的重试上冒 `retryTests`，
 * 由详情转给看板层的现有入口 / store。计数、空态与「暂未开放」的口径都在 `requirement-detail.ts`。
 *
 * ⚠️ 唯一的例外是测试轮次的用例（TST-04）：轮次卡上的「N 个用例」与「进入测试」直接读写 store——进入测试
 *    要切到测试页签（ProjectDetailView 盯着 `store.testRoundView`），冒泡要穿过需求详情与看板两层，而需求详情
 *    已近行数上限。协商到 `requirement.test_cases` 才取条数、摆入口；轮次列表一变（提交 / 重取）就重取条数。
 */

const props = withDefaults(
  defineProps<{
    todo: Todo;
    items: readonly RequirementChildSummary[];
    /** 这一条子项点不点得开（子需求恒可开详情；子任务要改得动才给开编辑）。 */
    canOpen: (todo: Todo) => boolean;
    /** 能发起的拆解（按页收窄，判据与表格行共用）；空＝不摆拆解按钮。 */
    decomposeTargets: readonly TodoItemKind[];
    /** 「测试记录」页签的轮次（TST-02）；null ＝服务不支持整需求提测（保留「暂未开放」）。 */
    testRecords?: RequirementTestRecordsView | null;
    childrenLoading?: boolean;
    childrenError?: string | null;
    childrenHasMore?: boolean;
  }>(),
  { testRecords: null, childrenLoading: false, childrenError: null, childrenHasMore: false },
);

const emit = defineEmits<{
  open: [Todo];
  decompose: [TodoItemKind];
  retryTests: [];
  retryChildren: [];
  loadMoreChildren: [];
  loadMoreTests: [];
}>();

const store = useProjectCollabStore();
const capabilities = useProjectServiceCapabilitiesStore();

/* ── 测试轮次的用例（TST-04）：轮次卡上的条数与「进入测试」 ── */
const supportsTestCases = computed(
  () => props.testRecords !== null && capabilities.supportsRequirementTestCases,
);
const caseCounts = computed(() => {
  if (!supportsTestCases.value) return null;
  const entry = store.requirementCaseCounts[props.todo.id];
  return entry?.loaded === true ? entry.counts : null;
});
watch(
  [
    () => props.todo.id,
    () => props.testRecords?.rows.map((row) => `${row.id}:${row.state}`).join('|') ?? '',
    supportsTestCases,
  ],
  ([id, rows, supported]) => {
    const projectId = store.activeProjectId;
    if (supported && rows !== '' && projectId !== null) {
      void store.loadRequirementCaseCounts(projectId, id);
    }
  },
  { immediate: true },
);

function enterTesting(submissionId: string): void {
  void store.openTestRound(props.todo.id, submissionId);
}

const tabs = computed(() =>
  requirementWorkTabs(props.todo, {
    testRecordCount:
      props.testRecords?.loaded === true
        ? { count: props.testRecords.rows.length, hasMore: props.testRecords.hasMore }
        : null,
  }),
);
const active = ref<RequirementWorkTabId>('tasks');

watch(
  () => props.todo.id,
  () => {
    active.value = 'tasks';
  },
);

function tabId(id: RequirementWorkTabId): string {
  return `requirement-work-${props.todo.id}-tab-${id}`;
}

function panelId(id: RequirementWorkTabId): string {
  return `requirement-work-${props.todo.id}-panel-${id}`;
}

function select(id: RequirementWorkTabId, moveFocus: boolean): void {
  active.value = id;
  if (moveFocus) document.getElementById(tabId(id))?.focus();
}

const NAV_KEYS: Readonly<Record<string, (index: number, count: number) => number>> = {
  ArrowRight: (index, count) => (index + 1) % count,
  ArrowLeft: (index, count) => (index - 1 + count) % count,
  Home: () => 0,
  End: (_index, count) => count - 1,
};

function onTabKeydown(event: KeyboardEvent): void {
  const move = NAV_KEYS[event.key];
  if (move === undefined) return;
  const ids = tabs.value.map((tab) => tab.id);
  const next = ids[move(ids.indexOf(active.value), ids.length)];
  if (next === undefined) return;
  event.preventDefault();
  select(next, true);
}

const progressText = computed(() => requirementDetailProgressText(props.todo));
const progressComplete = computed(
  () => props.todo.childTotal > 0 && props.todo.childDone === props.todo.childTotal,
);
const emptyText = computed(() => requirementChildrenEmptyText(props.todo));
</script>

<template>
  <RequirementDetailPanel label="子任务、测试记录与需求讨论" body-testid="requirement-detail-work">
    <template #head>
      <div class="req-work__tabs" role="tablist" aria-label="需求执行与协作">
        <button
          v-for="tab in tabs"
          :id="tabId(tab.id)"
          :key="tab.id"
          class="req-work__tab"
          type="button"
          role="tab"
          :aria-selected="active === tab.id"
          :aria-controls="panelId(tab.id)"
          :tabindex="active === tab.id ? 0 : -1"
          :data-tab="tab.id"
          @click="select(tab.id, false)"
          @keydown="onTabKeydown"
        >
          <!-- 字与计数之间留一个真空格：视觉间距归 gap，读屏与复制读到的是「子任务 2」而不是「子任务2」 -->
          <span>{{ tab.label }}</span
          >{{ ' ' }}<span class="req-work__count tnum">{{ tab.count }}</span>
        </button>
      </div>
    </template>

    <div
      :id="panelId('tasks')"
      class="req-work__panel"
      role="tabpanel"
      :aria-labelledby="tabId('tasks')"
      tabindex="0"
      :hidden="active !== 'tasks'"
      data-testid="requirement-detail-children"
    >
      <div class="req-work__summary">
        <p class="req-work__progress">
          <span
            class="tnum"
            :class="{ 'is-complete': progressComplete }"
            :title="todoProgressHint"
            data-testid="requirement-detail-progress"
            >{{ progressText }}</span
          >
          <span> · {{ REQUIREMENT_EXECUTOR_HINT }}</span>
        </p>
        <button
          v-for="target in props.decomposeTargets"
          :key="target"
          class="req-work__decompose"
          type="button"
          :data-testid="`requirement-detail-decompose-${target}`"
          @click="emit('decompose', target)"
        >
          <AppIcon name="agents" :size="13" aria-hidden="true" />
          <span>{{ decomposeActionLabel(target) }}</span>
        </button>
      </div>
      <div class="req-work__list">
        <RequirementDetailChildren
          v-if="props.items.length > 0"
          :items="props.items"
          :can-open="props.canOpen"
          @open="emit('open', $event)"
        />
        <p
          v-else-if="!props.childrenLoading && !props.childrenError"
          class="req-work__empty"
          data-testid="requirement-detail-children-empty"
        >
          {{ emptyText }}
        </p>
        <p v-if="props.childrenLoading" role="status" data-testid="requirement-children-loading">
          正在读取子项…
        </p>
        <p v-if="props.childrenError" role="alert" data-testid="requirement-children-error">
          {{ props.childrenError }}
          <button
            type="button"
            class="btn btn--ghost"
            data-testid="requirement-children-retry"
            :disabled="props.childrenLoading"
            @click="emit('retryChildren')"
          >
            重试
          </button>
        </p>
        <button
          v-if="props.childrenHasMore"
          type="button"
          class="btn btn--ghost"
          data-testid="requirement-children-more"
          :disabled="props.childrenLoading"
          @click="emit('loadMoreChildren')"
        >
          加载更多子项
        </button>
      </div>
    </div>

    <!-- 测试记录（TST-02）：协商到整需求提测能力才列轮次；不支持时保留「暂未开放」。 -->
    <div
      :id="panelId('tests')"
      class="req-work__panel"
      role="tabpanel"
      :aria-labelledby="tabId('tests')"
      tabindex="0"
      :hidden="active !== 'tests'"
      data-testid="requirement-detail-tests"
    >
      <RequirementTestRecordList
        v-if="props.testRecords"
        :rows="props.testRecords.rows"
        :loaded="props.testRecords.loaded"
        :loading="props.testRecords.loading"
        :error-message="props.testRecords.errorMessage"
        :has-more="props.testRecords.hasMore"
        :case-counts="caseCounts"
        :can-enter="supportsTestCases"
        @retry="emit('retryTests')"
        @load-more="emit('loadMoreTests')"
        @enter="enterTesting"
      />
      <p v-else class="req-work__empty req-work__empty--boxed">
        {{ REQUIREMENT_WORK_TAB_UNAVAILABLE.tests }}
      </p>
    </div>

    <div
      :id="panelId('discussion')"
      class="req-work__panel"
      role="tabpanel"
      :aria-labelledby="tabId('discussion')"
      tabindex="0"
      :hidden="active !== 'discussion'"
      data-testid="requirement-detail-discussion"
    >
      <p class="req-work__empty req-work__empty--boxed">
        {{ REQUIREMENT_WORK_TAB_UNAVAILABLE.discussion }}
      </p>
    </div>
  </RequirementDetailPanel>
</template>

<style scoped>
/* 页签条（原型 .req-card-work12 .detail-tabs：gap 8、上下 4、底线；项 8px 5px、13px）。 */
.req-work__tabs {
  display: flex;
  min-width: 0;
  flex: 1;
  flex-wrap: wrap;
  gap: var(--px-8);
  border-bottom: var(--bw) solid var(--line);
}
.req-work__tab {
  display: inline-flex;
  align-items: center;
  gap: var(--px-4);
  margin-bottom: calc(-1 * var(--bw));
  padding: var(--px-8) var(--px-5);
  border: 0;
  border-bottom: var(--bw-rule) solid transparent;
  border-radius: 0;
  color: var(--muted);
  background: transparent;
  font: inherit;
  font-size: var(--fs-300);
  white-space: nowrap;
  cursor: pointer;
}
.req-work__tab:hover {
  color: var(--ink);
}
.req-work__tab[aria-selected='true'] {
  border-bottom-color: var(--accent);
  color: var(--ink);
  font-weight: var(--fw-label);
}
.req-work__tab:focus-visible {
  border-radius: var(--r-sm);
  outline: none;
  box-shadow: var(--focus-ring-flat);
}
.req-work__count {
  color: var(--muted2);
}
.req-work__panel:focus-visible {
  border-radius: var(--r-sm);
  outline: none;
  box-shadow: var(--focus-ring-flat);
}
/* 计数行（原型 #detail-content>.flex：两端对齐，右侧「＋ 拆分任务」的位置放拆解入口）。 */
.req-work__summary {
  display: flex;
  min-width: 0;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: var(--px-6) var(--px-8);
  margin: var(--px-8) 0;
}
.req-work__progress {
  margin: 0;
  color: var(--muted);
  font-size: var(--fs-200);
  line-height: var(--lh-1p5);
}
.req-work__progress .is-complete {
  color: var(--ok-text);
}
.req-work__decompose {
  display: inline-flex;
  min-height: var(--ctl-h-sm);
  align-items: center;
  gap: var(--px-4);
  padding: 0 var(--px-6);
  border: 0;
  border-radius: var(--r-sm);
  color: var(--accent-text);
  background: transparent;
  font: inherit;
  font-size: var(--fs-300);
  font-weight: var(--fw-label);
  cursor: pointer;
}
.req-work__decompose:hover {
  background: var(--accent-soft);
}
.req-work__decompose:focus-visible {
  outline: none;
  box-shadow: var(--focus-ring-flat);
}
/* 子项框（原型 .task-list：描边圆角；空时里面只有一句居中的话）。 */
.req-work__list,
.req-work__empty--boxed {
  border: var(--bw) solid var(--line);
  border-radius: var(--r-md);
}
.req-work__empty {
  margin: 0;
  padding: var(--px-32) var(--px-16);
  color: var(--muted2);
  font-size: var(--fs-300);
  line-height: var(--lh-body);
  text-align: center;
}
.req-work__empty--boxed {
  margin-top: var(--px-8);
}
</style>
