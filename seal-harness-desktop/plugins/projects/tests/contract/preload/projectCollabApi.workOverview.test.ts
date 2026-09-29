import { describe, expect, it, vi } from 'vitest';

import { IPC } from '../../../stratex/shared/ipc/channels.js';
import { createProjectCollabPreloadApi, type ProjectCollabInvoke } from '../../../stratex/preload/projectCollabApi.js';

const projectId = '11111111-1111-4111-8111-111111111111';
const emptyOverview = {
  ok: true,
  counts: { overdue: 0, dueToday: 0, incomplete: 0, participating: 0 },
  total: 0,
  items: [],
  nextCursor: null,
};

describe('工作概览公共预加载边界', () => {
  it('传递分组和分页条件并接受真实空集合', async () => {
    const invoke = vi.fn<ProjectCollabInvoke>(async () => emptyOverview);
    const api = createProjectCollabPreloadApi(invoke, () => () => undefined);
    const request = { projectId, group: 'participating' as const, limit: 20, cursor: 'cursor-1' };
    await expect(api.readProjectWorkOverview(request)).resolves.toEqual(emptyOverview);
    expect(IPC.PROJECT_WORK_OVERVIEW).toBe('project:work-overview');
    expect(invoke).toHaveBeenCalledExactlyOnceWith(IPC.PROJECT_WORK_OVERVIEW, request);
  });

  it('拒绝身份注入、未知分组和越界页长，均不发 IPC', async () => {
    const invoke = vi.fn<ProjectCollabInvoke>(async () => emptyOverview);
    const api = createProjectCollabPreloadApi(invoke, () => () => undefined);
    for (const invalid of [
      { projectId, accountKey: 'forbidden' },
      { projectId, group: 'all' },
      { projectId, limit: 51 },
    ]) {
      await expect(api.readProjectWorkOverview(invalid as never)).rejects.toThrow();
    }
    expect(invoke).not.toHaveBeenCalled();
  });

  it('拒绝越界响应和不一致统计，保留结构化失败', async () => {
    const invoke = vi.fn<ProjectCollabInvoke>(async () => ({ ...emptyOverview, subject: 'leak' }));
    const api = createProjectCollabPreloadApi(invoke, () => () => undefined);
    await expect(api.readProjectWorkOverview({ projectId })).rejects.toThrow();
    invoke.mockResolvedValueOnce({ ...emptyOverview, total: 5 });
    await expect(api.readProjectWorkOverview({ projectId })).rejects.toThrow();
    const failure = {
      ok: false,
      code: 'rejected',
      message: '请求被服务端拒绝。',
      referenceCode: 'STRX-COLLAB-009',
      serverCode: 'invalid_cursor',
    };
    invoke.mockResolvedValueOnce(failure);
    await expect(api.readProjectWorkOverview({ projectId })).resolves.toEqual(failure);
  });
});
