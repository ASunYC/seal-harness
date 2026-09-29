import { describe, expect, it, vi } from 'vitest';

import { IPC } from '../../../stratex/shared/ipc/channels.js';
import { createProjectSpecAssistPreloadApi } from '../../../stratex/preload/projectSpecAssistApi.js';

/**
 * 「让助理补全」预加载桥：入参在此收敛、出参在此校验（ADR-0043，两侧都不信对方）。
 */

const REQUEST_ID = '33333333-3333-4333-8333-333333333333';
const REQUEST = {
  requestId: REQUEST_ID,
  projectId: '11111111-1111-4111-8111-111111111111',
  itemKind: 'task' as const,
  title: '核查',
};

describe('createProjectSpecAssistPreloadApi', () => {
  it('合法请求原样经生成通道发出，并校验回程', async () => {
    const invoke = vi.fn(async () => ({
      ok: true,
      requestId: REQUEST_ID,
      suggestion: { description: '目标', acceptanceItems: [], constraintsText: '' },
    }));
    const api = createProjectSpecAssistPreloadApi(invoke);
    await expect(api.generateProjectTodoSpec(REQUEST)).resolves.toMatchObject({ ok: true });
    expect(invoke).toHaveBeenCalledWith(IPC.PROJECT_TODO_SPEC_ASSIST, REQUEST);
  });

  it('夹带多余键的请求在桥上就被拒，不发 IPC', async () => {
    const invoke = vi.fn();
    const api = createProjectSpecAssistPreloadApi(invoke);
    await expect(
      api.generateProjectTodoSpec({ ...REQUEST, connectionId: 'c' } as never),
    ).rejects.toThrow();
    expect(invoke).not.toHaveBeenCalled();
  });

  it('回程不合契约（建议描述超服务端上限）即抛', async () => {
    const invoke = vi.fn(async () => ({
      ok: true,
      requestId: REQUEST_ID,
      suggestion: { description: 'x'.repeat(4_001), acceptanceItems: [], constraintsText: '' },
    }));
    const api = createProjectSpecAssistPreloadApi(invoke);
    await expect(api.generateProjectTodoSpec(REQUEST)).rejects.toThrow();
  });

  it('取消与就绪查询各走自己的通道', async () => {
    const invoke = vi.fn(async (channel: string) =>
      channel === IPC.PROJECT_TODO_SPEC_ASSIST_READINESS
        ? { ok: true, state: 'ready' }
        : { ok: true },
    );
    const api = createProjectSpecAssistPreloadApi(invoke);
    await expect(api.cancelProjectTodoSpec({ requestId: REQUEST_ID })).resolves.toEqual({
      ok: true,
    });
    await expect(api.readProjectTodoSpecReadiness()).resolves.toEqual({
      ok: true,
      state: 'ready',
    });
    expect(invoke.mock.calls).toEqual([
      [IPC.PROJECT_TODO_SPEC_ASSIST_CANCEL, { requestId: REQUEST_ID }],
      [IPC.PROJECT_TODO_SPEC_ASSIST_READINESS, {}],
    ]);
  });
});
