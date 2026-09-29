<script setup lang="ts">
import { computed, nextTick, onMounted, watch } from 'vue';
import type { ComponentPublicInstance } from 'vue';

import type { ProjectMilestoneListItem } from '@shared/protocol/project-planning.js';
import type { ProjectPlanningLifecycleAction } from '@shared/protocol/project-planning-lifecycle.js';

import AppIcon from '../ui/AppIcon.vue';
import ReferenceIdCopy from '../ui/ReferenceIdCopy.vue';
import ArchivedPlanningSection from './ArchivedPlanningSection.vue';
import MilestoneGoalRecord from './MilestoneGoalRecord.vue';
import MilestoneIterationList from './MilestoneIterationList.vue';
import PlanningFormsLayer from './PlanningFormsLayer.vue';
import PlanningLifecycleLayer from './PlanningLifecycleLayer.vue';
import { GOAL_LIFECYCLE_COPY, GOAL_TEXT, goalCompletionGate } from './planning-goal-view';
import {
  formatPlanningPeriod,
  milestoneProgressPercent,
  PLANNING_UNASSIGNED_OWNER_LABEL,
} from './project-planning-view';
import { MILESTONE_PAGE_SIZE } from '../../stores/projectCollabState';
import { useProjectCollabStore } from '../../stores/projectCollab';

/**
 * 项目详情「里程碑」页（MIL-04）：**首页直接罗列多个业务目标**，展开某个目标查看它下面
 * 的多轮迭代、进度与关联需求。
 *
 * ⚠️ 权威结构来自项目组原型 `index.html` 的**终版**（第 31 层 `milestone-overview-v31`，
 *    `renderIterationPlan26` 在 `:2765` 最后一次赋值）：平铺列表 + 展开、⛔ **没有**
 *    「当前里程碑下拉单选」（终版明确把 `.plan-selector27` 的 `<select>` 删掉）。
 *    ⛔ 别照第 27 层（`:2634`）——那一层还有下拉，是被推翻的中间态。
 *
 * ⭐ 判据「数字来自后端授权聚合」：摘要行的「迭代计划 X / Y」「关联需求 N」直接取列表行
 *    自带的 `iterationSummary` 与 `visibleRequirementCount`（服务端聚合、过 viewer 可见性
 *    门）。⛔ 渲染层**不遍历需求自算**——本地算不出别人看得见什么，一算就把别人的个人
 *    条目算进去了。
 * ⚠️ `visibleRequirementCount` 的口径是「**涉及过**」（当前 + 历史 + 归档轮次都算，移出不
 *    减），所以文案用中性的「关联需求」，⛔ 不写「当前关联 N 条」。
 *
 * ⭐ 切换 / 刷新 / 无结果 / 分页**保持状态**：展开态（`store.expandedMilestoneId`）与页码
 *    （`store.milestonesPage`）都在 store 里，切页签重挂本组件、事件驱动刷新、翻页都不丢；
 *    只有切项目才由 store 的 `clearProjectScopedState` 清。
 *
 * 取数由父级 `ProjectDetailView` 的 `loadTab('milestones')` 驱动（与动态/看板/资产同款），
 * 本组件只读 store 状态并按展开触发单目标迭代取数。
 *
 * ⭐ MIL-09 写入口：页头「＋ 新建里程碑」、展开卡「编辑里程碑」「安排需求」只对 `canManagePlanning`
 *    （管理者 / 拥有者）渲染——成员与观察者看不到入口（原型 `[里程碑管理·已定稿]` ④）；真正的门在服务端。
 *    「未排里程碑 N」取服务端权威值（`unscheduledRequirementTotal`），「已归档里程碑 N」只读可展开。
 * ⚠️ 与原型的偏离：原型「未排里程碑 N」点开是按「未排入迭代」筛选的需求池，现网需求池还没有这个筛选，
 *    本期只显示这个数。
 *
 * ⭐ MIL-07 界面段（原型 `[业务目标达成·已定稿 2026-09-13]` `goalActionsG1` / `goalRecordG1`）：展开卡的操作区
 *    对管理者 / 拥有者多出「记录达成」（门槛不满足时置灰、并排写原因）或「重新打开」；门槛数取服务端聚合
 *    `iterationSummary`（`goalCompletionGate`），⛔ 不按本地已载的迭代行自算。已达成的目标摘要行带「已达成」，
 *    展开卡里的达成信息与「目标记录 N」所有身份可读（`MilestoneGoalRecord`）。两个弹层复用
 *    `PlanningLifecycleDialog`。
 */

const props = defineProps<{ projectId: string }>();

const store = useProjectCollabStore();

/** subject → 显示名（名册是名称的唯一真相源；解析不到回落 subject，⛔ 不留旧名字快照）。 */
const memberNames = computed(() => {
  const map = new Map<string, string>();
  for (const member of store.detail?.members ?? []) map.set(member.subject, member.displayName);
  return map;
});
function ownerLabel(subject: string | null): string {
  if (!subject) return PLANNING_UNASSIGNED_OWNER_LABEL;
  return memberNames.value.get(subject) || subject;
}

const expandedId = computed(() => store.expandedMilestoneId);

/* 四态互斥（照会话页 / 需求页的同族纪律）：
 *  - 首帧错误（从未加载成功）→ 错误态（alert + 参考编号 + 重试）；
 *  - 尚未加载 → 加载态（status）；
 *  - 已加载且为空 → 空态（status、中性色，⛔ 不长成加载失败）；
 *  - 已加载且有目标 → 列表。 */
const showFatalError = computed(() => !store.milestonesLoaded && store.milestonesError != null);
const showLoading = computed(() => !store.milestonesLoaded && store.milestonesError == null);
const showEmpty = computed(() => store.milestonesLoaded && store.milestones.length === 0);
const showList = computed(() => store.milestonesLoaded && store.milestones.length > 0);

const page = computed(() => store.milestonesPage);
const total = computed(() => store.milestonesTotal);
const totalPages = computed(() => Math.max(1, Math.ceil(total.value / MILESTONE_PAGE_SIZE)));
const showPager = computed(() => showList.value && total.value > MILESTONE_PAGE_SIZE);

function progressWidth(summary: {
  readonly total: number;
  readonly open: number;
  readonly completed: number;
}): string {
  return `${milestoneProgressPercent(summary)}%`;
}

/**
 * 展开态摘要按钮的 DOM 句柄——切换后要把焦点还回那一行（无障碍：键盘用户展开后不该被
 * 甩到别处）。照原型 `actionV3['plan-toggle31']` 的 `focus({preventScroll:true})`。
 */
const summaryRefs = new Map<string, HTMLButtonElement>();
function setSummaryRef(id: string, el: Element | ComponentPublicInstance | null): void {
  if (el instanceof HTMLButtonElement) summaryRefs.set(id, el);
  else summaryRefs.delete(id);
}

async function toggle(milestoneId: string): Promise<void> {
  // 展开态同步就变（`toggleMilestone` 先置 expandedMilestoneId 再去取迭代），先让 DOM 更新
  // 再把焦点还回摘要按钮；⛔ 不 await 迭代取数——焦点回归不该等网络。
  void store.toggleMilestone(props.projectId, milestoneId);
  await nextTick();
  summaryRefs.get(milestoneId)?.focus({ preventScroll: true });
}

function goToPage(next: number): void {
  if (next < 1 || next > totalPages.value || next === page.value) return;
  void store.goToMilestonePage(props.projectId, next);
}

function retryList(): void {
  void store.loadMilestones(props.projectId);
}

/* ── MIL-09：写入口与只读现状 ─────────────────────────────────────────────── */

const canPlan = computed(() => store.canManagePlanning);
const unscheduledTotal = computed(() => store.unscheduledRequirementTotal);

function createMilestone(): void {
  store.openMilestoneForm(props.projectId, null);
}
function editMilestone(milestone: ProjectMilestoneListItem): void {
  store.openMilestoneForm(props.projectId, milestone);
}
function arrangeRequirements(milestone: ProjectMilestoneListItem): void {
  store.openRequirementScheduleDialog(props.projectId, milestone.id);
}

/* ── MIL-07 界面段：业务目标记录达成 / 重新打开 ─────────────────────────────── */

function completionGate(milestone: ProjectMilestoneListItem) {
  return goalCompletionGate(milestone.iterationSummary);
}
/** 置灰时并排写的原因（原型 `goal-gate-g1`：「至少需要一轮迭代」「还有 N 轮迭代未达成」）。 */
function completionGateReason(milestone: ProjectMilestoneListItem): string {
  const gate = completionGate(milestone);
  return gate.ok ? '' : gate.reason;
}
function openGoalLifecycle(
  milestone: ProjectMilestoneListItem,
  action: ProjectPlanningLifecycleAction,
): void {
  // 置灰的按钮本就点不到；这里再挡一次，免得门槛在渲染与点击之间变了还开出弹层。
  if (action === 'complete' && !completionGate(milestone).ok) return;
  store.openPlanningLifecycle({ kind: 'milestone', row: milestone }, action);
}

onMounted(() => {
  void store.loadUnscheduledRequirementTotal(props.projectId);
  if (!store.archivedMilestones.loaded) void store.loadArchivedMilestones(props.projectId);
});
// 归档一个里程碑之后已归档列表作废（store 置 loaded=false）：重取一次。
watch(
  () => store.archivedMilestones.loaded,
  (loaded) => {
    if (!loaded && !store.archivedMilestones.loading) {
      void store.loadArchivedMilestones(props.projectId);
    }
  },
);
</script>

<template>
  <section class="milestones-pane" data-testid="milestones-pane">
    <header class="milestones-pane__head">
      <div class="milestones-pane__headText">
        <h2 class="milestones-pane__title">里程碑</h2>
        <!-- 副标题文案逐字对齐原型终版（第 31 层 :2772）。 -->
        <p class="milestones-pane__sub">
          每个里程碑对应一个业务目标，展开查看围绕该目标推进的多轮迭代。
        </p>
      </div>
      <button
        v-if="canPlan"
        class="btn btn--primary"
        type="button"
        data-testid="milestone-create"
        @click="createMilestone"
      >
        ＋ 新建里程碑
      </button>
    </header>

    <!-- 页级回执（里程碑已保存 / 已归档）：常驻可关，⛔ 不走 toast。 -->
    <p
      v-if="store.planningPageNotice"
      class="milestones-pane__notice"
      role="status"
      data-testid="milestones-page-notice"
    >
      <span>{{ store.planningPageNotice.message }}</span>
      <ReferenceIdCopy
        v-if="store.planningPageNotice.referenceCode"
        :reference-id="store.planningPageNotice.referenceCode"
      />
      <button
        class="milestones-pane__noticeClose"
        type="button"
        aria-label="关闭提示"
        @click="store.clearPlanningPageNotice()"
      >
        ✕
      </button>
    </p>

    <!-- 首帧错误（从未加载成功）：错误态优先于空态，带可复制参考编号 + 重试。 -->
    <div
      v-if="showFatalError"
      class="milestones-pane__error"
      role="alert"
      data-testid="milestones-error"
    >
      <span class="milestones-pane__errorArt" aria-hidden="true">
        <AppIcon name="refresh" :size="20" />
      </span>
      <strong class="milestones-pane__errorTitle">{{ store.milestonesError?.message }}</strong>
      <div class="milestones-pane__errorRow">
        <ReferenceIdCopy
          v-if="store.milestonesError?.referenceCode"
          :reference-id="store.milestonesError.referenceCode"
        />
        <button
          class="btn btn--primary"
          type="button"
          data-testid="milestones-retry"
          @click="retryList"
        >
          重试
        </button>
      </div>
    </div>

    <!-- 加载态。 -->
    <div
      v-else-if="showLoading"
      class="milestones-pane__loading"
      role="status"
      data-testid="milestones-loading"
    >
      正在加载业务目标…
    </div>

    <!--
      无结果空态：⛔ 刻意**不长成加载失败**——中性色、`role="status"`（非 alert）、
      无危险色 / 参考编号 / 重试。它是「还没有」，不是「加载失败」。
    -->
    <div
      v-else-if="showEmpty"
      class="milestones-pane__empty"
      role="status"
      data-testid="milestones-empty"
    >
      <span class="milestones-pane__emptyArt" aria-hidden="true">
        <AppIcon name="pin" :size="20" />
      </span>
      <strong class="milestones-pane__emptyTitle">暂无业务目标</strong>
      <p class="milestones-pane__emptyNote">
        管理者新建业务目标并安排多轮迭代后，会在这里按目标汇总进度与关联需求。
      </p>
    </div>

    <template v-else-if="showList">
      <!-- 选择行：里程碑个数 + 「未排里程碑 N」（服务端权威值，N=0 或还没取到时不显示，同原型）。 -->
      <div class="milestones-pane__meta">
        <span data-testid="milestones-count">{{ total }} 个里程碑</span>
        <span class="milestones-pane__grow"></span>
        <span
          v-if="unscheduledTotal"
          class="milestones-pane__unscheduled"
          data-testid="milestones-unscheduled"
          :data-count="unscheduledTotal"
        >
          未排里程碑 <b class="tnum">{{ unscheduledTotal }}</b>
        </span>
      </div>
      <!-- 平铺罗列全部业务目标（⛔ 不用下拉单选）。 -->
      <ul class="milestones-pane__list" data-testid="milestones-list">
        <li
          v-for="(milestone, index) in store.milestones"
          :key="milestone.id"
          class="milestones-pane__item"
          :class="{ 'is-open': expandedId === milestone.id }"
          :data-milestone-row="milestone.id"
        >
          <button
            :ref="(el) => setSummaryRef(milestone.id, el)"
            type="button"
            class="milestones-pane__summary"
            :aria-expanded="expandedId === milestone.id"
            :aria-controls="`milestone-body-${index}`"
            :data-testid="`milestone-toggle-${milestone.id}`"
            @click="toggle(milestone.id)"
          >
            <span class="milestones-pane__chevron" aria-hidden="true">{{
              expandedId === milestone.id ? '▾' : '▸'
            }}</span>
            <span class="milestones-pane__nameCell">
              <span class="milestones-pane__name">{{ milestone.name }}</span>
              <span
                v-if="milestone.status === 'completed'"
                class="milestones-pane__doneTag"
                :data-testid="`milestone-done-${milestone.id}`"
                >{{ GOAL_TEXT.achieved }}</span
              >
            </span>
            <span class="milestones-pane__period">{{
              formatPlanningPeriod(milestone.startAt, milestone.dueAt)
            }}</span>
            <span class="milestones-pane__owner">{{ ownerLabel(milestone.ownerSubject) }}</span>
            <span class="milestones-pane__stat">
              迭代计划
              <b class="tnum">{{ milestone.iterationSummary.completed }}</b>
              / <span class="tnum">{{ milestone.iterationSummary.total }}</span>
            </span>
            <!-- ⚠️「涉及过」口径：中性文案，⛔ 不写「当前关联」。 -->
            <span class="milestones-pane__stat">
              关联需求 <b class="tnum">{{ milestone.visibleRequirementCount }}</b>
            </span>
          </button>

          <!-- 展开体：元素常在（aria-controls 指向它），收起时 hidden；内容只在展开时渲染。 -->
          <div
            :id="`milestone-body-${index}`"
            class="milestones-pane__body"
            :hidden="expandedId !== milestone.id"
            :data-testid="`milestone-body-${milestone.id}`"
          >
            <template v-if="expandedId === milestone.id">
              <!-- MIL-09：写入口只对管理者 / 拥有者渲染（成员与观察者看不到）。 -->
              <div v-if="canPlan" class="milestones-pane__actions">
                <button
                  class="btn btn--ghost btn--xs"
                  type="button"
                  :data-testid="`milestone-edit-${milestone.id}`"
                  @click="editMilestone(milestone)"
                >
                  编辑里程碑
                </button>
                <button
                  class="btn btn--ghost btn--xs"
                  type="button"
                  :data-testid="`milestone-arrange-${milestone.id}`"
                  @click="arrangeRequirements(milestone)"
                >
                  安排需求
                </button>
                <!-- MIL-07 界面段：已达成给「重新打开」；未达成给「记录达成」，门槛不满足置灰并写原因。 -->
                <button
                  v-if="milestone.status === 'completed'"
                  class="btn btn--ghost btn--xs"
                  type="button"
                  :data-testid="`milestone-reopen-${milestone.id}`"
                  @click="openGoalLifecycle(milestone, 'reopen')"
                >
                  {{ GOAL_LIFECYCLE_COPY.reopen.entry }}
                </button>
                <template v-else>
                  <button
                    class="btn btn--ghost btn--xs"
                    type="button"
                    :disabled="!completionGate(milestone).ok"
                    :aria-describedby="
                      completionGate(milestone).ok ? undefined : `milestone-gate-${milestone.id}`
                    "
                    :data-testid="`milestone-complete-${milestone.id}`"
                    @click="openGoalLifecycle(milestone, 'complete')"
                  >
                    {{ GOAL_LIFECYCLE_COPY.complete.entry }}
                  </button>
                  <small
                    v-if="!completionGate(milestone).ok"
                    :id="`milestone-gate-${milestone.id}`"
                    class="milestones-pane__gate"
                    :data-testid="`milestone-gate-${milestone.id}`"
                  >
                    {{ completionGateReason(milestone) }}
                  </small>
                </template>
              </div>
              <p v-if="milestone.objectiveMd" class="milestones-pane__objective">
                {{ milestone.objectiveMd }}
              </p>

              <div class="milestones-pane__progress">
                <div
                  class="milestones-pane__progressBar"
                  role="progressbar"
                  :aria-valuenow="milestone.iterationSummary.completed"
                  :aria-valuemin="0"
                  :aria-valuemax="milestone.iterationSummary.total"
                >
                  <span :style="{ width: progressWidth(milestone.iterationSummary) }"></span>
                </div>
                <span class="milestones-pane__progressLabel">
                  迭代计划达成
                  <b class="tnum">{{ milestone.iterationSummary.completed }}</b>
                  / <span class="tnum">{{ milestone.iterationSummary.total }}</span>
                </span>
              </div>

              <!-- MIL-07 界面段：达成信息与「目标记录 N」（所有身份可读，正文只经 REST）。 -->
              <MilestoneGoalRecord :project-id="projectId" :milestone="milestone" />

              <!--
                多轮迭代：MIL-05 的分组 / 搜索 / 排序 / 行内编辑 / 快速添加都在
                MilestoneIterationList 里（列表视图）。单目标迭代取数的加载 / 错误 / 空态
                也由它按 milestoneId 从 store 自取，本组件不再自持一份读态。
                ⚠️ 一次只展开一个目标（v-if），⇒ 同时只挂一份实例，切目标即卸载重挂。
              -->
              <MilestoneIterationList :project-id="projectId" :milestone-id="milestone.id" />
            </template>
          </div>
        </li>
      </ul>

      <nav
        v-if="showPager"
        class="milestones-pane__pager"
        aria-label="业务目标分页"
        data-testid="milestones-pager"
      >
        <button
          class="btn btn--ghost"
          type="button"
          :disabled="page <= 1"
          data-testid="milestones-prev"
          @click="goToPage(page - 1)"
        >
          上一页
        </button>
        <span class="milestones-pane__pagerLabel">
          第 <span class="tnum">{{ page }}</span> / <span class="tnum">{{ totalPages }}</span> 页 ·
          共 <span class="tnum">{{ total }}</span> 个
        </span>
        <button
          class="btn btn--ghost"
          type="button"
          :disabled="page >= totalPages"
          data-testid="milestones-next"
          @click="goToPage(page + 1)"
        >
          下一页
        </button>
      </nav>
    </template>

    <!-- MIL-09：已归档里程碑（只读、可展开读历史与记录；所有身份可见）。 -->
    <ArchivedPlanningSection
      v-if="store.milestonesLoaded"
      :project-id="projectId"
      kind="milestone"
    />

    <!-- MIL-07：迭代计划详情 + 记录达成 / 重新打开（状态在 store，收起目标也不卸掉开着的弹层）。 -->
    <PlanningLifecycleLayer :project-id="projectId" />
    <!-- MIL-09：新建 / 编辑里程碑、添加 / 编辑迭代计划、安排需求。 -->
    <PlanningFormsLayer :project-id="projectId" />
  </section>
</template>

<style scoped>
.milestones-pane {
  display: flex;
  min-height: 0;
  flex: 1;
  flex-direction: column;
  gap: var(--px-14);
}
.milestones-pane__head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: var(--px-14);
}
.milestones-pane__headText {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: var(--px-4);
}
.milestones-pane__meta {
  display: flex;
  align-items: center;
  gap: var(--px-10);
  color: var(--muted2);
  font-size: var(--fs-200);
}
.milestones-pane__grow {
  flex: 1 1 auto;
}
.milestones-pane__unscheduled b {
  color: var(--ink);
}
.milestones-pane__actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: flex-end;
  gap: var(--px-4) var(--px-8);
  margin-top: var(--px-12);
}
/* 门槛不满足的原因：独占一行、右对齐，紧跟置灰的「记录达成」（原型 goal-gate-g1）。 */
.milestones-pane__gate {
  flex-basis: 100%;
  color: var(--muted);
  font-size: var(--fs-200);
  line-height: 1.5;
  text-align: right;
}
.milestones-pane__notice {
  display: flex;
  align-items: center;
  gap: var(--px-8);
  margin: 0;
  padding: var(--px-8) var(--px-12);
  border-radius: var(--r-md);
  color: var(--ink);
  background: var(--sunken);
  font-size: var(--fs-meta);
}
.milestones-pane__noticeClose {
  margin-left: auto;
  border: 0;
  color: var(--muted2);
  background: transparent;
  cursor: pointer;
}
.milestones-pane__title {
  margin: 0;
  color: var(--ink);
  font: var(--fw-660) var(--fs-500) / 1.25 var(--font-sans);
}
.milestones-pane__sub {
  margin: 0;
  color: var(--muted);
  font-size: var(--fs-meta);
  line-height: var(--lh-body);
}
/* 列表：平铺全部业务目标，⛔ 不用下拉单选。 */
.milestones-pane__list {
  display: flex;
  flex-direction: column;
  gap: var(--px-8);
  margin: 0;
  padding: 0;
  list-style: none;
}
.milestones-pane__item {
  border: var(--bw) solid var(--line);
  border-radius: var(--r-md);
  background: var(--panel);
  overflow: hidden;
}
.milestones-pane__item.is-open {
  border-color: var(--accent-line);
}
/* 摘要行：整行是展开按钮（名 / 周期 / 负责人 / 迭代计划 X/Y / 关联需求 N）。 */
.milestones-pane__summary {
  display: flex;
  width: 100%;
  align-items: center;
  gap: var(--px-14);
  padding: var(--px-12) var(--px-14);
  border: 0;
  color: var(--ink);
  background: transparent;
  font: inherit;
  font-size: var(--fs-300);
  text-align: left;
  cursor: pointer;
  transition: background-color var(--dur-1) var(--ease-out);
}
.milestones-pane__summary:hover {
  background: var(--sunken);
}
.milestones-pane__summary:focus-visible {
  outline: none;
  box-shadow: var(--focus-ring-flat);
}
.milestones-pane__chevron {
  flex: 0 0 auto;
  color: var(--muted2);
  font-size: var(--fs-200);
}
.milestones-pane__nameCell {
  display: flex;
  flex: 1 1 auto;
  min-width: 0;
  align-items: center;
  gap: var(--px-6);
}
.milestones-pane__name {
  min-width: 0;
  overflow: hidden;
  color: var(--ink);
  font-weight: var(--fw-title);
  text-overflow: ellipsis;
  white-space: nowrap;
}
/* 已达成的目标：名称后跟一枚「已达成」（原型 goal-done-tag-g1，颜色取语义成功色）。 */
.milestones-pane__doneTag {
  flex: 0 0 auto;
  padding: 0 var(--px-6);
  border-radius: var(--r-pill);
  color: var(--ok-text);
  background: var(--ok-soft);
  font-size: var(--fs-100);
  line-height: 1.6;
}
.milestones-pane__period,
.milestones-pane__owner,
.milestones-pane__stat {
  flex: 0 0 auto;
  color: var(--muted2);
  font-size: var(--fs-200);
  white-space: nowrap;
}
.milestones-pane__stat b {
  color: var(--ink);
}
/* 展开体。 */
.milestones-pane__body {
  padding: 0 var(--px-14) var(--px-14);
  border-top: var(--bw) solid var(--line);
}
.milestones-pane__body[hidden] {
  display: none;
}
.milestones-pane__objective {
  margin: var(--px-12) 0 0;
  color: var(--muted);
  font-size: var(--fs-meta);
  line-height: var(--lh-body);
  white-space: pre-wrap;
}
.milestones-pane__progress {
  display: flex;
  align-items: center;
  gap: var(--px-10);
  margin-top: var(--px-12);
}
.milestones-pane__progressBar {
  flex: 1 1 auto;
  height: var(--px-6);
  border-radius: var(--r-pill);
  background: var(--sunken);
  overflow: hidden;
}
.milestones-pane__progressBar span {
  display: block;
  height: 100%;
  border-radius: var(--r-pill);
  background: var(--accent);
}
.milestones-pane__progressLabel {
  flex: 0 0 auto;
  color: var(--muted2);
  font-size: var(--fs-200);
}
.milestones-pane__progressLabel b {
  color: var(--ink);
}
/* 迭代列表（分组/搜索/行内编辑/快速添加）整块已移到 MilestoneIterationList.vue，
   连带的行样式与单目标取数子态样式随之下沉到那里，本组件不再自持一份。 */
/* 首帧错误态（与 ProjectDetailView 的 pj-error 同族，带危险色 + 重试）。 */
.milestones-pane__error {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--sp-3);
  padding: var(--sp-7) var(--sp-5);
  color: var(--muted2);
  text-align: center;
}
.milestones-pane__errorArt {
  display: grid;
  width: 48px;
  height: 48px;
  place-items: center;
  border-radius: var(--r-lg);
  color: var(--danger-text);
  background: var(--danger-soft);
}
.milestones-pane__errorTitle {
  color: var(--danger-text);
  font-size: var(--fs-400);
  font-weight: var(--fw-title);
}
.milestones-pane__errorRow {
  display: flex;
  align-items: center;
  gap: var(--sp-3);
}
.milestones-pane__loading {
  padding: var(--sp-6) var(--sp-5);
  color: var(--muted2);
  font-size: var(--fs-meta);
  text-align: center;
}
/* 无结果空态：**全中性色**（muted/sunken），⛔ 无危险色 / 参考编号 / 重试——它是「还没有」，
   不是「加载失败」。几何与错误态相近但语义相反，靠色与角色（status vs alert）区分。 */
.milestones-pane__empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--sp-3);
  padding: var(--sp-7) var(--sp-5);
  color: var(--muted2);
  text-align: center;
}
.milestones-pane__emptyArt {
  display: grid;
  width: 48px;
  height: 48px;
  place-items: center;
  border-radius: var(--r-lg);
  color: var(--muted2);
  background: var(--sunken);
}
.milestones-pane__emptyTitle {
  color: var(--ink);
  font-size: var(--fs-400);
  font-weight: var(--fw-title);
}
.milestones-pane__emptyNote {
  max-width: 42ch;
  margin: 0;
  color: var(--muted);
  font-size: var(--fs-meta);
  line-height: var(--lh-body);
}
.milestones-pane__pager {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: var(--px-14);
  padding-top: var(--px-4);
}
.milestones-pane__pagerLabel {
  color: var(--muted2);
  font-size: var(--fs-200);
}
</style>
