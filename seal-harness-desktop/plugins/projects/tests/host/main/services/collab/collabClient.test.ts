import { mkdtemp, open, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { PROJECT_FILE_MAX_BYTES } from '../../../../../stratex/shared/protocol/project-collab.js';
import { createCollabClient, type CollabClient } from '../../../../../stratex/main/services/collab/collabClient.js';
import { mapTodo } from '../../../../../stratex/main/services/collab/collabWireMapping.js';

const TOKEN = 'test-access-token';
const PROJECT_ID = '11111111-1111-4111-8111-111111111111';
const ENTITY_ID = '22222222-2222-4222-8222-222222222222';

type FetchCall = { readonly url: URL; readonly init: RequestInit };

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function fakeFetch(...responses: Array<Response | 'network-error'>): {
  readonly fetchImpl: typeof fetch;
  readonly calls: FetchCall[];
} {
  const calls: FetchCall[] = [];
  const queue = [...responses];
  const fetchImpl = (async (input: unknown, init?: RequestInit) => {
    calls.push({ url: input as URL, init: init ?? {} });
    const next = queue.shift();
    if (next === undefined) throw new Error('unexpected extra fetch');
    if (next === 'network-error') throw new TypeError('fetch failed');
    return next;
  }) as typeof fetch;
  return { fetchImpl, calls };
}

// 测试假地址独立成行：guard-no-runtime-fetch 按「同一行 fetch 词 + http://」判定，
// URL 与 fetchImpl 同行会被误判为运行时拉取形态。
const CLIENT_BASE_URL = 'http://collab.test:1/';

function client(fetchImpl: typeof fetch): CollabClient {
  return createCollabClient({ baseUrl: CLIENT_BASE_URL, fetchImpl });
}

const wireSummary = {
  id: PROJECT_ID,
  name: '赛道服务联合调试',
  summary: '两周内跑通双账号闭环。',
  my_role: 'owner',
  member_count: 3,
  member_preview: [
    { subject: 'user-alice', display_name: '张三' },
    { subject: 'user-bob', display_name: '李四' },
  ],
  unread_count: 1,
  last_activity_at: '2026-08-24T08:00:00.000Z',
  created_at: '2026-08-01T08:00:00.000Z',
};

const wireDetail = {
  id: PROJECT_ID,
  name: '赛道服务联合调试',
  instructions_text: '联调说明',
  my_role: 'owner',
  created_at: '2026-08-01T08:00:00.000Z',
  members: [
    {
      subject: 'user-alice',
      display_name: '张三',
      role: 'editor',
      state: 'active',
      joined_at: '2026-08-02T08:00:00.000Z',
    },
  ],
};

const wireFeedEntry = {
  id: ENTITY_ID,
  kind: 'member_post',
  author_subject: 'user-alice',
  author_display_name: '张三',
  body_md: '本周进展',
  refs: [],
  comments: [],
  created_at: '2026-08-24T09:00:00.000Z',
};

const wireTodo = {
  id: ENTITY_ID,
  item_kind: 'requirement',
  title: '整理联调纪要',
  status: 'inProgress',
  assignee_subject: 'user-bob',
  assignee_display_name: '李四',
  priority: 'high',
  labels: ['联调'],
  due_at: null,
  description: '',
  version: 3,
  created_at: '2026-08-24T08:00:00.000Z',
  updated_at: '2026-08-24T11:00:00.000Z',
};

const wireFile = {
  id: ENTITY_ID,
  kind: 'temp',
  filename: '纪要.docx',
  mime: 'application/octet-stream',
  bytes: 4,
  sha256: '0123456789abcdef'.repeat(4),
  uploader_subject: 'user-alice',
  uploader_display_name: '张三',
  created_at: '2026-08-24T08:00:00.000Z',
  expires_at: '2026-09-24T08:00:00.000Z',
};

describe('CollabClient 请求形态', () => {
  it('开始日期创建映射、回读及更新清空，兼容旧响应', async () => {
    const { fetchImpl, calls } = fakeFetch(
      jsonResponse(201, { todo: { ...wireTodo, start_at: '2026-09-10' } }),
      jsonResponse(200, { todo: wireTodo }),
    );
    const subject = client(fetchImpl);
    const created = await subject.createTodo(TOKEN, {
      projectId: PROJECT_ID,
      itemKind: 'requirement',
      title: '计划',
      startAt: '2026-09-10',
    });
    expect(JSON.parse(String(calls[0]?.init.body))).toMatchObject({ start_at: '2026-09-10' });
    expect(created.ok && created.value.startAt).toBe('2026-09-10');
    const updated = await subject.updateTodo(TOKEN, {
      todoId: ENTITY_ID,
      expectedVersion: 3,
      startAt: null,
    });
    expect(JSON.parse(String(calls[1]?.init.body))).toMatchObject({ start_at: null });
    expect(updated.ok && updated.value.startAt).toBeNull();
  });

  it('listProjects：GET /api/v1/projects + Bearer 头；snake_case → camelCase 投影', async () => {
    const { fetchImpl, calls } = fakeFetch(jsonResponse(200, { projects: [wireSummary] }));
    const outcome = await client(fetchImpl).listProjects(TOKEN);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url.toString()).toBe('http://collab.test:1/api/v1/projects');
    expect(calls[0]!.init.method).toBe('GET');
    expect((calls[0]!.init.headers as Record<string, string>).authorization).toBe(
      `Bearer ${TOKEN}`,
    );
    expect(outcome).toEqual({
      ok: true,
      value: [
        {
          id: PROJECT_ID,
          name: '赛道服务联合调试',
          summary: '两周内跑通双账号闭环。',
          myRole: 'owner',
          archivedAt: null,
          memberCount: 3,
          memberPreview: [
            { subject: 'user-alice', displayName: '张三' },
            { subject: 'user-bob', displayName: '李四' },
          ],
          unreadCount: 1,
          lastActivityAt: '2026-08-24T08:00:00.000Z',
          createdAt: '2026-08-01T08:00:00.000Z',
        },
      ],
    });
  });

  it('createProject：POST JSON 体；detail（含成员）逐字段映射', async () => {
    const { fetchImpl, calls } = fakeFetch(jsonResponse(201, { project: wireDetail }));
    const outcome = await client(fetchImpl).createProject(TOKEN, { name: '新项目' });
    expect(calls[0]!.init.method).toBe('POST');
    expect(JSON.parse(calls[0]!.init.body as string)).toEqual({ name: '新项目' });
    expect(outcome.ok).toBe(true);
    if (outcome.ok) {
      expect(outcome.value.instructionsText).toBe('联调说明');
      expect(outcome.value.members).toEqual([
        {
          subject: 'user-alice',
          displayName: '张三',
          role: 'editor',
          state: 'active',
          joinedAt: '2026-08-02T08:00:00.000Z',
        },
      ]);
    }
  });

  it('listProjects：includeArchived 才带 include_archived（缺省不上线）', async () => {
    const { fetchImpl, calls } = fakeFetch(
      jsonResponse(200, { projects: [] }),
      jsonResponse(200, { projects: [] }),
    );
    const subject = client(fetchImpl);
    await subject.listProjects(TOKEN);
    expect(calls[0]!.url.toString()).toBe('http://collab.test:1/api/v1/projects');
    await subject.listProjects(TOKEN, { includeArchived: true });
    expect(calls[1]!.url.searchParams.get('include_archived')).toBe('true');
  });

  it('成员管理四条：方法与路径逐条对位，subject 进路径段前被编码', async () => {
    const { fetchImpl, calls } = fakeFetch(
      jsonResponse(200, { project: wireDetail }),
      jsonResponse(200, { project: wireDetail }),
      jsonResponse(200, { project: wireDetail }),
      jsonResponse(200, { project: wireDetail }),
      jsonResponse(200, { project: wireDetail }),
    );
    const subject = client(fetchImpl);
    // subject 不是 uuid，可能带会改变路由含义的字符——必须编码后再进路径段。
    const trickySubject = 'user/../admin';

    const roleOutcome = await subject.updateMemberRole(TOKEN, {
      projectId: PROJECT_ID,
      subject: trickySubject,
      role: 'viewer',
    });
    expect(calls[0]!.init.method).toBe('PATCH');
    expect(calls[0]!.url.pathname).toBe(
      `/api/v1/projects/${PROJECT_ID}/members/${encodeURIComponent(trickySubject)}`,
    );
    expect(JSON.parse(calls[0]!.init.body as string)).toEqual({ role: 'viewer' });
    expect(roleOutcome.ok).toBe(true);

    await subject.removeMember(TOKEN, { projectId: PROJECT_ID, subject: 'user-bob' });
    expect(calls[1]!.init.method).toBe('DELETE');
    expect(calls[1]!.url.pathname).toBe(`/api/v1/projects/${PROJECT_ID}/members/user-bob`);
    expect(calls[1]!.init.body).toBeUndefined();

    await subject.transferOwnership(TOKEN, { projectId: PROJECT_ID, subject: 'user-bob' });
    expect(calls[2]!.init.method).toBe('POST');
    expect(calls[2]!.url.pathname).toBe(`/api/v1/projects/${PROJECT_ID}/transfer`);
    expect(JSON.parse(calls[2]!.init.body as string)).toEqual({ subject: 'user-bob' });

    // 归档与恢复是两条服务端路径（动作在路径上，不是请求体里的开关）。
    await subject.setProjectArchived(TOKEN, { projectId: PROJECT_ID, archived: true });
    expect(calls[3]!.url.pathname).toBe(`/api/v1/projects/${PROJECT_ID}/archive`);
    await subject.setProjectArchived(TOKEN, { projectId: PROJECT_ID, archived: false });
    expect(calls[4]!.url.pathname).toBe(`/api/v1/projects/${PROJECT_ID}/unarchive`);
  });

  it('成员管理：403（越权/最后一位拥有者/已归档）→ forbidden；只透传业务码，detail 文案不透传', async () => {
    const { fetchImpl } = fakeFetch(
      jsonResponse(403, { error: 'last_owner_required', detail: '项目至少要保留一位拥有者' }),
    );
    const outcome = await client(fetchImpl).removeMember(TOKEN, {
      projectId: PROJECT_ID,
      subject: 'user-bob',
    });
    // 业务码 error 原样透传为 serverCode；自由文案 detail 绝不透传（toEqual 精确形状已挡）。
    expect(outcome).toEqual({ ok: false, code: 'forbidden', serverCode: 'last_owner_required' });
  });

  it('成员管理：归档态随详情投影（archivedAt 缺席即 null）', async () => {
    const { fetchImpl } = fakeFetch(
      jsonResponse(200, {
        project: { ...wireDetail, archived_at: '2026-08-25T00:00:00.000Z' },
      }),
      jsonResponse(200, { project: wireDetail }),
    );
    const subject = client(fetchImpl);
    const archived = await subject.setProjectArchived(TOKEN, {
      projectId: PROJECT_ID,
      archived: true,
    });
    expect(archived.ok && archived.value.archivedAt).toBe('2026-08-25T00:00:00.000Z');
    const restored = await subject.setProjectArchived(TOKEN, {
      projectId: PROJECT_ID,
      archived: false,
    });
    expect(restored.ok && restored.value.archivedAt).toBeNull();
  });

  it('sendChatMessage：请求体是 snake_case（body_md/refs），refs 缺席不上线', async () => {
    const wireMessage = {
      id: ENTITY_ID,
      seq: 42,
      author_subject: 'user-alice',
      author_display_name: '张三',
      body_md: '带引用的消息',
      refs: ['todo:x'],
      revoked: false,
      created_at: '2026-08-24T10:00:00.000Z',
    };
    const { fetchImpl, calls } = fakeFetch(
      jsonResponse(201, { message: wireMessage }),
      jsonResponse(201, { message: wireMessage }),
    );
    const subject = client(fetchImpl);
    await subject.sendChatMessage(TOKEN, {
      projectId: PROJECT_ID,
      bodyMd: '带引用的消息',
      refs: ['todo:x'],
    });
    expect(JSON.parse(calls[0]!.init.body as string)).toEqual({
      body_md: '带引用的消息',
      refs: ['todo:x'],
    });
    await subject.sendChatMessage(TOKEN, { projectId: PROJECT_ID, bodyMd: '无引用' });
    expect(JSON.parse(calls[1]!.init.body as string)).toEqual({ body_md: '无引用' });
  });

  it('listFeed / listChatHistory：分页参数进查询串（缺席不上线）', async () => {
    const { fetchImpl, calls } = fakeFetch(
      jsonResponse(200, { entries: [] }),
      jsonResponse(200, { messages: [] }),
    );
    const subject = client(fetchImpl);
    await subject.listFeed(TOKEN, { projectId: PROJECT_ID, beforeId: ENTITY_ID, limit: 50 });
    expect(calls[0]!.url.searchParams.get('before_id')).toBe(ENTITY_ID);
    expect(calls[0]!.url.searchParams.get('limit')).toBe('50');
    await subject.listChatHistory(TOKEN, {
      projectId: PROJECT_ID,
      afterSeq: 7,
      authorSubject: 'member:alpha',
      createdAfter: '2026-08-01T00:00:00Z',
      createdBefore: '2026-09-01T00:00:00Z',
    });
    expect(calls[1]!.url.searchParams.get('after_seq')).toBe('7');
    expect(calls[1]!.url.searchParams.get('author_subject')).toBe('member:alpha');
    expect(calls[1]!.url.searchParams.get('created_after')).toBe('2026-08-01T00:00:00Z');
    expect(calls[1]!.url.searchParams.get('created_before')).toBe('2026-09-01T00:00:00Z');
    expect(calls[1]!.url.searchParams.has('before_seq')).toBe(false);
    expect(calls[1]!.url.searchParams.has('limit')).toBe(false);
  });

  it('updateTodo：null＝清空要上线，undefined＝缺席不上线', async () => {
    const { fetchImpl, calls } = fakeFetch(jsonResponse(200, { todo: wireTodo }));
    await client(fetchImpl).updateTodo(TOKEN, {
      todoId: ENTITY_ID,
      expectedVersion: 3,
      assigneeSubject: null,
      status: 'done',
    });
    expect(calls[0]!.init.method).toBe('PATCH');
    expect(JSON.parse(calls[0]!.init.body as string)).toEqual({
      expected_version: 3,
      assignee_subject: null,
      status: 'done',
    });
  });

  it('归类两列：null＝清空要上线、缺席＝不改不上线（建单与改单两条路各验）', async () => {
    // ⭐⭐【判据 1「null 清空 vs 省略不改」在 HTTP 上的唯一分辨点】
    //    服务端按「请求体里有没有这个键」判，所以「不改」的载体就是**不发这个键**。
    //    ⛔ 这里写成 `input.moduleId ? ... : {}` 会把 null 一起吃掉 ——「清空归类」
    //    在线上永远发不出去，而界面看起来点了、也没报错。
    const MODULE_ID = '33333333-3333-4333-8333-333333333333';
    const { fetchImpl, calls } = fakeFetch(
      jsonResponse(201, { todo: wireTodo }),
      jsonResponse(200, { todo: wireTodo }),
      jsonResponse(200, { todo: wireTodo }),
    );
    const subject = client(fetchImpl);

    await subject.createTodo(TOKEN, {
      projectId: PROJECT_ID,
      itemKind: 'requirement',
      title: '带归类的需求',
      moduleId: MODULE_ID,
    });
    expect(JSON.parse(calls[0]!.init.body as string)).toEqual({
      title: '带归类的需求',
      item_kind: 'requirement',
      module_id: MODULE_ID,
    });

    // 清空：null 必须上线。
    await subject.updateTodo(TOKEN, {
      todoId: ENTITY_ID,
      expectedVersion: 3,
      moduleId: null,
      categoryId: null,
    });
    expect(JSON.parse(calls[1]!.init.body as string)).toEqual({
      expected_version: 3,
      module_id: null,
      category_id: null,
    });

    // 不改：缺席必须**不**上线（否则改标题会连带清掉归类）。
    await subject.updateTodo(TOKEN, {
      todoId: ENTITY_ID,
      expectedVersion: 4,
      title: '只改标题',
    });
    const omitted = JSON.parse(calls[2]!.init.body as string) as Record<string, unknown>;
    expect(omitted).toEqual({ expected_version: 4, title: '只改标题' });
    expect('module_id' in omitted).toBe(false);
    expect('category_id' in omitted).toBe(false);
  });

  it('updateTodo：改派档位缺席就不上线，给了才发（老服务端不认这个键）', async () => {
    const { fetchImpl, calls } = fakeFetch(jsonResponse(200, { todo: wireTodo }));
    await client(fetchImpl).updateTodo(TOKEN, {
      todoId: ENTITY_ID,
      expectedVersion: 3,
      assigneeKind: 'assistant',
    });
    expect(JSON.parse(calls[0]!.init.body as string)).toEqual({
      expected_version: 3,
      assignee_kind: 'assistant',
    });
  });

  it('postFeedEntry：refs 与讨论消息同形态（缺席不上线）', async () => {
    const { fetchImpl, calls } = fakeFetch(
      jsonResponse(201, { entry: { ...wireFeedEntry, refs: ['member:user-bob'] } }),
      jsonResponse(201, { entry: wireFeedEntry }),
    );
    const subject = client(fetchImpl);
    await subject.postFeedEntry(TOKEN, {
      projectId: PROJECT_ID,
      bodyMd: '@李四 看下',
      refs: ['member:user-bob'],
    });
    expect(JSON.parse(calls[0]!.init.body as string)).toEqual({
      body_md: '@李四 看下',
      refs: ['member:user-bob'],
    });
    await subject.postFeedEntry(TOKEN, { projectId: PROJECT_ID, bodyMd: '无引用' });
    expect(JSON.parse(calls[1]!.init.body as string)).toEqual({ body_md: '无引用' });
  });

  it('待办关联面（G-10）：创建带上、更新区分 null 与缺席', async () => {
    const { fetchImpl, calls } = fakeFetch(
      jsonResponse(201, { todo: wireTodo }),
      jsonResponse(200, { todo: wireTodo }),
      jsonResponse(200, { todo: wireTodo }),
    );
    const subject = client(fetchImpl);
    await subject.createTodo(TOKEN, {
      projectId: PROJECT_ID,
      itemKind: 'requirement',
      title: '核对底图',
      sessionRef: 's-1',
      refs: ['asset:f-1'],
    });
    expect(JSON.parse(calls[0]!.init.body as string)).toEqual({
      item_kind: 'requirement',
      title: '核对底图',
      session_ref: 's-1',
      refs: ['asset:f-1'],
    });
    await subject.updateTodo(TOKEN, {
      todoId: ENTITY_ID,
      expectedVersion: 3,
      sessionRef: null,
      refs: [],
    });
    expect(JSON.parse(calls[1]!.init.body as string)).toEqual({
      expected_version: 3,
      session_ref: null,
      refs: [],
    });
    // 缺席＝不改：两个键都不许出现在请求体里。
    await subject.updateTodo(TOKEN, { todoId: ENTITY_ID, expectedVersion: 3, status: 'done' });
    expect(JSON.parse(calls[2]!.init.body as string)).toEqual({
      expected_version: 3,
      status: 'done',
    });
  });

  it('mapTodo：服务端缺关联列（0006 之前的历史行）投影为未关联', () => {
    const outcome = mapTodo(wireTodo);
    expect(outcome?.sessionRef).toBeNull();
    expect(outcome?.refs).toEqual([]);
  });

  it('mapTodo：两级 / 来源 / 可见性三列在线上时逐字投影', () => {
    const outcome = mapTodo({
      ...wireTodo,
      parent_id: '33333333-3333-4333-8333-333333333333',
      source: 'assistant',
      visibility: 'personal',
    });
    expect(outcome?.parentId).toBe('33333333-3333-4333-8333-333333333333');
    expect(outcome?.source).toBe('assistant');
    expect(outcome?.visibility).toBe('personal');
  });

  it('mapTodo：服务端缺三列（0007 之前的历史行）投影为顶层 / 人建 / 协同', () => {
    const outcome = mapTodo(wireTodo);
    expect(outcome?.parentId).toBeNull();
    expect(outcome?.source).toBe('manual');
    expect(outcome?.visibility).toBe('shared');
  });

  it('mapTodo：缺少显式 item_kind 时拒绝整条，不从 parent_id 推断', () => {
    const withoutKind: Record<string, unknown> = { ...wireTodo };
    delete withoutKind['item_kind'];
    expect(
      mapTodo({ ...withoutKind, parent_id: '33333333-3333-4333-8333-333333333333' }),
    ).toBeNull();
  });

  it('listTodos：parentId 三态映射到线上的两个查询参数', async () => {
    const { fetchImpl, calls } = fakeFetch(
      jsonResponse(200, { todos: [] }),
      jsonResponse(200, { todos: [] }),
      jsonResponse(200, { todos: [] }),
    );
    const subject = client(fetchImpl);
    // 缺席＝一个参数都不发（老客户端的请求逐字不变）。
    await subject.listTodos(TOKEN, { projectId: PROJECT_ID });
    expect(calls[0]!.url.search).toBe('');
    // null＝只要顶层需求。
    await subject.listTodos(TOKEN, { projectId: PROJECT_ID, parentId: null });
    expect(calls[1]!.url.searchParams.get('top_level')).toBe('true');
    expect(calls[1]!.url.searchParams.has('parent_id')).toBe(false);
    // uuid＝只要那条需求下的任务，另可叠加来源/可见性。
    await subject.listTodos(TOKEN, {
      projectId: PROJECT_ID,
      parentId: ENTITY_ID,
      source: 'assistant',
      visibility: 'personal',
    });
    expect(calls[2]!.url.searchParams.get('parent_id')).toBe(ENTITY_ID);
    expect(calls[2]!.url.searchParams.get('source')).toBe('assistant');
    expect(calls[2]!.url.searchParams.get('visibility')).toBe('personal');
    expect(calls[2]!.url.searchParams.has('top_level')).toBe(false);
  });

  // CORE-08（ADR-0042）：计划区间交叠的两个时刻原样映射成 plan_from / plan_to；缺席即不上线。
  it('readRequirementPage：时间段两端映射到 plan_from / plan_to，缺席不上线', async () => {
    const page = { items: [wireTodo], total: 1, page: 1, page_size: 20, query_revision: 'rev-1' };
    const { fetchImpl, calls } = fakeFetch(jsonResponse(200, page), jsonResponse(200, page));
    const subject = client(fetchImpl);

    const outcome = await subject.readRequirementPage(TOKEN, {
      projectId: PROJECT_ID,
      page: 1,
      pageSize: 20,
      itemKind: 'task',
      planFrom: '2026-08-31T00:00:00.000Z',
      planTo: '2026-10-12T00:00:00.000Z',
    });
    await subject.readRequirementPage(TOKEN, { projectId: PROJECT_ID, page: 1, pageSize: 20 });

    expect(outcome.ok).toBe(true);
    expect(calls[0]!.url.pathname).toBe(`/api/v1/projects/${PROJECT_ID}/requirement-page`);
    expect(calls[0]!.url.searchParams.get('plan_from')).toBe('2026-08-31T00:00:00.000Z');
    expect(calls[0]!.url.searchParams.get('plan_to')).toBe('2026-10-12T00:00:00.000Z');
    expect(calls[0]!.url.searchParams.get('item_kind')).toBe('task');
    expect(calls[1]!.url.searchParams.has('plan_from')).toBe(false);
    expect(calls[1]!.url.searchParams.has('plan_to')).toBe(false);
  });

  it('readRequirementPage：本人根视图和排序在服务端分页之前应用', async () => {
    const page = {
      items: [wireTodo],
      total: 1,
      page: 1,
      page_size: 10,
      query_revision: 'rev-1',
      query_contract: 'table-v1',
    };
    const { fetchImpl, calls } = fakeFetch(jsonResponse(200, page));
    const result = await client(fetchImpl).readRequirementPage(TOKEN, {
      projectId: PROJECT_ID,
      page: 1,
      pageSize: 10,
      view: 'claimed',
      sortBy: 'title',
      sortDirection: 'desc',
    });
    expect(result.ok).toBe(true);
    expect(calls[0]!.url.searchParams.get('view')).toBe('claimed');
    expect(calls[0]!.url.searchParams.get('sort_by')).toBe('title');
    expect(calls[0]!.url.searchParams.get('sort_direction')).toBe('desc');
  });

  it.each([undefined, null, '', 'table-v2', 1])(
    'readRequirementPage：未确认契约 %s 时拒绝新版视图及排序',
    async (queryContract) => {
      for (const query of [
        { view: 'claimed' },
        { sortBy: 'title' },
        { sortBy: 'title', sortDirection: 'desc' },
      ] as const) {
        const { fetchImpl } = fakeFetch(
          jsonResponse(200, {
            items: [wireTodo],
            total: 1,
            page: 1,
            page_size: 10,
            query_revision: 'rev-1',
            query_contract: queryContract,
          }),
        );
        const result = await client(fetchImpl).readRequirementPage(TOKEN, {
          projectId: PROJECT_ID,
          page: 1,
          pageSize: 10,
          ...query,
        });
        expect(result.ok).toBe(false);
      }
    },
  );

  it('createTodo / updateTodo：两级与来源缺席即不上线', async () => {
    const { fetchImpl, calls } = fakeFetch(
      jsonResponse(201, { todo: wireTodo }),
      jsonResponse(201, { todo: wireTodo }),
      jsonResponse(200, { todo: wireTodo }),
    );
    const subject = client(fetchImpl);
    await subject.createTodo(TOKEN, {
      projectId: PROJECT_ID,
      itemKind: 'requirement',
      title: '需求',
    });
    expect(JSON.parse(calls[0]!.init.body as string)).toEqual({
      item_kind: 'requirement',
      title: '需求',
    });
    await subject.createTodo(TOKEN, {
      projectId: PROJECT_ID,
      itemKind: 'task',
      title: '任务',
      parentId: ENTITY_ID,
      source: 'assistant',
      visibility: 'personal',
    });
    expect(JSON.parse(calls[1]!.init.body as string)).toEqual({
      item_kind: 'task',
      title: '任务',
      parent_id: ENTITY_ID,
      source: 'assistant',
      visibility: 'personal',
    });
    // 改挂靠同样区分 null（摘回顶层）与缺席（不改）。
    await subject.updateTodo(TOKEN, { todoId: ENTITY_ID, expectedVersion: 3, parentId: null });
    expect(JSON.parse(calls[2]!.init.body as string)).toEqual({
      expected_version: 3,
      parent_id: null,
    });
  });
});

describe('CollabClient 状态分档', () => {
  it.each([
    [413, 'tooLarge'],
    [429, 'rateLimited'],
    [401, 'credentialRejected'],
    [403, 'forbidden'],
    [404, 'rejected'],
    [422, 'rejected'],
    [500, 'transient'],
    [503, 'transient'],
  ] as const)('%s → %s', async (status, code) => {
    const { fetchImpl } = fakeFetch(jsonResponse(status, { error: 'x' }));
    const outcome = await client(fetchImpl).createProject(TOKEN, { name: '新项目' });
    // 分档 code 一字不改；业务码只在 4xx 透传（5xx 体里的 error 不带上来）。
    expect(outcome).toEqual(
      status < 500 ? { ok: false, code, serverCode: 'x' } : { ok: false, code },
    );
  });

  it('网络不可达 → transient', async () => {
    const { fetchImpl } = fakeFetch('network-error');
    const outcome = await client(fetchImpl).listProjects(TOKEN);
    expect(outcome).toEqual({ ok: false, code: 'transient' });
  });

  it('updateTodo 409 带回 current_version → conflict + currentVersion', async () => {
    const { fetchImpl } = fakeFetch(
      jsonResponse(409, { error: 'version_conflict', current_version: 4 }),
    );
    const outcome = await client(fetchImpl).updateTodo(TOKEN, {
      todoId: ENTITY_ID,
      expectedVersion: 3,
      status: 'done',
    });
    expect(outcome).toEqual({ ok: false, code: 'conflict', currentVersion: 4 });
  });

  it('非待办端点的 409 → conflict（无 currentVersion；业务码随 4xx 透传）', async () => {
    const { fetchImpl } = fakeFetch(jsonResponse(409, { error: 'x' }));
    const outcome = await client(fetchImpl).createProject(TOKEN, { name: '新项目' });
    // 无 readConflictVersion，走通用分档：conflict 判定不变，附带服务端业务码（无 currentVersion）。
    expect(outcome).toEqual({ ok: false, code: 'conflict', serverCode: 'x' });
  });

  it('2xx 但响应体不可解析/不合协议 schema → transient（不透传服务端原文）', async () => {
    const badJson = new Response('not-json', { status: 200 });
    const badShape = jsonResponse(200, { projects: [{ id: 'not-a-uuid' }] });
    const extraTolerated = jsonResponse(200, {
      projects: [{ ...wireSummary, internal_flag: true }],
    });
    const { fetchImpl } = fakeFetch(badJson, badShape, extraTolerated);
    const subject = client(fetchImpl);
    expect(await subject.listProjects(TOKEN)).toEqual({ ok: false, code: 'transient' });
    expect(await subject.listProjects(TOKEN)).toEqual({ ok: false, code: 'transient' });
    // 服务端多回未知字段：逐字段挑选映射容忍之（不因新增字段而整线报废）。
    const tolerated = await subject.listProjects(TOKEN);
    expect(tolerated.ok).toBe(true);
  });

  it('deleteFile：2xx 无体即成功；setReadCursor 同形', async () => {
    const { fetchImpl, calls } = fakeFetch(
      new Response(null, { status: 204 }),
      new Response(null, { status: 204 }),
    );
    const subject = client(fetchImpl);
    expect(await subject.deleteFile(TOKEN, { fileId: ENTITY_ID })).toEqual({
      ok: true,
      value: true,
    });
    expect(calls[0]!.init.method).toBe('DELETE');
    expect(await subject.setReadCursor(TOKEN, { projectId: PROJECT_ID, lastReadSeq: 42 })).toEqual({
      ok: true,
      value: true,
    });
    expect(calls[1]!.init.method).toBe('PUT');
    expect(JSON.parse(calls[1]!.init.body as string)).toEqual({ last_read_seq: 42 });
  });

  it('deleteTodo：DELETE /todos/{id} 无请求体，逐字段映射 {deleted_ids,count}', async () => {
    const subtree = [ENTITY_ID, '33333333-3333-4333-8333-333333333333'];
    const { fetchImpl, calls } = fakeFetch(jsonResponse(200, { deleted_ids: subtree, count: 2 }));
    const outcome = await client(fetchImpl).deleteTodo(TOKEN, { todoId: ENTITY_ID });
    expect(calls[0]!.init.method).toBe('DELETE');
    expect(calls[0]!.url.pathname).toBe(`/api/v1/todos/${ENTITY_ID}`);
    expect(calls[0]!.init.body).toBeUndefined();
    // 负向锚点：投影必须逐字段搬 deleted_ids→deletedIds / count（改坏映射或写死值即红）。
    expect(outcome).toEqual({ ok: true, value: { deletedIds: subtree, count: 2 } });
  });

  it('deleteTodosBatch：POST .../todos/delete-batch，请求体只带 ids（根列表）', async () => {
    const roots = [ENTITY_ID, '33333333-3333-4333-8333-333333333333'];
    const union = [...roots, '44444444-4444-4444-8444-444444444444'];
    const { fetchImpl, calls } = fakeFetch(jsonResponse(200, { deleted_ids: union, count: 3 }));
    const outcome = await client(fetchImpl).deleteTodosBatch(TOKEN, {
      projectId: PROJECT_ID,
      ids: roots,
    });
    expect(calls[0]!.init.method).toBe('POST');
    expect(calls[0]!.url.pathname).toBe(`/api/v1/projects/${PROJECT_ID}/todos/delete-batch`);
    // 请求体只有 ids（⛔ 不夹带 projectId/账号——projectId 只进路径段）。
    expect(JSON.parse(calls[0]!.init.body as string)).toEqual({ ids: roots });
    expect(outcome).toEqual({ ok: true, value: { deletedIds: union, count: 3 } });
  });

  it('删除 2xx 但响应体不合形状（deleted_ids 非 uuid）→ transient，不透传原文', async () => {
    const { fetchImpl } = fakeFetch(jsonResponse(200, { deleted_ids: ['not-a-uuid'], count: 1 }));
    const outcome = await client(fetchImpl).deleteTodo(TOKEN, { todoId: ENTITY_ID });
    expect(outcome).toEqual({ ok: false, code: 'transient' });
  });

  it('删除失败按状态分档并透传 serverCode（404 todo_not_found / 409 draft_source_deleted / 403）', async () => {
    const { fetchImpl } = fakeFetch(
      jsonResponse(404, { error: 'todo_not_found', detail: '不该透传的文案' }),
      jsonResponse(409, { error: 'draft_source_deleted' }),
      jsonResponse(403, { error: 'project_archived' }),
    );
    const subject = client(fetchImpl);
    // 404→rejected（已删/不存在/跨项目），detail 文案绝不透传（toEqual 精确形状已挡）。
    expect(await subject.deleteTodo(TOKEN, { todoId: ENTITY_ID })).toEqual({
      ok: false,
      code: 'rejected',
      serverCode: 'todo_not_found',
    });
    // 批量端点无 readConflictVersion：409 走通用分档 → conflict + serverCode（无 currentVersion）。
    expect(
      await subject.deleteTodosBatch(TOKEN, { projectId: PROJECT_ID, ids: [ENTITY_ID] }),
    ).toEqual({ ok: false, code: 'conflict', serverCode: 'draft_source_deleted' });
    expect(await subject.deleteTodo(TOKEN, { todoId: ENTITY_ID })).toEqual({
      ok: false,
      code: 'forbidden',
      serverCode: 'project_archived',
    });
  });
});

describe('CollabClient serverCode 透传（失败信封附带服务端业务码）', () => {
  it('redeem 410 invitation_revoked → rejected + serverCode', async () => {
    const { fetchImpl } = fakeFetch(jsonResponse(410, { error: 'invitation_revoked' }));
    const outcome = await client(fetchImpl).redeemInvitation(TOKEN, { code: 'INVITECODE1234' });
    expect(outcome).toEqual({ ok: false, code: 'rejected', serverCode: 'invitation_revoked' });
  });

  it('redeem 409 invitation_exhausted → conflict + serverCode（通用分档，非冲突体读取）', async () => {
    const { fetchImpl } = fakeFetch(jsonResponse(409, { error: 'invitation_exhausted' }));
    const outcome = await client(fetchImpl).redeemInvitation(TOKEN, { code: 'INVITECODE1234' });
    expect(outcome).toEqual({ ok: false, code: 'conflict', serverCode: 'invitation_exhausted' });
  });

  it('createInvitation 400 open_invitation_role_not_allowed → rejected + serverCode', async () => {
    const { fetchImpl } = fakeFetch(
      jsonResponse(400, { error: 'open_invitation_role_not_allowed' }),
    );
    const outcome = await client(fetchImpl).createInvitation(TOKEN, {
      projectId: PROJECT_ID,
      role: 'editor',
      kind: 'open',
      ttlHours: 24,
    });
    expect(outcome).toEqual({
      ok: false,
      code: 'rejected',
      serverCode: 'open_invitation_role_not_allowed',
    });
  });

  it('非 JSON 体 / 缺 error 键 → 无 serverCode（分档不变）', async () => {
    const { fetchImpl } = fakeFetch(
      new Response('<html>gateway</html>', { status: 400 }),
      jsonResponse(400, { detail: '这是给人看的说明文案，不是业务码' }),
    );
    const subject = client(fetchImpl);
    expect(await subject.redeemInvitation(TOKEN, { code: 'INVITECODE1234' })).toEqual({
      ok: false,
      code: 'rejected',
    });
    expect(await subject.redeemInvitation(TOKEN, { code: 'INVITECODE1234' })).toEqual({
      ok: false,
      code: 'rejected',
    });
  });

  it('error 不合正则（大写 / 超长）→ 无 serverCode', async () => {
    const { fetchImpl } = fakeFetch(
      jsonResponse(400, { error: 'Invitation_Revoked' }),
      jsonResponse(400, { error: 'a'.repeat(65) }),
    );
    const subject = client(fetchImpl);
    expect(await subject.redeemInvitation(TOKEN, { code: 'INVITECODE1234' })).toEqual({
      ok: false,
      code: 'rejected',
    });
    expect(await subject.redeemInvitation(TOKEN, { code: 'INVITECODE1234' })).toEqual({
      ok: false,
      code: 'rejected',
    });
  });

  it('serverCode 只在 4xx 出现：5xx 体里的 error 不透传', async () => {
    const { fetchImpl } = fakeFetch(jsonResponse(503, { error: 'temporarily_unavailable' }));
    const outcome = await client(fetchImpl).redeemInvitation(TOKEN, { code: 'INVITECODE1234' });
    expect(outcome).toEqual({ ok: false, code: 'transient' });
  });
});

describe('CollabClient 邀请：开放邀请签发 / 列出 / 撤销', () => {
  const INVITATION_ID = '44444444-4444-4444-8444-444444444444';

  it('createInvitation single：只发 role；响应 id→invitationId、kind、maxUses', async () => {
    const { fetchImpl, calls } = fakeFetch(
      jsonResponse(201, {
        code: 'abcdefgh12345678',
        expires_at: '2026-09-06T00:00:00.000Z',
        id: INVITATION_ID,
        kind: 'single',
        max_uses: null,
      }),
    );
    const outcome = await client(fetchImpl).createInvitation(TOKEN, {
      projectId: PROJECT_ID,
      role: 'editor',
    });
    expect(calls[0]!.init.method).toBe('POST');
    expect(calls[0]!.url.pathname).toBe(`/api/v1/projects/${PROJECT_ID}/invitations`);
    // single：不透传 kind / ttl_hours / max_uses（缺席即不发）。
    expect(JSON.parse(calls[0]!.init.body as string)).toEqual({ role: 'editor' });
    expect(outcome).toEqual({
      ok: true,
      value: {
        code: 'abcdefgh12345678',
        expiresAt: '2026-09-06T00:00:00.000Z',
        invitationId: INVITATION_ID,
        kind: 'single',
        maxUses: null,
      },
    });
  });

  it('createInvitation open：透传 kind / ttl_hours / max_uses（snake_case 到线上）', async () => {
    const { fetchImpl, calls } = fakeFetch(
      jsonResponse(201, {
        code: 'abcdefgh12345678',
        expires_at: '2026-09-06T00:00:00.000Z',
        id: INVITATION_ID,
        kind: 'open',
        max_uses: 10,
      }),
    );
    const outcome = await client(fetchImpl).createInvitation(TOKEN, {
      projectId: PROJECT_ID,
      role: 'editor',
      kind: 'open',
      ttlHours: 24,
      maxUses: 10,
    });
    expect(JSON.parse(calls[0]!.init.body as string)).toEqual({
      role: 'editor',
      kind: 'open',
      ttl_hours: 24,
      max_uses: 10,
    });
    expect(outcome.ok && outcome.value.kind).toBe('open');
    expect(outcome.ok && outcome.value.maxUses).toBe(10);
  });

  it('createInvitation：响应缺新键（旧形状）→ transient（不透传半截结果）', async () => {
    const { fetchImpl } = fakeFetch(
      jsonResponse(201, { code: 'abcdefgh12345678', expires_at: '2026-09-06T00:00:00.000Z' }),
    );
    const outcome = await client(fetchImpl).createInvitation(TOKEN, {
      projectId: PROJECT_ID,
      role: 'editor',
    });
    expect(outcome).toEqual({ ok: false, code: 'transient' });
  });

  it('listOpenInvitations：GET 带 kind=open；逐条映射且不含 code', async () => {
    const { fetchImpl, calls } = fakeFetch(
      jsonResponse(200, {
        invitations: [
          {
            id: INVITATION_ID,
            role: 'editor',
            expires_at: '2026-09-06T00:00:00.000Z',
            max_uses: 10,
            uses_count: 2,
            created_by_subject: 'user-alice',
            created_by_display_name: '张三',
            created_at: '2026-09-05T00:00:00.000Z',
          },
        ],
      }),
    );
    const outcome = await client(fetchImpl).listOpenInvitations(TOKEN, { projectId: PROJECT_ID });
    expect(calls[0]!.init.method).toBe('GET');
    expect(calls[0]!.url.pathname).toBe(`/api/v1/projects/${PROJECT_ID}/invitations`);
    expect(calls[0]!.url.searchParams.get('kind')).toBe('open');
    expect(outcome.ok).toBe(true);
    if (outcome.ok) {
      expect(outcome.value).toEqual([
        {
          id: INVITATION_ID,
          role: 'editor',
          expiresAt: '2026-09-06T00:00:00.000Z',
          maxUses: 10,
          usesCount: 2,
          createdBySubject: 'user-alice',
          createdByDisplayName: '张三',
          createdAt: '2026-09-05T00:00:00.000Z',
        },
      ]);
      expect(outcome.value[0]).not.toHaveProperty('code');
    }
  });

  it('revokeInvitation：POST 到 /invitations/{id}/revoke；映射 project_id/id', async () => {
    const { fetchImpl, calls } = fakeFetch(
      jsonResponse(200, { project_id: PROJECT_ID, id: INVITATION_ID }),
    );
    const outcome = await client(fetchImpl).revokeInvitation(TOKEN, {
      invitationId: INVITATION_ID,
    });
    expect(calls[0]!.init.method).toBe('POST');
    expect(calls[0]!.url.pathname).toBe(`/api/v1/invitations/${INVITATION_ID}/revoke`);
    expect(outcome).toEqual({
      ok: true,
      value: { projectId: PROJECT_ID, invitationId: INVITATION_ID },
    });
  });

  it('revokeInvitation：410（已关闭）经既有分档 → rejected + serverCode', async () => {
    const { fetchImpl } = fakeFetch(jsonResponse(410, { error: 'invitation_revoked' }));
    const outcome = await client(fetchImpl).revokeInvitation(TOKEN, {
      invitationId: INVITATION_ID,
    });
    // 分档仍 rejected（410 属其余 4xx）；服务端业务码原样透传。
    expect(outcome).toEqual({ ok: false, code: 'rejected', serverCode: 'invitation_revoked' });
  });
});

describe('CollabClient 文件上传/下载（真实临时目录）', () => {
  let directory: string;

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'collab-client-'));
  });

  afterEach(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  it('上传从文件流发送裸字节，带 Content-Length/duplex 并报告进度', async () => {
    const filePath = join(directory, '联调纪要.docx');
    const fileBytes = Buffer.from('docx-bytes-0123');
    await writeFile(filePath, fileBytes);
    const calls: FetchCall[] = [];
    const fetchImpl = (async (input: unknown, init?: RequestInit) => {
      calls.push({ url: input as URL, init: init ?? {} });
      const body = init?.body as ReadableStream<Uint8Array>;
      const received = Buffer.from(await new Response(body).arrayBuffer());
      expect(received.equals(fileBytes)).toBe(true);
      return jsonResponse(201, { file: wireFile });
    }) as typeof fetch;
    const progress: number[] = [];
    const outcome = await client(fetchImpl).uploadFile(TOKEN, {
      projectId: PROJECT_ID,
      filePath,
      kind: 'temp',
      onProgress: (uploadedBytes) => progress.push(uploadedBytes),
    });
    expect(outcome.ok).toBe(true);
    const call = calls[0]!;
    expect(call.url.pathname).toBe(`/api/v1/projects/${PROJECT_ID}/files`);
    expect(call.url.searchParams.get('filename')).toBe('联调纪要.docx');
    expect(call.url.searchParams.get('kind')).toBe('temp');
    expect(call.init.body).toBeInstanceOf(ReadableStream);
    expect(typeof FormData === 'undefined' || !(call.init.body instanceof FormData)).toBe(true);
    const headers = call.init.headers as Record<string, string>;
    expect(headers['content-type']).toBe(
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    );
    expect(headers['content-length']).toBe(String(fileBytes.byteLength));
    expect(headers['content-type']).not.toContain('multipart');
    expect((call.init as RequestInit & { duplex?: string }).duplex).toBe('half');
    expect(progress.at(-1)).toBe(fileBytes.byteLength);
  });

  it('恰好 1 GiB 的稀疏文件通过 stat 边界且不分配巨型 Buffer', async () => {
    const filePath = join(directory, 'exact-limit.bin');
    const handle = await open(filePath, 'w');
    try {
      await handle.truncate(PROJECT_FILE_MAX_BYTES);
    } finally {
      await handle.close();
    }
    const controller = new AbortController();
    const fetchImpl = (async (_input: unknown, init?: RequestInit) => {
      expect((init?.headers as Record<string, string>)['content-length']).toBe(
        String(PROJECT_FILE_MAX_BYTES),
      );
      controller.abort();
      throw new DOMException('cancelled', 'AbortError');
    }) as typeof fetch;
    await client(fetchImpl).uploadFile(TOKEN, {
      projectId: PROJECT_ID,
      filePath,
      kind: 'temp',
      signal: controller.signal,
    });
  });

  it('超过 1 GiB 上限：stat 后即拒（tooLarge），不读全量、不发请求', async () => {
    const filePath = join(directory, 'huge.bin');
    const handle = await open(filePath, 'w');
    try {
      await handle.truncate(PROJECT_FILE_MAX_BYTES + 1);
    } finally {
      await handle.close();
    }
    const { fetchImpl, calls } = fakeFetch();
    const outcome = await client(fetchImpl).uploadFile(TOKEN, {
      projectId: PROJECT_ID,
      filePath,
      kind: 'temp',
    });
    expect(outcome).toEqual({ ok: false, code: 'tooLarge' });
    expect(calls).toHaveLength(0);
  });

  it('本地文件不存在 → invalidRequest，不发请求', async () => {
    const { fetchImpl, calls } = fakeFetch();
    const outcome = await client(fetchImpl).uploadFile(TOKEN, {
      projectId: PROJECT_ID,
      filePath: join(directory, 'missing.bin'),
      kind: 'asset',
    });
    expect(outcome).toEqual({ ok: false, code: 'invalidRequest' });
    expect(calls).toHaveLength(0);
  });

  it('下载：流写到目标目录、按 content-disposition 取名、同名回避加 (1)', async () => {
    // 头值只能是 ByteString：非 ASCII 文件名走 RFC 5987 的 filename*=UTF-8'' 百分号编码。
    const encoded = encodeURIComponent('报告.pdf');
    const makeResponse = (): Response =>
      new Response('downloaded-bytes', {
        status: 200,
        headers: { 'content-disposition': `attachment; filename*=UTF-8''${encoded}` },
      });
    const { fetchImpl, calls } = fakeFetch(makeResponse(), makeResponse());
    const subject = client(fetchImpl);
    const first = await subject.downloadFile(TOKEN, {
      fileId: ENTITY_ID,
      targetDirectory: directory,
    });
    expect(first.ok).toBe(true);
    if (first.ok) {
      expect(first.value.savedPath).toBe(join(directory, '报告.pdf'));
      expect((await readFile(first.value.savedPath)).toString()).toBe('downloaded-bytes');
    }
    expect(calls[0]!.url.pathname).toBe(`/api/v1/files/${ENTITY_ID}`);
    const second = await subject.downloadFile(TOKEN, {
      fileId: ENTITY_ID,
      targetDirectory: directory,
    });
    expect(second.ok).toBe(true);
    if (second.ok) expect(second.value.savedPath).toBe(join(directory, '报告 (1).pdf'));
  });

  it('下载：无/恶意 content-disposition 回退为文件 id；路径分隔符被剥掉', async () => {
    const { fetchImpl } = fakeFetch(
      new Response('x', { status: 200 }),
      new Response('y', {
        status: 200,
        headers: { 'content-disposition': 'attachment; filename="../../evil"' },
      }),
    );
    const subject = client(fetchImpl);
    const noHeader = await subject.downloadFile(TOKEN, {
      fileId: ENTITY_ID,
      targetDirectory: directory,
    });
    expect(noHeader.ok).toBe(true);
    if (noHeader.ok) expect(noHeader.value.savedPath).toBe(join(directory, ENTITY_ID));
    const traversal = await subject.downloadFile(TOKEN, {
      fileId: ENTITY_ID,
      targetDirectory: directory,
    });
    expect(traversal.ok).toBe(true);
    if (traversal.ok) {
      // `../../evil` 的分隔符被替换为 `_`：不再构成路径段，落盘钉死在目标目录内。
      expect(traversal.value.savedPath).toBe(join(directory, '.._.._evil'));
    }
  });

  it('下载：非 200 按状态分档（404 → rejected + serverCode）', async () => {
    const { fetchImpl } = fakeFetch(jsonResponse(404, { error: 'not_found' }));
    const outcome = await client(fetchImpl).downloadFile(TOKEN, {
      fileId: ENTITY_ID,
      targetDirectory: directory,
    });
    // 下载失败路径同样透传 4xx 业务码（分档 rejected 不变）。
    expect(outcome).toEqual({ ok: false, code: 'rejected', serverCode: 'not_found' });
  });

  it('下载：目标目录不可写 → writeFailed（不装成网络错误）', async () => {
    const { fetchImpl } = fakeFetch(new Response('x', { status: 200 }));
    // Windows 下把「目录」指到一个普通文件上，open/mkdir 必失败。
    const blocking = join(directory, 'not-a-directory');
    await writeFile(blocking, 'occupied');
    const outcome = await client(fetchImpl).downloadFile(TOKEN, {
      fileId: ENTITY_ID,
      targetDirectory: blocking,
    });
    expect(outcome).toEqual({ ok: false, code: 'writeFailed' });
  });

  it('下载体超时即使没有 Content-Length 也拒绝并删除半文件', async () => {
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('partial'));
      },
    });
    const fetchImpl = (async () => new Response(body, { status: 200 })) as typeof fetch;
    const subject = createCollabClient({
      baseUrl: CLIENT_BASE_URL,
      fetchImpl,
      downloadBodyTimeoutMs: 10,
    });

    const outcome = await subject.downloadFile(TOKEN, {
      fileId: ENTITY_ID,
      targetDirectory: directory,
    });

    expect(outcome).toEqual({ ok: false, code: 'transient' });
    expect(await readdir(directory)).toEqual([]);
  });
});

describe('CollabClient 邀请/兑换', () => {
  it('createInvitation：明文 code 只出现在返回值；expires_at → expiresAt、id → invitationId', async () => {
    const { fetchImpl, calls } = fakeFetch(
      jsonResponse(201, {
        code: 'INV-PLAIN',
        expires_at: '2026-08-25T08:00:00.000Z',
        id: '44444444-4444-4444-8444-444444444444',
        kind: 'single',
        max_uses: null,
      }),
    );
    const outcome = await client(fetchImpl).createInvitation(TOKEN, {
      projectId: PROJECT_ID,
      role: 'viewer',
    });
    expect(JSON.parse(calls[0]!.init.body as string)).toEqual({ role: 'viewer' });
    expect(outcome).toEqual({
      ok: true,
      value: {
        code: 'INV-PLAIN',
        expiresAt: '2026-08-25T08:00:00.000Z',
        invitationId: '44444444-4444-4444-8444-444444444444',
        kind: 'single',
        maxUses: null,
      },
    });
  });

  it('redeemInvitation：project_id/role 映射；未知 role 降级为观察者（不判整条不可信）', async () => {
    const { fetchImpl } = fakeFetch(
      jsonResponse(200, { project_id: PROJECT_ID, role: 'editor' }),
      jsonResponse(200, { project_id: PROJECT_ID, role: 'superuser' }),
    );
    const subject = client(fetchImpl);
    expect(await subject.redeemInvitation(TOKEN, { code: 'INV' })).toEqual({
      ok: true,
      value: { projectId: PROJECT_ID, role: 'editor' },
    });
    // 未知角色降级为观察者，**不判整条不可信**：兑换其实成功了（人已进组），
    // 回 transient 会让用户以为失败而重试，而第二次兑换会撞「邀请码已用」——
    // 一个走不出去的死结。少给权限是安全的，假装没进组不是。
    expect(await subject.redeemInvitation(TOKEN, { code: 'INV' })).toEqual({
      ok: true,
      value: { projectId: PROJECT_ID, role: 'viewer' },
    });
  });

  it('vi.fn 哨兵：fetch 从不被并发复用（单次尝试、不自行重试）', async () => {
    const spy = vi.fn(async () => jsonResponse(500, {}));
    const outcome = await client(spy as unknown as typeof fetch).listProjects(TOKEN);
    expect(outcome).toEqual({ ok: false, code: 'transient' });
    expect(spy).toHaveBeenCalledTimes(1);
  });
});

describe('CollabClient 工作单面', () => {
  const wireAcceptanceItem = {
    ordinal: 1,
    text: '纪要逐条列出待办与责任人',
    checked: false,
    checked_by_subject: null,
    checked_at: null,
    executor_note: '',
  };

  const wireCompletionRecord = {
    id: '33333333-3333-4333-8333-333333333333',
    entry_kind: 'completion',
    author_subject: 'user-bob',
    author_display_name: '李四',
    summary: '已按清单逐条核对',
    artifacts: [],
    created_at: '2026-08-29T08:00:00.000Z',
  };

  const wireDraftBatch = {
    id: '44444444-4444-4444-8444-444444444444',
    project_id: PROJECT_ID,
    source_todo_id: ENTITY_ID,
    target_item_kind: 'task',
    parent_id: ENTITY_ID,
    created_by_subject: 'user-bob',
    dispatcher_subject: 'user-alice',
    state: 'open',
    confirmed_at: null,
    discarded_at: null,
    discarded_by_subject: null,
    created_at: '2026-08-29T08:00:00.000Z',
    updated_at: '2026-08-29T08:00:00.000Z',
    drafts: [
      {
        id: '55555555-5555-4555-8555-555555555555',
        ordinal: 1,
        title: '核对入库字段',
        description: '',
        constraints_text: '',
        acceptance_items: ['逐项对齐'],
        priority: 'medium',
        state: 'pending',
        todo_id: null,
        dropped_at: null,
        dropped_by_subject: null,
      },
    ],
  };

  it('maps a work-order detail body (todo + items + records)', async () => {
    const { fetchImpl, calls } = fakeFetch(
      jsonResponse(200, {
        todo: {
          ...wireTodo,
          constraints_text: '别动线上库',
          acceptance_total: 1,
          acceptance_checked: 0,
        },
        acceptance_items: [wireAcceptanceItem],
        completion_records: [wireCompletionRecord],
      }),
    );
    const outcome = await client(fetchImpl).getTodoDetail(TOKEN, { todoId: ENTITY_ID });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.value.todo.constraintsText).toBe('别动线上库');
    expect(outcome.value.todo.acceptanceTotal).toBe(1);
    expect(outcome.value.acceptanceItems[0]?.text).toBe('纪要逐条列出待办与责任人');
    expect(outcome.value.completionRecords[0]?.entryKind).toBe('completion');
    expect(calls[0]?.url.pathname).toBe(`/api/v1/todos/${ENTITY_ID}`);
  });

  it('keeps a pre-0009 wire todo trustworthy (the three new keys may be absent)', async () => {
    const { fetchImpl } = fakeFetch(
      jsonResponse(200, { todos: [wireTodo], has_more: false, next_cursor: null }),
    );
    const outcome = await client(fetchImpl).listTodos(TOKEN, { projectId: PROJECT_ID });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.value.todos[0]?.constraintsText).toBe('');
    expect(outcome.value.todos[0]?.acceptanceTotal).toBe(0);
    expect(outcome.value).toMatchObject({ hasMore: false, nextCursor: null });
  });

  it('一条大子树不拖垮整页：子树规模越过旧上界时列表照常投影', async () => {
    // 500 是旧的客户端单方面上界（服务端从不限制建单条数）。这里取远超它的值：
    // 真实项目把一份需求书拆到三四层就能到这个量级。
    const hugeSubtree = {
      ...wireTodo,
      id: '33333333-3333-4333-8333-333333333333',
      child_total: 5_000,
      child_done: 1_200,
    };
    const { fetchImpl } = fakeFetch(
      jsonResponse(200, { todos: [wireTodo, hugeSubtree], has_more: false, next_cursor: null }),
    );

    const outcome = await client(fetchImpl).listTodos(TOKEN, { projectId: PROJECT_ID });

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    // ⛔ 断言的是整页长度，不只是那一条：投影一条坏全批坏（mapArray 见 null 即
    // 整页 null），所以越界真正丢掉的是整个看板，而不是越界的那行。
    expect(outcome.value.todos).toHaveLength(2);
    expect(outcome.value.todos[1]).toMatchObject({ childTotal: 5_000, childDone: 1_200 });
  });

  it.each([
    { has_more: true, next_cursor: null },
    { has_more: false, next_cursor: 'unexpected-cursor' },
  ])('rejects an inconsistent todo continuation state: %j', async (continuation) => {
    const { fetchImpl } = fakeFetch(jsonResponse(200, { todos: [wireTodo], ...continuation }));

    const outcome = await client(fetchImpl).listTodos(TOKEN, { projectId: PROJECT_ID });

    expect(outcome).toMatchObject({ ok: false });
  });

  it('sends the acceptance list only when the caller gave one', async () => {
    const { fetchImpl, calls } = fakeFetch(
      jsonResponse(201, { todo: wireTodo }),
      jsonResponse(201, { todo: wireTodo }),
    );
    const api = client(fetchImpl);
    await api.createTodo(TOKEN, {
      projectId: PROJECT_ID,
      itemKind: 'requirement',
      title: '普通待办',
    });
    await api.createTodo(TOKEN, {
      projectId: PROJECT_ID,
      itemKind: 'requirement',
      title: '工作单',
      constraintsText: '别动线上库',
      acceptanceItems: ['判据一'],
    });
    const plain = JSON.parse(String(calls[0]?.init.body));
    const workOrder = JSON.parse(String(calls[1]?.init.body));
    // 老请求逐字不变：不给就不发，服务端落缺省（普通待办）。
    expect(plain).not.toHaveProperty('acceptance_items');
    expect(plain).not.toHaveProperty('constraints_text');
    expect(workOrder.acceptance_items).toEqual(['判据一']);
    expect(workOrder.constraints_text).toBe('别动线上库');
  });

  it('submits a review with snake_case item notes', async () => {
    const { fetchImpl, calls } = fakeFetch(
      jsonResponse(200, {
        todo: { ...wireTodo, status: 'inReview' },
        completion_record: wireCompletionRecord,
      }),
    );
    const outcome = await client(fetchImpl).submitTodoReview(TOKEN, {
      todoId: ENTITY_ID,
      expectedVersion: 3,
      summary: '做完了',
      itemNotes: [{ ordinal: 1, note: '纪要第 3 节' }],
    });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.value.todo.status).toBe('inReview');
    expect(JSON.parse(String(calls[0]?.init.body))).toEqual({
      expected_version: 3,
      summary: '做完了',
      item_notes: [{ ordinal: 1, note: '纪要第 3 节' }],
    });
  });

  it('treats a null completion_record on accept as a legitimate payload', async () => {
    // 验收通过不写完成记录（写的是验收动作本身）——服务端回 null 是正常出参，
    // 不是不可信响应。只有「非 null 但映射不出来」才当坏响应（见下一条）。
    const { fetchImpl } = fakeFetch(
      jsonResponse(200, { todo: { ...wireTodo, status: 'done' }, completion_record: null }),
    );
    const outcome = await client(fetchImpl).reviewTodo(TOKEN, {
      todoId: ENTITY_ID,
      expectedVersion: 3,
      decision: 'accept',
      checkedOrdinals: [1],
    });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.value.completionRecord).toBeNull();
    expect(outcome.value.todo.status).toBe('done');
  });

  it('refuses a malformed completion record instead of reading it as absent', async () => {
    const { fetchImpl } = fakeFetch(
      jsonResponse(200, {
        todo: wireTodo,
        completion_record: { ...wireCompletionRecord, entry_kind: 'whatever' },
      }),
    );
    const outcome = await client(fetchImpl).reviewTodo(TOKEN, {
      todoId: ENTITY_ID,
      expectedVersion: 3,
      decision: 'reject',
      reason: '证据不足',
    });
    expect(outcome).toEqual({ ok: false, code: 'transient' });
  });

  it('carries the 409 current version back from the review endpoints', async () => {
    const { fetchImpl } = fakeFetch(
      jsonResponse(409, { error: 'version_conflict', current_version: 7 }),
    );
    const outcome = await client(fetchImpl).reviewTodo(TOKEN, {
      todoId: ENTITY_ID,
      expectedVersion: 3,
      decision: 'accept',
    });
    expect(outcome).toEqual({ ok: false, code: 'conflict', currentVersion: 7 });
  });

  it('maps draft batches and posts the resolve decision', async () => {
    const { fetchImpl, calls } = fakeFetch(
      jsonResponse(200, { batches: [wireDraftBatch] }),
      jsonResponse(200, {
        batch: {
          ...wireDraftBatch,
          state: 'discarded',
          discarded_at: '2026-08-29T09:00:00.000Z',
          discarded_by_subject: 'user-alice',
        },
        todos: [],
      }),
    );
    const api = client(fetchImpl);
    const listed = await api.listDraftBatches(TOKEN, { projectId: PROJECT_ID });
    expect(listed.ok).toBe(true);
    if (!listed.ok) return;
    expect(listed.value[0]?.dispatcherSubject).toBe('user-alice');
    expect(listed.value[0]?.drafts[0]?.acceptanceItems).toEqual(['逐项对齐']);

    const resolved = await api.resolveDraftBatch(TOKEN, {
      batchId: wireDraftBatch.id,
      decision: 'discard',
    });
    expect(resolved.ok).toBe(true);
    if (!resolved.ok) return;
    expect(resolved.value.batch.state).toBe('discarded');
    expect(resolved.value.batch.discardedBySubject).toBe('user-alice');
    expect(resolved.value.todos).toEqual([]);
    expect(calls[1]?.url.pathname).toBe(`/api/v1/todo-draft-batches/${wireDraftBatch.id}/resolve`);
    expect(JSON.parse(String(calls[1]?.init.body))).toEqual({ decision: 'discard' });
  });

  it('整批处理失败按状态分档并带回业务码（409 认领门 / 批次已处理，404 批次不可见）', async () => {
    const { fetchImpl } = fakeFetch(
      jsonResponse(409, { error: 'requirement_not_claimed', detail: '不该透传的文案' }),
      jsonResponse(409, { error: 'draft_batch_closed' }),
      jsonResponse(404, { error: 'draft_batch_not_found' }),
    );
    const api = client(fetchImpl);
    const input = { batchId: wireDraftBatch.id, decision: 'confirm' } as const;
    // ⭐ 409 不许塌缩成无码 conflict：无码就只剩「数据已被他人更新」那句通用文案，
    //    而认领门、批次已处理都不是刷新重试能好的。detail 文案绝不透传（toEqual 精确形状已挡）。
    expect(await api.resolveDraftBatch(TOKEN, input)).toEqual({
      ok: false,
      code: 'conflict',
      serverCode: 'requirement_not_claimed',
    });
    expect(await api.resolveDraftBatch(TOKEN, input)).toEqual({
      ok: false,
      code: 'conflict',
      serverCode: 'draft_batch_closed',
    });
    expect(await api.resolveDraftBatch(TOKEN, input)).toEqual({
      ok: false,
      code: 'rejected',
      serverCode: 'draft_batch_not_found',
    });
  });

  it('逐条剔除失败同样带回业务码（409 这条 / 这批已处理，404 这条已不存在）', async () => {
    const { fetchImpl, calls } = fakeFetch(
      jsonResponse(409, { error: 'draft_already_resolved' }),
      jsonResponse(409, { error: 'draft_batch_closed' }),
      jsonResponse(404, { error: 'draft_not_found' }),
    );
    const api = client(fetchImpl);
    const input = { draftId: '55555555-5555-4555-8555-555555555555' };
    expect(await api.dropDraft(TOKEN, input)).toEqual({
      ok: false,
      code: 'conflict',
      serverCode: 'draft_already_resolved',
    });
    expect(await api.dropDraft(TOKEN, input)).toEqual({
      ok: false,
      code: 'conflict',
      serverCode: 'draft_batch_closed',
    });
    expect(await api.dropDraft(TOKEN, input)).toEqual({
      ok: false,
      code: 'rejected',
      serverCode: 'draft_not_found',
    });
    expect(calls[0]?.url.pathname).toBe(`/api/v1/todo-drafts/${input.draftId}/drop`);
  });
});

/**
 * 落地收尾四项在网络面的落点。
 *
 * ⚠️ 「不可信响应」那条纪律在这里各验一次：服务端回了不该回的形状（超额名册、
 * 认不出的 409 体），客户端一律**整体拒绝**，绝不部分采信。
 */
describe('CollabClient 落地收尾四项', () => {
  it('rejects a whole project list when the server returns a full roster', async () => {
    // ⭐ 服务端哪天回了整份名册（LIMIT 被拿掉），这条列表整体不可信 ⇒ transient。
    // ⛔ 不截断后照单全收——那会把服务端的缺陷悄悄补上，闸也就没人守着了。
    const { fetchImpl } = fakeFetch(
      jsonResponse(200, {
        projects: [
          {
            ...wireSummary,
            member_preview: Array.from({ length: 4 }, (_, index) => ({
              subject: `user-${index}`,
              display_name: `成员${index}`,
            })),
          },
        ],
      }),
    );
    expect(await client(fetchImpl).listProjects(TOKEN)).toEqual({
      ok: false,
      code: 'transient',
    });
  });

  it('falls back to empty card facts when the server predates them', async () => {
    // 老服务端没有这两个键：卡片少两行，其余照常（⛔ 不整体拒绝——那会让老部署
    // 上的项目列表整个打不开）。
    const legacy: Record<string, unknown> = { ...wireSummary };
    delete legacy['member_preview'];
    delete legacy['summary'];
    const { fetchImpl } = fakeFetch(jsonResponse(200, { projects: [legacy] }));
    const outcome = await client(fetchImpl).listProjects(TOKEN);
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.value[0]?.summary).toBe('');
    expect(outcome.value[0]?.memberPreview).toEqual([]);
  });

  it('sends comment mentions as refs and reads them back', async () => {
    const { fetchImpl, calls } = fakeFetch(
      jsonResponse(201, {
        comment: {
          id: '44444444-4444-4444-8444-444444444444',
          author_subject: 'user-bob',
          author_display_name: '李四',
          body_md: '@张三 收到',
          refs: ['member:user-alice'],
          created_at: '2026-08-24T09:00:00.000Z',
        },
      }),
    );
    const outcome = await client(fetchImpl).postFeedComment(TOKEN, {
      entryId: ENTITY_ID,
      bodyMd: '@张三 收到',
      refs: ['member:user-alice'],
    });
    expect(calls[0]?.url.pathname).toBe(`/api/v1/feed/${ENTITY_ID}/comments`);
    expect(JSON.parse(String(calls[0]?.init.body))).toEqual({
      body_md: '@张三 收到',
      refs: ['member:user-alice'],
    });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.value.refs).toEqual(['member:user-alice']);
  });

  it('omits the refs key entirely when a comment mentions nobody', async () => {
    const { fetchImpl, calls } = fakeFetch(
      jsonResponse(201, {
        comment: {
          id: '44444444-4444-4444-8444-444444444445',
          author_subject: 'user-bob',
          author_display_name: '李四',
          body_md: '收到',
          created_at: '2026-08-24T09:00:00.000Z',
        },
      }),
    );
    const outcome = await client(fetchImpl).postFeedComment(TOKEN, {
      entryId: ENTITY_ID,
      bodyMd: '收到',
    });
    expect(JSON.parse(String(calls[0]?.init.body))).toEqual({ body_md: '收到' });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    // 老服务端不回这个键：按「无引用」投影，⛔ 不当不可信响应。
    expect(outcome.value.refs).toEqual([]);
  });

  it('reads the temp-file quota out of a 409 upload rejection', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'collab-quota-'));
    const filePath = join(directory, '随手件.png');
    await writeFile(filePath, Buffer.from('0123456789'));
    try {
      const { fetchImpl } = fakeFetch(
        jsonResponse(409, {
          error: 'temp_quota_exceeded',
          detail: '项目临时文件已达容量上限',
          quota_limit_bytes: 2_147_483_648,
          quota_used_bytes: 2_100_000_000,
        }),
      );
      expect(
        await client(fetchImpl).uploadFile(TOKEN, {
          projectId: PROJECT_ID,
          filePath,
          kind: 'temp',
        }),
      ).toEqual({
        ok: false,
        code: 'quotaExceeded',
        quota: { limitBytes: 2_147_483_648, usedBytes: 2_100_000_000 },
      });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('does not read a 409 it cannot recognise as a quota rejection', async () => {
    // ⛔ 不拿状态码当语义：认不出那个体就退回通用 conflict，绝不编一个「上限 0」出来。
    const directory = await mkdtemp(join(tmpdir(), 'collab-quota-'));
    const filePath = join(directory, '随手件.png');
    await writeFile(filePath, Buffer.from('0123456789'));
    try {
      const { fetchImpl } = fakeFetch(jsonResponse(409, { error: 'something_else' }));
      expect(
        await client(fetchImpl).uploadFile(TOKEN, {
          projectId: PROJECT_ID,
          filePath,
          kind: 'temp',
        }),
      ).toEqual({ ok: false, code: 'conflict' });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('projects the child progress counters and defaults them for older servers', async () => {
    expect(mapTodo({ ...wireTodo, child_total: 3, child_done: 1 })).toMatchObject({
      childTotal: 3,
      childDone: 1,
    });
    // 老服务端没有这两个键 ⇒ 0/0（＝需求行不显示进度），⛔ 不在客户端替它算。
    expect(mapTodo(wireTodo)).toMatchObject({ childTotal: 0, childDone: 0 });
  });
});

describe('CollabClient 能力协商与新旧测试模式（CORE-05）', () => {
  it('拉取能力清单并映射 service_version', async () => {
    const { fetchImpl, calls } = fakeFetch(
      jsonResponse(200, {
        capabilities: ['requirement.dictionaries', 'requirement.paging'],
        service_version: '0.1.0',
      }),
    );
    const outcome = await client(fetchImpl).fetchCapabilities(TOKEN);
    expect(calls[0]!.url.toString()).toBe('http://collab.test:1/api/v1/capabilities');
    expect(outcome.ok && outcome.value.serviceVersion).toBe('0.1.0');
    expect(outcome.ok && outcome.value.capabilities).toContain('requirement.dictionaries');
  });

  it('旧服务端 404 ⇒ 视为 legacy 空能力集（成功态，不是错误）', async () => {
    const { fetchImpl } = fakeFetch(jsonResponse(404, { error: 'not_found' }));
    const outcome = await client(fetchImpl).fetchCapabilities(TOKEN);
    expect(outcome.ok && outcome.value.capabilities).toEqual([]);
    expect(outcome.ok && outcome.value.serviceVersion).toBe('legacy');
  });

  it('判据 1：协商到旧服务（无 dictionaries）后，建单携带 moduleId ⇒ ⛔ 不发、回升级信号', async () => {
    // 第一次 fetch = 能力协商（404 legacy）；建单被本地门拦下，⛔ 不产生第二次 fetch。
    const { fetchImpl, calls } = fakeFetch(jsonResponse(404, { error: 'not_found' }));
    const subject = client(fetchImpl);
    await subject.fetchCapabilities(TOKEN);
    const created = await subject.createTodo(TOKEN, {
      projectId: PROJECT_ID,
      itemKind: 'requirement',
      title: '带归类的需求',
      moduleId: ENTITY_ID,
    });
    expect(created.ok).toBe(false);
    expect(!created.ok && created.serverCode).toBe('service_upgrade_required');
    // 关键：只有能力协商那一次 fetch，建单请求从未发出（禁发）。
    expect(calls).toHaveLength(1);
  });

  it('判据 1：改单携带 categoryId（含清空 null）在旧服务上同样被拦、不发', async () => {
    const { fetchImpl, calls } = fakeFetch(jsonResponse(404, { error: 'not_found' }));
    const subject = client(fetchImpl);
    await subject.fetchCapabilities(TOKEN);
    const updated = await subject.updateTodo(TOKEN, {
      todoId: ENTITY_ID,
      expectedVersion: 3,
      categoryId: null,
    });
    expect(updated.ok).toBe(false);
    expect(!updated.ok && updated.serverCode).toBe('service_upgrade_required');
    expect(calls).toHaveLength(1);
  });

  it('新服务（有 dictionaries）：建单携带 moduleId ⇒ 照发', async () => {
    const { fetchImpl, calls } = fakeFetch(
      jsonResponse(200, {
        capabilities: ['requirement.dictionaries'],
        service_version: '0.1.0',
      }),
      jsonResponse(201, { todo: { ...wireTodo, module_id: ENTITY_ID } }),
    );
    const subject = client(fetchImpl);
    await subject.fetchCapabilities(TOKEN);
    const created = await subject.createTodo(TOKEN, {
      projectId: PROJECT_ID,
      itemKind: 'requirement',
      title: '带归类的需求',
      moduleId: ENTITY_ID,
    });
    expect(created.ok).toBe(true);
    // 协商 + 建单两次 fetch；建单请求体确实带了 module_id。
    expect(calls).toHaveLength(2);
    expect(JSON.parse(String(calls[1]?.init.body))).toMatchObject({ module_id: ENTITY_ID });
  });

  it('未协商能力（null）：建单携带 moduleId 仍照发（服务端是最终权威）', async () => {
    const { fetchImpl, calls } = fakeFetch(
      jsonResponse(201, { todo: { ...wireTodo, module_id: ENTITY_ID } }),
    );
    const created = await client(fetchImpl).createTodo(TOKEN, {
      projectId: PROJECT_ID,
      itemKind: 'requirement',
      title: '带归类的需求',
      moduleId: ENTITY_ID,
    });
    expect(created.ok).toBe(true);
    expect(calls).toHaveLength(1);
  });

  it('判据 2：测试模式映射（未结旧 inReview 阻塞、旧模式没有轮次）', async () => {
    const { fetchImpl, calls } = fakeFetch(
      jsonResponse(200, {
        mode: 'legacy',
        can_enable_new_mode: false,
        blocked_reasons: ['open_legacy_review'],
        legacy_open_review_count: 2,
        test_rounds: [],
      }),
    );
    const outcome = await client(fetchImpl).fetchProjectTestMode(TOKEN, { projectId: PROJECT_ID });
    expect(calls[0]!.url.toString()).toBe(
      `http://collab.test:1/api/v1/projects/${PROJECT_ID}/test-mode`,
    );
    expect(outcome.ok && outcome.value.mode).toBe('legacy');
    expect(outcome.ok && outcome.value.canEnableNewMode).toBe(false);
    expect(outcome.ok && outcome.value.legacyOpenReviewCount).toBe(2);
    expect(outcome.ok && outcome.value.testRounds).toEqual([]);
  });

  /** 服务端 `serialize_test_round` 的一条活动轮次摘要（⛔ 项目级判定不带整体完成说明）。 */
  const wireActiveRound = (index: number): Record<string, unknown> => ({
    id: `33333333-3333-4333-8333-${String(index).padStart(12, '0')}`,
    project_id: PROJECT_ID,
    requirement_id: ENTITY_ID,
    round_no: 2,
    state: 'testing',
    submitted_by_subject: 'user-bob',
    reviewer_subject: 'user-alice',
    version: 3,
    created_at: '2026-09-14T08:00:00+00:00',
    updated_at: '2026-09-14T09:00:00+00:00',
  });

  it('TST-02：rounds 模式把真实活动轮次投影成 camelCase（与轮次列表同一个映射函数）', async () => {
    const { fetchImpl } = fakeFetch(
      jsonResponse(200, {
        mode: 'rounds',
        can_enable_new_mode: true,
        blocked_reasons: [],
        legacy_open_review_count: 0,
        test_rounds: [wireActiveRound(1)],
      }),
    );
    const outcome = await client(fetchImpl).fetchProjectTestMode(TOKEN, { projectId: PROJECT_ID });
    expect(outcome).toEqual({
      ok: true,
      value: {
        mode: 'rounds',
        canEnableNewMode: true,
        blockedReasons: [],
        legacyOpenReviewCount: 0,
        testRounds: [
          {
            id: '33333333-3333-4333-8333-000000000001',
            projectId: PROJECT_ID,
            requirementId: ENTITY_ID,
            roundNo: 2,
            state: 'testing',
            submittedBySubject: 'user-bob',
            reviewerSubject: 'user-alice',
            version: 3,
            createdAt: '2026-09-14T08:00:00+00:00',
            updatedAt: '2026-09-14T09:00:00+00:00',
          },
        ],
      },
    });
  });

  it('判据 2：不是轮次形状的 test_rounds、未知模式、超过 100 条 ⇒ 整条判不可信（不采信虚构轮次）', async () => {
    const base = {
      mode: 'legacy',
      can_enable_new_mode: false,
      blocked_reasons: ['open_legacy_review'],
      legacy_open_review_count: 1,
    };
    const { fetchImpl } = fakeFetch(
      jsonResponse(200, { ...base, test_rounds: [{ round: 1 }] }),
      jsonResponse(200, { ...base, mode: 'hybrid', test_rounds: [] }),
      jsonResponse(200, {
        ...base,
        mode: 'rounds',
        test_rounds: Array.from({ length: 101 }, (_unused, index) => wireActiveRound(index)),
      }),
    );
    const subject = client(fetchImpl);
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const outcome = await subject.fetchProjectTestMode(TOKEN, { projectId: PROJECT_ID });
      expect(outcome).toEqual({ ok: false, code: 'transient' });
    }
  });
});

describe('CollabClient 旧链路在新测试模式下的 409 业务码（TST-02）', () => {
  it('⭐ 提交验收 / 验收打回 / 改单的 409 缺 current_version 时带回 serverCode（⛔ 不塌缩成无码 conflict）', async () => {
    const { fetchImpl } = fakeFetch(
      jsonResponse(409, { error: 'requirement_test_mode_required', detail: '不透传' }),
      jsonResponse(409, { error: 'test_round_in_progress' }),
      jsonResponse(409, { error: 'test_round_in_progress' }),
    );
    const subject = client(fetchImpl);
    await expect(
      subject.submitTodoReview(TOKEN, {
        todoId: ENTITY_ID,
        expectedVersion: 3,
        summary: '做完了',
      }),
    ).resolves.toEqual({
      ok: false,
      code: 'conflict',
      serverCode: 'requirement_test_mode_required',
    });
    await expect(
      subject.reviewTodo(TOKEN, { todoId: ENTITY_ID, expectedVersion: 3, decision: 'accept' }),
    ).resolves.toEqual({ ok: false, code: 'conflict', serverCode: 'test_round_in_progress' });
    await expect(
      subject.updateTodo(TOKEN, { todoId: ENTITY_ID, expectedVersion: 3, status: 'cancelled' }),
    ).resolves.toEqual({ ok: false, code: 'conflict', serverCode: 'test_round_in_progress' });
  });
});
