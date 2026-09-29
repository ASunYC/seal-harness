import type {
  ChatMessage,
  FeedEntry,
  ProjectConnectionState,
  ProjectConventions,
  ProjectDetail,
  ProjectFile,
  ProjectFileUploadProgress,
  ProjectOpenInvitation,
  ProjectSummary,
  Todo,
  TodoDraftBatch,
  TodoItemKind,
  TodoStatus,
} from '@shared/protocol/project-collab.js';
import type {
  ProjectAssetCatalogueEntry,
  ProjectAssetVersionChain,
} from '@shared/protocol/project-collab-assets.js';
import type {
  ProjectIterationListItem,
  ProjectIterationSort,
  ProjectMilestoneListItem,
} from '@shared/protocol/project-planning.js';
import type {
  ProjectIterationLifecycleEvent,
  ProjectMilestoneLifecycleEvent,
  ProjectPlanningLifecycleAction,
} from '@shared/protocol/project-planning-lifecycle.js';
import type {
  ProjectRequirementPlacement,
  ProjectRequirementPlacementItem,
} from '@shared/protocol/project-planning-schedule.js';
import type { ProjectPlanWindow } from '@shared/protocol/project-collab-plan-dates.js';
import type { ProjectTestRoundDetail } from '@shared/protocol/project-testing.js';
import type { ProjectTestRoundHistory } from '@shared/protocol/project-testing.js';
import type { ProjectTestExecution } from '@shared/protocol/project-testing-cases.js';
import type {
  ProjectTestDefect,
  ProjectTestDefectHistory,
} from '@shared/protocol/project-testing-defects.js';
import type {
  ProjectTestCase,
  ProjectTestCaseCopySource,
} from '@shared/protocol/project-testing-cases.js';

import type { ProjectCollabNotice } from './projectCollabErrors';
import type {
  IterationFilter,
  IterationSortDirection,
} from '../components/project/iteration-list-view';
import {
  DEFAULT_ITERATION_PLAN_VIEW,
  type IterationPlanView,
  type IterationScheduleDraft,
} from '../components/project/iteration-schedule-view';
import type {
  IterationFormDraft,
  MilestoneFormDraft,
} from '../components/project/planning-form-view';

/**
 * 里程碑页写入口（MIL-09）的弹层态。⭐ 草稿放 store 而不放组件：冲突后就地重取列表会换掉行对象，
 * 由组件按行持有输入会被一次刷新冲掉（判据「409 保留表单输入」的载体）。
 * ⭐ 弹层只属**一个**目标（`milestoneId`）：打开另一个目标的弹层就是一份新草稿（判据「切目标不串数据」）。
 */
export interface MilestoneFormState {
  /** null ＝ 新建。 */
  readonly milestoneId: string | null;
  readonly draft: MilestoneFormDraft;
  readonly clientRequestId: string;
  /** 这个请求号上一次随行的内容指纹：内容变了就换号（同号异内容服务端回 idempotency_conflict）。 */
  readonly sentFingerprint: string | null;
  readonly saving: boolean;
  /** 「归档里程碑」的二次确认步。 */
  readonly confirmArchive: boolean;
  readonly notice: ProjectCollabNotice | null;
}

export interface IterationFormState {
  readonly milestoneId: string;
  /** null ＝ 新建；新建成功但关联需求没存上时会就地换成已建那一轮的 id（再点保存不重复建）。 */
  readonly iterationId: string | null;
  readonly draft: IterationFormDraft;
  readonly clientRequestId: string;
  readonly sentFingerprint: string | null;
  /** 关联需求那一步（安排需求整批写）的请求号与指纹，与轮次本体各管各的。 */
  readonly scheduleRequestId: string;
  readonly scheduleFingerprint: string | null;
  readonly saving: boolean;
  readonly confirmArchive: boolean;
  readonly notice: ProjectCollabNotice | null;
}

export interface RequirementScheduleDialogState {
  readonly milestoneId: string;
  /** 用户**改过**的行：需求 id → 轮次 id（空串 ＝ 不排）。没改过的行读它当前的排期。 */
  readonly selections: Readonly<Record<string, string>>;
  readonly clientRequestId: string;
  readonly sentFingerprint: string | null;
  readonly saving: boolean;
  readonly notice: ProjectCollabNotice | null;
}

/** 需求排期现状（候选）：一次一致快照，按页取满。⛔ 未排条数不在这里自算。 */
export interface RequirementPlacementsState {
  readonly items: readonly ProjectRequirementPlacementItem[];
  readonly total: number;
  readonly loaded: boolean;
  readonly loading: boolean;
  readonly error: ProjectCollabNotice | null;
  readonly requestId: number;
}

/** 一段只读的已归档列表（已归档里程碑 / 某个目标下的已归档迭代计划）。 */
export interface ArchivedPlanningList<Row> {
  readonly items: readonly Row[];
  /** 服务端权威条数（含本页之外的）。 */
  readonly total: number;
  readonly loaded: boolean;
  readonly loading: boolean;
  readonly error: ProjectCollabNotice | null;
  readonly requestId: number;
}

/** 需求编辑器「迭代信息」按需求各查一份。 */
export interface RequirementPlacementLookup {
  readonly placement: ProjectRequirementPlacement | null;
  readonly loaded: boolean;
  readonly error: ProjectCollabNotice | null;
  readonly requestId: number;
}

/**
 * 一条需求的测试轮次（TST-02）：需求详情底部的提测块与「测试记录」页签共用这一份。
 * ⚠️ 只取第一页（最新在前 30 轮）：活动轮次与最近一轮必在第一页里，完整历史的翻页不在本期。
 */
export interface RequirementRoundsState {
  readonly nextCursor?: string | null;
  readonly items: readonly ProjectTestRoundDetail[];
  /** 服务端说还有更早的轮次（本期不翻页，页签计数据此标「+」）。 */
  readonly hasMore: boolean;
  /** 至少成功取回过一次（区分「还没取」与「取了是空」）。 */
  readonly loaded: boolean;
  readonly loading: boolean;
  readonly error: ProjectCollabNotice | null;
  /** 同一条需求并发重取的序号（迟到响应作废）。 */
  readonly requestId: number;
  /**
   * 发起这次取数时清单里这条需求的版本（没在清单里＝null）。`todo.changed` 重取清单之后版本对不上
   * ⇒ 这份轮次可能过期、重取一次——⛔ 判据不读事件负载（合帧窗里同键只留一帧，负载里的原因靠不住）。
   */
  readonly requirementVersion: number | null;
}

/**
 * 测试页签正在看的那一轮（TST-04：从需求详情「测试记录」的轮次卡「进入测试」进来）。
 * ⚠️ 单轮详情取失败时 `round` 为 null 并标出 `error`：⛔ 不拿一轮空的冒充「没有这一轮」。
 */
export interface TestingPage<T> {
  readonly consumedCursors?: readonly string[];
  readonly items: readonly T[];
  readonly total: number;
  readonly hasMore: boolean;
  readonly nextCursor: string | null;
  readonly loaded: boolean;
  readonly loading: boolean;
  readonly error: ProjectCollabNotice | null;
  readonly requestId: number;
}

export interface TestDefectDetailState extends TestingPage<ProjectTestDefectHistory> {
  readonly defect: ProjectTestDefect | null;
}

export interface TestRoundViewState {
  readonly snapshot?: import('@shared/protocol/project-testing.js').ProjectTestRoundSnapshot | null;
  readonly requirementId: string;
  readonly submissionId: string;
  readonly round: ProjectTestRoundDetail | null;
  /** 提交时冻结的需求标题（单轮详情快照里取；取不到为 null）。 */
  readonly requirementTitle: string | null;
  readonly loading: boolean;
  readonly error: ProjectCollabNotice | null;
  readonly requestId: number;
}

/** 一轮的用例（TST-04）：按序号分页累积；「加载更多」接在后面。 */
export interface RoundTestCasesState {
  readonly items: readonly ProjectTestCase[];
  readonly hasMore: boolean;
  readonly nextCursor: string | null;
  /** 整轮条数（服务端给的，含还没翻到的页）。 */
  readonly total: number;
  /** 可复用的上轮来源（只在轮次仍在测时由服务端给出）。 */
  readonly copySource: ProjectTestCaseCopySource | null;
  readonly loaded: boolean;
  readonly loading: boolean;
  readonly error: ProjectCollabNotice | null;
  /** 不是失败的就地说明（游标失效已回到第一页）。 */
  readonly notice: ProjectCollabNotice | null;
  readonly requestId: number;
}

/** 一条需求各轮的用例条数（TST-04：需求详情轮次卡上的「N 个用例」）。 */
export interface RequirementCaseCountsState {
  /** 轮次 id → 条数；没有用例的轮次不在表里（按 0 显示）。 */
  readonly counts: Readonly<Record<string, number>>;
  readonly loaded: boolean;
  readonly requestId: number;
}

/** 快速添加迭代的行内草稿（用户亲笔；⛔ 409 时不清空）。 */
export interface IterationDraft {
  readonly name: string;
  readonly dueAt: string;
  readonly criteriaMd: string;
}

export const EMPTY_ITERATION_DRAFT: IterationDraft = { name: '', dueAt: '', criteriaMd: '' };

/**
 * 一个业务目标（里程碑）下迭代列表的视图态（MIL-05）：关键字 / 筛选下拉 / 排序 /
 * 显示已完成 / 快速添加草稿。
 *
 * ⭐ **按 milestoneId 各存一份**（见 `iterationViews`）——切到另一个目标就是另一份键，
 *    ⇒ 判据「切目标不串数据」的载体：A 目标的筛选/草稿绝不出现在 B 目标上。
 */
export interface IterationViewState {
  /**
   * 列表 / 看板 / 甘特三视图里当前是哪一个（MIL-06）。⭐ 与下面的查询态**同一份**：
   * 三视图共用同一组关键字/筛选/排序，切视图不另起一份查询（原型 `viewState28` 同形）。
   */
  readonly view: IterationPlanView;
  readonly query: string;
  readonly filter: IterationFilter;
  readonly sort: ProjectIterationSort;
  readonly direction: IterationSortDirection;
  readonly showDone: boolean;
  /** 快速添加行是否展开。 */
  readonly quickAddOpen: boolean;
  /** 草稿（quickAddOpen 时可写）；⛔ 保存 409 时保留、保存成功才清。 */
  readonly quickDraft: IterationDraft;
}

/** 新目标的默认视图态（照原型 `viewState28` 初值：list 视图、按 due 升序、隐藏已完成）。 */
export function createIterationViewState(): IterationViewState {
  return {
    view: DEFAULT_ITERATION_PLAN_VIEW,
    query: '',
    filter: 'all',
    sort: 'due_at',
    direction: 1,
    showDone: false,
    quickAddOpen: false,
    quickDraft: EMPTY_ITERATION_DRAFT,
  };
}

/**
 * 生命周期动作作用的对象（MIL-07）。`row` 是**打开那一刻**的快照：列表刷新后优先读活行
 * （`livePlanningRow`），行从列表里消失（被他人归档）时靠它继续显示名称与标准——阶段记录
 * 照样按 id 读得到。
 */
export type PlanningLifecycleSubject =
  | {
      readonly kind: 'iteration';
      /** 所属业务目标（成功 / 冲突后刷新这一份迭代列表）；未关联轮次为 null。 */
      readonly milestoneId: string | null;
      readonly row: ProjectIterationListItem;
    }
  | { readonly kind: 'milestone'; readonly row: ProjectMilestoneListItem };

/** 记录达成 / 重新打开弹层的草稿（用户亲笔；⛔ 422 / 409 时一个字不清）。 */
export interface PlanningLifecycleDraft {
  readonly subject: PlanningLifecycleSubject;
  readonly action: ProjectPlanningLifecycleAction;
  /** 记录达成＝验收结果 / 交付依据；重新打开＝原因。 */
  readonly reason: string;
  /** 证据引用（仅记录达成上送；与待办 refs 同形态的 token，外部链接为 `link:<规范地址>`）。 */
  readonly evidenceRefs: readonly string[];
  /** 「外部链接」输入框里还没添加的文字（不上送；添加成功或判为重复时清空）。 */
  readonly linkText: string;
  /** 「外部链接」输入框下方的就地错误（不弹 toast；null ＝ 没有）。 */
  readonly linkError: string | null;
  /** 「已核对全部完成标准」（仅记录达成用，不上送）。 */
  readonly confirmed: boolean;
  /** 幂等键：同一份内容的重试不变，内容改过再提交时换新号。 */
  readonly clientRequestId: string;
  /** 当前请求号最近一次随哪份内容发出（内容指纹）；null ＝ 还没发过。 */
  readonly sentFingerprint: string | null;
}

/** 一个对象的阶段记录（只经 REST 读回；⛔ 失败不清已有记录）。 */
export interface PlanningStageRecords {
  readonly items: readonly (ProjectMilestoneLifecycleEvent | ProjectIterationLifecycleEvent)[];
  readonly total: number;
  /** 至少成功取回过一次（区分「还没加载」与「加载后为空」）。 */
  readonly loaded: boolean;
  readonly loading: boolean;
  readonly error: ProjectCollabNotice | null;
  /** 同对象并发乱序的序号（迟到响应作废）。 */
  readonly requestId: number;
}

/**
 * 需求页码查询（CORE-07）的筛选面（不含 projectId/page/pageSize——那三个是分页机制本身）。
 * 省略某键＝不按它筛。`itemKind` 省略时服务端默认需求池。
 */
export interface RequirementPageFilters {
  readonly view?: 'claimed';
  readonly sortBy?: 'priority' | 'dueAt' | 'createdAt' | 'title' | 'status';
  readonly sortDirection?: 'asc' | 'desc';
  readonly itemKind?: TodoItemKind;
  readonly assigneeSubject?: string;
  readonly creatorSubject?: string;
  readonly keyword?: string;
  readonly status?: TodoStatus;
  readonly iterationId?: string;
  readonly moduleId?: string;
  readonly categoryId?: string;
}

/**
 * 按计划时间段读取的一次查询（CORE-08，ADR-0042）：页签层级 + 可见那一段的两端时刻。
 * `requirement` ＝需求页（只取需求）；`task` ＝任务页（需求与任务都取，归属收窄在渲染层按需求树判）。
 */
export interface PlanWindowQuery extends ProjectPlanWindow {
  readonly scope: 'requirement' | 'task';
}

/** 每页条数闭集（协议同界）；默认 10。 */
export type RequirementPageSize = 5 | 10 | 20;
export const REQUIREMENT_PAGE_DEFAULT_SIZE: RequirementPageSize = 10;

export interface RequirementSubtreeState {
  readonly loading: boolean;
  readonly error: ProjectCollabNotice | null;
  readonly hasMore: boolean;
  readonly nextCursor: string | null;
  readonly seenCursors: readonly string[];
}

/**
 * 里程碑（业务目标）总览每页条数（MIL-04）。里程碑数量远少于需求，一页 20 个够用；
 * 与服务端 `PROJECT_PLANNING_MAX_PAGE_SIZE = 100` 同量纲、在其下界内。
 */
export const MILESTONE_PAGE_SIZE = 20;

/**
 * `projectCollab` store 的状态形状与初值。
 *
 * 与 store 分文件的理由是**体量**：动作按域（动态/讨论/看板/资产）各自成文件后，
 * 状态若还留在 store 里就成了唯一的跨文件耦合点——放在这里，各域文件用
 * `Pick<ProjectCollabState, …>` 声明自己真正碰的那几格，字段增删两边自动对齐。
 */
export interface ProjectCollabState {
  /** null = 尚未水合；水合失败按 fail-safe 记 false（本次运行内不再放行入口）。 */
  availability: boolean | null;
  /** 事件流连接状态；null = 尚未收到任何连接帧。 */
  connection: ProjectConnectionState | null;
  eventsListening: boolean;
  /**
   * 事件订阅的拆除钩子（退订 + 撤销在途合帧定时器）；null = 未布防。
   * 值是函数，Vue 的响应式不代理函数，放在 state 里只为让 action 够得着它。
   */
  eventTeardown: (() => void) | null;
  /**
   * 账号纪元：换号时推进，作废**跨账号**的在途结果（能力水合、项目列表）。
   * 与 `projectEpoch` 正交——切项目不该取消列表刷新，换账号则两者都要作废。
   */
  accountEpoch: number;
  /**
   * 本人在协作服务端的身份主体（`project:availability` 正式载体，与成员 `subject`
   * 同一量纲）。null = 能力未启用或主体暂不可得——此时「本人」类按钮一律收起；
   * 纯 UI 显隐判据，服务端仍按令牌强判。
   */
  mySubject: string | null;

  projects: readonly ProjectSummary[];
  projectsLoading: boolean;
  projectsError: ProjectCollabNotice | null;
  /**
   * 列表是否带上已归档项目。默认 false（服务端也默认隐藏）；拥有者要找回归档项目
   * 时打开。**存在 state 里而不是逐次调用传参**——事件驱动的列表刷新是无参调用的，
   * 传参会在每次刷新时把开关悄悄拨回默认值。
   */
  includeArchivedProjects: boolean;

  /** 当前打开的项目；切换时推进 epoch，迟到结果作废。 */
  activeProjectId: string | null;
  projectEpoch: number;

  detail: ProjectDetail | null;
  detailLoading: boolean;
  detailError: ProjectCollabNotice | null;

  feedEntries: readonly FeedEntry[];
  feedLoading: boolean;
  feedError: ProjectCollabNotice | null;
  feedHasMore: boolean;

  chatMessages: readonly ChatMessage[];
  chatLoading: boolean;
  chatError: ProjectCollabNotice | null;
  chatHasMore: boolean;
  /** 未读分割线：首条未读消息的 seq；进入讨论页签时按列表投影的未读数一次性推导。 */
  chatUnreadFromSeq: number | null;

  todos: readonly Todo[];
  todosLoading: boolean;
  todosError: ProjectCollabNotice | null;
  /**
   * `todo.changed` 事件的到达序号（UX-02）：当前项目每落地一次该事件（清单已按事件重取之后）
   * 加一。打开着的单屏需求详情 watch 它去重取**只在详情端点里**的部分（逐条完成标准）。
   * ⛔ 它只是「这一类事件到了」的信号：事件负载一个字段都不读，也不在这里带任何正文。
   * ⛔ 换项目 / 换号不归零——归零本身也是一次变化，会让刚清空的详情再重取一次。
   */
  todoChangedRevision: number;

  /**
   * 需求页码查询（CORE-07）的当前一页。⚠️ 这套与上面的 `todos`（游标全量投影）**并存**：
   * 服务端分页 + 过滤走这一套，界面翻页只拿一页而不再把 40 页拉满本地切。
   * ⛔ 迟到响应作废靠 `projectEpoch`（切项目）+ `requirementPageRequestId`（同项目乱序）
   *    双守：只有 epoch 与 requestId 都仍是最新的响应才允许落地。
   */
  requirementItems: readonly Todo[];
  requirementTotal: number;
  requirementPage: number;
  requirementPageSize: RequirementPageSize;
  /** 项目业务修订号（不透明串）；翻页途中它变了＝数据变了、可提示刷新。 */
  requirementQueryRevision: string | null;
  requirementPageActive: boolean;
  requirementPageLoading: boolean;
  requirementPageError: ProjectCollabNotice | null;
  requirementFilters: RequirementPageFilters;
  /** 请求序号：同项目并发/乱序重取时只允许最后发出的那次落地（照 `openInvitationsRequestId`）。 */
  requirementPageRequestId: number;
  /**
   * 按需子树（展开一条需求看它的子任务）：requirementId → 子项。**不占需求分页**——
   * 走游标端点单独查、落这里，⛔ 不动上面任何 requirement* 分页字段。
   */
  requirementSubtrees: Readonly<Record<string, readonly Todo[]>>;
  /** 子树各自的请求序号（同一条需求并发重取时的乱序作废）。 */
  requirementSubtreeRequestIds: Readonly<Record<string, number>>;
  requirementSubtreeStates: Readonly<Record<string, RequirementSubtreeState>>;
  /**
   * 整需求提测（TST-02）：需求 id → 这条需求的测试轮次。只在协商到 `requirement.test_mode` 时取；
   * 切项目 / 换号随 `clearProjectScopedState` 整表清空，迟到结果靠 `projectEpoch` + 请求序号作废。
   */
  requirementRounds: Readonly<Record<string, RequirementRoundsState>>;
  projectTestRounds: TestingPage<ProjectTestRoundDetail> | null;
  testRoundActions: Readonly<Record<string, TestingPage<ProjectTestRoundHistory>>>;
  testExecutions: Readonly<Record<string, TestingPage<ProjectTestExecution>>>;
  testDefects: Readonly<Record<string, TestingPage<ProjectTestDefect>>>;
  testDefectDetails: Readonly<Record<string, TestDefectDetailState>>;
  /**
   * 测试轮次的用例（TST-04）：测试页签正在看的那一轮、各轮的用例缓存、各需求各轮的用例条数。
   * 切项目 / 换号随 `clearProjectScopedState` 一格不留，迟到结果靠 `projectEpoch` + 请求序号作废。
   */
  testRoundView: TestRoundViewState | null;
  roundTestCases: Readonly<Record<string, RoundTestCasesState>>;
  requirementCaseCounts: Readonly<Record<string, RequirementCaseCountsState>>;

  /**
   * 按计划时间段读取（CORE-08，ADR-0042）：日历 / 时间轴**当前可见那一段**的完整结果（逐页取全）。
   * ⚠️ 与 `todos`（游标全量）、`requirementItems`（界面一页）三套并存：这一套的日期由服务端判，
   *    视图配置（筛选 / 搜索 / 排序）在渲染层叠加其上。⛔ 迟到响应靠 `projectEpoch` + `planWindowRequestId` 双守。
   */
  planWindowQuery: PlanWindowQuery | null;
  planWindowItems: readonly Todo[];
  planWindowLoading: boolean;
  planWindowError: ProjectCollabNotice | null;
  /** 单种类达到取数页数上限、停止续取（视图据此注明只显示前 N 条）。 */
  planWindowTruncated: boolean;
  planWindowRequestId: number;

  /* ── 里程碑（业务目标）总览（MIL-04） ────────────────────────────────────────
   * ⭐ 数字**全部来自服务端授权聚合**：列表行自带 `iterationSummary`（未归档轮次的
   *    open/completed/total）与 `visibleRequirementCount`（看的人读得到的去重需求数，
   *    服务端 `COUNT(DISTINCT requirement_id)` 且过 viewer 可见性门）。
   *    ⛔ 渲染层**不得**本地遍历需求自算——本地算不出别人看得见什么，一算就把别人的
   *       个人条目算进去了。
   */
  milestones: readonly ProjectMilestoneListItem[];
  milestonesTotal: number;
  milestonesPage: number;
  /**
   * 是否已至少成功加载过一次。用来把「还没加载」与「加载后确实为空」分成**两态**：
   * 无结果（loaded && 空）出诚实空态，⛔ 不长成加载失败。
   */
  milestonesLoaded: boolean;
  milestonesLoading: boolean;
  milestonesError: ProjectCollabNotice | null;
  /** 请求序号：同项目并发/乱序重取时只允许最后发出的响应落地（照 `requirementPageRequestId`）。 */
  milestonesRequestId: number;
  /**
   * 业务目标列表的计划时间段（CORE-08，ADR-0042）：null ＝ 不按时间段读。随请求原样带上，
   * 换项目清空。⚠️ 当前没有界面设置它（甘特仍与列表 / 看板共用迭代查询，见 ADR-0042 决策 10）。
   */
  milestonesPlanWindow: ProjectPlanWindow | null;
  /**
   * 当前展开的业务目标 id（**单开**，照原型 `overviewState31.open`）。null = 全部收起。
   * ⭐ 只有**切项目**才清（`clearProjectScopedState`）；刷新与翻页都保留它
   *    ⇒ 判据 2「目标切换/刷新/分页保持状态」的来源。
   */
  expandedMilestoneId: string | null;
  /**
   * 展开目标下的多轮迭代：`milestoneId → 轮次列表`。**按目标各存一份**——展开目标 B
   * 时目标 A 的迭代仍留在这里，⛔ 但渲染层只读 `expandedMilestoneId` 那一份，
   * 不会把别的目标的详情塞进当前展开体。
   */
  milestoneIterations: Readonly<Record<string, readonly ProjectIterationListItem[]>>;
  milestoneIterationsLoading: Readonly<Record<string, boolean>>;
  milestoneIterationsError: Readonly<Record<string, ProjectCollabNotice | null>>;
  /** 各目标迭代取数的请求序号（同一目标并发重取时的乱序作废）。 */
  milestoneIterationsRequestIds: Readonly<Record<string, number>>;
  /**
   * 迭代列表视图态（MIL-05）：`milestoneId → 视图态`。**按目标各存一份**——切目标就是
   * 另一份键，A 目标的筛选/草稿绝不串到 B（判据「切目标不串数据」的载体）。
   * ⭐ 只有**切项目**才整表清（`clearProjectScopedState`）。
   */
  iterationViews: Readonly<Record<string, IterationViewState>>;
  /** 迭代行内保存（编辑/快速添加）的动作回执（成功/冲突/失败提示，与看板同一套）。 */
  iterationActionNotice: ProjectCollabNotice | null;
  /**
   * 排期草案（MIL-06）：`milestoneId → 草案`。看板/甘特的拖动与方向键**只改这里**，
   * 「保存排期」才落盘。⭐ 按目标隔离（切目标不串）；切项目 / 换号随 `clearProjectScopedState`
   * 整表清空。⛔ 不落本地存储——草案是一次编辑会话，不是偏好。
   */
  iterationScheduleDrafts: Readonly<Record<string, IterationScheduleDraft>>;
  /** 各目标排期横幅的回执（草案被拒 / 保存成功 / 保存失败），按目标隔离。 */
  iterationScheduleNotices: Readonly<Record<string, ProjectCollabNotice | null>>;
  /** 各目标「保存排期」是否在途（在途时保存按钮禁用，防同一份草案连点）。 */
  iterationScheduleSaving: Readonly<Record<string, boolean>>;
  /**
   * 各目标最近一次保存请求的身份：同一份草案（指纹相同）的重试沿用同一个幂等键；
   * 草案一变指纹就变，下次保存换新键（否则服务端回 `idempotency_conflict`）。
   */
  iterationScheduleRequests: Readonly<
    Record<string, { readonly fingerprint: string; readonly clientRequestId: string }>
  >;
  /**
   * 生命周期弹层（MIL-07）：记录达成 / 重新打开的草稿，null ＝ 未打开。
   * ⭐ 草稿放 store 而不放组件：冲突后就地重取列表会让行对象换新，若由组件按行持有输入，
   *    一次刷新就把用户写的字冲掉（判据「422 / 409 输入一个字不丢」的载体）。
   */
  planningLifecycleDraft: PlanningLifecycleDraft | null;
  planningLifecycleSubmitting: boolean;
  /** 弹层内的失败 / 冲突 / 本地核对提示；成功回执走 `iterationActionNotice`。 */
  planningLifecycleNotice: ProjectCollabNotice | null;
  /** 迭代计划详情弹层（含阶段记录）的对象；null ＝ 未打开。 */
  planningDetail: PlanningLifecycleSubject | null;
  /** 阶段记录：按对象键（`iteration:<id>` / `milestone:<id>`）各存一份。 */
  planningStageRecords: Readonly<Record<string, PlanningStageRecords>>;
  /** MIL-09：新建 / 编辑里程碑弹层；null ＝ 未打开。 */
  milestoneForm: MilestoneFormState | null;
  /** MIL-09：添加 / 编辑迭代计划弹层；null ＝ 未打开。 */
  iterationForm: IterationFormState | null;
  /** MIL-09：安排需求弹层；null ＝ 未打开。 */
  requirementScheduleDialog: RequirementScheduleDialogState | null;
  /** MIL-09：两个弹层共用的候选（看得见的活需求 + 当前排期）。 */
  requirementPlacements: RequirementPlacementsState;
  /** MIL-09：「未排里程碑 N」的服务端权威值；null ＝ 还没取到。 */
  unscheduledRequirementTotal: number | null;
  /** MIL-09：「已归档里程碑 N」。 */
  archivedMilestones: ArchivedPlanningList<ProjectMilestoneListItem>;
  /** MIL-09：「已归档迭代计划 N」，按目标各存一份。 */
  archivedIterations: Readonly<Record<string, ArchivedPlanningList<ProjectIterationListItem>>>;
  /** MIL-09：需求编辑器「迭代信息」，按需求各存一份。 */
  requirementPlacementLookups: Readonly<Record<string, RequirementPlacementLookup>>;
  /** MIL-09：里程碑页级回执（里程碑已保存 / 已归档）；迭代计划的回执仍走 `iterationActionNotice`。 */
  planningPageNotice: ProjectCollabNotice | null;

  /**
   * 我看得见的拆解草案批次（我发起的，或派给我的；至多两人可见，拥有者也看不见）。
   *
   * 由 `todo.draft` 事件驱动重取。⚠️ 那条事件是**定向**的：服务端给每个可见者各写
   * 一行，第三个人一行都读不到——所以「收到事件就重取」不会让任何人多看见一批草案，
   * 权威可见性判据仍在服务端的列表端点上。
   */
  draftBatches: readonly TodoDraftBatch[];
  draftsLoading: boolean;
  /** 草案列表请求序号：同一项目并发重取时只允许最后发出的响应落地。 */
  draftsRequestId: number;
  draftsError: ProjectCollabNotice | null;

  /**
   * 本项目进行中的开放邀请（未撤销、未过期；服务端列表端点 manager+）。
   * ⛔ 列表投影里**没有 code**（库里也没有）——明文只在签发那一刻出现一次。
   */
  openInvitations: readonly ProjectOpenInvitation[];
  openInvitationsLoading: boolean;
  /** 开放邀请列表请求序号：同一项目并发重取时只允许最后发出的响应落地（照 `draftsRequestId`）。 */
  openInvitationsRequestId: number;
  openInvitationsError: ProjectCollabNotice | null;

  files: readonly ProjectFile[];
  filesLoading: boolean;
  filesError: ProjectCollabNotice | null;
  fileActionBusy: boolean;
  /** 在途上传的严格投影；不含路径，切项目/账号时立即清空并取消 Main 操作。 */
  fileUpload: ProjectFileUploadProgress | null;
  fileUploadOperationId: string | null;

  /* ── 资产版本：目录 / 回收站 / 版本链（RPT-08） ────────────────────────────────
   * ⚠️ 与上面的 `files`（字节行）是**两套模型**：`files` 是旧文件列表，这里是资产血统
   *    （服务端 `file_assets`）。服务端不回填、旧上传也不建血统 ⇒ 两边**不按 fileId 拼表**
   *    （ADR-0037 决策 8），各取各的，谁也不从谁推导。
   * ⭐ 目录与回收站互补不重叠；任何一次恢复之后两边都按服务端重取，⛔ 不在本地搬行。
   */
  assets: readonly ProjectAssetCatalogueEntry[];
  /** 本项目内至少成功取过一次目录（「还没取」与「取了是空」分两态；事件只重取已取过的）。 */
  assetsLoaded: boolean;
  assetsLoading: boolean;
  assetsError: ProjectCollabNotice | null;
  /** 请求序号：同项目并发/乱序重取时只让最后发出的那次落地。 */
  assetsRequestId: number;
  /** 回收站（已删血统，最近删的在前）。 */
  assetTrash: readonly ProjectAssetCatalogueEntry[];
  assetTrashLoaded: boolean;
  assetTrashLoading: boolean;
  assetTrashError: ProjectCollabNotice | null;
  assetTrashRequestId: number;
  /** 版本历史弹层正在看的血统 id；null = 未打开（`file.changed` 据此决定要不要重取版本链）。 */
  assetVersionTarget: string | null;
  /** `assetVersionTarget` 那条血统的完整版本链（新版在前，服务端定序）。 */
  assetVersionChain: ProjectAssetVersionChain | null;
  assetVersionChainLoading: boolean;
  assetVersionChainError: ProjectCollabNotice | null;
  assetVersionChainRequestId: number;

  /** 操作回执（保存成功 / 409 已刷新 / 下载落点等），详情页统一展示、可关闭。 */
  actionNotice: ProjectCollabNotice | null;

  /**
   * 项目约定 · AI 录入规则（CTX-01）。null = 尚未加载 / 加载失败（此时右栏出诚实空态）。
   * 与 `detail.instructionsText`（项目说明）是**两份内容**——⛔ 不合成一格。
   */
  conventions: ProjectConventions | null;

  /**
   * 全屏编辑的**草稿暂存**（CTX-01「保留草稿」）：按字段各存一份，null = 无草稿（编辑器
   * 用服务端当前值起笔）。取消/409/保存失败/打开帮助/离开确认都**不清它**——只有保存成功
   * 或换项目（`clearProjectScopedState`）才清。两字段分开＝两条独立草稿，互不覆写。
   */
  agreementDraft: { instructions: string | null; aiRules: string | null };
}

/**
 * 各域动作共用的宿主切片：纪元守（作废迟到结果）+ 操作回执。
 * 域文件把它与自己那几格状态交起来声明，谁碰了什么一眼可数。
 */
export type ProjectDomainHost = Pick<ProjectCollabState, 'projectEpoch' | 'actionNotice'>;

export const EMPTY_REQUIREMENT_PLACEMENTS: RequirementPlacementsState = {
  items: [],
  total: 0,
  loaded: false,
  loading: false,
  error: null,
  requestId: 0,
};

export function emptyArchivedPlanningList<Row>(): ArchivedPlanningList<Row> {
  return { items: [], total: 0, loaded: false, loading: false, error: null, requestId: 0 };
}

export function createProjectCollabState(): ProjectCollabState {
  return {
    availability: null,
    connection: null,
    eventsListening: false,
    eventTeardown: null,
    accountEpoch: 0,
    mySubject: null,
    projects: [],
    projectsLoading: false,
    projectsError: null,
    includeArchivedProjects: false,
    activeProjectId: null,
    projectEpoch: 0,
    detail: null,
    detailLoading: false,
    detailError: null,
    feedEntries: [],
    feedLoading: false,
    feedError: null,
    feedHasMore: false,
    chatMessages: [],
    chatLoading: false,
    chatError: null,
    chatHasMore: false,
    chatUnreadFromSeq: null,
    todos: [],
    todosLoading: false,
    todosError: null,
    todoChangedRevision: 0,
    requirementItems: [],
    requirementTotal: 0,
    requirementPage: 1,
    requirementPageSize: REQUIREMENT_PAGE_DEFAULT_SIZE,
    requirementQueryRevision: null,
    requirementPageActive: false,
    requirementPageLoading: false,
    requirementPageError: null,
    requirementFilters: {},
    requirementPageRequestId: 0,
    requirementSubtrees: {},
    requirementSubtreeRequestIds: {},
    requirementSubtreeStates: {},
    requirementRounds: {},
    projectTestRounds: null,
    testRoundActions: {},
    testExecutions: {},
    testDefects: {},
    testDefectDetails: {},
    testRoundView: null,
    roundTestCases: {},
    requirementCaseCounts: {},
    planWindowQuery: null,
    planWindowItems: [],
    planWindowLoading: false,
    planWindowError: null,
    planWindowTruncated: false,
    planWindowRequestId: 0,
    milestones: [],
    milestonesTotal: 0,
    milestonesPage: 1,
    milestonesLoaded: false,
    milestonesLoading: false,
    milestonesError: null,
    milestonesRequestId: 0,
    milestonesPlanWindow: null,
    expandedMilestoneId: null,
    milestoneIterations: {},
    milestoneIterationsLoading: {},
    milestoneIterationsError: {},
    milestoneIterationsRequestIds: {},
    iterationViews: {},
    iterationActionNotice: null,
    iterationScheduleDrafts: {},
    iterationScheduleNotices: {},
    iterationScheduleSaving: {},
    iterationScheduleRequests: {},
    planningLifecycleDraft: null,
    planningLifecycleSubmitting: false,
    planningLifecycleNotice: null,
    planningDetail: null,
    planningStageRecords: {},
    milestoneForm: null,
    iterationForm: null,
    requirementScheduleDialog: null,
    requirementPlacements: EMPTY_REQUIREMENT_PLACEMENTS,
    unscheduledRequirementTotal: null,
    archivedMilestones: emptyArchivedPlanningList(),
    archivedIterations: {},
    requirementPlacementLookups: {},
    planningPageNotice: null,
    draftBatches: [],
    draftsLoading: false,
    draftsRequestId: 0,
    draftsError: null,
    openInvitations: [],
    openInvitationsLoading: false,
    openInvitationsRequestId: 0,
    openInvitationsError: null,
    files: [],
    filesLoading: false,
    filesError: null,
    fileActionBusy: false,
    fileUpload: null,
    fileUploadOperationId: null,
    assets: [],
    assetsLoaded: false,
    assetsLoading: false,
    assetsError: null,
    assetsRequestId: 0,
    assetTrash: [],
    assetTrashLoaded: false,
    assetTrashLoading: false,
    assetTrashError: null,
    assetTrashRequestId: 0,
    assetVersionTarget: null,
    assetVersionChain: null,
    assetVersionChainLoading: false,
    assetVersionChainError: null,
    assetVersionChainRequestId: 0,
    actionNotice: null,
    conventions: null,
    agreementDraft: { instructions: null, aiRules: null },
  };
}
