import {
  ProjectEventSchema,
  type ProjectConnectionState,
  type ProjectEvent,
} from '../../../shared/protocol/project-collab.js';
import type { CollabStreamFrame } from './collabStreamClient.js';

/**
 * 项目组协作的同步编排：账号在线时保持一条事件流订阅 + 一只兜底定时器，
 * 把服务端域事件与本地连接状态组装成 `ProjectEventSchema` 帧，经注入的
 * `publish(payload)` 广播给渲染层（只发 main 窗的过滤在装配层，照
 * `register.ts` 的 AUTH_STATE_CHANGED 推送形态）。
 *
 * 状态语义（MVP 无本地投影库，重启后渲染层自行重新水合）：
 *  - `online`   事件流已建立——增量靠推送，兜底定时器 5 分钟一拍确认活性。
 *  - `degraded` 事件流断开但仍在重连——兜底定时器 60 秒一拍，渲染层收到
 *    degraded 帧即应重取所打开视图的权威数据（`resync` 同样走这条路）。
 *  - `offline`  已停止（登出/退出）。
 *
 * authEpoch 变化（换账号/重登）→ `restart()`：断流、清连接态、**冷启动**重建，
 * 旧账号的事件不会串进新账号（流客户端逐次连接都拿新令牌）。
 *
 * 【游标归属】续传游标住在流客户端里，随收帧推进、**跨重连保留**（断线重连从上次
 * 收到的事件号继续，游标过旧时服务端回 resync）。本服务只在两处显式把它退回冷启动：
 * `restart()`（换账号——旧账号游标对新账号毫无意义）与 `stop()`（下线）。
 * ⛔ 冷启动**不是** `start(0)`：0 是合法游标，服务端据此全量重放整条事件日志，
 * 且它只在 `after > 0` 时才判 resync ⇒ 那条分支在生产路径永远走不到。
 *
 * 定时器与流工厂全部可注入；定时器 `.unref()`，不阻退出。
 */

export interface CollabStreamHandle {
  /** 缺省/null＝冷启动（服务端从当前最大事件号起播）；给数字＝从该游标续传。 */
  start(after?: number | null): void;
  stop(): void;
}

export interface CollabStreamHandlers {
  readonly onFrame: (frame: CollabStreamFrame) => void;
  readonly onResync: () => void;
  readonly onUp: () => void;
  readonly onDown: () => void;
}

/** SSE 在线时的兜底心跳（确认活性 + 给渲染层一个校对时机）。 */
const DEFAULT_ONLINE_TICK_MS = 5 * 60 * 1_000;
/** SSE 断开时的兜底节拍（渲染层收 degraded 帧即重取权威数据）。 */
const DEFAULT_DEGRADED_TICK_MS = 60 * 1_000;

export interface CollabSyncServiceOptions {
  /** 建一条新事件流（每次重建都新建实例，游标从冷启动位起）。 */
  readonly createStream: (handlers: CollabStreamHandlers) => CollabStreamHandle;
  /** 广播出口（装配层负责只发 main 窗）。 */
  readonly publish: (event: ProjectEvent) => void;
  readonly schedule?: (callback: () => void, intervalMs: number) => ReturnType<typeof setInterval>;
  readonly cancel?: (timer: ReturnType<typeof setInterval>) => void;
  readonly onlineTickMs?: number;
  readonly degradedTickMs?: number;
}

export class CollabSyncService {
  private readonly createStream: CollabSyncServiceOptions['createStream'];
  private readonly publish: CollabSyncServiceOptions['publish'];
  private readonly schedule: NonNullable<CollabSyncServiceOptions['schedule']>;
  private readonly cancel: NonNullable<CollabSyncServiceOptions['cancel']>;
  private readonly onlineTickMs: number;
  private readonly degradedTickMs: number;

  private started = false;
  private streamOnline = false;
  private stream: CollabStreamHandle | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(options: CollabSyncServiceOptions) {
    this.createStream = options.createStream;
    this.publish = options.publish;
    this.schedule = options.schedule ?? setInterval;
    this.cancel = options.cancel ?? clearInterval;
    this.onlineTickMs = options.onlineTickMs ?? DEFAULT_ONLINE_TICK_MS;
    this.degradedTickMs = options.degradedTickMs ?? DEFAULT_DEGRADED_TICK_MS;
  }

  /** 幂等启动：建流 + 兜底定时器；初始连接态 degraded（流建立后转 online）。 */
  start(): void {
    if (this.started) return;
    this.started = true;
    this.streamOnline = false;
    this.openStream();
    this.publishConnection('degraded');
    this.armTimer();
  }

  /** 幂等停止：停流、停定时器、广播 offline。 */
  stop(): void {
    if (!this.started) return;
    this.started = false;
    this.closeStream();
    this.disarmTimer();
    this.streamOnline = false;
    this.publishConnection('offline');
  }

  /**
   * 断流清态重建（authEpoch 变化 / 换账号）。未启动时等价于 start()——
   * 调用方只需在「有账号在场」时喊一声，不必区分首启与重建。
   */
  restart(): void {
    if (!this.started) {
      this.start();
      return;
    }
    this.closeStream();
    this.streamOnline = false;
    this.openStream();
    this.publishConnection('degraded');
    this.armTimer();
  }

  private openStream(): void {
    this.stream = this.createStream({
      onFrame: this.handleFrame,
      onResync: this.handleResync,
      onUp: this.handleUp,
      onDown: this.handleDown,
    });
    // 冷启动：不给游标 ⇒ 流客户端不带 `after` ⇒ 服务端从当前最大事件号起播。
    this.stream.start(null);
  }

  private closeStream(): void {
    this.stream?.stop();
    this.stream = null;
  }

  private readonly handleFrame = (frame: CollabStreamFrame): void => {
    // 服务端负载是不透明透传（有界 JSON）；组装后仍过一遍共享 schema——
    // projectId 非 uuid 等坏帧在此被拦下，不进渲染层。
    const event = ProjectEventSchema.safeParse({
      kind: frame.type,
      projectId: frame.projectId,
      payload: frame.payload ?? null,
    });
    if (event.success) this.publishSafely(event.data);
  };

  private readonly handleResync = (): void => {
    // `after` 过旧：Main 消化为「渲染层该全量重取」——广播 degraded 帧即可，
    // 渲染层对 degraded 的既定语义就是重取权威数据（resync 帧本体不外传）。
    this.publishConnection('degraded');
  };

  private readonly handleUp = (): void => {
    this.streamOnline = true;
    this.publishConnection('online');
    this.armTimer();
  };

  private readonly handleDown = (): void => {
    this.streamOnline = false;
    if (!this.started) return;
    this.publishConnection('degraded');
    this.armTimer();
  };

  /** 兜底定时器：按当前连接态选节拍；每拍广播一次连接帧（degraded 拍＝重取提示）。 */
  private armTimer(): void {
    this.disarmTimer();
    if (!this.started) return;
    const interval = this.streamOnline ? this.onlineTickMs : this.degradedTickMs;
    this.timer = this.schedule(() => {
      this.publishConnection(this.streamOnline ? 'online' : 'degraded');
    }, interval);
    (this.timer as { unref?: () => void }).unref?.();
  }

  private disarmTimer(): void {
    if (this.timer === null) return;
    this.cancel(this.timer);
    this.timer = null;
  }

  private publishConnection(state: ProjectConnectionState): void {
    const event = ProjectEventSchema.safeParse({ kind: 'connection', payload: { state } });
    if (event.success) this.publishSafely(event.data);
  }

  private publishSafely(event: ProjectEvent): void {
    try {
      this.publish(event);
    } catch {
      // 广播失败（窗口正在销毁等）不拖垮同步循环。
    }
  }
}
