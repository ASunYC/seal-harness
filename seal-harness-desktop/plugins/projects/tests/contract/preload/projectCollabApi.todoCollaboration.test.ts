import { describe, expect, it, vi } from 'vitest';

import { IPC } from '../../../stratex/shared/ipc/channels.js';
import { createProjectCollabPreloadApi, type ProjectCollabInvoke } from '../../../stratex/preload/projectCollabApi.js';

const todoId = '11111111-1111-4111-8111-111111111111';
const projectId = '22222222-2222-4222-8222-222222222222';
const clientRequestId = '33333333-3333-4333-8333-333333333333';
const comment = {
  id: clientRequestId,
  todoId,
  authorSubject: 'member-1',
  authorDisplayName: '项目成员',
  bodyMd: '请核对验收要求',
  refs: [],
  createdAt: '2026-09-15T00:00:00Z',
};

const cases = [
  {
    method: 'getProjectTodoCollaborators',
    channel: 'project:todo-collaborators',
    request: { todoId },
    result: { ok: true, todoId, version: 1, collaborators: [] },
  },
  {
    method: 'replaceProjectTodoCollaborators',
    channel: 'project:todo-collaborators-replace',
    request: { todoId, expectedVersion: 1, clientRequestId, subjects: ['member-1'] },
    result: { ok: true, todoId, version: 2, collaborators: [], replayed: false },
  },
  {
    method: 'listProjectTodoComments',
    channel: 'project:todo-comments',
    request: { todoId, limit: 20 },
    result: { ok: true, comments: [comment], nextCursor: null },
  },
  {
    method: 'createProjectTodoComment',
    channel: 'project:todo-comment-create',
    request: { todoId, clientRequestId, bodyMd: comment.bodyMd, refs: [] },
    result: { ok: true, comment, replayed: false },
  },
  {
    method: 'previewProjectTodoDeletion',
    channel: 'project:todo-delete-preview',
    request: { projectId, ids: [todoId] },
    result: {
      ok: true,
      rootIds: [todoId],
      requirementCount: 1,
      taskCount: 2,
      testRoundCount: 1,
      testCaseCount: 3,
      activeRoundCount: 0,
      canDelete: true,
    },
  },
] as const;

describe('任务协作公共预加载边界', () => {
  it.each(cases)(
    '$method 使用独立通道并校验往返载荷',
    async ({ method, channel, request, result }) => {
      const invoke = vi.fn<ProjectCollabInvoke>(async () => result);
      const api = createProjectCollabPreloadApi(invoke, () => () => undefined);
      await expect(api[method](request as never)).resolves.toEqual(result);
      expect(invoke).toHaveBeenCalledExactlyOnceWith(channel, request);
    },
  );

  it.each(cases)('$method 拒绝夹带身份的请求及越界响应', async ({ method, request, result }) => {
    const invoke = vi.fn<ProjectCollabInvoke>(async () => ({
      ...result,
      accessToken: 'forbidden',
    }));
    const api = createProjectCollabPreloadApi(invoke, () => () => undefined);
    await expect(api[method]({ ...request, accountKey: 'forbidden' } as never)).rejects.toThrow();
    expect(invoke).not.toHaveBeenCalled();
    await expect(api[method](request as never)).rejects.toThrow();
    expect(invoke).toHaveBeenCalledOnce();
  });

  it.each(cases)('$method 在共享通道白名单中登记', ({ channel }) => {
    expect(Object.values(IPC)).toContain(channel);
  });

  it('协助人版本冲突保留当前版本，失败缺少版本键则拒收', async () => {
    const result = {
      ok: false,
      code: 'conflict',
      message: '内容已被更新，请刷新后重试。',
      referenceCode: 'STRX-COLLAB-006',
      serverCode: 'version_conflict',
      currentVersion: 3,
    };
    const invoke = vi.fn<ProjectCollabInvoke>(async () => result);
    const api = createProjectCollabPreloadApi(invoke, () => () => undefined);
    const request = { todoId, expectedVersion: 1, clientRequestId, subjects: [] };
    await expect(api.replaceProjectTodoCollaborators(request)).resolves.toEqual(result);
    invoke.mockResolvedValueOnce({ ...result, currentVersion: undefined });
    await expect(api.replaceProjectTodoCollaborators(request)).rejects.toThrow();
  });
});
