import {
  KernelStateError,
  MissingProvidedServiceError,
  PluginStartError,
  UndeclaredServiceError,
} from "./errors.js";
import { EventBus } from "./event-bus.js";
import { resolveProfile, type ResolvedPlugin } from "./profile.js";
import { ServiceRegistry } from "./service-registry.js";
import type { ServiceToken } from "./token.js";
import type {
  AnyPluginSpec,
  Disposer,
  EventMap,
  KernelOptions,
  KernelState,
  PluginContext,
} from "./types.js";

interface ActivePlugin<TEvents extends EventMap> {
  readonly definition: ResolvedPlugin<TEvents>;
  readonly abortController: AbortController;
  readonly effects: Disposer[];
  pluginDisposer?: Disposer;
}

export class Kernel<TEvents extends EventMap = EventMap> {
  readonly #events = new EventBus<TEvents>();
  readonly #services = new ServiceRegistry();
  readonly #initialTokens: ServiceToken<unknown>[] = [];
  readonly #active: ActivePlugin<TEvents>[] = [];
  #state: KernelState = "idle";

  constructor(options: KernelOptions = {}) {
    for (const [token, service] of options.initialServices ?? []) {
      this.#services.provide("$kernel", token, service);
      this.#initialTokens.push(token);
    }
  }

  get state(): KernelState {
    return this.#state;
  }

  has<T>(token: ServiceToken<T>): boolean {
    return this.#services.has(token);
  }

  use<T>(token: ServiceToken<T>): T {
    return this.#services.get(token);
  }

  async emit<K extends keyof TEvents & string>(event: K, payload: TEvents[K]): Promise<void> {
    await this.#events.emit(event, payload);
  }

  async start(specs: readonly AnyPluginSpec<TEvents>[]): Promise<void> {
    if (this.#state !== "idle") {
      throw new KernelStateError(`Cannot start kernel while state is ${this.#state}`);
    }

    this.#state = "starting";
    let currentPluginId = "$profile";
    try {
      const ordered = resolveProfile(specs, this.#initialTokens);
      for (const definition of ordered) {
        currentPluginId = definition.id;
        await this.#startPlugin(definition);
      }
      this.#state = "running";
    } catch (cause) {
      await this.#disposeAll();
      this.#state = "failed";
      if (cause instanceof PluginStartError) throw cause;
      throw new PluginStartError(currentPluginId, { cause });
    }
  }

  async stop(): Promise<void> {
    if (this.#state === "stopped") return;
    if (this.#state === "idle") {
      this.#state = "stopped";
      return;
    }
    if (this.#state !== "running" && this.#state !== "failed") {
      throw new KernelStateError(`Cannot stop kernel while state is ${this.#state}`);
    }

    this.#state = "stopping";
    const errors = await this.#disposeAll();
    this.#state = "stopped";
    if (errors.length > 0) {
      throw new AggregateError(errors, "One or more plugins failed to stop cleanly");
    }
  }

  async #startPlugin(definition: ResolvedPlugin<TEvents>): Promise<void> {
    const abortController = new AbortController();
    const active: ActivePlugin<TEvents> = {
      definition,
      abortController,
      effects: [],
    };
    this.#active.push(active);

    const declared = new Set((definition.spec.plugin.provides ?? []).map((token) => token.id));
    const context: PluginContext<TEvents> = {
      instanceId: definition.id,
      signal: abortController.signal,
      has: (token) => this.#services.has(token),
      use: (token) => this.#services.get(token, definition.id),
      provide: (token, service) => {
        if (!declared.has(token.id)) {
          throw new UndeclaredServiceError(definition.id, token);
        }
        const dispose = this.#services.provide(definition.id, token, service);
        return this.#addEffect(active, dispose);
      },
      on: (event, handler) => {
        const dispose = this.#events.on(definition.id, event, handler);
        return this.#addEffect(active, dispose);
      },
      emit: (event, payload) => this.#events.emit(event, payload),
      effect: (disposer) => this.#addEffect(active, disposer),
    };

    try {
      const pluginDisposer = await definition.spec.plugin.setup(
        context,
        definition.spec.config,
      );
      if (pluginDisposer !== undefined) active.pluginDisposer = pluginDisposer;

      for (const token of definition.spec.plugin.provides ?? []) {
        if (this.#services.ownerOf(token) !== definition.id) {
          throw new MissingProvidedServiceError(definition.id, token);
        }
      }
    } catch (cause) {
      const cleanupErrors = await this.#disposePlugin(active);
      this.#active.pop();
      if (cleanupErrors.length > 0) {
        throw new PluginStartError(definition.id, {
          cause: new AggregateError([cause, ...cleanupErrors], `Plugin ${definition.id} failed and cleanup also failed`),
        });
      }
      throw new PluginStartError(definition.id, { cause });
    }
  }

  #addEffect(active: ActivePlugin<TEvents>, disposer: Disposer): Disposer {
    let pending = true;
    const guarded: Disposer = async () => {
      if (!pending) return;
      pending = false;
      await disposer();
    };
    active.effects.push(guarded);
    return guarded;
  }

  async #disposeAll(): Promise<unknown[]> {
    const errors: unknown[] = [];
    while (this.#active.length > 0) {
      const active = this.#active.pop();
      if (active !== undefined) errors.push(...(await this.#disposePlugin(active)));
    }
    return errors;
  }

  async #disposePlugin(active: ActivePlugin<TEvents>): Promise<unknown[]> {
    const errors: unknown[] = [];
    active.abortController.abort(new Error(`Plugin stopping: ${active.definition.id}`));

    while (active.effects.length > 0) {
      const dispose = active.effects.pop();
      if (dispose === undefined) continue;
      try {
        await dispose();
      } catch (error) {
        errors.push(error);
      }
    }

    this.#events.removeOwner(active.definition.id);
    if (active.pluginDisposer !== undefined) {
      try {
        await active.pluginDisposer();
      } catch (error) {
        errors.push(error);
      }
    }
    return errors;
  }
}
