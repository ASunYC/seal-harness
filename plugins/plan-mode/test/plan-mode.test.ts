import { sessionId } from "@seal-harness/core";
import { MemorySessionStore } from "@seal-harness/session-memory";
import { describe, expect, it } from "vitest";
import { SessionPlanModeService, resolveConfig } from "../src/index.js";

describe("SessionPlanModeService", () => {
  it("persists mode, restores it, and carries it into forks", async () => {
    const store = new MemorySessionStore(); const parent = sessionId("parent"); await store.create({ id: parent, cwd: "/work" });
    const service = new SessionPlanModeService(store);
    expect(await service.get(parent)).toEqual({ active: false });
    expect(await service.set(parent, true)).toEqual({ active: true });
    expect(await new SessionPlanModeService(store).get(parent)).toEqual({ active: true });
    const child = sessionId("child"); await store.fork({ sourceId: parent, targetId: child });
    expect(await service.get(child)).toEqual({ active: true });
    expect(await service.set(child, false)).toEqual({ active: false });
    expect(await service.get(parent)).toEqual({ active: true });
  });

  it("rejects blank and unknown configuration", () => {
    expect(() => resolveConfig({ section: "" })).toThrow("non-empty");
    expect(() => resolveConfig({ section: "plan", extra: true } as never)).toThrow("unknown key");
  });
});
