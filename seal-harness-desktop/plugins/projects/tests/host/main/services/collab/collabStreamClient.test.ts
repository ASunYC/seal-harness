import { describe, expect, it, vi } from 'vitest';

import { PROJECT_DOMAIN_EVENT_KINDS } from '../../../../../stratex/shared/protocol/project-collab.js';

import {
  COLLAB_STREAM_DOMAIN_EVENT_TYPES,
  CollabStreamClient,
  type CollabStreamFrame,
} from '../../../../../stratex/main/services/collab/collabStreamClient.js';

const PROJECT_ID = '11111111-1111-4111-8111-111111111111';

function sseBody(...frames: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const frame of frames) controller.enqueue(encoder.encode(frame));
      controller.close();
    },
  });
}

function sseResponse(...frames: string[]): Response {
  return new Response(sseBody(...frames), {
    status: 200,
    headers: { 'content-type': 'text/event-stream' },
  });
}

function domainFrame(eventId: number, type = 'chat.message'): string {
  return `data: ${JSON.stringify({
    event_id: eventId,
    project_id: PROJECT_ID,
    type,
    payload: { seq: eventId },
  })}\n\n`;
}

interface Scheduled {
  readonly callback: () => void;
  readonly delayMs: number;
}

/** 手动步进的假定时器：schedule 只入队，测试自己触发；cancel 记录调用。 */
function fakeTimers(): {
  readonly scheduled: Scheduled[];
  readonly schedule: (callback: () => void, delayMs: number) => ReturnType<typeof setTimeout>;
  readonly cancel: ReturnType<typeof vi.fn>;
  readonly fireNext: () => void;
} {
  const scheduled: Scheduled[] = [];
  return {
    scheduled,
    schedule: (callback, delayMs) => {
      scheduled.push({ callback, delayMs });
      return 0 as unknown as ReturnType<typeof setTimeout>;
    },
    cancel: vi.fn(),
    fireNext: () => {
      const next = scheduled[scheduled.length - 1];
      if (!next) throw new Error('nothing scheduled');
      next.callback();
    },
  };
}

async function until(predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 400; attempt += 1) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error('condition not reached');
}

interface Harness {
  readonly client: CollabStreamClient;
  readonly frames: CollabStreamFrame[];
  readonly resyncs: number[];
  readonly ups: number[];
  readonly downs: number[];
  readonly fetchCalls: URL[];
  readonly timers: ReturnType<typeof fakeTimers>;
}

function harness(responses: Array<() => Response | 'reject'>): Harness {
  const frames: CollabStreamFrame[] = [];
  const resyncs: number[] = [];
  const ups: number[] = [];
  const downs: number[] = [];
  const fetchCalls: URL[] = [];
  const timers = fakeTimers();
  const queue = [...responses];
  const client = new CollabStreamClient({
    baseUrl: 'http://collab.test:1/',
    accessToken: async () => 'token',
    onFrame: (frame) => frames.push(frame),
    onResync: () => resyncs.push(Date.now()),
    onUp: () => ups.push(Date.now()),
    onDown: () => downs.push(Date.now()),
    fetchImpl: (async (input: unknown) => {
      fetchCalls.push(input as URL);
      const next = queue.shift();
      if (!next) throw new TypeError('no more responses');
      const value = next();
      if (value === 'reject') throw new TypeError('fetch failed');
      return value;
    }) as typeof fetch,
    schedule: timers.schedule,
    cancel: timers.cancel as unknown as (timer: ReturnType<typeof setTimeout>) => void,
    random: () => 0.5, // 抖动因子 (0.5 + 0.5) = 1.0，退避序列可精确断言
  });
  return { client, frames, resyncs, ups, downs, fetchCalls, timers };
}

describe('CollabStreamClient', () => {
  it('消费域事件帧并推进 after 游标；重连自动带最新游标', async () => {
    const h = harness([
      () => sseResponse(domainFrame(1), ':keepalive\n\n', domainFrame(5)),
      () => sseResponse(),
    ]);
    h.client.start(0);
    await until(() => h.frames.length === 2 && h.downs.length === 1);
    expect(h.ups).toHaveLength(1);
    expect(h.frames[0]).toEqual({
      eventId: 1,
      projectId: PROJECT_ID,
      type: 'chat.message',
      payload: { seq: 1 },
    });
    // 显式传 0 时仍原样带上（0 是合法游标＝「从头重放」，语义不被偷改）。
    expect(h.fetchCalls[0]!.searchParams.get('after')).toBe('0');
    // 第一段流正常结束 → 退避归位为 1s，重连带上最新游标 5。
    await until(() => h.timers.scheduled.length === 1);
    expect(h.timers.scheduled[0]!.delayMs).toBe(1_000);
    h.timers.fireNext();
    await until(() => h.fetchCalls.length === 2);
    expect(h.fetchCalls[1]!.searchParams.get('after')).toBe('5');
    h.client.stop();
  });

  // -- G-7 冷启动游标 -------------------------------------------------------

  it('冷启动（缺省游标）不带 after 参数——服务端据此只播新事件', async () => {
    const h = harness([() => sseResponse()]);
    h.client.start();
    await until(() => h.fetchCalls.length === 1);
    expect(h.fetchCalls[0]!.searchParams.has('after')).toBe(false);
    h.client.stop();
  });

  it('冷启动后收帧 → 重连带 after 续传（不再回冷启动）', async () => {
    const h = harness([() => sseResponse(domainFrame(41)), () => sseResponse()]);
    h.client.start();
    await until(() => h.frames.length === 1 && h.timers.scheduled.length === 1);
    expect(h.fetchCalls[0]!.searchParams.has('after')).toBe(false);
    h.timers.fireNext();
    await until(() => h.fetchCalls.length === 2);
    expect(h.fetchCalls[1]!.searchParams.get('after')).toBe('41');
    h.client.stop();
  });

  it('游标过旧收到 resync → 游标退回冷启动，重连不再带过旧 after（不打转）', async () => {
    const h = harness([() => sseResponse('data: {"type":"resync"}\n\n'), () => sseResponse()]);
    h.client.start(7);
    await until(() => h.resyncs.length === 1 && h.timers.scheduled.length === 1);
    expect(h.fetchCalls[0]!.searchParams.get('after')).toBe('7');
    h.timers.fireNext();
    await until(() => h.fetchCalls.length === 2);
    expect(h.fetchCalls[1]!.searchParams.has('after')).toBe(false);
    h.client.stop();
  });

  it('resync 之后本段流继续收帧 → 新游标从该帧起续传', async () => {
    const h = harness([
      () => sseResponse('data: {"type":"resync"}\n\n', domainFrame(88)),
      () => sseResponse(),
    ]);
    h.client.start(3);
    await until(() => h.resyncs.length === 1 && h.frames.length === 1);
    await until(() => h.timers.scheduled.length === 1);
    h.timers.fireNext();
    await until(() => h.fetchCalls.length === 2);
    expect(h.fetchCalls[1]!.searchParams.get('after')).toBe('88');
    h.client.stop();
  });

  it('请求形态：GET /api/v1/stream、accept 事件流、Bearer 令牌', async () => {
    const captured: RequestInit[] = [];
    const timers = fakeTimers();
    const client = new CollabStreamClient({
      baseUrl: 'http://collab.test:1/',
      accessToken: async () => 'token',
      onFrame: () => undefined,
      onResync: () => undefined,
      fetchImpl: (async (input: unknown, init?: RequestInit) => {
        captured.push(init ?? {});
        expect((input as URL).pathname).toBe('/api/v1/stream');
        return sseResponse();
      }) as typeof fetch,
      schedule: timers.schedule,
      cancel: timers.cancel as unknown as (timer: ReturnType<typeof setTimeout>) => void,
      random: () => 0.5,
    });
    client.start();
    await until(() => captured.length === 1);
    const headers = captured[0]!.headers as Record<string, string>;
    expect(headers.accept).toBe('text/event-stream');
    expect(headers.authorization).toBe('Bearer token');
    expect(captured[0]!.method).toBe('GET');
    client.stop();
  });

  it('⛔ 线上帧白名单＝共享协议域事件全集，不得手抄漏项（todo.draft 曾被漏掉）', () => {
    expect([...COLLAB_STREAM_DOMAIN_EVENT_TYPES]).toEqual([...PROJECT_DOMAIN_EVENT_KINDS]);
    expect(COLLAB_STREAM_DOMAIN_EVENT_TYPES).toContain('todo.draft');
  });

  it('定向草案帧 todo.draft 进 onFrame 且推进游标（2026-09-04 前被当坏帧丢弃）', async () => {
    const h = harness([() => sseResponse(domainFrame(11, 'todo.draft'))]);
    h.client.start();
    await until(() => h.frames.length === 1 && h.downs.length === 1);
    expect(h.frames[0]).toEqual({
      eventId: 11,
      projectId: PROJECT_ID,
      type: 'todo.draft',
      payload: { seq: 11 },
    });
    await until(() => h.timers.scheduled.length === 1);
    h.timers.fireNext();
    await until(() => h.fetchCalls.length === 2);
    expect(h.fetchCalls[1]!.searchParams.get('after')).toBe('11');
    h.client.stop();
  });

  it('resync 帧走专线回调，不进 onFrame；坏帧静默丢弃', async () => {
    const h = harness([
      () =>
        sseResponse(
          'data: {"type":"resync"}\n\n',
          'data: {"event_id":2,"project_id":"not-a-uuid-but-string","type":"chat.message"}\n\n',
          'data: {"event_id":"bad","project_id":"x","type":"chat.message"}\n\n',
          'data: {"event_id":3,"project_id":"p","type":"unknown.type"}\n\n',
        ),
    ]);
    h.client.start();
    await until(() => h.resyncs.length === 1 && h.downs.length === 1);
    // 线上帧只校验形状（uuid 收口在同步服务组装 ProjectEventSchema 时）——
    // event_id 非数值 / type 出闭集的帧在此已被丢弃。
    expect(h.frames).toHaveLength(1);
    expect(h.frames[0]!.eventId).toBe(2);
    h.client.stop();
  });

  it('连接失败按指数退避（1s→2s→4s，抖动因子钉 1.0），成功一次后归位', async () => {
    const h = harness([
      () => new Response(null, { status: 503 }),
      () => 'reject' as const,
      () => new Response(null, { status: 500 }),
      () => sseResponse(domainFrame(9)),
      () => 'reject' as const,
    ]);
    h.client.start();
    await until(() => h.timers.scheduled.length === 1);
    expect(h.timers.scheduled[0]!.delayMs).toBe(1_000);
    h.timers.fireNext();
    await until(() => h.timers.scheduled.length === 2);
    expect(h.timers.scheduled[1]!.delayMs).toBe(2_000);
    h.timers.fireNext();
    await until(() => h.timers.scheduled.length === 3);
    expect(h.timers.scheduled[2]!.delayMs).toBe(4_000);
    h.timers.fireNext();
    await until(() => h.frames.length === 1 && h.timers.scheduled.length === 4);
    // 成功会话后退避归位。
    expect(h.timers.scheduled[3]!.delayMs).toBe(1_000);
    h.client.stop();
  });

  it('退避封顶 30s', async () => {
    const responses: Array<() => Response | 'reject'> = [];
    for (let index = 0; index < 8; index += 1) responses.push(() => 'reject' as const);
    const h = harness(responses);
    h.client.start();
    for (let index = 0; index < 7; index += 1) {
      await until(() => h.timers.scheduled.length === index + 1);
      h.timers.fireNext();
    }
    await until(() => h.timers.scheduled.length === 8);
    const delays = h.timers.scheduled.map((entry) => entry.delayMs);
    expect(delays).toEqual([1_000, 2_000, 4_000, 8_000, 16_000, 30_000, 30_000, 30_000]);
    h.client.stop();
  });

  it('拿不到令牌：不发请求，按退避重试', async () => {
    const frames: CollabStreamFrame[] = [];
    const timers = fakeTimers();
    const fetchSpy = vi.fn();
    const client = new CollabStreamClient({
      baseUrl: 'http://collab.test:1/',
      accessToken: async () => null,
      onFrame: (frame) => frames.push(frame),
      onResync: () => undefined,
      fetchImpl: fetchSpy as unknown as typeof fetch,
      schedule: timers.schedule,
      cancel: timers.cancel as unknown as (timer: ReturnType<typeof setTimeout>) => void,
      random: () => 0.5,
    });
    client.start();
    await until(() => timers.scheduled.length === 1);
    expect(fetchSpy).not.toHaveBeenCalled();
    client.stop();
  });

  it('stop()：取消挂起的重连等待（幂等），不再发起新连接', async () => {
    const h = harness([() => 'reject' as const, () => 'reject' as const]);
    h.client.start();
    await until(() => h.timers.scheduled.length === 1);
    h.client.stop();
    h.client.stop();
    expect(h.timers.cancel).toHaveBeenCalledTimes(1);
    const callsBefore = h.fetchCalls.length;
    // 已取消的等待即便被误触发也不再连接（running 已置 false）。
    h.timers.fireNext();
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(h.fetchCalls.length).toBe(callsBefore);
  });

  it('start 幂等：运行中重复 start 不开第二条循环', async () => {
    const h = harness([() => sseResponse(domainFrame(1)), () => 'reject' as const]);
    h.client.start(0);
    h.client.start(0);
    await until(() => h.frames.length === 1);
    await until(() => h.timers.scheduled.length === 1);
    expect(h.fetchCalls).toHaveLength(1);
    h.client.stop();
  });
});
