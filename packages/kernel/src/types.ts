import type { ServiceToken } from "./token.js";

export type Awaitable<T> = T | PromiseLike<T>;
export type Disposer = () => Awaitable<void>;
export type EventMap = object;

export type EventHandler<TPayload> = (payload: TPayload) => Awaitable<void>;

export interface PluginContext<TEvents extends EventMap = EventMap> {
  readonly instanceId: string;
  readonly signal: AbortSignal;

  has<T>(token: ServiceToken<T>): boolean;
  use<T>(token: ServiceToken<T>): T;
  provide<T>(token: ServiceToken<T>, service: T): Disposer;

  on<K extends keyof TEvents & string>(event: K, handler: EventHandler<TEvents[K]>): Disposer;
  emit<K extends keyof TEvents & string>(event: K, payload: TEvents[K]): Promise<void>;

  effect(disposer: Disposer): Disposer;
}

export interface PluginDefinition<
  TConfig = undefined,
  TEvents extends EventMap = EventMap,
> {
  readonly name: string;
  readonly provides?: readonly ServiceToken<unknown>[];
  readonly requires?: readonly ServiceToken<unknown>[];
  readonly optional?: readonly ServiceToken<unknown>[];
  setup(context: PluginContext<TEvents>, config: TConfig): Awaitable<void | Disposer>;
}

export interface PluginSpec<
  TConfig = unknown,
  TEvents extends EventMap = EventMap,
> {
  readonly id?: string;
  readonly plugin: PluginDefinition<TConfig, TEvents>;
  readonly config: TConfig;
  readonly enabled?: boolean;
}

export type AnyPluginSpec<TEvents extends EventMap = EventMap> = PluginSpec<unknown, TEvents>;

export interface KernelOptions {
  readonly initialServices?: ReadonlyArray<readonly [ServiceToken<unknown>, unknown]>;
}

export type KernelState = "idle" | "starting" | "running" | "stopping" | "stopped" | "failed";
