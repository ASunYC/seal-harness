import { describe, expect, it, vi } from 'vitest';
import { CollabWorkOverviewClient } from '../../../../../stratex/main/services/collab/collabWorkOverviewClient.js';

const TEST_BASE_URL = 'https://collab.test/';
const TEST_SERVICE_URL = 'https://collab.test/service/';

const projectId = '11111111-1111-4111-8111-111111111111';
const todoId = '22222222-2222-4222-8222-222222222222';
const wireTodo = {
  id: todoId,
  project_id: projectId,
  item_kind: 'requirement',
  parent_id: null,
  title: '原需求',
  status: 'notStarted',
  source: 'manual',
  visibility: 'shared',
  assignee_kind: 'member',
  assignee_subject: 'alice',
  assignee_display_name: '爱丽丝',
  priority: 'medium',
  labels: [],
  due_at: null,
  description: '',
  version: 1,
  created_at: '2026-09-15T00:00:00Z',
  updated_at: '2026-09-15T00:00:00Z',
};
const wire = {
  counts: { overdue: 0, due_today: 1, incomplete: 1, participating: 0 },
  total: 1,
  items: [wireTodo],
  next_cursor: null,
};
function setup(body: unknown = wire, status = 200) {
  const fetchImpl = vi
    .fn<typeof fetch>()
    .mockResolvedValue(new Response(JSON.stringify(body), { status }));
  return {
    fetchImpl,
    client: new CollabWorkOverviewClient({ baseUrl: TEST_SERVICE_URL, fetchImpl }),
  };
}

describe('工作概览 HTTP', () => {
  it('映射原对象、独立总数和今日桶，参数只含项目与分组', async () => {
    const { client, fetchImpl } = setup();
    expect(
      await client.readWorkOverview('secret', {
        projectId,
        group: 'due_today',
        limit: 2,
        cursor: 'cursor+/=',
      }),
    ).toMatchObject({
      ok: true,
      value: {
        counts: { dueToday: 1 },
        total: 1,
        items: [{ id: todoId, projectId, title: '原需求' }],
        nextCursor: null,
      },
    });
    const url = new URL(String(fetchImpl.mock.calls[0]?.[0]));
    expect(url.pathname).toBe(`/service/api/v1/projects/${projectId}/work-overview`);
    expect(url.searchParams.get('cursor')).toBe('cursor+/=');
    expect(fetchImpl.mock.calls[0]?.[1]?.headers).toEqual({ authorization: 'Bearer secret' });
  });
  it('空集合合法', async () => {
    const { client } = setup({
      counts: { overdue: 0, due_today: 0, incomplete: 0, participating: 0 },
      total: 0,
      items: [],
      next_cursor: null,
    });
    expect(await client.readWorkOverview('t', { projectId })).toMatchObject({
      ok: true,
      value: { total: 0, items: [] },
    });
  });
  it.each([
    { ...wire, items: [{ ...wireTodo, project_id: '33333333-3333-4333-8333-333333333333' }] },
    { ...wire, items: [wireTodo, wireTodo] },
    { ...wire, total: -1 },
    { ...wire, next_cursor: '' },
    { ...wire, unexpected: 'private' },
    { ...wire, items: [{ ...wireTodo, title: null }] },
  ])('拒绝不可信响应 %#', async (body) => {
    expect(await setup(body).client.readWorkOverview('t', { projectId })).toEqual({
      ok: false,
      code: 'transient',
    });
  });
  it('拒绝超出请求页长或重复游标', async () => {
    const body = { ...wire, next_cursor: 'same' };
    expect(await setup(body).client.readWorkOverview('t', { projectId, cursor: 'same' })).toEqual({
      ok: false,
      code: 'transient',
    });
  });
  it('失败只返回代码，不回显正文', async () => {
    const result = await setup(
      { error: 'invalid_cursor', message: 'private secret' },
      400,
    ).client.readWorkOverview('t', { projectId });
    expect(result.ok).toBe(false);
    expect(JSON.stringify(result)).not.toContain('private');
  });
  it('非法请求不发网络，超大响应拒绝', async () => {
    const { client, fetchImpl } = setup();
    expect(await client.readWorkOverview('t', { projectId: 'bad' })).toEqual({
      ok: false,
      code: 'invalidRequest',
    });
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(
      await setup({
        ...wire,
        items: [{ ...wireTodo, description: 'x'.repeat(70_000) }],
      }).client.readWorkOverview('t', { projectId }),
    ).toEqual({ ok: false, code: 'transient' });
  });
  it('响应流超过64KiB立即取消，UTF-8按字节计数', async () => {
    const cancel = vi.fn();
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('中'.repeat(23_000)));
      },
      cancel,
    });
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(new Response(body));
    const client = new CollabWorkOverviewClient({ baseUrl: TEST_BASE_URL, fetchImpl });
    expect(await client.readWorkOverview('t', { projectId })).toEqual({
      ok: false,
      code: 'transient',
    });
    expect(cancel).toHaveBeenCalledOnce();
  });
  it('非JSON的401仍判登录失效，不回显正文', async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response('private upstream', { status: 401 }));
    const client = new CollabWorkOverviewClient({ baseUrl: TEST_BASE_URL, fetchImpl });
    expect(await client.readWorkOverview('t', { projectId })).toMatchObject({
      ok: false,
      code: 'credentialRejected',
    });
  });
  it.each([false, true])(
    '未结束响应流含非法UTF-8即取消读取，清理失败=%s仍返回统一transient',
    async (cleanupFails) => {
      const cancel = vi.fn(() =>
        cleanupFails ? Promise.reject(new Error('private cleanup error')) : Promise.resolve(),
      );
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new Uint8Array([0xff]));
          // 刻意保持流开放：解码失败也必须释放传输资源。
        },
        cancel,
      });
      const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(new Response(body));
      const client = new CollabWorkOverviewClient({ baseUrl: TEST_BASE_URL, fetchImpl });
      expect(await client.readWorkOverview('t', { projectId })).toEqual({
        ok: false,
        code: 'transient',
      });
      expect(cancel).toHaveBeenCalledOnce();
      expect(body.locked).toBe(false);
    },
  );
  it('超时终止请求并返回可恢复失败', async () => {
    vi.useFakeTimers();
    try {
      const fetchImpl = vi.fn<typeof fetch>().mockImplementation(
        (_url, init) =>
          new Promise((_resolve, reject) => {
            init?.signal?.addEventListener('abort', () => reject(new Error('abort')), {
              once: true,
            });
          }),
      );
      const client = new CollabWorkOverviewClient({
        baseUrl: 'https://collab.test/',
        fetchImpl,
        timeoutMs: 10,
      });
      const pending = client.readWorkOverview('t', { projectId });
      await vi.advanceTimersByTimeAsync(10);
      expect(await pending).toEqual({ ok: false, code: 'transient' });
    } finally {
      vi.useRealTimers();
    }
  });
});
