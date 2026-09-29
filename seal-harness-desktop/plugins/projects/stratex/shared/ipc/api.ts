import type { ProjectTestRoundActionRequest, ProjectTestRoundActionResult, ProjectTestRoundActionsRequest, ProjectTestRoundActionsResult, ProjectTestRoundsRequest, ProjectTestRoundsResult } from '../protocol/project-testing.js';
import type { ProjectTestCaseExecuteRequest, ProjectTestCaseExecuteResult, ProjectTestExecutionsRequest, ProjectTestExecutionsResult } from '../protocol/project-testing-cases.js';
import type { ProjectTestDefectActionRequest, ProjectTestDefectActionResult, ProjectTestDefectsRequest, ProjectTestDefectsResult, ProjectTestDefectDetailRequest, ProjectTestDefectDetailResult } from '../protocol/project-testing-defects.js';
import type { ProjectWorkOverviewRequest, ProjectWorkOverviewResult } from '../protocol/project-work-overview.js';
import type { ProjectTodoCollaboratorsRequest, ProjectTodoCollaboratorsResult, ProjectTodoCollaboratorsReplaceRequest, ProjectTodoCollaboratorsReplaceResult, ProjectTodoCommentsRequest, ProjectTodoCommentsResult, ProjectTodoCommentCreateRequest, ProjectTodoCommentCreateResult, ProjectTodoDeletePreviewRequest, ProjectTodoDeletePreviewResult } from '../protocol/project-todo-collaboration.js';
import type { ProjectDictionaryListRequest, ProjectDictionaryListResult } from '../protocol/project-dictionary-api.js';
import type { ProjectSubmissionGateRequest, ProjectSubmissionGateUpdateRequest, ProjectSubmissionGateResult } from '../protocol/project-submission-gate.js';
import type { ProjectWorkspaceRequest, ProjectWorkspaceSelectLocalRequest, ProjectWorkspaceResult, ProjectLinkedDirectoryListRequest, ProjectLinkedDirectoryAddRequest, ProjectLinkedDirectoryRemoveRequest, ProjectLinkedDirectoriesResult, WorkspaceLinkedDirectoryListRequest, WorkspaceLinkedDirectoryAddRequest, WorkspaceLinkedDirectoryRemoveRequest } from '../protocol/project-workspace.js';
import type { ProjectArchiveRequest, ProjectChatHistoryRequest, ProjectChatHistoryResult, ProjectChatRevokeRequest, ProjectChatRevokeResult, ProjectChatSendRequest, ProjectChatSendResult, ProjectCollabAvailability, ProjectCommentPostRequest, ProjectCommentPostResult, ProjectCreateRequest, ProjectCreateResult, ProjectDetailRequest, ProjectDetailResult, ProjectEvent, ProjectFeedListRequest, ProjectFeedListResult, ProjectFeedPostRequest, ProjectFeedPostResult, ProjectFileDeleteRequest, ProjectFileDeleteResult, ProjectFileDownloadRequest, ProjectFileDownloadResult, ProjectFileListRequest, ProjectFileListResult, ProjectFilePromoteRequest, ProjectFilePromoteResult, ProjectFileUploadRequest, ProjectFileUploadResult, ProjectFileUploadCancelRequest, ProjectFileUploadCancelResult, ProjectFileUploadProgress, ProjectInviteRequest, ProjectInviteResult, ProjectJoinLinkEvent, ProjectListRequest, ProjectListResult, ProjectMemberAdminResult, ProjectMemberRemoveRequest, ProjectMemberUpdateRequest, ProjectOpenInvitationListRequest, ProjectOpenInvitationListResult, ProjectInvitationRevokeRequest, ProjectInvitationRevokeResult, ProjectReadCursorRequest, ProjectReadCursorResult, ProjectRedeemInvitationRequest, ProjectRedeemInvitationResult, ProjectTodoAcceptanceSetRequest, ProjectTodoAcceptanceSetResult, ProjectTodoCreateRequest, ProjectTodoCreateResult, ProjectTodoDetailRequest, ProjectTodoDetailResult, ProjectTodoDraftCreateRequest, ProjectTodoDraftCreateResult, ProjectTodoDraftDropRequest, ProjectTodoDraftDropResult, ProjectTodoDraftListRequest, ProjectTodoDraftListResult, ProjectTodoDraftResolveRequest, ProjectTodoDraftResolveResult, ProjectTodoListRequest, ProjectTodoListResult, ProjectRequirementPageRequest, ProjectRequirementPageResult, ProjectTodoReviewRequest, ProjectTodoReviewResult, ProjectTodoSubmitReviewRequest, ProjectTodoSubmitReviewResult, ProjectTodoUpdateRequest, ProjectTodoUpdateResult, ProjectRequirementClaimRequest, ProjectRequirementClaimResult, ProjectTodoDeleteRequest, ProjectTodoDeleteResult, ProjectTransferOwnershipRequest, ProjectUpdateRequest, ProjectUpdateResult, ProjectConventionsRequest, ProjectConventionsResult, ProjectConventionsUpdateRequest, ProjectConventionsUpdateResult } from '../protocol/project-collab.js';
import type { ProjectTestModeRequest, ProjectTestModeResult, ServiceCapabilitiesRequest, ServiceCapabilitiesResult } from '../protocol/project-collab-capabilities.js';
import type { ProjectAssetDeleteRequest, ProjectAssetDeleteResult, ProjectAssetListRequest, ProjectAssetListResult, ProjectAssetRestoreRequest, ProjectAssetRestoreResult, ProjectAssetTrashListRequest, ProjectAssetTrashListResult, ProjectAssetUploadAttemptDiscardRequest, ProjectAssetUploadAttemptDiscardResult, ProjectAssetVersionChainRequest, ProjectAssetVersionChainResult, ProjectAssetVersionPreviewRequest, ProjectAssetVersionPreviewResult, ProjectAssetVersionRegisterRequest, ProjectAssetVersionRegisterResult, ProjectAssetVersionResolveRequest, ProjectAssetVersionResolveResult, ProjectAssetVersionRestoreRequest, ProjectAssetVersionRestoreResult, ProjectAssetVersionUploadRequest, ProjectAssetVersionUploadResult, ProjectAssetVersionUploadResumeRequest } from '../protocol/project-collab-assets.js';
import type { ProjectIterationCreateRequest, ProjectIterationCreateResult, ProjectIterationListRequest, ProjectIterationListResult, ProjectIterationRequirementLinkRequest, ProjectIterationRequirementLinkResult, ProjectIterationRequirementListRequest, ProjectIterationRequirementListResult, ProjectIterationRequirementUnlinkRequest, ProjectIterationRequirementUnlinkResult, ProjectIterationUpdateRequest, ProjectIterationUpdateResult, ProjectMilestoneCreateRequest, ProjectMilestoneCreateResult, ProjectMilestoneListRequest, ProjectMilestoneListResult, ProjectMilestoneUpdateRequest, ProjectMilestoneUpdateResult } from '../protocol/project-planning.js';
import type { ProjectPlanningDraftDiscardRequest, ProjectPlanningDraftDiscardResult, ProjectPlanningDraftListRequest, ProjectPlanningDraftListResult } from '../protocol/project-planning-draft.js';
import type { ProjectEvidenceLinkOpenRequest, ProjectEvidenceLinkOpenResult, ProjectIterationLifecycleEventListRequest, ProjectIterationLifecycleEventListResult, ProjectIterationLifecycleRequest, ProjectIterationLifecycleResult, ProjectMilestoneLifecycleEventListRequest, ProjectMilestoneLifecycleEventListResult, ProjectMilestoneLifecycleRequest, ProjectMilestoneLifecycleResult } from '../protocol/project-planning-lifecycle.js';
import type { ProjectIterationScheduleSaveRequest, ProjectIterationScheduleSaveResult, ProjectRequirementPlacementListRequest, ProjectRequirementPlacementListResult, ProjectRequirementScheduleSaveRequest, ProjectRequirementScheduleSaveResult } from '../protocol/project-planning-schedule.js';
import type { ProjectRequirementSubmissionsRequest, ProjectRequirementSubmissionsResult, ProjectRequirementSubmitRequest, ProjectRequirementSubmitResult, ProjectSubmissionDetailRequest, ProjectSubmissionDetailResult } from '../protocol/project-testing.js';
import type { ProjectRequirementTestCaseCountsRequest, ProjectRequirementTestCaseCountsResult, ProjectRoundTestCaseCreateRequest, ProjectRoundTestCaseCreateResult, ProjectRoundTestCasesCopyRequest, ProjectRoundTestCasesCopyResult, ProjectRoundTestCasesRequest, ProjectRoundTestCasesResult, ProjectTestCaseUpdateRequest, ProjectTestCaseUpdateResult } from '../protocol/project-testing-cases.js';
import type { ProjectNotificationNavigate, ProjectNotificationSettings, ProjectNotificationSettingsUpdate } from '../protocol/project-notifications.js';
import type { ProjectSpecAssistCancelRequest, ProjectSpecAssistCancelResult, ProjectSpecAssistReadinessResult, ProjectSpecAssistRequest, ProjectSpecAssistResult } from '../protocol/project-spec-assist.js';
import type { ProjectDataSourceCreateRequest, ProjectDataSourceCreateResult, ProjectDataSourceDeleteRequest, ProjectDataSourceDeleteResult, ProjectDataSourceListRequest, ProjectDataSourceListResult, ProjectDataSourceSyncRequest, ProjectDataSourceSyncResult, ProjectDataSourceTicketClearRequest, ProjectDataSourceTicketResult, ProjectDataSourceTicketSaveRequest, ProjectDataSourceUpdateRequest, ProjectDataSourceUpdateResult, ProjectExternalLinkListRequest, ProjectExternalLinkListResult } from '../protocol/project-datasource.js';

/** 项目专用 API；保留来源签名，不导入旧桌面全局 API。 */
export interface ProjectApi {
readonly listProjectDictionaries: (
    request: ProjectDictionaryListRequest,
  ) => Promise<ProjectDictionaryListResult>;
readonly readProjectCollabAvailability: () => Promise<ProjectCollabAvailability>;
readonly resolveProjectWorkspace: (
    request: ProjectWorkspaceRequest,
  ) => Promise<ProjectWorkspaceResult>;
readonly listProjectLinkedDirectories: (
    request: ProjectLinkedDirectoryListRequest,
  ) => Promise<ProjectLinkedDirectoriesResult>;
readonly addProjectLinkedDirectory: (
    request: ProjectLinkedDirectoryAddRequest,
  ) => Promise<ProjectLinkedDirectoriesResult>;
readonly removeProjectLinkedDirectory: (
    request: ProjectLinkedDirectoryRemoveRequest,
  ) => Promise<ProjectLinkedDirectoriesResult>;
readonly listWorkspaceLinkedDirectories: (
    request: WorkspaceLinkedDirectoryListRequest,
  ) => Promise<ProjectLinkedDirectoriesResult>;
readonly addWorkspaceLinkedDirectory: (
    request: WorkspaceLinkedDirectoryAddRequest,
  ) => Promise<ProjectLinkedDirectoriesResult>;
readonly removeWorkspaceLinkedDirectory: (
    request: WorkspaceLinkedDirectoryRemoveRequest,
  ) => Promise<ProjectLinkedDirectoriesResult>;
readonly selectProjectWorkspace: (
    request: ProjectWorkspaceRequest,
  ) => Promise<ProjectWorkspaceResult>;
readonly selectProjectLocalWorkspace: (
    request: ProjectWorkspaceSelectLocalRequest,
  ) => Promise<ProjectWorkspaceResult>;
readonly listProjects: (request?: ProjectListRequest) => Promise<ProjectListResult>;
readonly createProject: (request: ProjectCreateRequest) => Promise<ProjectCreateResult>;
readonly readProjectDetail: (request: ProjectDetailRequest) => Promise<ProjectDetailResult>;
readonly updateProject: (request: ProjectUpdateRequest) => Promise<ProjectUpdateResult>;
readonly readProjectConventions: (
    request: ProjectConventionsRequest,
  ) => Promise<ProjectConventionsResult>;
readonly readProjectSubmissionGate: (
    request: ProjectSubmissionGateRequest,
  ) => Promise<ProjectSubmissionGateResult>;
readonly updateProjectSubmissionGate: (
    request: ProjectSubmissionGateUpdateRequest,
  ) => Promise<ProjectSubmissionGateResult>;
readonly updateProjectConventions: (
    request: ProjectConventionsUpdateRequest,
  ) => Promise<ProjectConventionsUpdateResult>;
readonly createProjectInvitation: (request: ProjectInviteRequest) => Promise<ProjectInviteResult>;
readonly redeemProjectInvitation: (
    request: ProjectRedeemInvitationRequest,
  ) => Promise<ProjectRedeemInvitationResult>;
readonly listProjectOpenInvitations: (
    request: ProjectOpenInvitationListRequest,
  ) => Promise<ProjectOpenInvitationListResult>;
readonly revokeProjectInvitation: (
    request: ProjectInvitationRevokeRequest,
  ) => Promise<ProjectInvitationRevokeResult>;
readonly updateProjectMemberRole: (
    request: ProjectMemberUpdateRequest,
  ) => Promise<ProjectMemberAdminResult>;
readonly removeProjectMember: (
    request: ProjectMemberRemoveRequest,
  ) => Promise<ProjectMemberAdminResult>;
readonly transferProjectOwnership: (
    request: ProjectTransferOwnershipRequest,
  ) => Promise<ProjectMemberAdminResult>;
readonly setProjectArchived: (
    request: ProjectArchiveRequest,
  ) => Promise<ProjectMemberAdminResult>;
readonly listProjectFeed: (request: ProjectFeedListRequest) => Promise<ProjectFeedListResult>;
readonly postProjectFeedEntry: (
    request: ProjectFeedPostRequest,
  ) => Promise<ProjectFeedPostResult>;
readonly postProjectFeedComment: (
    request: ProjectCommentPostRequest,
  ) => Promise<ProjectCommentPostResult>;
readonly readProjectChatHistory: (
    request: ProjectChatHistoryRequest,
  ) => Promise<ProjectChatHistoryResult>;
readonly sendProjectChatMessage: (
    request: ProjectChatSendRequest,
  ) => Promise<ProjectChatSendResult>;
readonly revokeProjectChatMessage: (
    request: ProjectChatRevokeRequest,
  ) => Promise<ProjectChatRevokeResult>;
readonly setProjectReadCursor: (
    request: ProjectReadCursorRequest,
  ) => Promise<ProjectReadCursorResult>;
readonly listProjectMilestones: (
    request: ProjectMilestoneListRequest,
  ) => Promise<ProjectMilestoneListResult>;
readonly createProjectMilestone: (
    request: ProjectMilestoneCreateRequest,
  ) => Promise<ProjectMilestoneCreateResult>;
readonly updateProjectMilestone: (
    request: ProjectMilestoneUpdateRequest,
  ) => Promise<ProjectMilestoneUpdateResult>;
readonly listProjectIterations: (
    request: ProjectIterationListRequest,
  ) => Promise<ProjectIterationListResult>;
readonly createProjectIteration: (
    request: ProjectIterationCreateRequest,
  ) => Promise<ProjectIterationCreateResult>;
readonly updateProjectIteration: (
    request: ProjectIterationUpdateRequest,
  ) => Promise<ProjectIterationUpdateResult>;
readonly listProjectPlanningDrafts: (
    request: ProjectPlanningDraftListRequest,
  ) => Promise<ProjectPlanningDraftListResult>;
readonly discardProjectPlanningDraft: (
    request: ProjectPlanningDraftDiscardRequest,
  ) => Promise<ProjectPlanningDraftDiscardResult>;
readonly listProjectIterationRequirements: (
    request: ProjectIterationRequirementListRequest,
  ) => Promise<ProjectIterationRequirementListResult>;
readonly linkProjectIterationRequirement: (
    request: ProjectIterationRequirementLinkRequest,
  ) => Promise<ProjectIterationRequirementLinkResult>;
readonly unlinkProjectIterationRequirement: (
    request: ProjectIterationRequirementUnlinkRequest,
  ) => Promise<ProjectIterationRequirementUnlinkResult>;
readonly saveProjectIterationSchedule: (
    request: ProjectIterationScheduleSaveRequest,
  ) => Promise<ProjectIterationScheduleSaveResult>;
readonly saveProjectRequirementSchedule: (
    request: ProjectRequirementScheduleSaveRequest,
  ) => Promise<ProjectRequirementScheduleSaveResult>;
readonly listProjectRequirementPlacements: (
    request: ProjectRequirementPlacementListRequest,
  ) => Promise<ProjectRequirementPlacementListResult>;
readonly completeProjectMilestone: (
    request: ProjectMilestoneLifecycleRequest,
  ) => Promise<ProjectMilestoneLifecycleResult>;
readonly reopenProjectMilestone: (
    request: ProjectMilestoneLifecycleRequest,
  ) => Promise<ProjectMilestoneLifecycleResult>;
readonly completeProjectIteration: (
    request: ProjectIterationLifecycleRequest,
  ) => Promise<ProjectIterationLifecycleResult>;
readonly reopenProjectIteration: (
    request: ProjectIterationLifecycleRequest,
  ) => Promise<ProjectIterationLifecycleResult>;
readonly listProjectMilestoneEvents: (
    request: ProjectMilestoneLifecycleEventListRequest,
  ) => Promise<ProjectMilestoneLifecycleEventListResult>;
readonly listProjectIterationEvents: (
    request: ProjectIterationLifecycleEventListRequest,
  ) => Promise<ProjectIterationLifecycleEventListResult>;
readonly openProjectEvidenceLink: (
    request: ProjectEvidenceLinkOpenRequest,
  ) => Promise<ProjectEvidenceLinkOpenResult>;
readonly readProjectServiceCapabilities: (
    request: ServiceCapabilitiesRequest,
  ) => Promise<ServiceCapabilitiesResult>;
readonly readProjectTestMode: (request: ProjectTestModeRequest) => Promise<ProjectTestModeResult>;
readonly listProjectTodos: (request: ProjectTodoListRequest) => Promise<ProjectTodoListResult>;
readonly listProjectRequirementPage: (
    request: ProjectRequirementPageRequest,
  ) => Promise<ProjectRequirementPageResult>;
readonly createProjectTodo: (
    request: ProjectTodoCreateRequest,
  ) => Promise<ProjectTodoCreateResult>;
readonly updateProjectTodo: (
    request: ProjectTodoUpdateRequest,
  ) => Promise<ProjectTodoUpdateResult>;
readonly claimProjectRequirement: (
    request: ProjectRequirementClaimRequest,
  ) => Promise<ProjectRequirementClaimResult>;
readonly actOnProjectTestRound: (
    request: ProjectTestRoundActionRequest,
  ) => Promise<ProjectTestRoundActionResult>;
readonly listProjectTestRoundActions: (
    request: ProjectTestRoundActionsRequest,
  ) => Promise<ProjectTestRoundActionsResult>;
readonly listProjectTestRounds: (
    request: ProjectTestRoundsRequest,
  ) => Promise<ProjectTestRoundsResult>;
readonly executeProjectTestCase: (
    request: ProjectTestCaseExecuteRequest,
  ) => Promise<ProjectTestCaseExecuteResult>;
readonly listProjectTestExecutions: (
    request: ProjectTestExecutionsRequest,
  ) => Promise<ProjectTestExecutionsResult>;
readonly actOnProjectTestDefect: (
    request: ProjectTestDefectActionRequest,
  ) => Promise<ProjectTestDefectActionResult>;
readonly listProjectTestDefects: (
    request: ProjectTestDefectsRequest,
  ) => Promise<ProjectTestDefectsResult>;
readonly readProjectTestDefect: (
    request: ProjectTestDefectDetailRequest,
  ) => Promise<ProjectTestDefectDetailResult>;
readonly listProjectRoundTestCases: (
    request: ProjectRoundTestCasesRequest,
  ) => Promise<ProjectRoundTestCasesResult>;
readonly createProjectRoundTestCase: (
    request: ProjectRoundTestCaseCreateRequest,
  ) => Promise<ProjectRoundTestCaseCreateResult>;
readonly updateProjectTestCase: (
    request: ProjectTestCaseUpdateRequest,
  ) => Promise<ProjectTestCaseUpdateResult>;
readonly copyProjectRoundTestCases: (
    request: ProjectRoundTestCasesCopyRequest,
  ) => Promise<ProjectRoundTestCasesCopyResult>;
readonly listProjectRequirementTestCaseCounts: (
    request: ProjectRequirementTestCaseCountsRequest,
  ) => Promise<ProjectRequirementTestCaseCountsResult>;
readonly submitProjectRequirementForTest: (
    request: ProjectRequirementSubmitRequest,
  ) => Promise<ProjectRequirementSubmitResult>;
readonly listProjectRequirementSubmissions: (
    request: ProjectRequirementSubmissionsRequest,
  ) => Promise<ProjectRequirementSubmissionsResult>;
readonly readProjectSubmission: (
    request: ProjectSubmissionDetailRequest,
  ) => Promise<ProjectSubmissionDetailResult>;
readonly deleteProjectTodos: (
    request: ProjectTodoDeleteRequest,
  ) => Promise<ProjectTodoDeleteResult>;
readonly readProjectTodoDetail: (
    request: ProjectTodoDetailRequest,
  ) => Promise<ProjectTodoDetailResult>;
readonly readProjectWorkOverview: (
    request: ProjectWorkOverviewRequest,
  ) => Promise<ProjectWorkOverviewResult>;
readonly getProjectTodoCollaborators: (
    request: ProjectTodoCollaboratorsRequest,
  ) => Promise<ProjectTodoCollaboratorsResult>;
readonly replaceProjectTodoCollaborators: (
    request: ProjectTodoCollaboratorsReplaceRequest,
  ) => Promise<ProjectTodoCollaboratorsReplaceResult>;
readonly listProjectTodoComments: (
    request: ProjectTodoCommentsRequest,
  ) => Promise<ProjectTodoCommentsResult>;
readonly createProjectTodoComment: (
    request: ProjectTodoCommentCreateRequest,
  ) => Promise<ProjectTodoCommentCreateResult>;
readonly previewProjectTodoDeletion: (
    request: ProjectTodoDeletePreviewRequest,
  ) => Promise<ProjectTodoDeletePreviewResult>;
readonly setProjectTodoAcceptanceItems: (
    request: ProjectTodoAcceptanceSetRequest,
  ) => Promise<ProjectTodoAcceptanceSetResult>;
readonly submitProjectTodoReview: (
    request: ProjectTodoSubmitReviewRequest,
  ) => Promise<ProjectTodoSubmitReviewResult>;
readonly reviewProjectTodo: (
    request: ProjectTodoReviewRequest,
  ) => Promise<ProjectTodoReviewResult>;
readonly listProjectTodoDrafts: (
    request: ProjectTodoDraftListRequest,
  ) => Promise<ProjectTodoDraftListResult>;
readonly createProjectTodoDrafts: (
    request: ProjectTodoDraftCreateRequest,
  ) => Promise<ProjectTodoDraftCreateResult>;
readonly dropProjectTodoDraft: (
    request: ProjectTodoDraftDropRequest,
  ) => Promise<ProjectTodoDraftDropResult>;
readonly resolveProjectTodoDrafts: (
    request: ProjectTodoDraftResolveRequest,
  ) => Promise<ProjectTodoDraftResolveResult>;
readonly listProjectFiles: (request: ProjectFileListRequest) => Promise<ProjectFileListResult>;
readonly uploadProjectFile: (
    request: ProjectFileUploadRequest,
  ) => Promise<ProjectFileUploadResult>;
readonly cancelProjectFileUpload: (
    request: ProjectFileUploadCancelRequest,
  ) => Promise<ProjectFileUploadCancelResult>;
readonly onProjectFileUploadProgress: (
    listener: (progress: ProjectFileUploadProgress) => void,
  ) => () => void;
readonly downloadProjectFile: (
    request: ProjectFileDownloadRequest,
  ) => Promise<ProjectFileDownloadResult>;
readonly promoteProjectFile: (
    request: ProjectFilePromoteRequest,
  ) => Promise<ProjectFilePromoteResult>;
readonly deleteProjectFile: (
    request: ProjectFileDeleteRequest,
  ) => Promise<ProjectFileDeleteResult>;
readonly listProjectAssets: (request: ProjectAssetListRequest) => Promise<ProjectAssetListResult>;
readonly listProjectAssetVersions: (
    request: ProjectAssetVersionChainRequest,
  ) => Promise<ProjectAssetVersionChainResult>;
readonly resolveProjectAssetVersion: (
    request: ProjectAssetVersionResolveRequest,
  ) => Promise<ProjectAssetVersionResolveResult>;
readonly registerProjectAssetVersion: (
    request: ProjectAssetVersionRegisterRequest,
  ) => Promise<ProjectAssetVersionRegisterResult>;
readonly deleteProjectAsset: (
    request: ProjectAssetDeleteRequest,
  ) => Promise<ProjectAssetDeleteResult>;
readonly uploadProjectAssetVersion: (
    request: ProjectAssetVersionUploadRequest,
  ) => Promise<ProjectAssetVersionUploadResult>;
readonly cancelProjectAssetVersionUpload: (
    request: ProjectAssetUploadAttemptDiscardRequest,
  ) => Promise<ProjectAssetUploadAttemptDiscardResult>;
readonly resumeProjectAssetVersionUpload: (
    request: ProjectAssetVersionUploadResumeRequest,
  ) => Promise<ProjectAssetVersionUploadResult>;
readonly discardProjectAssetVersionUpload: (
    request: ProjectAssetUploadAttemptDiscardRequest,
  ) => Promise<ProjectAssetUploadAttemptDiscardResult>;
readonly previewProjectAssetVersion: (
    request: ProjectAssetVersionPreviewRequest,
  ) => Promise<ProjectAssetVersionPreviewResult>;
readonly listProjectAssetTrash: (
    request: ProjectAssetTrashListRequest,
  ) => Promise<ProjectAssetTrashListResult>;
readonly restoreProjectAsset: (
    request: ProjectAssetRestoreRequest,
  ) => Promise<ProjectAssetRestoreResult>;
readonly restoreProjectAssetVersion: (
    request: ProjectAssetVersionRestoreRequest,
  ) => Promise<ProjectAssetVersionRestoreResult>;
readonly onProjectEvent: (listener: (event: ProjectEvent) => void) => () => void;
readonly readProjectNotificationSettings: () => Promise<ProjectNotificationSettings>;
readonly writeProjectNotificationSettings: (
    input: ProjectNotificationSettingsUpdate,
  ) => Promise<ProjectNotificationSettings>;
readonly onProjectNotificationNavigate: (
    listener: (request: ProjectNotificationNavigate) => void,
  ) => () => void;
readonly onProjectJoinLink: (listener: (event: ProjectJoinLinkEvent) => void) => () => void;
readonly listProjectDataSources: (
    request: ProjectDataSourceListRequest,
  ) => Promise<ProjectDataSourceListResult>;
readonly createProjectDataSource: (
    request: ProjectDataSourceCreateRequest,
  ) => Promise<ProjectDataSourceCreateResult>;
readonly updateProjectDataSource: (
    request: ProjectDataSourceUpdateRequest,
  ) => Promise<ProjectDataSourceUpdateResult>;
readonly deleteProjectDataSource: (
    request: ProjectDataSourceDeleteRequest,
  ) => Promise<ProjectDataSourceDeleteResult>;
readonly syncProjectDataSource: (
    request: ProjectDataSourceSyncRequest,
  ) => Promise<ProjectDataSourceSyncResult>;
readonly saveProjectDataSourceTicket: (
    request: ProjectDataSourceTicketSaveRequest,
  ) => Promise<ProjectDataSourceTicketResult>;
readonly clearProjectDataSourceTicket: (
    request: ProjectDataSourceTicketClearRequest,
  ) => Promise<ProjectDataSourceTicketResult>;
readonly listProjectExternalLinks: (
    request: ProjectExternalLinkListRequest,
  ) => Promise<ProjectExternalLinkListResult>;
readonly generateProjectTodoSpec: (
    request: ProjectSpecAssistRequest,
  ) => Promise<ProjectSpecAssistResult>;
readonly cancelProjectTodoSpec: (
    request: ProjectSpecAssistCancelRequest,
  ) => Promise<ProjectSpecAssistCancelResult>;
readonly readProjectTodoSpecReadiness: () => Promise<ProjectSpecAssistReadinessResult>;
}
