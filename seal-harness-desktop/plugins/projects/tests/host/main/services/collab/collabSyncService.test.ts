import { describe, expect, it, vi } from 'vitest';

import type { ProjectEvent } from '../../../../../stratex/shared/protocol/project-collab.js';
import { CollabSyncService, type CollabStreamHandlers } from '../../../../../stratex/main/services/collab/collabSyncService.js';

const PROJECT_ID = '11111111-1111-4111-8111-111111111111';

interface StreamRecord {
  readonly handlers: CollabStreamHandlers;
  readonly start: ReturnType<typeof vi.fn<(after?: number | null) => void>>;
  readonly stop: ReturnType<typeof vi.fn<() => void>>;
}

interface IntervalRecord {
  readonly callback: () => void;
  readonly intervalMs: number;
  readonly id: number;
}

function harness(): {
  readonly service: CollabSyncService;
  readonly streams: StreamRecord[];
  readonly published: ProjectEvent[];
  readonly intervals: IntervalRecord[];
  readonly cancelled: number[];
} {
  const streams: StreamRecord[] = [];
  const published: ProjectEvent[] = [];
  const intervals: IntervalRecord[] = [];
  const cancelled: number[] = [];
  let nextTimerId = 1;
  const service = new CollabSyncService({
    createStream: (handlers) => {
      const record: StreamRecord = {
        handlers,
        start: vi.fn<(after?: number | null) => void>(),
        stop: vi.fn<() => void>(),
      };
      streams.push(record);
      return {
        start: (after?: number | null) => {
          record.start(after);
        },
        stop: () => {
          record.stop();
        },
      };
    },
    publish: (event) => published.push(event),
    schedule: (callback, intervalMs) => {
      const id = nextTimerId;
      nextTimerId += 1;
      intervals.push({ callback, intervalMs, id });
      return id as unknown as ReturnType<typeof setInterval>;
    },
    cancel: (timer) => cancelled.push(timer as unknown as number),
  });
  return { service, streams, published, intervals, cancelled };
}

function lastInterval(intervals: readonly IntervalRecord[]): IntervalRecord {
  const last = intervals[intervals.length - 1];
  if (!last) throw new Error('no interval armed');
  return last;
}

describe('CollabSyncService', () => {
  it('start：建流（冷启动游标）+ 广播 degraded + 兜底 60s；幂等', () => {
    const h = harness();
    h.service.start();
    h.service.start();
    expect(h.streams).toHaveLength(1);
    // ⛔ 不是 0：0 是合法游标＝要求服务端全量重放整条事件日志（G-7）。
    expect(h.streams[0]!.start).toHaveBeenCalledWith(null);
    expect(h.published).toEqual([{ kind: 'connection', payload: { state: 'degraded' } }]);
    expect(lastInterval(h.intervals).intervalMs).toBe(60_000);
  });

  it('流上线：广播 online、兜底节拍换 5 分钟；掉线换回 60s + degraded', () => {
    const h = harness();
    h.service.start();
    h.streams[0]!.handlers.onUp();
    expect(h.published[1]).toEqual({ kind: 'connection', payload: { state: 'online' } });
    expect(lastInterval(h.intervals).intervalMs).toBe(300_000);
    // 换节拍时旧定时器被取消。
    expect(h.cancelled).toContain(h.intervals[0]!.id);
    h.streams[0]!.handlers.onDown();
    expect(h.published[2]).toEqual({ kind: 'connection', payload: { state: 'degraded' } });
    expect(lastInterval(h.intervals).intervalMs).toBe(60_000);
  });

  it('域事件帧组装为 ProjectEventSchema 帧后广播；坏 projectId 被拦下', () => {
    const h = harness();
    h.service.start();
    h.streams[0]!.handlers.onFrame({
      eventId: 7,
      projectId: PROJECT_ID,
      type: 'todo.changed',
      payload: { todo_id: 'x' },
    });
    expect(h.published[1]).toEqual({
      kind: 'todo.changed',
      projectId: PROJECT_ID,
      payload: { todo_id: 'x' },
    });
    const before = h.published.length;
    h.streams[0]!.handlers.onFrame({
      eventId: 8,
      projectId: 'not-a-uuid',
      type: 'todo.changed',
      payload: null,
    });
    expect(h.published.length).toBe(before);
  });

  it('定向草案帧 todo.draft 原样投影广播（渲染层据此重取草案面、自动开审阅窗）', () => {
    const h = harness();
    h.service.start();
    h.streams[0]!.handlers.onFrame({
      eventId: 9,
      projectId: PROJECT_ID,
      type: 'todo.draft',
      payload: { batch_id: 'b', source_todo_id: 't', draft_count: 3, actor_subject: 's' },
    });
    expect(h.published.at(-1)).toEqual({
      kind: 'todo.draft',
      projectId: PROJECT_ID,
      payload: { batch_id: 'b', source_todo_id: 't', draft_count: 3, actor_subject: 's' },
    });
  });

  it('payload 为 undefined 时投影为 null（z.json() 拒 undefined）', () => {
    const h = harness();
    h.service.start();
    h.streams[0]!.handlers.onFrame({
      eventId: 9,
      projectId: PROJECT_ID,
      type: 'member.changed',
      payload: undefined,
    });
    expect(h.published[1]).toEqual({
      kind: 'member.changed',
      projectId: PROJECT_ID,
      payload: null,
    });
  });

  it('resync：广播 degraded（渲染层据此重取权威数据），帧本体不外传', () => {
    const h = harness();
    h.service.start();
    h.streams[0]!.handlers.onResync();
    expect(h.published[1]).toEqual({ kind: 'connection', payload: { state: 'degraded' } });
  });

  it('兜底节拍每拍广播当前连接态', () => {
    const h = harness();
    h.service.start();
    lastInterval(h.intervals).callback();
    expect(h.published[1]).toEqual({ kind: 'connection', payload: { state: 'degraded' } });
    h.streams[0]!.handlers.onUp();
    lastInterval(h.intervals).callback();
    expect(h.published[3]).toEqual({ kind: 'connection', payload: { state: 'online' } });
  });

  it('restart（authEpoch 变化）：停旧流、新建流走冷启动游标、广播 degraded', () => {
    const h = harness();
    h.service.start();
    h.streams[0]!.handlers.onUp();
    h.service.restart();
    expect(h.streams).toHaveLength(2);
    expect(h.streams[0]!.stop).toHaveBeenCalledTimes(1);
    expect(h.streams[1]!.start).toHaveBeenCalledWith(null);
    expect(h.published[h.published.length - 1]).toEqual({
      kind: 'connection',
      payload: { state: 'degraded' },
    });
    // 重建后连接态回 degraded ⇒ 兜底节拍回 60s。
    expect(lastInterval(h.intervals).intervalMs).toBe(60_000);
  });

  it('未启动时 restart 等价于 start（调用方无需区分首启与重建）', () => {
    const h = harness();
    h.service.restart();
    expect(h.streams).toHaveLength(1);
    expect(h.published).toEqual([{ kind: 'connection', payload: { state: 'degraded' } }]);
  });

  it('stop：停流、停定时器、广播 offline；幂等；停后流回调不再广播', () => {
    const h = harness();
    h.service.start();
    const armed = lastInterval(h.intervals).id;
    h.service.stop();
    h.service.stop();
    expect(h.streams[0]!.stop).toHaveBeenCalledTimes(1);
    expect(h.cancelled).toContain(armed);
    expect(h.published[h.published.length - 1]).toEqual({
      kind: 'connection',
      payload: { state: 'offline' },
    });
    const before = h.published.length;
    // 已停止后迟到的 onDown 不再广播（拒绝停机后的幽灵帧）。
    h.streams[0]!.handlers.onDown();
    expect(h.published.length).toBe(before);
  });

  it('publish 抛错不拖垮同步循环（窗口销毁竞态）', () => {
    const streams: StreamRecord[] = [];
    const service = new CollabSyncService({
      createStream: (handlers) => {
        const record: StreamRecord = {
          handlers,
          start: vi.fn<(after?: number | null) => void>(),
          stop: vi.fn<() => void>(),
        };
        streams.push(record);
        return {
          start: (after?: number | null) => {
            record.start(after);
          },
          stop: () => {
            record.stop();
          },
        };
      },
      publish: () => {
        throw new Error('window destroyed');
      },
      schedule: () => 0 as unknown as ReturnType<typeof setInterval>,
      cancel: () => undefined,
    });
    expect(() => service.start()).not.toThrow();
    expect(() =>
      streams[0]!.handlers.onFrame({
        eventId: 1,
        projectId: PROJECT_ID,
        type: 'chat.message',
        payload: {},
      }),
    ).not.toThrow();
  });
});
