import { describe, expect, it } from "vitest";
import { messageId, runId, sessionId, text, type ToolDefinition } from "@seal-harness/core";
import { ContextRegistry } from "@seal-harness/context-core";
import { BasicPolicyService } from "@seal-harness/policy-basic";
import { MemorySessionStore } from "@seal-harness/session-memory";
import { PolicyToolService } from "@seal-harness/tools-core";
import { DurableAgentPresetService } from "../src/index.js";

const tool = (name: string): ToolDefinition => ({ name, description: name, inputSchema: { type: "object", additionalProperties: false }, classify: () => ({ kind: "tool", toolName: name, risk: "read", summary: name }), execute: async () => ({ content: [text(name)] }) });
function harness() { const sessions = new MemorySessionStore(); const tools = new PolicyToolService(new BasicPolicyService(), undefined, async () => {}); for (const name of ["read_file", "replace_text", "write_file", "terminal_start", "terminal_send", "terminal_read", "terminal_list", "terminal_kill"]) tools.register(tool(name)); const contexts = new ContextRegistry("base"); const presets = new DurableAgentPresetService(sessions, tools, contexts); return { sessions, tools, contexts, presets }; }

describe("agent presets", () => {
  it("pins a preset, composes prompt, and restricts only global tools", async () => { const { sessions, tools, contexts, presets } = harness(); const id = sessionId("s"); const created = await sessions.create({ id, cwd: "/w" }); await presets.set(id, "minimal"); await presets.initialize(created); expect(await presets.current(id)).toBe("minimal"); expect(tools.definitions(id).map((definition) => definition.name)).not.toContain("write_file"); const prepared = await contexts.prepare({ sessionId: id, cwd: "/w", history: [], prompt: [text("go")], signal: new AbortController().signal }); expect(prepared.systemPrompt).toContain("minimal coding agent"); });
  it("refuses switching after a Session starts and reconstructs selection", async () => { const { sessions, tools, presets } = harness(); const id = sessionId("s"); let snapshot = await sessions.create({ id, cwd: "/w" }); snapshot = await presets.initialize(snapshot); snapshot = await sessions.append({ id, expectedVersion: snapshot.version, events: [{ type: "run.started", payload: { runId: runId("r"), model: { provider: "p", model: "m" } } }, { type: "message.appended", payload: { messageId: messageId("m"), message: { role: "user", content: [text("go")] } } }] }); await expect(presets.set(id, "minimal")).rejects.toThrow("already started"); const restored = new DurableAgentPresetService(sessions, tools, new ContextRegistry(), { default: "minimal" }); expect(await restored.current(id)).toBe("standard"); });
  it("delegates authoritative presets before context collection without leaking the native prompt", async () => {
    const { sessions, contexts, presets } = harness(); const id = sessionId("external");
    const prepared: string[] = [];
    presets.registerAuthority({
      async resolve(preset) { return ["standard", "cordis"].includes(preset) ? { id: preset, name: `DSH ${preset}`, isDefault: preset === "standard" } : undefined; },
      async prepare(session, preset) { prepared.push(`${session.id}:${preset}`); },
    });
    const created = await sessions.create({ id, cwd: "/w" });
    await presets.set(id, "cordis");
    await presets.initialize(created);
    expect(prepared).toEqual(["external:cordis"]);
    const context = await contexts.prepare({ sessionId: id, cwd: "/w", history: [], prompt: [text("go")], signal: new AbortController().signal });
    expect(context.systemPrompt).not.toContain("full coding agent");
    const sameId = sessionId("external-standard"); const sameCreated = await sessions.create({ id: sameId, cwd: "/w" });
    await presets.initialize(sameCreated);
    expect(prepared).toContain("external-standard:standard");
    const sameContext = await contexts.prepare({ sessionId: sameId, cwd: "/w", history: [], prompt: [text("go")], signal: new AbortController().signal });
    expect(sameContext.systemPrompt).not.toContain("full coding agent");
    await expect(presets.validate("missing")).rejects.toThrow("unknown agent preset");
  });
  it("returns the authoritative Session snapshot after an external preset prepares it", async () => {
    const { sessions, presets } = harness(); const id = sessionId("external-refresh");
    presets.registerAuthority({
      async resolve(preset) { return preset === "standard" ? { id: preset, name: "DSH Standard", isDefault: true } : undefined; },
      async prepare(session) {
        await sessions.append({ id: session.id, expectedVersion: session.version, events: [{ type: "session.metadata", payload: { patch: { preparedByDsh: true } } }] });
      },
    });
    const created = await sessions.create({ id, cwd: "/w" });
    const initialized = await presets.initialize(created);
    expect(initialized.version).toBe(3);
    expect(initialized.events.at(-1)?.event).toEqual({ type: "session.metadata", payload: { patch: { preparedByDsh: true } } });
    expect(initialized).toEqual(await sessions.read(id));
  });
});
