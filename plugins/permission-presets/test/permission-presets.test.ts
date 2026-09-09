import { describe, expect, it } from "vitest";
import { sessionId } from "@seal-harness/core";
import { MemorySessionStore } from "@seal-harness/session-memory";
import { DefaultCommandService } from "@seal-harness/commands";
import { DurablePermissionPresetService } from "../src/index.js";

describe("permission presets", () => {
  it("pins all permission facts and preserves a matching selected bundle", async () => { const sessions = new MemorySessionStore(); const id = sessionId("s"); const created = await sessions.create({ id, cwd: "/w" }); const service = new DurablePermissionPresetService(sessions); const initialized = await service.initialize(created); expect(initialized.events.slice(-3).map((entry) => entry.event.type)).toEqual(["permission.preset", "sandbox.mode", "approval.policy"]); expect(await service.current(id)).toBe("workspace-write"); await service.set(id, "danger-full-access"); expect(await service.current(id)).toBe("danger-full-access"); expect((await service.select(id)).currentValue).toBe("danger-full-access"); });
  it("exposes the read and switch path as /permission", async () => { const sessions = new MemorySessionStore(); const id = sessionId("s"); await sessions.create({ id, cwd: "/w" }); const service = new DurablePermissionPresetService(sessions); await service.initialize((await sessions.read(id))!); const commands = new DefaultCommandService(sessions); commands.register({ name: "permission", description: "permission", handler: async ({ sessionId, rawInput }) => rawInput.trim() === "" ? { kind: "success", text: await service.current(sessionId) } : { kind: "success", text: await service.set(sessionId, rawInput.trim()) } }); expect((await commands.execute(id, "/permission danger-full-access"))?.result).toMatchObject({ kind: "success", text: "danger-full-access" }); });
});
