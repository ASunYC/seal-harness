import {
  runtimeToken,
  type AgentMessage,
  type AgentRun,
  type AgentRuntime,
  type SealHarnessEvents,
  type RuntimeEvent,
  type RuntimeResult,
  type RuntimeStartRequest,
} from "@seal-harness/core";
import { definePlugin } from "@seal-harness/kernel";

export interface ScriptedRuntimeOutput {
  readonly events: readonly RuntimeEvent[];
  readonly result: RuntimeResult;
}

export interface ScriptedRuntimeConfig {
  readonly execute: (
    request: RuntimeStartRequest,
    signal: AbortSignal,
  ) => ScriptedRuntimeOutput | Promise<ScriptedRuntimeOutput>;
}

export class ScriptedRuntime implements AgentRuntime {
  constructor(readonly config: ScriptedRuntimeConfig) {}

  start(request: RuntimeStartRequest): AgentRun {
    return new ScriptedRun(request, this.config);
  }
}

class ScriptedRun implements AgentRun {
  readonly #listeners = new Set<(event: RuntimeEvent) => void | Promise<void>>();
  readonly #queue: RuntimeEvent[] = [];
  readonly #waiting: Array<(result: IteratorResult<RuntimeEvent>) => void> = [];
  readonly #abortController = new AbortController();
  #closed = false;
  readonly result: Promise<RuntimeResult>;

  constructor(
    readonly request: RuntimeStartRequest,
    config: ScriptedRuntimeConfig,
  ) {
    if (request.signal?.aborted === true) this.#abortController.abort(request.signal.reason);
    else request.signal?.addEventListener("abort", () => this.abort(request.signal?.reason), { once: true });
    this.result = new Promise((resolve, reject) => {
      queueMicrotask(() => {
        this.#execute(config).then(resolve, reject);
      });
    });
  }

  subscribe(listener: (event: RuntimeEvent) => void | Promise<void>): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  abort(reason?: unknown): void {
    if (!this.#abortController.signal.aborted) this.#abortController.abort(reason);
  }

  steer(_message: AgentMessage): void {}
  followUp(_message: AgentMessage): void {}

  async *[Symbol.asyncIterator](): AsyncIterator<RuntimeEvent> {
    while (true) {
      const queued = this.#queue.shift();
      if (queued !== undefined) {
        yield queued;
        continue;
      }
      if (this.#closed) return;
      const next = await new Promise<IteratorResult<RuntimeEvent>>((resolve) => this.#waiting.push(resolve));
      if (next.done) return;
      yield next.value;
    }
  }

  async #execute(config: ScriptedRuntimeConfig): Promise<RuntimeResult> {
    try {
      this.#abortController.signal.throwIfAborted();
      const output = await config.execute(this.request, this.#abortController.signal);
      for (const event of output.events) {
        this.#abortController.signal.throwIfAborted();
        await this.#publish(event);
      }
      return output.result;
    } catch (error) {
      if (this.#abortController.signal.aborted) {
        await this.#publish({ type: "run_end", stopReason: "aborted" });
        return {
          messages: this.request.messages,
          stopReason: "aborted",
          errorMessage: error instanceof Error ? error.message : String(error),
        };
      }
      throw error;
    } finally {
      this.#close();
    }
  }

  async #publish(event: RuntimeEvent): Promise<void> {
    for (const listener of this.#listeners) await listener(event);
    const waiter = this.#waiting.shift();
    if (waiter === undefined) this.#queue.push(event);
    else waiter({ value: event, done: false });
  }

  #close(): void {
    this.#closed = true;
    for (const waiter of this.#waiting.splice(0)) {
      waiter({ value: undefined, done: true });
    }
  }
}

export const scriptedRuntimePlugin = definePlugin<ScriptedRuntimeConfig, SealHarnessEvents>({
  name: "runtime-scripted",
  provides: [runtimeToken],
  setup(context, config) {
    context.provide(runtimeToken, new ScriptedRuntime(config));
  },
});
