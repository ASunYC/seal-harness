import { describe, expect, it, vi } from 'vitest';

import { IPC } from '../../../../stratex/shared/ipc/channels.js';
import { PROJECT_COLLAB_REFERENCE_CODES } from '../../../../stratex/shared/protocol/project-collab.js';
import { createCollabClient } from '../../../../stratex/main/services/collab/collabClient.js';
import type {
  ProjectDetail,
  ProjectOpenInvitation,
  ProjectSummary,
  Todo,
  TodoAcceptanceItem,
  TodoCompletionRecord,
  TodoDraftBatch,
} from '../../../../stratex/shared/protocol/project-collab.js';
import {
  registerProjectCollabHandlers,
  type ProjectCollabClientPort,
  type ProjectCollabIpcDependencies,
  type ProjectNotificationSettingsPort,
} from '../../../../stratex/main/ipc/projectCollabHandlers.js';
import type { ProjectPlanningClientPort } from '../../../../stratex/main/ipc/projectCollabHandlersPlanning.js';
import type { ProjectTestCaseClientPort } from '../../../../stratex/main/ipc/projectCollabHandlersTestCases.js';
import type { ProjectTestingClientPort } from '../../../../stratex/main/ipc/projectCollabHandlersTesting.js';

const TEST_BASE_URL = 'https://collab.test/';
const TEST_SERVICE_URL = 'https://collab.test/service/';

const PROJECT_ID = '11111111-1111-4111-8111-111111111111';
const ENTITY_ID = '22222222-2222-4222-8222-222222222222';
const OPERATION_ID = '33333333-3333-4333-8333-333333333333';
const INVITATION_ID = '44444444-4444-4444-8444-444444444444';

const collaborationWireCases = [
  {
    channel: IPC.PROJECT_TODO_COLLABORATORS,
    request: { todoId: ENTITY_ID },
    path: `todos/${ENTITY_ID}/collaborators`,
    method: 'GET',
    wire: { todo_id: ENTITY_ID, version: 2, collaborators: [] },
    result: { ok: true, todoId: ENTITY_ID, version: 2, collaborators: [] },
    body: undefined,
  },
  {
    channel: IPC.PROJECT_TODO_COLLABORATORS_REPLACE,
    request: { todoId: ENTITY_ID, expectedVersion: 1, clientRequestId: OPERATION_ID, subjects: [] },
    path: `todos/${ENTITY_ID}/collaborators`,
    method: 'PUT',
    wire: { todo_id: ENTITY_ID, version: 2, collaborators: [], replayed: true },
    result: { ok: true, todoId: ENTITY_ID, version: 2, collaborators: [], replayed: true },
    body: { expected_version: 1, client_request_id: OPERATION_ID, subjects: [] },
  },
  {
    channel: IPC.PROJECT_TODO_COMMENTS,
    request: { todoId: ENTITY_ID, limit: 20 },
    path: `todos/${ENTITY_ID}/comments?limit=20`,
    method: 'GET',
    wire: { comments: [], next_cursor: null },
    result: { ok: true, comments: [], nextCursor: null },
    body: undefined,
  },
  {
    channel: IPC.PROJECT_TODO_COMMENT_CREATE,
    request: { todoId: ENTITY_ID, clientRequestId: OPERATION_ID, bodyMd: '讨论内容', refs: [] },
    path: `todos/${ENTITY_ID}/comments`,
    method: 'POST',
    wire: {
      comment: {
        id: OPERATION_ID,
        todo_id: ENTITY_ID,
        author_subject: 'alice',
        author_display_name: '项目成员',
        body_md: '讨论内容',
        refs: [],
        created_at: '2026-09-15T00:00:00Z',
      },
      replayed: false,
    },
    result: {
      ok: true,
      comment: {
        id: OPERATION_ID,
        todoId: ENTITY_ID,
        authorSubject: 'alice',
        authorDisplayName: '项目成员',
        bodyMd: '讨论内容',
        refs: [],
        createdAt: '2026-09-15T00:00:00Z',
      },
      replayed: false,
    },
    body: { client_request_id: OPERATION_ID, body_md: '讨论内容', refs: [] },
  },
  {
    channel: IPC.PROJECT_TODO_DELETE_PREVIEW,
    request: { projectId: PROJECT_ID, ids: [ENTITY_ID] },
    path: `projects/${PROJECT_ID}/todos/delete-preview`,
    method: 'POST',
    wire: {
      root_ids: [ENTITY_ID],
      requirement_count: 1,
      task_count: 2,
      test_round_count: 1,
      test_case_count: 3,
      active_round_count: 0,
      can_delete: true,
    },
    result: {
      ok: true,
      rootIds: [ENTITY_ID],
      requirementCount: 1,
      taskCount: 2,
      testRoundCount: 1,
      testCaseCount: 3,
      activeRoundCount: 0,
      canDelete: true,
    },
    body: { ids: [ENTITY_ID] },
  },
] as const;

const OPEN_INVITATION: ProjectOpenInvitation = {
  id: INVITATION_ID,
  role: 'editor',
  expiresAt: '2026-09-06T00:00:00.000Z',
  maxUses: 10,
  usesCount: 2,
  createdBySubject: 'user-alice',
  createdByDisplayName: '张三',
  createdAt: '2026-09-05T00:00:00.000Z',
};
const UPLOAD_EVENT = { sender: { send: vi.fn(), isDestroyed: () => false } };

const SUMMARY: ProjectSummary = {
  id: PROJECT_ID,
  name: '赛道服务联合调试',
  summary: '两周内跑通双账号闭环。',
  myRole: 'owner',
  archivedAt: null,
  memberCount: 3,
  memberPreview: [{ subject: 'user-alice', displayName: '张三' }],
  unreadCount: 0,
  lastActivityAt: null,
  createdAt: '2026-08-01T08:00:00.000Z',
};

const TODO: Todo = {
  id: ENTITY_ID,
  itemKind: 'requirement',
  parentId: null,
  source: 'manual',
  visibility: 'shared',
  title: '整理联调纪要',
  status: 'inProgress',
  assigneeKind: 'member',
  assigneeSubject: null,
  assigneeDisplayName: null,
  priority: 'medium',
  labels: [],
  startAt: null,
  dueAt: null,
  description: '',
  sessionRef: null,
  refs: [],
  constraintsText: '',
  acceptanceTotal: 0,
  acceptanceChecked: 0,
  childTotal: 0,
  childDone: 0,
  version: 3,
  createdAt: '2026-08-24T08:00:00.000Z',
  updatedAt: '2026-08-24T11:00:00.000Z',
};

/** 工作单三件：验收判据 / 完成记录 / 草案批次（各通道成功载荷）。 */
const ACCEPTANCE_ITEM: TodoAcceptanceItem = {
  ordinal: 1,
  text: '纪要里逐条列出待办与责任人',
  checked: false,
  checkedBySubject: null,
  checkedAt: null,
  executorNote: '',
};

const COMPLETION_RECORD: TodoCompletionRecord = {
  id: '33333333-3333-4333-8333-333333333333',
  entryKind: 'completion',
  authorSubject: 'user-alice',
  authorDisplayName: '张三',
  summary: '纪要已整理并归档到项目资产',
  artifacts: [],
  createdAt: '2026-08-29T08:00:00.000Z',
};

const DRAFT_BATCH: TodoDraftBatch = {
  id: '44444444-4444-4444-8444-444444444444',
  projectId: PROJECT_ID,
  sourceTodoId: ENTITY_ID,
  targetItemKind: 'task',
  parentId: ENTITY_ID,
  createdBySubject: 'user-alice',
  dispatcherSubject: 'user-alice',
  state: 'open',
  confirmedAt: null,
  discardedAt: null,
  discardedBySubject: null,
  createdAt: '2026-08-29T08:00:00.000Z',
  updatedAt: '2026-08-29T08:00:00.000Z',
  drafts: [
    {
      id: '55555555-5555-4555-8555-555555555555',
      ordinal: 1,
      title: '核对入库字段',
      description: '',
      basis: 'input',
      constraintsText: '',
      acceptanceItems: ['字段与规范逐项对齐'],
      priority: 'medium',
      state: 'pending',
      todoId: null,
      droppedAt: null,
      droppedBySubject: null,
    },
  ],
};

const MEMBER_SUBJECT = 'user-bob';

/** 成员管理四条同形回权威详情：这是它们的成功载荷。 */
const DETAIL: ProjectDetail = {
  id: PROJECT_ID,
  name: '赛道服务联合调试',
  instructionsText: '',
  myRole: 'owner',
  archivedAt: null,
  createdAt: '2026-08-01T08:00:00.000Z',
  members: [
    {
      subject: MEMBER_SUBJECT,
      displayName: '李四',
      role: 'viewer',
      state: 'active',
      joinedAt: '2026-08-02T08:00:00.000Z',
    },
  ],
};

const CONVENTIONS = {
  aiEntryRules: '闲聊不自动录入；先展示草稿再确认。',
  ruleVersion: 2,
  publishedAt: '2026-09-01T00:00:00.000Z',
};

const FILE = {
  id: ENTITY_ID,
  kind: 'temp',
  source: 'manual',
  filename: '纪要.docx',
  mime: 'application/octet-stream',
  bytes: 4,
  sha256: '0123456789abcdef'.repeat(4),
  uploaderSubject: 'user-alice',
  uploaderDisplayName: '张三',
  createdAt: '2026-08-24T08:00:00.000Z',
  expiresAt: null,
} as const;

type Handler = (event: unknown, input: unknown) => Promise<unknown>;

/** 规划域端口的最小替身：十五条都回瞬时失败（本文件不覆盖它们）。 */
function fakePlanningPort(): ProjectPlanningClientPort {
  const refuse = vi.fn(async () => ({ ok: false as const, code: 'transient' as const }));
  return {
    listMilestones: refuse,
    createMilestone: refuse,
    updateMilestone: refuse,
    listIterations: refuse,
    createIteration: refuse,
    updateIteration: refuse,
    // 迭代 ↔ 需求关联历史三条（判据在 projectCollabHandlersPlanning.test.ts）。
    listIterationRequirements: refuse,
    linkIterationRequirement: refuse,
    unlinkIterationRequirement: refuse,
    // 迭代排期整批保存（判据在 projectCollabHandlersPlanning.test.ts）。
    saveIterationSchedule: refuse,
    // 安排需求整批保存与需求排期现状（MIL-09，判据同在 projectCollabHandlersPlanning.test.ts）。
    saveRequirementSchedule: refuse,
    listRequirementPlacements: refuse,
    // 生命周期六条（MIL-07，判据同在 projectCollabHandlersPlanning.test.ts）。
    completeMilestone: refuse,
    reopenMilestone: refuse,
    completeIteration: refuse,
    reopenIteration: refuse,
    listMilestoneEvents: refuse,
    listIterationEvents: refuse,
  };
}

/** 整需求提测域端口的最小替身：三条都回瞬时失败（判据在 projectCollabHandlersTesting.test.ts）。 */
function fakeTestingPort(): ProjectTestingClientPort & ProjectTestCaseClientPort {
  const refuse = vi.fn(async () => ({ ok: false as const, code: 'transient' as const }));
  return {
    actOnTestRound: refuse,
    listTestRoundActions: refuse,
    listProjectTestRounds: refuse,
    executeTestCase: refuse,
    listTestExecutions: refuse,
    actOnTestDefect: refuse,
    listTestDefects: refuse,
    fetchTestDefect: refuse,
    submitRequirementForTest: refuse,
    listRequirementSubmissions: refuse,
    fetchRequirementSubmission: refuse,
    listRoundTestCases: refuse,
    createRoundTestCase: refuse,
    updateTestCase: refuse,
    copyPreviousRoundTestCases: refuse,
    listRequirementTestCaseCounts: refuse,
  };
}

function fakeClient(overrides: Partial<ProjectCollabClientPort> = {}): ProjectCollabClientPort {
  const base: ProjectCollabClientPort = {
    listProjects: vi.fn(async () => ({ ok: true as const, value: [SUMMARY] })),
    createProject: vi.fn(async () => ({ ok: false as const, code: 'transient' as const })),
    readProjectDetail: vi.fn(async () => ({ ok: false as const, code: 'transient' as const })),
    updateProject: vi.fn(async () => ({ ok: false as const, code: 'transient' as const })),
    readConventions: vi.fn(async () => ({ ok: true as const, value: CONVENTIONS })),
    updateConventions: vi.fn(async () => ({ ok: true as const, value: CONVENTIONS })),
    readSubmissionGate: vi.fn(async () => ({ ok: false as const, code: 'transient' as const })),
    updateSubmissionGate: vi.fn(async () => ({ ok: false as const, code: 'transient' as const })),
    createInvitation: vi.fn(async () => ({
      ok: true as const,
      value: {
        code: 'INV-PLAIN',
        expiresAt: '2026-08-25T08:00:00.000Z',
        invitationId: INVITATION_ID,
        kind: 'single' as const,
        maxUses: null,
      },
    })),
    redeemInvitation: vi.fn(async () => ({
      ok: true as const,
      value: { projectId: PROJECT_ID, role: 'viewer' as const },
    })),
    listOpenInvitations: vi.fn(async () => ({ ok: true as const, value: [OPEN_INVITATION] })),
    revokeInvitation: vi.fn(async () => ({
      ok: true as const,
      value: { projectId: PROJECT_ID, invitationId: INVITATION_ID },
    })),
    updateMemberRole: vi.fn(async () => ({ ok: true as const, value: DETAIL })),
    removeMember: vi.fn(async () => ({ ok: true as const, value: DETAIL })),
    transferOwnership: vi.fn(async () => ({ ok: true as const, value: DETAIL })),
    setProjectArchived: vi.fn(async () => ({ ok: true as const, value: DETAIL })),
    listFeed: vi.fn(async () => ({ ok: true as const, value: [] })),
    postFeedEntry: vi.fn(async () => ({ ok: false as const, code: 'forbidden' as const })),
    postFeedComment: vi.fn(async () => ({ ok: false as const, code: 'transient' as const })),
    listChatHistory: vi.fn(async () => ({ ok: true as const, value: [] })),
    searchChatHistory: vi.fn(async () => ({
      ok: true as const,
      value: { messages: [], searchPage: { nextCursor: null } },
    })),
    sendChatMessage: vi.fn(async () => ({ ok: false as const, code: 'transient' as const })),
    revokeChatMessage: vi.fn(async () => ({ ok: false as const, code: 'forbidden' as const })),
    setReadCursor: vi.fn(async () => ({ ok: true as const, value: true as const })),
    fetchCapabilities: vi.fn(async () => ({
      ok: true as const,
      value: { capabilities: ['requirement.dictionaries'], serviceVersion: '0.1.0' },
    })),
    fetchProjectTestMode: vi.fn(async () => ({
      ok: true as const,
      value: {
        mode: 'legacy' as const,
        canEnableNewMode: true,
        blockedReasons: [],
        legacyOpenReviewCount: 0,
        testRounds: [],
      },
    })),
    listTodos: vi.fn(async () => ({
      ok: true as const,
      value: { todos: [TODO], hasMore: false, nextCursor: null },
    })),
    readRequirementPage: vi.fn(async () => ({
      ok: true as const,
      value: { items: [TODO], total: 1, page: 1, pageSize: 10 as const, queryRevision: 'rev-test' },
    })),
    createTodo: vi.fn(async () => ({ ok: true as const, value: TODO })),
    updateTodo: vi.fn(async () => ({ ok: true as const, value: TODO })),
    claimRequirement: vi.fn(async () => ({ ok: true as const, value: TODO })),
    deleteTodo: vi.fn(async () => ({
      ok: true as const,
      value: { deletedIds: [ENTITY_ID], count: 1 },
    })),
    deleteTodosBatch: vi.fn(async () => ({
      ok: true as const,
      value: { deletedIds: [ENTITY_ID], count: 1 },
    })),
    getTodoDetail: vi.fn(async () => ({
      ok: true as const,
      value: { todo: TODO, acceptanceItems: [ACCEPTANCE_ITEM], completionRecords: [] },
    })),
    getTodoCollaborators: vi.fn(async () => ({ ok: false as const, code: 'transient' as const })),
    replaceTodoCollaborators: vi.fn(async () => ({
      ok: false as const,
      code: 'transient' as const,
    })),
    listTodoComments: vi.fn(async () => ({ ok: false as const, code: 'transient' as const })),
    createTodoComment: vi.fn(async () => ({ ok: false as const, code: 'transient' as const })),
    previewTodoDeletion: vi.fn(async () => ({ ok: false as const, code: 'transient' as const })),
    readWorkOverview: vi.fn(async () => ({ ok: false as const, code: 'transient' as const })),
    setAcceptanceItems: vi.fn(async () => ({
      ok: true as const,
      value: { todo: TODO, acceptanceItems: [ACCEPTANCE_ITEM] },
    })),
    submitTodoReview: vi.fn(async () => ({
      ok: true as const,
      value: { todo: TODO, completionRecord: COMPLETION_RECORD },
    })),
    reviewTodo: vi.fn(async () => ({
      ok: true as const,
      value: { todo: TODO, completionRecord: null },
    })),
    listDraftBatches: vi.fn(async () => ({ ok: true as const, value: [DRAFT_BATCH] })),
    createDraftBatch: vi.fn(async () => ({ ok: true as const, value: DRAFT_BATCH })),
    dropDraft: vi.fn(async () => ({ ok: true as const, value: DRAFT_BATCH })),
    resolveDraftBatch: vi.fn(async () => ({
      ok: true as const,
      value: { batch: DRAFT_BATCH, todos: [TODO] },
    })),
    listFiles: vi.fn(async () => ({ ok: true as const, value: [] })),
    uploadFile: vi.fn(async () => ({ ok: true as const, value: FILE })),
    downloadFile: vi.fn(async () => ({
      ok: true as const,
      value: { savedPath: 'C:\\Users\\alice\\Downloads\\纪要.docx' },
    })),
    promoteFile: vi.fn(async () => ({ ok: true as const, value: FILE })),
    deleteFile: vi.fn(async () => ({ ok: true as const, value: true as const })),
    // 资产版本域十条方法的最小替身：一律回瞬时失败（本文件不覆盖它们，
    // 逐条判据在 projectCollabHandlersAssets.test.ts）。
    listProjectAssets: vi.fn(async () => ({ ok: false as const, code: 'transient' as const })),
    listAssetVersions: vi.fn(async () => ({ ok: false as const, code: 'transient' as const })),
    getAssetVersion: vi.fn(async () => ({ ok: false as const, code: 'transient' as const })),
    registerAssetVersion: vi.fn(async () => ({ ok: false as const, code: 'transient' as const })),
    deleteAsset: vi.fn(async () => ({ ok: false as const, code: 'transient' as const })),
    downloadFileBytes: vi.fn(async () => ({ ok: false as const, code: 'transient' as const })),
    listDeletedProjectAssets: vi.fn(async () => ({
      ok: false as const,
      code: 'transient' as const,
    })),
    restoreAsset: vi.fn(async () => ({ ok: false as const, code: 'transient' as const })),
    restoreAssetVersion: vi.fn(async () => ({ ok: false as const, code: 'transient' as const })),
  };
  return { ...base, ...overrides };
}

interface HarnessOptions {
  readonly client?: ProjectCollabClientPort;
  readonly dependencies?: ProjectCollabIpcDependencies | null;
  readonly authorize?: (event: unknown) => boolean;
  readonly activeAccount?: () => {
    accountKey: string;
    authEpoch: number;
    subject: string;
  } | null;
  readonly accessToken?: () => Promise<string | null>;
  readonly pickUploadFile?: () => Promise<string | null>;
  readonly notificationSettings?: ProjectNotificationSettingsPort | null;
}

function harness(options: HarnessOptions = {}): {
  readonly handlers: Map<string, Handler>;
  readonly client: ProjectCollabClientPort;
  readonly deps: ProjectCollabIpcDependencies;
} {
  const handlers = new Map<string, Handler>();
  const client = options.client ?? fakeClient();
  const deps: ProjectCollabIpcDependencies = {
    client,
    // 规划域的通道与用例在 projectCollabHandlersPlanning.test.ts；本 harness 只需要
    // 一个形状完整的替身，让装配束类型成立（六条通道在这里一条都不被调用）。
    planning: fakePlanningPort(),
    // 整需求提测域同理：三条通道的判据在 projectCollabHandlersTesting.test.ts。
    testing: fakeTestingPort(),
    accessToken: options.accessToken ?? (async () => 'token'),
    pickUploadFile: options.pickUploadFile ?? (async () => '/input/a.docx'),
    downloadsDirectory: () => 'C:\\Users\\alice\\Downloads',
    openExternalLink: async () => undefined,
  };
  registerProjectCollabHandlers(
    { handle: (channel, listener) => handlers.set(channel, listener) },
    {
      dependencies: options.dependencies === undefined ? deps : options.dependencies,
      notificationSettings:
        options.notificationSettings === undefined ? null : options.notificationSettings,
      authorize: options.authorize ?? (() => true),
      activeAccount:
        options.activeAccount ??
        (() => ({ accountKey: 'acc-1', authEpoch: 1, subject: 'subject-alice' })),
    },
  );
  return { handlers, client, deps };
}

function handlerOf(handlers: Map<string, Handler>, channel: string): Handler {
  const handler = handlers.get(channel);
  if (!handler) throw new Error(`handler missing for ${channel}`);
  return handler;
}

function workOverviewWire(projectId = PROJECT_ID) {
  return {
    counts: { overdue: 2, due_today: 3, incomplete: 8, participating: 4 },
    total: 10,
    items: [
      {
        id: ENTITY_ID,
        project_id: projectId,
        item_kind: 'task',
        parent_id: OPERATION_ID,
        title: '概览中的原任务',
        status: 'inProgress',
        source: 'manual',
        visibility: 'shared',
        assignee_kind: 'member',
        assignee_subject: 'alice',
        assignee_display_name: '项目成员',
        priority: 'medium',
        labels: [],
        due_at: null,
        description: '',
        version: 2,
        created_at: '2026-09-15T00:00:00Z',
        updated_at: '2026-09-15T00:00:00Z',
      },
    ],
    next_cursor: 'next-page',
  };
}

describe('projectCollabHandlers 注册面', () => {
  it.each([IPC.PROJECT_SUBMISSION_GATE_GET, IPC.PROJECT_SUBMISSION_GATE_UPDATE])(
    '%s 在取令牌期间发起帧失效时不调用客户端',
    async (channel) => {
      let frameAllowed = true;
      let resolveToken: (token: string) => void = () => undefined;
      const tokenReady = new Promise<string>((resolve) => {
        resolveToken = resolve;
      });
      const accessToken = vi.fn(() => tokenReady);
      const client = fakeClient();
      const event = {};
      const h = harness({
        client,
        accessToken,
        authorize: (candidate) => candidate === event && frameAllowed,
      });
      const request =
        channel === IPC.PROJECT_SUBMISSION_GATE_GET
          ? { projectId: PROJECT_ID }
          : {
              projectId: PROJECT_ID,
              expectedVersion: 7,
              submissionGate: {
                requireTasks: true,
                requireAllTasksDone: true,
                requireCriteria: true,
                requireReadyArtifacts: true,
              },
            };
      const pending = handlerOf(h.handlers, channel)(event, request);
      await vi.waitFor(() => expect(accessToken).toHaveBeenCalledTimes(1));
      frameAllowed = false;
      resolveToken('token');
      await expect(pending).resolves.toMatchObject({ ok: false, code: 'authRequired' });
      expect(client.readSubmissionGate).not.toHaveBeenCalled();
      expect(client.updateSubmissionGate).not.toHaveBeenCalled();
    },
  );

  it.each(['overdue', 'due_today', 'incomplete', 'participating'] as const)(
    '真实工厂经工作概览聚合映射四桶与 %s 查询',
    async (group) => {
      const fetchImpl = vi.fn<typeof fetch>(
        async () => new Response(JSON.stringify(workOverviewWire())),
      );
      const client = createCollabClient({ baseUrl: TEST_SERVICE_URL, fetchImpl });
      const h = harness({ client });
      await expect(
        handlerOf(h.handlers, IPC.PROJECT_WORK_OVERVIEW)(
          {},
          { projectId: PROJECT_ID, group, limit: 2, cursor: 'previous+/=' },
        ),
      ).resolves.toMatchObject({
        ok: true,
        counts: { overdue: 2, dueToday: 3, incomplete: 8, participating: 4 },
        total: 10,
        items: [
          {
            id: ENTITY_ID,
            projectId: PROJECT_ID,
            title: '概览中的原任务',
            itemKind: 'task',
            parentId: OPERATION_ID,
          },
        ],
        nextCursor: 'next-page',
      });
      expect(fetchImpl).toHaveBeenCalledOnce();
      const call = fetchImpl.mock.calls[0];
      const url = new URL(String(call?.[0]));
      expect(url.pathname).toBe(`/service/api/v1/projects/${PROJECT_ID}/work-overview`);
      expect(Object.fromEntries(url.searchParams)).toEqual({
        group,
        limit: '2',
        cursor: 'previous+/=',
      });
      expect(call?.[1]?.method).toBe('GET');
      expect(call?.[1]?.body).toBeUndefined();
      expect(new Headers(call?.[1]?.headers).get('authorization')).toBe('Bearer token');
    },
  );

  it('真实工作概览聚合拒绝跨项目响应并映射 HTTP 401', async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(JSON.stringify(workOverviewWire(OPERATION_ID))))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ message: 'private detail' }), { status: 401 }),
      );
    const client = createCollabClient({ baseUrl: TEST_BASE_URL, fetchImpl });
    const h = harness({ client });
    const read = handlerOf(h.handlers, IPC.PROJECT_WORK_OVERVIEW);
    await expect(read({}, { projectId: PROJECT_ID })).resolves.toMatchObject({
      ok: false,
      code: 'transient',
    });
    const rejected = await read({}, { projectId: PROJECT_ID });
    expect(rejected).toMatchObject({ ok: false, code: 'credentialRejected' });
    expect(JSON.stringify(rejected)).not.toContain('private detail');
  });

  it.each([
    ['token', 'epoch'],
    ['token', 'account'],
    ['token', 'frame'],
    ['network', 'epoch'],
    ['network', 'account'],
    ['network', 'frame'],
  ] as const)('真实工作概览聚合在 %s 期间重验 %s', async (phase, changed) => {
    let authEpoch = 1;
    let accountKey = 'acc-1';
    let frameAllowed = true;
    const event = {};
    const invalidate = (): void => {
      if (changed === 'epoch') authEpoch = 2;
      if (changed === 'account') accountKey = 'acc-2';
      if (changed === 'frame') frameAllowed = false;
    };
    const fetchImpl = vi.fn<typeof fetch>(async () => {
      if (phase === 'network') invalidate();
      return new Response(JSON.stringify(workOverviewWire()));
    });
    const client = createCollabClient({ baseUrl: TEST_BASE_URL, fetchImpl });
    const h = harness({
      client,
      authorize: (candidate) => candidate === event && frameAllowed,
      activeAccount: () => ({ accountKey, authEpoch, subject: 'alice' }),
      accessToken: async () => {
        if (phase === 'token') invalidate();
        return 'token';
      },
    });
    await expect(
      handlerOf(h.handlers, IPC.PROJECT_WORK_OVERVIEW)(event, { projectId: PROJECT_ID }),
    ).resolves.toMatchObject({ ok: false, code: 'authRequired' });
    expect(fetchImpl).toHaveBeenCalledTimes(phase === 'token' ? 0 : 1);
  });

  it('真实聚合注册工作概览，未装配返回 unavailable', async () => {
    const h = harness({ dependencies: null });
    await expect(
      handlerOf(h.handlers, IPC.PROJECT_WORK_OVERVIEW)({}, { projectId: PROJECT_ID }),
    ).resolves.toMatchObject({ ok: false, code: 'unavailable' });
  });
  it.each(collaborationWireCases)(
    '实际客户端工厂经聚合 $channel 到 HTTP 并映射返回',
    async ({ channel, request, wire, result, path, method, body }) => {
      const fetchImpl = vi.fn<typeof fetch>(
        async () =>
          new Response(JSON.stringify(wire), {
            status: channel === IPC.PROJECT_TODO_COMMENT_CREATE ? 201 : 200,
          }),
      );
      const client = createCollabClient({ baseUrl: TEST_SERVICE_URL, fetchImpl });
      const h = harness({ client });
      await expect(handlerOf(h.handlers, channel)({}, request)).resolves.toEqual(result);
      expect(fetchImpl).toHaveBeenCalledOnce();
      const call = fetchImpl.mock.calls[0];
      expect(String(call?.[0])).toBe(`https://collab.test/service/api/v1/${path}`);
      expect(call?.[1]?.method).toBe(method);
      expect(new Headers(call?.[1]?.headers).get('authorization')).toBe('Bearer token');
      expect(call?.[1]?.body === undefined ? undefined : JSON.parse(String(call[1].body))).toEqual(
        body,
      );
    },
  );

  it.each(collaborationWireCases)(
    '实际聚合 $channel 拒绝未授权及取令牌后的身份变化',
    async ({ channel, request, wire }) => {
      const fetchImpl = vi.fn<typeof fetch>(async () => new Response(JSON.stringify(wire)));
      const client = createCollabClient({ baseUrl: TEST_BASE_URL, fetchImpl });
      const denied = harness({ client, authorize: () => false });
      await expect(handlerOf(denied.handlers, channel)({}, request)).resolves.toMatchObject({
        ok: false,
        code: 'authRequired',
      });
      let epoch = 1;
      const changed = harness({
        client,
        activeAccount: () => ({ accountKey: 'acc-1', authEpoch: epoch, subject: 'alice' }),
        accessToken: async () => {
          epoch = 2;
          return 'token';
        },
      });
      await expect(handlerOf(changed.handlers, channel)({}, request)).resolves.toMatchObject({
        ok: false,
        code: 'authRequired',
      });
      expect(fetchImpl).not.toHaveBeenCalled();
    },
  );

  it.each(collaborationWireCases)(
    '实际聚合 $channel 丢弃网络期间换账号的结果',
    async ({ channel, request, wire }) => {
      let accountKey = 'acc-1';
      const fetchImpl = vi.fn<typeof fetch>(async () => {
        accountKey = 'acc-2';
        return new Response(JSON.stringify(wire), {
          status: channel === IPC.PROJECT_TODO_COMMENT_CREATE ? 201 : 200,
        });
      });
      const client = createCollabClient({ baseUrl: TEST_BASE_URL, fetchImpl });
      const h = harness({
        client,
        activeAccount: () => ({ accountKey, authEpoch: 1, subject: 'alice' }),
      });
      await expect(handlerOf(h.handlers, channel)({}, request)).resolves.toMatchObject({
        ok: false,
        code: 'authRequired',
      });
      expect(fetchImpl).toHaveBeenCalledOnce();
    },
  );

  it.each([
    [IPC.PROJECT_TODO_COLLABORATORS, { todoId: ENTITY_ID }],
    [
      IPC.PROJECT_TODO_COLLABORATORS_REPLACE,
      { todoId: ENTITY_ID, expectedVersion: 1, clientRequestId: OPERATION_ID, subjects: [] },
    ],
    [IPC.PROJECT_TODO_COMMENTS, { todoId: ENTITY_ID }],
    [
      IPC.PROJECT_TODO_COMMENT_CREATE,
      { todoId: ENTITY_ID, clientRequestId: OPERATION_ID, bodyMd: '讨论内容', refs: [] },
    ],
    [IPC.PROJECT_TODO_DELETE_PREVIEW, { projectId: PROJECT_ID, ids: [ENTITY_ID] }],
  ])('真实聚合注册任务协作 %s，未装配返回 unavailable', async (channel, request) => {
    const h = harness({ dependencies: null });
    await expect(handlerOf(h.handlers, channel)({}, request)).resolves.toMatchObject({
      ok: false,
      code: 'unavailable',
    });
  });

  it('routes only the four gate values with the row version and drops a stale account result', async () => {
    let epoch = 1;
    const gate = {
      submissionGate: {
        requireTasks: true,
        requireAllTasksDone: true,
        requireCriteria: true,
        requireReadyArtifacts: false,
      },
      gateVersion: 2,
      ruleVersion: 8,
    };
    const updateSubmissionGate = vi.fn(async () => {
      epoch = 2;
      return { ok: true as const, value: gate };
    });
    const client = { ...fakeClient(), updateSubmissionGate };
    const h = harness({
      client,
      activeAccount: () => ({ accountKey: 'acc-1', subject: 'subject-alice', authEpoch: epoch }),
    });
    expect(h.handlers.has(IPC.PROJECT_SUBMISSION_GATE_UPDATE)).toBe(true);
    const request = {
      projectId: PROJECT_ID,
      submissionGate: gate.submissionGate,
      expectedVersion: 7,
    };
    await expect(
      handlerOf(h.handlers, IPC.PROJECT_SUBMISSION_GATE_UPDATE)({}, request),
    ).resolves.toMatchObject({ ok: false, code: 'authRequired' });
    expect(updateSubmissionGate).toHaveBeenCalledWith('token', request);
  });
  it('注册协作请求通道，包括独立门槛读写；进度、事件和深链只推送', () => {
    const { handlers } = harness();
    // ⚠️ 这个数会随每一组新通道上调：它不是「魔数」而是**注册面总量的断言**——
    //    漏挂一条通道的表现是 invoke 直接 reject（静默不存在），只有总量拦得住。
    // CTX-01 新增项目约定两条（conventions 读 / 发布）；需求分页一条；FLOW-02 认领一条；
    // CORE-05 新增服务能力协商 + 测试模式两条；MIL-06 新增迭代排期整批保存一条；
    // MIL-07 新增规划域生命周期六条与「打开证据里的外部链接」一条（ADR-0036）；
    // RPT-08 新增资产回收站列表 / 回收站恢复 / 历史版本恢复三条；
    // MIL-09 新增安排需求整批保存与需求排期现状两条（ADR-0038）；
    // TST-02 新增整需求提交 / 轮次列表 / 单轮详情三条；
    // TST-04 新增轮次用例列表 / 新建 / 编辑 / 复用上轮 / 各轮条数五条。
    // FLOW-06/07/08 新增任务协作五条。
    // UX-05 工作概览复用同一注册入口。
    // 测试生命周期增加八条固定入口，沿用相同鉴权注册器。
    expect(handlers.size).toBe(102);
    for (const channel of [
      IPC.PROJECT_TEST_ROUND_ACTION,
      IPC.PROJECT_TEST_ROUND_ACTIONS,
      IPC.PROJECT_TEST_ROUNDS,
      IPC.PROJECT_TEST_CASE_EXECUTE,
      IPC.PROJECT_TEST_EXECUTIONS,
      IPC.PROJECT_TEST_DEFECT_ACTION,
      IPC.PROJECT_TEST_DEFECTS,
      IPC.PROJECT_TEST_DEFECT_DETAIL,
      IPC.PROJECT_REQUIREMENT_SUBMIT,
      IPC.PROJECT_REQUIREMENT_SUBMISSIONS,
      IPC.PROJECT_SUBMISSION_DETAIL,
      IPC.PROJECT_ROUND_TEST_CASES,
      IPC.PROJECT_ROUND_TEST_CASE_CREATE,
      IPC.PROJECT_TEST_CASE_UPDATE,
      IPC.PROJECT_ROUND_TEST_CASES_COPY,
      IPC.PROJECT_REQUIREMENT_TEST_CASE_COUNTS,
    ]) {
      expect(handlers.has(channel)).toBe(true);
    }
    expect(handlers.has(IPC.PROJECT_REQUIREMENT_SCHEDULE_SAVE)).toBe(true);
    expect(handlers.has(IPC.PROJECT_REQUIREMENT_PLACEMENT_LIST)).toBe(true);
    for (const channel of [
      IPC.PROJECT_EVIDENCE_LINK_OPEN,
      IPC.PROJECT_MILESTONE_COMPLETE,
      IPC.PROJECT_MILESTONE_REOPEN,
      IPC.PROJECT_ITERATION_COMPLETE,
      IPC.PROJECT_ITERATION_REOPEN,
      IPC.PROJECT_MILESTONE_EVENTS,
      IPC.PROJECT_ITERATION_EVENTS,
    ]) {
      expect(handlers.has(channel)).toBe(true);
    }
    expect(handlers.has(IPC.PROJECT_SERVICE_CAPABILITIES)).toBe(true);
    expect(handlers.has(IPC.PROJECT_TEST_MODE)).toBe(true);
    expect(handlers.has(IPC.PROJECT_CONVENTIONS_GET)).toBe(true);
    expect(handlers.has(IPC.PROJECT_CONVENTIONS_UPDATE)).toBe(true);
    expect(handlers.has(IPC.PROJECT_REQUIREMENT_CLAIM)).toBe(true);
    for (const channel of [
      IPC.PROJECT_TODO_DELETE,
      IPC.PROJECT_TODO_DETAIL,
      IPC.PROJECT_TODO_ACCEPTANCE_SET,
      IPC.PROJECT_TODO_SUBMIT_REVIEW,
      IPC.PROJECT_TODO_REVIEW,
      IPC.PROJECT_TODO_DRAFT_LIST,
      IPC.PROJECT_TODO_DRAFT_CREATE,
      IPC.PROJECT_TODO_DRAFT_DROP,
      IPC.PROJECT_TODO_DRAFT_RESOLVE,
    ]) {
      expect(handlers.has(channel)).toBe(true);
    }
    // 资产版本域十三条（RPT-01 的链 + RPT-02 的上传/续传/预览 + RPT-08 的回收站与恢复）。
    for (const channel of [
      IPC.PROJECT_ASSET_LIST,
      IPC.PROJECT_ASSET_VERSION_LIST,
      IPC.PROJECT_ASSET_VERSION_RESOLVE,
      IPC.PROJECT_ASSET_VERSION_REGISTER,
      IPC.PROJECT_ASSET_DELETE,
      IPC.PROJECT_ASSET_VERSION_UPLOAD,
      IPC.PROJECT_ASSET_VERSION_UPLOAD_CANCEL,
      IPC.PROJECT_ASSET_VERSION_UPLOAD_RESUME,
      IPC.PROJECT_ASSET_VERSION_UPLOAD_DISCARD,
      IPC.PROJECT_ASSET_VERSION_PREVIEW,
      IPC.PROJECT_ASSET_TRASH_LIST,
      IPC.PROJECT_ASSET_RESTORE,
      IPC.PROJECT_ASSET_VERSION_RESTORE,
    ]) {
      expect(handlers.has(channel)).toBe(true);
    }
    expect(handlers.has(IPC.PROJECT_AVAILABILITY)).toBe(true);
    expect(handlers.has(IPC.PROJECT_LIST_OPEN_INVITATIONS)).toBe(true);
    expect(handlers.has(IPC.PROJECT_REVOKE_INVITATION)).toBe(true);
    expect(handlers.has(IPC.PROJECT_NOTIFICATION_SETTINGS_READ)).toBe(true);
    expect(handlers.has(IPC.PROJECT_NOTIFICATION_SETTINGS_WRITE)).toBe(true);
    expect(handlers.has(IPC.PROJECT_NOTIFICATION_NAVIGATE)).toBe(false);
    // 深链是主进程→主窗的单向推送，不是可 invoke 的请求通道。
    expect(handlers.has(IPC.PROJECT_JOIN_LINK)).toBe(false);
    for (const channel of [
      IPC.PROJECT_MEMBER_UPDATE,
      IPC.PROJECT_MEMBER_REMOVE,
      IPC.PROJECT_TRANSFER,
      IPC.PROJECT_ARCHIVE,
    ]) {
      expect(handlers.has(channel)).toBe(true);
    }
    expect(handlers.has(IPC.PROJECT_EVENT)).toBe(false);
    // 规划域六条由本函数**一并挂上**（处理器分文件只为单文件行数）：接线点多一处
    // 就多一个「忘了挂」的可能，而忘了挂的表现是通道静默不存在（invoke 直接 reject）。
    for (const channel of [
      IPC.PROJECT_MILESTONE_LIST,
      IPC.PROJECT_MILESTONE_CREATE,
      IPC.PROJECT_MILESTONE_UPDATE,
      IPC.PROJECT_ITERATION_LIST,
      IPC.PROJECT_ITERATION_CREATE,
      IPC.PROJECT_ITERATION_UPDATE,
      IPC.PROJECT_ITERATION_SCHEDULE_SAVE,
    ]) {
      expect(handlers.has(channel)).toBe(true);
    }
  });
});

describe('projectCollabHandlers 开放邀请通道', () => {
  it('invite：透传 open 的 kind/ttlHours/maxUses，回传 invitationId/kind/maxUses', async () => {
    const createInvitation = vi.fn(async () => ({
      ok: true as const,
      value: {
        code: 'INV-PLAIN',
        expiresAt: '2026-09-06T00:00:00.000Z',
        invitationId: INVITATION_ID,
        kind: 'open' as const,
        maxUses: 10,
      },
    }));
    const { handlers } = harness({ client: fakeClient({ createInvitation }) });
    const result = await handlerOf(handlers, IPC.PROJECT_INVITE)(UPLOAD_EVENT, {
      projectId: PROJECT_ID,
      role: 'editor',
      kind: 'open',
      ttlHours: 24,
      maxUses: 10,
    });
    expect(createInvitation).toHaveBeenCalledWith('token', {
      projectId: PROJECT_ID,
      role: 'editor',
      kind: 'open',
      ttlHours: 24,
      maxUses: 10,
    });
    expect(result).toEqual({
      ok: true,
      code: 'INV-PLAIN',
      expiresAt: '2026-09-06T00:00:00.000Z',
      invitationId: INVITATION_ID,
      kind: 'open',
      maxUses: 10,
    });
  });

  it('invite：open 但 role≠editor 结构性拒（invalidRequest，压根不打网络）', async () => {
    const createInvitation = vi.fn();
    const { handlers } = harness({
      client: fakeClient({ createInvitation: createInvitation as never }),
    });
    const result = (await handlerOf(handlers, IPC.PROJECT_INVITE)(UPLOAD_EVENT, {
      projectId: PROJECT_ID,
      role: 'manager',
      kind: 'open',
      ttlHours: 24,
    })) as { ok: boolean; code?: string };
    expect(result.ok).toBe(false);
    expect(result.code).toBe('invalidRequest');
    expect(createInvitation).not.toHaveBeenCalled();
  });

  it('list-open-invitations：回投影数组（不含 code）', async () => {
    const { handlers } = harness();
    const result = (await handlerOf(handlers, IPC.PROJECT_LIST_OPEN_INVITATIONS)(UPLOAD_EVENT, {
      projectId: PROJECT_ID,
    })) as { ok: boolean; invitations?: unknown[] };
    expect(result).toEqual({ ok: true, invitations: [OPEN_INVITATION] });
    expect(result.invitations?.[0]).not.toHaveProperty('code');
  });

  it('revoke-invitation：回 projectId + invitationId', async () => {
    const { handlers } = harness();
    const result = await handlerOf(handlers, IPC.PROJECT_REVOKE_INVITATION)(UPLOAD_EVENT, {
      invitationId: INVITATION_ID,
    });
    expect(result).toEqual({ ok: true, projectId: PROJECT_ID, invitationId: INVITATION_ID });
  });

  it('revoke-invitation：坏入参 → invalidRequest', async () => {
    const { handlers } = harness();
    const result = (await handlerOf(handlers, IPC.PROJECT_REVOKE_INVITATION)(UPLOAD_EVENT, {
      invitationId: 'not-a-uuid',
    })) as { ok: boolean; code?: string };
    expect(result.ok).toBe(false);
    expect(result.code).toBe('invalidRequest');
  });

  // 失败信封透传服务端业务码 serverCode（渲染层据此分清「已关闭」/「已满员」/「角色不合法」）：
  // 客户端仅 4xx 时从 `{ "error": "<code>" }` 挑出，IPC 失败体原样带出——通用 `code` 分档不变。
  it('invite：失败带回 serverCode（open_invitation_role_not_allowed），通用 code 仍 rejected', async () => {
    const createInvitation = vi.fn(async () => ({
      ok: false as const,
      code: 'rejected' as const,
      serverCode: 'open_invitation_role_not_allowed',
    }));
    const { handlers } = harness({ client: fakeClient({ createInvitation }) });
    const result = (await handlerOf(handlers, IPC.PROJECT_INVITE)(UPLOAD_EVENT, {
      projectId: PROJECT_ID,
      role: 'editor',
      kind: 'open',
      ttlHours: 24,
    })) as { ok: boolean; code?: string; serverCode?: string };
    expect(result.ok).toBe(false);
    expect(result.code).toBe('rejected');
    expect(result.serverCode).toBe('open_invitation_role_not_allowed');
  });

  it('redeem：失败带回 serverCode（invitation_revoked / invitation_exhausted）', async () => {
    const redeemInvitation = vi.fn(async () => ({
      ok: false as const,
      code: 'conflict' as const,
      serverCode: 'invitation_exhausted',
    }));
    const { handlers } = harness({ client: fakeClient({ redeemInvitation }) });
    const result = (await handlerOf(handlers, IPC.PROJECT_REDEEM_INVITATION)(UPLOAD_EVENT, {
      code: 'SJ-K7F2-9Q4D',
    })) as { ok: boolean; code?: string; serverCode?: string };
    expect(result.ok).toBe(false);
    expect(result.code).toBe('conflict');
    expect(result.serverCode).toBe('invitation_exhausted');
  });

  it('revoke：无 serverCode 时失败体不带该键（缺席即不出现）', async () => {
    const revokeInvitation = vi.fn(async () => ({
      ok: false as const,
      code: 'forbidden' as const,
    }));
    const { handlers } = harness({ client: fakeClient({ revokeInvitation }) });
    const result = (await handlerOf(handlers, IPC.PROJECT_REVOKE_INVITATION)(UPLOAD_EVENT, {
      invitationId: INVITATION_ID,
    })) as Record<string, unknown>;
    expect(result.ok).toBe(false);
    expect(result.code).toBe('forbidden');
    expect(Object.prototype.hasOwnProperty.call(result, 'serverCode')).toBe(false);
  });
});

describe('成员管理四通道', () => {
  it('改角色/移除/转让/归档：入参透传客户端，成功同形回权威详情', async () => {
    const { handlers, client } = harness();
    await expect(
      handlerOf(handlers, IPC.PROJECT_MEMBER_UPDATE)(
        {},
        { projectId: PROJECT_ID, subject: MEMBER_SUBJECT, role: 'viewer' },
      ),
    ).resolves.toEqual({ ok: true, project: DETAIL });
    expect(client.updateMemberRole).toHaveBeenCalledWith('token', {
      projectId: PROJECT_ID,
      subject: MEMBER_SUBJECT,
      role: 'viewer',
    });

    await expect(
      handlerOf(handlers, IPC.PROJECT_MEMBER_REMOVE)(
        {},
        { projectId: PROJECT_ID, subject: MEMBER_SUBJECT },
      ),
    ).resolves.toEqual({ ok: true, project: DETAIL });
    expect(client.removeMember).toHaveBeenCalledWith('token', {
      projectId: PROJECT_ID,
      subject: MEMBER_SUBJECT,
    });

    await expect(
      handlerOf(handlers, IPC.PROJECT_TRANSFER)(
        {},
        { projectId: PROJECT_ID, subject: MEMBER_SUBJECT },
      ),
    ).resolves.toEqual({ ok: true, project: DETAIL });
    expect(client.transferOwnership).toHaveBeenCalledWith('token', {
      projectId: PROJECT_ID,
      subject: MEMBER_SUBJECT,
    });

    await expect(
      handlerOf(handlers, IPC.PROJECT_ARCHIVE)({}, { projectId: PROJECT_ID, archived: true }),
    ).resolves.toEqual({ ok: true, project: DETAIL });
    expect(client.setProjectArchived).toHaveBeenCalledWith('token', {
      projectId: PROJECT_ID,
      archived: true,
    });
  });

  it('角色闭集不含 owner：改角色请求想造第二个拥有者会被 strictObject 拒掉', async () => {
    const { handlers, client } = harness();
    const result = (await handlerOf(handlers, IPC.PROJECT_MEMBER_UPDATE)(
      {},
      { projectId: PROJECT_ID, subject: MEMBER_SUBJECT, role: 'owner' },
    )) as { code: string };
    expect(result.code).toBe('invalidRequest');
    expect(client.updateMemberRole).not.toHaveBeenCalled();
  });

  it('请求里夹带账号字段一律拒（红线 1 的结构性载体）', async () => {
    const { handlers, client } = harness();
    for (const channel of [IPC.PROJECT_MEMBER_REMOVE, IPC.PROJECT_TRANSFER]) {
      const result = (await handlerOf(handlers, channel)(
        {},
        { projectId: PROJECT_ID, subject: MEMBER_SUBJECT, accountKey: 'acc-1' },
      )) as { code: string };
      expect(result.code).toBe('invalidRequest');
    }
    const archived = (await handlerOf(handlers, IPC.PROJECT_ARCHIVE)(
      {},
      { projectId: PROJECT_ID, archived: true, accountKey: 'acc-1' },
    )) as { code: string };
    expect(archived.code).toBe('invalidRequest');
    expect(client.removeMember).not.toHaveBeenCalled();
    expect(client.transferOwnership).not.toHaveBeenCalled();
    expect(client.setProjectArchived).not.toHaveBeenCalled();
  });

  it('服务端 403（越权/最后一位拥有者/已归档）→ forbidden + 固定文案', async () => {
    const { handlers } = harness({
      client: fakeClient({
        removeMember: vi.fn(async () => ({ ok: false as const, code: 'forbidden' as const })),
      }),
    });
    const result = (await handlerOf(handlers, IPC.PROJECT_MEMBER_REMOVE)(
      {},
      { projectId: PROJECT_ID, subject: MEMBER_SUBJECT },
    )) as { ok: boolean; code: string; message: string; referenceCode: string };
    expect(result).toMatchObject({ ok: false, code: 'forbidden' });
    expect(result.message.length).toBeGreaterThan(0);
    // 参考编号跟着失败体一起过 IPC：用户抄到的号与登记表里的号必须是同一个
    // （编号表在 shared/protocol，签发点只有 failureBody 一处）。
    expect(result.referenceCode).toBe(PROJECT_COLLAB_REFERENCE_CODES.forbidden);
  });

  it('await 期间换账号 → authRequired，不把上个账号的项目详情发给下个账号', async () => {
    let call = 0;
    const { handlers } = harness({
      activeAccount: () => ({
        accountKey: call++ === 0 ? 'acc-1' : 'acc-2',
        authEpoch: 1,
        subject: 'subject-alice',
      }),
    });
    const result = (await handlerOf(handlers, IPC.PROJECT_TRANSFER)(
      {},
      { projectId: PROJECT_ID, subject: MEMBER_SUBJECT },
    )) as { ok: boolean; code: string };
    expect(result).toMatchObject({ ok: false, code: 'authRequired' });
  });

  it('未装配 → unavailable（fail-safe，管理面同样不报错）', async () => {
    const { handlers } = harness({ dependencies: null });
    await expect(
      handlerOf(handlers, IPC.PROJECT_ARCHIVE)({}, { projectId: PROJECT_ID, archived: false }),
    ).resolves.toMatchObject({ ok: false, code: 'unavailable' });
  });
});

describe('availability', () => {
  it('已装配且已授权 → enabled:true + 本人 subject（UI 撤回/删除显隐判据）', async () => {
    const assembled = harness();
    await expect(handlerOf(assembled.handlers, IPC.PROJECT_AVAILABILITY)({}, {})).resolves.toEqual({
      enabled: true,
      mySubject: 'subject-alice',
    });
  });

  it('未装配/未授权/未登录 → {enabled:false, mySubject:null}（不泄露身份）', async () => {
    const unassembled = harness({ dependencies: null });
    await expect(
      handlerOf(unassembled.handlers, IPC.PROJECT_AVAILABILITY)({}, {}),
    ).resolves.toEqual({ enabled: false, mySubject: null });
    const unauthorized = harness({ authorize: () => false });
    await expect(
      handlerOf(unauthorized.handlers, IPC.PROJECT_AVAILABILITY)({}, {}),
    ).resolves.toEqual({ enabled: false, mySubject: null });
    const loggedOut = harness({ activeAccount: () => null });
    await expect(handlerOf(loggedOut.handlers, IPC.PROJECT_AVAILABILITY)({}, {})).resolves.toEqual({
      enabled: false,
      mySubject: null,
    });
  });
});

describe('通用闸门', () => {
  it('未授权 → authRequired（不触网）', async () => {
    const { handlers, client } = harness({ authorize: () => false });
    const result = (await handlerOf(handlers, IPC.PROJECT_LIST)({}, {})) as { code: string };
    expect(result.code).toBe('authRequired');
    expect(client.listProjects).not.toHaveBeenCalled();
  });

  it('未装配 → unavailable（fail-safe，不报错）', async () => {
    const { handlers } = harness({ dependencies: null });
    const result = (await handlerOf(handlers, IPC.PROJECT_LIST)({}, {})) as {
      ok: boolean;
      code: string;
    };
    expect(result).toMatchObject({ ok: false, code: 'unavailable' });
  });

  it('入参不合 strictObject → invalidRequest（不触网）', async () => {
    const { handlers, client } = harness();
    const withAccount = (await handlerOf(handlers, IPC.PROJECT_LIST)(
      {},
      { accountKey: 'a-1' },
    )) as { code: string };
    expect(withAccount.code).toBe('invalidRequest');
    const emptyName = (await handlerOf(handlers, IPC.PROJECT_CREATE)({}, { name: '' })) as {
      code: string;
    };
    expect(emptyName.code).toBe('invalidRequest');
    expect(client.listProjects).not.toHaveBeenCalled();
    expect(client.createProject).not.toHaveBeenCalled();
  });

  it('取不到令牌 → credentialRejected（已登录但刷新失败）', async () => {
    const { handlers, client } = harness({ accessToken: async () => null });
    const result = (await handlerOf(handlers, IPC.PROJECT_LIST)({}, {})) as { code: string };
    expect(result.code).toBe('credentialRejected');
    expect(client.listProjects).not.toHaveBeenCalled();
  });

  it('客户端抛异常 → 收敛为 transient，不跨 IPC 泄露', async () => {
    const client = fakeClient({
      listProjects: vi.fn(async () => {
        throw new Error('secret internal detail');
      }),
    });
    const { handlers } = harness({ client });
    const result = (await handlerOf(handlers, IPC.PROJECT_LIST)({}, {})) as {
      code: string;
      message: string;
    };
    expect(result.code).toBe('transient');
    expect(result.message).not.toContain('secret');
  });
});

describe('账号防串（await 后重验 accountKey + authEpoch）', () => {
  it('await 期间换账号 → authRequired，不把上个账号的数据给下个账号', async () => {
    const accounts = [
      { accountKey: 'acc-1', authEpoch: 1, subject: 'subject-alice' },
      { accountKey: 'acc-2', authEpoch: 1, subject: 'subject-bob' },
    ];
    let call = 0;
    const { handlers } = harness({
      activeAccount: () => accounts[Math.min(call++, accounts.length - 1)]!,
    });
    const result = (await handlerOf(handlers, IPC.PROJECT_LIST)({}, {})) as { code: string };
    expect(result.code).toBe('authRequired');
  });

  it('同账号但 authEpoch 变化（重登）→ authRequired', async () => {
    let call = 0;
    const { handlers } = harness({
      activeAccount: () => ({
        accountKey: 'acc-1',
        authEpoch: call++ === 0 ? 1 : 2,
        subject: 'subject-alice',
      }),
    });
    const result = (await handlerOf(handlers, IPC.PROJECT_LIST)({}, {})) as { code: string };
    expect(result.code).toBe('authRequired');
  });

  it('await 期间登出 → authRequired', async () => {
    let call = 0;
    const { handlers } = harness({
      activeAccount: () =>
        call++ === 0 ? { accountKey: 'acc-1', authEpoch: 1, subject: 'subject-alice' } : null,
    });
    const result = (await handlerOf(handlers, IPC.PROJECT_LIST)({}, {})) as { code: string };
    expect(result.code).toBe('authRequired');
  });
});

describe('成功链路与结果组装', () => {
  it('list：客户端投影嵌进结果信封', async () => {
    const { handlers } = harness();
    await expect(handlerOf(handlers, IPC.PROJECT_LIST)({}, {})).resolves.toEqual({
      ok: true,
      projects: [SUMMARY],
    });
  });

  it('service-capabilities：能力清单嵌进结果信封（CORE-05）', async () => {
    const { handlers, client } = harness();
    await expect(handlerOf(handlers, IPC.PROJECT_SERVICE_CAPABILITIES)({}, {})).resolves.toEqual({
      ok: true,
      capabilities: { capabilities: ['requirement.dictionaries'], serviceVersion: '0.1.0' },
    });
    expect(client.fetchCapabilities).toHaveBeenCalledWith('token');
  });

  it('test-mode：迁移就绪判定嵌进结果信封（CORE-05）', async () => {
    const { handlers, client } = harness();
    await expect(
      handlerOf(handlers, IPC.PROJECT_TEST_MODE)({}, { projectId: PROJECT_ID }),
    ).resolves.toEqual({
      ok: true,
      testMode: {
        mode: 'legacy',
        canEnableNewMode: true,
        blockedReasons: [],
        legacyOpenReviewCount: 0,
        testRounds: [],
      },
    });
    expect(client.fetchProjectTestMode).toHaveBeenCalledWith('token', { projectId: PROJECT_ID });
  });

  it('客户端失败码原样入信封 + 固定文案（不透传服务端文本）', async () => {
    const { handlers } = harness();
    const result = (await handlerOf(handlers, IPC.PROJECT_FEED_POST)(
      {},
      { projectId: PROJECT_ID, bodyMd: '动态' },
    )) as { ok: boolean; code: string; message: string };
    expect(result.ok).toBe(false);
    expect(result.code).toBe('forbidden');
    expect(result.message.length).toBeGreaterThan(0);
  });

  it('conventions-get：客户端投影嵌进结果信封（CTX-01）', async () => {
    const { handlers, client } = harness();
    await expect(
      handlerOf(handlers, IPC.PROJECT_CONVENTIONS_GET)({}, { projectId: PROJECT_ID }),
    ).resolves.toEqual({ ok: true, conventions: CONVENTIONS });
    expect(client.readConventions).toHaveBeenCalledWith('token', { projectId: PROJECT_ID });
    // ⛔ 发布是另一条路：读约定不得顺手打到改说明或发布通道。
    expect(client.updateProject).not.toHaveBeenCalled();
    expect(client.updateConventions).not.toHaveBeenCalled();
  });

  it('conventions-update：发布走 updateConventions（乐观锁），⛔ 不复用 project:update', async () => {
    const { handlers, client } = harness();
    const result = await handlerOf(handlers, IPC.PROJECT_CONVENTIONS_UPDATE)(
      {},
      { projectId: PROJECT_ID, aiEntryRules: '第三版规则', expectedVersion: 2 },
    );
    expect(result).toEqual({ ok: true, conventions: CONVENTIONS });
    expect(client.updateConventions).toHaveBeenCalledWith('token', {
      projectId: PROJECT_ID,
      aiEntryRules: '第三版规则',
      expectedVersion: 2,
    });
    // 两条保存路径互不串：发布规则那次没有回头打改说明/改名的 project:update。
    expect(client.updateProject).not.toHaveBeenCalled();
  });

  it('conventions-update 冲突：409 原样入信封（conflict），供渲染层保留草稿并提示刷新', async () => {
    const conflicted = harness({
      client: fakeClient({
        updateConventions: vi.fn(async () => ({ ok: false as const, code: 'conflict' as const })),
      }),
    });
    await expect(
      handlerOf(conflicted.handlers, IPC.PROJECT_CONVENTIONS_UPDATE)(
        {},
        { projectId: PROJECT_ID, aiEntryRules: '第三版规则', expectedVersion: 2 },
      ),
    ).resolves.toMatchObject({ ok: false, code: 'conflict', referenceCode: 'STRX-COLLAB-006' });
  });

  it('todo-update 冲突：conflict + currentVersion；其余失败码 currentVersion 恒 null', async () => {
    const conflicted = harness({
      client: fakeClient({
        updateTodo: vi.fn(async () => ({
          ok: false as const,
          code: 'conflict' as const,
          currentVersion: 4,
        })),
      }),
    });
    await expect(
      handlerOf(conflicted.handlers, IPC.PROJECT_TODO_UPDATE)(
        {},
        { todoId: ENTITY_ID, expectedVersion: 3, status: 'done' },
      ),
    ).resolves.toMatchObject({ ok: false, code: 'conflict', currentVersion: 4 });
    const transient = harness({
      client: fakeClient({
        updateTodo: vi.fn(async () => ({ ok: false as const, code: 'transient' as const })),
      }),
    });
    await expect(
      handlerOf(transient.handlers, IPC.PROJECT_TODO_UPDATE)(
        {},
        { todoId: ENTITY_ID, expectedVersion: 3, status: 'done' },
      ),
    ).resolves.toMatchObject({ ok: false, code: 'transient', currentVersion: null });
  });

  // CORE-08（ADR-0042）：待办写入的日期类业务码同为 400 rejected，只有 serverCode 分得开两句提示。
  it('todo-create / todo-update：失败体透传 serverCode（start_requires_due 与 invalid_date_range 不塌缩）', async () => {
    const rejected = harness({
      client: fakeClient({
        createTodo: vi.fn(async () => ({
          ok: false as const,
          code: 'rejected' as const,
          serverCode: 'start_requires_due',
        })),
        updateTodo: vi.fn(async () => ({
          ok: false as const,
          code: 'rejected' as const,
          serverCode: 'invalid_date_range',
        })),
      }),
    });
    await expect(
      handlerOf(rejected.handlers, IPC.PROJECT_TODO_CREATE)(
        {},
        {
          projectId: PROJECT_ID,
          itemKind: 'requirement',
          title: '只有开始',
          startAt: '2026-09-14',
        },
      ),
    ).resolves.toMatchObject({ ok: false, code: 'rejected', serverCode: 'start_requires_due' });
    await expect(
      handlerOf(rejected.handlers, IPC.PROJECT_TODO_UPDATE)(
        {},
        { todoId: ENTITY_ID, expectedVersion: 3, startAt: '2026-09-20' },
      ),
    ).resolves.toMatchObject({
      ok: false,
      code: 'rejected',
      serverCode: 'invalid_date_range',
      currentVersion: null,
    });
  });

  it('requirement-page：计划时间段原样交给客户端；倒挂的时间段在入站判 invalidRequest、不发请求', async () => {
    const { handlers, client } = harness();
    const window = { planFrom: '2026-08-31T00:00:00.000Z', planTo: '2026-10-12T00:00:00.000Z' };

    await expect(
      handlerOf(handlers, IPC.PROJECT_REQUIREMENT_PAGE)(
        {},
        { projectId: PROJECT_ID, page: 1, pageSize: 20, ...window },
      ),
    ).resolves.toMatchObject({ ok: true, total: 1 });
    expect(client.readRequirementPage).toHaveBeenCalledWith('token', {
      projectId: PROJECT_ID,
      page: 1,
      pageSize: 20,
      ...window,
    });

    await expect(
      handlerOf(handlers, IPC.PROJECT_REQUIREMENT_PAGE)(
        {},
        {
          projectId: PROJECT_ID,
          page: 1,
          pageSize: 20,
          planFrom: window.planTo,
          planTo: window.planFrom,
        },
      ),
    ).resolves.toMatchObject({ ok: false, code: 'invalidRequest' });
    expect(client.readRequirementPage).toHaveBeenCalledTimes(1);
  });

  it('requirement-claim：成功回 todo；已被认领原样透传 conflict + serverCode，⛔ 不折成成功', async () => {
    const { handlers, client } = harness();
    const claimed = await handlerOf(handlers, IPC.PROJECT_REQUIREMENT_CLAIM)(
      {},
      { todoId: ENTITY_ID, startAt: '2026-09-14', dueAt: null },
    );
    expect(client.claimRequirement).toHaveBeenCalledWith('token', {
      todoId: ENTITY_ID,
      startAt: '2026-09-14',
      dueAt: null,
    });
    expect(claimed).toMatchObject({ ok: true });

    // 已被他人认领：服务端 409 requirement_already_claimed。失败体必须**仍是失败**
    // （code conflict + serverCode 透传），⛔ 绝不在 IPC 层把它折成 { ok: true }。
    const contested = harness({
      client: fakeClient({
        claimRequirement: vi.fn(async () => ({
          ok: false as const,
          code: 'conflict' as const,
          serverCode: 'requirement_already_claimed',
        })),
      }),
    });
    await expect(
      handlerOf(contested.handlers, IPC.PROJECT_REQUIREMENT_CLAIM)({}, { todoId: ENTITY_ID }),
    ).resolves.toMatchObject({
      ok: false,
      code: 'conflict',
      serverCode: 'requirement_already_claimed',
    });
  });

  it('todo-delete：单条走单条端点、批量走批量端点，两端同形回 deletedIds/count', async () => {
    const { handlers, client } = harness();
    // 单条：ids 恰一个 → deleteTodo(todoId)，⛔ 不碰批量端点。
    const single = await handlerOf(handlers, IPC.PROJECT_TODO_DELETE)(
      {},
      { projectId: PROJECT_ID, ids: [ENTITY_ID] },
    );
    expect(client.deleteTodo).toHaveBeenCalledWith('token', { todoId: ENTITY_ID });
    expect(client.deleteTodosBatch).not.toHaveBeenCalled();
    expect(single).toMatchObject({ ok: true, deletedIds: [ENTITY_ID], count: 1 });

    // 批量：ids ≥2 → deleteTodosBatch(projectId + ids)，⛔ 不碰单条端点。
    const roots = [ENTITY_ID, OPERATION_ID];
    const batch = harness({
      client: fakeClient({
        deleteTodosBatch: vi.fn(async () => ({
          ok: true as const,
          value: { deletedIds: roots, count: 2 },
        })),
      }),
    });
    const batchResult = await handlerOf(batch.handlers, IPC.PROJECT_TODO_DELETE)(
      {},
      { projectId: PROJECT_ID, ids: roots },
    );
    expect(batch.client.deleteTodosBatch).toHaveBeenCalledWith('token', {
      projectId: PROJECT_ID,
      ids: roots,
    });
    expect(batch.client.deleteTodo).not.toHaveBeenCalled();
    expect(batchResult).toMatchObject({ ok: true, deletedIds: roots, count: 2 });
  });

  it('todo-delete：失败透传 serverCode（todo_not_found），通用 code 仍 rejected', async () => {
    const { handlers } = harness({
      client: fakeClient({
        deleteTodo: vi.fn(async () => ({
          ok: false as const,
          code: 'rejected' as const,
          serverCode: 'todo_not_found',
        })),
      }),
    });
    const result = (await handlerOf(handlers, IPC.PROJECT_TODO_DELETE)(
      {},
      { projectId: PROJECT_ID, ids: [ENTITY_ID] },
    )) as { ok: boolean; code?: string; serverCode?: string };
    expect(result.ok).toBe(false);
    expect(result.code).toBe('rejected');
    expect(result.serverCode).toBe('todo_not_found');
  });

  it('todo-delete：坏入参一律 invalidRequest（空 ids / 非 uuid / 超 100 根），不触网', async () => {
    const { handlers, client } = harness();
    const empty = await handlerOf(handlers, IPC.PROJECT_TODO_DELETE)(
      {},
      { projectId: PROJECT_ID, ids: [] },
    );
    const notUuid = await handlerOf(handlers, IPC.PROJECT_TODO_DELETE)(
      {},
      { projectId: PROJECT_ID, ids: ['not-a-uuid'] },
    );
    const tooMany = await handlerOf(handlers, IPC.PROJECT_TODO_DELETE)(
      {},
      { projectId: PROJECT_ID, ids: Array.from({ length: 101 }, () => ENTITY_ID) },
    );
    expect(empty).toMatchObject({ ok: false, code: 'invalidRequest' });
    expect(notUuid).toMatchObject({ ok: false, code: 'invalidRequest' });
    expect(tooMany).toMatchObject({ ok: false, code: 'invalidRequest' });
    expect(client.deleteTodo).not.toHaveBeenCalled();
    expect(client.deleteTodosBatch).not.toHaveBeenCalled();
  });

  it('todo-list：两级 / 来源 / 可见性过滤逐字透传；不带参数时请求形状不变', async () => {
    const { handlers, client } = harness();
    await handlerOf(handlers, IPC.PROJECT_TODO_LIST)({}, { projectId: PROJECT_ID });
    // 老客户端不带新参数：透给客户端的入参与两级化之前逐字一致。
    expect(client.listTodos).toHaveBeenLastCalledWith('token', { projectId: PROJECT_ID });

    await handlerOf(handlers, IPC.PROJECT_TODO_LIST)(
      {},
      { projectId: PROJECT_ID, parentId: null, source: 'assistant', visibility: 'personal' },
    );
    expect(client.listTodos).toHaveBeenLastCalledWith('token', {
      projectId: PROJECT_ID,
      parentId: null,
      source: 'assistant',
      visibility: 'personal',
    });
  });

  it('todo-list：过滤值闭集，越界即 invalidRequest（不落到网络面）', async () => {
    const { handlers, client } = harness();
    const result = await handlerOf(handlers, IPC.PROJECT_TODO_LIST)(
      {},
      { projectId: PROJECT_ID, visibility: 'secret' },
    );
    expect(result).toMatchObject({ ok: false, code: 'invalidRequest' });
    expect(client.listTodos).not.toHaveBeenCalled();
  });
});

describe('文件通道', () => {
  it('上传进度只定向回发严格投影，不包含 Main 路径', async () => {
    const send = vi.fn();
    const event = { sender: { send, isDestroyed: () => false } };
    const { handlers } = harness({
      client: fakeClient({
        uploadFile: vi.fn(async (_token, input) => {
          input.onProgress?.(2, 4);
          return { ok: true as const, value: FILE };
        }),
      }),
    });
    await handlerOf(handlers, IPC.PROJECT_FILE_UPLOAD)(event, {
      projectId: PROJECT_ID,
      kind: 'temp',
      operationId: OPERATION_ID,
    });
    expect(send).toHaveBeenCalledWith(
      IPC.PROJECT_FILE_UPLOAD_PROGRESS,
      expect.objectContaining({
        operationId: OPERATION_ID,
        name: 'a.docx',
        size: 4,
        progress: 2,
        phase: 'uploading',
      }),
    );
    expect(JSON.stringify(send.mock.calls)).not.toContain('C:\\\\input');
  });

  it('取消只命中同一 sender 的 operation，并确定性收口为 cancelled', async () => {
    const observed: { signal: AbortSignal | undefined } = { signal: undefined };
    const { handlers } = harness({
      client: fakeClient({
        uploadFile: vi.fn(
          (_token: string, input: Parameters<ProjectCollabClientPort['uploadFile']>[1]) => {
            observed.signal = input.signal;
            input.onProgress?.(1, 4);
            return new Promise<Awaited<ReturnType<ProjectCollabClientPort['uploadFile']>>>(
              (resolve) => {
                input.signal?.addEventListener(
                  'abort',
                  () => resolve({ ok: false as const, code: 'transient' as const }),
                  { once: true },
                );
              },
            );
          },
        ),
      }),
    });
    const upload = handlerOf(handlers, IPC.PROJECT_FILE_UPLOAD)(UPLOAD_EVENT, {
      projectId: PROJECT_ID,
      kind: 'temp',
      operationId: OPERATION_ID,
    });
    await vi.waitFor(() => expect(observed.signal).toBeDefined());

    await expect(
      handlerOf(handlers, IPC.PROJECT_FILE_UPLOAD_CANCEL)(UPLOAD_EVENT, {
        operationId: OPERATION_ID,
      }),
    ).resolves.toEqual({ ok: true });
    expect(observed.signal?.aborted).toBe(true);
    await expect(upload).resolves.toEqual({ ok: true, cancelled: true });
  });

  it('账号 epoch 已切换时同一窗口仍能取消旧上传', async () => {
    let epoch = 1;
    const observed: { signal: AbortSignal | undefined } = { signal: undefined };
    const { handlers } = harness({
      activeAccount: () => ({ accountKey: `acc-${epoch}`, authEpoch: epoch, subject: 'subject' }),
      client: fakeClient({
        uploadFile: vi.fn((_token, input) => {
          observed.signal = input.signal;
          return new Promise<Awaited<ReturnType<ProjectCollabClientPort['uploadFile']>>>(
            (resolve) => {
              input.signal?.addEventListener(
                'abort',
                () => resolve({ ok: false as const, code: 'transient' as const }),
                { once: true },
              );
            },
          );
        }),
      }),
    });
    const upload = handlerOf(handlers, IPC.PROJECT_FILE_UPLOAD)(UPLOAD_EVENT, {
      projectId: PROJECT_ID,
      kind: 'temp',
      operationId: OPERATION_ID,
    });
    await vi.waitFor(() => expect(observed.signal).toBeDefined());

    epoch = 2;
    await handlerOf(handlers, IPC.PROJECT_FILE_UPLOAD_CANCEL)(UPLOAD_EVENT, {
      operationId: OPERATION_ID,
    });

    expect(observed.signal?.aborted).toBe(true);
    await expect(upload).resolves.toMatchObject({ ok: false, code: 'authRequired' });
  });

  it('窗口销毁会主动取消该窗口的在途上传并收口监听器', async () => {
    let destroyedListener: (() => void) | undefined;
    const removeListener = vi.fn();
    const sender = {
      send: vi.fn(),
      isDestroyed: () => false,
      once: vi.fn((_event: 'destroyed', listener: () => void) => {
        destroyedListener = listener;
      }),
      removeListener,
    };
    const observed: { signal: AbortSignal | undefined } = { signal: undefined };
    const { handlers } = harness({
      client: fakeClient({
        uploadFile: vi.fn(
          (_token: string, input: Parameters<ProjectCollabClientPort['uploadFile']>[1]) => {
            observed.signal = input.signal;
            return new Promise<Awaited<ReturnType<ProjectCollabClientPort['uploadFile']>>>(
              (resolve) => {
                input.signal?.addEventListener(
                  'abort',
                  () => resolve({ ok: false as const, code: 'transient' as const }),
                  { once: true },
                );
              },
            );
          },
        ),
      }),
    });
    const upload = handlerOf(handlers, IPC.PROJECT_FILE_UPLOAD)(
      { sender },
      {
        projectId: PROJECT_ID,
        kind: 'temp',
        operationId: OPERATION_ID,
      },
    );
    await vi.waitFor(() => expect(observed.signal).toBeDefined());

    destroyedListener?.();

    expect(observed.signal?.aborted).toBe(true);
    await expect(upload).resolves.toEqual({ ok: true, cancelled: true });
    expect(removeListener).toHaveBeenCalledWith('destroyed', destroyedListener);
  });

  it('上传：路径由注入的选择框取得（渲染层递不进路径），令牌与参数透传客户端', async () => {
    const pickUploadFile = vi.fn(async () => 'C:\\picked\\纪要.docx');
    const { handlers, client } = harness({ pickUploadFile });
    const result = await handlerOf(handlers, IPC.PROJECT_FILE_UPLOAD)(UPLOAD_EVENT, {
      projectId: PROJECT_ID,
      kind: 'temp',
      operationId: OPERATION_ID,
    });
    expect(pickUploadFile).toHaveBeenCalledTimes(1);
    expect(client.uploadFile).toHaveBeenCalledWith(
      'token',
      expect.objectContaining({
        projectId: PROJECT_ID,
        filePath: 'C:\\picked\\纪要.docx',
        kind: 'temp',
        signal: expect.any(AbortSignal),
        onProgress: expect.any(Function),
      }),
    );
    expect(result).toEqual({ ok: true, file: FILE });
  });

  it('上传：用户取消选择框 → {ok:true, cancelled:true}，不触网', async () => {
    const { handlers, client } = harness({ pickUploadFile: async () => null });
    await expect(
      handlerOf(handlers, IPC.PROJECT_FILE_UPLOAD)(UPLOAD_EVENT, {
        projectId: PROJECT_ID,
        kind: 'asset',
        operationId: OPERATION_ID,
      }),
    ).resolves.toEqual({ ok: true, cancelled: true });
    expect(client.uploadFile).not.toHaveBeenCalled();
  });

  it('上传：配额触顶把上限与已用量原样带回渲染层（仅这一档非空）', async () => {
    // 报错条要说得出「上限多少、现在用了多少」——两个数在这一层不能被抹平成
    // 一句通用失败，否则渲染层再想说清也没有依据了。
    const { handlers } = harness({
      client: fakeClient({
        uploadFile: vi.fn(async () => ({
          ok: false as const,
          code: 'quotaExceeded' as const,
          quota: { limitBytes: 2_147_483_648, usedBytes: 2_100_000_000 },
        })),
      }),
    });
    const result = await handlerOf(handlers, IPC.PROJECT_FILE_UPLOAD)(UPLOAD_EVENT, {
      projectId: PROJECT_ID,
      kind: 'temp',
      operationId: OPERATION_ID,
    });
    expect(result).toMatchObject({
      ok: false,
      code: 'quotaExceeded',
      referenceCode: PROJECT_COLLAB_REFERENCE_CODES.quotaExceeded,
      quota: { limitBytes: 2_147_483_648, usedBytes: 2_100_000_000 },
    });
  });

  it('上传：其余失败码的 quota 恒为 null（形状不因失败原因而漂）', async () => {
    const { handlers } = harness({
      client: fakeClient({
        uploadFile: vi.fn(async () => ({ ok: false as const, code: 'tooLarge' as const })),
      }),
    });
    const result = await handlerOf(handlers, IPC.PROJECT_FILE_UPLOAD)(UPLOAD_EVENT, {
      projectId: PROJECT_ID,
      kind: 'temp',
      operationId: OPERATION_ID,
    });
    expect(result).toMatchObject({ ok: false, code: 'tooLarge', quota: null });
  });

  it('上传：请求里夹带 filePath 被 strictObject 拒掉（路径不跨 IPC 的结构性载体）', async () => {
    const { handlers, client } = harness();
    const result = (await handlerOf(handlers, IPC.PROJECT_FILE_UPLOAD)(UPLOAD_EVENT, {
      projectId: PROJECT_ID,
      kind: 'temp',
      operationId: OPERATION_ID,
      filePath: 'C:\\evil',
    })) as { code: string };
    expect(result.code).toBe('invalidRequest');
    expect(client.uploadFile).not.toHaveBeenCalled();
  });

  it('下载：落点目录由 Main 注入，结果只回落盘路径', async () => {
    const { handlers, client } = harness();
    await expect(
      handlerOf(handlers, IPC.PROJECT_FILE_DOWNLOAD)({}, { fileId: ENTITY_ID }),
    ).resolves.toEqual({ ok: true, savedPath: 'C:\\Users\\alice\\Downloads\\纪要.docx' });
    expect(client.downloadFile).toHaveBeenCalledWith('token', {
      fileId: ENTITY_ID,
      targetDirectory: 'C:\\Users\\alice\\Downloads',
    });
  });
});

describe('桌面通知开关（G-6）', () => {
  function memoryStore(initial = true): ProjectNotificationSettingsPort {
    let enabled = initial;
    return {
      read: () => ({ desktopNotifications: enabled }),
      write: (settings) => {
        enabled = settings.desktopNotifications;
        return { desktopNotifications: enabled };
      },
    };
  }

  it('读写往返：关掉后读到关闭', async () => {
    const store = memoryStore();
    const { handlers } = harness({ notificationSettings: store });
    await expect(
      handlerOf(handlers, IPC.PROJECT_NOTIFICATION_SETTINGS_READ)({}, undefined),
    ).resolves.toEqual({ desktopNotifications: true });
    await expect(
      handlerOf(handlers, IPC.PROJECT_NOTIFICATION_SETTINGS_WRITE)(
        {},
        { desktopNotifications: false },
      ),
    ).resolves.toEqual({ desktopNotifications: false });
    await expect(
      handlerOf(handlers, IPC.PROJECT_NOTIFICATION_SETTINGS_READ)({}, undefined),
    ).resolves.toEqual({ desktopNotifications: false });
  });

  it('存储未装配：读回默认开、写原样回显（设置面不因存储缺席而报错）', async () => {
    const { handlers } = harness({ notificationSettings: null });
    await expect(
      handlerOf(handlers, IPC.PROJECT_NOTIFICATION_SETTINGS_READ)({}, undefined),
    ).resolves.toEqual({ desktopNotifications: true });
    await expect(
      handlerOf(handlers, IPC.PROJECT_NOTIFICATION_SETTINGS_WRITE)(
        {},
        { desktopNotifications: false },
      ),
    ).resolves.toEqual({ desktopNotifications: false });
  });

  it('未授权/未登录：写不落盘，回的是当前真值而不是请求值', async () => {
    const store = memoryStore();
    const unauthorized = harness({ notificationSettings: store, authorize: () => false });
    await expect(
      handlerOf(unauthorized.handlers, IPC.PROJECT_NOTIFICATION_SETTINGS_WRITE)(
        {},
        { desktopNotifications: false },
      ),
    ).resolves.toEqual({ desktopNotifications: true });
    expect(store.read()).toEqual({ desktopNotifications: true });

    const loggedOut = harness({ notificationSettings: store, activeAccount: () => null });
    await expect(
      handlerOf(loggedOut.handlers, IPC.PROJECT_NOTIFICATION_SETTINGS_WRITE)(
        {},
        { desktopNotifications: false },
      ),
    ).resolves.toEqual({ desktopNotifications: true });
    expect(store.read()).toEqual({ desktopNotifications: true });
  });

  it('坏入参不落盘（strictObject 拒夹带）', async () => {
    const store = memoryStore();
    const { handlers } = harness({ notificationSettings: store });
    for (const input of [undefined, {}, { desktopNotifications: 'yes' }, { extra: 1 }]) {
      await expect(
        handlerOf(handlers, IPC.PROJECT_NOTIFICATION_SETTINGS_WRITE)({}, input),
      ).resolves.toEqual({ desktopNotifications: true });
    }
    expect(store.read()).toEqual({ desktopNotifications: true });
  });

  it('读请求带夹带参数：回默认，不把夹带当查询条件', async () => {
    const { handlers } = harness({ notificationSettings: memoryStore(false) });
    await expect(
      handlerOf(handlers, IPC.PROJECT_NOTIFICATION_SETTINGS_READ)({}, { anything: 1 }),
    ).resolves.toEqual({ desktopNotifications: true });
  });
});

describe('工作单八通道', () => {
  it('单条读取与验收清单替换：入参透传，出参过契约', async () => {
    const { handlers, client } = harness();
    await expect(
      handlerOf(handlers, IPC.PROJECT_TODO_DETAIL)({}, { todoId: ENTITY_ID }),
    ).resolves.toEqual({
      ok: true,
      todo: TODO,
      acceptanceItems: [ACCEPTANCE_ITEM],
      completionRecords: [],
    });
    expect(client.getTodoDetail).toHaveBeenCalledWith('token', { todoId: ENTITY_ID });

    await expect(
      handlerOf(handlers, IPC.PROJECT_TODO_ACCEPTANCE_SET)(
        {},
        { todoId: ENTITY_ID, expectedVersion: 3, items: ['判据一'] },
      ),
    ).resolves.toEqual({ ok: true, todo: TODO, acceptanceItems: [ACCEPTANCE_ITEM] });
    expect(client.setAcceptanceItems).toHaveBeenCalledWith('token', {
      todoId: ENTITY_ID,
      expectedVersion: 3,
      items: ['判据一'],
    });
  });

  it('打回不带理由 → invalidRequest（契约层就拒，网络面一次都不碰）', async () => {
    const { handlers, client } = harness();
    const result = await handlerOf(handlers, IPC.PROJECT_TODO_REVIEW)(
      {},
      { todoId: ENTITY_ID, expectedVersion: 3, decision: 'reject' },
    );
    expect(result).toMatchObject({ ok: false, code: 'invalidRequest', currentVersion: null });
    expect(client.reviewTodo).not.toHaveBeenCalled();

    // 成对的另一半：带了理由就走得通（上面的拒不是因为通道本身坏了）。
    await expect(
      handlerOf(handlers, IPC.PROJECT_TODO_REVIEW)(
        {},
        { todoId: ENTITY_ID, expectedVersion: 3, decision: 'reject', reason: '证据不足' },
      ),
    ).resolves.toEqual({ ok: true, todo: TODO, completionRecord: null });
    expect(client.reviewTodo).toHaveBeenCalledTimes(1);
  });

  it('建单 / 改单 / 提交验收被拒时透传服务端业务码（2539 / 2540 / 2542）', async () => {
    /*
     * 需求派给助理、承接人是观察者、未认领需求须走认领、助理单只由派单人提交——这几种拒绝在
     * 网络面都折进了 rejected / forbidden 通用桶，渲染层要说清原因只能靠 serverCode。
     * ⛔ 此前这三条通道的失败体丢掉了它，用户只看得到一句「请求被服务端拒绝」。
     */
    const { handlers } = harness({
      client: fakeClient({
        createTodo: vi.fn(async () => ({
          ok: false as const,
          code: 'rejected' as const,
          serverCode: 'requirement_assistant_forbidden',
        })),
        updateTodo: vi.fn(async () => ({
          ok: false as const,
          code: 'rejected' as const,
          serverCode: 'assignee_not_editor',
        })),
        submitTodoReview: vi.fn(async () => ({
          ok: false as const,
          code: 'forbidden' as const,
          serverCode: 'assistant_submit_forbidden',
        })),
      }),
    });
    await expect(
      handlerOf(handlers, IPC.PROJECT_TODO_CREATE)(
        {},
        {
          projectId: PROJECT_ID,
          itemKind: 'requirement',
          title: '直接派助理',
          assigneeKind: 'assistant',
        },
      ),
    ).resolves.toMatchObject({
      ok: false,
      code: 'rejected',
      serverCode: 'requirement_assistant_forbidden',
    });
    await expect(
      handlerOf(handlers, IPC.PROJECT_TODO_UPDATE)(
        {},
        { todoId: ENTITY_ID, expectedVersion: 3, assigneeSubject: 'u-viewer' },
      ),
    ).resolves.toMatchObject({
      ok: false,
      code: 'rejected',
      serverCode: 'assignee_not_editor',
      currentVersion: null,
    });
    await expect(
      handlerOf(handlers, IPC.PROJECT_TODO_SUBMIT_REVIEW)(
        {},
        { todoId: ENTITY_ID, expectedVersion: 3, summary: '做完了' },
      ),
    ).resolves.toMatchObject({
      ok: false,
      code: 'forbidden',
      serverCode: 'assistant_submit_forbidden',
      currentVersion: null,
    });
  });

  it('提交验收与验收打回的 409 都把 currentVersion 带回', async () => {
    const conflict = { ok: false as const, code: 'conflict' as const, currentVersion: 9 };
    const { handlers } = harness({
      client: fakeClient({
        submitTodoReview: vi.fn(async () => conflict),
        reviewTodo: vi.fn(async () => conflict),
      }),
    });
    await expect(
      handlerOf(handlers, IPC.PROJECT_TODO_SUBMIT_REVIEW)(
        {},
        { todoId: ENTITY_ID, expectedVersion: 3, summary: '做完了' },
      ),
    ).resolves.toMatchObject({ ok: false, code: 'conflict', currentVersion: 9 });
    await expect(
      handlerOf(handlers, IPC.PROJECT_TODO_REVIEW)(
        {},
        { todoId: ENTITY_ID, expectedVersion: 3, decision: 'accept', checkedOrdinals: [1] },
      ),
    ).resolves.toMatchObject({ ok: false, code: 'conflict', currentVersion: 9 });
  });

  it('新测试模式挡旧链路的 409 业务码穿过提交验收 / 验收打回 / 改单三条通道（TST-02）', async () => {
    const { handlers } = harness({
      client: fakeClient({
        submitTodoReview: vi.fn(async () => ({
          ok: false as const,
          code: 'conflict' as const,
          serverCode: 'requirement_test_mode_required',
        })),
        reviewTodo: vi.fn(async () => ({
          ok: false as const,
          code: 'conflict' as const,
          serverCode: 'test_round_in_progress',
        })),
        updateTodo: vi.fn(async () => ({
          ok: false as const,
          code: 'conflict' as const,
          serverCode: 'test_round_in_progress',
        })),
      }),
    });
    await expect(
      handlerOf(handlers, IPC.PROJECT_TODO_SUBMIT_REVIEW)(
        {},
        { todoId: ENTITY_ID, expectedVersion: 3, summary: '做完了' },
      ),
    ).resolves.toMatchObject({
      ok: false,
      code: 'conflict',
      serverCode: 'requirement_test_mode_required',
      currentVersion: null,
    });
    // ⭐ 验收打回此前的失败工厂根本不接 serverCode：这条码到不了渲染层，只剩「已被他人更新」。
    await expect(
      handlerOf(handlers, IPC.PROJECT_TODO_REVIEW)(
        {},
        { todoId: ENTITY_ID, expectedVersion: 3, decision: 'accept' },
      ),
    ).resolves.toMatchObject({
      ok: false,
      code: 'conflict',
      serverCode: 'test_round_in_progress',
      currentVersion: null,
    });
    await expect(
      handlerOf(handlers, IPC.PROJECT_TODO_UPDATE)(
        {},
        { todoId: ENTITY_ID, expectedVersion: 3, status: 'cancelled' },
      ),
    ).resolves.toMatchObject({
      ok: false,
      code: 'conflict',
      serverCode: 'test_round_in_progress',
      currentVersion: null,
    });
  });

  it('非冲突失败不带版本号（currentVersion 只在 conflict 分支有意义）', async () => {
    const { handlers } = harness({
      client: fakeClient({
        reviewTodo: vi.fn(async () => ({ ok: false as const, code: 'forbidden' as const })),
      }),
    });
    await expect(
      handlerOf(handlers, IPC.PROJECT_TODO_REVIEW)(
        {},
        { todoId: ENTITY_ID, expectedVersion: 3, decision: 'accept' },
      ),
    ).resolves.toMatchObject({ ok: false, code: 'forbidden', currentVersion: null });
  });

  it('草案四通道：列出/落批/逐条剔除/整批处理都过契约', async () => {
    const { handlers, client } = harness();
    await expect(
      handlerOf(handlers, IPC.PROJECT_TODO_DRAFT_LIST)({}, { projectId: PROJECT_ID }),
    ).resolves.toEqual({ ok: true, batches: [DRAFT_BATCH] });

    await expect(
      handlerOf(handlers, IPC.PROJECT_TODO_DRAFT_CREATE)(
        {},
        {
          projectId: PROJECT_ID,
          sourceTodoId: ENTITY_ID,
          targetItemKind: 'task',
          parentId: ENTITY_ID,
          items: [{ title: '核对入库字段', acceptanceItems: ['逐项对齐'] }],
        },
      ),
    ).resolves.toEqual({ ok: true, batch: DRAFT_BATCH });

    await expect(
      handlerOf(handlers, IPC.PROJECT_TODO_DRAFT_DROP)(
        {},
        { draftId: '55555555-5555-4555-8555-555555555555' },
      ),
    ).resolves.toEqual({ ok: true, batch: DRAFT_BATCH });

    await expect(
      handlerOf(handlers, IPC.PROJECT_TODO_DRAFT_RESOLVE)(
        {},
        { batchId: DRAFT_BATCH.id, decision: 'confirm' },
      ),
    ).resolves.toEqual({ ok: true, batch: DRAFT_BATCH, todos: [TODO] });
    expect(client.resolveDraftBatch).toHaveBeenCalledWith('token', {
      batchId: DRAFT_BATCH.id,
      decision: 'confirm',
    });
  });

  it('draft-resolve：失败体透传 serverCode，渲染层才说得清被拒的原因', async () => {
    // 认领门 409 requirement_not_claimed：丢了业务码，渲染层只能回落「数据已被他人更新」。
    const gated = harness({
      client: fakeClient({
        resolveDraftBatch: vi.fn(async () => ({
          ok: false as const,
          code: 'conflict' as const,
          serverCode: 'requirement_not_claimed',
        })),
      }),
    });
    await expect(
      handlerOf(gated.handlers, IPC.PROJECT_TODO_DRAFT_RESOLVE)(
        {},
        { batchId: DRAFT_BATCH.id, decision: 'confirm' },
      ),
    ).resolves.toEqual({
      ok: false,
      code: 'conflict',
      message: '内容已被他人更新，请刷新后重试。',
      referenceCode: 'STRX-COLLAB-006',
      serverCode: 'requirement_not_claimed',
    });
  });

  it('draft-drop：失败体同样透传 serverCode（这条已处理 / 这批已处理）', async () => {
    const resolved = harness({
      client: fakeClient({
        dropDraft: vi.fn(async () => ({
          ok: false as const,
          code: 'conflict' as const,
          serverCode: 'draft_already_resolved',
        })),
      }),
    });
    await expect(
      handlerOf(resolved.handlers, IPC.PROJECT_TODO_DRAFT_DROP)(
        {},
        { draftId: '55555555-5555-4555-8555-555555555555' },
      ),
    ).resolves.toEqual({
      ok: false,
      code: 'conflict',
      message: '内容已被他人更新，请刷新后重试。',
      referenceCode: 'STRX-COLLAB-006',
      serverCode: 'draft_already_resolved',
    });
  });

  it('空批次与未知处理结论一律 invalidRequest', async () => {
    const { handlers, client } = harness();
    await expect(
      handlerOf(handlers, IPC.PROJECT_TODO_DRAFT_CREATE)({}, { projectId: PROJECT_ID, items: [] }),
    ).resolves.toMatchObject({ ok: false, code: 'invalidRequest' });
    await expect(
      handlerOf(handlers, IPC.PROJECT_TODO_DRAFT_RESOLVE)(
        {},
        { batchId: DRAFT_BATCH.id, decision: 'maybe' },
      ),
    ).resolves.toMatchObject({ ok: false, code: 'invalidRequest' });
    expect(client.createDraftBatch).not.toHaveBeenCalled();
    expect(client.resolveDraftBatch).not.toHaveBeenCalled();
  });
});
