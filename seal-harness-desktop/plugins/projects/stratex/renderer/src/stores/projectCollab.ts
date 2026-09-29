import { defineStore } from 'pinia';

import type {
  ProjectAssignableRole,
  ProjectCollabErrorCode,
  ProjectDetail,
  ProjectEvent,
  ProjectEventKind,
  ProjectFileKind,
  ProjectInvitationKind,
  ProjectInvitationRole,
  ProjectOpenInvitationTtlHours,
  ProjectTodoAcceptanceSetRequest,
  ProjectTodoCreateRequest,
  ProjectRequirementClaimRequest,
  ProjectTodoReviewRequest,
  ProjectTodoSubmitReviewRequest,
  ProjectTodoUpdateRequest,
  Todo,
} from '@shared/protocol/project-collab.js';
import { projectRoleAtLeast } from '@shared/protocol/project-collab.js';
import type {
  ProjectIterationListItem,
  ProjectMilestoneListItem,
} from '@shared/protocol/project-planning.js';
import type { ProjectPlanningLifecycleAction } from '@shared/protocol/project-planning-lifecycle.js';
import type { ProjectPlanWindow } from '@shared/protocol/project-collab-plan-dates.js';
import type { ProjectRequirementSubmitRequest } from '@shared/protocol/project-testing.js';
import type {
  ProjectRoundTestCaseCreateRequest,
  ProjectTestCaseUpdateRequest,
} from '@shared/protocol/project-testing-cases.js';

import * as assetVersions from './projectCollabAssets';
import * as board from './projectCollabBoard';
import * as requirementPage from './projectCollabRequirementPage';
import * as planning from './projectCollabPlanning';
import * as planWindow from './projectCollabPlanWindow';
import * as schedule from './projectCollabSchedule';
import * as lifecycle from './projectCollabPlanningLifecycle';
import * as planningForms from './projectCollabPlanningForms';
import * as requirementSchedule from './projectCollabRequirementSchedule';
import * as chat from './projectCollabChat';
import {
  PROJECT_EVENT_COALESCE_MS,
  projectCollabErrorNotice,
  projectCollabErrorText,
} from './projectCollabErrors';
import * as feed from './projectCollabFeed';
import * as files from './projectCollabFiles';
import { pushProjectCollabReceipt } from './projectCollabReceipts';
import {
  createProjectCollabState,
  emptyArchivedPlanningList,
  EMPTY_REQUIREMENT_PLACEMENTS,
  type IterationDraft,
  type IterationViewState,
  type PlanningLifecycleSubject,
  type PlanningStageRecords,
  type PlanWindowQuery,
  type ProjectCollabState,
  type RequirementPageFilters,
  type RequirementPageSize,
} from './projectCollabState';
import * as testCases from './projectCollabTestCases';
import * as testing from './projectCollabTesting';
import * as testDefects from './projectCollabTestDefects';
import * as workOrder from './projectCollabWorkOrder';

import { clearPendingJoinCode } from '../composables/projectJoinLinkInbox';
import { projectCollabApi } from '../sdk/projectCollab';

/**
 * 项目组协作的渲染层单点状态。
 *
 * **按域分文件**（仓库 800 行上限）：状态形状在 `projectCollabState.ts`，失败文案与
 * 分页常量在 `projectCollabErrors.ts`，四个内容域各自成文件——
 * `projectCollabFeed` / `projectCollabChat` / `projectCollabBoard` / `projectCollabFiles`。
 * 本文件只留「身份 / 事件订阅 / 项目列表 / 详情 / 成员管理」这几件跨域的事，
 * 各域方法是一行转发（对外 API 与拆分前逐字一致）。
 */

/** 常量与失败文案对外仍从本模块出——拆分不改调用方的 import 路径。 */
export {
  PROJECT_CHAT_PAGE_SIZE,
  PROJECT_EVENT_COALESCE_MS,
  PROJECT_FEED_PAGE_SIZE,
  projectCollabErrorNotice,
  projectCollabErrorText,
  projectCollabInfoNotice,
  projectConnectionIndicatorLabel,
  projectConnectionLabel,
  projectOpenInvitationNotice,
} from './projectCollabErrors';
export type { ProjectCollabNotice } from './projectCollabErrors';
export type { ProjectCollabState } from './projectCollabState';
export type { AssetRecoveryOutcome } from './projectCollabAssets';
export type { TodoDeleteResult } from './projectCollabBoard';
export type { TodoDetailSnapshot, WorkOrderOutcome } from './projectCollabWorkOrder';
export type { RequirementSubmitOutcome } from './projectCollabTesting';

type ProjectDomainEventKind = Exclude<ProjectEventKind, 'connection'>;

/**
 * 失败信封 → 调用方失败结果：固定 `code` 文案（⛔ 不回显服务端文本）＋ **可选**透传
 * `serverCode`（开放邀请三枚业务码：关闭 410 / 满员 409 / 角色 400），供组件用
 * `projectOpenInvitationNotice` 就地覆盖通用文案。
 *
 * ⛔ `serverCode` 是业务码短标识符（如 `invitation_revoked`），不是邀请码明文——透传合规。
 * exactOptionalPropertyTypes 下缺席即不带该键（不显式塞 `undefined`）。
 */
function failureWithServerCode(failure: {
  readonly code: ProjectCollabErrorCode;
  readonly serverCode?: string | undefined;
}): { ok: false; message: string; serverCode?: string } {
  const message = projectCollabErrorText(failure.code);
  return failure.serverCode === undefined
    ? { ok: false, message }
    : { ok: false, message, serverCode: failure.serverCode };
}

export const useProjectCollabStore = defineStore('projectCollab', {
  state: (): ProjectCollabState => createProjectCollabState(),
  getters: {
    myRole(state): ProjectDetail['myRole'] | null {
      return state.detail?.myRole ?? null;
    },
    /** editor 及以上可写。判据走阶梯，加一档角色不用回来改这里。 */
    canWrite(): boolean {
      return projectRoleAtLeast(this.myRole, 'editor');
    },
    isOwner(): boolean {
      return this.myRole === 'owner';
    },
    /**
     * 「能不能把待办转交给别人」——manager 及以上。
     *
     * 与 `isOwner` **刻意分开**：拥有者身份和「能做这件事」是两件事，混在一起时加一档
     * 角色就得逐处重读每个 `isOwner` 判断它到底问的哪一件。服务端同判
     * （`domain.py todo_patch_decision` 的 transfer 支）。
     */
    canTransferTodo(): boolean {
      return projectRoleAtLeast(this.myRole, 'manager');
    },
    /**
     * 「能不能删需求/任务」——manager+，且项目未归档。
     *
     * 用户已拍板「只给管理者及以上删除权限」；服务端 `ensure_role_at_least(role, "manager")`
     * 同判，editor/viewer 一律 403 `forbidden`。归档项目服务端另回 `project_archived`，
     * 这里连带收起入口（不给点了必错的按钮），与 `canEditInstructions` 等写入口同款。
     *
     * ⛔ 别改回 `isOwner`：「谁能删」与「谁是拥有者」是两件事——加一档角色时字符串比较
     * 编译期一处也拦不住（与 `canTransferTodo` 同一条教训）。
     */
    canDeleteTodos(): boolean {
      return projectRoleAtLeast(this.myRole, 'manager') && !this.isArchived;
    },
    /*
     * 以下四条是**按动作命名的具名能力**，不是按角色命名（⛔ 别写 canOwnerDoX）。
     *
     * 理由有两层：
     *  ① 归属会变。「改项目指令」今天是 manager+、明天可能收回 owner——按动作命名时
     *    那是**一行**改动；按角色命名就是又一次全仓改名。
     *  ② 加角色时字符串比较**编译期一处也拦不住**（实测：加 manager 全仓只炸出一处
     *    `Record<ProjectRole, …>`）。散在各处的 `store.isOwner` 是彼此独立的地雷，
     *    收成具名能力之后，至少这一层是可枚举的。
     *
     * ⚠️ 前三条现在阈值相同（manager），**刻意不合并成一个 getter**：它们是三个独立
     * 的产品决定，合并会让「其中一条改归属」变成一次需要先拆分的重构。
     *
     * 逐条与服务端对齐（`scripts/collab-service/server/`，本轮逐条核过）：
     */
    /** 改项目指令：manager+（`project_patch_minimum_role(renaming=False)`）。
     *  ⚠️ **改项目名是 owner-only**（同一个函数 renaming=True 那一支），入口挂在
     *  下面的 `canRenameProject`；⛔ 别把改名挂在这条上，它会 403。 */
    canEditInstructions(): boolean {
      return projectRoleAtLeast(this.myRole, 'manager') && !this.isArchived;
    },
    /** 改项目名：**owner-only**（`project_patch_minimum_role(renaming=True)`）。
     *  与 `canEditInstructions` 打的是同一个 PATCH 端点，但两个字段两档——项目名是
     *  这个项目对外的身份（出现在每个人的列表与每一条通知里），产品侧只给拥有者。
     *  归档＝只读，同样收起。 */
    canRenameProject(): boolean {
      return this.isOwner && !this.isArchived;
    },
    /** 成员管理（邀请 / 移除 / 改角色）：manager+。
     *  ⚠️ 服务端另有 `ensure_role_grantable` 的**档位收窄**：只能动比自己低的档，
     *  所以管理者造不出管理者、也动不了拥有者。那一层判据在服务端，这里只管入口。 */
    canManageMembers(): boolean {
      return projectRoleAtLeast(this.myRole, 'manager') && !this.isArchived;
    },
    /** 外部数据源的增 / 改 / 删 / 触发同步：manager+（`ensure_data_source_admin`）。
     *  ⚠️ **读侧不走这道门**，成员即可看见「这条是外部同步来的」。 */
    canManageDataSources(): boolean {
      return projectRoleAtLeast(this.myRole, 'manager') && !this.isArchived;
    },
    /** 维护迭代计划（新建/改派/改字段/排期/快速添加）：**manager+**。
     *  ⚠️ 排期归管理者和拥有者（D-MODEL-01 §四）：服务端
     *  `ensure_iteration_patch_allowed` / `ensure_iteration_create_allowed` /
     *  `ensure_requirement_schedule_role` 一律 manager+，editor/viewer 403。这里只收起
     *  点了必错的入口（真正的门在服务端），归档项目连带只读。 */
    canManagePlanning(): boolean {
      return projectRoleAtLeast(this.myRole, 'manager') && !this.isArchived;
    },
    /** 转让拥有者 / 归档 / 恢复：**owner-only**，产品侧明确不给管理者。
     *  与上面三条分开的理由就在这一行：它们此前挤在同一个 `canManage` 里。 */
    canAdministerProject(): boolean {
      return this.isOwner && !this.isArchived;
    },
    /** 已归档＝只读：写入口一律收起（服务端同样拒绝，这里只是不给必错的按钮）。 */
    isArchived(state): boolean {
      return state.detail?.archivedAt != null;
    },
    /** 取某目标的迭代列表视图态（MIL-05），没有则给默认（⛔ 读不写回）。 */
    iterationViewFor(): (milestoneId: string) => IterationViewState {
      return (milestoneId: string) => planning.getIterationView(this, milestoneId);
    },
    /** 取某目标的排期草案（MIL-06），没有则给空草案（⛔ 读不写回）。 */
    iterationScheduleDraftFor(): (
      milestoneId: string,
    ) => ReturnType<typeof schedule.getIterationScheduleDraft> {
      return (milestoneId: string) => schedule.getIterationScheduleDraft(this, milestoneId);
    },
    /** 安排需求弹层里一行当前的选择（MIL-09；改过读改过的，没改过读现状）。 */
    requirementScheduleSelectionFor(): (
      item: Parameters<typeof requirementSchedule.requirementScheduleSelection>[1],
    ) => string {
      return (item) => requirementSchedule.requirementScheduleSelection(this, item);
    },
    /** 取某对象的阶段记录（MIL-07），没有则给空态（⛔ 读不写回）。 */
    planningStageRecordsFor(): (subject: PlanningLifecycleSubject) => PlanningStageRecords {
      return (subject: PlanningLifecycleSubject) =>
        lifecycle.getPlanningStageRecords(this, subject);
    },
    /** 里程碑弹层：负责人没改却已离开项目时的非阻塞提示（MIL-10，ADR-0040），否则 null。 */
    milestoneFormOwnerHint(): string | null {
      return planningForms.milestoneFormOwnerHint(this);
    },
    /** 迭代计划弹层：同上一条。 */
    iterationFormOwnerHint(): string | null {
      return planningForms.iterationFormOwnerHint(this);
    },
    /**
     * 按 id 索引当前有效数据。`canEditTodo` 要沿父链找
     * 所属需求，逐行渲染时每格都调它——不缓存就是每格一次整表扫描。
     */
    todosById(state): ReadonlyMap<string, Todo> {
      if (!state.requirementPageActive) {
        return new Map(
          state.todos
            .filter(
              (todo) => todo.projectId === undefined || todo.projectId === state.activeProjectId,
            )
            .map((todo) => [todo.id, todo]),
        );
      }
      const indexed = new Map<string, Todo>();
      if (!state.activeProjectId || !state.requirementQueryRevision || state.requirementPageError)
        return indexed;
      const pending = [...state.requirementItems];
      const visited = new Set<string>();
      while (pending.length > 0) {
        const todo = pending.shift()!;
        if (todo.projectId !== state.activeProjectId) continue;
        const prior = indexed.get(todo.id);
        if (!prior || todo.version > prior.version) indexed.set(todo.id, todo);
        if (visited.has(todo.id)) continue;
        visited.add(todo.id);
        pending.push(
          ...(state.requirementSubtrees[todo.id] ?? []).filter(
            (child) => child.parentId === todo.id,
          ),
        );
      }
      return indexed;
    },
  },
  actions: {
    /**
     * 能力水合（幂等）。桥缺失 / 调用失败一律按未启用处理（fail-safe：宁可无入口，
     * 不给出一个点了必错的入口）；启用时顺带布防事件订阅。
     */
    async hydrateAvailability(): Promise<boolean> {
      if (this.availability !== null) {
        if (this.availability) this.initializeEvents();
        return this.availability;
      }
      const epoch = this.accountEpoch;
      let enabled = false;
      let mySubject: string | null = null;
      try {
        const result = await projectCollabApi.availability();
        enabled = result.enabled;
        mySubject = result.mySubject;
      } catch {
        enabled = false;
      }
      // 换号已发生：`mySubject` 是**账号绑定**的，陈旧值会让 isSelf() 认错人，一律不写回；
      // `enabled` 是部署级静态事实（构建常量 + 企业配置），与账号无关，据实回传给调用方。
      if (epoch !== this.accountEpoch) return enabled;
      // 并发水合取的是同一静态事实，后到者覆写同值，无需互斥。
      this.availability = enabled;
      this.mySubject = mySubject;
      if (enabled) this.initializeEvents();
      return enabled;
    },
    /** 「本人」判据：mySubject 缺席（null）时恒 false ⇒ 本人类按钮收起。 */
    isSelf(subject: string | null): boolean {
      return subject !== null && this.mySubject !== null && subject === this.mySubject;
    },
    /**
     * 「这张待办卡我能不能编辑」（G-11）。判据本体在 `projectCollabBoard.canEditTodo`，
     * 与服务端 `todo_patch_decision` 同口径；这里只把当前角色与身份喂给它。
     */
    canEditTodo(todo: board.TodoEditGateFields): boolean {
      return board.canEditTodo(todo, {
        canWrite: this.canWrite,
        canTransfer: this.canTransferTodo,
        mySubject: this.mySubject,
        requirementAssigneeSubject: board.nearestRequirementAssignee(todo, this.todosById),
      });
    },
    /**
     * 订阅 `project:event`（幂等布防）。连接状态帧就地更新在线状态；
     * 域事件帧按 `kind:projectId` 合帧后**走请求通道重取权威数据**——
     * 事件 payload 不透明，这里从不解析它（⛔ 不轮询、⛔ 不乐观写）。
     */
    initializeEvents(): void {
      if (this.eventsListening) return;
      this.eventsListening = true;
      const pending = new Map<string, ReturnType<typeof setTimeout>>();
      const unsubscribe = projectCollabApi.onEvent((event: ProjectEvent) => {
        if (event.kind === 'connection') {
          this.connection = event.payload.state;
          return;
        }
        const key = `${event.kind}:${event.projectId}`;
        if (pending.has(key)) return; // 窗口内同键只留一枚，先到定窗
        pending.set(
          key,
          setTimeout(() => {
            pending.delete(key);
            void this.refetchForEvent(event.kind, event.projectId);
          }, PROJECT_EVENT_COALESCE_MS),
        );
      });
      // 退订只挡住新帧；**已排期的合帧定时器还会烧**，会在换号后拿新令牌重取旧账号
      // 的项目——所以拆除必须两件事一起做。
      this.eventTeardown = (): void => {
        unsubscribe();
        for (const timer of pending.values()) clearTimeout(timer);
        pending.clear();
      };
    },
    /**
     * 账号切换（登入/登出/换号）作废：本 store 的每一项都是**账号绑定**的，
     * 换号后一格都不许留（ADR-0008 账号隔离；主进程侧已按 `authEpoch` 重建同步服务，
     * 渲染层这一半此前是缺的）。
     *
     * 三件事缺一不可：
     *  1. 拆事件订阅并撤销在途合帧定时器——否则旧订阅的定时器会在换号后重取；
     *  2. 推进 `accountEpoch` 与 `projectEpoch`——作废两类在途请求的迟到结果，
     *     不然旧账号的列表/详情会覆写回已清空的状态；
     *  3. `availability` 归 null——它是「本次运行内不再水合」的缓存标记，
     *     不清它就永远拿不到新账号的 `mySubject`，「本人」判据会认错人。
     * 事件订阅由下一次 `hydrateAvailability()` 重新布防。
     */
    resetForAccountChange(): void {
      this.eventTeardown?.();
      this.eventTeardown = null;
      this.eventsListening = false;
      // 上一个账号未消费的加入深链暂存码不得跨账号残留（明文纪律 + 冒名兑换面）。
      clearPendingJoinCode();
      this.accountEpoch += 1;
      this.projectEpoch += 1;

      this.availability = null;
      this.connection = null;
      this.mySubject = null;

      this.projects = [];
      this.projectsLoading = false;
      this.projectsError = null;
      this.includeArchivedProjects = false;

      this.activeProjectId = null;
      this.clearProjectScopedState();
      this.detailLoading = false;
      this.feedLoading = false;
      this.chatLoading = false;
      this.todosLoading = false;
      this.draftsLoading = false;
      this.openInvitationsLoading = false;
      this.filesLoading = false;
      this.fileActionBusy = false;
      this.assetsLoading = false;
      this.assetTrashLoading = false;
      this.assetVersionChainLoading = false;
    },
    /** 事件落地：列表投影总要刷（未读数/最近活动）；当前项目再按域重取。 */
    async refetchForEvent(kind: ProjectDomainEventKind, projectId: string): Promise<void> {
      void this.loadProjects();
      if (projectId !== this.activeProjectId) return;
      switch (kind) {
        case 'feed.created':
        case 'feed.commented':
          await this.loadFeed(projectId);
          return;
        case 'chat.message':
        case 'chat.revoked':
          await this.refreshChatWindow(projectId);
          return;
        case 'testing.changed':
          await Promise.all([
            this.projectTestRounds
              ? testing.loadProjectTestRounds(this, projectId)
              : Promise.resolve(),
            ...Object.keys(this.testRoundActions).map((id) =>
              testing.loadTestRoundActions(this, projectId, id),
            ),
            ...Object.keys(this.testExecutions).map((id) =>
              testCases.loadTestExecutions(this, projectId, id),
            ),
            ...Object.keys(this.testDefects).map((id) =>
              testDefects.loadTestDefects(this, projectId, id),
            ),
            ...Object.keys(this.testDefectDetails).map((id) =>
              testDefects.loadTestDefectDetail(this, projectId, id),
            ),
            ...Object.keys(this.requirementRounds).map((id) =>
              testing.loadRequirementRounds(this, projectId, id),
            ),
            testCases.reloadTestRound(this),
          ]);
          return;
        case 'todo.changed':
          // 游标全量与日历 / 时间轴当前那一段（CORE-08）一起重取（同在 loadTodos 里）：两份都以服务端为准。
          await this.loadTodos(projectId);
          // 清单重取完再发信号：详情据此重取完成标准时，读到的已是新清单里的计数（UX-02）。
          // 重取期间换了项目就不发——那条事件已不属于屏上的项目。
          if (projectId !== this.activeProjectId) return;
          this.todoChangedRevision += 1;
          // 整需求提测（TST-02）：取过轮次、而清单里版本变了的需求重取轮次（⛔ 不读负载里的 reason）。
          await testing.refreshRequirementRoundsForTodoChange(this, projectId);
          return;
        // 定向事件：只有这批草案的两个可见者收得到，收到即把「有几条待审」刷新，
        // 需求行上的徽标随之出现。⛔ 不在这里读事件负载里的条数——负载是不透明
        // 透传，权威条数只认列表端点回的那一份。
        case 'todo.draft':
          await this.loadDraftBatches(projectId);
          return;
        // 文件与资产版本两套模型各刷各的（ADR-0037 决策 8）；资产那一侧只刷已取过的目录 /
        // 回收站 / 打开中的版本链。⛔ 同样不读负载（历史版本恢复发的就是这一条）。
        case 'file.changed':
          await Promise.all([
            this.loadFiles(projectId),
            assetVersions.refetchAssetsForFileChange(this, projectId),
          ]);
          return;
        case 'member.changed':
        case 'project.changed':
          await this.loadDetail(projectId);
          return;
        // 规划域（MIL-07）：⛔ 负载一个字段都不读（里面也没有说明 / 证据 / 原因）——按 state 里
        // 已持有的 id 走 REST 重取目标列表、展开目标的迭代与打开着的阶段记录。
        case 'milestone.updated':
        case 'iteration.updated':
          await Promise.all([
            lifecycle.refreshPlanningForEvent(this, projectId),
            this.refreshRequirementIterationProjection(projectId, this.projectEpoch),
          ]);
          return;
        // MIL-09：排期变动（关联 / 改排 / 移出，含整批安排）。⛔ 负载一个字段都不读——目标列表、展开目标
        // 的迭代走同一处重取，另补未排计数、开着的安排需求候选与需求编辑器已查过的「迭代信息」。
        case 'iteration.requirements_changed':
          await Promise.all([
            lifecycle.refreshPlanningForEvent(this, projectId),
            requirementSchedule.refreshRequirementScheduleForEvent(this, projectId),
            this.refreshRequirementIterationProjection(projectId, this.projectEpoch),
          ]);
          return;
      }
    },

    async loadProjects(): Promise<void> {
      if (this.projectsLoading) return;
      // 列表按**账号**纪元守，不按项目纪元——切项目不该取消一次列表刷新。
      const epoch = this.accountEpoch;
      this.projectsLoading = true;
      try {
        const result = await projectCollabApi.list({
          includeArchived: this.includeArchivedProjects,
        });
        if (epoch !== this.accountEpoch) return;
        if (!result.ok) {
          this.projectsError = projectCollabErrorNotice(result.code);
          return;
        }
        this.projects = result.projects;
        this.projectsError = null;
      } catch {
        if (epoch === this.accountEpoch) this.projectsError = projectCollabErrorNotice('transient');
      } finally {
        if (epoch === this.accountEpoch) this.projectsLoading = false;
      }
    },
    /**
     * 建组（创建者即 owner）。`instructionsText` 是可选的项目说明。
     *
     * ⚠️ **说明走两步**：`project:create` 协议只收 `name`（strictObject），项目说明由
     * 独立的 `project:update`（owner）落库。故建成后若填了说明，再补一发 update。
     * 说明保存失败**不回滚**：项目确已建成（回落到「未填说明」不谎报失败），用户可在
     * 项目详情里补——比让整次创建报错、留下一个看不见的孤儿项目要诚实。
     */
    async createProject(
      name: string,
      instructionsText = '',
    ): Promise<{ ok: true; project: ProjectDetail } | { ok: false; message: string }> {
      try {
        const result = await projectCollabApi.create({ name });
        if (!result.ok) return { ok: false, message: projectCollabErrorText(result.code) };
        let project = result.project;
        const trimmed = instructionsText.trim();
        if (trimmed.length > 0) {
          const updated = await projectCollabApi.update({
            projectId: project.id,
            instructionsText: trimmed,
          });
          if (updated.ok) project = updated.project;
        }
        await this.loadProjects();
        return { ok: true, project };
      } catch {
        return { ok: false, message: projectCollabErrorText('transient') };
      }
    },
    async redeemInvitation(
      code: string,
    ): Promise<
      { ok: true; projectId: string } | { ok: false; message: string; serverCode?: string }
    > {
      try {
        const result = await projectCollabApi.redeemInvitation({ code });
        // 失败信封的可选 `serverCode`（开放邀请三码：关闭 410 / 满员 409 / 角色 400）原样带回，
        // 调用方用 `projectOpenInvitationNotice` 就地覆盖通用文案；缺席即回落通用 code 文案。
        // ⛔ 这是业务码短标识符（如 `invitation_revoked`），不是邀请码明文——不进 state。
        if (!result.ok) return failureWithServerCode(result);
        await this.loadProjects();
        return { ok: true, projectId: result.projectId };
      } catch {
        return { ok: false, message: projectCollabErrorText('transient') };
      }
    },
    /**
     * 签发邀请。`options.kind === 'open'` 时带上有效期与可选人数上限；`single`（缺省）
     * ⛔ **不传** `ttlHours` / `maxUses`（服务端对一次性码携带这两项一律 422）。
     *
     * 结果**原样回给调用方**一次性展示（code / link 用的 code / kind / maxUses / 到期）——
     * ⛔ code 不落任何 store 状态、不进日志、不进埋点（明文只在这一趟里活着）。
     */
    async createInvitation(
      projectId: string,
      role: ProjectInvitationRole,
      options?: {
        kind?: ProjectInvitationKind;
        ttlHours?: ProjectOpenInvitationTtlHours;
        maxUses?: number;
      },
    ): Promise<
      | {
          ok: true;
          code: string;
          expiresAt: string;
          invitationId: string;
          kind: ProjectInvitationKind;
          maxUses: number | null;
        }
      | { ok: false; message: string; serverCode?: string }
    > {
      try {
        const request =
          options?.kind === 'open'
            ? {
                projectId,
                role,
                kind: 'open' as const,
                ttlHours: options.ttlHours,
                // 留空＝不限：不带该字段（照服务端「缺省不限」语义）。
                ...(options.maxUses !== undefined ? { maxUses: options.maxUses } : {}),
              }
            : { projectId, role };
        const result = await projectCollabApi.invite(request);
        // open + role≠editor 时服务端回 400 `open_invitation_role_not_allowed`——serverCode 带回。
        if (!result.ok) return failureWithServerCode(result);
        return {
          ok: true,
          code: result.code,
          expiresAt: result.expiresAt,
          invitationId: result.invitationId,
          kind: result.kind,
          maxUses: result.maxUses,
        };
      } catch {
        return { ok: false, message: projectCollabErrorText('transient') };
      }
    },
    /**
     * 拉取本项目进行中的开放邀请（manager+）。按 `projectEpoch` + 请求序号双守
     * （照 `loadDraftBatches`）：切项目作废迟到结果，并发重取只让最后一发落地。
     * ⛔ 列表投影不含 code——store 里也不会出现明文。
     */
    async loadOpenInvitations(projectId: string): Promise<void> {
      const epoch = this.projectEpoch;
      const requestId = (this.openInvitationsRequestId += 1);
      this.openInvitationsLoading = true;
      try {
        const result = await projectCollabApi.listOpenInvitations({ projectId });
        if (epoch !== this.projectEpoch || requestId !== this.openInvitationsRequestId) return;
        if (!result.ok) {
          this.openInvitationsError = projectCollabErrorNotice(result.code);
          return;
        }
        this.openInvitations = result.invitations;
        this.openInvitationsError = null;
      } catch {
        if (epoch === this.projectEpoch && requestId === this.openInvitationsRequestId) {
          this.openInvitationsError = projectCollabErrorNotice('transient');
        }
      } finally {
        if (epoch === this.projectEpoch && requestId === this.openInvitationsRequestId) {
          this.openInvitationsLoading = false;
        }
      }
    },
    /**
     * 提前关闭一条开放邀请（manager+，同项目；服务端幂等）。成功后**重取列表**，
     * 让刚关掉的那条从「进行中」里消失（关闭只影响其后的兑换，已入组成员不受影响）。
     */
    async revokeInvitation(
      invitationId: string,
    ): Promise<{ ok: true } | { ok: false; message: string; serverCode?: string }> {
      try {
        const result = await projectCollabApi.revokeInvitation({ invitationId });
        if (!result.ok) return failureWithServerCode(result);
        await this.loadOpenInvitations(result.projectId);
        return { ok: true };
      } catch {
        return { ok: false, message: projectCollabErrorText('transient') };
      }
    },

    /**
     * 项目内各域的清空（详情/动态/讨论/看板/资产 + 操作回执）。
     * 换项目与换账号共用同一处，避免以后加字段时只补了一边。
     * ⛔ 不含 loading 标记：换项目时它们由 epoch 守的 finally 自行收口。
     */
    clearProjectScopedState(): void {
      this.detail = null;
      this.detailError = null;
      this.feedEntries = [];
      this.feedError = null;
      this.feedHasMore = false;
      this.chatMessages = [];
      this.chatError = null;
      this.chatHasMore = false;
      this.chatUnreadFromSeq = null;
      this.todos = [];
      this.todosError = null;
      requirementPage.clearRequirementPages(this);
      // 整需求提测（TST-02）：各需求的轮次都属上一个项目 ⇒ 一格不留（在途请求靠 projectEpoch 作废）。
      this.requirementRounds = {};
      this.projectTestRounds = null;
      this.testRoundActions = {};
      this.testExecutions = {};
      this.testDefects = {};
      this.testDefectDetails = {};
      // 测试轮次的用例（TST-04）：正在看的轮次、用例缓存与各轮条数同样属上一个项目。
      this.testRoundView = null;
      this.roundTestCases = {};
      this.requirementCaseCounts = {};
      this.draftBatches = [];
      this.draftsError = null;
      this.openInvitations = [];
      this.openInvitationsError = null;
      this.files = [];
      this.filesError = null;
      if (this.fileUploadOperationId)
        void projectCollabApi.fileUploadCancel(this.fileUploadOperationId);
      this.fileUpload = null;
      this.fileUploadOperationId = null;
      this.fileActionBusy = false;
      // 资产版本（RPT-08）：目录、回收站、打开中的版本链都属上一个项目 ⇒ 一格不留。
      // 在途请求靠 projectEpoch 作废；loading 由 epoch 守的 finally 自行收口（与其余各域同）。
      this.assets = [];
      this.assetsLoaded = false;
      this.assetsError = null;
      this.assetTrash = [];
      this.assetTrashLoaded = false;
      this.assetTrashError = null;
      this.assetVersionTarget = null;
      this.assetVersionChain = null;
      this.assetVersionChainError = null;
      this.actionNotice = null;
      // 项目约定与草稿都是**项目绑定**的：换项目一格不留（上一个项目的规则/草稿不属这一个）。
      this.conventions = null;
      this.agreementDraft = { instructions: null, aiRules: null };
      // 里程碑总览（MIL-04）：换项目一格不留——展开态、页码、各目标缓存的迭代都属上一个
      // 项目。⛔ 唯独这里清 `expandedMilestoneId`；刷新/翻页都不清它（判据「保持状态」）。
      // loading/requestId 由 epoch 守的 finally 自行收口，照 requirementPage 惯例不在此重置。
      this.milestones = [];
      this.milestonesTotal = 0;
      this.milestonesPage = 1;
      this.milestonesLoaded = false;
      this.milestonesError = null;
      this.expandedMilestoneId = null;
      this.milestoneIterations = {};
      this.milestoneIterationsLoading = {};
      this.milestoneIterationsError = {};
      this.milestoneIterationsRequestIds = {};
      // MIL-05：迭代列表视图态（筛选/排序/草稿）按 milestoneId 各存一份，整表属上一个项目
      // ⇒ 换项目一格不留（判据「切目标不串数据」的项目级边界）。
      this.iterationViews = {};
      this.iterationActionNotice = null;
      // MIL-06：排期草案 / 回执 / 在途 / 幂等键同样属上一个项目（换号经 resetForAccountChange
      // 也走到这里）⇒ 一格不留（判据「切项目 / 换号清空」）。
      this.iterationScheduleDrafts = {};
      this.iterationScheduleNotices = {};
      this.iterationScheduleSaving = {};
      this.iterationScheduleRequests = {};
      // MIL-07：生命周期草稿（用户亲笔正文）/ 详情 / 阶段记录都属上一个项目 ⇒ 一格不留。
      // ⚠️ `planningLifecycleSubmitting` 例外地在这里复位：提交的 finally 按 epoch 守，换项目后
      //    不会再回来收口它，不复位就会把新项目的弹层永远锁在「提交中」。
      this.planningLifecycleDraft = null;
      this.planningLifecycleSubmitting = false;
      this.planningLifecycleNotice = null;
      this.planningDetail = null;
      this.planningStageRecords = {};
      // MIL-09：写入口弹层（用户亲笔草稿）、候选、计数、已归档列表与「迭代信息」缓存都属上一个项目。
      this.milestoneForm = null;
      this.iterationForm = null;
      this.requirementScheduleDialog = null;
      this.requirementPlacements = EMPTY_REQUIREMENT_PLACEMENTS;
      this.unscheduledRequirementTotal = null;
      this.archivedMilestones = emptyArchivedPlanningList();
      this.archivedIterations = {};
      this.requirementPlacementLookups = {};
      this.planningPageNotice = null;
      // CORE-08：日历 / 时间轴那一段的结果与业务目标列表的时间段都属上一个项目 ⇒ 一格不留。
      // loading / requestId 照惯例由 epoch 守的 finally 收口。
      this.planWindowQuery = null;
      this.planWindowItems = [];
      this.planWindowError = null;
      this.planWindowTruncated = false;
      this.milestonesPlanWindow = null;
    },
    /** 打开一个项目：清空各域、推进 epoch、加载详情。视图按页签再取各域。 */
    async openProject(projectId: string): Promise<void> {
      if (this.activeProjectId !== projectId) {
        this.activeProjectId = projectId;
        this.projectEpoch += 1;
        this.clearProjectScopedState();
      }
      await this.loadDetail(projectId);
    },
    closeProject(): void {
      this.activeProjectId = null;
      this.projectEpoch += 1;
      this.clearProjectScopedState();
    },
    async loadDetail(projectId: string): Promise<void> {
      const epoch = this.projectEpoch;
      this.detailLoading = true;
      try {
        const result = await projectCollabApi.detail({ projectId });
        if (epoch !== this.projectEpoch) return;
        if (!result.ok) {
          this.detailError = projectCollabErrorNotice(result.code);
          return;
        }
        this.detail = result.project;
        this.detailError = null;
      } catch {
        if (epoch === this.projectEpoch) this.detailError = projectCollabErrorNotice('transient');
      } finally {
        if (epoch === this.projectEpoch) this.detailLoading = false;
      }
    },
    /** 项目说明保存（owner）。成功即以服务端回传详情为准。 */
    async saveInstructions(projectId: string, instructionsText: string): Promise<boolean> {
      const epoch = this.projectEpoch;
      try {
        const result = await projectCollabApi.update({ projectId, instructionsText });
        if (epoch !== this.projectEpoch) return false;
        if (!result.ok) {
          this.actionNotice = projectCollabErrorNotice(result.code);
          return false;
        }
        this.detail = result.project;
        // 没踢球：文本框里就是刚存下的那份，回执只是确认一声 ⇒ toast。
        pushProjectCollabReceipt('项目指令已保存。');
        return true;
      } catch {
        if (epoch === this.projectEpoch) this.actionNotice = projectCollabErrorNotice('transient');
        return false;
      }
    },
    /**
     * 项目改名（**owner-only**，入口收窄在 `canRenameProject`；服务端按令牌强判 403）。
     * 与 `saveInstructions` 同一个 IPC（`project:update`），只带 `name` 一个字段——
     * ⛔ 不与说明合成一发，两字段档位不同，合发会按更高档要。
     * 成功即以服务端回传的权威详情为准；项目名也是列表卡片的标题，列表投影跟着刷。
     */
    async renameProject(projectId: string, name: string): Promise<boolean> {
      const epoch = this.projectEpoch;
      try {
        const result = await projectCollabApi.update({ projectId, name });
        if (epoch !== this.projectEpoch) return false;
        if (!result.ok) {
          this.actionNotice = projectCollabErrorNotice(result.code);
          return false;
        }
        this.detail = result.project;
        // 没踢球：标题当场就换了，回执只是确认一声 ⇒ toast。
        pushProjectCollabReceipt('项目已重命名。');
        void this.loadProjects();
        return true;
      } catch {
        if (epoch === this.projectEpoch) this.actionNotice = projectCollabErrorNotice('transient');
        return false;
      }
    },

    /* ----------------------- 项目约定 · AI 录入规则（CTX-01） ----------------------- */

    /**
     * 全屏编辑器的草稿写入（每次输入调一次）。⛔ 不清空、不发请求——纯本地暂存，
     * 让取消/关闭/换页签后再打开时还在（「保留草稿」）。空串是合法草稿（清空规则）。
     */
    setAgreementDraft(field: 'instructions' | 'aiRules', value: string): void {
      this.agreementDraft = { ...this.agreementDraft, [field]: value };
    },
    /** 保存成功后清掉对应字段的草稿（下次打开从服务端最新值起笔）。 */
    clearAgreementDraft(field: 'instructions' | 'aiRules'): void {
      this.agreementDraft = { ...this.agreementDraft, [field]: null };
    },

    /** 读取项目约定（AI 录入规则）；失败即静默留 null（右栏出诚实空态，不报错）。 */
    async loadConventions(projectId: string): Promise<void> {
      const epoch = this.projectEpoch;
      try {
        const result = await projectCollabApi.readConventions({ projectId });
        if (epoch !== this.projectEpoch) return;
        if (result.ok) this.conventions = result.conventions;
      } catch {
        // fail-safe：读不到规则不阻断右栏其余内容（与详情/各域取数各自独立）。
      }
    },

    /**
     * 发布新一版 AI 录入规则（manager+）。**独立于改说明的一条保存路径**——只打
     * `updateConventions`（conventions 端点），⛔ 不碰 `project:update`。
     *
     * 成功：只替换 `this.conventions`（版本 +1）并清掉规则草稿——⛔ 不动 `detail` /
     * `todos` / `feedEntries` 等任何历史域（acceptance「发布规则不改历史记录」）。
     * 失败（含 409 冲突）：落 `actionNotice`、返回 false，**不清草稿**——编辑器据此
     * 保留用户长文并提示（「409 不吞长文」）。409 时另把 conventions 补拉到最新（拿到
     * 新版本号供重试），但**不覆写草稿**。
     */
    async publishAiRules(
      projectId: string,
      aiEntryRules: string,
      expectedVersion: number,
    ): Promise<boolean> {
      const epoch = this.projectEpoch;
      try {
        const result = await projectCollabApi.updateConventions({
          projectId,
          aiEntryRules,
          expectedVersion,
        });
        if (epoch !== this.projectEpoch) return false;
        if (!result.ok) {
          this.actionNotice = projectCollabErrorNotice(result.code);
          // 冲突时补拉最新版本（供下次发布带上正确 expectedVersion）；草稿另存，不受影响。
          if (result.code === 'conflict') void this.loadConventions(projectId);
          return false;
        }
        this.conventions = result.conventions;
        this.clearAgreementDraft('aiRules');
        pushProjectCollabReceipt('AI 录入规则已发布，历史记录未改变。');
        return true;
      } catch {
        if (epoch === this.projectEpoch) this.actionNotice = projectCollabErrorNotice('transient');
        return false;
      }
    },

    /* --------------------------- 成员管理（owner） --------------------------- */
    /*
     * 四个动作同形：调 IPC → 成功即以**服务端回传的权威详情**为准就地替换（绝不
     * 本地推算名册），失败落固定文案回执。返回布尔给调用方决定关不关确认框。
     * 权限不在这里判——渲染层按 `isOwner` 收窄入口只是不给点了必错的按钮。
     */

    /**
     * 成员管理四条的共用外壳：纪元守 + 详情替换 + 回执文案。
     *
     * 四条成功回执都是纯报告（名册/归档态当场就变了，右栏看得见），没有把球踢回给
     * 用户 ⇒ 走 toast。失败仍落常驻条：那上面有参考编号，要抄。
     */
    async runMemberAdmin(
      action: () => Promise<
        { ok: true; project: ProjectDetail } | { ok: false; code: ProjectCollabErrorCode }
      >,
      successNotice: string,
    ): Promise<boolean> {
      const epoch = this.projectEpoch;
      try {
        const result = await action();
        if (epoch !== this.projectEpoch) return false;
        if (!result.ok) {
          this.actionNotice = projectCollabErrorNotice(result.code);
          return false;
        }
        this.detail = result.project;
        pushProjectCollabReceipt(successNotice);
        // 名册/归档态变了，列表投影（成员数、是否还在列表里）也跟着刷。
        void this.loadProjects();
        return true;
      } catch {
        if (epoch === this.projectEpoch) this.actionNotice = projectCollabErrorNotice('transient');
        return false;
      }
    },
    async updateMemberRole(
      projectId: string,
      subject: string,
      role: ProjectAssignableRole,
    ): Promise<boolean> {
      return this.runMemberAdmin(
        () => projectCollabApi.memberUpdate({ projectId, subject, role }),
        '成员角色已更新。',
      );
    },
    /**
     * 移除成员：只撤访问权。**该成员已产生的内容全部保留**，其名下未完成待办也
     * 不自动转移（卡片上仍是原处理人）——这是服务端定义的连带语义，文案照实说。
     */
    async removeMember(projectId: string, subject: string): Promise<boolean> {
      return this.runMemberAdmin(
        () => projectCollabApi.memberRemove({ projectId, subject }),
        '成员已移出项目；其留下的内容与名下待办仍保留。',
      );
    },
    /** 转让拥有者：成功后本账号在该项目降为「成员」，管理入口随详情刷新自然收起。 */
    async transferOwnership(projectId: string, subject: string): Promise<boolean> {
      return this.runMemberAdmin(
        () => projectCollabApi.transferOwnership({ projectId, subject }),
        '项目拥有者已转让。',
      );
    },
    async setProjectArchived(projectId: string, archived: boolean): Promise<boolean> {
      return this.runMemberAdmin(
        () => projectCollabApi.setArchived({ projectId, archived }),
        archived ? '项目已归档，当前为只读。' : '项目已恢复，可以继续编辑。',
      );
    },
    /** 列表是否带上归档项目；切换即重取（否则开关拨了看不到变化）。 */
    async setIncludeArchivedProjects(include: boolean): Promise<void> {
      if (this.includeArchivedProjects === include) return;
      this.includeArchivedProjects = include;
      await this.loadProjects();
    },

    /* ------------------------- 域动作转发（实现见域文件） ------------------------- */

    async loadFeed(projectId: string): Promise<void> {
      return feed.loadFeed(this, projectId);
    },
    async loadOlderFeed(projectId: string): Promise<void> {
      return feed.loadOlderFeed(this, projectId);
    },
    async postFeed(
      projectId: string,
      bodyMd: string,
      refs: readonly string[] = [],
    ): Promise<boolean> {
      return feed.postFeed(this, projectId, bodyMd, refs);
    },
    async postComment(
      entryId: string,
      bodyMd: string,
      refs: readonly string[] = [],
    ): Promise<boolean> {
      return feed.postComment(this, entryId, bodyMd, refs);
    },

    async loadChatLatest(projectId: string): Promise<void> {
      return chat.loadChatLatest(this, projectId);
    },
    async loadOlderChat(projectId: string): Promise<void> {
      return chat.loadOlderChat(this, projectId);
    },
    async refreshChatWindow(projectId: string): Promise<void> {
      return chat.refreshChatWindow(this, projectId);
    },
    async sendChat(
      projectId: string,
      bodyMd: string,
      refs: readonly string[] = [],
      clientMessageId?: string,
    ): Promise<boolean> {
      return chat.sendChat(this, projectId, bodyMd, refs, clientMessageId);
    },
    async revokeChat(messageId: string): Promise<boolean> {
      return chat.revokeChat(this, messageId);
    },
    async markChatRead(projectId: string): Promise<void> {
      return chat.markChatRead(this, projectId);
    },

    /**
     * 清单全量重取。日历 / 时间轴当前那一段（CORE-08）在同一次里按服务端重取：凡是清单被重取的地方
     * （事件、断线补拉、审阅确认、表格重试……）两份一起跟上，⛔ 不各刷各的；没有视图持有时间段时后者什么都不做。
     */
    async loadTodos(projectId: string): Promise<void> {
      await Promise.all([
        this.requirementPageActive
          ? requirementPage.refreshRequirementPage(this, projectId)
          : board.loadTodos(this, projectId),
        planWindow.reloadPlanWindow(this, projectId),
      ]);
    },
    /* -- 需求页码查询（CORE-07）：服务端分页/过滤/按需子树，与 loadTodos 并存 -- */
    releaseRequirementPage(): void {
      requirementPage.clearRequirementPages(this);
    },
    async loadRequirementPage(projectId: string): Promise<void> {
      return requirementPage.loadRequirementPage(this, projectId);
    },
    async setRequirementPageFilters(
      projectId: string,
      filters: RequirementPageFilters,
    ): Promise<void> {
      return requirementPage.setRequirementPageFilters(this, projectId, filters);
    },
    async setRequirementPageSize(projectId: string, pageSize: RequirementPageSize): Promise<void> {
      return requirementPage.setRequirementPageSize(this, projectId, pageSize);
    },
    async goToRequirementPage(projectId: string, page: number): Promise<void> {
      return requirementPage.goToRequirementPage(this, projectId, page);
    },
    async reloadRequirementPageAfterDelete(projectId: string): Promise<void> {
      return requirementPage.reloadRequirementPageAfterDelete(this, projectId);
    },
    async loadRequirementSubtree(projectId: string, requirementId: string): Promise<void> {
      return requirementPage.loadRequirementSubtree(this, projectId, requirementId);
    },
    async loadMoreRequirementSubtree(projectId: string, requirementId: string): Promise<void> {
      return requirementPage.loadMoreRequirementSubtree(this, projectId, requirementId);
    },
    /* -- 按计划时间段读取（CORE-08，ADR-0042）：日历 / 时间轴当前可见那一段逐页取全 -- */
    async loadPlanWindow(projectId: string, query: PlanWindowQuery): Promise<void> {
      return planWindow.loadPlanWindow(this, projectId, query);
    },
    async reloadPlanWindow(projectId: string): Promise<void> {
      return planWindow.reloadPlanWindow(this, projectId);
    },
    /** 日历 / 时间轴离屏时交还这一段（之后的事件与清单重取不再为它发请求）。 */
    releasePlanWindow(): void {
      planWindow.releasePlanWindow(this);
    },

    /* -- 里程碑（业务目标）总览（MIL-04）：分页列表 + 展开取多轮迭代 -- */
    async loadMilestones(projectId: string): Promise<void> {
      return planning.loadMilestones(this, projectId);
    },
    async goToMilestonePage(projectId: string, page: number): Promise<void> {
      return planning.goToMilestonePage(this, projectId, page);
    },
    /** 业务目标列表按计划时间段读（CORE-08）；null ＝ 不按时间段。回到第 1 页重取。 */
    async setMilestonesPlanWindow(
      projectId: string,
      window: ProjectPlanWindow | null,
    ): Promise<void> {
      return planning.setMilestonesPlanWindow(this, projectId, window);
    },
    async toggleMilestone(projectId: string, milestoneId: string): Promise<void> {
      return planning.toggleMilestone(this, projectId, milestoneId);
    },
    async loadMilestoneIterations(projectId: string, milestoneId: string): Promise<void> {
      return planning.loadMilestoneIterations(this, projectId, milestoneId);
    },
    /* MIL-05：迭代列表视图态 + 行内编辑 + 快速添加（薄转发到 projectCollabPlanning）。 */
    setIterationView(milestoneId: string, patch: Partial<IterationViewState>): void {
      planning.setIterationView(this, milestoneId, patch);
    },
    toggleIterationSort(milestoneId: string, field: IterationViewState['sort']): void {
      planning.toggleIterationSort(this, milestoneId, field);
    },
    setIterationQuickDraft(milestoneId: string, patch: Partial<IterationDraft>): void {
      planning.setIterationQuickDraft(this, milestoneId, patch);
    },
    setIterationQuickAddOpen(milestoneId: string, open: boolean): void {
      planning.setIterationQuickAddOpen(this, milestoneId, open);
    },
    async saveIterationField(
      request: Parameters<typeof planning.saveIterationField>[1],
    ): Promise<'ok' | 'conflict' | 'error'> {
      const epoch = this.projectEpoch;
      const outcome = await planning.saveIterationField(this, request);
      if (outcome === 'ok')
        await this.refreshRequirementIterationProjection(request.projectId, epoch);
      return outcome;
    },
    async saveQuickIteration(
      request: Parameters<typeof planning.saveQuickIteration>[1],
    ): Promise<'ok' | 'conflict' | 'error'> {
      return planning.saveQuickIteration(this, request);
    },
    /* MIL-06：视图偏好 + 排期草案（薄转发到 projectCollabSchedule；排期权限由这里注入）。 */
    hydrateIterationPlanView(projectId: string, milestoneId: string): void {
      schedule.hydrateIterationPlanView(this, projectId, milestoneId);
    },
    selectIterationPlanView(
      request: Parameters<typeof schedule.selectIterationPlanView>[1],
    ): boolean {
      return schedule.selectIterationPlanView(this, request);
    },
    queueIterationSchedule(milestoneId: string, iterationId: string, dueAt: string): boolean {
      return schedule.queueIterationSchedule(this, {
        milestoneId,
        iterationId,
        dueAt,
        canPlan: this.canManagePlanning,
      });
    },
    rejectIterationScheduleUnscheduledDrop(milestoneId: string): void {
      schedule.rejectUnscheduledDrop(this, milestoneId);
    },
    cancelIterationSchedule(milestoneId: string): void {
      schedule.cancelIterationSchedule(this, milestoneId);
    },
    dropIterationScheduleEntry(milestoneId: string, iterationId: string): void {
      schedule.dropIterationScheduleEntry(this, milestoneId, iterationId);
    },
    async saveIterationSchedule(
      projectId: string,
      milestoneId: string,
    ): Promise<schedule.ScheduleSaveOutcome> {
      return schedule.saveIterationSchedule(this, {
        projectId,
        milestoneId,
        canPlan: this.canManagePlanning,
      });
    },
    /* MIL-07：记录达成 / 重新打开 / 阶段记录 / 归档失败说明（薄转发到 projectCollabPlanningLifecycle）。 */
    openPlanningLifecycle(
      subject: PlanningLifecycleSubject,
      action: ProjectPlanningLifecycleAction,
    ): void {
      lifecycle.openPlanningLifecycle(this, subject, action);
    },
    closePlanningLifecycle(): void {
      lifecycle.closePlanningLifecycle(this);
    },
    setPlanningLifecycleDraft(
      patch: Parameters<typeof lifecycle.setPlanningLifecycleDraft>[1],
    ): void {
      lifecycle.setPlanningLifecycleDraft(this, patch);
    },
    async submitPlanningLifecycle(projectId: string): Promise<lifecycle.PlanningLifecycleOutcome> {
      return lifecycle.submitPlanningLifecycle(this, projectId);
    },
    async openPlanningDetail(projectId: string, subject: PlanningLifecycleSubject): Promise<void> {
      return lifecycle.openPlanningDetail(this, projectId, subject);
    },
    closePlanningDetail(): void {
      lifecycle.closePlanningDetail(this);
    },
    async loadPlanningStageRecords(
      projectId: string,
      subject: PlanningLifecycleSubject,
    ): Promise<void> {
      return lifecycle.loadPlanningStageRecords(this, projectId, subject);
    },
    async archivePlanningSubject(
      request: Parameters<typeof lifecycle.archivePlanningSubject>[1],
    ): ReturnType<typeof lifecycle.archivePlanningSubject> {
      return lifecycle.archivePlanningSubject(this, request);
    },
    /** 打开证据引用里的外部链接（ADR-0036）：交主进程二次校验后给系统浏览器；回执由调用方摆放。 */
    async openPlanningEvidenceLink(
      url: string,
    ): ReturnType<typeof lifecycle.openPlanningEvidenceLink> {
      return lifecycle.openPlanningEvidenceLink(url);
    },
    /* MIL-09：里程碑与迭代计划的新建 / 编辑 / 归档弹层，安排需求，只读现状（薄转发）。
     * ⚠️ 写入口的 `canPlan` 一律取 `canManagePlanning`（manager+，D-MODEL-01 §四）——只收入口，门在服务端。 */
    openMilestoneForm(projectId: string, milestone: ProjectMilestoneListItem | null): void {
      planningForms.openMilestoneForm(this, projectId, milestone, this.canManagePlanning);
    },
    setMilestoneFormDraft(patch: Parameters<typeof planningForms.setMilestoneFormDraft>[1]): void {
      planningForms.setMilestoneFormDraft(this, patch);
    },
    closeMilestoneForm(): void {
      planningForms.closeMilestoneForm(this);
    },
    setMilestoneArchiveConfirm(confirm: boolean): void {
      planningForms.setMilestoneArchiveConfirm(this, confirm);
    },
    async submitMilestoneForm(projectId: string): Promise<planningForms.PlanningFormOutcome> {
      return planningForms.submitMilestoneForm(this, projectId);
    },
    async confirmMilestoneArchive(projectId: string): Promise<planningForms.PlanningFormOutcome> {
      return planningForms.confirmMilestoneArchive(this, projectId);
    },
    openIterationForm(
      projectId: string,
      milestoneId: string,
      iteration: ProjectIterationListItem | null,
    ): void {
      planningForms.openIterationForm(this, {
        projectId,
        milestoneId,
        iteration,
        canPlan: this.canManagePlanning,
      });
    },
    setIterationFormDraft(patch: Parameters<typeof planningForms.setIterationFormDraft>[1]): void {
      planningForms.setIterationFormDraft(this, patch);
    },
    toggleIterationFormRequirement(requirementId: string, checked: boolean): void {
      planningForms.toggleIterationFormRequirement(this, requirementId, checked);
    },
    closeIterationForm(): void {
      planningForms.closeIterationForm(this);
    },
    setIterationArchiveConfirm(confirm: boolean): void {
      planningForms.setIterationArchiveConfirm(this, confirm);
    },
    async submitIterationForm(projectId: string): Promise<planningForms.PlanningFormOutcome> {
      const epoch = this.projectEpoch;
      const outcome = await planningForms.submitIterationForm(this, projectId);
      if (outcome === 'ok') await this.refreshRequirementIterationProjection(projectId, epoch);
      return outcome;
    },
    async confirmIterationArchive(
      request: Parameters<typeof planningForms.confirmIterationArchive>[1],
    ): ReturnType<typeof planningForms.confirmIterationArchive> {
      return planningForms.confirmIterationArchive(this, request);
    },
    openRequirementScheduleDialog(projectId: string, milestoneId: string): void {
      requirementSchedule.openRequirementScheduleDialog(
        this,
        projectId,
        milestoneId,
        this.canManagePlanning,
      );
    },
    closeRequirementScheduleDialog(): void {
      requirementSchedule.closeRequirementScheduleDialog(this);
    },
    selectRequirementSchedule(requirementId: string, selection: string): void {
      requirementSchedule.selectRequirementSchedule(this, requirementId, selection);
    },
    async saveRequirementSchedule(
      projectId: string,
    ): ReturnType<typeof requirementSchedule.saveRequirementSchedule> {
      const epoch = this.projectEpoch;
      const outcome = await requirementSchedule.saveRequirementSchedule(this, projectId);
      if (outcome === 'ok') await this.refreshRequirementIterationProjection(projectId, epoch);
      return outcome;
    },
    async loadRequirementPlacements(projectId: string): Promise<void> {
      return requirementSchedule.loadRequirementPlacements(this, projectId);
    },
    async loadUnscheduledRequirementTotal(projectId: string): Promise<void> {
      return requirementSchedule.loadUnscheduledRequirementTotal(this, projectId);
    },
    async loadRequirementPlacementLookup(projectId: string, requirementId: string): Promise<void> {
      return requirementSchedule.loadRequirementPlacementLookup(this, projectId, requirementId);
    },
    async loadArchivedMilestones(projectId: string): Promise<void> {
      return requirementSchedule.loadArchivedMilestones(this, projectId);
    },
    async loadArchivedIterations(projectId: string, milestoneId: string): Promise<void> {
      return requirementSchedule.loadArchivedIterations(this, projectId, milestoneId);
    },
    clearPlanningPageNotice(): void {
      this.planningPageNotice = null;
    },
    /** 展开指定目标（不是切换：已展开则保持）并取它的迭代——「在里程碑页查看」用。 */
    focusMilestone(projectId: string, milestoneId: string): void {
      this.expandedMilestoneId = milestoneId;
      void planning.loadMilestoneIterations(this, projectId, milestoneId);
    },
    async createTodo(request: ProjectTodoCreateRequest): Promise<boolean> {
      const created = await board.createTodo(this, request);
      if (created) await this.afterTodoWrite(request.projectId, null);
      return created;
    },
    async updateTodo(request: ProjectTodoUpdateRequest): Promise<'ok' | 'conflict' | 'error'> {
      const projectId = this.activeProjectId;
      const outcome = await board.updateTodo(this, request);
      // 撞版本冲突时清单已重取到别人的新版本：这一段在同一次里跟上，⛔ 不等事件（表格与日历同源一致）。
      if (outcome !== 'error' && projectId !== null)
        await this.afterTodoWrite(projectId, request.todoId);
      return outcome;
    },
    async updateTodoDetailed(request: ProjectTodoUpdateRequest): Promise<board.TodoUpdateOutcome> {
      const projectId = this.activeProjectId;
      const result = await board.updateTodoDetailed(this, request);
      if (result.outcome !== 'error' && projectId !== null)
        await this.afterTodoWrite(projectId, request.todoId);
      return result;
    },
    async loadRequirementIterationEditor(
      projectId: string,
      requirementId: string,
    ): Promise<requirementSchedule.RequirementIterationEditorResult> {
      return requirementSchedule.loadRequirementIterationEditor(this, projectId, requirementId);
    },
    async saveRequirementIterationEditor(
      request: Parameters<typeof requirementSchedule.saveRequirementScheduleItems>[1],
    ): Promise<requirementSchedule.ScheduleWriteResult> {
      if (!this.canManagePlanning || this.activeProjectId !== request.projectId)
        return { outcome: 'error', notice: null, rotateRequestId: false };
      const epoch = this.projectEpoch;
      const result = await requirementSchedule.saveRequirementScheduleItems(this, request);
      if (result.outcome === 'ok')
        await this.refreshRequirementIterationProjection(request.projectId, epoch);
      return result;
    },
    async refreshRequirementIterationProjection(projectId: string, epoch: number): Promise<void> {
      if (
        projectId !== this.activeProjectId ||
        epoch !== this.projectEpoch ||
        !this.requirementPageActive
      )
        return;
      await requirementPage.refreshRequirementPage(this, projectId);
    },
    /**
     * 本端写入成功、或写入撞上别人的改动而清单已重取对齐之后，让日历 / 时间轴那一段跟上（CORE-08）：
     * 先把清单里的新版本就地换进去（拖动落库回来条不弹回），再以服务端为准重取这一段——
     * ⛔ 不在本地判它还在不在这一段里。切走了项目就什么都不做。
     */
    async afterTodoWrite(projectId: string, todoId: string | null): Promise<void> {
      if (projectId !== this.activeProjectId) return;
      const epoch = this.projectEpoch;
      if (this.requirementPageActive) await requirementPage.refreshRequirementPage(this, projectId);
      if (projectId !== this.activeProjectId || epoch !== this.projectEpoch) return;
      if (todoId !== null) planWindow.syncPlanWindowTodo(this, todoId);
      void planWindow.reloadPlanWindow(this, projectId);
    },
    /**
     * 认领无主需求并写计划日期（FLOW-02）。与 `updateTodo` 分开：认领只对无主生效，
     * 已被他人认领回 'error'（真实失败提示，⛔ 不伪成功），成功回 'ok'。
     */
    async claimRequirement(request: ProjectRequirementClaimRequest): Promise<'ok' | 'error'> {
      const projectId = this.activeProjectId;
      const outcome = await board.claimRequirement(this, request);
      if (outcome === 'ok' && projectId !== null)
        await this.afterTodoWrite(projectId, request.todoId);
      return outcome;
    },
    /* -- 测试轮次的用例（TST-04，实现见 projectCollabTestCases）：进入 / 返回测试轮次、用例读写、各轮条数 -- */
    async openTestRound(requirementId: string, submissionId: string): Promise<void> {
      return testCases.openTestRound(this, requirementId, submissionId);
    },
    closeTestRound(): void {
      testCases.closeTestRound(this);
    },
    async reloadTestRound(): Promise<void> {
      return testCases.reloadTestRound(this);
    },
    async loadRoundTestCases(projectId: string, submissionId: string): Promise<void> {
      return testCases.loadRoundTestCases(this, projectId, submissionId);
    },
    async loadMoreRoundTestCases(projectId: string, submissionId: string): Promise<void> {
      return testCases.loadMoreRoundTestCases(this, projectId, submissionId);
    },
    async createRoundTestCase(
      request: ProjectRoundTestCaseCreateRequest,
    ): Promise<testCases.TestCaseWriteOutcome> {
      return testCases.createRoundTestCase(this, request);
    },
    async updateTestCase(
      request: ProjectTestCaseUpdateRequest,
    ): Promise<testCases.TestCaseWriteOutcome> {
      return testCases.updateTestCase(this, request);
    },
    async copyPreviousRoundTestCases(
      projectId: string,
      submissionId: string,
    ): Promise<testCases.TestCaseCopyOutcome> {
      return testCases.copyPreviousRoundTestCases(this, projectId, submissionId);
    },
    async loadRequirementCaseCounts(projectId: string, requirementId: string): Promise<void> {
      return testCases.loadRequirementCaseCounts(this, projectId, requirementId);
    },
    /* -- 整需求提测（TST-02，实现见 projectCollabTesting）：轮次缓存 + 整需求提交 -- */
    async loadProjectTestRounds(projectId: string, append = false): Promise<void> {
      return testing.loadProjectTestRounds(this, projectId, append);
    },
    async loadTestDefects(projectId: string, submissionId: string, append = false): Promise<void> {
      return testDefects.loadTestDefects(this, projectId, submissionId, append);
    },
    async loadTestDefectDetail(projectId: string, defectId: string, append = false): Promise<void> {
      return testDefects.loadTestDefectDetail(this, projectId, defectId, append);
    },
    async performTestDefectAction(
      request: import('@shared/protocol/project-testing-defects.js').ProjectTestDefectActionRequest,
    ): Promise<testing.TestingWriteOutcome> {
      return testDefects.performTestDefectAction(this, request);
    },
    async loadTestExecutions(projectId: string, caseId: string, append = false): Promise<void> {
      return testCases.loadTestExecutions(this, projectId, caseId, append);
    },
    async executeTestCase(
      request: import('@shared/protocol/project-testing-cases.js').ProjectTestCaseExecuteRequest,
    ): Promise<testing.TestingWriteOutcome> {
      return testCases.executeTestCase(this, request);
    },
    async loadTestRoundActions(
      projectId: string,
      submissionId: string,
      append = false,
    ): Promise<void> {
      return testing.loadTestRoundActions(this, projectId, submissionId, append);
    },
    async performTestRoundAction(
      request: import('@shared/protocol/project-testing.js').ProjectTestRoundActionRequest,
    ): Promise<testing.TestingWriteOutcome> {
      return testing.performTestRoundAction(this, request);
    },
    async loadMoreRequirementRounds(projectId: string, requirementId: string): Promise<void> {
      return testing.loadRequirementRounds(this, projectId, requirementId, true);
    },
    async loadRequirementRounds(projectId: string, requirementId: string): Promise<void> {
      return testing.loadRequirementRounds(this, projectId, requirementId);
    },
    /**
     * 整需求提交。成功后日历 / 时间轴那一段跟上（同认领）；撞版本冲突时清单重取到新版本——弹层读清单里的
     * 活版本号，带着**同一个请求号**重试即可（服务端的内容指纹不含版本号）。
     */
    async submitRequirementForTest(
      request: ProjectRequirementSubmitRequest,
    ): Promise<testing.RequirementSubmitOutcome> {
      const outcome = await testing.submitRequirementForTest(this, request);
      if (request.projectId !== this.activeProjectId) return outcome;
      if (outcome.ok) await this.afterTodoWrite(request.projectId, request.requirementId);
      else if (outcome.serverCode === 'version_conflict') await this.loadTodos(request.projectId);
      return outcome;
    },
    /**
     * 软删若干**根** id 及其整棵子树（manager+）。成功后按服务端权威 `deletedIds` 就地
     * 摘除；失败按单/多根语义分流（详见 `board.deleteTodos`）。无活跃项目时不发请求。
     */
    async deleteTodos(ids: readonly string[]): Promise<board.TodoDeleteResult> {
      const projectId = this.activeProjectId;
      if (projectId === null) {
        return { ok: false, realigned: false, message: projectCollabErrorText('transient') };
      }
      const result = await board.deleteTodos(this, projectId, ids);
      // 整批撞「有一条已不在」一条都没删，但清单已重取对齐：这一段同样按服务端重取。
      if (result.ok || result.realigned) await this.afterTodoWrite(projectId, null);
      return result;
    },

    /* ------------------------- 工作单与拆解草案闸 ------------------------- */

    async loadTodoDetail(todoId: string): Promise<workOrder.TodoDetailSnapshot | null> {
      return workOrder.loadTodoDetail(this, todoId);
    },
    async setAcceptanceItems(
      request: ProjectTodoAcceptanceSetRequest,
    ): Promise<{ readonly outcome: workOrder.WorkOrderOutcome; readonly todo: Todo | null }> {
      return workOrder.setAcceptanceItems(this, request);
    },
    async submitTodoReview(
      request: ProjectTodoSubmitReviewRequest,
    ): Promise<workOrder.WorkOrderOutcome> {
      return workOrder.submitTodoReview(this, request);
    },
    async reviewTodo(request: ProjectTodoReviewRequest): Promise<workOrder.WorkOrderOutcome> {
      return workOrder.reviewTodo(this, request);
    },
    async loadDraftBatches(projectId: string): Promise<void> {
      return workOrder.loadDraftBatches(this, projectId);
    },
    async dropDraft(draftId: string): Promise<boolean> {
      return workOrder.dropDraft(this, draftId);
    },
    async resolveDraftBatch(batchId: string, decision: 'confirm' | 'discard'): Promise<boolean> {
      return workOrder.resolveDraftBatch(this, batchId, decision);
    },

    async loadFiles(projectId: string): Promise<void> {
      return files.loadFiles(this, projectId);
    },
    async uploadFile(projectId: string, kind: ProjectFileKind): Promise<boolean> {
      return files.uploadFile(this, projectId, kind);
    },
    async cancelFileUpload(): Promise<void> {
      return files.cancelUpload(this);
    },
    async promoteFile(fileId: string): Promise<boolean> {
      return files.promoteFile(this, fileId);
    },
    async deleteFile(fileId: string): Promise<boolean> {
      return files.deleteFile(this, fileId);
    },
    async downloadFile(fileId: string): Promise<void> {
      return files.downloadFile(this, fileId);
    },

    /* -- 资产版本：目录 / 回收站 / 版本历史与两类恢复（RPT-08，实现见 projectCollabAssets） -- */
    async loadAssets(projectId: string): Promise<void> {
      return assetVersions.loadAssets(this, projectId);
    },
    async loadAssetTrash(projectId: string): Promise<void> {
      return assetVersions.loadAssetTrash(this, projectId);
    },
    async openAssetVersions(projectId: string, assetId: string): Promise<void> {
      return assetVersions.openAssetVersions(this, projectId, assetId);
    },
    async loadAssetVersionChain(projectId: string): Promise<void> {
      return assetVersions.loadAssetVersionChain(this, projectId);
    },
    closeAssetVersions(): void {
      assetVersions.closeAssetVersions(this);
    },
    async restoreAsset(
      projectId: string,
      assetId: string,
    ): Promise<assetVersions.AssetRecoveryOutcome> {
      return assetVersions.restoreAsset(this, projectId, assetId);
    },
    async restoreAssetVersion(
      projectId: string,
      versionId: string,
    ): Promise<assetVersions.AssetRecoveryOutcome> {
      return assetVersions.restoreAssetVersion(this, projectId, versionId);
    },

    clearActionNotice(): void {
      this.actionNotice = null;
    },
  },
});
