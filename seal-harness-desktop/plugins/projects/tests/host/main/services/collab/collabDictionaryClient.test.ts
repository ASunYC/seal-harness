import { describe, expect, it, vi } from 'vitest';
import { CollabDictionaryClient } from '../../../../../stratex/main/services/collab/collabDictionaryClient.js';

const serviceBaseUrl = 'https://collab.example/';
const projectId = '11111111-1111-4111-8111-111111111111';
const entry = {
  id: projectId,
  name: '模块',
  archived_at: null,
  version: 1,
  creator_subject: 'member',
  created_at: 'now',
  updated_at: 'now',
};
describe('project dictionary reads', () => {
  it('uses the authenticated real paginated endpoint and projects only known fields', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          items: [{ ...entry, secret: 'discard' }],
          page: 2,
          page_size: 100,
          total: 101,
        }),
      ),
    );
    const client = new CollabDictionaryClient({ baseUrl: serviceBaseUrl, fetchImpl });
    const result = await client.list('credential', {
      projectId,
      kind: 'modules',
      page: 2,
      pageSize: 100,
    });
    expect(result).toMatchObject({
      ok: true,
      value: { items: [{ id: projectId, name: '模块', archivedAt: null }], total: 101, page: 2 },
    });
    expect(JSON.stringify(result)).not.toContain('secret');
    const call = fetchImpl.mock.calls[0];
    if (!call) throw new Error('缺少字典请求');
    const [url, init] = call;
    expect(String(url)).toBe(
      `https://collab.example/api/v1/projects/${projectId}/modules?page=2&page_size=100`,
    );
    expect(init).toMatchObject({
      method: 'GET',
      headers: { authorization: 'Bearer credential' },
      redirect: 'error',
    });
  });
  it('rejects malformed rows instead of silently dropping a dictionary option', async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        new Response(
          JSON.stringify({ items: [{ ...entry, name: '' }], page: 1, page_size: 100, total: 1 }),
        ),
      );
    const client = new CollabDictionaryClient({ baseUrl: serviceBaseUrl, fetchImpl });
    expect(
      await client.list('credential', { projectId, kind: 'categories', page: 1, pageSize: 100 }),
    ).toEqual({ ok: false, code: 'transient' });
  });
  it('propagates authorization failures', async () => {
    const client = new CollabDictionaryClient({
      baseUrl: serviceBaseUrl,
      fetchImpl: vi.fn<typeof fetch>().mockResolvedValue(new Response('{}', { status: 403 })),
    });
    expect(
      await client.list('credential', { projectId, kind: 'modules', page: 1, pageSize: 100 }),
    ).toMatchObject({ ok: false, code: 'forbidden' });
  });
});
