<script setup lang="ts">
import { computed, nextTick, onScopeDispose, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';

import {
  isTodoRequirement,
  PROJECT_MAX_NAME_LENGTH,
  projectRoleAtLeast,
} from '@shared/protocol/project-collab.js';
import type { ProjectConnectionState } from '@shared/protocol/project-collab.js';

import { projectRuntime, type ProjectSidebarState } from '../../../../src/ui/runtime';
import ProjectNotificationSettings from '../components/settings/ProjectNotificationSettings.vue';
import AppIcon from '../components/ui/AppIcon.vue';
import ReferenceIdCopy from '../components/ui/ReferenceIdCopy.vue';
import ProjectAgreementsPanel from '../components/project/ProjectAgreementsPanel.vue';
import ProjectConversation from '../components/project/ProjectConversation.vue';
import ProjectDetailTabContent from '../components/project/ProjectDetailTabContent.vue';
import ProjectConfigAside from '../components/project/ProjectConfigAside.vue';
import ProjectAssistantPanel from '../components/project/ProjectAssistantPanel.vue';
import ProjectDialogShell from '../components/project/ProjectDialogShell.vue';
import ProjectInviteDialog from '../components/project/ProjectInviteDialog.vue';
import ProjectManageMenu from '../components/project/ProjectManageMenu.vue';
import ProjectMembersDialog from '../components/project/ProjectMembersDialog.vue';
import ProjectSettingsDialog from '../components/project/ProjectSettingsDialog.vue';
import WorkspaceBindingChip from '../components/workspace/WorkspaceBindingChip.vue';
import ProjectServiceUpgradeNotice from '../components/project/ProjectServiceUpgradeNotice.vue';
import ProjectTabOrderPopover from '../components/project/ProjectTabOrderPopover.vue';
import { avatarText, avatarTone, PROJECT_ROLE_LABELS } from '../components/project/project-format';
import type { ProjectManageAction } from '../components/project/project-manage-actions';
import { PROJECT_REF_NOTICES } from '../components/project/project-ref-navigation';
import {
  createProjectRefNavigator,
  fetchProjectRefTodo,
} from '../components/project/project-ref-resolver';
import type {
  ProjectRefTodoFocus,
  ProjectRefTodoTab,
} from '../components/project/project-ref-navigation';
import type { ProjectRefTarget } from '../components/project/project-refs';
import { resolveInitialTab, type ProjectTab } from '../components/project/project-tabs';
import { useProjectTabPreferences } from '../components/project/useProjectTabPreferences';
import { useProjectWorkspaceStore } from '../stores/projectWorkspace';
import { useToastStore } from '../stores/toasts';
import {
  projectCollabErrorNotice,
  projectConnectionIndicatorLabel,
  projectConnectionLabel,
  useProjectCollabStore,
} from '../stores/projectCollab';

const PLACEHOLDER_TABS: Readonly<
  Record<'tests', { readonly title: string; readonly note: string }>
> = {
  tests: {
    title: '测试稍后开放',
    note: '提测与验收将在后续版本接入，届时可在此查看提测快照、结论与轮次。',
  },
};

/** 顺序存档没存下时的提示（原顺序保留；对齐合并产物 `saveTabOrder24` 的失败提示）。 */
const TAB_ORDER_SAVE_FAILED = '页签顺序保存失败，原顺序保留。';

/** 需求页与任务页读的是同一份待办清单——取数只有一次，别按页签各取各的。 */
const TODO_TABS: readonly ProjectTab[] = ['requirements', 'tasks'];

const route = useRoute();
const router = useRouter();
const store = useProjectCollabStore();
const notificationSettingsOpen = ref(false);
const projectWorkspace = useProjectWorkspaceStore();
/* 在 setup 期取定：失败回调在事件时刻触发，那时再取会落到「当前激活的 pinia」上，不一定是本应用的。 */
const toasts = useToastStore();

const activeTab = ref<ProjectTab>(resolveInitialTab());
const inviteOpen = ref(false);
/** 「项目约定」头部入口的抽屉开关（原型 `:1841`：rules 不再是页签，改挂头部）。 */
const agreementsOpen = ref(false);

const membersOpen = ref(false);
const settingsOpen = ref(false);
/** 成员弹层打开时要定位的人；只有从引用跳过来才有，从「成员与权限」入口开时为 null。 */
const membersFocusSubject = ref<string | null>(null);

/** 运行期间按项目恢复侧栏，原生对话实例常驻。 */
const sidebarStates = projectRuntime().sidebarStates;
const sidebarState = ref<ProjectSidebarState>({ tab: 'assistant', open: true, width: 440 });

function resetAssistantPanel(): void {
  sidebarState.value = { ...(sidebarStates.get(projectId.value) ?? { tab: 'assistant', open: true, width: 440 }) };
}

const todoFocus = ref<{
  readonly tab: ProjectRefTodoTab;
  readonly request: ProjectRefTodoFocus;
} | null>(null);
const assetFocusFileId = ref<string | null>(null);

function clearRefFocus(): void {
  todoFocus.value = null;
  assetFocusFileId.value = null;
}

const canInvite = computed(() => projectRoleAtLeast(store.myRole, 'manager') && !store.isArchived);

const projectId = computed(() => {
  const raw = route.params['projectId'];
  return typeof raw === 'string' ? raw : '';
});

watch(sidebarState, state => { sidebarStates.set(projectId.value, { ...state }); }, { deep: true, flush: 'sync' });

const tabStrip = ref<HTMLElement | null>(null);
const {
  tabs: orderedTabs,
  isDefaultOrder,
  dragSourceId,
  dropTargetId,
  initialTab,
  rememberActiveTab,
  moveTab,
  resetTabOrder,
  onTabKeydown,
  onTabDragStart,
  onTabDragOver,
  onTabDragLeave,
  onTabDrop,
  onTabDragEnd,
} = useProjectTabPreferences({
  actor: () => store.mySubject,
  projectId: () => projectId.value,
  onOrderSaveFailed: () => {
    toasts.push({ level: 'warn', text: TAB_ORDER_SAVE_FAILED });
  },
  // 键盘 / 拖放重排后页签节点被搬家，焦点会掉：等 DOM 落定再还给被移动的那一格。
  focusTab: (id) => {
    void nextTick(() => {
      tabStrip.value?.querySelector<HTMLButtonElement>(`.project-tab[data-tab="${id}"]`)?.focus();
    });
  },
});

const renaming = ref(false);
const renameDraft = ref('');
const renameSaving = ref(false);
const renameInput = ref<HTMLInputElement | null>(null);

const renameTrimmed = computed(() => renameDraft.value.trim());
const canSubmitRename = computed(() => renameTrimmed.value.length > 0 && !renameSaving.value);

function startRename(): void {
  if (!store.canRenameProject) return;
  renameDraft.value = store.detail?.name ?? '';
  renaming.value = true;
  void nextTick(() => {
    renameInput.value?.focus();
    renameInput.value?.select();
  });
}

function cancelRename(): void {
  renaming.value = false;
  renameDraft.value = '';
}

async function submitRename(): Promise<void> {
  if (!canSubmitRename.value) return;
  const next = renameTrimmed.value;
  if (next === store.detail?.name) {
    cancelRename();
    return;
  }
  renameSaving.value = true;
  try {
    const saved = await store.renameProject(projectId.value, next);
    // 失败时不关：常驻条上有参考编号，用户看完自己决定重试还是放弃。
    if (saved) cancelRename();
  } finally {
    renameSaving.value = false;
  }
}

const CONNECTION_REFERENCE_CODE = projectCollabErrorNotice('transient').referenceCode ?? '';

/* 顶栏连接指示的三档短标签已归位到 `projectCollabErrors`（项目组用户可见措辞的单一处所）
   ——项目列表页要显示同一枚指示器，各自抄一份会让措辞体检盯不住。 */

/** 连接态未定（首帧尚无连接帧）时按在线呈现：详情能打开即说明链路是通的。 */
const effectiveConnection = computed<ProjectConnectionState>(() => store.connection ?? 'online');
const connectionIndicatorLabel = computed(() => projectConnectionIndicatorLabel(store.connection));

const showDisconnectedBanner = computed(
  () => store.connection === 'offline' && store.detail != null,
);
/** 横幅正文＝连接文案单一源（offline → 「项目组同步已断开，内容可能不是最新」）。 */
const bannerText = computed(() => projectConnectionLabel(store.connection));

/** 顶栏项目头像：与成员头像同一套首字/色分桶，只把形状改成方角块。 */
const projectInitial = computed(() => avatarText(store.detail?.name ?? null));
const projectTone = computed(() => String(avatarTone(store.detail?.name ?? null)));

/** 成员数（含受邀未加入，与右栏名册同口径：非「已移出」即计入）。 */
const memberCount = computed(
  () => store.detail?.members.filter((member) => member.state !== 'removed').length ?? 0,
);

const requirementCount = computed(
  () => store.todos.filter((todo) => isTodoRequirement(todo)).length,
);
const taskCount = computed(() => store.todos.filter((todo) => !isTodoRequirement(todo)).length);
function tabCount(tab: ProjectTab): number {
  if (tab === 'requirements') return requirementCount.value;
  if (tab === 'tasks') return taskCount.value;
  if (tab === 'assets') return store.files.length;
  return 0;
}

/** 当前页签若是仅有外壳的页签（测试），给出它的「稍后开放」文案。 */
const placeholderCopy = computed(() => {
  const tab = activeTab.value;
  return tab === 'tests' ? PLACEHOLDER_TABS[tab] : null;
});

/** 进入 / 切换项目：重置页签并让 store 换域；路由守卫已保证能力开启。 */
watch(
  projectId,
  async (id, previous) => {
    if (!id) return;
    if (id !== previous) {
      // 进入 / 换项目：落到本账号在该项目上次停留的页签（UX-10「刷新保持已选 tab」）；
      // 没存过、存的是已删除的页签（如 reports）⇒ 默认落地页需求池（D-PROTO-01 §6）。
      activeTab.value = initialTab(id);
      inviteOpen.value = false;
      agreementsOpen.value = false;
      closeMembers();
      settingsOpen.value = false;
      // 新项目默认展开助理，不继承其他项目的收起状态。
      resetAssistantPanel();
      // 没处理完的引用跳转指向上一个项目的对象，一并作废。
      clearRefFocus();
      // 换项目时丢掉上一个项目的改名草稿——那份名字不属于这一个。
      cancelRename();
    }
    const workspaceOpening = projectWorkspace.openProject(id);
    await store.openProject(id);
    await workspaceOpening;
    await loadTab(activeTab.value);
  },
  { immediate: true },
);

watch(
  () => store.mySubject,
  () => {
    activeTab.value = initialTab(projectId.value);
    closeMembers();
    settingsOpen.value = false;
    resetAssistantPanel();
    // 换号：上一个账号点出来、还没落地的引用跳转不属于新账号。
    clearRefFocus();
  },
);

/** 页签按需取数（⛔ 不轮询；事件到达后由 store 合帧重取对应域）。 */
async function loadTab(tab: ProjectTab): Promise<void> {
  const id = projectId.value;
  if (!id) return;
  if (tab === 'feed') await store.loadFeed(id);
  // 首次查询由面板按账号、页签和筛选发起；重连只刷新已建立的分页查询。
  if (TODO_TABS.includes(tab) && store.requirementQueryRevision !== null) {
    await store.loadRequirementPage(id);
  }
  // 资产页：文件列表与资产版本（目录 + 回收站，RPT-08）同时取——两套模型各取各的，
  // ⛔ 不互相推导（ADR-0037 决策 8）。回收站也在这里取：区块要据它判断「有没有资产版本数据」。
  if (tab === 'assets') {
    await Promise.all([store.loadFiles(id), store.loadAssets(id), store.loadAssetTrash(id)]);
  }
  // 里程碑（MIL-04）：取一页业务目标；展开态与页码在 store 里，重取不丢（判据「保持状态」）。
  // 走 loadTab 而非组件内自取，是为了让重连补拉（reconnect → loadTab）与切项目也刷新它。
  if (tab === 'milestones') await store.loadMilestones(id);
  if (tab === 'chat') {
    // 进入页签即取最新一页并上报读游标（读到哪算哪，服务端幂等 max()）。
    await store.loadChatLatest(id);
    await store.markChatRead(id);
  }
}

function selectTab(tab: ProjectTab): void {
  // 业务页签独立切换，保持助理开合和未发草稿。
  if (activeTab.value === tab) return;
  activeTab.value = tab;
  // 记进本账号 × 本项目的存档：刷新 / 重进项目回到这一页。存不下不拦这次切换。
  rememberActiveTab(tab);
  void loadTab(tab);
}

/* ------------------------- 引用芯片跳转（测试提单 2552） ------------------------- */
/** 授权读取与项目/账号边界复核后，在上方业务区定位引用；助理输入实例保持常驻。 */
const refNavigator = createProjectRefNavigator({
  getContext: () => ({
    projectId: store.activeProjectId === projectId.value ? projectId.value : null,
    accountEpoch: store.accountEpoch,
    projectEpoch: store.projectEpoch,
    todos: store.todos,
    files: store.files,
    members: store.detail?.members ?? [],
    canEditTodo: (todo) => store.canEditTodo(todo),
  }),
  fetchTodo: fetchProjectRefTodo,
});

async function openRef(target: ProjectRefTarget): Promise<void> {
  const plan = await refNavigator.resolve(target);
  if (plan === null) return;
  if (plan.kind === 'unavailable') {
    toasts.push({ level: 'warn', text: plan.notice });
    return;
  }
  if (plan.kind === 'todo') {
    todoFocus.value = { tab: plan.tab, request: plan.focus };
    selectTab(plan.tab);
    if (plan.notice !== null) toasts.push({ level: 'info', text: plan.notice });
    return;
  }
  if (plan.kind === 'asset') {
    assetFocusFileId.value = plan.fileId;
    selectTab('assets');
    return;
  }
  // 详情没了（换号作废、换项目加载中）弹层摆不出来：与原先「右栏不在」同一句提示。
  if (store.detail === null) {
    toasts.push({ level: 'warn', text: PROJECT_REF_NOTICES.memberUnavailable });
    return;
  }
  openMembers(plan.subject);
}

function onTodoFocusHandled(found: boolean): void {
  todoFocus.value = null;
  if (!found) toasts.push({ level: 'warn', text: PROJECT_REF_NOTICES.todoUnavailable });
}

function onAssetFocusHandled(found: boolean): void {
  assetFocusFileId.value = null;
  if (!found) toasts.push({ level: 'warn', text: PROJECT_REF_NOTICES.assetUnavailable });
}

watch(
  () => store.testRoundView?.submissionId ?? null,
  (submissionId) => {
    if (submissionId !== null && activeTab.value !== 'tests') selectTab('tests');
  },
);

function openRequirementFromTest(requirementId: string): void {
  todoFocus.value = { tab: 'requirements', request: { todoId: requirementId, mode: 'detail' } };
  selectTab('requirements');
}

/** 需求编辑器「在里程碑页查看」（MIL-09）：切到里程碑页并展开需求所在的目标（没排则只切页）。 */
function openMilestones(milestoneId: string | null): void {
  if (milestoneId) store.focusMilestone(projectId.value, milestoneId);
  selectTab('milestones');
}

watch(
  activeTab,
  () => {
    void nextTick(() => {
      tabStrip.value
        ?.querySelector<HTMLElement>('.project-tab.is-on')
        ?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
    });
  },
  { immediate: true },
);

function backToList(): void {
  void router.push('/projects');
}

function openNotificationSettings(): void { notificationSettingsOpen.value = true; }

function openManage(action: ProjectManageAction): void {
  if (action === 'members') openMembers(null);
  else if (action === 'settings') settingsOpen.value = true;
  else openNotificationSettings();
}

function openMembers(focusSubject: string | null): void {
  membersFocusSubject.value = focusSubject;
  membersOpen.value = true;
}

function closeMembers(): void {
  membersOpen.value = false;
  membersFocusSubject.value = null;
}

/** 从「成员与权限」里点邀请：先收起该弹层再开邀请框，焦点不在两层模态之间打转。 */
function inviteFromMembers(): void {
  closeMembers();
  inviteOpen.value = true;
}

async function startProjectSession(): Promise<void> {
  openAssistant();
  await nextTick();
  await projectConversation.value?.prefill('');
}

async function openExecutionSession(sessionId: string): Promise<void> {
  openAssistant();
  await nextTick();
  await projectConversation.value?.open(sessionId);
}

const projectConversation = ref<InstanceType<typeof ProjectConversation> | null>(null);

async function prefillDecomposeRequest(text: string): Promise<void> {
  openAssistant();
  await nextTick();
  await projectConversation.value?.prefill(text);
}

const reconnecting = ref(false);

async function reconnect(): Promise<void> {
  if (reconnecting.value) return;
  const id = projectId.value;
  if (!id) return;
  reconnecting.value = true;
  try {
    await store.loadDetail(id);
    await loadTab(activeTab.value);
  } finally {
    reconnecting.value = false;
  }
}

// 常驻页面接收重同步提示，断线恢复后补拉当前页，不依赖重新挂载。
let previousConnection = store.connection;
onScopeDispose(projectRuntime().api.onProjectEvent(event => {
  if (event.kind !== 'connection') return;
  const state = event.payload.state;
  const refresh = state === 'degraded' || (state === 'online' && previousConnection !== 'online');
  previousConnection = state;
  if (refresh && store.detail?.id === projectId.value) void reconnect();
}));

/** 常驻输入框不随页签、开合重建，保留未发草稿、附件和当前绑定。 */
const assistantToggle = ref<HTMLButtonElement | null>(null);
const overviewToggle = ref<HTMLButtonElement | null>(null);

function openAssistant(): void {
  sidebarState.value.tab = 'assistant';
  sidebarState.value.open = true;
}

function closeAssistant(): void {
  sidebarState.value.open = false;
}

function toggleOverview(): void {
  if (sidebarState.value.open && sidebarState.value.tab === 'overview') closeAssistant();
  else { sidebarState.value.tab = 'overview'; sidebarState.value.open = true; }
}

function toggleAssistant(): void {
  if (sidebarState.value.open && sidebarState.value.tab === 'assistant') closeAssistant();
  else openAssistant();
}

function collapseAssistant(): void {
  closeAssistant();
  void nextTick(() => (sidebarState.value.tab === 'overview' ? overviewToggle.value : assistantToggle.value)?.focus());
}
</script>

<template>
  <ProjectDialogShell v-if="notificationSettingsOpen" title="项目通知" @close="notificationSettingsOpen = false"><ProjectNotificationSettings /></ProjectDialogShell>
  <div
    class="project-detail"
    data-density="proto"
  >
    <section class="project-detail__workspace">
      <header class="project-detail__top">
        <button
          class="project-detail__back"
          type="button"
          aria-label="返回项目列表"
          @click="backToList"
        >
          <AppIcon name="back" :size="13" />
        </button>
        <span class="project-detail__av" :data-tone="projectTone" aria-hidden="true">{{
          projectInitial
        }}</span>
        <div class="project-detail__id">
          <form
            v-if="renaming"
            class="project-detail__rename"
            data-testid="project-rename-form"
            @submit.prevent="submitRename"
          >
            <input
              ref="renameInput"
              v-model="renameDraft"
              class="project-detail__renameInput"
              type="text"
              :maxlength="PROJECT_MAX_NAME_LENGTH"
              :disabled="renameSaving"
              aria-label="项目名称"
              data-testid="project-rename-input"
              @keydown.esc.prevent="cancelRename"
            />
            <button
              class="btn btn--primary project-detail__renameBtn"
              type="submit"
              :disabled="!canSubmitRename"
              data-testid="project-rename-save"
            >
              保存
            </button>
            <button
              class="btn btn--ghost project-detail__renameBtn"
              type="button"
              :disabled="renameSaving"
              data-testid="project-rename-cancel"
              @click="cancelRename"
            >
              取消
            </button>
          </form>
          <div v-else class="project-detail__titleRow">
            <h1 class="project-detail__title">{{ store.detail?.name ?? '项目' }}</h1>
            <!-- 只对拥有者出现（归档态收起）：不摆点了必然 403 的入口。 -->
            <button
              v-if="store.canRenameProject"
              class="project-detail__renameOpen"
              type="button"
              aria-label="重命名项目"
              title="重命名项目"
              data-testid="project-rename-open"
              @click="startRename"
            >
              <AppIcon name="edit" :size="12" />
            </button>
          </div>
          <ReferenceIdCopy
            v-if="store.detail?.id === projectId"
            :key="store.detail.id"
            :reference-id="store.detail.id"
            label="项目 ID"
            class="project-detail__referenceId"
          />
          <p v-if="store.detail" class="project-detail__sub">
            <span class="tnum">{{ memberCount }}</span> 位成员<template v-if="store.myRole">
              · 你是
              <span class="project-detail__role">{{
                PROJECT_ROLE_LABELS[store.myRole]
              }}</span></template
            >
            <!-- 归档态标在副标题（原型 project-meta 的「· 已归档」）：右栏的归档提示块在助理面板
                 打开时看不见，只读状态不能跟着一起消失。恢复入口在「⋯」→ 项目设置。 -->
            <template v-if="store.isArchived">
              <span class="project-detail__metaSep" aria-hidden="true">·</span>
              <span class="project-detail__archived" data-testid="project-archived-badge"
                >已归档（只读）</span
              >
            </template>
            <span class="project-detail__metaSep" aria-hidden="true">·</span>
            <span>新对话工作空间：</span><WorkspaceBindingChip :project-id="projectId" variant="inline" />
          </p>
        </div>

        <div class="project-detail__actions">
          <button
            v-if="store.detail"
            class="btn btn--ghost project-detail__agreements agreement-header-entry"
            type="button"
            data-testid="project-agreements-open"
            aria-haspopup="dialog"
            @click="agreementsOpen = true"
          >
            <AppIcon name="plan" :size="13" />
            项目约定
          </button>

          <button v-if="store.detail" ref="overviewToggle"
            class="btn btn--ghost project-detail__assistantToggle" type="button"
            data-testid="project-overview-toggle" aria-controls="project-overview-panel"
            :aria-pressed="sidebarState.open && sidebarState.tab === 'overview'" @click="toggleOverview">
            <AppIcon name="plan" :size="13" />
            项目概览
          </button>

          <button
            v-if="store.detail"
            ref="assistantToggle"
            class="btn btn--ghost project-detail__assistantToggle"
            type="button"
            data-testid="project-assistant-toggle"
            aria-controls="project-chat-panel"
            :aria-pressed="sidebarState.open && sidebarState.tab === 'assistant'"
            @click="toggleAssistant"
          >
            <AppIcon name="agents" :size="13" />
            项目助理
          </button>
          <span class="project-detail__conn" :data-state="effectiveConnection" role="status">
            <span class="project-detail__connDot" aria-hidden="true"></span>
            {{ connectionIndicatorLabel }}
          </span>
          <button
            v-if="canInvite"
            class="btn btn--secondary project-detail__invite"
            type="button"
            data-testid="invite-open"
            @click="inviteOpen = true"
          >
            <AppIcon name="users" :size="13" />
            邀请成员
          </button>

          <ProjectManageMenu v-if="store.detail" @select="openManage" />
        </div>
      </header>

      <div v-if="store.actionNotice" class="project-detail__notice" role="status">
        <span>{{ store.actionNotice.message }}</span>
        <ReferenceIdCopy
          v-if="store.actionNotice.referenceCode"
          :reference-id="store.actionNotice.referenceCode"
        />
        <button type="button" aria-label="关闭提示" @click="store.clearActionNotice()">✕</button>
      </div>

      <!-- 连不上错误态：显示错误而非「暂无数据」（错误态优先于空态），带可复制参考编号 + 重试 -->
      <div v-if="store.detailError && !store.detail" class="project-detail__error" role="alert">
        <span class="project-detail__errorArt" aria-hidden="true">
          <AppIcon name="refresh" :size="22" />
        </span>
        <strong class="project-detail__errorTitle">{{ store.detailError.message }}</strong>
        <p class="project-detail__errorDesc">
          本地任务不受影响，可离线继续；项目组的动态、需求与任务会在恢复连接后自动补齐，不会丢失。
        </p>
        <div class="project-detail__errorRow">
          <ReferenceIdCopy
            v-if="store.detailError.referenceCode"
            :reference-id="store.detailError.referenceCode"
          />
          <button class="btn btn--primary" type="button" @click="store.openProject(projectId)">
            重试
          </button>
        </div>
      </div>

      <template v-else>
        <nav ref="tabStrip" class="project-tabs" aria-label="项目页签">
          <button
            v-for="tab in orderedTabs"
            :key="tab.id"
            class="project-tab"
            :class="{
              'is-on': activeTab === tab.id,
              'is-dragging': dragSourceId === tab.id,
              'is-drop-target': dropTargetId === tab.id && dragSourceId !== tab.id,
            }"
            type="button"
            draggable="true"
            :data-tab="tab.id"
            :aria-current="activeTab === tab.id ? 'page' : undefined"
            aria-keyshortcuts="Alt+ArrowLeft Alt+ArrowRight"
            title="拖动调整顺序，也可用 Alt + 左右方向键移动"
            @click="selectTab(tab.id)"
            @keydown="onTabKeydown(tab.id, $event)"
            @dragstart="onTabDragStart(tab.id, $event)"
            @dragover="onTabDragOver(tab.id, $event)"
            @dragleave="onTabDragLeave(tab.id)"
            @drop="onTabDrop(tab.id, $event)"
            @dragend="onTabDragEnd"
          >
            <AppIcon :name="tab.icon" :size="13" class="project-tab__icon" />
            <span>{{ tab.label }}</span>
            <span v-if="tabCount(tab.id) > 0" class="project-tab__cnt tnum">{{
              tabCount(tab.id)
            }}</span>
          </button>
          <ProjectTabOrderPopover
            class="project-tabs__order"
            :tabs="orderedTabs"
            :is-default-order="isDefaultOrder"
            @move="moveTab"
            @reset="resetTabOrder"
          />
        </nav>

        <!-- 断线横幅：内容仍展示但可能不是最新（错误态优先于空态；不谎报「暂无数据」） -->
        <div v-if="showDisconnectedBanner" class="project-detail__banner" role="status">
          <AppIcon name="refresh" :size="16" class="project-detail__bannerIcon" />
          <span class="project-detail__bannerText">{{ bannerText }}</span>
          <span class="project-detail__bannerSpacer"></span>
          <ReferenceIdCopy :reference-id="CONNECTION_REFERENCE_CODE" />
          <button
            class="btn btn--secondary"
            type="button"
            :disabled="reconnecting"
            data-testid="project-reconnect"
            @click="reconnect"
          >
            {{ reconnecting ? '重新连接…' : '重新连接' }}
          </button>
        </div>

        <div class="project-detail__body">
          <main class="project-detail__main" :class="{ 'is-assistant-open': sidebarState.open }">
            <!-- 业务区位于助理前，键盘和视觉阅读顺序一致。 -->
            <div class="project-detail__content">
              <!-- 服务能力升级提示（CORE-05）：旧服务缺归类写能力时显示；自协商、按需渲染。 -->
              <ProjectServiceUpgradeNotice />
              <!-- 页签切换的进场（规范 §7.5「视图进入」；:key 换页即重放，含操作按钮故入场期锁指针） -->
              <ProjectDetailTabContent
                :account-epoch="store.accountEpoch"
                :project-epoch="store.projectEpoch"
                :key="activeTab"
                :active-tab="activeTab"
                :project-id="projectId"
                :todo-focus="todoFocus"
                :asset-focus-file-id="assetFocusFileId"
                :has-test-round="store.testRoundView !== null"
                :placeholder-copy="placeholderCopy"
                @open-ref="openRef"
                @open-execution="openExecutionSession"
                @decompose="prefillDecomposeRequest"
                @open-milestones="openMilestones"
                @todo-focus-handled="onTodoFocusHandled"
                @asset-focus-handled="onAssetFocusHandled"
                @start="startProjectSession"
                @back="store.closeTestRound()"
                @open-requirement="openRequirementFromTest"
              />
            </div>

            <ProjectAssistantPanel v-model:width="sidebarState.width" :tab="sidebarState.tab" :open="sidebarState.open" @close="collapseAssistant">
              <template #overview>
                <ProjectConfigAside v-if="store.detail" :project-id="projectId"
                  @invite="inviteOpen = true" @open-assets="selectTab('assets')" @manage="openManage" />
              </template>
              <ProjectConversation :key="projectId" ref="projectConversation" :project-id="projectId" />
            </ProjectAssistantPanel>
          </main>
        </div>
      </template>
    </section>

    <ProjectInviteDialog v-if="inviteOpen" :project-id="projectId" @close="inviteOpen = false" />

    <!-- 「成员与权限」「项目设置」弹层（UX-14 起归页面）：右栏分区与页头「⋯」共用这一个实例。
         详情没了（换号作废、换项目加载中）弹层随之收起，⛔ 不对着空详情摆管理界面。 -->
    <ProjectMembersDialog
      v-if="membersOpen && store.detail"
      :project-id="projectId"
      :focus-subject="membersFocusSubject"
      @close="closeMembers"
      @invite="inviteFromMembers"
    />
    <ProjectSettingsDialog
      v-if="settingsOpen && store.detail"
      :project-id="projectId"
      @close="settingsOpen = false"
    />

    <ProjectDialogShell v-if="agreementsOpen" title="项目约定" @close="agreementsOpen = false">
      <ProjectAgreementsPanel class="project-detail__drawerAgreements" :project-id="projectId" />
    </ProjectDialogShell>
  </div>
</template>

<style scoped src="./project-detail-view.css"></style>
