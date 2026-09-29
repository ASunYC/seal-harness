import { describe, expect, it, vi } from 'vitest';
import { CollabTodoCollaborationClient } from '../../../../../stratex/main/services/collab/collabTodoCollaborationClient.js';

const TODO = '11111111-1111-4111-8111-111111111111';
const PROJECT = '22222222-2222-4222-8222-222222222222';
const KEY = '33333333-3333-4333-8333-333333333333';
const COMMENT = '44444444-4444-4444-8444-444444444444';
const wireCollaborators = {
  todo_id: TODO,
  version: 2,
  collaborators: [{ subject: 'alice', display_name: 'Alice', state: 'active' }],
};
const wireComment = {
  id: COMMENT,
  todo_id: TODO,
  author_subject: 'alice',
  author_display_name: 'Alice',
  body_md: '评论',
  refs: ['member:alice'],
  created_at: '2026-09-15T00:00:00Z',
};

function setup(body: unknown, status = 200) {
  const fetchImpl = vi
    .fn<typeof fetch>()
    .mockResolvedValue(new Response(JSON.stringify(body), { status }));
  const client = new CollabTodoCollaborationClient({
    baseUrl: 'https://collab.test/service/',
    fetchImpl,
  });
  return { client, fetchImpl };
}

describe('协作HTTP边界', () => {
  it('映射协助人并仅在Authorization发送令牌', async () => {
    const { client, fetchImpl } = setup(wireCollaborators);
    expect(await client.getTodoCollaborators('secret', { todoId: TODO })).toEqual({
      ok: true,
      value: {
        todoId: TODO,
        version: 2,
        collaborators: [{ subject: 'alice', displayName: 'Alice', state: 'active' }],
      },
    });
    expect(String(fetchImpl.mock.calls[0]?.[0])).toBe(
      `https://collab.test/service/api/v1/todos/${TODO}/collaborators`,
    );
    expect(fetchImpl.mock.calls[0]?.[1]?.headers).toEqual({ authorization: 'Bearer secret' });
  });
  it('替换去重并保持幂等请求键，映射replayed', async () => {
    const { client, fetchImpl } = setup({ ...wireCollaborators, replayed: true });
    expect(
      await client.replaceTodoCollaborators('token', {
        todoId: TODO,
        expectedVersion: 1,
        subjects: ['alice', 'alice'],
        clientRequestId: KEY,
      }),
    ).toMatchObject({ ok: true, value: { replayed: true, version: 2 } });
    expect(JSON.parse(String(fetchImpl.mock.calls[0]?.[1]?.body))).toEqual({
      expected_version: 1,
      subjects: ['alice'],
      client_request_id: KEY,
    });
  });
  it('评论分页传before_id并映射正文与游标', async () => {
    const { client, fetchImpl } = setup({ comments: [wireComment], next_cursor: COMMENT });
    expect(
      await client.listTodoComments('token', { todoId: TODO, beforeId: KEY, limit: 1 }),
    ).toMatchObject({
      ok: true,
      value: {
        comments: [{ todoId: TODO, authorSubject: 'alice', bodyMd: '评论' }],
        nextCursor: COMMENT,
      },
    });
    const url = new URL(String(fetchImpl.mock.calls[0]?.[0]));
    expect(url.searchParams.get('before_id')).toBe(KEY);
    expect(url.searchParams.get('limit')).toBe('1');
  });
  it.each([200, 201])('评论%d回放语义与POST正文', async (status) => {
    const { client, fetchImpl } = setup({ comment: wireComment, replayed: status === 200 }, status);
    expect(
      await client.createTodoComment('token', {
        todoId: TODO,
        clientRequestId: KEY,
        bodyMd: '评论',
        refs: ['member:alice'],
      }),
    ).toMatchObject({ ok: true, value: { replayed: status === 200 } });
    expect(JSON.parse(String(fetchImpl.mock.calls[0]?.[1]?.body))).toEqual({
      client_request_id: KEY,
      body_md: '评论',
      refs: ['member:alice'],
    });
  });
  it('预检匹配去重根及服务端计数', async () => {
    const { client } = setup({
      root_ids: [TODO],
      requirement_count: 1,
      task_count: 50,
      test_round_count: 3,
      test_case_count: 20,
      active_round_count: 1,
      can_delete: false,
    });
    expect(
      await client.previewTodoDeletion('token', { projectId: PROJECT, ids: [TODO, TODO] }),
    ).toEqual({
      ok: true,
      value: {
        rootIds: [TODO],
        requirementCount: 1,
        taskCount: 50,
        testRoundCount: 3,
        testCaseCount: 20,
        activeRoundCount: 1,
        canDelete: false,
      },
    });
  });
  it('版本冲突保留代码和版本，不回显错误正文', async () => {
    const { client } = setup(
      { error: 'version_conflict', current_version: 9, message: 'private secret' },
      409,
    );
    expect(
      await client.replaceTodoCollaborators('token', {
        todoId: TODO,
        expectedVersion: 1,
        subjects: [],
        clientRequestId: KEY,
      }),
    ).toEqual({ ok: false, code: 'conflict', serverCode: 'version_conflict', currentVersion: 9 });
  });
  it('拒绝超限出站，无网络请求', async () => {
    const { client, fetchImpl } = setup(wireCollaborators);
    expect(
      await client.replaceTodoCollaborators('token', {
        todoId: TODO,
        expectedVersion: 1,
        subjects: Array.from({ length: 21 }, (_, index) => String(index)),
        clientRequestId: KEY,
      }),
    ).toEqual({ ok: false, code: 'invalidRequest' });
    expect(fetchImpl).not.toHaveBeenCalled();
  });
  it.each([
    { ...wireCollaborators, todo_id: PROJECT },
    { ...wireCollaborators, version: 0 },
    {
      ...wireCollaborators,
      collaborators: [...wireCollaborators.collaborators, ...wireCollaborators.collaborators],
    },
  ])('拒绝错父项、坏版本或重复协助人', async (body) => {
    expect(await setup(body).client.getTodoCollaborators('token', { todoId: TODO })).toEqual({
      ok: false,
      code: 'transient',
    });
  });
  it.each([
    { comments: [{ ...wireComment, todo_id: PROJECT }], next_cursor: null },
    { comments: [wireComment], next_cursor: KEY },
    { comments: [wireComment, wireComment], next_cursor: null },
    { comments: [wireComment] },
  ])('坏评论分页整页拒绝', async (body) => {
    expect(await setup(body).client.listTodoComments('token', { todoId: TODO, limit: 1 })).toEqual({
      ok: false,
      code: 'transient',
    });
  });
  it('拒绝不符合HTTP状态的回放标志', async () => {
    expect(
      await setup({ comment: wireComment, replayed: true }, 201).client.createTodoComment('token', {
        todoId: TODO,
        clientRequestId: KEY,
        bodyMd: '评论',
        refs: [],
      }),
    ).toEqual({ ok: false, code: 'transient' });
  });
  it('拒绝未知2xx、损坏JSON与超大响应', async () => {
    expect(
      await setup(wireCollaborators, 202).client.getTodoCollaborators('token', { todoId: TODO }),
    ).toEqual({ ok: false, code: 'transient' });
    for (const body of ['{', 'x'.repeat(4_000_001)]) {
      const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(new Response(body));
      const client = new CollabTodoCollaborationClient({
        baseUrl: 'https://collab.test/',
        fetchImpl,
      });
      expect(await client.getTodoCollaborators('token', { todoId: TODO })).toEqual({
        ok: false,
        code: 'transient',
      });
    }
  });
  it('网络异常和超时只返回transient，不自行重试', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockRejectedValue(new Error('private upstream'));
    const client = new CollabTodoCollaborationClient({
      baseUrl: 'https://collab.test/',
      fetchImpl,
    });
    expect(await client.getTodoCollaborators('token', { todoId: TODO })).toEqual({
      ok: false,
      code: 'transient',
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const hanging = vi.fn<typeof fetch>(
      (_url, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(new Error('aborted')), {
            once: true,
          });
        }),
    );
    const timed = new CollabTodoCollaborationClient({
      baseUrl: 'https://collab.test/',
      fetchImpl: hanging,
      timeoutMs: 10,
    });
    expect(await timed.getTodoCollaborators('token', { todoId: TODO })).toEqual({
      ok: false,
      code: 'transient',
    });
    expect(hanging).toHaveBeenCalledTimes(1);
  });
});
