import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AgentService, VerifiedWebhookDelivery } from "@seal-harness/core";
import { DefaultWebhookRuntime } from "../src/index.js";

const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => { for (const dispose of cleanup.splice(0).reverse()) await dispose(); });

describe("DefaultWebhookRuntime", () => {
  it("snapshots deliveries, dispatches matching rules, and creates a fresh root Session", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "seal-webhook-"));
    cleanup.push(() => rm(cwd, { recursive: true, force: true }));
    const prompt = vi.fn(async () => ({
      sessionId: "session-webhook", runId: "run-webhook",
      result: Promise.resolve({ session: {}, runtime: { stopReason: "stop", messages: [] } }),
      abort() {}, steer() {}, followUp() {}, async *[Symbol.asyncIterator]() {},
    }));
    const runtime = new DefaultWebhookRuntime({ prompt, fork: vi.fn() } as unknown as AgentService, { defaultModel: { provider: "test", model: "model" } });
    const seen: VerifiedWebhookDelivery[] = [];
    runtime.register({ id: "rule", kind: "github", async run(delivery) {
      seen.push(delivery);
      return { workspacePath: cwd, title: "Review", prompt: "Review this change" };
    } });
    runtime.register({ id: "ignored", kind: "gitlab", run: vi.fn(() => null) });
    const event = { action: "opened" };
    runtime.dispatch({ kind: "github", source: "primary", deliveryId: "d-1", event, receivedAt: 10 });
    event.action = "mutated";
    await vi.waitFor(() => expect(prompt).toHaveBeenCalledOnce());
    expect(seen[0]?.event).toEqual({ action: "opened" });
    expect(Object.isFrozen(seen[0]?.event)).toBe(true);
    expect(prompt).toHaveBeenCalledWith(expect.objectContaining({
      cwd, model: { provider: "test", model: "model" },
      metadata: expect.objectContaining({ title: "Review", "sealHarness.webhook": expect.objectContaining({ ruleId: "rule", deliveryId: "d-1" }) }),
    }));
    await runtime.dispose();
  });

  it("returns immediately and disposal aborts then drains active rules", async () => {
    const runtime = new DefaultWebhookRuntime({} as AgentService);
    let release!: () => void;
    let signal!: AbortSignal;
    const disposed = runtime.register({ id: "slow", kind: "github", run(_delivery, currentSignal) {
      signal = currentSignal;
      return new Promise<null>((resolve) => { release = () => resolve(null); });
    } });
    runtime.dispatch({ kind: "github", source: "one", deliveryId: "two", event: {}, receivedAt: 1 });
    await vi.waitFor(() => expect(signal).toBeDefined());
    const draining = disposed();
    expect(signal.aborted).toBe(true);
    release();
    await draining;
  });

  it("rejects duplicate rules and malformed or lossy deliveries", () => {
    const runtime = new DefaultWebhookRuntime({} as AgentService);
    runtime.register({ id: "same", kind: "github", run: () => null });
    expect(() => runtime.register({ id: "same", kind: "github", run: () => null })).toThrow("already registered");
    expect(() => runtime.dispatch({ kind: "github", source: "one", deliveryId: "two", event: { bad: undefined } as never, receivedAt: 1 })).toThrow("lossless JSON");
  });
});
