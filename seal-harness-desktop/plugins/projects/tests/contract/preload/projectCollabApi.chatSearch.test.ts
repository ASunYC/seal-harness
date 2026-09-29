import { describe, expect, it, vi } from 'vitest';

import { createProjectCollabPreloadApi, type ProjectCollabInvoke } from '../../../stratex/preload/projectCollabApi.js';

describe('正文搜索预加载边界', () => {
  it('原历史通道传递搜索条件及分页元数据', async () => {
    const request = {
      projectId: '11111111-1111-4111-8111-111111111111',
      search: { query: '正文', cursor: 'page-token' },
      limit: 20,
    };
    const result = { ok: true, messages: [], searchPage: { nextCursor: null } };
    const invoke = vi.fn<ProjectCollabInvoke>(async () => result);
    const api = createProjectCollabPreloadApi(invoke, () => () => undefined);

    await expect(api.readProjectChatHistory(request)).resolves.toEqual(result);
    expect(invoke).toHaveBeenCalledExactlyOnceWith('project:chat-history', request);
  });
});
