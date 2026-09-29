import {
  ProjectTestRoundActionRequestSchema,
  ProjectTestRoundActionResultSchema,
  ProjectTestRoundActionsRequestSchema,
  ProjectTestRoundActionsResultSchema,
  ProjectTestRoundsRequestSchema,
  ProjectTestRoundsResultSchema,
} from '../shared/protocol/project-testing.js';
import {
  ProjectTestCaseExecuteRequestSchema,
  ProjectTestCaseExecuteResultSchema,
  ProjectTestExecutionsRequestSchema,
  ProjectTestExecutionsResultSchema,
} from '../shared/protocol/project-testing-cases.js';
import {
  ProjectTestDefectActionRequestSchema,
  ProjectTestDefectActionResultSchema,
  ProjectTestDefectsRequestSchema,
  ProjectTestDefectsResultSchema,
  ProjectTestDefectDetailRequestSchema,
  ProjectTestDefectDetailResultSchema,
} from '../shared/protocol/project-testing-defects.js';
import type { ProjectApi } from '../shared/ipc/api.js';
import {
  ProjectWorkOverviewRequestSchema,
  ProjectWorkOverviewResultSchema,
} from '../shared/protocol/project-work-overview.js';
import {
  ProjectTodoCollaboratorsRequestSchema,
  ProjectTodoCollaboratorsResultSchema,
  ProjectTodoCollaboratorsReplaceRequestSchema,
  ProjectTodoCollaboratorsReplaceResultSchema,
  ProjectTodoCommentsRequestSchema,
  ProjectTodoCommentsResultSchema,
  ProjectTodoCommentCreateRequestSchema,
  ProjectTodoCommentCreateResultSchema,
  ProjectTodoDeletePreviewRequestSchema,
  ProjectTodoDeletePreviewResultSchema,
} from '../shared/protocol/project-todo-collaboration.js';
import {
  ProjectSubmissionGateRequestSchema,
  ProjectSubmissionGateUpdateRequestSchema,
  ProjectSubmissionGateResultSchema,
} from '../shared/protocol/project-submission-gate.js';
import { IPC } from '../shared/ipc/channels.js';
import {
  ProjectAvailabilityRequestSchema,
  ProjectChatHistoryRequestSchema,
  ProjectChatHistoryResultSchema,
  ProjectChatRevokeRequestSchema,
  ProjectChatRevokeResultSchema,
  ProjectChatSendRequestSchema,
  ProjectChatSendResultSchema,
  ProjectCollabAvailabilitySchema,
  ProjectCommentPostRequestSchema,
  ProjectCommentPostResultSchema,
  ProjectCreateRequestSchema,
  ProjectCreateResultSchema,
  ProjectDetailRequestSchema,
  ProjectDetailResultSchema,
  ProjectEventSchema,
  ProjectFeedListRequestSchema,
  ProjectFeedListResultSchema,
  ProjectFeedPostRequestSchema,
  ProjectFeedPostResultSchema,
  ProjectFileDeleteRequestSchema,
  ProjectFileDeleteResultSchema,
  ProjectFileDownloadRequestSchema,
  ProjectFileDownloadResultSchema,
  ProjectFileListRequestSchema,
  ProjectFileListResultSchema,
  ProjectFilePromoteRequestSchema,
  ProjectFilePromoteResultSchema,
  ProjectFileUploadRequestSchema,
  ProjectFileUploadResultSchema,
  ProjectFileUploadCancelRequestSchema,
  ProjectFileUploadCancelResultSchema,
  ProjectFileUploadProgressSchema,
  ProjectInviteRequestSchema,
  ProjectInviteResultSchema,
  ProjectJoinLinkEventSchema,
  ProjectArchiveRequestSchema,
  ProjectListRequestSchema,
  ProjectListResultSchema,
  ProjectMemberAdminResultSchema,
  ProjectMemberRemoveRequestSchema,
  ProjectMemberUpdateRequestSchema,
  ProjectOpenInvitationListRequestSchema,
  ProjectOpenInvitationListResultSchema,
  ProjectInvitationRevokeRequestSchema,
  ProjectInvitationRevokeResultSchema,
  ProjectReadCursorRequestSchema,
  ProjectReadCursorResultSchema,
  ProjectRedeemInvitationRequestSchema,
  ProjectRedeemInvitationResultSchema,
  ProjectTodoAcceptanceSetRequestSchema,
  ProjectTodoAcceptanceSetResultSchema,
  ProjectTodoCreateRequestSchema,
  ProjectTodoCreateResultSchema,
  ProjectTodoDeleteRequestSchema,
  ProjectTodoDeleteResultSchema,
  ProjectTodoDetailRequestSchema,
  ProjectTodoDetailResultSchema,
  ProjectTodoDraftCreateRequestSchema,
  ProjectTodoDraftCreateResultSchema,
  ProjectTodoDraftDropRequestSchema,
  ProjectTodoDraftDropResultSchema,
  ProjectTodoDraftListRequestSchema,
  ProjectTodoDraftListResultSchema,
  ProjectTodoDraftResolveRequestSchema,
  ProjectTodoDraftResolveResultSchema,
  ProjectTodoListRequestSchema,
  ProjectTodoListResultSchema,
  ProjectRequirementPageRequestSchema,
  ProjectRequirementPageResultSchema,
  ProjectTodoReviewRequestSchema,
  ProjectTodoReviewResultSchema,
  ProjectTodoSubmitReviewRequestSchema,
  ProjectTodoSubmitReviewResultSchema,
  ProjectTodoUpdateRequestSchema,
  ProjectTodoUpdateResultSchema,
  ProjectRequirementClaimRequestSchema,
  ProjectRequirementClaimResultSchema,
  ProjectTransferOwnershipRequestSchema,
  ProjectUpdateRequestSchema,
  ProjectUpdateResultSchema,
  ProjectConventionsRequestSchema,
  ProjectConventionsResultSchema,
  ProjectConventionsUpdateRequestSchema,
  ProjectConventionsUpdateResultSchema,
} from '../shared/protocol/project-collab.js';
import {
  ProjectTestModeRequestSchema,
  ProjectTestModeResultSchema,
  ServiceCapabilitiesRequestSchema,
  ServiceCapabilitiesResultSchema,
} from '../shared/protocol/project-collab-capabilities.js';
import {
  ProjectIterationCreateRequestSchema,
  ProjectIterationCreateResultSchema,
  ProjectIterationListRequestSchema,
  ProjectIterationListResultSchema,
  ProjectIterationRequirementLinkRequestSchema,
  ProjectIterationRequirementLinkResultSchema,
  ProjectIterationRequirementListRequestSchema,
  ProjectIterationRequirementListResultSchema,
  ProjectIterationRequirementUnlinkRequestSchema,
  ProjectIterationRequirementUnlinkResultSchema,
  ProjectIterationUpdateRequestSchema,
  ProjectIterationUpdateResultSchema,
  ProjectMilestoneCreateRequestSchema,
  ProjectMilestoneCreateResultSchema,
  ProjectMilestoneListRequestSchema,
  ProjectMilestoneListResultSchema,
  ProjectMilestoneUpdateRequestSchema,
  ProjectMilestoneUpdateResultSchema,
} from '../shared/protocol/project-planning.js';
import {
  ProjectPlanningDraftDiscardRequestSchema,
  ProjectPlanningDraftDiscardResultSchema,
  ProjectPlanningDraftListRequestSchema,
  ProjectPlanningDraftListResultSchema,
} from '../shared/protocol/project-planning-draft.js';
import {
  ProjectEvidenceLinkOpenRequestSchema,
  ProjectEvidenceLinkOpenResultSchema,
  ProjectIterationLifecycleEventListRequestSchema,
  ProjectIterationLifecycleEventListResultSchema,
  ProjectIterationLifecycleRequestSchema,
  ProjectIterationLifecycleResultSchema,
  ProjectMilestoneLifecycleEventListRequestSchema,
  ProjectMilestoneLifecycleEventListResultSchema,
  ProjectMilestoneLifecycleRequestSchema,
  ProjectMilestoneLifecycleResultSchema,
} from '../shared/protocol/project-planning-lifecycle.js';
import {
  ProjectIterationScheduleSaveRequestSchema,
  ProjectIterationScheduleSaveResultSchema,
  ProjectRequirementPlacementListRequestSchema,
  ProjectRequirementPlacementListResultSchema,
  ProjectRequirementScheduleSaveRequestSchema,
  ProjectRequirementScheduleSaveResultSchema,
} from '../shared/protocol/project-planning-schedule.js';
import {
  ProjectAssetDeleteRequestSchema,
  ProjectAssetDeleteResultSchema,
  ProjectAssetListRequestSchema,
  ProjectAssetListResultSchema,
  ProjectAssetRestoreRequestSchema,
  ProjectAssetRestoreResultSchema,
  ProjectAssetTrashListRequestSchema,
  ProjectAssetTrashListResultSchema,
  ProjectAssetUploadAttemptDiscardRequestSchema,
  ProjectAssetUploadAttemptDiscardResultSchema,
  ProjectAssetVersionChainRequestSchema,
  ProjectAssetVersionChainResultSchema,
  ProjectAssetVersionPreviewRequestSchema,
  ProjectAssetVersionPreviewResultSchema,
  ProjectAssetVersionRegisterRequestSchema,
  ProjectAssetVersionRegisterResultSchema,
  ProjectAssetVersionResolveRequestSchema,
  ProjectAssetVersionResolveResultSchema,
  ProjectAssetVersionRestoreRequestSchema,
  ProjectAssetVersionRestoreResultSchema,
  ProjectAssetVersionUploadRequestSchema,
  ProjectAssetVersionUploadResultSchema,
  ProjectAssetVersionUploadResumeRequestSchema,
} from '../shared/protocol/project-collab-assets.js';
import {
  ProjectNotificationNavigateSchema,
  ProjectNotificationSettingsSchema,
  ProjectNotificationSettingsUpdateSchema,
} from '../shared/protocol/project-notifications.js';
import {
  ProjectRequirementSubmissionsRequestSchema,
  ProjectRequirementSubmissionsResultSchema,
  ProjectRequirementSubmitRequestSchema,
  ProjectRequirementSubmitResultSchema,
  ProjectSubmissionDetailRequestSchema,
  ProjectSubmissionDetailResultSchema,
} from '../shared/protocol/project-testing.js';
import {
  ProjectRequirementTestCaseCountsRequestSchema,
  ProjectRequirementTestCaseCountsResultSchema,
  ProjectRoundTestCaseCreateRequestSchema,
  ProjectRoundTestCaseCreateResultSchema,
  ProjectRoundTestCasesCopyRequestSchema,
  ProjectRoundTestCasesCopyResultSchema,
  ProjectRoundTestCasesRequestSchema,
  ProjectRoundTestCasesResultSchema,
  ProjectTestCaseUpdateRequestSchema,
  ProjectTestCaseUpdateResultSchema,
} from '../shared/protocol/project-testing-cases.js';

/**
 * 项目组多人协作（`project:*`）的预加载桥。
 *
 * 纪律同全局：入参在此收敛、出参在此校验（边界两侧都不信任对方）。请求 schema 结构性
 * 挡住账号与会话正文——渲染层即便想塞也塞不进（strictObject 拒多余键）。
 * 文件上传只递交 `{projectId, kind}`（⛔ 路径与字节都不跨 IPC，Main 弹框自取路径）；
 * 事件订阅返回退订函数，载荷 safeParse 不过即丢弃（坏帧不进渲染层）。
 */

export type ProjectCollabApi = Pick<
  ProjectApi,
  | 'readProjectCollabAvailability'
  | 'listProjects'
  | 'createProject'
  | 'readProjectDetail'
  | 'updateProject'
  | 'readProjectConventions'
  | 'readProjectSubmissionGate'
  | 'updateProjectSubmissionGate'
  | 'updateProjectConventions'
  | 'createProjectInvitation'
  | 'redeemProjectInvitation'
  | 'listProjectOpenInvitations'
  | 'revokeProjectInvitation'
  | 'updateProjectMemberRole'
  | 'removeProjectMember'
  | 'transferProjectOwnership'
  | 'setProjectArchived'
  | 'listProjectFeed'
  | 'postProjectFeedEntry'
  | 'postProjectFeedComment'
  | 'readProjectChatHistory'
  | 'sendProjectChatMessage'
  | 'revokeProjectChatMessage'
  | 'setProjectReadCursor'
  // 规划域六条（业务目标 / 多轮迭代）。
  | 'listProjectMilestones'
  | 'createProjectMilestone'
  | 'updateProjectMilestone'
  | 'listProjectIterations'
  | 'createProjectIteration'
  | 'updateProjectIteration'
  // 项目助理规划草案两条（mil-11）。
  | 'listProjectPlanningDrafts'
  | 'discardProjectPlanningDraft'
  // 迭代 ↔ 需求的关联历史三条。
  | 'listProjectIterationRequirements'
  | 'linkProjectIterationRequirement'
  | 'unlinkProjectIterationRequirement'
  // 迭代排期整批保存（MIL-06）。
  | 'saveProjectIterationSchedule'
  | 'saveProjectRequirementSchedule'
  | 'listProjectRequirementPlacements'
  // 规划域生命周期六条（MIL-07：记录达成 / 重新打开 / 阶段记录）。
  | 'completeProjectMilestone'
  | 'reopenProjectMilestone'
  | 'completeProjectIteration'
  | 'reopenProjectIteration'
  | 'listProjectMilestoneEvents'
  | 'listProjectIterationEvents'
  // 打开证据引用里的外部链接（ADR-0036）。
  | 'openProjectEvidenceLink'
  | 'readProjectServiceCapabilities'
  | 'readProjectTestMode'
  | 'listProjectTodos'
  | 'listProjectRequirementPage'
  | 'createProjectTodo'
  | 'updateProjectTodo'
  | 'claimProjectRequirement'
  // 测试轮次的用例五条（TST-04：列表 / 新建 / 编辑 / 复用上轮 / 各轮条数）。
  | 'actOnProjectTestRound'
  | 'listProjectTestRoundActions'
  | 'listProjectTestRounds'
  | 'executeProjectTestCase'
  | 'listProjectTestExecutions'
  | 'actOnProjectTestDefect'
  | 'listProjectTestDefects'
  | 'readProjectTestDefect'
  | 'listProjectRoundTestCases'
  | 'createProjectRoundTestCase'
  | 'updateProjectTestCase'
  | 'copyProjectRoundTestCases'
  | 'listProjectRequirementTestCaseCounts'
  // 整需求提测三条（TST-02：提交 / 轮次列表 / 单轮详情）。
  | 'submitProjectRequirementForTest'
  | 'listProjectRequirementSubmissions'
  | 'readProjectSubmission'
  | 'deleteProjectTodos'
  | 'readProjectTodoDetail'
  | 'readProjectWorkOverview'
  | 'getProjectTodoCollaborators'
  | 'replaceProjectTodoCollaborators'
  | 'listProjectTodoComments'
  | 'createProjectTodoComment'
  | 'previewProjectTodoDeletion'
  | 'setProjectTodoAcceptanceItems'
  | 'submitProjectTodoReview'
  | 'reviewProjectTodo'
  | 'listProjectTodoDrafts'
  | 'createProjectTodoDrafts'
  | 'dropProjectTodoDraft'
  | 'resolveProjectTodoDrafts'
  | 'listProjectFiles'
  | 'uploadProjectFile'
  | 'cancelProjectFileUpload'
  | 'onProjectFileUploadProgress'
  | 'downloadProjectFile'
  | 'promoteProjectFile'
  | 'deleteProjectFile'
  // 资产版本域十三条（RPT-01 的链 + RPT-02 的上传/续传/预览 + RPT-08 的回收站与恢复）。
  | 'listProjectAssets'
  | 'listProjectAssetVersions'
  | 'resolveProjectAssetVersion'
  | 'registerProjectAssetVersion'
  | 'deleteProjectAsset'
  | 'uploadProjectAssetVersion'
  | 'cancelProjectAssetVersionUpload'
  | 'resumeProjectAssetVersionUpload'
  | 'discardProjectAssetVersionUpload'
  | 'previewProjectAssetVersion'
  | 'listProjectAssetTrash'
  | 'restoreProjectAsset'
  | 'restoreProjectAssetVersion'
  | 'onProjectEvent'
  | 'readProjectNotificationSettings'
  | 'writeProjectNotificationSettings'
  | 'onProjectNotificationNavigate'
  | 'onProjectJoinLink'
>;

export type ProjectCollabInvoke = (channel: string, request: unknown) => Promise<unknown>;
export type ProjectCollabSubscribe = (
  channel: string,
  listener: (payload: unknown) => void,
) => () => void;

export function createProjectCollabPreloadApi(
  invoke: ProjectCollabInvoke,
  subscribe: ProjectCollabSubscribe,
): ProjectCollabApi {
  const api: ProjectCollabApi = {
    readProjectCollabAvailability: async () =>
      ProjectCollabAvailabilitySchema.parse(
        await invoke(IPC.PROJECT_AVAILABILITY, ProjectAvailabilityRequestSchema.parse({})),
      ),
    listProjects: async (input) =>
      ProjectListResultSchema.parse(
        await invoke(IPC.PROJECT_LIST, ProjectListRequestSchema.parse(input ?? {})),
      ),
    createProject: async (input) =>
      ProjectCreateResultSchema.parse(
        await invoke(IPC.PROJECT_CREATE, ProjectCreateRequestSchema.parse(input)),
      ),
    readProjectDetail: async (input) =>
      ProjectDetailResultSchema.parse(
        await invoke(IPC.PROJECT_DETAIL, ProjectDetailRequestSchema.parse(input)),
      ),
    updateProject: async (input) =>
      ProjectUpdateResultSchema.parse(
        await invoke(IPC.PROJECT_UPDATE, ProjectUpdateRequestSchema.parse(input)),
      ),
    readProjectSubmissionGate: async (input) =>
      ProjectSubmissionGateResultSchema.parse(
        await invoke(
          IPC.PROJECT_SUBMISSION_GATE_GET,
          ProjectSubmissionGateRequestSchema.parse(input),
        ),
      ),
    updateProjectSubmissionGate: async (input) =>
      ProjectSubmissionGateResultSchema.parse(
        await invoke(
          IPC.PROJECT_SUBMISSION_GATE_UPDATE,
          ProjectSubmissionGateUpdateRequestSchema.parse(input),
        ),
      ),
    readProjectConventions: async (input) =>
      ProjectConventionsResultSchema.parse(
        await invoke(IPC.PROJECT_CONVENTIONS_GET, ProjectConventionsRequestSchema.parse(input)),
      ),
    updateProjectConventions: async (input) =>
      ProjectConventionsUpdateResultSchema.parse(
        await invoke(
          IPC.PROJECT_CONVENTIONS_UPDATE,
          ProjectConventionsUpdateRequestSchema.parse(input),
        ),
      ),
    createProjectInvitation: async (input) =>
      ProjectInviteResultSchema.parse(
        await invoke(IPC.PROJECT_INVITE, ProjectInviteRequestSchema.parse(input)),
      ),
    redeemProjectInvitation: async (input) =>
      ProjectRedeemInvitationResultSchema.parse(
        await invoke(
          IPC.PROJECT_REDEEM_INVITATION,
          ProjectRedeemInvitationRequestSchema.parse(input),
        ),
      ),
    listProjectOpenInvitations: async (input) =>
      ProjectOpenInvitationListResultSchema.parse(
        await invoke(
          IPC.PROJECT_LIST_OPEN_INVITATIONS,
          ProjectOpenInvitationListRequestSchema.parse(input),
        ),
      ),
    revokeProjectInvitation: async (input) =>
      ProjectInvitationRevokeResultSchema.parse(
        await invoke(
          IPC.PROJECT_REVOKE_INVITATION,
          ProjectInvitationRevokeRequestSchema.parse(input),
        ),
      ),
    // 成员管理四条（owner-only，服务端强判）：同形回权威项目详情。
    updateProjectMemberRole: async (input) =>
      ProjectMemberAdminResultSchema.parse(
        await invoke(IPC.PROJECT_MEMBER_UPDATE, ProjectMemberUpdateRequestSchema.parse(input)),
      ),
    removeProjectMember: async (input) =>
      ProjectMemberAdminResultSchema.parse(
        await invoke(IPC.PROJECT_MEMBER_REMOVE, ProjectMemberRemoveRequestSchema.parse(input)),
      ),
    transferProjectOwnership: async (input) =>
      ProjectMemberAdminResultSchema.parse(
        await invoke(IPC.PROJECT_TRANSFER, ProjectTransferOwnershipRequestSchema.parse(input)),
      ),
    setProjectArchived: async (input) =>
      ProjectMemberAdminResultSchema.parse(
        await invoke(IPC.PROJECT_ARCHIVE, ProjectArchiveRequestSchema.parse(input)),
      ),
    listProjectFeed: async (input) =>
      ProjectFeedListResultSchema.parse(
        await invoke(IPC.PROJECT_FEED_LIST, ProjectFeedListRequestSchema.parse(input)),
      ),
    postProjectFeedEntry: async (input) =>
      ProjectFeedPostResultSchema.parse(
        await invoke(IPC.PROJECT_FEED_POST, ProjectFeedPostRequestSchema.parse(input)),
      ),
    postProjectFeedComment: async (input) =>
      ProjectCommentPostResultSchema.parse(
        await invoke(IPC.PROJECT_COMMENT_POST, ProjectCommentPostRequestSchema.parse(input)),
      ),
    readProjectChatHistory: async (input) =>
      ProjectChatHistoryResultSchema.parse(
        await invoke(IPC.PROJECT_CHAT_HISTORY, ProjectChatHistoryRequestSchema.parse(input)),
      ),
    sendProjectChatMessage: async (input) =>
      ProjectChatSendResultSchema.parse(
        await invoke(IPC.PROJECT_CHAT_SEND, ProjectChatSendRequestSchema.parse(input)),
      ),
    revokeProjectChatMessage: async (input) =>
      ProjectChatRevokeResultSchema.parse(
        await invoke(IPC.PROJECT_CHAT_REVOKE, ProjectChatRevokeRequestSchema.parse(input)),
      ),
    setProjectReadCursor: async (input) =>
      ProjectReadCursorResultSchema.parse(
        await invoke(IPC.PROJECT_READ_CURSOR, ProjectReadCursorRequestSchema.parse(input)),
      ),
    /*
     * 规划域六条：桥两侧都校验（入参 strictObject 收敛、出参 zod 校验）。
     * ⛔ 这里不做角色判定——角色档位在服务端（规划域写一律 manager+）；桥只保证形状。
     */
    listProjectMilestones: async (input) =>
      ProjectMilestoneListResultSchema.parse(
        await invoke(IPC.PROJECT_MILESTONE_LIST, ProjectMilestoneListRequestSchema.parse(input)),
      ),
    createProjectMilestone: async (input) =>
      ProjectMilestoneCreateResultSchema.parse(
        await invoke(
          IPC.PROJECT_MILESTONE_CREATE,
          ProjectMilestoneCreateRequestSchema.parse(input),
        ),
      ),
    updateProjectMilestone: async (input) =>
      ProjectMilestoneUpdateResultSchema.parse(
        await invoke(
          IPC.PROJECT_MILESTONE_UPDATE,
          ProjectMilestoneUpdateRequestSchema.parse(input),
        ),
      ),
    listProjectIterations: async (input) =>
      ProjectIterationListResultSchema.parse(
        await invoke(IPC.PROJECT_ITERATION_LIST, ProjectIterationListRequestSchema.parse(input)),
      ),
    createProjectIteration: async (input) =>
      ProjectIterationCreateResultSchema.parse(
        await invoke(
          IPC.PROJECT_ITERATION_CREATE,
          ProjectIterationCreateRequestSchema.parse(input),
        ),
      ),
    updateProjectIteration: async (input) =>
      ProjectIterationUpdateResultSchema.parse(
        await invoke(
          IPC.PROJECT_ITERATION_UPDATE,
          ProjectIterationUpdateRequestSchema.parse(input),
        ),
      ),
    // 规划草案两条（mil-11）：桥两侧都校验，请求里多带账号或非 UUID 会话在这里就拒、不发 IPC。
    listProjectPlanningDrafts: async (input) =>
      ProjectPlanningDraftListResultSchema.parse(
        await invoke(
          IPC.PROJECT_PLANNING_DRAFT_LIST,
          ProjectPlanningDraftListRequestSchema.parse(input),
        ),
      ),
    discardProjectPlanningDraft: async (input) =>
      ProjectPlanningDraftDiscardResultSchema.parse(
        await invoke(
          IPC.PROJECT_PLANNING_DRAFT_DISCARD,
          ProjectPlanningDraftDiscardRequestSchema.parse(input),
        ),
      ),
    /*
     * 迭代 ↔ 需求关联历史三条：桥两侧都校验（入参 strictObject 收敛、出参 zod 校验）。
     * ⛔ 这里不做角色判定，也不做可见性判定——服务端按令牌强判，且摘要已按可见性筛过。
     */
    listProjectIterationRequirements: async (input) =>
      ProjectIterationRequirementListResultSchema.parse(
        await invoke(
          IPC.PROJECT_ITERATION_REQUIREMENT_LIST,
          ProjectIterationRequirementListRequestSchema.parse(input),
        ),
      ),
    linkProjectIterationRequirement: async (input) =>
      ProjectIterationRequirementLinkResultSchema.parse(
        await invoke(
          IPC.PROJECT_ITERATION_REQUIREMENT_LINK,
          ProjectIterationRequirementLinkRequestSchema.parse(input),
        ),
      ),
    unlinkProjectIterationRequirement: async (input) =>
      ProjectIterationRequirementUnlinkResultSchema.parse(
        await invoke(
          IPC.PROJECT_ITERATION_REQUIREMENT_UNLINK,
          ProjectIterationRequirementUnlinkRequestSchema.parse(input),
        ),
      ),
    /* 迭代排期整批保存（MIL-06）：桥两侧都校验；⛔ 不做角色判定、不拆成逐条改单。 */
    saveProjectIterationSchedule: async (input) =>
      ProjectIterationScheduleSaveResultSchema.parse(
        await invoke(
          IPC.PROJECT_ITERATION_SCHEDULE_SAVE,
          ProjectIterationScheduleSaveRequestSchema.parse(input),
        ),
      ),
    /* 安排需求整批保存（MIL-09）：桥两侧都校验；⛔ 不做角色判定、不拆成逐条关联 / 移出。 */
    saveProjectRequirementSchedule: async (input) =>
      ProjectRequirementScheduleSaveResultSchema.parse(
        await invoke(
          IPC.PROJECT_REQUIREMENT_SCHEDULE_SAVE,
          ProjectRequirementScheduleSaveRequestSchema.parse(input),
        ),
      ),
    listProjectRequirementPlacements: async (input) =>
      ProjectRequirementPlacementListResultSchema.parse(
        await invoke(
          IPC.PROJECT_REQUIREMENT_PLACEMENT_LIST,
          ProjectRequirementPlacementListRequestSchema.parse(input),
        ),
      ),
    /*
     * 规划域生命周期六条（MIL-07）：桥两侧都校验（入参 strictObject 收敛、出参 zod 校验）。
     * ⛔ 这里不做角色判定、也不判必填（完成要证据 / 重开要原因都在服务端）；桥只保证形状。
     */
    completeProjectMilestone: async (input) =>
      ProjectMilestoneLifecycleResultSchema.parse(
        await invoke(
          IPC.PROJECT_MILESTONE_COMPLETE,
          ProjectMilestoneLifecycleRequestSchema.parse(input),
        ),
      ),
    reopenProjectMilestone: async (input) =>
      ProjectMilestoneLifecycleResultSchema.parse(
        await invoke(
          IPC.PROJECT_MILESTONE_REOPEN,
          ProjectMilestoneLifecycleRequestSchema.parse(input),
        ),
      ),
    completeProjectIteration: async (input) =>
      ProjectIterationLifecycleResultSchema.parse(
        await invoke(
          IPC.PROJECT_ITERATION_COMPLETE,
          ProjectIterationLifecycleRequestSchema.parse(input),
        ),
      ),
    reopenProjectIteration: async (input) =>
      ProjectIterationLifecycleResultSchema.parse(
        await invoke(
          IPC.PROJECT_ITERATION_REOPEN,
          ProjectIterationLifecycleRequestSchema.parse(input),
        ),
      ),
    listProjectMilestoneEvents: async (input) =>
      ProjectMilestoneLifecycleEventListResultSchema.parse(
        await invoke(
          IPC.PROJECT_MILESTONE_EVENTS,
          ProjectMilestoneLifecycleEventListRequestSchema.parse(input),
        ),
      ),
    listProjectIterationEvents: async (input) =>
      ProjectIterationLifecycleEventListResultSchema.parse(
        await invoke(
          IPC.PROJECT_ITERATION_EVENTS,
          ProjectIterationLifecycleEventListRequestSchema.parse(input),
        ),
      ),
    /* 打开证据里的外部链接（ADR-0036）：桥只保证形状；可不可以打开由主进程再判一次。 */
    openProjectEvidenceLink: async (input) =>
      ProjectEvidenceLinkOpenResultSchema.parse(
        await invoke(
          IPC.PROJECT_EVIDENCE_LINK_OPEN,
          ProjectEvidenceLinkOpenRequestSchema.parse(input),
        ),
      ),
    readProjectServiceCapabilities: async (input) =>
      ServiceCapabilitiesResultSchema.parse(
        await invoke(
          IPC.PROJECT_SERVICE_CAPABILITIES,
          ServiceCapabilitiesRequestSchema.parse(input),
        ),
      ),
    readProjectTestMode: async (input) =>
      ProjectTestModeResultSchema.parse(
        await invoke(IPC.PROJECT_TEST_MODE, ProjectTestModeRequestSchema.parse(input)),
      ),
    listProjectTodos: async (input) =>
      ProjectTodoListResultSchema.parse(
        await invoke(IPC.PROJECT_TODO_LIST, ProjectTodoListRequestSchema.parse(input)),
      ),
    listProjectRequirementPage: async (input) =>
      ProjectRequirementPageResultSchema.parse(
        await invoke(
          IPC.PROJECT_REQUIREMENT_PAGE,
          ProjectRequirementPageRequestSchema.parse(input),
        ),
      ),
    createProjectTodo: async (input) =>
      ProjectTodoCreateResultSchema.parse(
        await invoke(IPC.PROJECT_TODO_CREATE, ProjectTodoCreateRequestSchema.parse(input)),
      ),
    updateProjectTodo: async (input) =>
      ProjectTodoUpdateResultSchema.parse(
        await invoke(IPC.PROJECT_TODO_UPDATE, ProjectTodoUpdateRequestSchema.parse(input)),
      ),
    claimProjectRequirement: async (input) =>
      ProjectRequirementClaimResultSchema.parse(
        await invoke(
          IPC.PROJECT_REQUIREMENT_CLAIM,
          ProjectRequirementClaimRequestSchema.parse(input),
        ),
      ),
    /*
     * 测试轮次的用例五条（TST-04）：桥两侧都校验（入参 strictObject 收敛——账号、必测、结果字段塞不进来；
     * 出参 zod 校验）。⛔ 不在桥上判本轮测试负责人与轮次状态（服务端强判）。
     */
    actOnProjectTestRound: async (input) =>
      ProjectTestRoundActionResultSchema.parse(
        await invoke(
          IPC.PROJECT_TEST_ROUND_ACTION,
          ProjectTestRoundActionRequestSchema.parse(input),
        ),
      ),
    listProjectTestRoundActions: async (input) =>
      ProjectTestRoundActionsResultSchema.parse(
        await invoke(
          IPC.PROJECT_TEST_ROUND_ACTIONS,
          ProjectTestRoundActionsRequestSchema.parse(input),
        ),
      ),
    listProjectTestRounds: async (input) =>
      ProjectTestRoundsResultSchema.parse(
        await invoke(IPC.PROJECT_TEST_ROUNDS, ProjectTestRoundsRequestSchema.parse(input)),
      ),
    executeProjectTestCase: async (input) =>
      ProjectTestCaseExecuteResultSchema.parse(
        await invoke(
          IPC.PROJECT_TEST_CASE_EXECUTE,
          ProjectTestCaseExecuteRequestSchema.parse(input),
        ),
      ),
    listProjectTestExecutions: async (input) =>
      ProjectTestExecutionsResultSchema.parse(
        await invoke(IPC.PROJECT_TEST_EXECUTIONS, ProjectTestExecutionsRequestSchema.parse(input)),
      ),
    actOnProjectTestDefect: async (input) =>
      ProjectTestDefectActionResultSchema.parse(
        await invoke(
          IPC.PROJECT_TEST_DEFECT_ACTION,
          ProjectTestDefectActionRequestSchema.parse(input),
        ),
      ),
    listProjectTestDefects: async (input) =>
      ProjectTestDefectsResultSchema.parse(
        await invoke(IPC.PROJECT_TEST_DEFECTS, ProjectTestDefectsRequestSchema.parse(input)),
      ),
    readProjectTestDefect: async (input) =>
      ProjectTestDefectDetailResultSchema.parse(
        await invoke(
          IPC.PROJECT_TEST_DEFECT_DETAIL,
          ProjectTestDefectDetailRequestSchema.parse(input),
        ),
      ),
    listProjectRoundTestCases: async (input) =>
      ProjectRoundTestCasesResultSchema.parse(
        await invoke(IPC.PROJECT_ROUND_TEST_CASES, ProjectRoundTestCasesRequestSchema.parse(input)),
      ),
    createProjectRoundTestCase: async (input) =>
      ProjectRoundTestCaseCreateResultSchema.parse(
        await invoke(
          IPC.PROJECT_ROUND_TEST_CASE_CREATE,
          ProjectRoundTestCaseCreateRequestSchema.parse(input),
        ),
      ),
    updateProjectTestCase: async (input) =>
      ProjectTestCaseUpdateResultSchema.parse(
        await invoke(IPC.PROJECT_TEST_CASE_UPDATE, ProjectTestCaseUpdateRequestSchema.parse(input)),
      ),
    copyProjectRoundTestCases: async (input) =>
      ProjectRoundTestCasesCopyResultSchema.parse(
        await invoke(
          IPC.PROJECT_ROUND_TEST_CASES_COPY,
          ProjectRoundTestCasesCopyRequestSchema.parse(input),
        ),
      ),
    listProjectRequirementTestCaseCounts: async (input) =>
      ProjectRequirementTestCaseCountsResultSchema.parse(
        await invoke(
          IPC.PROJECT_REQUIREMENT_TEST_CASE_COUNTS,
          ProjectRequirementTestCaseCountsRequestSchema.parse(input),
        ),
      ),
    /*
     * 整需求提测三条（TST-02）：桥两侧都校验（入参 strictObject 收敛——账号与快照字段塞不进来；
     * 出参 zod 校验）。⛔ 不在桥上判处理人与测试负责人独立性（服务端强判）。
     */
    submitProjectRequirementForTest: async (input) =>
      ProjectRequirementSubmitResultSchema.parse(
        await invoke(
          IPC.PROJECT_REQUIREMENT_SUBMIT,
          ProjectRequirementSubmitRequestSchema.parse(input),
        ),
      ),
    listProjectRequirementSubmissions: async (input) =>
      ProjectRequirementSubmissionsResultSchema.parse(
        await invoke(
          IPC.PROJECT_REQUIREMENT_SUBMISSIONS,
          ProjectRequirementSubmissionsRequestSchema.parse(input),
        ),
      ),
    readProjectSubmission: async (input) =>
      ProjectSubmissionDetailResultSchema.parse(
        await invoke(
          IPC.PROJECT_SUBMISSION_DETAIL,
          ProjectSubmissionDetailRequestSchema.parse(input),
        ),
      ),
    deleteProjectTodos: async (input) =>
      ProjectTodoDeleteResultSchema.parse(
        await invoke(IPC.PROJECT_TODO_DELETE, ProjectTodoDeleteRequestSchema.parse(input)),
      ),
    readProjectTodoDetail: async (input) =>
      ProjectTodoDetailResultSchema.parse(
        await invoke(IPC.PROJECT_TODO_DETAIL, ProjectTodoDetailRequestSchema.parse(input)),
      ),
    readProjectWorkOverview: async (input) =>
      ProjectWorkOverviewResultSchema.parse(
        await invoke(IPC.PROJECT_WORK_OVERVIEW, ProjectWorkOverviewRequestSchema.parse(input)),
      ),
    getProjectTodoCollaborators: async (input) =>
      ProjectTodoCollaboratorsResultSchema.parse(
        await invoke(
          IPC.PROJECT_TODO_COLLABORATORS,
          ProjectTodoCollaboratorsRequestSchema.parse(input),
        ),
      ),
    replaceProjectTodoCollaborators: async (input) =>
      ProjectTodoCollaboratorsReplaceResultSchema.parse(
        await invoke(
          IPC.PROJECT_TODO_COLLABORATORS_REPLACE,
          ProjectTodoCollaboratorsReplaceRequestSchema.parse(input),
        ),
      ),
    listProjectTodoComments: async (input) =>
      ProjectTodoCommentsResultSchema.parse(
        await invoke(IPC.PROJECT_TODO_COMMENTS, ProjectTodoCommentsRequestSchema.parse(input)),
      ),
    createProjectTodoComment: async (input) =>
      ProjectTodoCommentCreateResultSchema.parse(
        await invoke(
          IPC.PROJECT_TODO_COMMENT_CREATE,
          ProjectTodoCommentCreateRequestSchema.parse(input),
        ),
      ),
    previewProjectTodoDeletion: async (input) =>
      ProjectTodoDeletePreviewResultSchema.parse(
        await invoke(
          IPC.PROJECT_TODO_DELETE_PREVIEW,
          ProjectTodoDeletePreviewRequestSchema.parse(input),
        ),
      ),
    setProjectTodoAcceptanceItems: async (input) =>
      ProjectTodoAcceptanceSetResultSchema.parse(
        await invoke(
          IPC.PROJECT_TODO_ACCEPTANCE_SET,
          ProjectTodoAcceptanceSetRequestSchema.parse(input),
        ),
      ),
    submitProjectTodoReview: async (input) =>
      ProjectTodoSubmitReviewResultSchema.parse(
        await invoke(
          IPC.PROJECT_TODO_SUBMIT_REVIEW,
          ProjectTodoSubmitReviewRequestSchema.parse(input),
        ),
      ),
    reviewProjectTodo: async (input) =>
      ProjectTodoReviewResultSchema.parse(
        await invoke(IPC.PROJECT_TODO_REVIEW, ProjectTodoReviewRequestSchema.parse(input)),
      ),
    listProjectTodoDrafts: async (input) =>
      ProjectTodoDraftListResultSchema.parse(
        await invoke(IPC.PROJECT_TODO_DRAFT_LIST, ProjectTodoDraftListRequestSchema.parse(input)),
      ),
    createProjectTodoDrafts: async (input) =>
      ProjectTodoDraftCreateResultSchema.parse(
        await invoke(
          IPC.PROJECT_TODO_DRAFT_CREATE,
          ProjectTodoDraftCreateRequestSchema.parse(input),
        ),
      ),
    dropProjectTodoDraft: async (input) =>
      ProjectTodoDraftDropResultSchema.parse(
        await invoke(IPC.PROJECT_TODO_DRAFT_DROP, ProjectTodoDraftDropRequestSchema.parse(input)),
      ),
    resolveProjectTodoDrafts: async (input) =>
      ProjectTodoDraftResolveResultSchema.parse(
        await invoke(
          IPC.PROJECT_TODO_DRAFT_RESOLVE,
          ProjectTodoDraftResolveRequestSchema.parse(input),
        ),
      ),
    listProjectFiles: async (input) =>
      ProjectFileListResultSchema.parse(
        await invoke(IPC.PROJECT_FILE_LIST, ProjectFileListRequestSchema.parse(input)),
      ),
    uploadProjectFile: async (input) =>
      ProjectFileUploadResultSchema.parse(
        await invoke(IPC.PROJECT_FILE_UPLOAD, ProjectFileUploadRequestSchema.parse(input)),
      ),
    cancelProjectFileUpload: async (input) =>
      ProjectFileUploadCancelResultSchema.parse(
        await invoke(
          IPC.PROJECT_FILE_UPLOAD_CANCEL,
          ProjectFileUploadCancelRequestSchema.parse(input),
        ),
      ),
    onProjectFileUploadProgress: (listener) =>
      subscribe(IPC.PROJECT_FILE_UPLOAD_PROGRESS, (payload) => {
        const parsed = ProjectFileUploadProgressSchema.safeParse(payload);
        if (parsed.success) listener(parsed.data);
      }),
    downloadProjectFile: async (input) =>
      ProjectFileDownloadResultSchema.parse(
        await invoke(IPC.PROJECT_FILE_DOWNLOAD, ProjectFileDownloadRequestSchema.parse(input)),
      ),
    promoteProjectFile: async (input) =>
      ProjectFilePromoteResultSchema.parse(
        await invoke(IPC.PROJECT_FILE_PROMOTE, ProjectFilePromoteRequestSchema.parse(input)),
      ),
    deleteProjectFile: async (input) =>
      ProjectFileDeleteResultSchema.parse(
        await invoke(IPC.PROJECT_FILE_DELETE, ProjectFileDeleteRequestSchema.parse(input)),
      ),
    /*
     * 资产版本域十三条：桥两侧都校验（入参 strictObject 收敛、出参 zod 校验）。
     * ⛔ 这一层不做角色判定（服务端强判），也不替调用方补默认定位键。
     */
    listProjectAssets: async (input) =>
      ProjectAssetListResultSchema.parse(
        await invoke(IPC.PROJECT_ASSET_LIST, ProjectAssetListRequestSchema.parse(input)),
      ),
    listProjectAssetVersions: async (input) =>
      ProjectAssetVersionChainResultSchema.parse(
        await invoke(
          IPC.PROJECT_ASSET_VERSION_LIST,
          ProjectAssetVersionChainRequestSchema.parse(input),
        ),
      ),
    resolveProjectAssetVersion: async (input) =>
      ProjectAssetVersionResolveResultSchema.parse(
        await invoke(
          IPC.PROJECT_ASSET_VERSION_RESOLVE,
          ProjectAssetVersionResolveRequestSchema.parse(input),
        ),
      ),
    registerProjectAssetVersion: async (input) =>
      ProjectAssetVersionRegisterResultSchema.parse(
        await invoke(
          IPC.PROJECT_ASSET_VERSION_REGISTER,
          ProjectAssetVersionRegisterRequestSchema.parse(input),
        ),
      ),
    deleteProjectAsset: async (input) =>
      ProjectAssetDeleteResultSchema.parse(
        await invoke(IPC.PROJECT_ASSET_DELETE, ProjectAssetDeleteRequestSchema.parse(input)),
      ),
    uploadProjectAssetVersion: async (input) =>
      ProjectAssetVersionUploadResultSchema.parse(
        await invoke(
          IPC.PROJECT_ASSET_VERSION_UPLOAD,
          ProjectAssetVersionUploadRequestSchema.parse(input),
        ),
      ),
    cancelProjectAssetVersionUpload: async (input) =>
      ProjectAssetUploadAttemptDiscardResultSchema.parse(
        await invoke(
          IPC.PROJECT_ASSET_VERSION_UPLOAD_CANCEL,
          ProjectAssetUploadAttemptDiscardRequestSchema.parse(input),
        ),
      ),
    resumeProjectAssetVersionUpload: async (input) =>
      ProjectAssetVersionUploadResultSchema.parse(
        await invoke(
          IPC.PROJECT_ASSET_VERSION_UPLOAD_RESUME,
          ProjectAssetVersionUploadResumeRequestSchema.parse(input),
        ),
      ),
    discardProjectAssetVersionUpload: async (input) =>
      ProjectAssetUploadAttemptDiscardResultSchema.parse(
        await invoke(
          IPC.PROJECT_ASSET_VERSION_UPLOAD_DISCARD,
          ProjectAssetUploadAttemptDiscardRequestSchema.parse(input),
        ),
      ),
    previewProjectAssetVersion: async (input) =>
      ProjectAssetVersionPreviewResultSchema.parse(
        await invoke(
          IPC.PROJECT_ASSET_VERSION_PREVIEW,
          ProjectAssetVersionPreviewRequestSchema.parse(input),
        ),
      ),
    // RPT-08 回收站与恢复三条：同样两侧校验；⛔ 不在桥上判「本人或拥有者」（服务端强判）。
    listProjectAssetTrash: async (input) =>
      ProjectAssetTrashListResultSchema.parse(
        await invoke(IPC.PROJECT_ASSET_TRASH_LIST, ProjectAssetTrashListRequestSchema.parse(input)),
      ),
    restoreProjectAsset: async (input) =>
      ProjectAssetRestoreResultSchema.parse(
        await invoke(IPC.PROJECT_ASSET_RESTORE, ProjectAssetRestoreRequestSchema.parse(input)),
      ),
    restoreProjectAssetVersion: async (input) =>
      ProjectAssetVersionRestoreResultSchema.parse(
        await invoke(
          IPC.PROJECT_ASSET_VERSION_RESTORE,
          ProjectAssetVersionRestoreRequestSchema.parse(input),
        ),
      ),
    onProjectEvent: (listener) =>
      subscribe(IPC.PROJECT_EVENT, (payload) => {
        const parsed = ProjectEventSchema.safeParse(payload);
        if (parsed.success) listener(parsed.data);
      }),
    readProjectNotificationSettings: async () =>
      ProjectNotificationSettingsSchema.parse(
        await invoke(IPC.PROJECT_NOTIFICATION_SETTINGS_READ, undefined),
      ),
    writeProjectNotificationSettings: async (input) =>
      ProjectNotificationSettingsSchema.parse(
        await invoke(
          IPC.PROJECT_NOTIFICATION_SETTINGS_WRITE,
          ProjectNotificationSettingsUpdateSchema.parse(input),
        ),
      ),
    onProjectNotificationNavigate: (listener) =>
      subscribe(IPC.PROJECT_NOTIFICATION_NAVIGATE, (payload) => {
        const parsed = ProjectNotificationNavigateSchema.safeParse(payload);
        if (parsed.success) listener(parsed.data);
      }),
    onProjectJoinLink: (listener) =>
      subscribe(IPC.PROJECT_JOIN_LINK, (payload) => {
        // 坏帧不进渲染层：code 形状不过即丢弃（与其余事件订阅同纪律）。
        const parsed = ProjectJoinLinkEventSchema.safeParse(payload);
        if (parsed.success) listener(parsed.data);
      }),
  };
  return Object.freeze(api);
}
