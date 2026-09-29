import { AsyncLocalStorage } from 'node:async_hooks';
import { EventEmitter } from 'node:events';
import { CollabClient } from '../../stratex/main/services/collab/collabClient.js';
import { CollabPlanningClient } from '../../stratex/main/services/collab/collabPlanningClient.js';
import { CollabTestingClient } from '../../stratex/main/services/collab/collabTestingClient.js';
import { CollabDictionaryClient } from '../../stratex/main/services/collab/collabDictionaryClient.js';
import { CollabDataSourceClient } from '../../stratex/main/services/collab/collabDataSourceClient.js';

export interface ProjectIdentity {
  getSession(): { accountId: string; epoch: number; accessToken: string; subject: string } | null;
  refreshSession(): Promise<void>;
  getAccessToken(): Promise<string>;
  subscribe(listener: () => void): () => void;
}
export interface ProjectAccount { accountKey: string; authEpoch: number; subject: string }
export interface ProjectRequestContext {
  readonly signal: AbortSignal;
  readonly sender: ProjectSender;
}
export type ProjectHandler = (event: ProjectRequestContext, payload: unknown) => Promise<unknown>;
export type ProjectEventListener = (channel: string, payload: unknown) => void;

/** 同一个认证 operator 的业务事件端口；不依赖 Electron IPC。 */
class ProjectSender extends EventEmitter {
  private destroyed = false;
  constructor(readonly send: ProjectEventListener) { super(); }
  isDestroyed() { return this.destroyed; }
  destroy() { this.destroyed = true; this.emit('destroyed'); this.removeAllListeners(); }
}

export class ProjectService {
  readonly clients;
  private readonly configured: boolean;
  private readonly handlers = new Map<string, ProjectHandler>();
  private readonly listeners = new Set<ProjectEventListener>();
  private readonly requests = new AsyncLocalStorage<ProjectRequestContext>();
  private accountAbort = new AbortController();
  private account: ProjectAccount | null;
  private sender = new ProjectSender((channel, payload) => this.emit(channel, payload));
  private readonly unsubscribeIdentity: () => void;

  constructor(private readonly identity: ProjectIdentity, baseUrl: string, fetchImpl: typeof fetch = fetch) {
    this.configured = Boolean(baseUrl);
    this.account = this.getAccount();
    const accountFetch: typeof fetch = async (input, init) => {
      const request = this.requests.getStore();
      const signal = AbortSignal.any([this.accountAbort.signal, ...(init?.signal ? [init.signal] : []),
        ...(request ? [request.signal] : [])]);
      const response = await fetchImpl(input, { ...init, signal });
      signal.throwIfAborted();
      return response;
    };
    // 客户端构造需要合法 URL；未配置时只用于注册通道，invoke 会在网络请求前明确拒绝。
    const options = { baseUrl: baseUrl || 'http://127.0.0.1:1/', fetchImpl: accountFetch };
    this.clients = {
      client: new CollabClient(options), planning: new CollabPlanningClient(options),
      testing: new CollabTestingClient(options), dictionaries: new CollabDictionaryClient(options),
      dataSources: new CollabDataSourceClient(options),
    };
    this.unsubscribeIdentity = identity.subscribe(() => {
      const next = this.getAccount();
      if (next?.accountKey === this.account?.accountKey && next?.authEpoch === this.account?.authEpoch) return;
      this.accountAbort.abort();
      this.accountAbort = new AbortController();
      this.sender.destroy();
      this.sender = new ProjectSender((channel, payload) => this.emit(channel, payload));
      this.account = next;
    });
  }

  get signal(): AbortSignal { return this.accountAbort.signal; }

  getAccount(): ProjectAccount | null {
    const session = this.identity.getSession();
    return session ? { accountKey: session.accountId, authEpoch: session.epoch, subject: session.subject } : null;
  }

  async accessToken(): Promise<string | null> {
    if (!this.configured) throw new Error('未配置项目协作服务，请在 services.yml 中设置 collaborationBaseUrl。');
    const before = this.getAccount();
    if (!before) return null;
    const token = await this.identity.getAccessToken();
    const session = this.identity.getSession();
    if (!session || session.accountId !== before.accountKey || session.epoch !== before.authEpoch) return null;
    return token;
  }

  register(channel: string, handler: ProjectHandler): () => void {
    if (this.handlers.has(channel)) throw new Error(`项目通道重复注册：${channel}`);
    this.handlers.set(channel, handler);
    return () => { if (this.handlers.get(channel) === handler) this.handlers.delete(channel); };
  }
  async withSignal<T>(signal: AbortSignal, operation: () => Promise<T>): Promise<T> {
    const context = { signal: AbortSignal.any([signal, this.accountAbort.signal]), sender: this.sender };
    context.signal.throwIfAborted();
    const result = await this.requests.run(context, operation);
    context.signal.throwIfAborted();
    return result;
  }
  async invoke(channel: string, payload: unknown, signal: AbortSignal): Promise<unknown> {
    if (!this.configured) throw new Error('未配置项目协作服务，请在 services.yml 中设置 collaborationBaseUrl。');
    const handler = this.handlers.get(channel);
    if (!handler) throw new Error('未知项目操作');
    const context = { signal: AbortSignal.any([signal, this.accountAbort.signal]), sender: this.sender };
    context.signal.throwIfAborted();
    const result = await this.requests.run(context, () => handler(context, payload));
    context.signal.throwIfAborted();
    return result;
  }
  emit(channel: string, payload: unknown): void {
    for (const listener of this.listeners) listener(channel, payload);
  }
  subscribe(listener: ProjectEventListener): () => void {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }
  dispose(): void {
    this.unsubscribeIdentity(); this.accountAbort.abort(); this.sender.destroy();
    this.handlers.clear(); this.listeners.clear();
  }
}
