import { z } from 'zod';

import { AepSseDecoder } from '../aepSseDecoder.js';

/**
 * 项目组协作服务的事件流客户端：流式 GET `/api/v1/stream?after=<event_id>`，
 * `accept: text/event-stream`，复用 `AepSseDecoder`（勿复制）解帧。
 *
 *  - 每帧是单行 JSON `{"event_id","project_id","type","payload"}`；`type` 域事件闭集
 *    之外只认 `resync`（专线回调，帧本体不外传）。坏帧丢弃、协议错误断流重连。
 *  - `after` 游标由本客户端随收帧自动推进；重连自动带上最新游标。
 *  - **冷启动不带 `after`**（游标 null ⇒ 查询串里没有这个参数）：服务端对
 *    「缺省 after」的语义是「只播新事件，从当前 max 起」，对 `after=0` 的语义
 *    却是「从头重放整条事件日志」。历史上这里硬写 0，于是每次冷启动都全量重放，
 *    且服务端只在 `after > 0` 才判 resync ⇒ resync 分支在生产路径从不触发。
 *  - 断流指数退避重连：1s 起、上限 30s、乘性抖动（0.5x–1.5x）；一次成功连接后归位。
 *  - `stop()` 中止当前连接与挂起的重连等待（幂等）。
 *
 * 【凭据】令牌逐次通过注入的 `accessToken()` 取得（重连拿新令牌），只进
 * `Authorization` 头，不记录、不打印。【白标】注释与标识符一律中性词。
 */

import { PROJECT_DOMAIN_EVENT_KINDS } from '../../../shared/protocol/project-collab.js';

/**
 * 线上帧的类型闭集＝共享协议的域事件全集。⛔ 不在这里另抄一份：2026-09-04 前这里是手抄的
 * 8 项，服务端与共享协议加了 `todo.draft` 而这里没加 ⇒ 草案事件在 Main 被当坏帧丢弃，
 * 渲染层永远收不到，拆解草案的自动弹窗要切一次会话才出现。
 */
export const COLLAB_STREAM_DOMAIN_EVENT_TYPES = PROJECT_DOMAIN_EVENT_KINDS;

export type CollabStreamDomainEventType = (typeof COLLAB_STREAM_DOMAIN_EVENT_TYPES)[number];

export interface CollabStreamFrame {
  readonly eventId: number;
  readonly projectId: string;
  readonly type: CollabStreamDomainEventType;
  readonly payload: unknown;
}

const frameWireSchema = z.object({
  event_id: z.number().int().nonnegative(),
  project_id: z.string().min(1).max(256),
  type: z.enum(COLLAB_STREAM_DOMAIN_EVENT_TYPES),
  payload: z.unknown().optional(),
});

const DEFAULT_INITIAL_RETRY_MS = 1_000;
const DEFAULT_MAX_RETRY_MS = 30_000;

export interface CollabStreamClientOptions {
  /** 构建期注入并已校验的服务基地址（末尾带 `/`）。 */
  readonly baseUrl: string;
  /** 逐次连接前取令牌；null＝当前拿不到凭据（按一次失败退避重试）。 */
  readonly accessToken: () => Promise<string | null>;
  /** 域事件帧（已校验、游标已推进）。 */
  readonly onFrame: (frame: CollabStreamFrame) => void;
  /** 服务端 `resync` 帧：`after` 过旧，客户端该全量重取。 */
  readonly onResync: () => void;
  /** 连接建立（响应 OK 且是事件流）。 */
  readonly onUp?: () => void;
  /** 连接断开（仅在曾 Up 后触发一次）。 */
  readonly onDown?: () => void;
  readonly fetchImpl?: typeof fetch;
  readonly schedule?: (callback: () => void, delayMs: number) => ReturnType<typeof setTimeout>;
  readonly cancel?: (timer: ReturnType<typeof setTimeout>) => void;
  /** 抖动源（[0,1)）；测试注入定值以钉死退避序列。 */
  readonly random?: () => number;
  readonly initialRetryMs?: number;
  readonly maxRetryMs?: number;
}

export class CollabStreamClient {
  private readonly baseUrl: URL;
  private readonly accessToken: CollabStreamClientOptions['accessToken'];
  private readonly onFrame: CollabStreamClientOptions['onFrame'];
  private readonly onResync: CollabStreamClientOptions['onResync'];
  private readonly onUp: (() => void) | undefined;
  private readonly onDown: (() => void) | undefined;
  private readonly fetchImpl: typeof fetch;
  private readonly schedule: NonNullable<CollabStreamClientOptions['schedule']>;
  private readonly cancel: NonNullable<CollabStreamClientOptions['cancel']>;
  private readonly random: () => number;
  private readonly initialRetryMs: number;
  private readonly maxRetryMs: number;

  private running = false;
  /** 续传游标；null＝冷启动（不带 `after`，服务端从当前 max 起播）。 */
  private after: number | null = null;
  private retryMs: number;
  private controller: AbortController | null = null;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private pendingDelayResolve: (() => void) | null = null;

  constructor(options: CollabStreamClientOptions) {
    this.baseUrl = new URL(options.baseUrl.endsWith('/') ? options.baseUrl : `${options.baseUrl}/`);
    this.accessToken = options.accessToken;
    this.onFrame = options.onFrame;
    this.onResync = options.onResync;
    this.onUp = options.onUp;
    this.onDown = options.onDown;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.schedule = options.schedule ?? setTimeout;
    this.cancel = options.cancel ?? clearTimeout;
    this.random = options.random ?? Math.random;
    this.initialRetryMs = options.initialRetryMs ?? DEFAULT_INITIAL_RETRY_MS;
    this.maxRetryMs = options.maxRetryMs ?? DEFAULT_MAX_RETRY_MS;
    this.retryMs = this.initialRetryMs;
  }

  /**
   * 幂等启动；`after` 是初始游标。
   *
   * 缺省（或 null）＝**冷启动**：不带 `after` 查询参数，服务端从当前最大事件号起播。
   * ⛔ 别传 0 当「从头开始」——0 是合法游标，服务端会据此全量重放整条事件日志。
   */
  start(after: number | null = null): void {
    if (this.running) return;
    this.running = true;
    this.after = after;
    this.retryMs = this.initialRetryMs;
    void this.runLoop();
  }

  /** 幂等停止：中止当前连接与挂起的重连等待。 */
  stop(): void {
    if (!this.running) return;
    this.running = false;
    this.controller?.abort();
    if (this.retryTimer !== null) {
      this.cancel(this.retryTimer);
      this.retryTimer = null;
    }
    this.pendingDelayResolve?.();
  }

  private async runLoop(): Promise<void> {
    while (this.running) {
      const wasUp = await this.connectOnce();
      if (!this.running) return;
      if (wasUp) this.retryMs = this.initialRetryMs;
      await this.delay(this.nextRetryDelay());
    }
  }

  /** 单次连接与消费；返回「本次是否成功建立过连接」（决定退避是否归位）。 */
  private async connectOnce(): Promise<boolean> {
    let token: string | null;
    try {
      token = await this.accessToken();
    } catch {
      token = null;
    }
    if (!this.running || token === null) return false;
    const controller = new AbortController();
    this.controller = controller;
    let up = false;
    try {
      const url = new URL('api/v1/stream', this.baseUrl);
      // 冷启动（游标 null）**不带**这个参数——带 `after=0` 等于要求全量重放。
      if (this.after !== null) url.searchParams.set('after', String(this.after));
      const response = await this.fetchImpl(url, {
        method: 'GET',
        headers: { accept: 'text/event-stream', authorization: `Bearer ${token}` },
        signal: controller.signal,
      });
      if (!response.ok || !response.body) {
        try {
          await response.body?.cancel();
        } catch {
          /* ignore */
        }
        return false;
      }
      up = true;
      this.onUp?.();
      const decoder = new AepSseDecoder();
      const reader = response.body.getReader();
      try {
        for (;;) {
          const chunk = await reader.read();
          const frames = chunk.done ? decoder.finish() : decoder.push(chunk.value);
          for (const value of frames) this.consumeFrame(value);
          if (chunk.done || !this.running) break;
        }
      } finally {
        void reader.cancel().catch(() => undefined);
        reader.releaseLock();
      }
      return true;
    } catch {
      // 连接层/协议错误（含 AepSseProtocolError）都按断流处理，交退避重连。
      return up;
    } finally {
      this.controller = null;
      if (up) this.onDown?.();
    }
  }

  private consumeFrame(value: unknown): void {
    if (
      value !== null &&
      typeof value === 'object' &&
      (value as { type?: unknown }).type === 'resync'
    ) {
      // 服务端已判定「本游标续不上」并从当前位续播。把游标退回冷启动态：
      // 否则这条连接一旦断开，重连又会带上同一个过旧游标，永远 resync 打转。
      this.after = null;
      this.onResync();
      return;
    }
    const parsed = frameWireSchema.safeParse(value);
    if (!parsed.success) return;
    if (this.after === null || parsed.data.event_id > this.after) {
      this.after = parsed.data.event_id;
    }
    this.onFrame({
      eventId: parsed.data.event_id,
      projectId: parsed.data.project_id,
      type: parsed.data.type,
      payload: parsed.data.payload ?? null,
    });
  }

  /** 当前退避（含 0.5x–1.5x 乘性抖动），并把基值翻倍推进到上限。 */
  private nextRetryDelay(): number {
    const base = Math.min(this.retryMs, this.maxRetryMs);
    this.retryMs = Math.min(this.retryMs * 2, this.maxRetryMs);
    return Math.max(1, Math.round(base * (0.5 + this.random())));
  }

  private delay(delayMs: number): Promise<void> {
    return new Promise((resolve) => {
      const finish = (): void => {
        this.retryTimer = null;
        this.pendingDelayResolve = null;
        resolve();
      };
      this.pendingDelayResolve = finish;
      this.retryTimer = this.schedule(finish, delayMs);
      (this.retryTimer as { unref?: () => void }).unref?.();
    });
  }
}
