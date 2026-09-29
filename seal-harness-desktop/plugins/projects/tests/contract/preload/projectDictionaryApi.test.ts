import { describe, expect, it, vi } from 'vitest';
import { createProjectDictionaryPreloadApi } from '../../../stratex/preload/projectDictionaryApi.js';
import { IPC } from '../../../stratex/shared/ipc/channels.js';
const request = {
  projectId: '11111111-1111-4111-8111-111111111111',
  kind: 'modules' as const,
  page: 1,
  pageSize: 100,
};
describe('dictionary preload boundary', () => {
  it('validates before invoking and validates the returned result', async () => {
    const invoke = vi
      .fn()
      .mockResolvedValue({ ok: true, items: [], total: 0, page: 1, pageSize: 100 });
    const api = createProjectDictionaryPreloadApi(invoke);
    await expect(
      api.listProjectDictionaries({ ...request, projectId: '../escape' }),
    ).rejects.toThrow();
    expect(invoke).not.toHaveBeenCalled();
    await expect(api.listProjectDictionaries(request)).resolves.toMatchObject({ ok: true });
    expect(invoke).toHaveBeenCalledWith(IPC.PROJECT_DICTIONARY_LIST, request);
    invoke.mockResolvedValueOnce({
      ok: true,
      items: [],
      total: 0,
      page: 1,
      pageSize: 100,
      token: 'forbidden',
    });
    await expect(api.listProjectDictionaries(request)).rejects.toThrow();
  });
});
