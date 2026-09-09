import { randomUUID } from "node:crypto";
import type { AuthEvent, AuthPrompt, AuthType, Models } from "@earendil-works/pi-ai";

export class PiLoginFlows {
  private readonly flows = new Map<string, {
    provider: string; controller: AbortController; state: "pending" | "complete" | "failed" | "cancelled";
    events: AuthEvent[]; prompt?: Omit<AuthPrompt, "signal"> & { id: string };
    answer?: (value: string) => void; timer: ReturnType<typeof setTimeout>;
  }>();
  constructor(private readonly models: () => Models) {}
  start(provider: string, type: AuthType): string {
    if (this.flows.size >= 16) throw new Error("Too many login attempts");
    if (!this.models().getProvider(provider)) throw new Error("Unknown provider");
    for (const [id, flow] of this.flows) if (flow.provider === provider) this.cancel(id);
    const id = randomUUID(); const controller = new AbortController();
    const flow: (typeof this.flows extends Map<string, infer V> ? V : never) = {
      provider, controller, state: "pending", events: [],
      timer: setTimeout(() => this.cancel(id), 10 * 60_000),
    };
    flow.timer.unref(); this.flows.set(id, flow);
    void this.models().login(provider, type, {
      signal: controller.signal,
      notify: event => { if (!controller.signal.aborted) flow.events = [...flow.events.slice(-19), event]; },
      prompt: request => new Promise<string>((resolve, reject) => {
        const { signal, ...safe } = request;
        const cleanup = () => { controller.signal.removeEventListener("abort", abort); signal?.removeEventListener("abort", abort); delete flow.answer; delete flow.prompt; };
        const abort = () => { cleanup(); reject(new Error("Login prompt cancelled")); };
        if (controller.signal.aborted || signal?.aborted) { abort(); return; }
        flow.prompt = { ...safe, id: randomUUID() };
        flow.answer = value => { cleanup(); resolve(value); };
        controller.signal.addEventListener("abort", abort, { once: true }); signal?.addEventListener("abort", abort, { once: true });
      }),
    }).then(() => { if (!controller.signal.aborted) flow.state = "complete"; },
      () => { if (!controller.signal.aborted) flow.state = "failed"; });
    return id;
  }
  read(id: string) {
    const flow = this.flows.get(id); if (!flow) throw new Error("Login attempt expired");
    return { provider: flow.provider, state: flow.state, events: flow.events, ...(flow.prompt ? { prompt: flow.prompt } : {}) };
  }
  answer(id: string, promptId: string, value: string) {
    const flow = this.flows.get(id);
    if (!flow?.answer || flow.prompt?.id !== promptId) throw new Error("Login prompt expired");
    flow.answer(value);
  }
  cancel(id: string) { const flow = this.flows.get(id); if (!flow) return; flow.state = "cancelled"; flow.controller.abort(); clearTimeout(flow.timer); this.flows.delete(id); }
  close() { for (const id of this.flows.keys()) this.cancel(id); }
  cancelProvider(provider: string) { for (const [id, flow] of this.flows) if (flow.provider === provider) this.cancel(id); }
}
