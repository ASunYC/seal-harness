<script setup lang="ts">
import { projectRuntime } from '../../../../../src/ui/runtime';
const { shadow } = projectRuntime();
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';

import { isTodoWorkOrder } from '@shared/protocol/project-collab.js';
import type { Todo, TodoAcceptanceItem, TodoItemKind } from '@shared/protocol/project-collab.js';

import AppIcon from '../ui/AppIcon.vue';
import ReferenceIdCopy from '../ui/ReferenceIdCopy.vue';
import ProjectRefChip from './ProjectRefChip.vue';
import ProjectTodoCollaboration from './ProjectTodoCollaboration.vue';
import { overlayStack } from '../ui/overlay/overlayStack.js';
import RequirementDetailMoreMenu from './RequirementDetailMoreMenu.vue';
import RequirementDetailPanel from './RequirementDetailPanel.vue';
import RequirementDetailWorkTabs from './RequirementDetailWorkTabs.vue';
import RequirementSubmissionBar from './RequirementSubmissionBar.vue';
import TodoMetaBadges from './TodoMetaBadges.vue';
import TodoRowActions from './TodoRowActions.vue';
import type { ProjectRefTarget } from './project-refs';
import { useProjectRefSources } from './useProjectRefSources';
import { useRequirementDetailChildren } from './useRequirementDetailChildren';
import {
  canClaimRequirement,
  decomposeTargetsFor,
  requirementDetailMenuItems,
} from './requirement-actions';
import type { RequirementMenuActionId } from './requirement-actions';
import { REQUIREMENT_DETAIL_BACK_LABELS, requirementDetailFields } from './requirement-detail';
import {
  requirementSubmissionBlock,
  requirementTestRecordRows,
  type RequirementTestRecordsView,
} from './requirement-submission';
import type { TodoScope } from './todo-hierarchy';
import { useProjectCollabStore } from '../../stores/projectCollab';
import { useProjectServiceCapabilitiesStore } from '../../stores/projectCollabCapabilities';

/**
 * 单屏需求详情（UX-02）——**页签内视图，不是弹层**。版式照协作原型渲染后最后生效的那层
 * （`requirement-card12` + 紧凑任务层）与负责人给的目标画面，呈现模型在 `requirement-detail.ts`，
 * 动作判据在 `requirement-actions.ts`（与表格行 / 看板卡共用），右栏页签在
 * `RequirementDetailWorkTabs.vue`。
 *
 * 本组件**只发意图**：编辑（含「更改」处理人）、认领、整需求提测、拆解、工作单、删除、查看执行一律冒泡
 * 给看板那一层——那里挂着现有的弹层（⛔ 不在这里复制第二套编辑表单）与会话入口。开合、滚动与焦点还原在
 * `useRequirementDetailView`。
 * ⭐ 整需求提测（TST-02）只在协商到 `requirement.test_mode` 时出现：底部提测块与「测试记录」页签读
 *    store 里这条需求的轮次缓存；呈现模型与入口判据在 `requirement-submission.ts`。
 *
 * ⚠️ 取数纪律：字段一律读 store 里那条权威待办（`props.todo` 就是它）；逐条完成标准只在详情
 *    端点里，在三个时机重取——打开 / 换一条、`todo.changed` 事件到达（`todoChangedRevision`，
 *    ⛔ 不读事件负载）、这条待办的版本变了（本机刚改完，事件流断着也不显示旧标准）。
 *    「迭代信息」读服务端排期查询（与需求编辑器同一份 `requirementPlacementLookups`）。
 * ⚠️【埋点红线】标题、说明、完成标准都是用户亲笔：⛔ 一个字都不进埋点与日志。
 */
const props = defineProps<{
  todo: Todo;
  projectId: string;
  /** 从哪个页签进来：决定返回文案与动作收窄（需求池 / 任务页）。 */
  page: TodoScope;
}>();

const emit = defineEmits<{
  back: [];
  edit: [Todo];
  /** 在详情里点子需求：换成那一条的详情（返回仍回到最初那一行）。 */
  open: [Todo];
  claim: [Todo];
  /** 整需求提测（TST-02）：看板层开整条需求提测弹窗。 */
  submitTest: [Todo];
  decompose: [Todo, TodoItemKind];
  workOrder: [Todo];
  openExecution: [string];
  openRef: [ProjectRefTarget];
  delete: [Todo];
  openDrafts: [];
}>();

const store = useProjectCollabStore();
const capabilities = useProjectServiceCapabilitiesStore();

const rootEl = ref<HTMLElement | null>(null);
const headingEl = ref<HTMLElement | null>(null);
const headingId = computed(() => `requirement-detail-title-${props.todo.id}`);

const backLabel = computed(() => REQUIREMENT_DETAIL_BACK_LABELS[props.page]);
const canEdit = computed(() => store.canEditTodo(props.todo));
/**
 * 「更改」处理人：能改这条就能改它的处理人（服务端没有单独的处理人闸，与编辑弹层同判），
 * 但待验收中服务端拒改处理人（409）——弹层里那一格是禁用的，这里不摆点了也改不了的入口。
 */
const canChangeAssignee = computed(() => canEdit.value && props.todo.status !== 'inReview');

/* ── 迭代信息（与需求编辑器同一份排期查询） ── */
const placementLookup = computed(() => store.requirementPlacementLookups[props.todo.id] ?? null);
// 打开 / 换一条时查；排期事件到达由 store 按已查过的 id 重取；缓存被作废（回到 null）时再查。
// 多源 watch 逐个比原始值（布尔），不会因为 store 回写同一条而重复发请求。
watch(
  [() => props.todo.id, () => placementLookup.value === null],
  ([id, missing]) => {
    if (missing) void store.loadRequirementPlacementLookup(props.projectId, id);
  },
  { immediate: true },
);

const fields = computed(() =>
  requirementDetailFields(props.todo, {
    placement: placementLookup.value,
    classificationDisabled: capabilities.serviceUpgradeRequired,
  }),
);

const actionContext = computed(() => ({
  page: props.page,
  canWrite: store.canWrite,
  isArchived: store.isArchived,
}));
/**
 * 底部放「认领这条需求」（目标画面）与提测块（TST-02，见下）；拆解入口在子任务页签的计数行右侧
 * （原型「＋ 拆分任务」位）。
 */
const canClaim = computed(() => canClaimRequirement(props.todo, actionContext.value));
const decomposeTargets = computed(() => decomposeTargetsFor(props.todo, actionContext.value));
const menuItems = computed(() =>
  requirementDetailMenuItems(props.todo, { canDelete: store.canDeleteTodos }),
);

const childPages = useRequirementDetailChildren(
  () => props.projectId,
  () => props.todo,
);
const children = childPages.children;

/* ── 整需求提测（TST-02）：底部提测块与「测试记录」页签共用这条需求的轮次 ── */
const supportsTestMode = computed(() => capabilities.supportsRequirementTestMode);
const rounds = computed(() => store.requirementRounds[props.todo.id] ?? null);
// 打开 / 换一条、能力协商到时取；服务不支持（含未加载、加载失败）一个请求都不发。
// 之后的变化由 store 在 `todo.changed` 重取清单后按版本判过期重取（⛔ 不读事件负载）。
watch(
  [() => props.todo.id, supportsTestMode],
  ([id, supported]) => {
    if (supported) void store.loadRequirementRounds(props.projectId, id);
  },
  { immediate: true },
);
const submission = computed(() =>
  requirementSubmissionBlock(props.todo, {
    rounds: rounds.value?.items ?? [],
    roundsReady: rounds.value !== null && (rounds.value.loaded || rounds.value.error !== null),
    members: store.detail?.members ?? [],
    mySubject: store.mySubject,
    canWrite: store.canWrite,
    isArchived: store.isArchived,
    supportsTestMode: supportsTestMode.value,
  }),
);
const testRecords = computed<RequirementTestRecordsView | null>(() =>
  supportsTestMode.value
    ? {
        rows: requirementTestRecordRows(rounds.value?.items ?? [], store.detail?.members ?? []),
        loaded: rounds.value?.loaded ?? false,
        loading: rounds.value?.loading ?? false,
        errorMessage: rounds.value?.error?.message ?? null,
        hasMore: rounds.value?.hasMore ?? false,
      }
    : null,
);

// 待办点击后按 UUID 补取；这里只为资产引用补齐原文件来源，不拉平分页待办。
const { refSources: materialSources } = useProjectRefSources(
  () => props.projectId,
  () => props.todo.refs.filter((token) => token.startsWith('asset:')),
);
const refSources = computed(() => ({
  ...materialSources.value,
  todos: store.activeProjectId === props.projectId ? [...store.todosById.values()] : [],
}));

/* ── 逐条完成标准（只在详情端点里） ── */
type CriteriaState = 'loading' | 'ready' | 'error';
const criteria = ref<readonly TodoAcceptanceItem[]>([]);
const criteriaState = ref<CriteriaState>('ready');
/** 请求序号：换条 / 事件重取 / 版本变化可能交错，只让最后发出的那次落地。 */
let criteriaRequest = 0;
/** 当前 `criteria` 属于哪一条：同一条重取时保留旧列表（不闪「正在读取」），换条才清。 */
let criteriaOwner: string | null = null;

async function loadCriteria(): Promise<void> {
  const todo = props.todo;
  const request = ++criteriaRequest;
  if (!isTodoWorkOrder(todo)) {
    criteria.value = [];
    criteriaOwner = todo.id;
    criteriaState.value = 'ready';
    return;
  }
  if (criteriaOwner !== todo.id) {
    criteria.value = [];
    criteriaState.value = 'loading';
  }
  const snapshot = await store.loadTodoDetail(todo.id);
  if (request !== criteriaRequest) return;
  if (snapshot === null) {
    // 失败提示已由 store 落到常驻条；这里只如实标出「这一块没取到」，⛔ 不显示成「未填写」。
    criteriaState.value = 'error';
    return;
  }
  criteria.value = snapshot.acceptanceItems;
  criteriaOwner = todo.id;
  criteriaState.value = 'ready';
}

// 多源 watch 逐个比较原始值：同一帧里几样一起变也只重取一次；
// ⛔ 别改成「一个 getter 返回数组」——每次都是新数组，详情端点回写 store 会让它无限重取。
watch(
  [
    () => props.todo.id,
    () => props.todo.version,
    () => props.todo.acceptanceTotal,
    () => store.todoChangedRevision,
  ],
  () => void loadCriteria(),
  { immediate: true },
);

function ordinalText(ordinal: number): string {
  return String(ordinal).padStart(2, '0');
}

/* ── 意图 ── */
function onMenuSelect(id: RequirementMenuActionId): void {
  if (id === 'work-order') emit('workOrder', props.todo);
  else if (id === 'open-execution' && props.todo.sessionRef) {
    emit('openExecution', props.todo.sessionRef);
  } else if (id === 'delete') emit('delete', props.todo);
}

/** 子需求点进它的详情；子任务点开现有编辑弹层（改不动的不给点）。 */
function childOpenable(child: Todo): boolean {
  return child.itemKind === 'requirement' || store.canEditTodo(child);
}

function openChild(child: Todo): void {
  if (child.itemKind === 'requirement') emit('open', child);
  else if (store.canEditTodo(child)) emit('edit', child);
}

/* ── 焦点与 Esc ── */
function focusHeading(): void {
  headingEl.value?.focus({ preventScroll: true });
}

/**
 * Esc ＝ 返回列表。让路两条：输入法正在组字；焦点在详情之外（比如项目助理面板的会话框里，那里的
 * Esc 不该把详情关掉）。弹层开着时不用在这里判——叠层栈在 window 捕获阶段就接走 Esc 并停止
 * 传播，这次按键到不了本监听（冒泡阶段）。
 */
function onWindowKeydown(event: Event): void {
  if (!(event instanceof KeyboardEvent)) return;
  if (event.key !== 'Escape' || event.defaultPrevented || event.isComposing) return;
  const root = rootEl.value;
  const active = shadow.activeElement;
  if (root === null) return;
  if (active instanceof HTMLElement && active !== document.body && !root.contains(active)) return;
  event.preventDefault();
  emit('back');
}

watch(
  () => props.todo.id,
  () => void nextTick(focusHeading),
);

/**
 * 从详情里开的弹层关掉后，原语把焦点还给触发它的控件；那个控件若已随这次操作消失
 * （认领成功后「认领」按钮就不在了），焦点会掉到页面最顶层——此时收回到详情标题上。
 * 等最后一层弹层出栈、原语的还焦（微任务）跑完再判，只在焦点确实掉了时才动。
 */
let refocusTimer: ReturnType<typeof setTimeout> | undefined;
const stopOverlayWatch = overlayStack.subscribe((state) => {
  if (state.length > 0) return;
  clearTimeout(refocusTimer);
  refocusTimer = setTimeout(() => {
    const active = shadow.activeElement;
    if (active === null || active === document.body || !active.isConnected) focusHeading();
  }, 0);
});

onMounted(() => {
  shadow.addEventListener('keydown', onWindowKeydown);
  focusHeading();
});

onBeforeUnmount(() => {
  shadow.removeEventListener('keydown', onWindowKeydown);
  stopOverlayWatch();
  clearTimeout(refocusTimer);
  // 卸载后作废在途的完成标准请求，别让它落到已离开的详情上。
  criteriaRequest += 1;
});
</script>

<template>
  <article
    ref="rootEl"
    class="req-detail"
    data-testid="requirement-detail"
    :data-detail-id="props.todo.id"
    :aria-labelledby="headingId"
  >
    <header class="req-detail__head">
      <nav class="req-detail__nav" aria-label="需求详情">
        <button
          class="req-detail__back"
          type="button"
          data-testid="requirement-detail-back"
          @click="emit('back')"
        >
          <AppIcon name="chevron-down" :size="14" class="req-detail__backIcon" aria-hidden="true" />
          <span>{{ backLabel }}</span>
        </button>
        <RequirementDetailMoreMenu
          v-if="menuItems.length > 0"
          :items="menuItems"
          @select="onMenuSelect"
        />
      </nav>
      <div class="req-detail__meta">
        <ReferenceIdCopy
          :key="props.todo.id"
          class="req-detail__id"
          :reference-id="props.todo.id"
          label="需求 ID"
        />
        <span class="req-detail__badges">
          <TodoMetaBadges :todo="props.todo" @open-drafts="emit('openDrafts')" />
        </span>
        <TodoRowActions class="req-detail__status" variant="status" :todo="props.todo" />
      </div>
      <h2 :id="headingId" ref="headingEl" class="req-detail__title" tabindex="-1">
        {{ props.todo.title }}
      </h2>
    </header>

    <dl
      class="req-detail__fields"
      aria-label="需求关键字段"
      data-testid="requirement-detail-fields"
    >
      <div
        v-for="field in fields"
        :key="field.key"
        class="req-detail__field"
        :data-field="field.key"
      >
        <dt class="req-detail__fieldLabel">{{ field.label }}</dt>
        <dd class="req-detail__fieldValue" :class="{ 'is-placeholder': field.placeholder }">
          <span>{{ field.value }}</span>
          <button
            v-if="field.key === 'assignee' && canChangeAssignee"
            class="req-detail__fieldAction"
            type="button"
            aria-label="更改需求处理人"
            data-testid="requirement-detail-change-assignee"
            @click="emit('edit', props.todo)"
          >
            更改
          </button>
        </dd>
      </div>
    </dl>

    <div class="req-detail__body">
      <RequirementDetailPanel
        title="需求说明与完成标准"
        :title-id="`${headingId}-spec`"
        region-label="需求说明与完成标准内容"
        body-testid="requirement-detail-spec"
      >
        <p
          v-if="props.todo.description.trim().length > 0"
          class="req-detail__text"
          data-testid="requirement-detail-description"
        >
          {{ props.todo.description }}
        </p>
        <p v-else class="req-detail__empty">还没有写需求说明。</p>

        <div class="req-detail__block" data-testid="requirement-detail-criteria">
          <div class="req-detail__blockHead">
            <h4 class="req-detail__blockTitle">这条需求怎样算完成</h4>
            <button
              v-if="canEdit"
              class="req-detail__inline"
              type="button"
              data-testid="requirement-detail-edit"
              @click="emit('edit', props.todo)"
            >
              编辑需求
            </button>
          </div>
          <p v-if="criteriaState === 'loading'" class="req-detail__empty" role="status">
            正在读取完成标准…
          </p>
          <p v-else-if="criteriaState === 'error'" class="req-detail__empty" role="alert">
            完成标准暂时没有取到。
            <button class="req-detail__retry" type="button" @click="loadCriteria">重试</button>
          </p>
          <ol v-else-if="criteria.length > 0" class="req-detail__criteria">
            <li
              v-for="item in criteria"
              :key="item.ordinal"
              class="req-detail__criterion"
              :data-checked="item.checked ? 'yes' : 'no'"
            >
              <span class="req-detail__ordinal tnum" aria-hidden="true">{{
                ordinalText(item.ordinal)
              }}</span>
              <span class="req-detail__criterionText">{{ item.text }}</span>
            </li>
          </ol>
          <p v-else class="req-detail__empty">还没有填写完成标准。</p>
        </div>

        <div v-if="props.todo.constraintsText.trim().length > 0" class="req-detail__block">
          <h4 class="req-detail__blockTitle">注意事项</h4>
          <p class="req-detail__text">{{ props.todo.constraintsText }}</p>
        </div>

        <div class="req-detail__block" data-testid="requirement-detail-refs">
          <h4 class="req-detail__blockTitle">关联材料</h4>
          <ul v-if="props.todo.refs.length > 0" class="req-detail__refs">
            <li v-for="token in props.todo.refs" :key="token" class="req-detail__ref">
              <ProjectRefChip
                :token="token"
                :sources="refSources"
                @open="emit('openRef', $event)"
              />
            </li>
          </ul>
          <p v-else class="req-detail__empty">未关联材料</p>
        </div>

        <div class="req-detail__block" data-testid="requirement-detail-session">
          <h4 class="req-detail__blockTitle">关联会话</h4>
          <p v-if="props.todo.sessionRef" class="req-detail__session tnum">
            {{ props.todo.sessionRef }}
          </p>
          <p v-else class="req-detail__empty">未关联执行会话</p>
        </div>
        <ProjectTodoCollaboration
          :project-id="props.projectId"
          :todo="props.todo"
          @open-ref="emit('openRef', $event)"
        />
      </RequirementDetailPanel>

      <RequirementDetailWorkTabs
        :todo="props.todo"
        :items="children"
        :children-loading="childPages.loading.value"
        :children-error="childPages.error.value"
        :children-has-more="childPages.hasMore.value"
        :can-open="childOpenable"
        :decompose-targets="decomposeTargets"
        :test-records="testRecords"
        @open="openChild"
        @decompose="emit('decompose', props.todo, $event)"
        @retry-tests="store.loadRequirementRounds(props.projectId, props.todo.id)"
        @load-more-tests="store.loadMoreRequirementRounds(props.projectId, props.todo.id)"
        @retry-children="childPages.load()"
        @load-more-children="childPages.load(true)"
      />
    </div>

    <!-- 底部动作区：认领（无主需求）与提测块（TST-02，原型 .submission）同一个位置，二者按判据互斥。
         ⛔ 提测入口只在这里：不进更多菜单、不进任务行。 -->
    <footer
      v-if="canClaim || submission !== null"
      class="req-detail__foot"
      data-testid="requirement-detail-actions"
    >
      <button
        v-if="canClaim"
        class="btn btn--primary"
        type="button"
        data-testid="requirement-detail-claim"
        @click="emit('claim', props.todo)"
      >
        认领这条需求
      </button>
      <RequirementSubmissionBar
        v-if="submission !== null"
        :block="submission"
        @submit="emit('submitTest', props.todo)"
      />
    </footer>
  </article>
</template>

<style scoped>
/* 单屏卡片（原型 .requirement-card12：纵向 flex、gap 10、最宽 1500）。
   自身声明为尺寸容器：两栏 / 堆叠按**详情自己的宽度**切，不按视口——右侧助手分栏、配置侧栏
   开合都会改变它的可用宽度。 */
.req-detail {
  display: flex;
  width: 100%;
  max-width: 1500px; /* 原型 .requirement-card12 max-width=1500px（不在 --px-* 梯） */
  min-width: 0;
  min-height: 0;
  flex: 1;
  flex-direction: column;
  gap: var(--px-10);
  margin: 0 auto;
  container-type: inline-size;
}
.req-detail__head {
  display: flex;
  min-width: 0;
  flex: none;
  flex-direction: column;
  gap: var(--px-3);
}
/* 返回与更多操作同一行（原型 .req-card-nav12：gap 8、min-height 30）。 */
.req-detail__nav {
  display: flex;
  min-height: var(--px-30);
  flex-wrap: wrap;
  align-items: center;
  gap: var(--px-8);
}
/* 「‹ 返回需求池」文字钮（原型 textbtn）。 */
.req-detail__back {
  display: inline-flex;
  min-height: var(--ctl-h);
  align-items: center;
  gap: var(--px-2);
  padding: 0 var(--px-6) 0 var(--px-2);
  border: 0;
  border-radius: var(--r-sm);
  color: var(--accent-text);
  background: transparent;
  font: inherit;
  font-size: var(--fs-300);
  font-weight: var(--fw-label);
  cursor: pointer;
}
.req-detail__back:hover {
  background: var(--accent-soft);
}
.req-detail__back:focus-visible {
  outline: none;
  box-shadow: var(--focus-ring-flat);
}
/* 「‹」：图标集只有朝下的折角，转 90° 朝左。 */
.req-detail__backIcon {
  transform: rotate(90deg);
}
/* 编号 / 徽标 / 状态一行（原型 .req-card-title12 的 flex between：编号在左、状态在右）。 */
.req-detail__meta {
  display: flex;
  min-width: 0;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--px-6) var(--px-8);
  color: var(--muted);
  font-size: var(--fs-200);
}
.req-detail__id {
  min-width: 0;
  font-family: var(--font-mono);
}
.req-detail__badges {
  display: inline-flex;
  flex-wrap: wrap;
  gap: var(--sp-1);
}
.req-detail__badges:empty {
  display: none;
}
.req-detail__status {
  margin-left: auto;
}
/* 标题（原型最终层 .req-card-title12 h2：20px / 1.5）。长标题换行，⛔ 不截断。 */
.req-detail__title {
  margin: 0;
  color: var(--ink);
  font-size: var(--fs-600);
  font-weight: var(--fw-title);
  line-height: var(--lh-1p5);
  overflow-wrap: anywhere;
}
.req-detail__title:focus-visible {
  border-radius: var(--r-sm);
  outline: none;
  box-shadow: var(--focus-ring-flat);
}
/* 需求关键字段（原型 .req-card-fields12：四列、gap 8/18、padding 10/14、panel 底、描边圆角；
   目标画面 4 列 × 2 行，窄时降两列）。 */
.req-detail__fields {
  display: grid;
  flex: none;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: var(--px-8) var(--px-18);
  margin: 0;
  padding: var(--px-10) var(--px-14);
  border: var(--bw) solid var(--line);
  border-radius: var(--r-md);
  background: var(--panel);
  line-height: var(--lh-1p7);
}
.req-detail__field {
  min-width: 0;
}
.req-detail__fieldLabel {
  margin: 0 0 var(--px-2);
  color: var(--muted);
  font-size: var(--fs-200);
}
.req-detail__fieldValue {
  margin: 0;
  color: var(--ink);
  font-size: var(--fs-body);
  font-weight: var(--fw-label);
  overflow-wrap: anywhere;
}
/* 占位取值（—、已停用、正在读取…）压弱，不与真实内容抢眼。 */
.req-detail__fieldValue.is-placeholder {
  color: var(--muted);
  font-weight: var(--fw-body);
}
/* 值旁的就地动作（原型 .req-card-fields12 button：2px 5px、min-height 24）。 */
.req-detail__fieldAction {
  margin-left: var(--px-4);
  padding: var(--px-2) var(--px-5);
  border: 0;
  border-radius: var(--r-sm);
  color: var(--accent-text);
  background: transparent;
  font: inherit;
  font-size: var(--fs-300);
  cursor: pointer;
}
.req-detail__fieldAction:hover {
  background: var(--accent-soft);
}
.req-detail__fieldAction:focus-visible {
  outline: none;
  box-shadow: var(--focus-ring-flat);
}
/* 两栏主体（原型 .req-card-body12：minmax(270,.85fr) minmax(380,1.4fr)、gap 12）。
   min-height 兜矮窗：主体不被压没，放不下时交给页签的纵向滚动（原型 short-height17 同意）。 */
.req-detail__body {
  display: grid;
  min-height: 240px; /* 原型 .short-height17 .req-card-body12 min-height=240px（不在 --px-* 梯） */
  flex: 1;
  grid-template-columns: minmax(270px, 0.85fr) minmax(380px, 1.4fr); /* 原型两栏度量 */
  gap: var(--px-12);
}
/* 面板外壳与各自滚动在 RequirementDetailPanel.vue，右栏页签在 RequirementDetailWorkTabs.vue。 */
/* 用户亲笔长文（原型 .detail-summary：14px / 1.8 / pre-wrap）。 */
.req-detail__text {
  margin: 0 0 var(--px-10);
  color: var(--ink);
  font-size: var(--fs-body);
  line-height: var(--lh-1p8);
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
.req-detail__empty {
  margin: 0 0 var(--px-8);
  color: var(--muted);
  font-size: var(--fs-body);
  line-height: var(--lh-body);
}
/* 分节（原型 .acceptance：上边线 + 10px 上内边距）。 */
.req-detail__block {
  padding-top: var(--px-10);
  border-top: var(--bw) solid var(--line);
}
.req-detail__block + .req-detail__block {
  margin-top: var(--px-10);
}
/* 分节标题行（原型 .acceptance>.flex.between：标题在左、「编辑需求」在右）。 */
.req-detail__blockHead {
  display: flex;
  min-width: 0;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: var(--px-6);
  margin: 0 0 var(--px-6);
}
.req-detail__blockTitle {
  margin: 0 0 var(--px-6);
  color: var(--ink);
  font-size: var(--fs-300);
  font-weight: var(--fw-title);
}
.req-detail__blockHead .req-detail__blockTitle {
  margin: 0;
}
.req-detail__criteria {
  display: flex;
  margin: 0 0 var(--px-8);
  padding: 0;
  flex-direction: column;
  gap: var(--px-6);
  list-style: none;
}
.req-detail__criterion {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  gap: var(--px-8);
  color: var(--ink);
  font-size: var(--fs-body);
  line-height: var(--lh-1p8);
}
.req-detail__ordinal {
  color: var(--muted);
  font-family: var(--font-mono);
}
.req-detail__criterionText {
  overflow-wrap: anywhere;
}
.req-detail__criterion[data-checked='yes'] .req-detail__ordinal {
  color: var(--ok-text);
}
.req-detail__retry {
  padding: 0 var(--px-4);
  border: 0;
  color: var(--accent-text);
  background: transparent;
  font: inherit;
  cursor: pointer;
}
.req-detail__refs {
  display: flex;
  margin: 0 0 var(--px-8);
  padding: 0;
  flex-wrap: wrap;
  gap: var(--px-6);
  list-style: none;
}
.req-detail__ref {
  display: inline-flex;
  max-width: 100%;
  align-items: center;
  gap: var(--px-6);
  padding: var(--px-2) var(--px-8);
  border: var(--bw) solid var(--line);
  border-radius: var(--r-md);
  background: var(--sunken);
  font-size: var(--fs-200);
}
.req-detail__refKind {
  color: var(--muted);
}
.req-detail__refName {
  min-width: 0;
  color: var(--ink);
  font-weight: var(--fw-label);
  overflow-wrap: anywhere;
}
.req-detail__session {
  margin: 0 0 var(--px-8);
  color: var(--ink);
  font-family: var(--font-mono);
  font-size: var(--fs-200);
  overflow-wrap: anywhere;
}
/* 分节标题旁的就地动作（原型 textbtn「编辑需求」）。 */
.req-detail__inline {
  display: inline-flex;
  min-height: var(--ctl-h-sm);
  align-items: center;
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
.req-detail__inline:hover {
  background: var(--accent-soft);
}
.req-detail__inline:focus-visible {
  outline: none;
  box-shadow: var(--focus-ring-flat);
}
/* 底部动作区（原型 .req-card-foot12：不参与伸缩，始终在两栏之下；主按钮左对齐）。 */
.req-detail__foot {
  display: flex;
  flex: none;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--px-8);
}
/* 窄（原型 @media max-width:850 的等价，这里按详情自身宽度判）：字段两列、两栏上下堆叠，
   面板不再各自滚动（同阈值的规则在 RequirementDetailPanel.vue），整张卡交给页签的纵向滚动——
   长文照样读得完，字号不变。
   阈值 660 = 两栏最小宽 270 + 380 + 间距 12 再留一点余量：1280 宽窗口带右侧配置栏时详情约
   668px，仍保持原型的两栏单屏；900 宽窗口（约 636px）起堆叠。 */
@container (max-width: 660px) {
  .req-detail__fields {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
  .req-detail__body {
    display: flex;
    min-height: 0;
    flex: none;
    flex-direction: column;
  }
}
</style>
