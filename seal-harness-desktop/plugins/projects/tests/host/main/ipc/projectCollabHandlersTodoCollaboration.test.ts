import { describe, expect, it, vi } from 'vitest';
import {
  registerProjectTodoCollaborationHandlers,
  PROJECT_TODO_COLLABORATION_CHANNELS as CHANNELS,
  type ProjectTodoCollaborationClientPort,
} from '../../../../stratex/main/ipc/projectCollabHandlersTodoCollaboration.js';

const TODO = '11111111-1111-4111-8111-111111111111';
const PROJECT = '22222222-2222-4222-8222-222222222222';
const KEY = '33333333-3333-4333-8333-333333333333';
const comment = {
  id: KEY,
  todoId: TODO,
  authorSubject: 'alice',
  authorDisplayName: 'Alice',
  bodyMd: 'private text',
  refs: [],
  createdAt: '2026-09-15T00:00:00Z',
};
type Handler = (event: unknown, input: unknown) => Promise<unknown>;

function setup(
  options: {
    accessToken?: () => Promise<string | null>;
    client?: Partial<ProjectTodoCollaborationClientPort>;
  } = {},
) {
  const client: ProjectTodoCollaborationClientPort = {
    getTodoCollaborators: vi.fn(async () => ({
      ok: true as const,
      value: { todoId: TODO, version: 1, collaborators: [] },
    })),
    replaceTodoCollaborators: vi.fn(async () => ({
      ok: true as const,
      value: { todoId: TODO, version: 2, collaborators: [], replayed: false },
    })),
    listTodoComments: vi.fn(async () => ({
      ok: true as const,
      value: { comments: [comment], nextCursor: null },
    })),
    createTodoComment: vi.fn(async () => ({
      ok: true as const,
      value: { comment, replayed: false },
    })),
    previewTodoDeletion: vi.fn(async () => ({
      ok: true as const,
      value: {
        rootIds: [TODO],
        requirementCount: 1,
        taskCount: 2,
        testRoundCount: 0,
        testCaseCount: 0,
        activeRoundCount: 0,
        canDelete: true,
      },
    })),
    ...options.client,
  };
  const state = { accountKey: 'account-a', authEpoch: 1, authorized: true };
  const handlers = new Map<string, Handler>();
  const accessToken = options.accessToken ?? vi.fn(async () => 'token');
  registerProjectTodoCollaborationHandlers(
    { handle: (channel, listener) => handlers.set(channel, listener) },
    {
      dependencies: { collaboration: client, accessToken },
      authorize: () => state.authorized,
      // 模拟会话提供器返回同一个响应式对象；处理器必须捕获标量快照。
      activeAccount: () => state,
    },
  );
  const invoke = (channel: string, input: unknown) => {
    const handler = handlers.get(channel);
    if (!handler) throw new Error('missing handler');
    return handler({}, input);
  };
  return { client, state, invoke, handlers, accessToken };
}

describe('协作IPC身份与契约边界', () => {
  it('注册五通道并保留camelCase结果', async () => {
    const { invoke, handlers } = setup();
    expect([...handlers.keys()]).toEqual(Object.values(CHANNELS));
    expect(await invoke(CHANNELS.collaborators, { todoId: TODO })).toMatchObject({
      ok: true,
      todoId: TODO,
      version: 1,
    });
    expect(
      await invoke(CHANNELS.replaceCollaborators, {
        todoId: TODO,
        expectedVersion: 1,
        clientRequestId: KEY,
        subjects: [],
      }),
    ).toMatchObject({ ok: true, replayed: false });
    expect(await invoke(CHANNELS.comments, { todoId: TODO })).toMatchObject({
      ok: true,
      comments: [comment],
      nextCursor: null,
    });
    expect(
      await invoke(CHANNELS.createComment, {
        todoId: TODO,
        clientRequestId: KEY,
        bodyMd: '评论',
        refs: [],
      }),
    ).toMatchObject({ ok: true, comment });
    expect(await invoke(CHANNELS.deletePreview, { projectId: PROJECT, ids: [TODO] })).toMatchObject(
      { ok: true, rootIds: [TODO], taskCount: 2 },
    );
  });
  it('拒绝账号注入且不取令牌/发送', async () => {
    const { invoke, client, accessToken } = setup();
    expect(await invoke(CHANNELS.comments, { todoId: TODO, accountKey: 'forged' })).toMatchObject({
      ok: false,
      code: 'invalidRequest',
    });
    expect(accessToken).not.toHaveBeenCalled();
    expect(client.listTodoComments).not.toHaveBeenCalled();
  });
  it.each(['accountKey', 'authEpoch', 'authorized'] as const)(
    '令牌等待期间%s改变后不得发送',
    async (key) => {
      let finish: ((token: string) => void) | undefined;
      const { invoke, state, client } = setup({
        accessToken: () =>
          new Promise((resolve) => {
            finish = resolve;
          }),
      });
      const pending = invoke(CHANNELS.createComment, {
        todoId: TODO,
        clientRequestId: KEY,
        bodyMd: '评论',
        refs: [],
      });
      if (key === 'accountKey') state.accountKey = 'account-b';
      else if (key === 'authEpoch') state.authEpoch += 1;
      else state.authorized = false;
      finish?.('token');
      expect(await pending).toMatchObject({ ok: false, code: 'authRequired' });
      expect(client.createTodoComment).not.toHaveBeenCalled();
    },
  );
  it('网络等待期间换账号不泄露上一账号正文', async () => {
    let finish: (() => void) | undefined;
    const { invoke, state } = setup({
      client: {
        listTodoComments: () =>
          new Promise((resolve) => {
            finish = () => resolve({ ok: true, value: { comments: [comment], nextCursor: null } });
          }),
      },
    });
    const pending = invoke(CHANNELS.comments, { todoId: TODO });
    await Promise.resolve();
    state.authEpoch += 1;
    finish?.();
    const result = await pending;
    expect(result).toMatchObject({ ok: false, code: 'authRequired' });
    expect(JSON.stringify(result)).not.toContain('private text');
  });
  it('异常只回固定文本，版本冲突保留当前版本', async () => {
    const failure = setup({
      client: {
        getTodoCollaborators: async () => {
          throw new Error('token secret');
        },
      },
    });
    const result = await failure.invoke(CHANNELS.collaborators, { todoId: TODO });
    expect(result).toMatchObject({ ok: false, code: 'transient' });
    expect(JSON.stringify(result)).not.toContain('secret');
    const conflict = setup({
      client: {
        replaceTodoCollaborators: async () => ({
          ok: false,
          code: 'conflict',
          serverCode: 'version_conflict',
          currentVersion: 7,
        }),
      },
    });
    expect(
      await conflict.invoke(CHANNELS.replaceCollaborators, {
        todoId: TODO,
        expectedVersion: 1,
        clientRequestId: KEY,
        subjects: [],
      }),
    ).toMatchObject({
      ok: false,
      code: 'conflict',
      serverCode: 'version_conflict',
      currentVersion: 7,
    });
  });
  it('无令牌与错误发送帧拒绝', async () => {
    const noToken = setup({ accessToken: async () => null });
    expect(await noToken.invoke(CHANNELS.collaborators, { todoId: TODO })).toMatchObject({
      ok: false,
      code: 'credentialRejected',
    });
    const denied = setup();
    denied.state.authorized = false;
    expect(await denied.invoke(CHANNELS.collaborators, { todoId: TODO })).toMatchObject({
      ok: false,
      code: 'authRequired',
    });
    expect(denied.accessToken).not.toHaveBeenCalled();
  });
});
