import { describe, expect, it, vi } from 'vitest';
import { registerProjectDictionaryHandlers } from '../../../../stratex/main/ipc/projectDictionaryHandlers.js';
import { IPC } from '../../../../stratex/shared/ipc/channels.js';
import type { CollabDictionaryClient } from '../../../../stratex/main/services/collab/collabDictionaryClient.js';

const request = {
  projectId: '11111111-1111-4111-8111-111111111111',
  kind: 'modules',
  page: 1,
  pageSize: 100,
};
function harness() {
  const state = { epoch: 1, authorized: true };
  const list = vi
    .fn<CollabDictionaryClient['list']>()
    .mockResolvedValue({ ok: true, value: { items: [], page: 1, pageSize: 100, total: 0 } });
  const accessToken = vi.fn<() => Promise<string | null>>().mockResolvedValue('credential');
  const handlers = new Map<string, (event: unknown, input: unknown) => Promise<unknown>>();
  registerProjectDictionaryHandlers(
    { handle: (channel, listener) => handlers.set(channel, listener) },
    {
      dependencies: { client: { list }, accessToken },
      authorize: () => state.authorized,
      activeAccount: () => ({ accountKey: 'account', authEpoch: state.epoch }),
    },
  );
  return {
    state,
    list,
    accessToken,
    invoke: (input: unknown = request) => {
      const handler = handlers.get(IPC.PROJECT_DICTIONARY_LIST);
      if (!handler) throw new Error('字典通道未注册');
      return handler({}, input);
    },
  };
}
describe('dictionary IPC authorization', () => {
  it('refuses foreign fields and untrusted senders before resolving a credential', async () => {
    const h = harness();
    expect(await h.invoke({ ...request, accountKey: 'spoof' })).toMatchObject({
      ok: false,
      code: 'invalidRequest',
    });
    h.state.authorized = false;
    expect(await h.invoke()).toMatchObject({ ok: false, code: 'authRequired' });
    expect(h.accessToken).not.toHaveBeenCalled();
  });
  it('does not send a token resolved after an identity epoch change', async () => {
    const h = harness();
    h.accessToken.mockImplementation(async () => {
      h.state.epoch += 1;
      return 'old-token';
    });
    expect(await h.invoke()).toMatchObject({ ok: false, code: 'authRequired' });
    expect(h.list).not.toHaveBeenCalled();
  });
  it('discards late data after the requesting page or account changes', async () => {
    const h = harness();
    h.list.mockImplementation(async () => {
      h.state.authorized = false;
      return { ok: true, value: { items: [], page: 1, pageSize: 100, total: 0 } };
    });
    expect(await h.invoke()).toMatchObject({ ok: false, code: 'authRequired' });
  });
  it('returns an explicit permission failure without leaking server or exception messages', async () => {
    const h = harness();
    h.list.mockResolvedValueOnce({ ok: false, code: 'forbidden' });
    expect(await h.invoke()).toMatchObject({
      ok: false,
      code: 'forbidden',
      referenceCode: 'STRX-COLLAB-008',
    });
    h.list.mockRejectedValueOnce(new Error('secret-token'));
    expect(JSON.stringify(await h.invoke())).not.toContain('secret-token');
  });
});
