import { describe, expect, it, vi } from 'vitest';

import { createProjectCollabPreloadApi, type ProjectCollabInvoke } from '../../../stratex/preload/projectCollabApi.js';

describe('可靠消息预加载边界', () => {
  it('严格校验后原样传递稳定标识到发送通道', async () => {
    const request = {
      projectId: '11111111-1111-4111-8111-111111111111',
      bodyMd: '原消息',
      refs: ['user:member'],
      clientMessageId: '22222222-2222-4222-8222-222222222222',
    };
    const result = {
      ok: true,
      message: {
        id: '33333333-3333-4333-8333-333333333333',
        seq: 7,
        authorSubject: 'member',
        authorDisplayName: '成员',
        bodyMd: request.bodyMd,
        refs: request.refs,
        revoked: false,
        createdAt: '2026-09-15T08:00:00Z',
      },
    };
    const invoke = vi.fn<ProjectCollabInvoke>(async () => result);
    const api = createProjectCollabPreloadApi(invoke, () => () => undefined);

    await expect(api.sendProjectChatMessage(request)).resolves.toEqual(result);
    expect(invoke).toHaveBeenCalledExactlyOnceWith('project:chat-send', request);
  });
});
