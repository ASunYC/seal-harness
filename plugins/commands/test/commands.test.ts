import { describe, expect, it } from "vitest";
import { sessionId } from "@seal-harness/core";
import { MemorySessionStore } from "@seal-harness/session-memory";
import { DefaultCommandService, parseCommand } from "../src/index.js";
describe("commands", () => {
  it("preserves raw input and logs paired lifecycle events", async () => { const sessions = new MemorySessionStore(); const id = sessionId("s"); await sessions.create({ id, cwd: "/w" }); const service = new DefaultCommandService(sessions, () => "1"); service.register({ name: "echo", description: "Echo", handler: ({ rawInput }) => ({ kind: "success", text: rawInput }) }); await expect(service.execute(id, "/echo  hello")).resolves.toEqual({ commandId: "command-1", result: { kind: "success", text: "  hello" } }); expect((await sessions.read(id))!.events.slice(-2).map((entry) => entry.event.type)).toEqual(["command.run", "command.done"]); });
  it("contains thrown handlers and ignores noncommands", async () => { const sessions = new MemorySessionStore(); const id = sessionId("s"); await sessions.create({ id, cwd: "/w" }); const service = new DefaultCommandService(sessions); service.register({ name: "bad", description: "Bad", handler() { throw new Error("broken"); } }); await expect(service.execute(id, "/bad")).resolves.toMatchObject({ result: { kind: "error", text: "broken" } }); await expect(service.execute(id, "hello")).resolves.toBeUndefined(); expect(parseCommand("/Bad")).toBeUndefined(); });
});
