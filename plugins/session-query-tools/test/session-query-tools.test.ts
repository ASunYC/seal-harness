import { sessionId, text, type JsonObject, type SessionEvent, type SessionId, type SessionStore, type ToolDefinition } from "@seal-harness/core";
import { MemorySessionStore } from "@seal-harness/session-memory";
import { describe, expect, it } from "vitest";
import { createSessionQueryTools } from "../src/index.js";

describe("session query tools", () => {
  it("searches only prior Sessions in the caller workspace with Session and event filters", async () => {
    const store = new MemorySessionStore(clock());
    const root = await create(store, "root", "/work", message("old needle"));
    const child = await fork(store, root, "child");
    await append(store, child, message("child needle"));
    await create(store, "elsewhere", "/other", message("secret needle"));
    const caller = await create(store, "caller", "/work", message("caller needle"));
    const tools = createSessionQueryTools(store);

    const all = await run(tools, "session_search", caller, "/work", { query: "needle" });
    expect(all.items.map((item: any) => item.session.id)).toEqual(["child", "root"]);
    expect(all.items.some((item: any) => item.session.id === "elsewhere")).toBe(false);

    const filtered = await run(tools, "session_search", caller, "/work", {
      query: "needle", parent_session_ids: ["root"], event_types: ["message.appended"], event_surfaces: ["current"],
    });
    expect(filtered.items.map((item: any) => item.session.id)).toEqual(["child"]);
    const liveOnly = await run(tools, "session_search", caller, "/work", { query: "needle", availability: ["live"] });
    expect(liveOnly.items).toEqual([]);
  });

  it("maps compacted messages to shadowed/current surfaces and reads exact neighbors", async () => {
    const store = new MemorySessionStore(clock());
    let session = await create(store, "history", "/work", message("first needle"), message("kept needle"));
    session = await append(store, session, { type: "context.compacted", payload: { summaryMessage: { role: "assistant", content: [text("summary needle")] }, sourceMessageCount: 2, retainedMessageCount: 1 } });
    const tools = createSessionQueryTools(store, { maxNeighborEvents: 2 });
    const search = await run(tools, "session_event_search", session, "/work", { query: "needle", surfaces: ["shadowed"] });
    expect(search.items).toHaveLength(1);
    expect(search.items[0].seq).toBe(2);
    const read = await run(tools, "session_event_read", session, "/work", { seq: 3, before: 1, after: 1 });
    expect(read.event.event.type).toBe("message.appended");
    expect(read.before).toHaveLength(1); expect(read.after).toHaveLength(1);
    await expect(run(tools, "session_event_read", session, "/work", { seq: 3, before: 3 })).rejects.toThrow("before must be <= 2");
  });

  it("returns complete lineage and event identifier relationships without Agent activation", async () => {
    const memory = new MemorySessionStore(clock()); let reads = 0; let lists = 0;
    const store: SessionStore = { ...memory, create: request => memory.create(request), append: request => memory.append(request), fork: request => memory.fork(request), read: id => { reads += 1; return memory.read(id); }, list: () => { lists += 1; return memory.list(); } };
    const root = await create(store, "root", "/work"); const child = await fork(store, root, "child"); const grandchild = await fork(store, child, "grandchild");
    const runId = "run-1" as never; const turnId = "turn-1" as never;
    let updated = await append(store, grandchild, { type: "run.started", payload: { runId, model: { provider: "test", model: "m" } } });
    updated = await append(store, updated, { type: "turn.started", payload: { runId, turnId } });
    const tools = createSessionQueryTools(store);
    const trace = await run(tools, "session_trace", updated, "/work", {});
    expect(trace.ancestors.map((item: any) => item.id)).toEqual(["child", "root"]);
    const rootTrace = await run(tools, "session_trace", updated, "/work", { session_id: "root" });
    expect(rootTrace.descendants.map((item: any) => item.id)).toEqual(["grandchild", "child"]);
    const eventTrace = await run(tools, "session_event_trace", updated, "/work", { seq: updated.version - 1 });
    expect(eventTrace.related.map((item: any) => item.type)).toContain("turn.started");
    expect(reads).toBeGreaterThan(0); expect(lists).toBeGreaterThan(0);
  });

  it("rejects cross-workspace reads and invalid ranges", async () => {
    const store = new MemorySessionStore(clock()); const caller = await create(store, "caller", "/work"); await create(store, "other", "/other"); const tools = createSessionQueryTools(store);
    await expect(run(tools, "session_trace", caller, "/work", { session_id: "other" })).rejects.toThrow("not found in caller workspace");
    await expect(run(tools, "session_search", caller, "/work", { query: "x", event_seq_from: 2, event_seq_to: 1 })).rejects.toThrow("must be <=");
  });
});

function message(value: string): SessionEvent { return { type: "message.appended", payload: { messageId: `message-${value}` as never, message: { role: "user", content: [text(value)] } } }; }
async function create(store: SessionStore, id: string, cwd: string, ...events: SessionEvent[]) { let value = await store.create({ id: sessionId(id), cwd }); if (events.length > 0) value = await store.append({ id: value.id, expectedVersion: value.version, events }); return value; }
async function fork(store: SessionStore, source: { id: SessionId }, id: string) { return store.fork({ sourceId: source.id, targetId: sessionId(id) }); }
async function append(store: SessionStore, session: { id: SessionId; version: number }, ...events: SessionEvent[]) { return store.append({ id: session.id, expectedVersion: session.version, events }); }
async function run(tools: ToolDefinition[], name: string, session: { id: SessionId }, cwd: string, input: JsonObject): Promise<any> { const tool = tools.find(value => value.name === name)!; const output = await tool.execute(input, { callId: "call" as never, sessionId: session.id, cwd, signal: new AbortController().signal, reportProgress() {} }); return output.details; }
function clock() { let time = Date.parse("2026-01-01T00:00:00.000Z"); return () => new Date(time += 1000); }
