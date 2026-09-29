import { projectApi } from '../../../../src/ui/runtime';
import type {
  ProjectTestRoundActionRequest,
  ProjectTestRoundActionResult,
  ProjectTestRoundActionsRequest,
  ProjectTestRoundActionsResult,
  ProjectTestRoundsRequest,
  ProjectTestRoundsResult,
} from '@shared/protocol/project-testing.js';
import type {
  ProjectTestCaseExecuteRequest,
  ProjectTestCaseExecuteResult,
  ProjectTestExecutionsRequest,
  ProjectTestExecutionsResult,
} from '@shared/protocol/project-testing-cases.js';
import type {
  ProjectTestDefectActionRequest,
  ProjectTestDefectActionResult,
  ProjectTestDefectsRequest,
  ProjectTestDefectsResult,
  ProjectTestDefectDetailRequest,
  ProjectTestDefectDetailResult,
} from '@shared/protocol/project-testing-defects.js';
import type {
  ProjectChatHistoryRequest,
  ProjectChatHistoryResult,
  ProjectChatRevokeRequest,
  ProjectChatRevokeResult,
  ProjectChatSendRequest,
  ProjectChatSendResult,
  ProjectCollabAvailability,
  ProjectCommentPostRequest,
  ProjectCommentPostResult,
  ProjectConventionsRequest,
  ProjectConventionsResult,
  ProjectConventionsUpdateRequest,
  ProjectConventionsUpdateResult,
  ProjectCreateRequest,
  ProjectCreateResult,
  ProjectDetailRequest,
  ProjectDetailResult,
  ProjectEvent,
  ProjectFeedListRequest,
  ProjectFeedListResult,
  ProjectFeedPostRequest,
  ProjectFeedPostResult,
  ProjectFileDeleteRequest,
  ProjectFileDeleteResult,
  ProjectFileDownloadRequest,
  ProjectFileDownloadResult,
  ProjectFileListRequest,
  ProjectFileListResult,
  ProjectFilePromoteRequest,
  ProjectFilePromoteResult,
  ProjectFileUploadRequest,
  ProjectFileUploadResult,
  ProjectFileUploadProgress,
  ProjectArchiveRequest,
  ProjectInvitationRevokeRequest,
  ProjectInvitationRevokeResult,
  ProjectInviteRequest,
  ProjectInviteResult,
  ProjectJoinLinkEvent,
  ProjectListRequest,
  ProjectListResult,
  ProjectMemberAdminResult,
  ProjectMemberRemoveRequest,
  ProjectMemberUpdateRequest,
  ProjectOpenInvitationListRequest,
  ProjectOpenInvitationListResult,
  ProjectReadCursorRequest,
  ProjectReadCursorResult,
  ProjectRedeemInvitationRequest,
  ProjectRedeemInvitationResult,
  ProjectTodoAcceptanceSetRequest,
  ProjectTodoAcceptanceSetResult,
  ProjectTodoCreateRequest,
  ProjectTodoCreateResult,
  ProjectTodoDeleteRequest,
  ProjectTodoDeleteResult,
  ProjectTodoDetailRequest,
  ProjectTodoDetailResult,
  ProjectTodoDraftDropRequest,
  ProjectTodoDraftDropResult,
  ProjectTodoDraftListRequest,
  ProjectTodoDraftListResult,
  ProjectTodoDraftResolveRequest,
  ProjectTodoDraftResolveResult,
  ProjectTodoListRequest,
  ProjectTodoListResult,
  ProjectRequirementPageRequest,
  ProjectRequirementPageResult,
  ProjectTodoReviewRequest,
  ProjectTodoReviewResult,
  ProjectTodoSubmitReviewRequest,
  ProjectTodoSubmitReviewResult,
  ProjectTodoUpdateRequest,
  ProjectTodoUpdateResult,
  ProjectRequirementClaimRequest,
  ProjectRequirementClaimResult,
  ProjectTransferOwnershipRequest,
  ProjectUpdateRequest,
  ProjectUpdateResult,
} from '@shared/protocol/project-collab.js';
import type {
  ProjectTestModeRequest,
  ProjectTestModeResult,
  ServiceCapabilitiesRequest,
  ServiceCapabilitiesResult,
} from '@shared/protocol/project-collab-capabilities.js';
import type {
  ProjectIterationCreateRequest,
  ProjectIterationCreateResult,
  ProjectIterationListRequest,
  ProjectIterationListResult,
  ProjectIterationUpdateRequest,
  ProjectIterationUpdateResult,
  ProjectMilestoneCreateRequest,
  ProjectMilestoneCreateResult,
  ProjectMilestoneListRequest,
  ProjectMilestoneListResult,
  ProjectIterationRequirementLinkRequest,
  ProjectIterationRequirementLinkResult,
  ProjectIterationRequirementListRequest,
  ProjectIterationRequirementListResult,
  ProjectIterationRequirementUnlinkRequest,
  ProjectIterationRequirementUnlinkResult,
  ProjectMilestoneUpdateRequest,
  ProjectMilestoneUpdateResult,
} from '@shared/protocol/project-planning.js';
import type {
  ProjectPlanningDraftDiscardRequest,
  ProjectPlanningDraftDiscardResult,
  ProjectPlanningDraftListRequest,
  ProjectPlanningDraftListResult,
} from '@shared/protocol/project-planning-draft.js';
import type {
  ProjectEvidenceLinkOpenRequest,
  ProjectEvidenceLinkOpenResult,
  ProjectIterationLifecycleEventListRequest,
  ProjectIterationLifecycleEventListResult,
  ProjectIterationLifecycleRequest,
  ProjectIterationLifecycleResult,
  ProjectMilestoneLifecycleEventListRequest,
  ProjectMilestoneLifecycleEventListResult,
  ProjectMilestoneLifecycleRequest,
  ProjectMilestoneLifecycleResult,
} from '@shared/protocol/project-planning-lifecycle.js';
import type {
  ProjectIterationScheduleSaveRequest,
  ProjectIterationScheduleSaveResult,
  ProjectRequirementPlacementListRequest,
  ProjectRequirementPlacementListResult,
  ProjectRequirementScheduleSaveRequest,
  ProjectRequirementScheduleSaveResult,
} from '@shared/protocol/project-planning-schedule.js';
import type {
  ProjectRequirementSubmissionsRequest,
  ProjectRequirementSubmissionsResult,
  ProjectRequirementSubmitRequest,
  ProjectRequirementSubmitResult,
  ProjectSubmissionDetailRequest,
  ProjectSubmissionDetailResult,
} from '@shared/protocol/project-testing.js';
import type {
  ProjectRequirementTestCaseCountsRequest,
  ProjectRequirementTestCaseCountsResult,
  ProjectRoundTestCaseCreateRequest,
  ProjectRoundTestCaseCreateResult,
  ProjectRoundTestCasesCopyRequest,
  ProjectRoundTestCasesCopyResult,
  ProjectRoundTestCasesRequest,
  ProjectRoundTestCasesResult,
  ProjectTestCaseUpdateRequest,
  ProjectTestCaseUpdateResult,
} from '@shared/protocol/project-testing-cases.js';
import type {
  ProjectAssetDeleteRequest,
  ProjectAssetDeleteResult,
  ProjectAssetListRequest,
  ProjectAssetListResult,
  ProjectAssetRestoreRequest,
  ProjectAssetRestoreResult,
  ProjectAssetTrashListRequest,
  ProjectAssetTrashListResult,
  ProjectAssetUploadAttemptDiscardRequest,
  ProjectAssetUploadAttemptDiscardResult,
  ProjectAssetVersionChainRequest,
  ProjectAssetVersionChainResult,
  ProjectAssetVersionPreviewRequest,
  ProjectAssetVersionPreviewResult,
  ProjectAssetVersionRegisterRequest,
  ProjectAssetVersionRegisterResult,
  ProjectAssetVersionResolveRequest,
  ProjectAssetVersionResolveResult,
  ProjectAssetVersionRestoreRequest,
  ProjectAssetVersionRestoreResult,
  ProjectAssetVersionUploadRequest,
  ProjectAssetVersionUploadResult,
  ProjectAssetVersionUploadResumeRequest,
} from '@shared/protocol/project-collab-assets.js';

/**
 * renderer 消费项目组多人协作能力（`project:*`）的唯一入口。
 *
 * 校验发生在 preload 桥两侧（入参收敛、出参 zod 校验），此处只做薄转发——
 * 与 `feedback.ts` 同口径，不在渲染层重复一遍协议校验。
 * 【红线】账号一律由 Main 从会话态推导，请求里没有账号字段；
 * 渲染层不碰服务地址与令牌，也从不读文件字节。
 */
export const projectCollabApi = {
  /** 能力探测：构建渠道 / 装配状态决定，false ⇒ 整个模块无入口。 */
  availability(): Promise<ProjectCollabAvailability> {
    return projectApi().readProjectCollabAvailability();
  },
  list(request: ProjectListRequest = {}): Promise<ProjectListResult> {
    return projectApi().listProjects(request);
  },
  create(request: ProjectCreateRequest): Promise<ProjectCreateResult> {
    return projectApi().createProject(request);
  },
  detail(request: ProjectDetailRequest): Promise<ProjectDetailResult> {
    return projectApi().readProjectDetail(request);
  },
  update(request: ProjectUpdateRequest): Promise<ProjectUpdateResult> {
    return projectApi().updateProject(request);
  },
  /** 读取项目约定（AI 录入规则）。 */
  readConventions(request: ProjectConventionsRequest): Promise<ProjectConventionsResult> {
    return projectApi().readProjectConventions(request);
  },
  /** 发布新一版 AI 录入规则（manager+；冲突 409）。与 `update`（改说明）是两条保存路径。 */
  updateConventions(
    request: ProjectConventionsUpdateRequest,
  ): Promise<ProjectConventionsUpdateResult> {
    return projectApi().updateProjectConventions(request);
  },
  invite(request: ProjectInviteRequest): Promise<ProjectInviteResult> {
    return projectApi().createProjectInvitation(request);
  },
  redeemInvitation(
    request: ProjectRedeemInvitationRequest,
  ): Promise<ProjectRedeemInvitationResult> {
    return projectApi().redeemProjectInvitation(request);
  },
  /** 列出本项目进行中的开放邀请（manager+）；结果**不含 code**（库里也没有）。 */
  listOpenInvitations(
    request: ProjectOpenInvitationListRequest,
  ): Promise<ProjectOpenInvitationListResult> {
    return projectApi().listProjectOpenInvitations(request);
  },
  /** 提前关闭一条邀请（manager+，同项目；幂等，只影响其后的兑换）。 */
  revokeInvitation(
    request: ProjectInvitationRevokeRequest,
  ): Promise<ProjectInvitationRevokeResult> {
    return projectApi().revokeProjectInvitation(request);
  },
  /**
   * 深链订阅：主进程从 `stratex://project/join?code=…` 解析出邀请码后定向推给主窗，
   * 供加入表单**预填**（⛔ 主进程不自动兑换）。返回退订函数。
   * code 明文只活在事件回调与加入表单的局部态，⛔ 不进 store / 日志 / 埋点。
   */
  onJoinLink(listener: (event: ProjectJoinLinkEvent) => void): () => void {
    return projectApi().onProjectJoinLink(listener);
  },
  /**
   * 成员管理四条（owner-only）。渲染层按 `myRole` 收窄入口只是不给点了必错的
   * 按钮——真正的门在服务端（按令牌强判并落审计）。四条同形回权威项目详情。
   */
  memberUpdate(request: ProjectMemberUpdateRequest): Promise<ProjectMemberAdminResult> {
    return projectApi().updateProjectMemberRole(request);
  },
  memberRemove(request: ProjectMemberRemoveRequest): Promise<ProjectMemberAdminResult> {
    return projectApi().removeProjectMember(request);
  },
  transferOwnership(request: ProjectTransferOwnershipRequest): Promise<ProjectMemberAdminResult> {
    return projectApi().transferProjectOwnership(request);
  },
  setArchived(request: ProjectArchiveRequest): Promise<ProjectMemberAdminResult> {
    return projectApi().setProjectArchived(request);
  },
  feedList(request: ProjectFeedListRequest): Promise<ProjectFeedListResult> {
    return projectApi().listProjectFeed(request);
  },
  feedPost(request: ProjectFeedPostRequest): Promise<ProjectFeedPostResult> {
    return projectApi().postProjectFeedEntry(request);
  },
  commentPost(request: ProjectCommentPostRequest): Promise<ProjectCommentPostResult> {
    return projectApi().postProjectFeedComment(request);
  },
  chatHistory(request: ProjectChatHistoryRequest): Promise<ProjectChatHistoryResult> {
    return projectApi().readProjectChatHistory(request);
  },
  chatSend(request: ProjectChatSendRequest): Promise<ProjectChatSendResult> {
    return projectApi().sendProjectChatMessage(request);
  },
  chatRevoke(request: ProjectChatRevokeRequest): Promise<ProjectChatRevokeResult> {
    return projectApi().revokeProjectChatMessage(request);
  },
  readCursor(request: ProjectReadCursorRequest): Promise<ProjectReadCursorResult> {
    return projectApi().setProjectReadCursor(request);
  },
  /**
   * 规划域（业务目标 / 多轮迭代）六条。薄转发——⛔ 这里**不做**字段名映射：
   * snake_case ↔ camelCase 的投影只在 Main 的 `collabPlanningWireMapping` 一处。
   *
   * ⭐ 写请求的 `clientRequestId` 由调用方生成，并在**重试时保持不变**——它是服务端
   * 幂等的键。换一个新编号重试等于把幂等关掉，会落出第二行。
   * ⚠️ `groupCounts` 是去重集合的势，⛔ 三个数相加不等于 `total`（同一轮会同时进两组）。
   */
  milestoneList(request: ProjectMilestoneListRequest): Promise<ProjectMilestoneListResult> {
    return projectApi().listProjectMilestones(request);
  },
  milestoneCreate(request: ProjectMilestoneCreateRequest): Promise<ProjectMilestoneCreateResult> {
    return projectApi().createProjectMilestone(request);
  },
  /** 含归档与恢复（`archived` 布尔）；409 时结果带 `currentVersion`。 */
  milestoneUpdate(request: ProjectMilestoneUpdateRequest): Promise<ProjectMilestoneUpdateResult> {
    return projectApi().updateProjectMilestone(request);
  },
  iterationList(request: ProjectIterationListRequest): Promise<ProjectIterationListResult> {
    return projectApi().listProjectIterations(request);
  },
  iterationCreate(request: ProjectIterationCreateRequest): Promise<ProjectIterationCreateResult> {
    return projectApi().createProjectIteration(request);
  },
  /** ⛔ 请求里没有 `milestoneId`——首期不支持跨目标移动（服务端也拒）。 */
  iterationUpdate(request: ProjectIterationUpdateRequest): Promise<ProjectIterationUpdateResult> {
    return projectApi().updateProjectIteration(request);
  },
  /** 项目助理规划草案（mil-11）：取本会话待审阅草案。⛔ 确认新建走 `milestoneCreate` / `iterationCreate`。 */
  planningDraftList(
    request: ProjectPlanningDraftListRequest,
  ): Promise<ProjectPlanningDraftListResult> {
    return projectApi().listProjectPlanningDrafts(request);
  },
  /** 清除一份规划草案：确认新建成功之后报 `confirmed`，用户忽略报 `dismissed`。 */
  planningDraftDiscard(
    request: ProjectPlanningDraftDiscardRequest,
  ): Promise<ProjectPlanningDraftDiscardResult> {
    return projectApi().discardProjectPlanningDraft(request);
  },
  /**
   * 迭代 ↔ 需求的关联历史三条。薄转发——⛔ 这里**不做**字段名映射：
   * snake_case ↔ camelCase 的投影只在 Main 的 `collabPlanningWireMapping` 一处。
   *
   * ⭐ 排期只有这两条写路径（关联 / 移出）。需求那一侧的 `iterationId` / `iteration`
   *    是服务端从当前关联行**派生**的只读投影，⛔ `todoUpdate` 里没有、也不会有它。
   * ⭐ 写请求的 `clientRequestId` 由调用方生成并在**重试时保持不变**（服务端幂等的键）。
   * ⚠️ 成功出参里 `changed=false` **不是失败**：幂等命中、「本来就排在这一轮」、
   *    「本来就已经不在这一轮」三种都是它。⛔ 别据此重试或报错。
   * ⚠️ `previousIterationId` 非空 ⇒ 切排期，**另一轮的关联摘要也变了**，一起刷。
   * ⚠️ 两个 `expected*Version` 是闸而不是会被推进的计数：成功之后它们**都不变**
   *    （排期不改需求本身、也不改轮次的任何字段）。⛔ 别据此判断「没生效」。
   */
  iterationRequirementList(
    request: ProjectIterationRequirementListRequest,
  ): Promise<ProjectIterationRequirementListResult> {
    return projectApi().listProjectIterationRequirements(request);
  },
  iterationRequirementLink(
    request: ProjectIterationRequirementLinkRequest,
  ): Promise<ProjectIterationRequirementLinkResult> {
    return projectApi().linkProjectIterationRequirement(request);
  },
  /** ⛔ 这**不是删除**：关联行留着（`link.state === 'closed'`），历史照旧读得到。 */
  iterationRequirementUnlink(
    request: ProjectIterationRequirementUnlinkRequest,
  ): Promise<ProjectIterationRequirementUnlinkResult> {
    return projectApi().unlinkProjectIterationRequirement(request);
  },
  /**
   * 迭代排期整批保存（MIL-06）。薄转发——⛔ 不做字段名映射、不拆成逐条改单。
   * ⚠️ `clientRequestId` 在**同一份草案**的重试里保持不变；草案一变就换新编号。
   */
  iterationScheduleSave(
    request: ProjectIterationScheduleSaveRequest,
  ): Promise<ProjectIterationScheduleSaveResult> {
    return projectApi().saveProjectIterationSchedule(request);
  },
  /**
   * 安排需求整批保存（MIL-09）。薄转发——⛔ 不做字段名映射、不拆成逐条关联 / 移出。
   * ⚠️ `clientRequestId` 在**同一份安排**的重试里保持不变；安排一变就换新编号。
   */
  requirementScheduleSave(
    request: ProjectRequirementScheduleSaveRequest,
  ): Promise<ProjectRequirementScheduleSaveResult> {
    return projectApi().saveProjectRequirementSchedule(request);
  },
  /** 需求排期现状（MIL-09）。薄转发——⛔ 不做字段名映射；未排条数取 `unscheduledTotal`，不自算。 */
  requirementPlacementList(
    request: ProjectRequirementPlacementListRequest,
  ): Promise<ProjectRequirementPlacementListResult> {
    return projectApi().listProjectRequirementPlacements(request);
  },
  /**
   * 规划域生命周期六条（MIL-07）：记录达成 / 重新打开 / 阶段记录。薄转发——⛔ 不做字段名映射，
   * 也不判必填（完成要说明 + 证据、重开要原因都在服务端，缺则 422）。
   *
   * ⭐ `clientRequestId` 在同一次提交的重试里**保持不变**；内容改过再提交换新号
   *    （同号异内容服务端回 conflict + `idempotency_conflict`）。
   * ⛔ 说明 / 证据 / 原因只经两条阶段记录读回：事件面（`onEvent`）的负载里没有正文。
   */
  milestoneComplete(
    request: ProjectMilestoneLifecycleRequest,
  ): Promise<ProjectMilestoneLifecycleResult> {
    return projectApi().completeProjectMilestone(request);
  },
  milestoneReopen(
    request: ProjectMilestoneLifecycleRequest,
  ): Promise<ProjectMilestoneLifecycleResult> {
    return projectApi().reopenProjectMilestone(request);
  },
  iterationComplete(
    request: ProjectIterationLifecycleRequest,
  ): Promise<ProjectIterationLifecycleResult> {
    return projectApi().completeProjectIteration(request);
  },
  iterationReopen(
    request: ProjectIterationLifecycleRequest,
  ): Promise<ProjectIterationLifecycleResult> {
    return projectApi().reopenProjectIteration(request);
  },
  /** 阶段记录（按发生时刻升序；已归档的目标 / 轮次照样读得到）。 */
  milestoneEventList(
    request: ProjectMilestoneLifecycleEventListRequest,
  ): Promise<ProjectMilestoneLifecycleEventListResult> {
    return projectApi().listProjectMilestoneEvents(request);
  },
  iterationEventList(
    request: ProjectIterationLifecycleEventListRequest,
  ): Promise<ProjectIterationLifecycleEventListResult> {
    return projectApi().listProjectIterationEvents(request);
  },
  /** 打开证据引用里的外部链接（ADR-0036）：交主进程二次校验后给系统浏览器，⛔ 渲染层不自己导航。 */
  evidenceLinkOpen(
    request: ProjectEvidenceLinkOpenRequest,
  ): Promise<ProjectEvidenceLinkOpenResult> {
    return projectApi().openProjectEvidenceLink(request);
  },
  /**
   * 服务能力协商（CORE-05）：客户端据此判断新增写字段能不能发；对面不支持则渲染层
   * 显示升级提示、且主进程写门会拦下 module_id/category_id。⛔ 薄转发。
   */
  serviceCapabilities(
    request: ServiceCapabilitiesRequest = {},
  ): Promise<ServiceCapabilitiesResult> {
    return projectApi().readProjectServiceCapabilities(request);
  },
  /** 新旧测试模式迁移就绪判定（CORE-05）：未结旧 inReview 阻止切新模式，不虚构历史轮次。 */
  testMode(request: ProjectTestModeRequest): Promise<ProjectTestModeResult> {
    return projectApi().readProjectTestMode(request);
  },
  todoList(request: ProjectTodoListRequest): Promise<ProjectTodoListResult> {
    return projectApi().listProjectTodos(request);
  },
  /** 需求页码查询（CORE-07）：过滤+分页；与 todoList 游标端点并存。 */
  requirementPage(request: ProjectRequirementPageRequest): Promise<ProjectRequirementPageResult> {
    return projectApi().listProjectRequirementPage(request);
  },
  todoCreate(request: ProjectTodoCreateRequest): Promise<ProjectTodoCreateResult> {
    return projectApi().createProjectTodo(request);
  },
  /**
   * 改单（乐观锁）。归类两列（`moduleId` / `categoryId`）**三态要分清**：
   *  - 不传该键 ＝ 不改；
   *  - 传 `null`  ＝ 清空（回到「未分类」）；
   *  - 传 uuid    ＝ 改成那条字典条目。
   *
   * ⛔ 调用方别拿 `moduleId: value || null` 之类的写法凑数：那会把「不改」变成
   *    「清空」，表现是「顺手改了个标题，归类没了」。要「不改」就**别放这个键**。
   * ⛔ 请求里也没有 `iterationId`——在需求上直接排期本期不支持（契约是 strictObject，
   *    服务端另有 422 `iteration_write_unsupported`）。
   */
  todoUpdate(request: ProjectTodoUpdateRequest): Promise<ProjectTodoUpdateResult> {
    return projectApi().updateProjectTodo(request);
  },
  /**
   * 认领无主需求并写计划日期（FLOW-02）。与 `todoUpdate` 分开：认领只对无主生效，
   * 已被他人认领回 `conflict`（serverCode `requirement_already_claimed`）——调用方据此
   * 保留真实失败提示，⛔ 不伪成功。`startAt`/`dueAt` 缺省即写空。
   */
  requirementClaim(
    request: ProjectRequirementClaimRequest,
  ): Promise<ProjectRequirementClaimResult> {
    return projectApi().claimProjectRequirement(request);
  },
  /** 轮次撤回、结论与负责人改派；保留幂等键及期望版本。 */
  testRoundAction(request: ProjectTestRoundActionRequest): Promise<ProjectTestRoundActionResult> {
    return projectApi().actOnProjectTestRound(request);
  },
  /** 读取服务端签署的轮次动作历史。 */
  testRoundActions(
    request: ProjectTestRoundActionsRequest,
  ): Promise<ProjectTestRoundActionsResult> {
    return projectApi().listProjectTestRoundActions(request);
  },
  /** 按项目与状态分页读取测试轮次。 */
  testRounds(request: ProjectTestRoundsRequest): Promise<ProjectTestRoundsResult> {
    return projectApi().listProjectTestRounds(request);
  },
  /** 签署用例执行结果，身份与时间由服务端确定。 */
  testCaseExecute(request: ProjectTestCaseExecuteRequest): Promise<ProjectTestCaseExecuteResult> {
    return projectApi().executeProjectTestCase(request);
  },
  /** 分页读取用例执行历史。 */
  testExecutions(request: ProjectTestExecutionsRequest): Promise<ProjectTestExecutionsResult> {
    return projectApi().listProjectTestExecutions(request);
  },
  /** 登记、分派、修复与复测缺陷；冲突版本原样返回。 */
  testDefectAction(
    request: ProjectTestDefectActionRequest,
  ): Promise<ProjectTestDefectActionResult> {
    return projectApi().actOnProjectTestDefect(request);
  },
  /** 分页读取轮次缺陷。 */
  testDefects(request: ProjectTestDefectsRequest): Promise<ProjectTestDefectsResult> {
    return projectApi().listProjectTestDefects(request);
  },
  /** 读取缺陷详情与追加历史。 */
  testDefectDetail(
    request: ProjectTestDefectDetailRequest,
  ): Promise<ProjectTestDefectDetailResult> {
    return projectApi().readProjectTestDefect(request);
  },
  /** 测试轮次的用例（TST-04）：一轮的用例（按序号，游标分页）。⛔ 薄转发。 */
  roundTestCases(request: ProjectRoundTestCasesRequest): Promise<ProjectRoundTestCasesResult> {
    return projectApi().listProjectRoundTestCases(request);
  },
  /**
   * 本轮测试负责人新建一条用例。⭐ `clientRequestId` 由调用方生成，同一次打开弹层内的重试**沿用同一个号**。
   */
  roundTestCaseCreate(
    request: ProjectRoundTestCaseCreateRequest,
  ): Promise<ProjectRoundTestCaseCreateResult> {
    return projectApi().createProjectRoundTestCase(request);
  },
  /** 编辑一条用例（四项整表保存 + 期望版本）。 */
  testCaseUpdate(request: ProjectTestCaseUpdateRequest): Promise<ProjectTestCaseUpdateResult> {
    return projectApi().updateProjectTestCase(request);
  },
  /** 复用上轮用例。 */
  roundTestCasesCopy(
    request: ProjectRoundTestCasesCopyRequest,
  ): Promise<ProjectRoundTestCasesCopyResult> {
    return projectApi().copyProjectRoundTestCases(request);
  },
  /** 一条需求各轮的用例条数。 */
  requirementTestCaseCounts(
    request: ProjectRequirementTestCaseCountsRequest,
  ): Promise<ProjectRequirementTestCaseCountsResult> {
    return projectApi().listProjectRequirementTestCaseCounts(request);
  },
  /**
   * 整需求提测（TST-02）：需求处理人把整条需求提交一轮测试。⛔ 薄转发。
   * ⭐ `clientRequestId` 由调用方生成，同一次打开弹窗内的重试**沿用同一个号**（换号＝关掉幂等）。
   * ⚠️ 数组入参由调用方先展开成普通数组：桥拒收响应式 Proxy（主进程零记录、界面报「暂时不可用」）。
   */
  requirementSubmit(
    request: ProjectRequirementSubmitRequest,
  ): Promise<ProjectRequirementSubmitResult> {
    return projectApi().submitProjectRequirementForTest(request);
  },
  /** 一条需求的测试轮次（最新在前，游标分页）。 */
  requirementSubmissions(
    request: ProjectRequirementSubmissionsRequest,
  ): Promise<ProjectRequirementSubmissionsResult> {
    return projectApi().listProjectRequirementSubmissions(request);
  },
  /** 单轮详情：轮次 + 五面快照。 */
  submissionDetail(
    request: ProjectSubmissionDetailRequest,
  ): Promise<ProjectSubmissionDetailResult> {
    return projectApi().readProjectSubmission(request);
  },
  /**
   * 软删一条或多条需求/任务及其**整棵子树**（manager+，服务端强判）。单条＝`ids`
   * 只含一个根；多条走批量。主进程按根数选端点，两端 `code`/`serverCode` 一致但
   * 失败语义不对称（见协议 `ProjectTodoDeleteResultSchema` 注释）——分流在 store。
   */
  todoDelete(request: ProjectTodoDeleteRequest): Promise<ProjectTodoDeleteResult> {
    return projectApi().deleteProjectTodos(request);
  },
  /**
   * 工作单四条。列表通道只回验收**计数**，逐条判据与完成记录时间线只在 detail 里给。
   *
   * ⚠️ 「推到待验收」与「通过/打回」各有专用通道，**不是**普通改单的两个状态值：
   * 进待验收必须同时交完成记录，通过必须清单全勾、打回必须带理由——这些判定在
   * 服务端，客户端这一侧只负责不摆一个点了必错的入口。
   */
  todoDetail(request: ProjectTodoDetailRequest): Promise<ProjectTodoDetailResult> {
    return projectApi().readProjectTodoDetail(request);
  },
  todoAcceptanceSet(
    request: ProjectTodoAcceptanceSetRequest,
  ): Promise<ProjectTodoAcceptanceSetResult> {
    return projectApi().setProjectTodoAcceptanceItems(request);
  },
  todoSubmitReview(
    request: ProjectTodoSubmitReviewRequest,
  ): Promise<ProjectTodoSubmitReviewResult> {
    return projectApi().submitProjectTodoReview(request);
  },
  todoReview(request: ProjectTodoReviewRequest): Promise<ProjectTodoReviewResult> {
    return projectApi().reviewProjectTodo(request);
  },
  /**
   * 拆解草案闸三条（列出 / 逐条剔除 / 整批确认或丢弃）。
   *
   * ⚠️ 草案**不发事件**（事件面的定向投递一次只认一个收件人，宁可让可见的那两人
   * 主动拉也不广播半成品），所以这一域只能主动拉取，⛔ 别等推送。
   * ⛔ 这里没有「落一批草案」：产出草案是智能助手拆解那条线的事（W2 未做），
   * 客户端不摆一个自己造半成品的入口。
   */
  todoDraftList(request: ProjectTodoDraftListRequest): Promise<ProjectTodoDraftListResult> {
    return projectApi().listProjectTodoDrafts(request);
  },
  todoDraftDrop(request: ProjectTodoDraftDropRequest): Promise<ProjectTodoDraftDropResult> {
    return projectApi().dropProjectTodoDraft(request);
  },
  todoDraftResolve(
    request: ProjectTodoDraftResolveRequest,
  ): Promise<ProjectTodoDraftResolveResult> {
    return projectApi().resolveProjectTodoDrafts(request);
  },
  fileList(request: ProjectFileListRequest): Promise<ProjectFileListResult> {
    return projectApi().listProjectFiles(request);
  },
  /**
   * 上传：渲染层只递交 `{projectId, kind}`，文件由主进程弹系统选择框自行取得——
   * 路径与字节都不经过渲染层。结果三分支（完成 / 用户取消 / 失败）见协议注释。
   */
  fileUpload(request: ProjectFileUploadRequest): Promise<ProjectFileUploadResult> {
    return projectApi().uploadProjectFile(request);
  },
  fileUploadCancel(operationId: string) {
    return projectApi().cancelProjectFileUpload({ operationId });
  },
  onFileUploadProgress(listener: (progress: ProjectFileUploadProgress) => void): () => void {
    return projectApi().onProjectFileUploadProgress(listener);
  },
  fileDownload(request: ProjectFileDownloadRequest): Promise<ProjectFileDownloadResult> {
    return projectApi().downloadProjectFile(request);
  },
  filePromote(request: ProjectFilePromoteRequest): Promise<ProjectFilePromoteResult> {
    return projectApi().promoteProjectFile(request);
  },
  fileDelete(request: ProjectFileDeleteRequest): Promise<ProjectFileDeleteResult> {
    return projectApi().deleteProjectFile(request);
  },
  /**
   * 资产版本十三条（薄转发）。
   *
   * ⭐ 与上面七条 `file*` 的分工：文件是**字节**，资产是**版本链**。报告附件与测试轮次
   *    附件冻结下来的是**版本 id**，所以解析与预览都按版本 id 走。
   * ⛔ 没有「取不到就回落到当前版本」的开关——那等于把冻结取消掉，报告里的附件会在
   *    资产被传了新版之后显示成另一份材料。
   */
  assetList(request: ProjectAssetListRequest): Promise<ProjectAssetListResult> {
    return projectApi().listProjectAssets(request);
  },
  /** 完整版本链（新版在前）。血统已删时**照旧**返回全部版本 + `deletedAt` 明确反馈。 */
  assetVersionList(
    request: ProjectAssetVersionChainRequest,
  ): Promise<ProjectAssetVersionChainResult> {
    return projectApi().listProjectAssetVersions(request);
  },
  assetVersionResolve(
    request: ProjectAssetVersionResolveRequest,
  ): Promise<ProjectAssetVersionResolveResult> {
    return projectApi().resolveProjectAssetVersion(request);
  },
  /** 把一行既有上传登记成版本；`reused: true` ＝ 收敛到已有版本（⛔ 不是新落一笔）。 */
  assetVersionRegister(
    request: ProjectAssetVersionRegisterRequest,
  ): Promise<ProjectAssetVersionRegisterResult> {
    return projectApi().registerProjectAssetVersion(request);
  },
  assetDelete(request: ProjectAssetDeleteRequest): Promise<ProjectAssetDeleteResult> {
    return projectApi().deleteProjectAsset(request);
  },
  /**
   * 传一个新版本：渲染层只递交 `{projectId, operationId, assetId?}`——路径与字节都由
   * 主进程处理。进度走 `onFileUploadProgress`（同一条通道，按 `operationId` 对号）。
   *
   * ⭐ 失败体带 `resume`：非空 ＝ 还有断点可续，调用方**必须**用
   *    `assetVersionUploadResume(resume.operationId)` 续，⛔ 不要重新调 `assetVersionUpload`
   *    ——那会重新弹选择框、并在 `stage==='register'` 时把字节再传一遍（配额白付一份）。
   */
  assetVersionUpload(
    request: ProjectAssetVersionUploadRequest,
  ): Promise<ProjectAssetVersionUploadResult> {
    return projectApi().uploadProjectAssetVersion(request);
  },
  /** 取消在途上传：只在字节传输段有效（越过断点后无事可撤，结果照实报）。 */
  assetVersionUploadCancel(
    request: ProjectAssetUploadAttemptDiscardRequest,
  ): Promise<ProjectAssetUploadAttemptDiscardResult> {
    return projectApi().cancelProjectAssetVersionUpload(request);
  },
  assetVersionUploadResume(
    request: ProjectAssetVersionUploadResumeRequest,
  ): Promise<ProjectAssetVersionUploadResult> {
    return projectApi().resumeProjectAssetVersionUpload(request);
  },
  /** 放弃断点（只丢客户端记录；已上传的字节由用户在文件列表里显式删）。 */
  assetVersionUploadDiscard(
    request: ProjectAssetUploadAttemptDiscardRequest,
  ): Promise<ProjectAssetUploadAttemptDiscardResult> {
    return projectApi().discardProjectAssetVersionUpload(request);
  },
  /**
   * 预览一个冻结版本。成功侧恒有 `preview`，只有两态：
   *  · `kind:'text'`     文本层预览（带 `locatorCoverage` 页/块数与 `nextSelector` 续读）；
   *  · `kind:'fallback'` 明说理由的下载降级（文案取 `projectAssetPreviewFallbackText`）。
   * ⛔ 没有第三态，所以呈现层写不出「既没有正文也没有理由」的空白面板。
   */
  assetVersionPreview(
    request: ProjectAssetVersionPreviewRequest,
  ): Promise<ProjectAssetVersionPreviewResult> {
    return projectApi().previewProjectAssetVersion(request);
  },
  /**
   * 回收站与历史版本恢复三条（RPT-08，薄转发；契约见 ADR-0037）。
   *
   * ⭐ 回收站与目录**互补不重叠**（服务端同一句谓词的正反面）：恢复成功后两边都要按服务端
   *    重取，⛔ 别在渲染层把那一行从回收站「搬」进目录——那是第二份真相。
   * ⭐ 两条恢复的失败体带 `serverCode`（已在回收站 / 指纹不符 / 字节缺失…），文案取
   *    `projectAssetRecoveryErrorText`；历史版本恢复配额已满时另带 `quota`。
   * ⛔ 权限不在渲染层判：回收站恢复是本人或拥有者，历史版本恢复是可编辑成员——入口收窄
   *    只是不摆必错的按钮。
   */
  assetTrashList(request: ProjectAssetTrashListRequest): Promise<ProjectAssetTrashListResult> {
    return projectApi().listProjectAssetTrash(request);
  },
  assetRestore(request: ProjectAssetRestoreRequest): Promise<ProjectAssetRestoreResult> {
    return projectApi().restoreProjectAsset(request);
  },
  assetVersionRestore(
    request: ProjectAssetVersionRestoreRequest,
  ): Promise<ProjectAssetVersionRestoreResult> {
    return projectApi().restoreProjectAssetVersion(request);
  },
  /** 事件订阅（连接状态帧 + 域事件帧）；返回退订函数。 */
  onEvent(listener: (event: ProjectEvent) => void): () => void {
    return projectApi().onProjectEvent(listener);
  },
} as const;
