import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import {
  ProjectDictionaryBindingSchema,
  ProjectDictionaryEntryRefSchema,
  ProjectIterationRefSchema,
  projectDictionaryBindingState,
} from '../../../../stratex/shared/protocol/project-collab-dictionaries.js';

import {
  CHAT_MAX_BODY_LENGTH,
  PROJECT_COLLAB_REFERENCE_CODES,
  PROJECT_MAX_AI_ENTRY_RULES_LENGTH,
  PROJECT_MAX_INSTRUCTIONS_LENGTH,
  ProjectConventionsSchema,
  ProjectConventionsUpdateRequestSchema,
  FEED_MAX_BODY_LENGTH,
  PROJECT_FILE_MAX_BYTES,
  PROJECT_LIST_MAX_LIMIT,
  PROJECT_MAX_NAME_LENGTH,
  PROJECT_MAX_REFS,
  PROJECT_REF_KIND_ASSET,
  PROJECT_REF_KIND_MEMBER,
  PROJECT_REF_KIND_TODO,
  PROJECT_REF_PICKABLE_KINDS,
  PROJECT_SUMMARY_MAX_LENGTH,
  PROJECT_SUMMARY_PREVIEW_MEMBERS,
  ChatMessageSchema,
  FeedCommentSchema,
  FeedEntrySchema,
  ProjectChatHistoryRequestSchema,
  ProjectChatSendRequestSchema,
  ProjectCollabAvailabilitySchema,
  ProjectCommentPostRequestSchema,
  ProjectCollabErrorCodeSchema,
  ProjectCollabReferenceCodeSchema,
  ProjectCreateRequestSchema,
  ProjectDetailSchema,
  projectRoleAtLeast,
  projectRoleOutranks,
  ProjectEventSchema,
  ProjectFeedListRequestSchema,
  ProjectFeedPostRequestSchema,
  ProjectFileSchema,
  ProjectFileUploadRequestSchema,
  ProjectFileUploadResultSchema,
  ProjectFileUploadProgressSchema,
  ProjectInvitationRoleSchema,
  ProjectInviteRequestSchema,
  ProjectInviteResultSchema,
  ProjectInvitationRevokeRequestSchema,
  ProjectInvitationRevokeResultSchema,
  ProjectOpenInvitationListRequestSchema,
  ProjectOpenInvitationListResultSchema,
  ProjectJoinLinkEventSchema,
  PROJECT_JOIN_LINK_SCHEME,
  PROJECT_OPEN_INVITATION_MAX_USES,
  buildProjectJoinLink,
  parseProjectJoinLink,
  projectOpenInvitationErrorText,
  projectTodoDraftDropServerCodeText,
  projectTodoDraftResolveServerCodeText,
  ProjectTodoDraftResolveResultSchema,
  projectTodoWriteServerCodeText,
  ProjectAssignableRoleSchema,
  ProjectMemberUpdateRequestSchema,
  projectAssignableRolesFor,
  projectInvitationRolesFor,
  ProjectListRequestSchema,
  ProjectListResultSchema,
  ProjectMemberSchema,
  ProjectReadCursorRequestSchema,
  ProjectSummarySchema,
  ProjectTodoCreateFieldsSchema,
  ProjectTodoCreateRequestSchema,
  ProjectTodoDraftCreateRequestSchema,
  ProjectTodoDraftResolveRequestSchema,
  ProjectTodoListRequestSchema,
  ProjectTodoListResultSchema,
  ProjectTodoReviewRequestSchema,
  ProjectTodoStatusEventPageSchema,
  ProjectTodoStatusEventSchema,
  ProjectTodoSubmitReviewRequestSchema,
  ProjectTodoUpdateRequestSchema,
  ProjectTodoUpdateResultSchema,
  ProjectUpdateRequestSchema,
  TodoDraftBatchSchema,
  TodoDraftSchema,
  TodoSchema,
  assigneeDispatchIsConsistent,
  buildProjectRef,
  hasTodoChildProgress,
  isTodoAssignedToAssistant,
  isTodoRequirement,
  isTodoUnassigned,
  isTodoWorkOrder,
  projectExtraMemberCount,
  todoAcceptanceProgress,
  todoChildProgress,
  todoConstraints,
  todoParentId,
  todoSource,
  todoVisibility,
  type ChatMessage,
  type FeedEntry,
  type ProjectDetail,
  type ProjectFile,
  type ProjectMember,
  type ProjectSummary,
  type ProjectTodoStatusEvent,
  type Todo,
} from '../../../../stratex/shared/protocol/project-collab.js';

const PROJECT_ID = '11111111-1111-4111-8111-111111111111';
const ENTITY_ID = '22222222-2222-4222-8222-222222222222';
const OPERATION_ID = '33333333-3333-4333-8333-333333333333';

function validSummary(overrides: Partial<ProjectSummary> = {}): ProjectSummary {
  return {
    id: PROJECT_ID,
    name: '赛道服务联合调试',
    summary: '两周内跑通双账号闭环。',
    myRole: 'owner',
    archivedAt: null,
    memberCount: 3,
    memberPreview: [{ subject: 'user-alice', displayName: '张三' }],
    unreadCount: 0,
    lastActivityAt: '2026-08-24T08:00:00.000Z',
    createdAt: '2026-08-01T08:00:00.000Z',
    ...overrides,
  };
}

function validMember(overrides: Partial<ProjectMember> = {}): ProjectMember {
  return {
    subject: 'user-alice',
    displayName: '张三',
    role: 'editor',
    state: 'active',
    joinedAt: '2026-08-02T08:00:00.000Z',
    ...overrides,
  };
}

function validDetail(overrides: Partial<ProjectDetail> = {}): ProjectDetail {
  return {
    id: PROJECT_ID,
    name: '赛道服务联合调试',
    instructionsText: '本项目用于联调，产出物放文件页签。',
    myRole: 'owner',
    archivedAt: null,
    createdAt: '2026-08-01T08:00:00.000Z',
    members: [validMember()],
    ...overrides,
  };
}

function validFeedEntry(overrides: Partial<FeedEntry> = {}): FeedEntry {
  return {
    id: ENTITY_ID,
    kind: 'member_post',
    authorSubject: 'user-alice',
    authorDisplayName: '张三',
    bodyMd: '今天联调通过了第一条链路。',
    refs: ['file:33333333-3333-4333-8333-333333333333'],
    comments: [
      {
        id: '44444444-4444-4444-8444-444444444444',
        authorSubject: 'user-bob',
        authorDisplayName: '李四',
        bodyMd: '收到，明天我补第二条。',
        refs: ['member:user-alice'],
        createdAt: '2026-08-24T09:00:00.000Z',
      },
    ],
    createdAt: '2026-08-24T08:30:00.000Z',
    ...overrides,
  };
}

function validChatMessage(overrides: Partial<ChatMessage> = {}): ChatMessage {
  return {
    id: ENTITY_ID,
    seq: 42,
    authorSubject: 'user-alice',
    authorDisplayName: '张三',
    bodyMd: '文件我传到项目里了。',
    refs: [],
    revoked: false,
    createdAt: '2026-08-24T10:00:00.000Z',
    ...overrides,
  };
}

function validTodo(overrides: Partial<Todo> = {}): Todo {
  return {
    id: ENTITY_ID,
    itemKind: 'requirement',
    parentId: null,
    source: 'manual',
    visibility: 'shared',
    title: '整理联调纪要',
    status: 'inProgress',
    assigneeKind: 'member',
    assigneeSubject: 'user-bob',
    assigneeDisplayName: '李四',
    priority: 'high',
    labels: ['联调'],
    startAt: null,
    dueAt: '2026-08-26T00:00:00.000Z',
    description: '把今天的结论落到项目说明里。',
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
    ...overrides,
  };
}

it('开始日期兼容旧响应，新增和单字段清空通过协议', () => {
  const legacy: Record<string, unknown> = { ...validTodo() };
  delete legacy['startAt'];
  expect(TodoSchema.parse(legacy).startAt).toBeNull();
  expect(
    ProjectTodoCreateRequestSchema.parse({
      projectId: PROJECT_ID,
      itemKind: 'requirement',
      title: '计划',
      startAt: '2026-09-10',
    }).startAt,
  ).toBe('2026-09-10');
  expect(
    ProjectTodoUpdateRequestSchema.parse({ todoId: ENTITY_ID, expectedVersion: 3, startAt: null })
      .startAt,
  ).toBeNull();
  expect(
    ProjectTodoUpdateRequestSchema.safeParse({ todoId: ENTITY_ID, expectedVersion: 3, startAt: 42 })
      .success,
  ).toBe(false);
});

function validProjectFile(overrides: Partial<ProjectFile> = {}): ProjectFile {
  return {
    id: ENTITY_ID,
    kind: 'temp',
    source: 'manual',
    filename: '联调纪要.docx',
    mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    bytes: 10_240,
    sha256: '0123456789abcdef'.repeat(4),
    uploaderSubject: 'user-alice',
    uploaderDisplayName: '张三',
    createdAt: '2026-08-24T08:00:00.000Z',
    expiresAt: '2026-09-24T08:00:00.000Z',
    ...overrides,
  };
}

describe('project-collab entities', () => {
  it('accepts valid projections for every entity', () => {
    expect(ProjectSummarySchema.parse(validSummary())).toEqual(validSummary());
    expect(ProjectMemberSchema.parse(validMember())).toEqual(validMember());
    expect(ProjectDetailSchema.parse(validDetail())).toEqual(validDetail());
    expect(FeedEntrySchema.parse(validFeedEntry())).toEqual(validFeedEntry());
    expect(ChatMessageSchema.parse(validChatMessage())).toEqual(validChatMessage());
    expect(TodoSchema.parse(validTodo())).toEqual(validTodo());
    expect(ProjectFileSchema.parse(validProjectFile())).toEqual(validProjectFile());
  });

  it('accepts nullable projections: fresh project, invited member, revoked message', () => {
    expect(ProjectSummarySchema.safeParse(validSummary({ lastActivityAt: null })).success).toBe(
      true,
    );
    expect(
      ProjectMemberSchema.safeParse(validMember({ state: 'invited', joinedAt: null })).success,
    ).toBe(true);
    expect(
      ChatMessageSchema.safeParse(validChatMessage({ revoked: true, bodyMd: '' })).success,
    ).toBe(true);
    expect(
      FeedEntrySchema.safeParse(
        validFeedEntry({ kind: 'system', authorSubject: null, authorDisplayName: null }),
      ).success,
    ).toBe(true);
    expect(ProjectFileSchema.safeParse(validProjectFile({ expiresAt: null })).success).toBe(true);
  });

  it('is strict: unknown keys are refused on entities', () => {
    expect(ProjectSummarySchema.safeParse({ ...validSummary(), accountKey: 'a-1' }).success).toBe(
      false,
    );
    expect(
      ProjectMemberSchema.safeParse({ ...validMember(), email: 'a@example.com' }).success,
    ).toBe(false);
    expect(TodoSchema.safeParse({ ...validTodo(), extra: true }).success).toBe(false);
  });

  /**
   * 入站角色的容错，与「其余闭集严格拒」是**成对**的一组：只放角色这一个口子。
   *
   * 严格拒角色的后果不是报错——`collabWireMapping` 会把整条响应判为不可信，上层当
   * transient，用户看到一句永远好不了的「项目组暂时连不上」。而 `members` 不做部分
   * 采信 ⇒ 项目里一个人是新角色，**全项目所有人**都撞那句假网络错误。
   */
  it('degrades an unknown inbound role to the least privilege instead of rejecting', () => {
    const parsed = ProjectSummarySchema.safeParse(validSummary({ myRole: 'admin' as never }));
    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data.myRole).toBe('viewer');
  });

  it('keeps a project detail usable when one member carries an unknown role', () => {
    // 成对的另一半：降级必须发生在**数组元素**上，否则 `members` 的「任一不可信即
    // 整体拒绝」会把整条详情拖下水——那才是这个改动真正要防的事故。
    const detail = ProjectDetailSchema.safeParse({
      ...validDetail(),
      members: [validMember(), validMember({ subject: 'u-x', role: 'admin' as never })],
    });
    expect(detail.success).toBe(true);
    expect(detail.success && detail.data.members.map((m) => m.role)).toEqual(['editor', 'viewer']);
  });

  it('ranks roles like the service and puts unknown roles below everything', () => {
    expect(projectRoleAtLeast('owner', 'manager')).toBe(true);
    expect(projectRoleAtLeast('manager', 'manager')).toBe(true);
    expect(projectRoleAtLeast('editor', 'manager')).toBe(false);
    expect(projectRoleAtLeast('manager', 'editor')).toBe(true);
    expect(projectRoleAtLeast('viewer', 'editor')).toBe(false);
    // 与服务端 `ROLE_RANK.get(role, -1)` 同构：判不出档位就当最低。
    expect(projectRoleAtLeast(null, 'viewer')).toBe(false);
    expect(projectRoleAtLeast('admin' as never, 'viewer')).toBe(false);
  });

  it('lets a role act only on strictly lower ones (ensure_role_grantable 同款收窄)', () => {
    /*
     * 这一组钉的是「管理者造不出管理者」——而它**不是一条特例**，是严格大于的推论。
     * ⛔ 别把调用点改回 `role !== 'owner'` 那种枚举式排除：每加一档角色都要回来补，
     * 漏了不会有任何东西红。
     */
    expect(projectRoleOutranks('owner', 'manager')).toBe(true);
    expect(projectRoleOutranks('manager', 'editor')).toBe(true);
    expect(projectRoleOutranks('manager', 'viewer')).toBe(true);
    // 三条不变式：动不了拥有者、动不了平级（含自己）、低档动不了高档。
    expect(projectRoleOutranks('manager', 'owner')).toBe(false);
    expect(projectRoleOutranks('manager', 'manager')).toBe(false);
    expect(projectRoleOutranks('owner', 'owner')).toBe(false);
    expect(projectRoleOutranks('editor', 'manager')).toBe(false);
    expect(projectRoleOutranks(null, 'viewer')).toBe(false);
  });

  it('refuses enum values outside the closed sets', () => {
    // ⚠️ **角色不在这一组**：它是入站容错档，未知值降级为观察者而不是拒整条。
    //    见下面「入站角色对未知取值降级」。其余闭集照旧一个不认就拒。
    expect(ProjectMemberSchema.safeParse(validMember({ state: 'banned' as never })).success).toBe(
      false,
    );
    expect(TodoSchema.safeParse(validTodo({ status: 'blocked' as never })).success).toBe(false);
    expect(TodoSchema.safeParse(validTodo({ priority: 'urgent' as never })).success).toBe(false);
    expect(FeedEntrySchema.safeParse(validFeedEntry({ kind: 'bot' as never })).success).toBe(false);
    expect(
      ProjectFileSchema.safeParse(validProjectFile({ kind: 'archive' as never })).success,
    ).toBe(false);
  });

  it('refuses malformed sha256 and free-text refs', () => {
    expect(ProjectFileSchema.safeParse(validProjectFile({ sha256: 'Z'.repeat(64) })).success).toBe(
      false,
    );
    // refs 是结构化 token——含空白的自由文本塞不进（红线 2 的结构性载体）。
    expect(ChatMessageSchema.safeParse(validChatMessage({ refs: ['hello world'] })).success).toBe(
      false,
    );
  });
});

describe('project-collab requests', () => {
  it('accepts valid requests for every write shape', () => {
    expect(ProjectListRequestSchema.safeParse({}).success).toBe(true);
    expect(ProjectCreateRequestSchema.safeParse({ name: '新项目' }).success).toBe(true);
    expect(
      ProjectUpdateRequestSchema.safeParse({ projectId: PROJECT_ID, instructionsText: '' }).success,
    ).toBe(true);
    expect(
      ProjectInviteRequestSchema.safeParse({ projectId: PROJECT_ID, role: 'viewer' }).success,
    ).toBe(true);
    expect(
      ProjectFeedPostRequestSchema.safeParse({ projectId: PROJECT_ID, bodyMd: '发个动态' }).success,
    ).toBe(true);
    expect(
      ProjectChatSendRequestSchema.safeParse({
        projectId: PROJECT_ID,
        bodyMd: '带引用的消息',
        refs: ['todo:22222222-2222-4222-8222-222222222222'],
      }).success,
    ).toBe(true);
    expect(
      ProjectReadCursorRequestSchema.safeParse({ projectId: PROJECT_ID, lastReadSeq: 42 }).success,
    ).toBe(true);
    expect(
      ProjectTodoUpdateRequestSchema.safeParse({
        todoId: ENTITY_ID,
        expectedVersion: 3,
        assigneeSubject: null,
      }).success,
    ).toBe(true);
    expect(
      ProjectFileUploadRequestSchema.safeParse({
        projectId: PROJECT_ID,
        kind: 'temp',
        operationId: OPERATION_ID,
      }).success,
    ).toBe(true);
  });

  it('structurally refuses account fields on every request (red line 1)', () => {
    expect(ProjectListRequestSchema.safeParse({ accountKey: 'a-1' }).success).toBe(false);
    expect(
      ProjectCreateRequestSchema.safeParse({ name: '新项目', accountKey: 'a-1' }).success,
    ).toBe(false);
    expect(
      ProjectChatSendRequestSchema.safeParse({
        projectId: PROJECT_ID,
        bodyMd: '消息',
        subject: 'user-mallory',
      }).success,
    ).toBe(false);
    expect(
      ProjectCollabAvailabilitySchema.safeParse({ enabled: true, accountKey: 'a' }).success,
    ).toBe(false);
  });

  it('structurally refuses byte payloads and file paths on upload (red line 2 + 路径不跨 IPC)', () => {
    const base = { projectId: PROJECT_ID, kind: 'temp', operationId: OPERATION_ID } as const;
    expect(ProjectFileUploadRequestSchema.safeParse({ ...base, bytes: [1, 2, 3] }).success).toBe(
      false,
    );
    expect(ProjectFileUploadRequestSchema.safeParse({ ...base, data: 'AAAA' }).success).toBe(false);
    // 路径由 Main 弹框自取——渲染层即便想递路径也塞不进（strictObject 拒未知键）。
    expect(
      ProjectFileUploadRequestSchema.safeParse({ ...base, filePath: 'C:\\tmp\\a.bin' }).success,
    ).toBe(false);
  });

  it('upload progress is strict and cannot leak a Main path or project/account identity', () => {
    const progress = {
      operationId: OPERATION_ID,
      name: 'report.pdf',
      size: 100,
      progress: 40,
      phase: 'uploading',
      error: null,
    } as const;
    expect(ProjectFileUploadProgressSchema.safeParse(progress).success).toBe(true);
    for (const extra of [
      { filePath: 'C:\\private\\report.pdf' },
      { projectId: PROJECT_ID },
      { accountKey: 'private-account' },
    ]) {
      expect(ProjectFileUploadProgressSchema.safeParse({ ...progress, ...extra }).success).toBe(
        false,
      );
    }
    expect(ProjectFileUploadProgressSchema.safeParse({ ...progress, progress: 101 }).success).toBe(
      false,
    );
    expect(
      ProjectFileUploadProgressSchema.safeParse({
        ...progress,
        phase: 'completed',
        progress: 99,
      }).success,
    ).toBe(false);
    expect(
      ProjectFileUploadProgressSchema.safeParse({
        ...progress,
        phase: 'failed',
        error: null,
      }).success,
    ).toBe(false);
  });

  it('refuses NUL in user-authored bodies', () => {
    expect(
      ProjectFeedPostRequestSchema.safeParse({ projectId: PROJECT_ID, bodyMd: 'a\0b' }).success,
    ).toBe(false);
    expect(ProjectCreateRequestSchema.safeParse({ name: 'a\0b' }).success).toBe(false);
  });

  it('requires at least one changed field on partial updates', () => {
    expect(ProjectUpdateRequestSchema.safeParse({ projectId: PROJECT_ID }).success).toBe(false);
    expect(
      ProjectTodoUpdateRequestSchema.safeParse({ todoId: ENTITY_ID, expectedVersion: 1 }).success,
    ).toBe(false);
  });

  it('invitation roles exclude owner by construction', () => {
    expect(
      ProjectInviteRequestSchema.safeParse({ projectId: PROJECT_ID, role: 'owner' }).success,
    ).toBe(false);
  });
});

/**
 * 签发面（邀请码 / 改成员角色）——与服务端 `domain.py` 的两闸逐条同构：
 *  ① 闭集 `GRANTABLE_ROLES = ("manager","editor","viewer")`；
 *  ② 收窄闸 `role_outranks(actor, role)`：只签得出**严格低于自己**的档。
 * ⚠️ 两个半边缺一不可：少了 ② 的话，管理者能把一个成员**直接改成**管理者绕过
 * 「造不出第二个管理者」。
 */
describe('project-collab 签发面闭集与收窄', () => {
  it('两个签发闭集都含 manager，且**都不含 owner**', () => {
    // 闭集本身是「这个词合不合法」的答案，与「谁能签」是两件事。
    expect(ProjectInvitationRoleSchema.options).toEqual(['manager', 'editor', 'viewer']);
    expect(ProjectAssignableRoleSchema.options).toEqual(['manager', 'editor', 'viewer']);
    // 拥有者只能经 project:transfer 的升一降一产生 ⇒ 签发面结构性签不出第二个。
    expect(
      ProjectMemberUpdateRequestSchema.safeParse({
        projectId: PROJECT_ID,
        subject: 'u-bob',
        role: 'owner',
      }).success,
    ).toBe(false);
    expect(
      ProjectInviteRequestSchema.safeParse({ projectId: PROJECT_ID, role: 'manager' }).success,
    ).toBe(true);
  });

  it('projectRoleOutranks 是严格大于，未知角色管不了人但人人管得了它', () => {
    expect(projectRoleOutranks('owner', 'manager')).toBe(true);
    expect(projectRoleOutranks('manager', 'editor')).toBe(true);
    // ⛔ 同档位恒假：造不出第二个管理者、平级踢不动、拥有者也动不了另一个拥有者。
    expect(projectRoleOutranks('manager', 'manager')).toBe(false);
    expect(projectRoleOutranks('owner', 'owner')).toBe(false);
    expect(projectRoleOutranks('manager', 'owner')).toBe(false);
    // 未知/无角色按 -1（fail-closed）；反向刻意为真，否则读不懂的那一行成了钉子。
    expect(projectRoleOutranks(null, 'viewer')).toBe(false);
    expect(projectRoleOutranks('admin' as never, 'viewer')).toBe(false);
    expect(projectRoleOutranks('owner', 'admin' as never)).toBe(true);
  });

  it('拥有者签得出管理者，管理者签不出管理者', () => {
    expect(projectInvitationRolesFor('owner')).toEqual(['manager', 'editor', 'viewer']);
    expect(projectAssignableRolesFor('owner')).toEqual(['manager', 'editor', 'viewer']);
    // ⛔ 管理者手上没有 manager 这一档 ⇒ 界面上也造不出第二个管理者。
    expect(projectInvitationRolesFor('manager')).toEqual(['editor', 'viewer']);
    expect(projectAssignableRolesFor('manager')).toEqual(['editor', 'viewer']);
    // 任何档位都签不出 owner——不是靠闭集，是靠「没有档位高于 owner」这条独立理由。
    for (const actor of ['owner', 'manager', 'editor', 'viewer'] as const) {
      expect(projectAssignableRolesFor(actor)).not.toContain('owner');
    }
  });

  it('判不出档位时一档也不给（fail-closed）', () => {
    expect(projectInvitationRolesFor(null)).toEqual([]);
    expect(projectAssignableRolesFor('viewer')).toEqual([]);
  });

  it('收窄闸不回答「够不够档」——那是另一闸，与服务端同样分开', () => {
    // 成员(editor) 的档位确实严格高于观察者，所以这份清单不是空的；
    // 但他压根进不了签发面：服务端 `_require_member(..., "manager")` 先拦，
    // 客户端由入口门（ProjectConfigAside 的 canManage）先拦。⛔ 别把两闸并成一处。
    expect(projectAssignableRolesFor('editor')).toEqual(['viewer']);
  });
});

describe('project-collab bounds (mutation anchors: literals on purpose)', () => {
  it('pins the project name limit at exactly 120 characters', () => {
    expect(PROJECT_MAX_NAME_LENGTH).toBe(120);
    expect(ProjectCreateRequestSchema.safeParse({ name: 'a'.repeat(120) }).success).toBe(true);
    expect(ProjectCreateRequestSchema.safeParse({ name: 'a'.repeat(121) }).success).toBe(false);
  });

  it('pins the chat body limit at exactly 8,000 characters', () => {
    expect(CHAT_MAX_BODY_LENGTH).toBe(8_000);
    expect(
      ProjectChatSendRequestSchema.safeParse({ projectId: PROJECT_ID, bodyMd: 'a'.repeat(8_000) })
        .success,
    ).toBe(true);
    expect(
      ProjectChatSendRequestSchema.safeParse({ projectId: PROJECT_ID, bodyMd: 'a'.repeat(8_001) })
        .success,
    ).toBe(false);
  });

  it('pins the feed body limit at exactly 20,000 characters', () => {
    expect(FEED_MAX_BODY_LENGTH).toBe(20_000);
    expect(
      ProjectFeedPostRequestSchema.safeParse({ projectId: PROJECT_ID, bodyMd: 'a'.repeat(20_000) })
        .success,
    ).toBe(true);
    expect(
      ProjectFeedPostRequestSchema.safeParse({ projectId: PROJECT_ID, bodyMd: 'a'.repeat(20_001) })
        .success,
    ).toBe(false);
  });

  it('pins the file size limit at exactly 1 GiB', () => {
    expect(PROJECT_FILE_MAX_BYTES).toBe(1_073_741_824);
    expect(ProjectFileSchema.safeParse(validProjectFile({ bytes: 1_073_741_824 })).success).toBe(
      true,
    );
    expect(ProjectFileSchema.safeParse(validProjectFile({ bytes: 1_073_741_825 })).success).toBe(
      false,
    );
  });

  it('pins the list limit at exactly 200', () => {
    expect(PROJECT_LIST_MAX_LIMIT).toBe(200);
    expect(
      ProjectFeedListRequestSchema.safeParse({ projectId: PROJECT_ID, limit: 200 }).success,
    ).toBe(true);
    expect(
      ProjectFeedListRequestSchema.safeParse({ projectId: PROJECT_ID, limit: 201 }).success,
    ).toBe(false);
    expect(
      ProjectChatHistoryRequestSchema.safeParse({ projectId: PROJECT_ID, limit: 201 }).success,
    ).toBe(false);
    expect(
      ProjectChatHistoryRequestSchema.safeParse({
        projectId: PROJECT_ID,
        authorSubject: 'member:alpha',
        createdAfter: '2026-08-01T00:00:00Z',
        createdBefore: '2026-09-01T00:00:00+08:00',
      }).success,
    ).toBe(true);
    expect(
      ProjectChatHistoryRequestSchema.safeParse({
        projectId: PROJECT_ID,
        createdAfter: 'not-a-time',
      }).success,
    ).toBe(false);
    expect(
      ProjectChatHistoryRequestSchema.safeParse({ projectId: PROJECT_ID, beforeSeq: 0 }).success,
    ).toBe(false);
    expect(
      ProjectChatHistoryRequestSchema.safeParse({
        projectId: PROJECT_ID,
        createdAfter: '2026-09-01T00:00:00Z',
        createdBefore: '2026-08-01T00:00:00Z',
      }).success,
    ).toBe(false);
    const projects = Array.from({ length: 201 }, (_, index) =>
      validSummary({ name: `p-${String(index)}` }),
    );
    expect(ProjectListResultSchema.safeParse({ ok: true, projects }).success).toBe(false);
    expect(
      ProjectListResultSchema.safeParse({ ok: true, projects: projects.slice(0, 200) }).success,
    ).toBe(true);
  });
});

describe('availability result（enabled + mySubject 显隐判据）', () => {
  it('accepts both branches: enabled with subject, disabled with null', () => {
    expect(
      ProjectCollabAvailabilitySchema.safeParse({ enabled: true, mySubject: 'user-alice' }).success,
    ).toBe(true);
    // enabled 但主体暂不可得：允许 null（UI 收起本人按钮）。
    expect(
      ProjectCollabAvailabilitySchema.safeParse({ enabled: true, mySubject: null }).success,
    ).toBe(true);
    expect(
      ProjectCollabAvailabilitySchema.safeParse({ enabled: false, mySubject: null }).success,
    ).toBe(true);
  });

  it('structurally refuses a subject on the disabled branch (refine)', () => {
    expect(
      ProjectCollabAvailabilitySchema.safeParse({ enabled: false, mySubject: 'user-alice' })
        .success,
    ).toBe(false);
  });

  it('refuses missing mySubject, empty subject and unknown keys', () => {
    expect(ProjectCollabAvailabilitySchema.safeParse({ enabled: true }).success).toBe(false);
    expect(
      ProjectCollabAvailabilitySchema.safeParse({ enabled: true, mySubject: '' }).success,
    ).toBe(false);
    expect(
      ProjectCollabAvailabilitySchema.safeParse({
        enabled: true,
        mySubject: 'user-alice',
        accountKey: 'a-1',
      }).success,
    ).toBe(false);
  });
});

describe('project-collab results', () => {
  it('keeps the error branch closed and bounded', () => {
    expect(
      ProjectListResultSchema.safeParse({
        ok: false,
        code: 'transient',
        message: '稍后重试',
        referenceCode: 'STRX-COLLAB-010',
      }).success,
    ).toBe(true);
    expect(
      ProjectListResultSchema.safeParse({
        ok: false,
        code: 'notInstalled',
        message: 'x',
        referenceCode: 'STRX-COLLAB-010',
      }).success,
    ).toBe(false);
    expect(
      ProjectListResultSchema.safeParse({
        ok: false,
        code: 'transient',
        message: 'x',
        referenceCode: 'STRX-COLLAB-010',
        detail: 'y',
      }).success,
    ).toBe(false);
  });

  /**
   * serverCode 是**可选**透传字段：合法业务码接受，缺席合法，形状不合的一律拒
   * （闭集 = 小写起头 snake_case，≤64）——它绝不能变成夹带自由文本的口子。
   */
  it('accepts an optional serverCode and rejects malformed ones', () => {
    expect(
      ProjectListResultSchema.safeParse({
        ok: false,
        code: 'rejected',
        message: '该邀请已关闭。',
        referenceCode: 'STRX-COLLAB-009',
        serverCode: 'invitation_revoked',
      }).success,
    ).toBe(true);
    // 缺席仍合法：服务端没给可用业务码时不带它。
    expect(
      ProjectListResultSchema.safeParse({
        ok: false,
        code: 'rejected',
        message: 'x',
        referenceCode: 'STRX-COLLAB-009',
      }).success,
    ).toBe(true);
    // 大写 / 空格 / 数字起头 / 空串 / 超长：逐条拒。
    for (const bad of ['Invitation_Revoked', 'has space', '1leading', '', 'a'.repeat(65)]) {
      expect(
        ProjectListResultSchema.safeParse({
          ok: false,
          code: 'rejected',
          message: 'x',
          referenceCode: 'STRX-COLLAB-009',
          serverCode: bad,
        }).success,
      ).toBe(false);
    }
  });

  /**
   * 参考编号在**信封层**必填：漏填的通道过不了 schema，形状不对的串也过不了。
   * 「有失败必有可抄的编号」由这一条守住，不靠各通道自觉。
   */
  it('requires a well-formed reference code on every failure envelope', () => {
    expect(
      ProjectListResultSchema.safeParse({ ok: false, code: 'transient', message: 'x' }).success,
    ).toBe(false);
    expect(
      ProjectListResultSchema.safeParse({
        ok: false,
        code: 'transient',
        message: 'x',
        referenceCode: 'STRX-AAV-503',
      }).success,
    ).toBe(false);
    expect(
      ProjectListResultSchema.safeParse({
        ok: false,
        code: 'transient',
        message: 'x',
        referenceCode: 'STRX-COLLAB-10',
      }).success,
    ).toBe(false);
  });

  /** 登记表逐码全覆盖：新增失败码时忘了续号，这条会红。 */
  it('registers exactly one reference code per public failure code', () => {
    const codes = ProjectCollabErrorCodeSchema.options;
    expect(Object.keys(PROJECT_COLLAB_REFERENCE_CODES).sort()).toEqual([...codes].sort());
    const issued = Object.values(PROJECT_COLLAB_REFERENCE_CODES);
    expect(new Set(issued).size).toBe(issued.length);
    for (const code of issued) {
      expect(ProjectCollabReferenceCodeSchema.safeParse(code).success).toBe(true);
    }
  });

  it('file upload success side is exactly one of file / cancelled', () => {
    expect(
      ProjectFileUploadResultSchema.safeParse({ ok: true, file: validProjectFile() }).success,
    ).toBe(true);
    expect(ProjectFileUploadResultSchema.safeParse({ ok: true, cancelled: true }).success).toBe(
      true,
    );
    // 两个成功分支互斥：file + cancelled 同时出现是非法形态。
    expect(
      ProjectFileUploadResultSchema.safeParse({
        ok: true,
        file: validProjectFile(),
        cancelled: true,
      }).success,
    ).toBe(false);
    expect(ProjectFileUploadResultSchema.safeParse({ ok: true, cancelled: false }).success).toBe(
      false,
    );
    expect(
      ProjectFileUploadResultSchema.safeParse({
        ok: false,
        code: 'tooLarge',
        message: '超限',
        referenceCode: 'STRX-COLLAB-004',
        quota: null,
      }).success,
    ).toBe(true);
  });

  it('carries the temp-file quota only on the upload failure branch', () => {
    // 触顶：两个数一起带回（报错条要说得出「上限多少、用了多少」）。
    expect(
      ProjectFileUploadResultSchema.safeParse({
        ok: false,
        code: 'quotaExceeded',
        message: '临时文件已达上限',
        referenceCode: 'STRX-COLLAB-012',
        quota: { limitBytes: 2_147_483_648, usedBytes: 2_100_000_000 },
      }).success,
    ).toBe(true);
    // 缺席即非法：`quota` 是必填键（null 表达「这次失败与配额无关」）——
    // 漏填的通道过不了 schema，不会出现「有 quotaExceeded 却没有数」的结果。
    expect(
      ProjectFileUploadResultSchema.safeParse({
        ok: false,
        code: 'quotaExceeded',
        message: '临时文件已达上限',
        referenceCode: 'STRX-COLLAB-012',
      }).success,
    ).toBe(false);
    // 成功侧没有这个键（严格对象挡住夹带）。
    expect(
      ProjectFileUploadResultSchema.safeParse({
        ok: true,
        file: validProjectFile(),
        quota: { limitBytes: 1, usedBytes: 0 },
      }).success,
    ).toBe(false);
  });

  it('carries currentVersion only on the todo-update failure branch', () => {
    expect(
      ProjectTodoUpdateResultSchema.safeParse({
        ok: false,
        code: 'conflict',
        message: '待办已被他人更新',
        referenceCode: 'STRX-COLLAB-006',
        currentVersion: 4,
      }).success,
    ).toBe(true);
    expect(
      ProjectTodoUpdateResultSchema.safeParse({
        ok: false,
        code: 'transient',
        message: '稍后重试',
        referenceCode: 'STRX-COLLAB-010',
        currentVersion: null,
      }).success,
    ).toBe(true);
    expect(
      ProjectTodoUpdateResultSchema.safeParse({ ok: true, todo: validTodo(), currentVersion: 4 })
        .success,
    ).toBe(false);
  });
});

describe('ProjectEventSchema', () => {
  it('accepts domain frames with projectId and opaque payload', () => {
    expect(
      ProjectEventSchema.safeParse({
        kind: 'chat.message',
        projectId: PROJECT_ID,
        payload: { seq: 43 },
      }).success,
    ).toBe(true);
    expect(
      ProjectEventSchema.safeParse({ kind: 'todo.changed', projectId: PROJECT_ID, payload: null })
        .success,
    ).toBe(true);
  });

  it('accepts connection frames with a closed state set and no projectId', () => {
    expect(
      ProjectEventSchema.safeParse({ kind: 'connection', payload: { state: 'degraded' } }).success,
    ).toBe(true);
    expect(
      ProjectEventSchema.safeParse({ kind: 'connection', payload: { state: 'flaky' } }).success,
    ).toBe(false);
    expect(
      ProjectEventSchema.safeParse({
        kind: 'connection',
        projectId: PROJECT_ID,
        payload: { state: 'online' },
      }).success,
    ).toBe(false);
  });

  it('refuses domain frames without projectId and kinds outside the closed set', () => {
    expect(
      ProjectEventSchema.safeParse({ kind: 'chat.message', payload: { seq: 1 } }).success,
    ).toBe(false);
    // 服务端 `resync` 帧由 Main 消化为全量重拉，**不进渲染层契约**。
    expect(
      ProjectEventSchema.safeParse({ kind: 'resync', projectId: PROJECT_ID, payload: {} }).success,
    ).toBe(false);
  });
});

describe('project reference tokens (G-9 / G-10)', () => {
  it('pins the mention prefix that the service reads back', () => {
    // ⚠️ 跨线契约的客户端半边：服务端 `server/domain.py` 的 MENTION_REF_PREFIX 是
    // `'member:'`，`extract_mentions` 按它从 refs 里提出被 @ 的人。改这个字面量而不
    // 同改服务端，提及会静默失效（事件面 mentions 恒空，通知判定永远判不出）。
    expect(PROJECT_REF_KIND_MEMBER).toBe('member');
    expect(buildProjectRef(PROJECT_REF_KIND_MEMBER, 'u-bob')).toBe('member:u-bob');
    expect(PROJECT_REF_PICKABLE_KINDS).toEqual(['asset', 'todo']);
  });

  it('refuses to build a token the wire schema would reject', () => {
    // 正文塞不进 refs：带空白/中文的 id 组不出 token，宁可不引用也不发必被拒的请求。
    expect(buildProjectRef(PROJECT_REF_KIND_ASSET, 'a b')).toBeNull();
    expect(buildProjectRef(PROJECT_REF_KIND_TODO, '待办')).toBeNull();
    expect(buildProjectRef(PROJECT_REF_KIND_ASSET, 'f'.repeat(300))).toBeNull();
  });

  it('carries refs on feed posts with the same bound as chat', () => {
    const refs = Array.from({ length: PROJECT_MAX_REFS }, (_, index) => `asset:f-${index}`);
    expect(
      ProjectFeedPostRequestSchema.safeParse({ projectId: PROJECT_ID, bodyMd: '看下', refs })
        .success,
    ).toBe(true);
    expect(
      ProjectFeedPostRequestSchema.safeParse({
        projectId: PROJECT_ID,
        bodyMd: '看下',
        refs: [...refs, 'asset:f-extra'],
      }).success,
    ).toBe(false);
    // 带空白的 token 一律拒（红线 2 的结构性载体）。
    expect(
      ProjectFeedPostRequestSchema.safeParse({
        projectId: PROJECT_ID,
        bodyMd: '看下',
        refs: ['asset:这是 正文'],
      }).success,
    ).toBe(false);
  });

  it('keeps todo relations in the projection and in both write requests', () => {
    expect(
      TodoSchema.safeParse(validTodo({ sessionRef: 's-1', refs: ['asset:f-1'] })).success,
    ).toBe(true);
    expect(
      ProjectTodoCreateRequestSchema.safeParse({
        projectId: PROJECT_ID,
        itemKind: 'requirement',
        title: '核对底图',
        sessionRef: 's-1',
        refs: ['asset:f-1'],
      }).success,
    ).toBe(true);
    // 关联面单独也够格成为一次更新（不必陪着改标题）。
    expect(
      ProjectTodoUpdateRequestSchema.safeParse({
        todoId: ENTITY_ID,
        expectedVersion: 1,
        refs: [],
      }).success,
    ).toBe(true);
    // null＝解绑会话；缺席＝不改（两者在契约里分得开）。
    expect(
      ProjectTodoUpdateRequestSchema.safeParse({
        todoId: ENTITY_ID,
        expectedVersion: 1,
        sessionRef: null,
      }).success,
    ).toBe(true);
    expect(
      ProjectTodoUpdateRequestSchema.safeParse({ todoId: ENTITY_ID, expectedVersion: 1 }).success,
    ).toBe(false);
  });
});

describe('待办两级 / 来源 / 可见性契约', () => {
  const PARENT_ID = '33333333-3333-4333-8333-333333333333';

  it('projects the hierarchy, source and visibility fields', () => {
    const parsed = TodoSchema.parse(
      validTodo({ parentId: PARENT_ID, source: 'assistant', visibility: 'personal' }),
    );
    expect(parsed.parentId).toBe(PARENT_ID);
    expect(parsed.source).toBe('assistant');
    expect(parsed.visibility).toBe('personal');
  });

  it('closes both enums (an unknown source or visibility is not a todo)', () => {
    expect(TodoSchema.safeParse(validTodo({ source: 'imported' as never })).success).toBe(false);
    expect(TodoSchema.safeParse(validTodo({ visibility: 'secret' as never })).success).toBe(false);
    expect(
      ProjectTodoCreateRequestSchema.safeParse({
        projectId: PROJECT_ID,
        itemKind: 'requirement',
        title: '核对底图',
        visibility: 'secret',
      }).success,
    ).toBe(false);
  });

  it('requires all three fields — an absent one is not a todo', () => {
    // 界面接线这一轮把三个字段收紧为必填（方案增量 §3.2c 欠账 1）：
    // 「可能没有」在契约层已不可表达，缺省只活在写入侧（mapTodo / serialize_todo）。
    for (const key of ['itemKind', 'parentId', 'source', 'visibility'] as const) {
      const withoutField: Record<string, unknown> = { ...validTodo() };
      delete withoutField[key];
      expect(TodoSchema.safeParse(withoutField).success).toBe(false);
    }
    // 成对的另一半：三个都在时照常解析（上面的红不是因为夹具本身坏了）。
    expect(TodoSchema.safeParse(validTodo()).success).toBe(true);
  });

  it('uses explicit itemKind independently from parentId', () => {
    const requirement = TodoSchema.parse(
      validTodo({ itemKind: 'requirement', parentId: PARENT_ID }),
    );
    expect(isTodoRequirement(requirement)).toBe(true);
    expect(todoParentId(requirement)).toBe(PARENT_ID);
    expect(todoSource(requirement)).toBe('manual');
    expect(todoVisibility(requirement)).toBe('shared');

    const task = TodoSchema.parse(validTodo({ itemKind: 'task', parentId: null }));
    expect(isTodoRequirement(task)).toBe(false);
    expect(todoParentId(task)).toBeNull();
  });

  it('requires an explicit closed-set itemKind on todos and create requests', () => {
    expect(
      ProjectTodoCreateRequestSchema.safeParse({
        projectId: PROJECT_ID,
        title: '子需求',
        itemKind: 'requirement',
        parentId: PARENT_ID,
      }).success,
    ).toBe(true);
    expect(
      ProjectTodoCreateRequestSchema.safeParse({
        projectId: PROJECT_ID,
        title: '未知类型',
        itemKind: 'story',
      }).success,
    ).toBe(false);
  });

  it('lets the list request ask for top level only, one requirement, or no filter at all', () => {
    // 缺席＝不过滤（老客户端的请求逐字不变）。
    expect(ProjectTodoListRequestSchema.parse({ projectId: PROJECT_ID })).toEqual({
      projectId: PROJECT_ID,
    });
    // null＝只要顶层需求；uuid＝只要那条需求下的任务。两者在契约里分得开。
    expect(
      ProjectTodoListRequestSchema.safeParse({ projectId: PROJECT_ID, parentId: null }).success,
    ).toBe(true);
    expect(
      ProjectTodoListRequestSchema.safeParse({ projectId: PROJECT_ID, parentId: PARENT_ID })
        .success,
    ).toBe(true);
    expect(
      ProjectTodoListRequestSchema.safeParse({ projectId: PROJECT_ID, source: 'assistant' })
        .success,
    ).toBe(true);
    expect(
      ProjectTodoListRequestSchema.safeParse({ projectId: PROJECT_ID, visibility: 'nope' }).success,
    ).toBe(false);
  });

  it('accepts a parent on create and a re-parent (or detach) on update', () => {
    expect(
      ProjectTodoCreateRequestSchema.safeParse({
        projectId: PROJECT_ID,
        itemKind: 'task',
        title: '任务一',
        parentId: PARENT_ID,
        visibility: 'personal',
      }).success,
    ).toBe(true);
    // 改挂靠单独也够格成为一次更新；null＝摘回顶层。
    expect(
      ProjectTodoUpdateRequestSchema.safeParse({
        todoId: ENTITY_ID,
        expectedVersion: 1,
        parentId: PARENT_ID,
      }).success,
    ).toBe(true);
    expect(
      ProjectTodoUpdateRequestSchema.safeParse({
        todoId: ENTITY_ID,
        expectedVersion: 1,
        parentId: null,
      }).success,
    ).toBe(true);
  });

  it('keeps source and visibility out of the update request on purpose', () => {
    // source 是建单当时的来源留痕，visibility 翻转是未拍板的产品决策——
    // 两者都不可改，且「不可表达的东西不需要在运行时校验」。
    for (const field of [{ source: 'manual' }, { visibility: 'shared' }]) {
      expect(
        ProjectTodoUpdateRequestSchema.safeParse({
          todoId: ENTITY_ID,
          expectedVersion: 1,
          title: '改个标题',
          ...field,
        }).success,
      ).toBe(false);
    }
  });
});

describe('工作单契约：验收清单 / 待验收档 / 打回理由 / 拆解草案', () => {
  const DRAFT_ID = '44444444-4444-4444-8444-444444444444';

  it('adds inReview to the status closed set without opening it up', () => {
    // 「待验收」是执行方说完了与派单方认可完了之间的缓冲区（迁移 0009）。
    expect(TodoSchema.safeParse(validTodo({ status: 'inReview' })).success).toBe(true);
    expect(TodoSchema.safeParse(validTodo({ status: 'inspection' as never })).success).toBe(false);
  });

  it('derives work order vs plain todo from the acceptance list alone (no kind field)', () => {
    const plain = TodoSchema.parse(validTodo());
    expect(isTodoWorkOrder(plain)).toBe(false);
    expect(todoAcceptanceProgress(plain)).toEqual({ total: 0, checked: 0 });
    expect(todoConstraints(plain)).toBe('');

    const workOrder = TodoSchema.parse(
      validTodo({ acceptanceTotal: 2, acceptanceChecked: 1, constraintsText: '别动线上库' }),
    );
    expect(isTodoWorkOrder(workOrder)).toBe(true);
    expect(todoAcceptanceProgress(workOrder)).toEqual({ total: 2, checked: 1 });
    expect(todoConstraints(workOrder)).toBe('别动线上库');
  });

  it('requires the three work-order keys (the pre-0009 default lives on the write side)', () => {
    // 界面接线这一轮由可选收紧为必填（方案增量 §3.2c 欠账 1）：「可能没有」在契约层
    // 不可表达，下游不必也不该各写各的 `?? ''` / `?? 0`。
    // ⚠️ 老服务端的向后兼容**没有丢**，只是换了承载处——缺省下沉到写入侧
    // （Main 的 `mapTodo` 把缺席的三个键投影成 `'' / 0 / 0`），那一侧自有用例钉住
    // （collabClient.test.ts「keeps a pre-0009 wire todo trustworthy」）。
    for (const key of ['constraintsText', 'acceptanceTotal', 'acceptanceChecked']) {
      const missing: Record<string, unknown> = { ...validTodo() };
      delete missing[key];
      expect(TodoSchema.safeParse(missing).success).toBe(false);
    }
  });

  it('refuses a blank acceptance item on create (a blank criterion is not a criterion)', () => {
    expect(
      ProjectTodoCreateRequestSchema.safeParse({
        projectId: PROJECT_ID,
        itemKind: 'requirement',
        title: '核对底图',
        acceptanceItems: ['底图与规范逐项对齐'],
      }).success,
    ).toBe(true);
    for (const blank of ['', '   ', '\n\t']) {
      expect(
        ProjectTodoCreateRequestSchema.safeParse({
          projectId: PROJECT_ID,
          itemKind: 'requirement',
          title: '核对底图',
          acceptanceItems: [blank],
        }).success,
      ).toBe(false);
    }
  });

  it('keeps the acceptance list out of the ordinary update request on purpose', () => {
    // 改判据会作废已勾的条目——那是一次语义明确的动作，有独立通道。
    expect(
      ProjectTodoUpdateRequestSchema.safeParse({
        todoId: ENTITY_ID,
        expectedVersion: 1,
        acceptanceItems: ['顺手换一条'],
      }).success,
    ).toBe(false);
    // 注意事项则是可改的（它是当下的边界说明），且单独也够格成为一次更新。
    expect(
      ProjectTodoUpdateRequestSchema.safeParse({
        todoId: ENTITY_ID,
        expectedVersion: 1,
        constraintsText: '换一条边界',
      }).success,
    ).toBe(true);
  });

  it('requires a reason on reject and forbids one on accept (contract-level gate)', () => {
    // ⭐ 不写理由的打回等于让执行方猜——契约层就拒，压根到不了网络面。
    expect(
      ProjectTodoReviewRequestSchema.safeParse({
        todoId: ENTITY_ID,
        expectedVersion: 2,
        decision: 'reject',
      }).success,
    ).toBe(false);
    for (const blank of ['', '   ']) {
      expect(
        ProjectTodoReviewRequestSchema.safeParse({
          todoId: ENTITY_ID,
          expectedVersion: 2,
          decision: 'reject',
          reason: blank,
        }).success,
      ).toBe(false);
    }
    expect(
      ProjectTodoReviewRequestSchema.safeParse({
        todoId: ENTITY_ID,
        expectedVersion: 2,
        decision: 'reject',
        reason: '第 2 条没有给出证据链接',
      }).success,
    ).toBe(true);
    // 成对的另一半：通过不许带理由（通过的理由写在逐条验收自述里）。
    expect(
      ProjectTodoReviewRequestSchema.safeParse({
        todoId: ENTITY_ID,
        expectedVersion: 2,
        decision: 'accept',
        checkedOrdinals: [1, 2],
      }).success,
    ).toBe(true);
    expect(
      ProjectTodoReviewRequestSchema.safeParse({
        todoId: ENTITY_ID,
        expectedVersion: 2,
        decision: 'accept',
        reason: '很好',
      }).success,
    ).toBe(false);
  });

  it('requires a summary when submitting for review', () => {
    expect(
      ProjectTodoSubmitReviewRequestSchema.safeParse({
        todoId: ENTITY_ID,
        expectedVersion: 1,
      }).success,
    ).toBe(false);
    expect(
      ProjectTodoSubmitReviewRequestSchema.safeParse({
        todoId: ENTITY_ID,
        expectedVersion: 1,
        summary: '已按清单逐条核对并归档',
        itemNotes: [{ ordinal: 1, note: '纪要第 3 节' }],
      }).success,
    ).toBe(true);
  });

  it('carries the two-viewer audience on a draft batch and needs at least one draft', () => {
    const batch = {
      id: DRAFT_ID,
      projectId: PROJECT_ID,
      sourceTodoId: ENTITY_ID,
      targetItemKind: 'task' as const,
      parentId: ENTITY_ID,
      createdBySubject: 'user-bob',
      dispatcherSubject: 'user-alice',
      state: 'open' as const,
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
          constraintsText: '',
          acceptanceItems: ['字段与规范逐项对齐'],
          priority: 'medium' as const,
          basis: 'input' as const,
          state: 'pending' as const,
          todoId: null,
          droppedAt: null,
          droppedBySubject: null,
        },
      ],
    };
    expect(TodoDraftBatchSchema.parse(batch)).toEqual(batch);
    // 丢弃留痕的两个键在契约里都在（谁、什么时候）。
    expect(
      TodoDraftBatchSchema.safeParse({
        ...batch,
        state: 'discarded',
        discardedAt: '2026-08-29T09:00:00.000Z',
        discardedBySubject: 'user-alice',
      }).success,
    ).toBe(true);
    // 空批次不成立：一批零条草案没有可审的东西。
    expect(
      ProjectTodoDraftCreateRequestSchema.safeParse({ projectId: PROJECT_ID, items: [] }).success,
    ).toBe(false);
    expect(
      ProjectTodoDraftCreateRequestSchema.safeParse({
        projectId: PROJECT_ID,
        sourceTodoId: ENTITY_ID,
        targetItemKind: 'task',
        parentId: ENTITY_ID,
        items: [{ title: '核对入库字段', acceptanceItems: ['逐项对齐'] }],
      }).success,
    ).toBe(true);
  });

  it('closes the resolve decision set to confirm / discard', () => {
    for (const decision of ['confirm', 'discard']) {
      expect(
        ProjectTodoDraftResolveRequestSchema.safeParse({ batchId: DRAFT_ID, decision }).success,
      ).toBe(true);
    }
    expect(
      ProjectTodoDraftResolveRequestSchema.safeParse({ batchId: DRAFT_ID, decision: 'maybe' })
        .success,
    ).toBe(false);
  });
});

describe('处理人档位（0010）', () => {
  it('derives “dispatched to the assistant” from the tier, never from an empty assignee', () => {
    // ⛔ 空处理人在**两个**档位下都会出现（member 档的无人认领 / 助理档），
    //    拿它当判据会把两件事混成一件。
    const assistant = validTodo({
      assigneeKind: 'assistant',
      assigneeSubject: null,
      assigneeDisplayName: null,
    });
    const unclaimed = validTodo({ assigneeSubject: null, assigneeDisplayName: null });

    expect(isTodoAssignedToAssistant(assistant)).toBe(true);
    expect(isTodoUnassigned(assistant)).toBe(false);
    expect(isTodoAssignedToAssistant(unclaimed)).toBe(false);
    expect(isTodoUnassigned(unclaimed)).toBe(true);
  });

  it('makes “assistant tier plus a member subject” unexpressible on both write contracts', () => {
    // ⭐ 助理不是成员账号：档位与人同时给在契约层就该被拒（服务端 CHECK 是第三道）。
    expect(
      ProjectTodoCreateRequestSchema.safeParse({
        projectId: PROJECT_ID,
        itemKind: 'requirement',
        title: '核查这批数据',
        assigneeKind: 'assistant',
        assigneeSubject: 'u-bob',
      }).success,
    ).toBe(false);
    expect(
      ProjectTodoUpdateRequestSchema.safeParse({
        todoId: ENTITY_ID,
        expectedVersion: 3,
        assigneeKind: 'assistant',
        assigneeSubject: 'u-bob',
      }).success,
    ).toBe(false);
    // 成对的另一半：助理档不带处理人、成员档带处理人，两种都成立。
    expect(
      ProjectTodoCreateRequestSchema.safeParse({
        projectId: PROJECT_ID,
        itemKind: 'requirement',
        title: '核查这批数据',
        assigneeKind: 'assistant',
      }).success,
    ).toBe(true);
    expect(
      ProjectTodoUpdateRequestSchema.safeParse({
        todoId: ENTITY_ID,
        expectedVersion: 3,
        assigneeKind: 'member',
        assigneeSubject: 'u-bob',
      }).success,
    ).toBe(true);
    // 判据本体（两个契约共用这一份）。
    expect(assigneeDispatchIsConsistent({ assigneeKind: 'assistant', assigneeSubject: null })).toBe(
      true,
    );
    expect(
      assigneeDispatchIsConsistent({ assigneeKind: 'assistant', assigneeSubject: 'u-bob' }),
    ).toBe(false);
  });

  it('counts a tier change as a change so a bare re-dispatch is a valid patch', () => {
    // 「从无人认领改派给助理」两侧的 assigneeSubject 都是空，变的只有档位——
    // 漏了它，这次改派会被「至少带一项变更」挡在门外。
    expect(
      ProjectTodoUpdateRequestSchema.safeParse({
        todoId: ENTITY_ID,
        expectedVersion: 3,
        assigneeKind: 'assistant',
      }).success,
    ).toBe(true);
  });
});

/**
 * 项目卡的列表投影（落地验收清单第五项）。
 *
 * ⭐ 本组的要害是 `.max(PROJECT_SUMMARY_PREVIEW_MEMBERS)`：它是客户端这一侧
 * 「列表投影里没有全量名册」的结构性闸——服务端哪天回了整份名册，这条列表
 * 整体解析失败（不做部分采信），而不是让项目列表随成员数悄悄膨胀。
 */
describe('项目卡投影（描述 + 成员预览）', () => {
  function member(index: number): { subject: string; displayName: string } {
    return { subject: `user-${index}`, displayName: `成员${index}` };
  }

  it('carries a bounded description and a capped member preview', () => {
    const card = validSummary({
      summary: '面向水务集团的智慧管网二期交付。',
      memberCount: 9,
      memberPreview: [member(1), member(2), member(3)],
    });
    expect(ProjectSummarySchema.parse(card)).toEqual(card);
    // 描述有上界：卡片是一行字，不是一份 20000 字的说明。
    expect(
      ProjectSummarySchema.safeParse(
        validSummary({ summary: 'x'.repeat(PROJECT_SUMMARY_MAX_LENGTH + 1) }),
      ).success,
    ).toBe(false);
    // 没写说明就是空串（不是 null——它是一段文本，只是没有内容）。
    expect(ProjectSummarySchema.safeParse(validSummary({ summary: '' })).success).toBe(true);
    expect(ProjectSummarySchema.safeParse(validSummary({ summary: null as never })).success).toBe(
      false,
    );
  });

  it('refuses a full roster on the list projection', () => {
    // ⚠️ 变异自证：把 `.max(PROJECT_SUMMARY_PREVIEW_MEMBERS)` 去掉，这条当场翻红。
    const tooMany = Array.from({ length: PROJECT_SUMMARY_PREVIEW_MEMBERS + 1 }, (_, index) =>
      member(index),
    );
    expect(ProjectSummarySchema.safeParse(validSummary({ memberPreview: tooMany })).success).toBe(
      false,
    );
    // 一条不多刚好过（上界是「至多」，不是「必须正好」）。
    expect(
      ProjectSummarySchema.safeParse({
        ...validSummary(),
        memberPreview: tooMany.slice(0, PROJECT_SUMMARY_PREVIEW_MEMBERS),
      }).success,
    ).toBe(true);
  });

  it('keeps role, state and joinedAt out of the preview shape', () => {
    // 预览只有头像要用的两个字段：多带一格就是一次白送的名册字段。
    expect(
      ProjectSummarySchema.safeParse(
        validSummary({
          memberPreview: [{ ...member(1), role: 'owner' } as never],
        }),
      ).success,
    ).toBe(false);
  });

  it('derives the +N remainder from the count, never from a hard-coded three', () => {
    expect(
      projectExtraMemberCount(
        validSummary({ memberCount: 9, memberPreview: [member(1), member(2), member(3)] }),
      ),
    ).toBe(6);
    // 成员不足预览位时没有余数——⛔ 写死 `memberCount - 3` 会在两人项目上算出 -1。
    expect(
      projectExtraMemberCount(
        validSummary({ memberCount: 2, memberPreview: [member(1), member(2)] }),
      ),
    ).toBe(0);
    expect(
      projectExtraMemberCount(validSummary({ memberCount: 1, memberPreview: [member(1)] })),
    ).toBe(0);
  });
});

/**
 * 进度汇总（落地验收清单第二项）。
 *
 * 契约这一侧只能钉两件事：两个数**必填**（缺席即不是一条待办 ⇒ 下游不必各写各的
 * `?? 0`），以及取值口径只有 `todoChildProgress` 这一份。「不许本地重算」那条的
 * 机器载体在渲染层用例里（project-todo-hierarchy.test.ts）。
 */
describe('进度汇总契约', () => {
  it('requires both progress counters on every todo projection', () => {
    const withoutTotal: Record<string, unknown> = { ...validTodo() };
    delete withoutTotal['childTotal'];
    const withoutDone: Record<string, unknown> = { ...validTodo() };
    delete withoutDone['childDone'];
    expect(TodoSchema.safeParse(withoutTotal).success).toBe(false);
    expect(TodoSchema.safeParse(withoutDone).success).toBe(false);
  });

  it('reads the pair through one accessor and gates the badge on a non-zero total', () => {
    const requirement = validTodo({ childTotal: 3, childDone: 1 });
    expect(todoChildProgress(requirement)).toEqual({ total: 3, done: 1 });
    expect(hasTodoChildProgress(requirement)).toBe(true);
    // 任务行恒 0/0：不摆一个「0/0」的空进度。
    expect(hasTodoChildProgress(validTodo({ childTotal: 0, childDone: 0 }))).toBe(false);
  });

  it('refuses negative or absurd counters', () => {
    expect(TodoSchema.safeParse(validTodo({ childTotal: -1 })).success).toBe(false);
    expect(TodoSchema.safeParse(validTodo({ childDone: 1.5 })).success).toBe(false);
  });
});

/**
 * 需求专属子任务统计（CORE-04）：`requirement_task_total` → `requirementTaskTotal`。
 *
 * 与 childTotal/childDone（进度汇总）是两件事：进度数**全部可见后代**（含子需求及其
 * task）；本统计只数「最近 requirement 祖先落在自己身上」的未删可见 task。契约这一侧钉：
 *   · 字段**可选**——只有列表读路径补它；detail / 写路径 / 旧服务端不回 ⇒ 缺席，
 *     与 0（需求下无 task）分得开，⛔ 下游不许把缺席兜成 0；
 *   · 非负整数；
 *   · **不设上界**（服务端计数，子树规模由拆解深度决定；客户端封顶只会是下一堵墙，
 *     且越界会让 mapArray 一条坏全批坏——与 childTotal 同一条理由）。
 */
describe('需求专属子任务统计契约', () => {
  it('可选：列表路径带则为数字，缺席时为 undefined（不兜成 0）', () => {
    expect(TodoSchema.parse(validTodo({ requirementTaskTotal: 5 })).requirementTaskTotal).toBe(5);
    const withoutField: Record<string, unknown> = { ...validTodo() };
    delete withoutField['requirementTaskTotal'];
    expect(TodoSchema.parse(withoutField).requirementTaskTotal).toBeUndefined();
  });

  it('非负整数，且不设上界（极大的服务端计数照旧通过）', () => {
    for (const total of [0, 1, 500, 10_000, 1_000_000]) {
      expect(
        TodoSchema.parse(validTodo({ requirementTaskTotal: total })).requirementTaskTotal,
      ).toBe(total);
    }
    expect(TodoSchema.safeParse(validTodo({ requirementTaskTotal: -1 })).success).toBe(false);
    expect(TodoSchema.safeParse(validTodo({ requirementTaskTotal: 1.5 })).success).toBe(false);
  });
});

/**
 * 评论级 @ 提及（落地验收清单第三项）。
 *
 * ⛔【埋点红线的契约载体】请求契约是 strictObject 且只有 `entryId / bodyMd / refs`
 * 三个键——**没有任何埋点或诊断字段的位置**，也就没有「顺手带上正文」的可能。
 * `refs` 又被 token 正则收口成不含空白的短串：一段正文塞不进去。
 * 不可表达的东西不需要在运行时校验。
 */
describe('评论级 @ 提及契约', () => {
  it('carries refs on a comment with the same bound as a feed post', () => {
    const posted = {
      entryId: ENTITY_ID,
      bodyMd: '@李四 这条你跟一下',
      refs: [`${PROJECT_REF_KIND_MEMBER}:user-bob`],
    };
    expect(ProjectCommentPostRequestSchema.parse(posted)).toEqual(posted);
    // 缺席合法（没提及就不发这个键）。
    expect(
      ProjectCommentPostRequestSchema.safeParse({ entryId: ENTITY_ID, bodyMd: '收到' }).success,
    ).toBe(true);
    // 上界与动态/讨论同一份。
    expect(
      ProjectCommentPostRequestSchema.safeParse({
        entryId: ENTITY_ID,
        bodyMd: 'x',
        refs: Array.from({ length: PROJECT_MAX_REFS + 1 }, (_, index) => `asset:f-${index}`),
      }).success,
    ).toBe(false);
  });

  it('cannot smuggle body text through a mention token', () => {
    // ⛔ 引用是短 token，塞不进一句话（含空白与中文的串过不了正则）。
    for (const smuggled of ['member:李四', 'member:user bob', 'member:这是一整句正文']) {
      expect(
        ProjectCommentPostRequestSchema.safeParse({
          entryId: ENTITY_ID,
          bodyMd: '收到',
          refs: [smuggled],
        }).success,
      ).toBe(false);
    }
  });

  it('leaves no room for a telemetry rider on the comment request', () => {
    for (const rider of ['analytics', 'telemetry', 'mentionNames', 'accountKey']) {
      expect(
        ProjectCommentPostRequestSchema.safeParse({
          entryId: ENTITY_ID,
          bodyMd: '收到',
          [rider]: 'x',
        }).success,
      ).toBe(false);
    }
  });

  it('projects refs back on the stored comment', () => {
    const comment = {
      id: '44444444-4444-4444-8444-444444444444',
      authorSubject: 'user-bob',
      authorDisplayName: '李四',
      bodyMd: '@张三 收到',
      refs: [`${PROJECT_REF_KIND_MEMBER}:user-alice`],
      createdAt: '2026-08-24T09:00:00.000Z',
    };
    expect(FeedCommentSchema.parse(comment)).toEqual(comment);
    // 必填：服务端恒回、映射恒填（历史行按空数组投影）——⛔ 调用点不必写 `?? []`。
    const withoutRefs: Record<string, unknown> = { ...comment };
    delete withoutRefs['refs'];
    expect(FeedCommentSchema.safeParse(withoutRefs).success).toBe(false);
  });
});

describe('草案依据：输入里有的 vs 助手补的', () => {
  const draftItem = {
    id: '55555555-5555-4555-8555-555555555555',
    ordinal: 1,
    title: '核对入库字段',
    description: '',
    constraintsText: '',
    acceptanceItems: [],
    priority: 'medium' as const,
    state: 'pending' as const,
    todoId: null,
    droppedAt: null,
    droppedBySubject: null,
  };

  it('两档都收，闭集之外的值拒收', () => {
    expect(TodoDraftSchema.parse({ ...draftItem, basis: 'input' }).basis).toBe('input');
    expect(TodoDraftSchema.parse({ ...draftItem, basis: 'assumed' }).basis).toBe('assumed');
    // 成对的另一半：半个语义比没有语义更糟——第三个值当场拒。
    expect(TodoDraftSchema.safeParse({ ...draftItem, basis: 'guessed' }).success).toBe(false);
  });

  it('出参里 basis 是必填——缺了就是投影 bug，不是历史数据', () => {
    // 老服务端不返回它时由 `mapDraftBatch` 兜成 'input'；契约本身不给它留缺席的口子，
    // 否则「服务端忘了返回」与「这条确实有依据」在类型上不可区分。
    expect(TodoDraftSchema.safeParse(draftItem).success).toBe(false);
  });

  it('落草案时 basis 可省（缺省＝输入里有的）', () => {
    const request = {
      projectId: PROJECT_ID,
      sourceTodoId: ENTITY_ID,
      targetItemKind: 'task' as const,
      parentId: ENTITY_ID,
      items: [{ title: '按季度出报表' }, { title: '补一版权限校验', basis: 'assumed' as const }],
    };
    const parsed = ProjectTodoDraftCreateRequestSchema.parse(request);
    expect(parsed.items[0]?.basis).toBeUndefined();
    expect(parsed.items[1]?.basis).toBe('assumed');
  });
});

describe('事件闭集容得下定向的草案帧', () => {
  it('todo.draft 是域事件的一员', () => {
    expect(
      ProjectEventSchema.safeParse({
        kind: 'todo.draft',
        projectId: PROJECT_ID,
        payload: { batch_id: 'b-1', draft_count: 3 },
      }).success,
    ).toBe(true);
  });

  it('闭集之外的事件名仍然拒收', () => {
    // 对照臂：不是「什么 kind 都收」。
    expect(
      ProjectEventSchema.safeParse({
        kind: 'todo.invented',
        projectId: PROJECT_ID,
        payload: {},
      }).success,
    ).toBe(false);
  });
});

describe('ProjectTodoList pagination contract', () => {
  it('accepts bounded cursors and requires an explicit continuation state', () => {
    expect(
      ProjectTodoListRequestSchema.safeParse({ projectId: PROJECT_ID, cursor: 'opaque', limit: 50 })
        .success,
    ).toBe(true);
    expect(
      ProjectTodoListRequestSchema.safeParse({ projectId: PROJECT_ID, limit: 51 }).success,
    ).toBe(false);
    expect(
      ProjectTodoListResultSchema.safeParse({
        ok: true,
        todos: [],
        hasMore: false,
        nextCursor: null,
      }).success,
    ).toBe(true);
    expect(ProjectTodoListResultSchema.safeParse({ ok: true, todos: [] }).success).toBe(false);
    expect(
      ProjectTodoListResultSchema.safeParse({
        ok: true,
        todos: [],
        hasMore: true,
        nextCursor: null,
      }).success,
    ).toBe(false);
    expect(
      ProjectTodoListResultSchema.safeParse({
        ok: true,
        todos: [],
        hasMore: false,
        nextCursor: 'unexpected-cursor',
      }).success,
    ).toBe(false);
  });
});

/**
 * 限时开放邀请（成员档多人可用，服务端迁移 0016）：请求形态约束 + 深链解析 +
 * 列表/撤销结果形状 + 三枚服务端业务码文案。
 */
describe('open invitation 请求形态约束', () => {
  const INVITATION_ID = '44444444-4444-4444-8444-444444444444';

  it('single（缺省）不带 ttlHours/maxUses；行为逐字不变', () => {
    expect(
      ProjectInviteRequestSchema.safeParse({ projectId: PROJECT_ID, role: 'viewer' }).success,
    ).toBe(true);
    expect(
      ProjectInviteRequestSchema.safeParse({
        projectId: PROJECT_ID,
        role: 'editor',
        kind: 'single',
      }).success,
    ).toBe(true);
    // ⛔ single 带 ttlHours / maxUses 一律拒（服务端对 single 携带这两项一律 422），
    // 且**逐字段报错路径**（与服务端 06e74a39 定稿契约同构，防止被合成一条）。
    const singleWithTtl = ProjectInviteRequestSchema.safeParse({
      projectId: PROJECT_ID,
      role: 'editor',
      kind: 'single',
      ttlHours: 24,
    });
    expect(singleWithTtl.success).toBe(false);
    expect(
      !singleWithTtl.success && singleWithTtl.error.issues.some((i) => i.path[0] === 'ttlHours'),
    ).toBe(true);
    const singleWithMax = ProjectInviteRequestSchema.safeParse({
      projectId: PROJECT_ID,
      role: 'editor',
      kind: 'single',
      maxUses: 10,
    });
    expect(singleWithMax.success).toBe(false);
    expect(
      !singleWithMax.success && singleWithMax.error.issues.some((i) => i.path[0] === 'maxUses'),
    ).toBe(true);
  });

  it('open 必带闭集 ttlHours、只签 editor、maxUses 可选且封 500', () => {
    for (const ttlHours of [1, 24, 168]) {
      expect(
        ProjectInviteRequestSchema.safeParse({
          projectId: PROJECT_ID,
          role: 'editor',
          kind: 'open',
          ttlHours,
        }).success,
      ).toBe(true);
    }
    // ⛔ 有效期闭集外的值（含缺省沿用配置的那个 undefined）在 open 下一律拒。
    expect(
      ProjectInviteRequestSchema.safeParse({
        projectId: PROJECT_ID,
        role: 'editor',
        kind: 'open',
        ttlHours: 2,
      }).success,
    ).toBe(false);
    expect(
      ProjectInviteRequestSchema.safeParse({
        projectId: PROJECT_ID,
        role: 'editor',
        kind: 'open',
      }).success,
    ).toBe(false);
    // ⛔ 开放邀请只签成员：role≠editor 结构性拒（服务端 400 是权威门）。
    expect(
      ProjectInviteRequestSchema.safeParse({
        projectId: PROJECT_ID,
        role: 'manager',
        kind: 'open',
        ttlHours: 24,
      }).success,
    ).toBe(false);
    // maxUses 区间边界。
    expect(
      ProjectInviteRequestSchema.safeParse({
        projectId: PROJECT_ID,
        role: 'editor',
        kind: 'open',
        ttlHours: 24,
        maxUses: PROJECT_OPEN_INVITATION_MAX_USES,
      }).success,
    ).toBe(true);
    expect(
      ProjectInviteRequestSchema.safeParse({
        projectId: PROJECT_ID,
        role: 'editor',
        kind: 'open',
        ttlHours: 24,
        maxUses: PROJECT_OPEN_INVITATION_MAX_USES + 1,
      }).success,
    ).toBe(false);
    expect(
      ProjectInviteRequestSchema.safeParse({
        projectId: PROJECT_ID,
        role: 'editor',
        kind: 'open',
        ttlHours: 24,
        maxUses: 0,
      }).success,
    ).toBe(false);
  });

  it('invite 结果 ok 分支带 invitationId / kind / maxUses（null 允许）', () => {
    expect(
      ProjectInviteResultSchema.safeParse({
        ok: true,
        code: 'abcdefgh12345678',
        expiresAt: '2026-09-06T00:00:00.000Z',
        invitationId: INVITATION_ID,
        kind: 'open',
        maxUses: null,
      }).success,
    ).toBe(true);
    expect(
      ProjectInviteResultSchema.safeParse({
        ok: true,
        code: 'abcdefgh12345678',
        expiresAt: '2026-09-06T00:00:00.000Z',
        invitationId: INVITATION_ID,
        kind: 'single',
        maxUses: 5,
      }).success,
    ).toBe(true);
    // ⛔ 缺 invitationId 即整条不可信（收窄了旧 ok 分支）。
    expect(
      ProjectInviteResultSchema.safeParse({
        ok: true,
        code: 'abcdefgh12345678',
        expiresAt: '2026-09-06T00:00:00.000Z',
        kind: 'open',
        maxUses: null,
      }).success,
    ).toBe(false);
  });

  it('列表结果不含 code；每条只有列表投影字段', () => {
    const invitation = {
      id: INVITATION_ID,
      role: 'editor',
      expiresAt: '2026-09-06T00:00:00.000Z',
      maxUses: 10,
      usesCount: 2,
      createdBySubject: 'user-alice',
      createdByDisplayName: '张三',
      createdAt: '2026-09-05T00:00:00.000Z',
    } as const;
    expect(
      ProjectOpenInvitationListResultSchema.safeParse({ ok: true, invitations: [invitation] })
        .success,
    ).toBe(true);
    // ⛔ code 塞不进列表投影（strictObject 拒未知键）——库里也没有。
    expect(
      ProjectOpenInvitationListResultSchema.safeParse({
        ok: true,
        invitations: [{ ...invitation, code: 'abcdefgh12345678' }],
      }).success,
    ).toBe(false);
    expect(
      ProjectOpenInvitationListRequestSchema.safeParse({ projectId: PROJECT_ID }).success,
    ).toBe(true);
  });

  it('撤销请求只带 invitationId；结果回 projectId + invitationId', () => {
    expect(
      ProjectInvitationRevokeRequestSchema.safeParse({ invitationId: INVITATION_ID }).success,
    ).toBe(true);
    expect(ProjectInvitationRevokeRequestSchema.safeParse({ projectId: PROJECT_ID }).success).toBe(
      false,
    );
    expect(
      ProjectInvitationRevokeResultSchema.safeParse({
        ok: true,
        projectId: PROJECT_ID,
        invitationId: INVITATION_ID,
      }).success,
    ).toBe(true);
  });
});

describe('加入深链解析（链接 / 纯码 / 坏输入）', () => {
  const CODE = 'abcdefgh12345678';

  it('接受整条深链，抽出 code', () => {
    expect(parseProjectJoinLink(`${PROJECT_JOIN_LINK_SCHEME}?code=${CODE}`)).toBe(CODE);
    expect(parseProjectJoinLink(`  ${PROJECT_JOIN_LINK_SCHEME}?code=${CODE}  `)).toBe(CODE);
    expect(parseProjectJoinLink(`${PROJECT_JOIN_LINK_SCHEME}?foo=bar&code=${CODE}`)).toBe(CODE);
  });

  it('接受纯码', () => {
    expect(parseProjectJoinLink(CODE)).toBe(CODE);
    expect(parseProjectJoinLink('AZaz09_-AZaz09_-')).toBe('AZaz09_-AZaz09_-');
    expect(parseProjectJoinLink(`  ${CODE}  `)).toBe(CODE);
  });

  it('坏输入返回 null', () => {
    expect(parseProjectJoinLink('')).toBeNull();
    expect(parseProjectJoinLink('short')).toBeNull(); // 少于 8 位
    expect(parseProjectJoinLink(`${PROJECT_JOIN_LINK_SCHEME}?code=has space!!`)).toBeNull();
    expect(parseProjectJoinLink(`${PROJECT_JOIN_LINK_SCHEME}?state=abc`)).toBeNull(); // 无 code
    expect(parseProjectJoinLink('not a url and has spaces')).toBeNull();
  });

  it('buildProjectJoinLink 往返一致；坏码 null', () => {
    const link = buildProjectJoinLink(CODE);
    expect(link).toBe(`${PROJECT_JOIN_LINK_SCHEME}?code=${CODE}`);
    expect(link !== null && parseProjectJoinLink(link)).toBe(CODE);
    expect(buildProjectJoinLink('bad code')).toBeNull();
  });

  it('join-link 事件载荷只带合规 code', () => {
    expect(ProjectJoinLinkEventSchema.safeParse({ code: CODE }).success).toBe(true);
    expect(ProjectJoinLinkEventSchema.safeParse({ code: 'bad code' }).success).toBe(false);
    // ⛔ 不夹带项目 id / 账号一类字段。
    expect(
      ProjectJoinLinkEventSchema.safeParse({ code: CODE, projectId: PROJECT_ID }).success,
    ).toBe(false);
  });
});

describe('开放邀请服务端业务码文案（中性词、无内核词根）', () => {
  it('三枚码各有用户可读文案，其余返回 null', () => {
    expect(projectOpenInvitationErrorText('open_invitation_role_not_allowed')).toBe(
      '开放邀请只能签发「成员」。',
    );
    expect(projectOpenInvitationErrorText('invitation_revoked')).toBe('该邀请已关闭。');
    expect(projectOpenInvitationErrorText('invitation_exhausted')).toBe('该邀请已达人数上限。');
    expect(projectOpenInvitationErrorText('some_other_code')).toBeNull();
  });
});

describe('拆解草案整批确认被拒：业务码文案（FLOW-11）', () => {
  it('四个会被拒的原因各有一句，说清要人做什么，互不相同', () => {
    const texts = {
      // 「所属需求」：批次父项可能是一条任务，被判的是它往上最近的那条需求，⛔ 不写「这条」。
      requirement_not_claimed: '请先认领所属需求，再确认任务草案。',
      draft_source_deleted: '拆解来源已删除，这批草案不能再确认。',
      draft_source_not_found: '拆解来源已不存在，这批草案不能再确认。',
      // 批次级终态闸的码是 draft_batch_closed；draft_already_resolved 只出在逐条剔除端点。
      draft_batch_closed: '这批草案已经处理过，请刷新后查看。',
    } as const;
    for (const [code, text] of Object.entries(texts)) {
      expect(projectTodoDraftResolveServerCodeText(code)).toBe(text);
    }
    expect(new Set(Object.values(texts)).size).toBe(4);
  });

  it('逐条剔除被拒：已不存在 / 已处理过 × 这条 / 这批四种各有一句，认不出的码与缺席回 null（FLOW-12）', () => {
    const texts = {
      draft_not_found: '这条草案已不存在，请刷新后查看。',
      draft_batch_not_found: '这批草案已不存在，请刷新后查看。',
      draft_batch_closed: '这批草案已经处理过，请刷新后查看。',
      draft_already_resolved: '这条草案已经处理过，请刷新后查看。',
    } as const;
    for (const [code, text] of Object.entries(texts)) {
      expect(projectTodoDraftDropServerCodeText(code)).toBe(text);
    }
    expect(new Set(Object.values(texts)).size).toBe(4);
    expect(projectTodoDraftDropServerCodeText('requirement_not_claimed')).toBeNull();
    expect(projectTodoDraftDropServerCodeText(undefined)).toBeNull();
  });

  it('认不出的码与缺席一律 null（调用方回落通用文案）', () => {
    expect(projectTodoDraftResolveServerCodeText('some_other_code')).toBeNull();
    expect(projectTodoDraftResolveServerCodeText(undefined)).toBeNull();
    expect(projectTodoDraftResolveServerCodeText(null)).toBeNull();
  });

  it('失败信封沿用既有可选 serverCode：带码与不带码两形都过契约（不新增字段）', () => {
    const failure = {
      ok: false,
      code: 'conflict',
      message: '内容已被他人更新，请刷新后重试。',
      referenceCode: PROJECT_COLLAB_REFERENCE_CODES.conflict,
    } as const;
    expect(ProjectTodoDraftResolveResultSchema.safeParse(failure).success).toBe(true);
    expect(
      ProjectTodoDraftResolveResultSchema.safeParse({
        ...failure,
        serverCode: 'requirement_not_claimed',
      }).success,
    ).toBe(true);
  });
});

describe('需求 / 任务写路径服务端业务码文案（2539 / 2540 / 2542）', () => {
  it('各业务码有用户可读文案，通用码与缺席返回 null', () => {
    expect(projectTodoWriteServerCodeText('assignee_unchanged')).toBe(
      '新处理人与当前处理人相同，无需转交。',
    );
    expect(projectTodoWriteServerCodeText('assignee_not_editor')).toBe(
      '观察者只读，不能承接需求或任务。',
    );
    // 认领输了的一方（认领端点与改单认领同一个码、同一句）。
    expect(projectTodoWriteServerCodeText('requirement_already_claimed')).toBe(
      '该需求已被他人认领，请刷新后重新选择。',
    );
    // 只剩兼容未升级服务端：新服务端改单自设无主需求已按认领落库，不再发这个码。
    expect(projectTodoWriteServerCodeText('claim_required')).toBe(
      '这条需求还没有人认领，请使用「认领」。',
    );
    expect(projectTodoWriteServerCodeText('requirement_assistant_forbidden')).toBe(
      '需求不能直接派给项目助理，请先拆成任务再派。',
    );
    expect(projectTodoWriteServerCodeText('assistant_submit_forbidden')).toBe(
      '派给项目助理的工作单只能由派单人或项目管理者提交验收。',
    );
    // 通用码不进表：`forbidden` 在建单与改单上说的不是一件事，一句话说不对两件事。
    expect(projectTodoWriteServerCodeText('forbidden')).toBeNull();
    expect(projectTodoWriteServerCodeText(undefined)).toBeNull();
    expect(projectTodoWriteServerCodeText(null)).toBeNull();
  });

  it('新测试模式挡旧链路的两枚 409（TST-02）：说清该去哪里做，而不是「已被他人更新」', () => {
    expect(projectTodoWriteServerCodeText('requirement_test_mode_required')).toBe(
      '该项目的需求已改为整体提测，请在需求详情里提交需求测试。',
    );
    expect(projectTodoWriteServerCodeText('test_round_in_progress')).toBe(
      '该需求正在整体测试中，不能走原验收流程或直接取消。',
    );
  });
});

describe('需求归类（模块/分类）与迭代只读投影', () => {
  const MODULE_ID = '3f6c1a9e-0000-4000-8000-000000000011';
  const CATEGORY_ID = '3f6c1a9e-0000-4000-8000-000000000012';
  const ITERATION_ID = '3f6c1a9e-0000-4000-8000-000000000013';

  it('三态各自可表达：缺席 / 未分类 / 已绑定', () => {
    // ⭐【判据 1 的客户端载体】absent 与 uncategorized 必须分得开，否则
    //    「旧服务端没回」会被当成「服务端说它没归类」。
    const legacy = TodoSchema.parse(validTodo());
    expect(projectDictionaryBindingState(legacy.moduleId)).toBe('absent');
    expect(projectDictionaryBindingState(legacy.categoryId)).toBe('absent');
    expect(projectDictionaryBindingState(legacy.iterationId)).toBe('absent');

    const uncategorized = TodoSchema.parse({
      ...validTodo(),
      moduleId: null,
      module: null,
      categoryId: null,
      category: null,
      iterationId: null,
      iteration: null,
    });
    expect(projectDictionaryBindingState(uncategorized.moduleId)).toBe('uncategorized');
    expect(projectDictionaryBindingState(uncategorized.iterationId)).toBe('uncategorized');

    const bound = TodoSchema.parse({
      ...validTodo(),
      moduleId: MODULE_ID,
      module: { id: MODULE_ID, name: '成员与权限', archivedAt: null },
      categoryId: CATEGORY_ID,
      category: { id: CATEGORY_ID, name: '缺陷', archivedAt: null },
    });
    expect(projectDictionaryBindingState(bound.moduleId)).toBe('bound');
    expect(bound.module?.name).toBe('成员与权限');
  });

  it('引用摘要解析已归档条目照样成功（归档保留历史引用）', () => {
    const parsed = TodoSchema.parse({
      ...validTodo(),
      moduleId: MODULE_ID,
      module: { id: MODULE_ID, name: '旧的登录模块', archivedAt: '2026-09-01T00:00:00.000Z' },
    });
    expect(parsed.module?.archivedAt).toBe('2026-09-01T00:00:00.000Z');
  });

  it('迭代只读摘要按规划域口径带 dueAt 而没有 startAt', () => {
    // ⚠️ 旧接口契约（api-contracts.md §2）写的是 {id,name,start_at,due_at,archived_at}，
    //    V2 之后 start_at 属业务目标 —— 照旧稿写会得到一个服务端永不回的字段。
    const parsed = TodoSchema.parse({
      ...validTodo(),
      iterationId: ITERATION_ID,
      iteration: {
        id: ITERATION_ID,
        name: '第一轮',
        dueAt: '2026-09-30T00:00:00.000Z',
        archivedAt: null,
      },
    });
    expect(parsed.iteration?.dueAt).toBe('2026-09-30T00:00:00.000Z');
    expect(
      TodoSchema.safeParse({
        ...validTodo(),
        iteration: {
          id: ITERATION_ID,
          name: '第一轮',
          startAt: '2026-09-01T00:00:00.000Z',
          dueAt: '2026-09-30T00:00:00.000Z',
          archivedAt: null,
        },
      }).success,
    ).toBe(false);
  });

  it('写入面连「在需求上设迭代」都表达不出来', () => {
    // ⭐【判据 1「不设临时第二写口」的客户端结构性载体】两个写契约都是 strictObject，
    //    多带一个 iterationId 直接解析失败 —— 渲染层写不出那个请求。
    expect(
      ProjectTodoCreateRequestSchema.safeParse({
        projectId: PROJECT_ID,
        itemKind: 'requirement',
        title: '带排期的需求',
        iterationId: ITERATION_ID,
      }).success,
    ).toBe(false);
    expect(
      ProjectTodoUpdateRequestSchema.safeParse({
        todoId: ENTITY_ID,
        expectedVersion: 1,
        iterationId: ITERATION_ID,
      }).success,
    ).toBe(false);
    // 反面对照：同一份请求去掉迭代键就通得过（证明上面两条红的是迭代而不是别的）。
    expect(
      ProjectTodoCreateRequestSchema.safeParse({
        projectId: PROJECT_ID,
        itemKind: 'requirement',
        title: '带排期的需求',
      }).success,
    ).toBe(true);
  });

  it('建单只有 optional 没有 nullable；改单两者都有', () => {
    // 建单：不给 ＝ 未分类，所以不必再有第二种写法。
    expect(
      ProjectTodoCreateRequestSchema.safeParse({
        projectId: PROJECT_ID,
        itemKind: 'requirement',
        title: '需求',
        moduleId: null,
      }).success,
    ).toBe(false);
    // 改单：null ＝ 清空，且**单独清空归类**就算一次合法变更（refine 判 `!== undefined`）。
    const cleared = ProjectTodoUpdateRequestSchema.parse({
      todoId: ENTITY_ID,
      expectedVersion: 4,
      moduleId: null,
    });
    expect(cleared.moduleId).toBeNull();
    expect(
      ProjectTodoUpdateRequestSchema.parse({
        todoId: ENTITY_ID,
        expectedVersion: 4,
        categoryId: null,
      }).categoryId,
    ).toBeNull();
    // 一个字段都不带仍然拒（refine 没被上面两条放宽）。
    expect(
      ProjectTodoUpdateRequestSchema.safeParse({ todoId: ENTITY_ID, expectedVersion: 4 }).success,
    ).toBe(false);
  });

  it('归类的 id 必须是 uuid 形状，摘要不许夹带额外字段', () => {
    expect(TodoSchema.safeParse(validTodo({ moduleId: 'not-a-uuid' as never })).success).toBe(
      false,
    );
    expect(
      TodoSchema.safeParse({
        ...validTodo(),
        module: { id: MODULE_ID, name: '模块', archivedAt: null, version: 1 },
      }).success,
    ).toBe(false);
  });
});

describe('归类投影的两个载体必须等价（本文件不能运行时 import 字典模块）', () => {
  // ⚠️ `project-collab.ts` 无法运行时 import `project-collab-dictionaries.ts`：
  //    collab → dictionaries → planning → collab 三条边成环，成环必炸（理由与三条边
  //    逐条写在 project-collab.ts 文件头）。所以那边就地声明了一遍，**这一组用例就是
  //    两处一致的机器载体**。⛔ 删掉它们等于把重复变成一次无人看管的漂移。
  const MODULE_ID = '4a7d2b0f-0000-4000-8000-000000000021';
  // TodoSchema 上这几个键是 `.optional()`（引用摘要还多一层 `.nullable()`）包起来的。
  // ⚠️ 剥几层要**分开写**：`moduleId` 只剥 optional（`nullable` 那一层正是被对照的语义，
  //    剥掉就变成「拿一个不接受 null 的 schema 去对照一个接受 null 的」，必然假红）。
  const unwrapOptional = (schema: unknown): z.ZodTypeAny =>
    (schema as z.ZodOptional<z.ZodTypeAny>).unwrap();
  const unwrapToObject = (schema: unknown): z.ZodObject<z.ZodRawShape> =>
    (unwrapOptional(schema) as z.ZodNullable<z.ZodTypeAny>).unwrap() as z.ZodObject<z.ZodRawShape>;

  it('字典引用摘要：键集与 ProjectDictionaryEntryRefSchema 逐字相同', () => {
    expect(Object.keys(unwrapToObject(TodoSchema.shape.module).shape)).toEqual(
      Object.keys(ProjectDictionaryEntryRefSchema.shape),
    );
  });

  it('迭代引用摘要：键集与 ProjectIterationRefSchema 逐字相同', () => {
    expect(Object.keys(unwrapToObject(TodoSchema.shape.iteration).shape)).toEqual(
      Object.keys(ProjectIterationRefSchema.shape),
    );
  });

  it('两侧对同一批取值给出同一批判定（含名称上界的边界值）', () => {
    const cases: readonly unknown[] = [
      { id: MODULE_ID, name: '成员与权限', archivedAt: null },
      { id: MODULE_ID, name: '已归档', archivedAt: '2026-09-01T00:00:00.000Z' },
      // 名称上界：200 收、201 拒 —— 这条就是那个被抄过来的数字的载体。
      { id: MODULE_ID, name: 'x'.repeat(200), archivedAt: null },
      { id: MODULE_ID, name: 'x'.repeat(201), archivedAt: null },
      { id: MODULE_ID, name: '', archivedAt: null },
      { id: 'not-a-uuid', name: '模块', archivedAt: null },
      { id: MODULE_ID, name: '模块' },
      { id: MODULE_ID, name: '模块', archivedAt: null, version: 1 },
    ];
    const here = unwrapToObject(TodoSchema.shape.module);
    for (const candidate of cases) {
      expect(here.safeParse(candidate).success, JSON.stringify(candidate)).toBe(
        ProjectDictionaryEntryRefSchema.safeParse(candidate).success,
      );
    }
  });

  it('绑定取值：两侧对 uuid / null / 空串 / 非 uuid 判定一致', () => {
    const here = unwrapOptional(TodoSchema.shape.moduleId);
    for (const candidate of [MODULE_ID, null, '', 'not-a-uuid', 42]) {
      expect(here.safeParse(candidate).success, String(candidate)).toBe(
        ProjectDictionaryBindingSchema.safeParse(candidate).success,
      );
    }
  });
});

describe('需求状态时间事实与状态时间线（CORE-03 / 服务端迁移 0023）', () => {
  const ACTOR = 'user-alice';

  function validStatusEvent(
    overrides: Partial<ProjectTodoStatusEvent> = {},
  ): ProjectTodoStatusEvent {
    return {
      id: ENTITY_ID,
      todoId: ENTITY_ID,
      fromStatus: 'inReview',
      toStatus: 'done',
      actorSubject: ACTOR,
      reason: '',
      submissionId: null,
      occurredAt: '2026-09-12T08:00:00.000Z',
      ...overrides,
    };
  }

  it('两个时间是三态：缺席 / null / 时刻，三者都合法且互不折叠', () => {
    // 旧服务端根本不回这两个键 ⇒ 解析出来仍然缺席（⛔ 不被兜成 null）。
    const legacy = TodoSchema.parse(validTodo());
    expect('statusChangedAt' in legacy).toBe(false);
    expect('actualCompletedAt' in legacy).toBe(false);

    // 回了、是空 ⇒ null 原样留着（「未知 / 当前没有通过」）。
    const empty = TodoSchema.parse({
      ...validTodo(),
      statusChangedAt: null,
      actualCompletedAt: null,
    });
    expect(empty.statusChangedAt).toBeNull();
    expect(empty.actualCompletedAt).toBeNull();

    // 有值 ⇒ 原样留着。
    const stamped = TodoSchema.parse({
      ...validTodo(),
      statusChangedAt: '2026-09-12T08:00:00.000Z',
      actualCompletedAt: '2026-09-12T09:00:00.000Z',
    });
    expect(stamped.actualCompletedAt).toBe('2026-09-12T09:00:00.000Z');
  });

  it('写入面连表达都表达不出这两个键（strictObject 整条拒）', () => {
    // ⭐ 判据落在**写入**契约上：渲染层写不出那个请求，与服务端那道 422 各挡一侧。
    for (const field of ['statusChangedAt', 'actualCompletedAt'] as const) {
      expect(
        ProjectTodoCreateFieldsSchema.safeParse({
          title: '需求',
          itemKind: 'requirement',
          [field]: '2026-09-12T08:00:00.000Z',
        }).success,
        field,
      ).toBe(false);
    }
  });

  it('时间线条目：键集封闭，多一个字段整条拒', () => {
    expect(ProjectTodoStatusEventSchema.parse(validStatusEvent())).toEqual(validStatusEvent());
    expect(
      ProjectTodoStatusEventSchema.safeParse({ ...validStatusEvent(), title: '需求标题' }).success,
    ).toBe(false);
  });

  it('fromStatus 不可空：这张表只记转换，表达不出「从无到有」', () => {
    expect(
      ProjectTodoStatusEventSchema.safeParse({ ...validStatusEvent(), fromStatus: null }).success,
    ).toBe(false);
    // 两列状态都只认 Todo 的状态闭集。
    for (const field of ['fromStatus', 'toStatus'] as const) {
      expect(
        ProjectTodoStatusEventSchema.safeParse({ ...validStatusEvent(), [field]: 'accepted' })
          .success,
        field,
      ).toBe(false);
    }
  });

  it('时间线页：游标与 hasMore 同生同灭', () => {
    const page = {
      statusEvents: [validStatusEvent()],
      hasMore: false,
      nextCursor: null,
    };
    expect(ProjectTodoStatusEventPageSchema.parse(page)).toEqual(page);
    expect(ProjectTodoStatusEventPageSchema.safeParse({ ...page, hasMore: true }).success).toBe(
      false,
    );
    expect(ProjectTodoStatusEventPageSchema.safeParse({ ...page, nextCursor: 'abc' }).success).toBe(
      false,
    );
  });

  it('⛔ 时间线条数不设客户端上界（服务端计数一条坏全批坏）', () => {
    // 变异锚点：给 statusEvents 加一个 .max(N)，本条在 N+1 条时转红。
    const many = Array.from({ length: 400 }, (_unused, index) =>
      validStatusEvent({
        occurredAt: `2026-09-12T08:00:${String(index % 60).padStart(2, '0')}.000Z`,
      }),
    );
    expect(
      ProjectTodoStatusEventPageSchema.safeParse({
        statusEvents: many,
        hasMore: false,
        nextCursor: null,
      }).success,
    ).toBe(true);
  });
});

describe('项目约定 · AI 录入规则（CTX-01）', () => {
  it('说明与 AI 规则是两道独立的 20k 上限常量（改一个不牵动另一个）', () => {
    // 20k 上限的位置在此钉死：说明沿用既有常量，AI 规则新增独立同值常量。
    expect(PROJECT_MAX_INSTRUCTIONS_LENGTH).toBe(20_000);
    expect(PROJECT_MAX_AI_ENTRY_RULES_LENGTH).toBe(20_000);
  });

  it('conventions 投影：接受空规则/v0（未发布），拒绝超 20k', () => {
    expect(
      ProjectConventionsSchema.safeParse({ aiEntryRules: '', ruleVersion: 0, publishedAt: null })
        .success,
    ).toBe(true);
    expect(
      ProjectConventionsSchema.safeParse({
        aiEntryRules: '闲聊不自动录入。',
        ruleVersion: 3,
        publishedAt: '2026-09-01T00:00:00Z',
      }).success,
    ).toBe(true);
    // 超上限一格即拒。
    expect(
      ProjectConventionsSchema.safeParse({
        aiEntryRules: 'x'.repeat(PROJECT_MAX_AI_ENTRY_RULES_LENGTH + 1),
        ruleVersion: 1,
        publishedAt: null,
      }).success,
    ).toBe(false);
  });

  it('发布请求必带 expectedVersion（乐观锁）；NUL 注入即拒（同 instructions 口径）', () => {
    expect(
      ProjectConventionsUpdateRequestSchema.safeParse({
        projectId: PROJECT_ID,
        aiEntryRules: '先展示草稿再确认。',
        expectedVersion: 2,
      }).success,
    ).toBe(true);
    // 缺 expectedVersion → 拒（没有乐观锁就没有 409 语义）。
    expect(
      ProjectConventionsUpdateRequestSchema.safeParse({
        projectId: PROJECT_ID,
        aiEntryRules: '先展示草稿再确认。',
      }).success,
    ).toBe(false);
    // 超 20k → 拒（发布请求与投影同一道 aiEntryRules 闸）。
    expect(
      ProjectConventionsUpdateRequestSchema.safeParse({
        projectId: PROJECT_ID,
        aiEntryRules: 'x'.repeat(PROJECT_MAX_AI_ENTRY_RULES_LENGTH + 1),
        expectedVersion: 0,
      }).success,
    ).toBe(false);
  });
});
