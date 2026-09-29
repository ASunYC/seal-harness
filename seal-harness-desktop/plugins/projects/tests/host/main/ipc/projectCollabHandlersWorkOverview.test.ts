import { describe, expect, it, vi } from 'vitest';
import {
  registerProjectWorkOverviewHandlers,
  type ProjectWorkOverviewHandlerOptions,
} from '../../../../stratex/main/ipc/projectCollabHandlersWorkOverview.js';
import { PROJECT_WORK_OVERVIEW_CHANNEL } from '../../../../stratex/shared/protocol/project-work-overview.js';

const projectId = '11111111-1111-4111-8111-111111111111';
const page = {
  counts: { overdue: 0, dueToday: 0, incomplete: 0, participating: 0 },
  total: 0,
  items: [],
  nextCursor: null,
};
type Dependencies = NonNullable<ProjectWorkOverviewHandlerOptions['dependencies']>;
function setup(deps: Partial<Dependencies> = {}) {
  const state = { accountKey: 'account-a', authEpoch: 1, authorized: true };
  const overview = {
    readWorkOverview: vi
      .fn<Dependencies['overview']['readWorkOverview']>()
      .mockResolvedValue({ ok: true, value: page }),
  };
  const accessToken = vi.fn(async () => 'token');
  const listeners = new Map<string, (event: unknown, input: unknown) => Promise<unknown>>();
  registerProjectWorkOverviewHandlers(
    { handle: (channel, listener) => listeners.set(channel, listener) },
    {
      dependencies: { overview, accessToken, ...deps },
      authorize: () => state.authorized,
      activeAccount: () => state,
    },
  );
  const invoke = (input: unknown = { projectId }) => {
    const listener = listeners.get(PROJECT_WORK_OVERVIEW_CHANNEL);
    if (!listener) throw new Error('缺少注册');
    return listener({}, input);
  };
  return { state, overview, accessToken, invoke };
}
describe('工作概览 IPC', () => {
  it('返回经校验的只读结果，拒绝注入账号', async () => {
    const { invoke, accessToken } = setup();
    expect(await invoke()).toEqual({ ok: true, ...page });
    accessToken.mockClear();
    expect(await invoke({ projectId, accountKey: 'forged' })).toMatchObject({
      ok: false,
      code: 'invalidRequest',
    });
    expect(accessToken).not.toHaveBeenCalled();
  });
  it.each(['accountKey', 'authEpoch', 'authorized'] as const)(
    '令牌等待时%s变化不发请求',
    async (key) => {
      let finish: ((value: string) => void) | undefined;
      const { state, overview, invoke } = setup({
        accessToken: () =>
          new Promise((resolve) => {
            finish = resolve;
          }),
      });
      const pending = invoke();
      if (key === 'accountKey') state.accountKey = 'account-b';
      else if (key === 'authEpoch') state.authEpoch++;
      else state.authorized = false;
      finish?.('token');
      expect(await pending).toMatchObject({ ok: false, code: 'authRequired' });
      expect(overview.readWorkOverview).not.toHaveBeenCalled();
    },
  );
  it.each(['accountKey', 'authEpoch', 'authorized'] as const)(
    '网络等待时%s变化丢弃响应',
    async (key) => {
      let finish: (() => void) | undefined;
      const { state, invoke } = setup({
        overview: {
          readWorkOverview: () =>
            new Promise((resolve) => {
              finish = () => resolve({ ok: true, value: page });
            }),
        },
      });
      const pending = invoke();
      await Promise.resolve();
      if (key === 'accountKey') state.accountKey = 'account-b';
      else if (key === 'authEpoch') state.authEpoch++;
      else state.authorized = false;
      finish?.();
      expect(await pending).toMatchObject({ ok: false, code: 'authRequired' });
    },
  );
  it('异常与失效游标只回中性提示', async () => {
    const thrown = setup({
      accessToken: async () => {
        throw new Error('private token');
      },
    });
    expect(JSON.stringify(await thrown.invoke())).not.toContain('private');
    const stale = setup({
      overview: {
        readWorkOverview: async () => ({
          ok: false,
          code: 'rejected',
          serverCode: 'invalid_cursor',
        }),
      },
    });
    expect(await stale.invoke()).toMatchObject({
      ok: false,
      serverCode: 'invalid_cursor',
      message: '工作概览已变化，请刷新。',
    });
  });
});
