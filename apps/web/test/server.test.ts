import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer, request as httpRequest } from "node:http";
import { connect } from "node:net";
import { WebSocket as WsClient } from "ws";
import { afterEach, describe, expect, it, vi } from "vitest";
import { agentCorePlugin } from "@seal-harness/agent-core";
import { agentPresetsPlugin } from "@seal-harness/agent-presets";
import { localAttachmentPlugin } from "@seal-harness/attachment-local";
import { contextCorePlugin } from "@seal-harness/context-core";
import { commandsPlugin } from "@seal-harness/commands";
import { feedbackToolsPlugin } from "@seal-harness/feedback-tools";
import { goalToolsPlugin } from "@seal-harness/goal-tools";
import { permissionPresetsPlugin } from "@seal-harness/permission-presets";
import { jsonlSessionPlugin } from "@seal-harness/session-jsonl";
import {
  approvalServiceToken,
  compactionServiceToken,
  reviewServiceToken,
  policyServiceToken,
  agentServiceToken,
  attachmentServiceToken,
  credentialServiceToken,
  jobServiceToken,
  modelServiceToken,
  messageId,
  scheduleServiceToken,
  subagentServiceToken,
  terminalServiceToken,
  settingsServiceToken,
  sessionStoreToken,
  SessionConflictError,
  toolServiceToken,
  sessionId,
  text,
  toolCallId,
  webRouteServiceToken,
  type JobService,
  type ScheduleService,
  type SealHarnessEvents,
  type SubagentService,
  type TerminalService,
} from "@seal-harness/core";
import { defineProfile } from "@seal-harness/host";
import { definePlugin, plugin } from "@seal-harness/kernel";
import { scriptedModelPlugin } from "@seal-harness/model-scripted";
import { basicPolicyPlugin } from "@seal-harness/policy-basic";
import { piRuntimePlugin } from "@seal-harness/runtime-pi";
import { memorySessionPlugin } from "@seal-harness/session-memory";
import { toolsCorePlugin } from "@seal-harness/tools-core";
import { workspaceToolsPlugin } from "@seal-harness/workspace-tools";
import { WebApprovalService } from "../src/approval.js";
import { DshConnectionBridge, WebRouteRegistry } from "../src/plugin-host.js";
import { startWebServer, type RunningWebServer } from "../src/server.js";
import { dshCompatServiceToken } from "@seal-harness/dsh-compat";
import { llmCompactionPlugin } from "../../../plugins/compaction-llm/src/index.js";
import { scriptedRuntimePlugin } from "../../../plugins/runtime-scripted/src/index.js";

const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const dispose of cleanup.splice(0).reverse()) await dispose();
  delete (globalThis as any).__sealFixtureRemoteOutcome;
});

describe("Seal Harness Web server", () => {
  it("streams native PI compaction, persists its summary and restores it on the next run", async () => {
    const cwd=await mkdtemp(join(tmpdir(),'seal-llm-compaction-')); cleanup.push(()=>rm(cwd,{recursive:true,force:true}));
    let summaryCalls=0, agentCalls=0; const summarizedInputs: string[] = [];
    const server=await startWebServer({cwd,port:0,pluginHome:cwd,profile:defineProfile([
      plugin(memorySessionPlugin,{}),plugin(contextCorePlugin,{systemPrompt:'Seal compaction test'}),
      plugin(scriptedModelPlugin,{models:[{provider:'scripted',model:'summary-test',contextWindow:10000,maxOutputTokens:1000}],async *respond(request){
        if(request.systemPrompt.includes('context summarization assistant')) {
          summaryCalls++; expect(request.tools ?? []).toEqual([]);
          summarizedInputs.push(JSON.stringify(request.messages));
          yield {type:'text_delta',delta:'Preserve the project requirements.'};
        } else {
          agentCalls++; const content=JSON.stringify(request.messages);
          expect(content).toContain('Preserve the project requirements.');
          expect(content).toContain('historical-79');
          expect(content).not.toContain('historical-0');
          yield {type:'text_delta',delta:'Continued after compaction'};
        }
        yield {type:'done',stopReason:'stop'};
      }}),plugin(llmCompactionPlugin,{thresholdMessages:20,retainMessages:4,fallbackOnError:false}),plugin(piRuntimePlugin,{dataHome:cwd,compaction:{keepRecentTokens:100}}),plugin(agentCorePlugin,{})
    ])}); cleanup.push(()=>server.close());
    const store=server.kernel.use(sessionStoreToken); const id=sessionId('long-history');
    const initial=await store.create({id,cwd});
    await store.append({id,expectedVersion:initial.version,events:Array.from({length:80},(_,index)=>({
      type:'message.appended' as const,payload:{messageId:messageId(`history-${index}`),message:{role:index%2?'assistant' as const:'user' as const,content:[text(`historical-${index} ${'context '.repeat(100)}`)]}}
    }))});
    const response=await fetch(`${server.url}/api/runs`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({cwd,sessionId:id,provider:'scripted',model:'summary-test',prompt:'Continue',startupProgress:true})});
    const events=(await response.text()).trim().split('\n').map(line=>JSON.parse(line));
    expect(events.filter(event=>event.type==='event' && event.event.type==='compaction_activity').map(event=>event.event)).toMatchObject([
      {state:'started',reason:'threshold'}, {state:'finished',outcome:'completed',reason:'threshold'}
    ]);
    expect(events.at(-1)).toMatchObject({type:'completed',stopReason:'stop'});
    expect(summaryCalls).toBeGreaterThan(0); expect(agentCalls).toBe(1);
    expect(summarizedInputs.join('\n')).toContain('historical-0');
    const completedSummaryCalls = summaryCalls;
    const saved=await store.read(id);
    expect(saved!.events.filter(entry=>entry.event.type==='context.compacted')).toHaveLength(1);
    expect(JSON.stringify(saved!.events.find(entry=>entry.event.type==='context.compacted'))).toContain('Preserve the project requirements.');
    const page=await (await fetch(`${server.url}/api/sessions/${id}/messages`)).json();
    expect(JSON.stringify(page)).toContain('Preserve the project requirements.');
    const next=await fetch(`${server.url}/api/runs`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({cwd,sessionId:id,provider:'scripted',model:'summary-test',prompt:'Continue again',startupProgress:true})});
    const nextEvents=(await next.text()).trim().split('\n').map(line=>JSON.parse(line));
    expect(nextEvents.some(event=>event.type==='startup_activity')).toBe(false);
    expect(nextEvents.at(-1)).toMatchObject({type:'completed',stopReason:'stop'});
    expect(summaryCalls).toBe(completedSummaryCalls); expect(agentCalls).toBe(2);
  });
  it("preserves startup-compaction errors and cancellation for non-native runtimes", async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'seal-startup-progress-')); cleanup.push(() => rm(cwd, {recursive:true,force:true}));
    let waitForCancel = false; let cancelled = false;
    const compaction = definePlugin<{}, SealHarnessEvents>({name:'startup-compaction-fixture',provides:[compactionServiceToken],setup(ctx) {
      ctx.provide(compactionServiceToken,{async compact(request) {
        request.onProgress?.({state:'started'});
        if (waitForCancel) {
          await new Promise<void>((resolve) => { if (request.signal.aborted) resolve(); else request.signal.addEventListener('abort',()=>resolve(),{once:true}); });
          cancelled = true;
          request.onProgress?.({state:'finished',outcome:'aborted'});
          request.signal.throwIfAborted();
        }
        request.onProgress?.({state:'finished',outcome:'failed'});
        throw new Error('summary failed');
      }});
    }});
    const server = await startWebServer({cwd,host:'127.0.0.1',port:0,profile:defineProfile([
      plugin(memorySessionPlugin,{}),plugin(contextCorePlugin,{}),plugin(scriptedModelPlugin,{models:[{provider:'scripted',model:'test',contextWindow:10000,maxOutputTokens:1000}],async *respond(){yield {type:'done',stopReason:'stop'};}}),plugin(scriptedRuntimePlugin,{execute:()=>{throw new Error('Failed startup must never enter the runtime');}}),plugin(compaction,{}),plugin(agentCorePlugin,{})
    ])}); cleanup.push(()=>server.close());
    const send = (startupProgress: boolean) => fetch(`${server.url}/api/runs`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({cwd,provider:'scripted',model:'test',prompt:'hello',startupProgress})});
    const streaming = await send(true);
    expect(streaming.status).toBe(200);
    const events = (await streaming.text()).trim().split('\n').map(line=>JSON.parse(line));
    expect(events).toEqual([
      {type:'startup_activity',activity:'compaction',state:'started'},
      {type:'startup_activity',activity:'compaction',state:'finished',outcome:'failed'},
      {type:'error',error:'summary failed'},
    ]);
    const legacy = await send(false); expect(legacy.status).toBe(500);
    expect(await legacy.json()).toMatchObject({error:'summary failed'});
    waitForCancel = true;
    const controller = new AbortController();
    const pending = await fetch(`${server.url}/api/runs`,{method:'POST',signal:controller.signal,headers:{'Content-Type':'application/json'},body:JSON.stringify({cwd,provider:'scripted',model:'test',prompt:'hello',startupProgress:true})});
    const reader = pending.body!.getReader();
    expect(new TextDecoder().decode((await reader.read()).value)).toContain('startup_activity');
    controller.abort();
    await expect.poll(()=>cancelled).toBe(true);
  });
  it("persists real PI file-write evidence through the run API and server restart", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "seal-review-run-")); cleanup.push(() => rm(cwd, { recursive: true, force: true }));
    const data = await mkdtemp(join(tmpdir(), "seal-review-data-")); cleanup.push(() => rm(data, { recursive: true, force: true }));
    await writeFile(join(cwd, "review.txt"), "original\n"); let calls = 0;
    const profile = defineProfile([
      plugin(scriptedModelPlugin, { models: [{ provider: "scripted", model: "review", contextWindow: 10_000, maxOutputTokens: 1_000 }], async *respond() {
        if (calls++ === 0) { yield { type: "reasoning_delta", delta: "Inspect before writing" }; yield { type: "text_delta", delta: "Updating the file" }; yield { type: "tool_call", call: { type: "tool_call", id: toolCallId("write-review"), name: "write_file", arguments: { path: "review.txt", content: "changed\n" } } }; yield { type: "done", stopReason: "tool_call" }; }
        else { yield { type: "reasoning_delta", delta: "Verify the result" }; yield { type: "text_delta", delta: "Done" }; yield { type: "done", stopReason: "stop" }; }
      } }),
      plugin(jsonlSessionPlugin, { root: join(data, "sessions") }),
      plugin(contextCorePlugin, {}), plugin(basicPolicyPlugin, { mode: "workspace-write" }),
      plugin(toolsCorePlugin, {}), plugin(workspaceToolsPlugin, { enableShell: false, reviewRoot: join(data, "reviews") }),
      plugin(piRuntimePlugin, {}), plugin(agentCorePlugin, {}),
    ]);
    const server = await startWebServer({ cwd, port: 0, profile, pluginHome: data });
    cleanup.push(() => server.close());
    const response = await fetch(`${server.url}/api/runs`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ cwd, sessionId: "review-run", provider: "scripted", model: "review", prompt: "Update review.txt" }) });
    expect(response.status).toBe(200);
    const stream = (await response.text()).trim().split("\n").map(line => JSON.parse(line));
    const activity = stream.filter(item => item.type === "event").map(item => item.event).filter(event => ["reasoning_delta", "text_delta", "tool_call", "tool_result"].includes(event.type));
    expect(activity.map(event => event.type)).toEqual(["reasoning_delta", "text_delta", "tool_call", "tool_result", "reasoning_delta", "text_delta"]);
    expect(activity.filter(event => event.type === "text_delta").map(event => event.delta)).toEqual(["Updating the file", "Done"]);
    expect(await readFile(join(cwd, "review.txt"), "utf8")).toBe("changed\n");
    const session = await server.kernel.use(sessionStoreToken).read(sessionId("review-run"));
    const liveStarts = stream.filter(item => item.type === "event" && item.event.type === "turn_start").map(item => item.event.turnId);
    const liveEnds = stream.filter(item => item.type === "event" && item.event.type === "turn_end").map(item => item.event.turnId);
    const savedTurns = session!.events.filter(({ event }) => event.type === "turn.started").map(({ event }) => (event as any).payload.turnId);
    expect(savedTurns.length).toBeGreaterThan(0);
    expect(liveStarts).toEqual(savedTurns);
    expect(liveEnds).toEqual(savedTurns);
    const completed = session!.events.find(({ event }) => event.type === "tool.completed");
    const snapshotId = (completed!.event as any).payload.result.details.review.snapshotId;
    const page = await (await fetch(`${server.url}/api/sessions/review-run/messages`)).json();
    const assistantText = page.messages.filter((m: any) => m.role === "assistant").map((m: any) => m.content.filter((b: any) => b.type === "text").map((b: any) => b.text).join(""));
    expect(assistantText).toEqual(["Updating the file", "Done"]);
    expect(page.messages.filter((m: any) => m.role === "tool").map((m: any) => m.toolMeta ?? m.providerData)).toEqual(expect.arrayContaining([expect.objectContaining({ review: expect.objectContaining({ snapshotId }) })]));
    const endpoint = `/api/sessions/review-run/reviews/${snapshotId}`;
    expect(await (await fetch(`${server.url}${endpoint}`)).json()).toMatchObject({ before: "original\n", after: "changed\n", status: "applied" });
    await server.close();
    await writeFile(join(cwd, "review.txt"), "later user change\n");
    const reopened = await startWebServer({ cwd, port: 0, profile, pluginHome: data }); cleanup.push(() => reopened.close());
    expect(await (await fetch(`${reopened.url}${endpoint}`)).json()).toMatchObject({ before: "original\n", after: "changed\n" });
    const rollback = (body: unknown) => fetch(`${reopened.url}${endpoint}/rollback`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    expect((await rollback({})).status).toBe(400);
    expect((await rollback({ confirm: true })).status).toBe(409);
    expect(await readFile(join(cwd, "review.txt"), "utf8")).toBe("later user change\n");
    await writeFile(join(cwd, "review.txt"), "changed\n");
    const active = vi.spyOn(reopened.kernel.use(agentServiceToken), "active").mockReturnValue({ sessionId: sessionId("review-run") } as any);
    expect((await rollback({ confirm: true })).status).toBe(409); active.mockRestore();
    const policy = vi.spyOn(reopened.kernel.use(policyServiceToken), "decide").mockResolvedValueOnce({ outcome: "deny", reason: "Read-only mode" });
    expect((await rollback({ confirm: true })).status).toBe(403); policy.mockRestore();
    expect(await (await rollback({ confirm: true })).json()).toEqual({ outcome: "rolled-back" });
    expect(await readFile(join(cwd, "review.txt"), "utf8")).toBe("original\n");
    expect(await (await rollback({ confirm: true })).json()).toEqual({ outcome: "already-rolled-back" });
  });
  it("serves review evidence only when linked to this session's completed tool", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "seal-review-api-")); cleanup.push(() => rm(cwd, { recursive: true, force: true }));
    const server = await startWebServer({ cwd, port: 0, credentialEnvironment: {} }); cleanup.push(() => server.close());
    const store = server.kernel.use(sessionStoreToken); const id = sessionId("review-owner");
    const session = await store.create({ id, cwd });
    vi.spyOn(server.kernel.use(reviewServiceToken), "read").mockResolvedValue({ id: "snapshot", callId: "call", path: "a.txt", createdAt: "2026-09-12T00:00:00Z", status: "applied", existed: true, before: "old", after: "new" });
    expect((await fetch(`${server.url}/api/sessions/review-owner/reviews/snapshot`)).status).toBe(404);
    await store.append({ id, expectedVersion: session.version, events: [{ type: "tool.completed", payload: { runId: "run", turnId: "turn", callId: "call", name: "write_file", result: { content: [], details: { review: { snapshotId: "snapshot" } } } } }] as any });
    const response = await fetch(`${server.url}/api/sessions/review-owner/reviews/snapshot`);
    expect(response.status).toBe(200); expect(await response.json()).toMatchObject({ before: "old", after: "new" });
    expect((await fetch(`${server.url}/api/sessions/missing/reviews/snapshot`)).status).toBe(404);
  });
  it("exposes descendants and routes ancestor stop through ownership-aware interruption", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "seal-tree-api-")); cleanup.push(() => rm(cwd, { recursive: true, force: true }));
    const server = await startWebServer({ cwd, port: 0, credentialEnvironment: {} }); cleanup.push(() => server.close());
    await server.kernel.use(sessionStoreToken).create({ id: sessionId("tree-root"), cwd });
    const service = server.kernel.use(subagentServiceToken);
    const descendants = vi.spyOn(service, "listDescendants").mockResolvedValue([
      { sessionId: sessionId("child"), parentSessionId: sessionId("tree-root"), label: "Child", status: "running", model: { provider: "mock", model: "m" } },
      { sessionId: sessionId("grandchild"), parentSessionId: sessionId("child"), label: "Grandchild", status: "running", model: { provider: "mock", model: "m" } },
    ]);
    const interrupt = vi.spyOn(service, "interrupt").mockResolvedValue(true);
    const state = await (await fetch(`${server.url}/api/sessions/tree-root/state`)).json();
    expect(state.subagents.map((agent: { sessionId: string }) => agent.sessionId)).toEqual(["child", "grandchild"]);
    expect(descendants).toHaveBeenCalledWith("tree-root");
    expect((await fetch(`${server.url}/api/sessions/tree-root/subagents/grandchild/abort`, { method: "POST" })).status).toBe(200);
    expect(interrupt).toHaveBeenCalledWith("tree-root", "grandchild", expect.any(Error));
  });

  it("deletes only the selected session and persists skin selection", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "seal-delete-skin-")); cleanup.push(() => rm(cwd, { recursive: true, force: true }));
    const server = await startWebServer({ cwd, port: 0, credentialEnvironment: {} }); cleanup.push(() => server.close());
    const store = server.kernel.use(sessionStoreToken);
    await store.create({ id: sessionId("remove-me"), cwd });
    await store.create({ id: sessionId("keep-me"), cwd });
    const scheduled = await server.kernel.use(scheduleServiceToken).create({ sessionId: sessionId("keep-me"), prompt: "fixture", afterSeconds: 600 });
    expect((await fetch(`${server.url}/api/sessions/keep-me`, { method: "DELETE" })).status).toBe(409);
    expect(await store.read(sessionId("keep-me"))).toBeDefined();
    await server.kernel.use(scheduleServiceToken).delete(sessionId("keep-me"), scheduled.id);
    expect(await fetchJson(`${server.url}/api/provider-login?provider=anthropic`)).toMatchObject({ oauth: true, apiKeySetup: true });
    expect((await fetch(`${server.url}/api/sessions/remove-me`, { method: "DELETE" })).status).toBe(200);
    expect(await store.read(sessionId("remove-me"))).toBeUndefined();
    expect(await store.read(sessionId("keep-me"))).toBeDefined();
    expect((await fetch(`${server.url}/api/sessions/remove-me`, { method: "DELETE" })).status).toBe(404);
    expect(await postJson(`${server.url}/api/dsh/skins`, { target: "official" })).toMatchObject({ status: 200, body: { target: "official" } });
    expect(server.kernel.use(settingsServiceToken).scope("seal-skin")?.get().value.target).toBe("official");
    expect((await fetch(`${server.url}/api/dsh/skins`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ target: "missing" }) })).status).toBe(400);
  });
  it("exposes the Agent Team roster and CAS task board to the official shell", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "seal-harness-web-team-")); cleanup.push(() => rm(cwd, { recursive: true, force: true }));
    const server = await startWebServer({ cwd, port: 0, providers: ["deepseek"], credentialEnvironment: {} }); cleanup.push(() => server.close());
    const lead = sessionId("web-team-lead"); await server.kernel.use(sessionStoreToken).create({ id: lead, cwd });
    const toolNames = server.kernel.use(toolServiceToken).definitions(lead).map(tool => tool.name);
    expect(toolNames).toEqual(expect.arrayContaining(["spawn_teammate", "send_message", "list_agents", "wait_agent", "interrupt_agent", "team_task_create", "team_task_list", "team_task_get", "team_task_update"]));
    expect(toolNames).not.toEqual(expect.arrayContaining(["spawn_agent", "wait_agents", "abort_agent"]));
    expect(await postJson(`${server.url}/api/dsh/agent-teams`, { operation: "view", sessionId: lead })).toMatchObject({ status: 200, body: { id: lead, caller: "lead", members: [{ name: "lead", role: "lead" }], tasks: [] } });
    const created = await postJson(`${server.url}/api/dsh/agent-teams`, { operation: "createTask", sessionId: lead, request: { subject: "Review", description: "Review the alignment", blockedBy: [], writeScopes: ["apps/web"] } });
    expect(created).toMatchObject({ status: 200, body: { id: "task-1", revision: 1, status: "pending", ready: true } });
    const completed = await postJson(`${server.url}/api/dsh/agent-teams`, { operation: "updateTask", sessionId: lead, request: { taskId: "task-1", expectedRevision: 1, action: "claim" } });
    expect(completed).toMatchObject({ status: 200, body: { id: "task-1", revision: 2, status: "in_progress", ownerName: "lead" } });
  });

  it("describes and durably stores model credentials for onboarding", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "seal-harness-web-credential-")); cleanup.push(() => rm(cwd, { recursive: true, force: true }));
    const server = await startWebServer({ cwd, port: 0, providers: ["deepseek"], credentialEnvironment: {} }); cleanup.push(() => server.close());
    expect(await fetchJson(`${server.url}/api/credentials/deepseek`)).toMatchObject({ configured: false, writable: true });
    const saved = await fetch(`${server.url}/api/credentials/deepseek`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ apiKey: "durable-secret" }) });
    expect(saved.status).toBe(200);
    expect(await fetchJson(`${server.url}/api/credentials/deepseek`)).toMatchObject({ configured: true, source: "file", writable: true });
    expect(JSON.parse(await readFile(join(cwd, ".seal-harness", "credentials.json"), "utf8"))).toMatchObject({ refs: { DEEPSEEK_API_KEY: "durable-secret" } });
  });

  it("keeps completed-turn metrics but withholds the fork boundary when transcript work follows the closing assistant", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "seal-harness-web-tail-")); cleanup.push(() => rm(cwd, { recursive: true, force: true }));
    const server = await startWebServer({ cwd, port: 0, profile: defineProfile([plugin(memorySessionPlugin, {})]) }); cleanup.push(() => server.close());
    const defaultDsh = server.kernel.use(dshCompatServiceToken).context;
    expect(defaultDsh.get("agentPresets")).toMatchObject({ defaultId: "standard" });
    expect(defaultDsh.get("agents")).toBeDefined();
    const store = server.kernel.use(sessionStoreToken); const id = sessionId("tail-session"); const initial = await store.create({ id, cwd });
    await store.append({ id, expectedVersion: initial.version, events: [
      { type: "run.started", payload: { runId: "run-tail", model: { provider: "test", model: "tail" } } },
      { type: "turn.started", payload: { runId: "run-tail", turnId: "turn-tail" } },
      { type: "message.appended", payload: { messageId: "assistant-tail", runId: "run-tail", turnId: "turn-tail", message: { role: "assistant", content: [{ type: "text", text: "partial answer" }] } }, surfaceOp: "append" },
      { type: "message.appended", payload: { messageId: "tool-tail", runId: "run-tail", turnId: "turn-tail", message: { role: "tool", callId: "call-tail", name: "probe", content: [{ type: "text", text: "later result" }] } }, surfaceOp: "append" },
      { type: "turn.completed", payload: { runId: "run-tail", turnId: "turn-tail", stopReason: "stop", usage: { inputTokens: 10, outputTokens: 2, totalTokens: 12, cacheReadTokens: 0, cacheWriteTokens: 0 } } },
      { type: "turn.started", payload: { runId: "run-tail", turnId: "empty-turn" } },
      { type: "turn.completed", payload: { runId: "run-tail", turnId: "empty-turn", stopReason: "stop", usage: { inputTokens: 3, outputTokens: 0, totalTokens: 3, cacheReadTokens: 0, cacheWriteTokens: 0 } } },
      { type: "turn.started", payload: { runId: "run-tail", turnId: "invalid-usage-turn" } },
      { type: "turn.completed", payload: { runId: "run-tail", turnId: "invalid-usage-turn", stopReason: "stop", usage: { inputTokens: 3, outputTokens: 1, totalTokens: 4, reasoningTokens: 2 } } },
    ] as any });
    const response = await fetchJson(`${server.url}/api/sessions/tail-session`) as any;
    const assistant = response.messages.find((message: any) => message.messageId === "assistant-tail");
    expect(assistant).toMatchObject({ turnCompleted: true, turnUsage: { inputTokens: 10, outputTokens: 2 }, turnModel: { provider: "test", model: "tail" } });
    expect(assistant.atSeq).toBeUndefined();
    expect(response.messages).toContainEqual(expect.objectContaining({ role: "turn-tail", turnId: "empty-turn", turnCompleted: true, turnUsage: { inputTokens: 3, outputTokens: 0, totalTokens: 3, cacheReadTokens: 0, cacheWriteTokens: 0 }, turnModel: { provider: "test", model: "tail" } }));
    expect(response.messages.find((message: any) => message.turnId === "invalid-usage-turn")).not.toHaveProperty("turnUsage");
  });

  it("projects official DSH session titles into the Seal session list with latest-wins ordering", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "seal-harness-web-dsh-title-")); cleanup.push(() => rm(cwd, { recursive: true, force: true }));
    const server = await startWebServer({ cwd, port: 0, profile: defineProfile([plugin(memorySessionPlugin, {})]) }); cleanup.push(() => server.close());
    const store = server.kernel.use(sessionStoreToken); const id = sessionId("dsh-title-session"); let snapshot = await store.create({ id, cwd });
    const createdUpdatedAt = ((await fetchJson(`${server.url}/api/sessions`)) as any[])[0].updatedAt;
    snapshot = await store.append({ id, expectedVersion: snapshot.version, events: [{ type: "dsh.imported", payload: { type: "session/title", data: { title: "Official generated title", source: { kind: "fallback", messageSeq: 0 } } } }] });
    expect(await fetchJson(`${server.url}/api/sessions`)).toEqual([expect.objectContaining({ id, preview: "Official generated title", updatedAt: createdUpdatedAt })]);
    snapshot = await store.append({ id, expectedVersion: snapshot.version, events: [{ type: "session.metadata", payload: { patch: { title: "Manual title" } } }] });
    expect(await fetchJson(`${server.url}/api/sessions`)).toEqual([expect.objectContaining({ id, preview: "Manual title" })]);
    await store.append({ id, expectedVersion: snapshot.version, events: [{ type: "dsh.imported", payload: { type: "session/title", data: { title: "New provider title", source: { kind: "provider" } } } }] });
    expect(await fetchJson(`${server.url}/api/sessions`)).toEqual([expect.objectContaining({ id, preview: "New provider title" })]);
  });

  it("preserves official DSH parentSession and origin metadata in Seal session summaries", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "seal-harness-web-dsh-lineage-")); cleanup.push(() => rm(cwd, { recursive: true, force: true }));
    const server = await startWebServer({ cwd, port: 0, profile: defineProfile([plugin(memorySessionPlugin, {})]) }); cleanup.push(() => server.close());
    const store = server.kernel.use(sessionStoreToken);
    await store.create({ id: sessionId("dsh-parent"), cwd });
    await store.create({ id: sessionId("dsh-child"), cwd, metadata: { parentSession: "dsh-parent", origin: "subagent" } });
    await store.create({ id: sessionId("dsh-branch"), cwd, metadata: { parentSession: "dsh-parent" } });
    const summaries = await fetchJson(`${server.url}/api/sessions`) as any[];
    expect(summaries).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "dsh-child", parentSessionId: "dsh-parent", origin: "subagent" }),
    ]));
    expect(summaries.find((item) => item.id === "dsh-branch")).toMatchObject({ parentSessionId: "dsh-parent" });
    expect(summaries.find((item) => item.id === "dsh-branch")).not.toHaveProperty("origin");
  });

  it("normalizes fallback session renames with the official terminal and UTF-8 safety rules", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "seal-harness-web-title-normalize-")); cleanup.push(() => rm(cwd, { recursive: true, force: true }));
    const server = await startWebServer({ cwd, port: 0, profile: defineProfile([plugin(memorySessionPlugin, {})]) }); cleanup.push(() => server.close());
    await server.kernel.use(sessionStoreToken).create({ id: sessionId("normalized-title"), cwd });
    expect(await requestJson(`${server.url}/api/sessions/normalized-title/title`, { title: " \u001b[31m  Safe\n title \u202E " })).toMatchObject({ status: 200, body: { title: "Safe title" } });
    const long = "界".repeat(40);
    const truncated = await requestJson(`${server.url}/api/sessions/normalized-title/title`, { title: long });
    expect(truncated).toMatchObject({ status: 200, body: { title: "界".repeat(26) } });
    expect(Buffer.byteLength((truncated.body as any).title, "utf8")).toBeLessThanOrEqual(80);
    expect(await requestJson(`${server.url}/api/sessions/normalized-title/title`, { title: " \u200B\u202E " })).toMatchObject({ status: 400, body: { code: "session/title-invalid" } });
  });

  it("exchanges an ephemeral launch token for a persistent strict auth cookie", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "seal-harness-web-auth-")); cleanup.push(() => rm(cwd, { recursive: true, force: true }));
    const credential = join(cwd, "auth-token");
    const first = await startWebServer({ cwd, port: 0, authenticate: true, authCredentialPath: credential });
    cleanup.push(() => first.close());
    expect((await fetch(`${first.url}/api/health`)).status).toBe(401);
    const exchange = await fetch(first.launchUrl, { redirect: "manual" });
    expect(exchange.status).toBe(303); expect(exchange.headers.get("location")).toBe("/");
    const setCookie = exchange.headers.get("set-cookie")!;
    expect(setCookie).toContain("HttpOnly"); expect(setCookie).toContain("SameSite=Strict");
    const cookie = setCookie.split(";", 1)[0]!;
    expect((await fetch(`${first.url}/api/health`, { headers: { cookie } })).status).toBe(200);
    const firstToken = new URL(first.launchUrl).searchParams.get("token"); await first.close();
    const second = await startWebServer({ cwd, port: 0, authenticate: true, authCredentialPath: credential }); cleanup.push(() => second.close());
    expect(new URL(second.launchUrl).searchParams.get("token")).not.toBe(firstToken);
    expect((await fetch(`${second.url}/api/health`, { headers: { cookie } })).status).toBe(200);
    const forged = await new Promise<number>((resolvePromise, reject) => { const request = httpRequest(`${second.url}/api/health`, { headers: { host: `localhost:${second.port}`, cookie } }, (response) => { response.resume(); response.on("end", () => resolvePromise(response.statusCode ?? 0)); }); request.on("error", reject); request.end(); });
    expect(forged).toBe(401);
    const wildcard = await startWebServer({ cwd, host: "0.0.0.0", port: 0, authenticate: true, authCredentialPath: credential }); cleanup.push(() => wildcard.close());
    const wildcardLaunch = new URL(wildcard.launchUrl); wildcardLaunch.hostname = "127.0.0.1";
    expect((await fetch(wildcardLaunch, { redirect: "manual" })).status).toBe(303);
  });

  it("queues steering and follow-up messages onto an active run", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "seal-harness-web-steering-")); cleanup.push(() => rm(cwd, { recursive: true, force: true }));
    const received: Array<{ mode: string; text: string; attachments: number; rpcId?: string }> = [];
    const capture = (mode: string, message: any) => received.push({ mode, text: message.content.find((block: any) => block.type === "text")?.text ?? "", attachments: message.content.filter((block: any) => block.type === "attachment").length, ...(message.source?.rpcId === undefined ? {} : { rpcId: message.source.rpcId }) });
    let finish!: () => void;
    const settled = new Promise<void>((resolvePromise) => { finish = resolvePromise; });
    const execution = {
      sessionId: sessionId("steering-session"), runId: "steering-run",
      result: settled.then(() => ({ runtime: { stopReason: "aborted" }, session: {} })),
      abort() { finish(); },
      steer(message: any) { capture("steer", message); },
      followUp(message: any) { capture("followUp", message); },
      async *[Symbol.asyncIterator]() { await settled; },
    };
    const agentPlugin = definePlugin<undefined, SealHarnessEvents>({
      name: "test-web-steering-agent", provides: [agentServiceToken, attachmentServiceToken],
      setup(context) {
        context.provide(agentServiceToken, { prompt: async () => execution as any, fork: async () => { throw new Error("not used"); } });
        context.provide(attachmentServiceToken, { async put() { throw new Error("not used"); }, async get(reference) { return reference.id === `sha256:${"b".repeat(64)}` ? { data: Buffer.alloc(0), mimeType: reference.mimeType ?? "application/octet-stream", ...(reference.name === undefined ? {} : { name: reference.name }) } : undefined; } });
      },
    });
    const server = await startWebServer({ cwd, port: 0, profile: defineProfile([plugin(agentPlugin, undefined)]) }); cleanup.push(() => server.close());
    const running = await fetch(`${server.url}/api/runs`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ cwd, provider: "test", model: "test", prompt: "start" }) });
    expect(running.status).toBe(200);
    expect((await postJson(`${server.url}/api/runs/steering-run/messages`, { prompt: "change course", mode: "steer" }))).toMatchObject({ status: 202, body: { queued: true, mode: "steer" } });
    expect((await postJson(`${server.url}/api/runs/steering-run/messages`, { prompt: "then continue", mode: "followUp", requestId: "rpc-follow-up" }))).toMatchObject({ status: 202, body: { queued: true, mode: "followUp" } });
    expect((await postJson(`${server.url}/api/runs/steering-run/messages`, { prompt: "", mode: "followUp", attachments: [{ id: `sha256:${"b".repeat(64)}`, name: "queued.png", mimeType: "image/png", bytes: 0 }] }))).toMatchObject({ status: 202 });
    expect((await postJson(`${server.url}/api/runs/steering-run/messages`, { prompt: "invalid bytes", mode: "followUp", attachments: [{ id: `sha256:${"b".repeat(64)}`, bytes: -1 }] })).status).toBe(400);
    expect((await postJson(`${server.url}/api/runs/steering-run/messages`, { prompt: "forged", attachments: [{ id: `sha256:${"c".repeat(64)}` }] })).status).toBe(404);
    expect(received).toEqual([
      { mode: "steer", text: "change course", attachments: 0 },
      { mode: "followUp", text: "then continue", attachments: 0, rpcId: "rpc-follow-up" },
      { mode: "followUp", text: "", attachments: 1 },
    ]);
    expect((await postJson(`${server.url}/api/runs/steering-run/messages`, { prompt: "bad", mode: "later" })).status).toBe(400);
    expect((await fetch(`${server.url}/api/runs/steering-run`, { method: "DELETE" })).status).toBe(202);
    await running.text();
    expect((await postJson(`${server.url}/api/runs/steering-run/messages`, { prompt: "too late" })).status).toBe(404);
  });

  it("streams the authoritative DSH control queue and applies queue mutations", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "seal-harness-web-control-")); cleanup.push(() => rm(cwd, { recursive: true, force: true }));
    const pending: any[] = []; const listeners = new Set<(items: readonly any[]) => void>(); let finish!: () => void;
    const resumedPrompts: string[] = []; const resumedQueued: string[] = []; let finishResumed!: () => void;
    const settled = new Promise<void>((resolvePromise) => { finish = resolvePromise; }); const publish = () => { for (const listener of listeners) listener([...pending]); };
    const execution = {
      sessionId: sessionId("control-session"), runId: "control-run", result: settled.then(() => ({ runtime: { stopReason: "aborted" }, session: {} })),
      abort() { finish(); }, async *[Symbol.asyncIterator]() { await settled; },
      steer(message: any) { pending.push({ id: message.id, placement: "steering", message }); publish(); },
      followUp(message: any) { pending.push({ id: message.id, placement: "queued", message }); publish(); },
      pendingMessages() { return [...pending]; }, subscribePending(listener: (items: readonly any[]) => void) { listeners.add(listener); return () => listeners.delete(listener); },
      updatePendingMessage(id: string, action: any) { const index = pending.findIndex((item) => item.id === id); if (index < 0) return "not-found"; const item = pending[index]; if (action.kind === "steer" && item.placement !== "queued") return "steer-unavailable"; if (action.kind === "edit") pending[index] = { ...item, message: { ...item.message, content: action.content } }; else if (action.kind === "remove") pending.splice(index, 1); else pending[index] = { ...item, placement: "steering" }; publish(); return "updated"; },
    };
    const agentPlugin = definePlugin<undefined, SealHarnessEvents>({ name: "test-control-agent", provides: [agentServiceToken, modelServiceToken], setup(context) {
      context.provide(modelServiceToken, { async list() { return [{ provider: "test", model: "test", contextWindow: 100, maxOutputTokens: 10 }]; }, async get(ref) { return ref.provider === "test" && ref.model === "test" ? { ...ref, contextWindow: 100, maxOutputTokens: 10 } : undefined; }, async *stream() {} });
      context.provide(agentServiceToken, { prompt: async (request: any) => {
        const prompt = request.prompt.find((block: any) => block.type === "text")?.text;
        if (prompt === "start") return execution as any;
        resumedPrompts.push(prompt ?? ""); const done = new Promise<void>((resolve) => { finishResumed = resolve; });
        const localPending: any[] = []; const localListeners = new Set<(items: readonly any[]) => void>(); const publishLocal = () => { for (const listener of localListeners) listener([...localPending]); };
        const enqueue = (placement: "steering" | "queued", message: any) => { resumedQueued.push(`${placement === "steering" ? "steer" : "queue"}:${message.content[0]?.text}`); localPending.push({ id: message.id, placement, message }); publishLocal(); };
        return { sessionId: sessionId("control-session"), runId: `control-resumed-${resumedPrompts.length}`, result: done.then(() => ({ runtime: { stopReason: "aborted" }, session: {} })), abort() { finishResumed(); }, steer(message: any) { enqueue("steering", message); }, followUp(message: any) { enqueue("queued", message); }, pendingMessages() { return [...localPending]; }, subscribePending(listener: (items: readonly any[]) => void) { localListeners.add(listener); return () => localListeners.delete(listener); }, async *[Symbol.asyncIterator]() { await done; } } as any;
      }, fork: async () => { throw new Error("not used"); } });
    } });
    const server = await startWebServer({ cwd, port: 0, profile: defineProfile([plugin(memorySessionPlugin, {}), plugin(agentPlugin, undefined)]) }); cleanup.push(() => server.close());
    await server.kernel.use(sessionStoreToken).create({ id: sessionId("control-session"), cwd });
    const running = fetch(`${server.url}/api/runs`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ cwd, sessionId: "control-session", provider: "test", model: "test", prompt: "start" }) });
    await vi.waitFor(async () => expect((await fetchJson(`${server.url}/api/sessions`) as any[]).find((item) => item.id === "control-session")?.running).toBe(true));
    const controller = new AbortController(); const control = await fetch(`${server.url}/api/dsh/session/control`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}", signal: controller.signal });
    const reader = control.body!.getReader(); const decoder = new TextDecoder(); const baseline = JSON.parse(decoder.decode((await reader.read()).value).trim());
    expect(baseline).toMatchObject({ type: "baseline", value: { queues: { "control-session": [] }, jobs: { "control-session": [] } } });
    expect(await postJson(`${server.url}/api/sessions/control-session/prompt`, { requestId: "queued-rpc", mode: "queue", content: [{ type: "text", text: "queued" }] })).toMatchObject({ status: 202 });
    const queued = JSON.parse(decoder.decode((await reader.read()).value).trim()); const itemId = queued.items[0].id;
    expect(queued).toMatchObject({ type: "queue", sessionId: "control-session", items: [{ placement: "queued", rpcId: "queued-rpc", message: { content: [{ type: "text", text: "queued" }] } }] });
    expect(await fetchJson(`${server.url}/api/sessions/control-session/queue`)).toMatchObject([{ id: itemId, placement: "queued", message: { content: [{ type: "text", text: "queued" }] } }]);
    expect(await postJson(`${server.url}/api/dsh/session/update-queue`, { sessionId: "control-session", itemId, action: { kind: "edit", content: [{ type: "text", text: "edited" }] } })).toMatchObject({ status: 200, body: { accepted: true } });
    expect(pending[0]).toMatchObject({ message: { content: [{ text: "edited" }] } });
    expect(await postJson(`${server.url}/api/dsh/session/update-queue`, { sessionId: "control-session", itemId, action: { kind: "steer" } })).toMatchObject({ status: 200 });
    expect(pending[0]).toMatchObject({ placement: "steering" });
    const unavailable = await postJson(`${server.url}/api/dsh/session/update-queue`, { sessionId: "control-session", itemId, action: { kind: "steer" } }); expect(unavailable).toMatchObject({ status: 409, body: { code: "session/steer-unavailable" } });
    expect(await postJson(`${server.url}/api/dsh/session/update-queue`, { sessionId: "control-session", itemId, action: { kind: "remove" } })).toMatchObject({ status: 200 });
    await server.kernel.use(sessionStoreToken).append({ id: sessionId("control-session"), expectedVersion: 1, events: [{ type: "session.metadata", payload: { patch: { title: "projection update" } } }] });
    let projection: any; let projectionBuffer = "";
    for (let attempt = 0; attempt < 10 && projection === undefined; attempt += 1) {
      projectionBuffer += decoder.decode((await reader.read()).value);
      const lines = projectionBuffer.split("\n"); projectionBuffer = lines.pop() ?? "";
      for (const line of lines.filter(Boolean)) { const frame = JSON.parse(line); if (frame.type === "projection" && frame.key === "sessionListMetadata") projection = frame; }
    }
    expect(projection).toMatchObject({ type: "projection", sessionId: "control-session", key: "sessionListMetadata", seq: expect.any(Number) });
    expect(projection.seq).toBeGreaterThanOrEqual(1);
    expect(await postJson(`${server.url}/api/sessions/control-session/prompt`, { requestId: "parked-rpc", mode: "queue", content: [{ type: "text", text: "park me" }] })).toMatchObject({ status: 202 });
    const parkedId = pending[0].id; expect((await fetch(`${server.url}/api/sessions/control-session/cancel`, { method: "POST" })).status).toBe(202); await (await running).text();
    await vi.waitFor(async () => expect((await fetchJson(`${server.url}/api/sessions`) as any[]).find((item) => item.id === "control-session")?.running).toBe(false));
    expect(await postJson(`${server.url}/api/dsh/session/update-queue`, { sessionId: "control-session", itemId: parkedId, action: { kind: "edit", content: [{ type: "text", text: "parked edit" }] } })).toMatchObject({ status: 200 });
    expect(await postJson(`${server.url}/api/sessions/control-session/prompt`, { requestId: "wake-rpc", mode: "queue", content: [{ type: "text", text: "wake" }] })).toMatchObject({ status: 202 });
    expect(resumedPrompts).toEqual(["parked edit"]); expect(resumedQueued).toEqual(["queue:wake"]); finishResumed();
    await vi.waitFor(async () => expect((await fetchJson(`${server.url}/api/sessions`) as any[]).find((item) => item.id === "control-session")?.running).toBe(false));
    const webWake = fetch(`${server.url}/api/runs`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ cwd, sessionId: "control-session", provider: "test", model: "test", prompt: "web wake" }) });
    await vi.waitFor(() => expect(resumedPrompts).toEqual(["parked edit", "wake"]));
    expect(resumedQueued).toEqual(["queue:wake", "queue:web wake"]); finishResumed(); await (await webWake).text();
    controller.abort(); await reader.cancel().catch(() => undefined);
  });

  it("serves redacted revisioned settings and refuses stale writes", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "seal-harness-web-settings-")); cleanup.push(() => rm(cwd, { recursive: true, force: true }));
    const server = await startWebServer({ cwd, port: 0, credentialEnvironment: {} }); cleanup.push(() => server.close());
    server.kernel.use(settingsServiceToken).register("account", { base: { token: "hidden", mode: "safe" }, secretPaths: [["token"]], schema: { type: "object", properties: { token: { type: "string" }, mode: { type: "string", enum: ["safe", "fast"] } } } });
    const describedResponse = await requestJson(`${server.url}/api/settings`); const described = describedResponse.body as any;
    const themeDescriptor = described.namespaces.find((entry: any) => entry.namespace === "ui-theme");
    const conversationDescriptor = described.namespaces.find((entry: any) => entry.namespace === "ui-conversation");
    const chatDescriptor = described.namespaces.find((entry: any) => entry.namespace === "ui-chat");
    expect(conversationDescriptor).toMatchObject({ value: { busyEnter: "queue" }, revision: 0, applies: "live" });
    expect((await requestJson(`${server.url}/api/settings/ui-conversation`, { expectedRevision: conversationDescriptor.revision, value: { busyEnter: "steer" } }))).toMatchObject({ status: 200, body: { value: { busyEnter: "steer" }, revision: 1 } });
    expect(chatDescriptor).toMatchObject({ value: { transcriptView: "compact" }, revision: 0, applies: "live" });
    expect((await requestJson(`${server.url}/api/settings/ui-chat`, { expectedRevision: chatDescriptor.revision, value: { transcriptView: "normal" } }))).toMatchObject({ status: 200, body: { value: { transcriptView: "normal" }, revision: 1 } });
    expect(themeDescriptor).toMatchObject({ value: { preference: "system", fontSize: 14 }, revision: 0, applies: "live" });
    expect((await requestJson(`${server.url}/api/settings/ui-theme`, { expectedRevision: themeDescriptor.revision, value: { preference: "dark", fontSize: 15 } }))).toMatchObject({ status: 200, body: { value: { preference: "dark", fontSize: 15 }, revision: 1 } });
    expect(described.namespaces.find((entry: any) => entry.namespace === "account")).toMatchObject({ namespace: "account", value: { mode: "safe" }, revision: 0, secrets: [{ path: ["token"], set: true }], schema: { type: "object" } });
    const updated = await requestJson(`${server.url}/api/settings/account`, { expectedRevision: 0, value: { mode: "fast", token: "rotated" } });
    expect(updated.status).toBe(200); expect(updated.body).toMatchObject({ revision: 1, value: { mode: "fast" } });
    const stale = await requestJson(`${server.url}/api/settings/account`, { expectedRevision: 0, value: { mode: "lost" } });
    expect(stale.status).toBe(409); expect(stale.body).toMatchObject({ code: "SETTINGS_CONFLICT", expected: 0, actual: 1 });
    const mutated = await requestJson(`${server.url}/api/settings/account`, { mode: "mutate", expectedRevision: 1, ops: [{ op: "unset", path: ["mode"] }] });
    expect(mutated.status).toBe(200); expect(mutated.body).toMatchObject({ revision: 2, value: { mode: "safe" }, secrets: [{ path: ["token"], set: true }] });
    const providerDescriptor = described.namespaces.find((entry: any) => entry.namespace === "provider-pi-ai"); expect(providerDescriptor).toBeDefined();
    const liveResponse = await fetch(`${server.url}/api/events`); expect(liveResponse.headers.get("content-type")).toContain("text/event-stream");
    const liveReader = liveResponse.body?.getReader(); expect(liveReader).toBeDefined();
    await liveReader!.read();
    expect((await requestJson(`${server.url}/api/settings/provider-pi-ai`, { expectedRevision: providerDescriptor.revision, value: { providers: ["openai"] } })).status).toBe(200);
    const liveUpdate = new TextDecoder().decode((await Promise.race([
      liveReader!.read(),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error("model update event timed out")), 2_000)),
    ])).value);
    expect(liveUpdate).toContain("event: models.updated"); expect(liveUpdate).toContain('"providers":["openai"]');
    await liveReader!.cancel();
    expect(new Set((await server.kernel.use(modelServiceToken).list()).map((model) => model.provider))).toEqual(new Set(["openai"]));
    const toolsDescriptor = described.namespaces.find((entry: any) => entry.namespace === "tools"); expect(toolsDescriptor).toBeDefined();
    expect((await requestJson(`${server.url}/api/settings/tools`, { expectedRevision: toolsDescriptor.revision, value: { maxResultBytes: 500 } })).status).toBe(200);
    const tools = server.kernel.use(toolServiceToken); tools.register({ name: "settings-probe", description: "Probe dynamic settings", inputSchema: { type: "object", additionalProperties: false }, classify() { return { kind: "tool", toolName: "settings-probe", risk: "read", summary: "Probe settings" }; }, async execute() { return { content: [text("x".repeat(2_000))] }; } });
    const settingsSession = sessionId("settings-test"); await server.kernel.use(sessionStoreToken).create({ id: settingsSession, cwd });
    const result = await tools.execute({ callId: toolCallId("settings-probe"), sessionId: settingsSession, cwd, name: "settings-probe", input: {}, signal: new AbortController().signal });
    expect(result.content[0]).toMatchObject({ text: expect.stringContaining("Full formatted result stored at:") });
    expect(Buffer.byteLength((result.content[0] as { text: string }).text)).toBeLessThanOrEqual(500);
  });

  it("prevents DSH plugins from shadowing core API routes", () => {
    const routes = new WebRouteRegistry("0.0.0.0");
    expect(routes.host).toBe("0.0.0.0");
    expect(() => routes.register({
      kind: "exact",
      path: "/api/health",
      handler() {},
    })).toThrow("conflicts with a Seal Harness API");
    expect(() => routes.register({
      kind: "prefix",
      path: "/api/dsh",
      handler() {},
    })).toThrow("conflicts with a Seal Harness API");
  });

  it("hosts correlated generic DSH Connection RPC channels", async () => {
    const routes = new WebRouteRegistry(); const connection = new DshConnectionBridge(routes);
    const dispose = connection.rpc.handle("/probe", async (endpoint, payload) => ({ ok: true, value: { endpoint, payload } }));
    const disposeShared = connection.rpc.intercept("/api", (endpoint) => endpoint.startsWith("extension/"), async (endpoint, payload) => ({ ok: true, value: { endpoint, payload, shared: true } }));
    const http = createServer((request, response) => { const path = new URL(request.url ?? "/", "http://local").pathname; void connection.intercept(request, response, path).then((handled) => { if (handled) return; const route = routes.get(path); if (route === undefined) { response.writeHead(404); response.end(); } else void route.handler(request, response); }); });
    await new Promise<void>((resolve, reject) => { http.once("error", reject); http.listen(0, "127.0.0.1", resolve); });
    cleanup.push(async () => { await disposeShared(); await dispose(); await new Promise<void>((resolve) => http.close(() => resolve())); });
    const address = http.address(); if (address === null || typeof address === "string") throw new Error("missing test address");
    const url = `http://127.0.0.1:${address.port}/probe/echo`;
    const envelope = { type: "client-request", rpcId: "rpc-1", method: "echo", payload: { value: 42 } };
    expect(await (await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(envelope) })).json()).toEqual({ type: "server-response", rpcId: "rpc-1", result: { ok: true, value: { endpoint: "echo", payload: { value: 42 } } } });
    const mismatch = await (await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...envelope, method: "other" }) })).json() as any;
    expect(mismatch).toMatchObject({ type: "server-response", rpcId: "rpc-1", result: { ok: false, error: { code: "gateway/bad-request" } } });
    const sharedEnvelope = { ...envelope, rpcId: "rpc-2", method: "extension/echo" };
    expect(await (await fetch(`http://127.0.0.1:${address.port}/api/extension/echo`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(sharedEnvelope) })).json()).toMatchObject({ type: "server-response", rpcId: "rpc-2", result: { ok: true, value: { endpoint: "extension/echo", shared: true } } });
    expect((await fetch(`http://127.0.0.1:${address.port}/api/health`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...envelope, method: "health" }) })).status).toBe(404);
  });

  it("multiplexes DSH Remote follow and control streams over one WebSocket", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "seal-harness-web-mux-")); cleanup.push(() => rm(cwd, { recursive: true, force: true }));
    const server = await startWebServer({ cwd, port: 0 }); cleanup.push(() => server.close());
    const store = server.kernel.use(sessionStoreToken); const created = await store.create({ id: sessionId("mux-session"), cwd });
    const socket = new WsClient(server.url.replace(/^http/, "ws") + "/api/remote.mux");
    cleanup.push(async () => { if (socket.readyState === WsClient.OPEN) socket.close(); });
    await new Promise<void>((resolve, reject) => { socket.once("open", resolve); socket.once("error", reject); });
    const frames: any[] = []; socket.on("message", (data) => frames.push(JSON.parse(data.toString())));
    socket.send(JSON.stringify({ type: "open", streamId: "follow-1", endpoint: "session/follow", payload: { args: { request: { address: { kind: "session", sessionId: "mux-session" } } } } }));
    socket.send(JSON.stringify({ type: "open", streamId: "control-1", endpoint: "session/control", payload: { args: {} } }));
    socket.send(JSON.stringify({ type: "open", streamId: "workspace-1", endpoint: "workspace/follow", payload: { args: {} } }));
    socket.send(JSON.stringify({ type: "open", streamId: "events-1", endpoint: "$events", payload: { args: {} } }));
    socket.send(JSON.stringify({ type: "open", streamId: "missing-1", endpoint: "session/missing", payload: { args: {} } }));
    await vi.waitFor(() => expect(frames.filter((frame) => frame.type === "item").length).toBeGreaterThanOrEqual(4));
    expect(frames).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: "item", streamId: "follow-1", value: expect.objectContaining({ type: "snapshot", header: expect.objectContaining({ id: "mux-session" }) }) }),
      expect.objectContaining({ type: "item", streamId: "control-1", value: expect.objectContaining({ type: "baseline" }) }),
      expect.objectContaining({ type: "item", streamId: "events-1", value: expect.objectContaining({ type: "ready", clientId: expect.any(String), host: { home: expect.any(String) } }) }),
      expect.objectContaining({ type: "item", streamId: "workspace-1", value: { type: "baseline", value: { items: [], archivedSessionIds: [] } } }),
      expect.objectContaining({ type: "error", streamId: "missing-1", error: expect.objectContaining({ code: "gateway/method-not-found" }) }),
    ]));
    const muxEvents = [{ type: "message.appended" as const, payload: { messageId: messageId("mux-message"), message: { role: "user" as const, content: [text("live over mux")] } } }];
    while (true) {
      const beforeMuxAppend = await store.read(created.id); expect(beforeMuxAppend).toBeDefined();
      try { await store.append({ id: created.id, expectedVersion: beforeMuxAppend!.version, events: muxEvents }); break; }
      catch (error) { if (!(error instanceof SessionConflictError)) throw error; }
    }
    await vi.waitFor(() => expect(frames).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: "item", streamId: "follow-1", value: expect.objectContaining({ type: "event", event: expect.objectContaining({ type: "user/message" }) }) }),
      expect.objectContaining({ type: "item", streamId: "events-1", value: { type: "emit", event: "session.appended", args: [expect.objectContaining({ sessionId: "mux-session" })] } }),
    ])), { timeout: 5_000 });
    socket.send(JSON.stringify({ type: "cancel", streamId: "follow-1" }));
    socket.send(JSON.stringify({ type: "cancel", streamId: "control-1" }));
    socket.send(JSON.stringify({ type: "cancel", streamId: "events-1" }));
    socket.send(JSON.stringify({ type: "cancel", streamId: "workspace-1" }));
    socket.close();
    await new Promise<void>((resolve) => socket.once("close", () => resolve()));
  });

  it("serves a bounded logical message window that honors explicit surface replacements", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "seal-harness-web-window-")); cleanup.push(() => rm(cwd, { recursive: true, force: true }));
    const server = await startWebServer({ cwd, port: 0 }); cleanup.push(() => server.close());
    const id = sessionId("window-test"); const store = server.kernel.use(sessionStoreToken); await store.create({ id, cwd });
    const liveResponse = await fetch(`${server.url}/api/events`); const liveReader = liveResponse.body!.getReader(); await liveReader.read();
    await store.append({ id, expectedVersion: 1, events: Array.from({ length: 205 }, (_, index) => ({
      type: "message.appended" as const,
      payload: { messageId: messageId(`window-${index}`), message: { role: "user" as const, content: [text(`message-${index}`)] } },
      surfaceOp: "append" as const,
    })) });
    const liveAppend = new TextDecoder().decode((await liveReader.read()).value);
    expect(liveAppend).toContain("event: session.appended"); expect(liveAppend).toContain('"sessionId":"window-test"');
    await liveReader.cancel();
    await store.append({ id, expectedVersion: 206, events: [{
      type: "message.appended", payload: { messageId: messageId("replacement"), message: { role: "assistant", content: [text("replacement")] } },
      surfaceOp: { op: "replace", start: 2, end: 3 }, sourceEventSeqs: [2, 3],
    }] });
    const disabledSearch = await fetch(`${server.url}/api/sessions/search?query=message-100`); const disabledSearchBody = await disabledSearch.json();
    expect(disabledSearch.status, JSON.stringify(disabledSearchBody)).toBe(200); expect(disabledSearchBody).toEqual({ items: [], hasMore: false });

    const latest = await fetchJson(`${server.url}/api/sessions/${id}/messages`) as any;
    expect(latest.messages).toHaveLength(50); expect(latest.window).toEqual({ start: 154, end: 204, total: 204, hasMore: true, nextBefore: 154 });
    const ordinaryEarlier = await fetchJson(`${server.url}/api/sessions/${id}/messages?before=154`) as any;
    expect(ordinaryEarlier.messages).toHaveLength(50); expect(ordinaryEarlier.window).toMatchObject({ start: 104, end: 154, hasMore: true, nextBefore: 104 });
    const complete = await fetchJson(`${server.url}/api/sessions/${id}/messages?limit=1000`) as any;
    expect(complete.messages).toHaveLength(204); expect(complete.messages[0]).toMatchObject({ messageId: "replacement" });
    expect(complete.messages.map((entry: any) => entry.messageId)).not.toContain("window-0");
    expect(complete.messages.map((entry: any) => entry.messageId)).not.toContain("window-1");
    const legacy = await fetchJson(`${server.url}/api/sessions/${id}`) as any;
    expect(legacy.messages).toHaveLength(204); expect(legacy.messages[0]).toMatchObject({ messageId: "replacement" });
  });

  it("attaches successful produced files to the closing assistant once", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "seal-harness-web-produced-")); cleanup.push(() => rm(cwd, { recursive: true, force: true }));
    const server = await startWebServer({ cwd, port: 0 }); cleanup.push(() => server.close());
    const id = sessionId("produced-files"); const store = server.kernel.use(sessionStoreToken); let session = await store.create({ id, cwd });
    const runId = "run-produced" as never; const turnId = "turn-produced" as never; const callId = toolCallId("write-produced");
    session = await store.append({ id, expectedVersion: session.version, events: [
      { type: "run.started", payload: { runId, model: { provider: "scripted", model: "web" } } },
      { type: "turn.started", payload: { runId, turnId } },
      { type: "message.appended", payload: { messageId: messageId("produced-user"), runId, turnId, message: { role: "user", content: [text("write it")] } }, surfaceOp: "append" },
      { type: "message.appended", payload: { messageId: messageId("produced-call"), runId, turnId, message: { role: "assistant", content: [{ type: "tool_call", id: callId, name: "write_file", arguments: { path: "src/out.ts", content: "ok" } }] } }, surfaceOp: "append" },
      { type: "tool.started", payload: { runId, turnId, callId, name: "write_file", input: { path: "src/out.ts", content: "ok" } } },
      { type: "tool.completed", payload: { runId, turnId, callId, name: "write_file", result: { content: [text("wrote")], details: { path: "src/out.ts" } } } },
      { type: "message.appended", payload: { messageId: messageId("produced-result"), runId, turnId, message: { role: "tool", callId, name: "write_file", content: [text("wrote")], isError: false } }, surfaceOp: "append" },
      { type: "message.appended", payload: { messageId: messageId("produced-done"), runId, turnId, message: { role: "assistant", content: [text("done")] } }, surfaceOp: "append" },
      { type: "turn.completed", payload: { runId, turnId, stopReason: "stop" } },
    ] });
    const page = await fetchJson(`${server.url}/api/sessions/${id}/messages`) as any;
    expect(page.messages.find((message: any) => message.messageId === "produced-done")).toMatchObject({ producedFiles: ["src/out.ts"], turnCompleted: true });
    expect(page.messages.find((message: any) => message.messageId === "produced-result")).toMatchObject({ providerData: { path: "src/out.ts" } });
    expect(page.messages.find((message: any) => message.messageId === "produced-call")).not.toHaveProperty("producedFiles");
  });

  it("attaches imported DSH turn completion metadata to its converted closing assistant", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "seal-harness-web-imported-turn-")); cleanup.push(() => rm(cwd, { recursive: true, force: true }));
    const server = await startWebServer({ cwd, port: 0 }); cleanup.push(() => server.close());
    const id = sessionId("imported-turn"); const store = server.kernel.use(sessionStoreToken); let session = await store.create({ id, cwd });
    session = await store.append({ id, expectedVersion: session.version, events: [
      { type: "dsh.imported", payload: { type: "turn/start", data: { turn: 7 }, time: 1_000 } },
      { type: "message.appended", payload: { messageId: messageId("imported-user"), turnId: "dsh-turn-7" as never, message: { role: "user", content: [text("question")] } }, surfaceOp: "append" },
      { type: "message.appended", payload: { messageId: messageId("imported-tool"), turnId: "dsh-turn-7" as never, message: { role: "tool", callId: toolCallId("imported-call"), name: "read_file", content: [text("missing")], isError: true, providerData: { dsh: { error: { name: "ToolError", code: "ENOENT" }, meta: { path: "missing.txt" } } } } }, surfaceOp: "append" },
      { type: "message.appended", payload: { messageId: messageId("imported-answer"), turnId: "dsh-turn-7" as never, message: { role: "assistant", content: [text("answer")], providerData: { dsh: { interrupted: true, usage: { inputTokens: 12, outputTokens: 3, totalTokens: 20, cacheReadTokens: 4, reasoningTokens: 2 }, source: { kind: "model", provider: "deepseek", model: "deepseek-chat" } } } } }, surfaceOp: "append" },
      { type: "dsh.imported", payload: { type: "turn/end", data: { turn: 7, reason: { kind: "completed" } }, time: 1_250 } },
    ] });
    const page = await fetchJson(`${server.url}/api/sessions/${id}/messages`) as any;
    expect(page.messages.find((message: any) => message.messageId === "imported-tool")).toMatchObject({ toolMeta: { path: "missing.txt" }, toolError: { name: "ToolError", code: "ENOENT" } });
    expect(page.messages.find((message: any) => message.messageId === "imported-answer")).toMatchObject({ interrupted: true, turnId: "dsh-turn-7", turnNumber: 6, turnCompleted: true, turnStopReason: "stop", turnUsage: { inputTokens: 12, outputTokens: 3, totalTokens: 20, cacheReadTokens: 4, reasoningTokens: 2, routes: [{ provider: "deepseek", model: "deepseek-chat" }] }, turnModel: { provider: "deepseek", model: "deepseek-chat" }, turnDurationMs: 250, atSeq: expect.any(Number) });
    expect(page.turnOutline).toEqual([{ turn: 6, turnId: "dsh-turn-7", prompt: "question", response: "answer" }]);
    expect(await fetchJson(`${server.url}/api/sessions`)).toEqual([expect.objectContaining({ id, blank: false })]);
  });

  it("serves message-aligned DSH history pages and a gap-free follow stream", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "seal-harness-web-dsh-history-")); cleanup.push(() => rm(cwd, { recursive: true, force: true }));
    const server = await startWebServer({ cwd, port: 0 }); cleanup.push(() => server.close());
    const id = sessionId("dsh-history"); const store = server.kernel.use(sessionStoreToken); let session = await store.create({ id, cwd });
    const pixelData = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64");
    const pixel = await server.kernel.use(attachmentServiceToken).put({ data: pixelData, mimeType: "image/png", name: "history.png" });
    session = await store.append({ id, expectedVersion: session.version, events: [
      { type: "run.started", payload: { runId: "run-history" as never, model: { provider: "deepseek", model: "deepseek-chat" } } },
      { type: "session.metadata", payload: { patch: { "sealHarness.modelSelection": { provider: "openai", model: "gpt-next", reasoningEffort: "high" } } } },
      { type: "turn.started", payload: { runId: "run-history" as never, turnId: "turn-history" as never } },
      { type: "message.appended", payload: { messageId: messageId("user-history"), runId: "run-history" as never, turnId: "turn-history" as never, message: { role: "user", content: [text("hello"), pixel], source: { kind: "user-rpc", rpcId: "request-history", clientTimeZone: "Asia/Shanghai" } } }, surfaceOp: "append" },
      { type: "message.appended", payload: { messageId: messageId("assistant-history"), runId: "run-history" as never, turnId: "turn-history" as never, message: { role: "assistant", content: [text("world")] } }, surfaceOp: "append" },
      { type: "turn.completed", payload: { runId: "run-history" as never, turnId: "turn-history" as never, stopReason: "length" } },
    ] });
    const webMessages = await fetchJson(`${server.url}/api/sessions/${id}/messages`) as any;
    expect(webMessages.messages.find((message: any) => message.messageId === "assistant-history")).toMatchObject({ runId: "run-history", turnId: "turn-history", turnNumber: 0, turnCompleted: true, turnStopReason: "length", time: expect.any(Number) });
    expect(webMessages.turnOutline).toEqual([{ turn: 0, turnId: "turn-history", prompt: "hello", response: "world" }]);
    const full = await postJson(`${server.url}/api/dsh/session/page`, { address: { kind: "session", sessionId: id }, throughSeq: 5, maxMessages: 10 });
    expect(full.status, JSON.stringify(full.body)).toBe(200); expect((full.body as any).records.map((record: any) => record.event.seq)).toEqual([0, 1, 2, 3, 4, 5]);
    expect((full.body as any).records.map((record: any) => [record.event.type, record.event.data])).toEqual(expect.arrayContaining([
      ["turn/start", { turn: 1 }], ["turn/end", { turn: 1, reason: { kind: "max-tokens" } }],
    ]));
    expect((full.body as any).records.find((record: any) => record.event.type === "assistant/message").event.data.message).toMatchObject({ id: "assistant-history", role: "assistant", source: { kind: "model", provider: "deepseek", model: "deepseek-chat" } });
    expect((full.body as any).records.find((record: any) => record.event.type === "user/message").event.data.source).toEqual({ kind: "user-rpc", rpcId: "request-history", clientTimeZone: "Asia/Shanghai" });
    expect((full.body as any).records.find((record: any) => record.event.type === "user/message").event.data.content[1]).toEqual({
      type: "image", attachment: { attachmentId: pixel.id, mediaType: pixel.mimeType, bytes: pixel.bytes, width: 1, height: 1, name: "history.png" },
    });
    const latest = await postJson(`${server.url}/api/dsh/session/page`, { address: { kind: "session", sessionId: id }, throughSeq: 5, maxMessages: 1 });
    expect((latest.body as any).records[0].event.type).toBe("assistant/message"); expect((latest.body as any).hasMore).toBe(true);
    expect((await postJson(`${server.url}/api/dsh/session/page`, { address: { kind: "session", sessionId: id }, throughSeq: 9 })).status).toBe(400);

    const projectionController = new AbortController(); const control = await fetch(`${server.url}/api/dsh/session/control`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}", signal: projectionController.signal });
    const controlReader = control.body!.getReader(); const controlBaseline = JSON.parse(new TextDecoder().decode((await controlReader.read()).value).trim());
    expect(controlBaseline.value.projections[id].values.modelSelection).toEqual({ lastUsed: { provider: "deepseek", model: "deepseek-chat" }, next: { provider: "openai", model: "gpt-next", reasoningEffort: "high" } });
    expect(controlBaseline.value.projections[id].values.sessionStats).toMatchObject({ turns: 1, steps: 1 });
    expect(controlBaseline.value.projections[id].values.imageLimits).toEqual({ maxImageBytes: 20_971_520, maxImagesPerMessage: 20, maxMessageImageBytes: 209_715_200, maxImagePixels: 64_000_000, maxImageDimension: 8192, mediaTypes: ["image/png", "image/jpeg", "image/webp", "image/gif"] });
    projectionController.abort(); await controlReader.cancel().catch(() => undefined);
    expect(await postJson(`${server.url}/api/sessions/${id}/prompt`, { requestId: "too-many-images", mode: "queue", content: Array.from({ length: 21 }, () => ({ type: "image", mediaType: "image/png", data: pixelData.toString("base64") })) })).toMatchObject({ status: 413 });

    const controller = new AbortController();
    const followed = await fetch(`${server.url}/api/dsh/session/follow`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ address: { kind: "session", sessionId: id }, maxMessages: 1 }), signal: controller.signal });
    const reader = followed.body!.getReader(); const decoder = new TextDecoder();
    const snapshot = JSON.parse(decoder.decode((await reader.read()).value).trim());
    expect(snapshot).toMatchObject({ type: "snapshot", cursor: 8, hasMore: true, header: { version: 0, id: "dsh-history", cwd } });
    await store.append({ id, expectedVersion: session.version, events: [{ type: "session.metadata", payload: { patch: { title: "renamed" } } }] });
    const appended = JSON.parse(decoder.decode((await Promise.race([reader.read(), new Promise<never>((_, reject) => setTimeout(() => reject(new Error("DSH follow event timed out")), 2_000))])).value).trim());
    expect(appended).toMatchObject({ type: "event", event: { type: "seal/session-metadata", seq: 9, ignorable: true } });
    controller.abort(); await reader.cancel().catch(() => undefined);
  });

  it("serves the UI and streams an Agent run into a persisted session", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "seal-harness-web-"));
    cleanup.push(() => rm(cwd, { recursive: true, force: true }));
    const controlCalls: string[] = [];
    const officialSubagentCalls: string[] = [];
    const officialGoalCalls: string[] = [];
    const officialSessionWriteCalls: string[] = [];
    const attachmentData = Buffer.from("attachment-body");
    const attachmentId = `sha256:${createHash("sha256").update(attachmentData).digest("hex")}`;
    const jobService: JobService = {
      start() { throw new Error("not used"); }, list() { return []; }, get() { throw new Error("not used"); },
      read() { throw new Error("not used"); }, wait() { throw new Error("not used"); },
      cancel(id, ownerSession, reason) {
        controlCalls.push(`job:${ownerSession}:${id}:${reason}`);
        return { id, kind: "test", label: id, ...(ownerSession === undefined ? {} : { ownerSession }), status: "cancelled", startedAt: 1, finishedAt: 2 };
      },
    };
    const terminalService: TerminalService = {
      open() { throw new Error("not used"); }, list() { return []; }, get() { throw new Error("not used"); },
      write() { throw new Error("not used"); }, read() { throw new Error("not used"); },
      close(id, ownerSession) {
        controlCalls.push(`terminal:${ownerSession}:${id}`);
        return { id, ownerSession, cwd, pid: 1, status: "exited", startedAt: 1, finishedAt: 2, jobId: "job-1" };
      },
    };
    const subagentService: SubagentService = {
      spawn() { throw new Error("not used"); },
      list(parentSessionId) { return Promise.resolve(parentSessionId === "remote-created" ? [{ sessionId: sessionId("remote-child"), parentSessionId, label: "Remote child", status: "completed", model: { provider: "scripted", model: "web" } }] : []); },
      listDescendants(parentSessionId) { return this.list(parentSessionId); },
      wait() { throw new Error("not used"); },
      sendMessage(parentSessionId, childSessionId, message) { if (message.role !== "user" || message.id === undefined) throw new Error("expected identified user message"); controlCalls.push(`subagent-message:${parentSessionId}:${childSessionId}:${message.id}`); return Promise.resolve(message.id); },
      send() { throw new Error("not used"); },
      abort(parentSessionId, childSessionId, reason) {
        controlCalls.push(`subagent:${parentSessionId}:${childSessionId}:${reason instanceof Error ? reason.message : String(reason)}`);
        return Promise.resolve(true);
      },
    };
    const scheduleService: ScheduleService = {
      create() { throw new Error("not used"); },
      list() { return Promise.resolve([]); },
      delete(ownerSession, id) {
        controlCalls.push(`schedule:${ownerSession}:${id}`);
        return Promise.resolve(true);
      },
    };
    const controlsPlugin = definePlugin<undefined, SealHarnessEvents>({
      name: "test-web-session-controls",
      provides: [jobServiceToken, terminalServiceToken, subagentServiceToken, scheduleServiceToken],
      requires: [webRouteServiceToken],
      setup(context) {
        context.provide(jobServiceToken, jobService);
        context.provide(terminalServiceToken, terminalService);
        context.provide(subagentServiceToken, subagentService);
        context.provide(scheduleServiceToken, scheduleService);
        context.effect(context.use(webRouteServiceToken).register({
          kind: "exact", path: "/test-native-route",
          handler(_request, response) { response.writeHead(204).end(); },
        }));
      },
    });
    const credentialValues = new Map<string, string>();
    const credentialsPlugin = definePlugin<undefined, SealHarnessEvents>({
      name: "test-web-credentials", provides: [credentialServiceToken],
      setup(context) { context.provide(credentialServiceToken, {
        async resolve() { return undefined; },
        async describeRef(ref) { return { configured: credentialValues.has(ref), ...(credentialValues.has(ref) ? { source: "test" } : {}), writable: true }; },
        async setRef(ref, value) { credentialValues.set(ref, value); },
        async unsetRef(ref) { credentialValues.delete(ref); },
      }); },
    });
    const dshResumeDisposals: string[] = [];
    const dshSurfacesPlugin = definePlugin<undefined, SealHarnessEvents>({
      name: "test-web-dsh-surfaces", provides: [dshCompatServiceToken],
      setup(context) { context.provide(dshCompatServiceToken, { fibers: [], context: { get(name: string) {
        if (name === "skills") return { async list() { return [
          { name: "visible", description: "Visible skill", whenToUse: "When testing", invocation: { modelInvocable: true, userInvocable: true } },
          { name: "model-only", description: "Hidden skill", invocation: { modelInvocable: true, userInvocable: false } },
        ]; } };
        if (name === "directoryPicker") return { capability() { return { kind: "browse", async list(path?: string) { return { path: path ?? cwd, entries: [], crumbs: [] }; }, async createDirectory(path: string, name: string) { return join(path, name); } }; } };
        if (name === "settingsController") return {
          describe() { return { writable: true, hasDocument: true, namespaces: [{ ns: "llm-pi-ai", schema: {}, value: { providers: {} }, applies: "live", secrets: [], revision: 4 }] }; },
          canOpenAgentPresetDirectory() { return false; },
          async update(ns: string, value: unknown, revision: number | undefined) { return { ns, schema: {}, value, applies: "live", secrets: [], revision: (revision ?? 0) + 1 }; },
          async replace(ns: string, value: unknown, revision: number | undefined) { return { ns, schema: {}, value, applies: "live", secrets: [], revision: (revision ?? 0) + 1 }; },
          async mutate(ns: string, ops: unknown[], revision: number | undefined) { return { ns, schema: {}, value: { ops }, applies: "live", secrets: [], revision: (revision ?? 0) + 1 }; },
          async openSettingsDocument() { return { opened: true }; },
          async openAgentPresetDirectory(id: string) { throw Object.assign(new Error("preset is read-only"), { isDSHRemoteError: true, code: "agent-preset/read-only", details: { agentPreset: id } }); },
        };
        if (name === "sessionController") return {
          canOpenWorkspacePath() { return false; },
          async openWorkspacePath(request: { path: string }) { return { opened: true, path: request.path, source: "official-test" }; },
          async list() { return { items: [{ sessionId: "official-session", updatedAt: 1, running: false, blank: false, projections: { asOfSeq: 0, values: { title: "Official" } } }] }; },
          async search(request: { query: string }) { if (typeof request?.query !== "string") throw new TypeError("search request must contain a query string"); return { items: [{ sessionId: "official-search", snippet: request.query }], hasMore: false }; },
          async page() { return { records: [{ type: "event", event: { type: "user/message", seq: 0, time: 1, data: { content: [{ type: "text", text: "official-page" }], source: { kind: "user" } } } }], hasMore: false }; },
          async *follow() { yield { type: "snapshot", header: { version: 0, id: "official-session", createdAt: 1 }, cursor: 0, records: [], hasMore: false, projections: { asOfSeq: 0, values: {} } }; },
          async *control() { yield { type: "baseline", value: { queues: { "official-session": [] }, jobs: { "official-session": [] }, projections: {} } }; },
          async modelCatalog() { return { default: { provider: "official", model: "model" }, routableProviders: ["official"], groups: [], failures: [{ provider: "broken", message: "isolated" }] }; },
          async attachment(request: { attachmentId: string }) { return { attachment: { attachmentId: request.attachmentId, mediaType: "image/png", bytes: 1, width: 1, height: 1 }, data: "AA==" }; },
          async create(request: { sessionId?: string }) { officialSessionWriteCalls.push("create"); return { sessionId: request.sessionId ?? "official-created" }; },
          async selectModel(request: { provider: string; model: string }) { officialSessionWriteCalls.push("selectModel"); return { selected: { provider: request.provider, model: request.model } }; },
          async rename(request: { title: string }) { officialSessionWriteCalls.push("rename"); return { title: request.title, seq: 7 }; },
          async fork() { officialSessionWriteCalls.push("fork"); return { sessionId: "official-fork" }; },
          async prompt() { officialSessionWriteCalls.push("prompt"); return { accepted: true }; },
          cancel() { officialSessionWriteCalls.push("cancel"); return { accepted: true }; },
          updateQueue() { officialSessionWriteCalls.push("updateQueue"); return { accepted: true }; },
        };
        if (name === "workspaceController") return {
          async create(request: { path: string }) { return { workspace: { workspaceId: "official-workspace", path: request.path, title: "Official", sessionIds: [], createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" }, created: true }; },
          async *follow() { yield { type: "baseline", value: { items: [{ workspaceId: "official-workspace", path: cwd, title: "Official", sessionIds: [], createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" }], archivedSessionIds: ["official-archived"] } }; },
        };
        if (name === "credentialsController") return {
          async describe(refs: string[]) { return Object.fromEntries(refs.map(ref => [ref, { configured: credentialValues.has(ref), ...(credentialValues.has(ref) ? { source: "official-test" } : {}), writable: true }])); },
          async set(ref: string, value: string) { credentialValues.set(ref, value); },
          async unset(ref: string) { credentialValues.delete(ref); },
        };
        if (name === "commands") return {
          list(agent: { id: string }) { return [{ name: "plan", description: `Plan for ${agent.id}`, input: { hint: "on|off" } }]; },
          async execute(agent: { id: string }, line: string, images: unknown[]) { return /^\/(?:plan|feedback)(?:\s|$)/.test(line) ? { commandId: `dsh-${agent.id}`, result: images.length > 0 ? { kind: "error", text: "invalid image attachment" } : { kind: "success", text: line } } : undefined; },
        };
        if (name === "subagents") return {
          async remoteExportList(parentSessionId: string) { officialSubagentCalls.push(`list:${parentSessionId}`); return { parentAvailable: true, entries: [{ kind: "child", id: "official-child", mode: "continuable", activity: "inactive", label: "Official child", hasChildren: false }] }; },
          async prompt(request: { parentSessionId: string; childSessionId: string; requestId: string }) { officialSubagentCalls.push(`prompt:${request.parentSessionId}:${request.childSessionId}`); return { messageId: `official-${request.requestId}` }; },
          interruptByParent(childSessionId: string, parentSessionId: string) { officialSubagentCalls.push(`interrupt:${parentSessionId}:${childSessionId}`); return { accepted: true }; },
        };
        if (name === "goals") return {
          create(agent: { id: string }, request: { objective: string }) { officialGoalCalls.push(`create:${agent.id}`); return { id: "official-goal", revision: 1, objective: request.objective, phase: "active", maxGoalRounds: 256 }; },
          edit(agent: { id: string }, ref: { revision: number }, request: { objective: string }) { officialGoalCalls.push(`edit:${agent.id}`); return { id: "official-goal", revision: ref.revision + 1, objective: request.objective, phase: "active", maxGoalRounds: 256 }; },
          pause(agent: { id: string }, ref: { revision: number }) { officialGoalCalls.push(`pause:${agent.id}`); return { id: "official-goal", revision: ref.revision + 1, objective: "edited", phase: "paused", maxGoalRounds: 256 }; },
          clear(agent: { id: string }, ref: { revision: number }) { officialGoalCalls.push(`clear:${agent.id}`); return { id: "official-goal", revision: ref.revision + 1 }; },
        };
        if (name === "agentPresets") return {
          async remoteExportList() { return { presets: [{ id: "standard", trust: "system", isDefault: true }], authorable: true }; },
          async readDocument(id: string) {
            if (id === "missing") throw Object.assign(new Error("preset missing"), { isDSHRemoteError: true, code: "agent-preset/not-found", details: { agentPreset: id, available: ["standard"] } });
            return { agentPreset: id, trust: "system", content: "[]\n" };
          },
          async remoteExportCopy() {}, async remoteExportDelete() {},
          async select(agent: { id: string }, id: string) { throw Object.assign(new Error("preset is locked"), { isDSHRemoteError: true, code: "agent-preset/locked", details: { sessionId: agent.id, agentPreset: id } }); },
          async compositionInventory() { return [{ id: "standard", trust: "system", isDefault: true, rows: [{ entryId: "tools", moduleName: "@deepseek-ai/dsh-tools", enabled: true, fiberState: 2 }] }]; },
          async resolve(id: string) { return { id, trust: "system" as const, path: join(cwd, id, "agent.cordis.yml") }; },
          serviceFor(agent: { id?: string }, service: string) {
            if (service === "skills") return { async list(options: { scope?: unknown }) { return [{ name: "preset-visible", description: `Preset skill ${String((options.scope as { id?: string } | undefined)?.id ?? "")}`, invocation: { modelInvocable: true, userInvocable: true } }]; } };
            if (service === "fileReferences") return { async list(_agent: unknown, query: string) { return [{ path: `preset/${String(agent.id)}/${query}.txt`, kind: "file" }]; } };
            if (service === "sessionReferenceResolver") return { async remoteExportCandidates(_agent: unknown, query: string) { return [{ sessionId: "reference-source", label: `Preset ${query}`, sameWorkspace: true, createdAt: 1, mention: "@[preset](dsh-session:cHJlc2V0)" }]; } };
            return undefined;
          },
          async standingKeyFor(id?: string) { return { id: `standing:${id ?? "default"}` }; },
        };
        if (name === "loader") return { *entries() { yield { id: "configured", disabled: false, options: { name: "@fixture/configured" }, fiber: { state: 3 } }; yield { id: "group", disabled: false, options: { name: "cordis:group", group: true } }; } };
        if (name === "pluginInventory") return { async list() { return { entries: [{ entryId: "official", moduleName: "@fixture/official", enabled: true, fiberPhase: "active" }], agentPresets: [{ id: "standard", trust: "system", isDefault: true, rows: [{ entryId: "tools", moduleName: "@deepseek-ai/dsh-tools", enabled: true, fiberPhase: "active" }] }] }; } };
        if (name === "agents") return {
          get(id: string) { return id === "cold" ? undefined : { id }; },
          async resume({ resumeSessionId }: { resumeSessionId: string }) { return { agent: { id: resumeSessionId }, async dispose() { dshResumeDisposals.push(resumeSessionId); } }; },
        };
        if (name === "llm") return {
          listProviders() { return [{ id: "scripted", name: "Scripted Provider" }, { id: "dormant", name: "Dormant Provider" }]; },
          listConfigurableProviders() { return [{ provider: "openai", displayName: "OpenAI", settingsNs: "llm-pi-ai", settingsPath: ["providers", "openai"], declared: false }]; },
        };
        return undefined;
      } } as any }); },
    });
    const profile = defineProfile([
      plugin(scriptedModelPlugin, {
        models: [{ provider: "scripted", model: "web", contextWindow: 1_000, maxOutputTokens: 100 }],
        async *respond() {
          yield { type: "text_delta", delta: "web-ok" };
          yield { type: "done", stopReason: "stop" };
        },
      }),
      plugin(memorySessionPlugin, {}),
      plugin(localAttachmentPlugin, { root: join(cwd, "attachments") }),
      plugin(commandsPlugin, undefined),
      plugin(feedbackToolsPlugin, { root: join(cwd, "feedback") }),
      plugin(goalToolsPlugin, {}),
      plugin(permissionPresetsPlugin, {}),
      plugin(contextCorePlugin, { systemPrompt: "web test" }),
      plugin(basicPolicyPlugin, { mode: "workspace-write" }),
      plugin(toolsCorePlugin, {}),
      plugin(agentPresetsPlugin, {}),
      plugin(piRuntimePlugin, {}),
      plugin(agentCorePlugin, {}),
      plugin(controlsPlugin, undefined),
      plugin(credentialsPlugin, undefined),
      plugin(dshSurfacesPlugin, undefined),
    ]);
    const running = await startWebServer({ cwd, port: 0, profile });
    cleanup.push(() => running.close());

    const index = await fetch(running.url);
    expect(index.status).toBe(200);
    const indexText = await index.text();
    expect(indexText).toContain("Seal Harness");
    expect(indexText).toContain('data-pane="sidebar"');
    expect(indexText).toContain('data-pane="conversation"');
    expect(indexText).toContain("data-conversation-scroll");
    expect(indexText).toContain("data-composer-card");
    expect(indexText).toContain('id="settings-modal"');
    expect(indexText).toContain('data-settings-page="models"');
    expect(indexText).toContain('id="model-catalog-count"');
    expect(indexText).toContain('id="model-details"');
    expect(indexText).toContain('data-settings-page="plugins"');
    expect(indexText).toContain('id="session-state"');
    expect(indexText).toContain('id="state-cards"');
    expect(indexText).toContain('id="agent-preset"');
    expect(indexText).toContain('id="attachment-input"');
    expect(indexText).toContain('id="busy-enter"');
    expect(indexText).toContain('id="transcript-view"');
    expect(indexText).toContain('id="sidebar-toggle"');
    expect(indexText).toContain('id="sidebar-resize"');
    expect(indexText).toContain('id="content-resize-left"');
    expect(indexText).toContain('id="content-resize-right"');
    expect(indexText).toContain('id="permission-risk-dialog"');
    expect(indexText).toContain('id="permission-risk-ack"');
    expect(indexText).toContain('id="add-workspace"');
    expect(indexText).toContain('/app.js?v=0.3.4-241');
    expect(indexText).not.toContain('id="credential-onboarding"');
    expect(indexText).toContain('id="model-settings-open"');
    expect(indexText).toContain('id="agent-preset-copy-dialog"');
    expect(indexText).toContain('id="agent-preset-delete-dialog"');
    expect(indexText).toContain('id="agent-preset-management"');
    expect(indexText).toContain('"react/jsx-runtime":"/vendor/react-runtime.mjs?v=0.3.4-7"');
    expect(indexText).toContain('"react-dom":"/vendor/react-runtime.mjs?v=0.3.4-7"');
    expect(indexText).toContain('/client-bootstrap.js?v=0.3.4-12');
    expect(indexText).toContain('id="turn-navigator"');
    expect(indexText).toContain('id="session-group-by"');
    expect(indexText).toContain('id="session-search-input"');
    expect(indexText).toContain('id="session-breadcrumbs"');
    expect(indexText).toContain('/styles.css?v=0.3.4-120');
    expect(indexText).toContain('<link rel="manifest" href="/manifest.webmanifest" crossorigin="use-credentials">');
    expect(indexText).toContain('id="plugin-inventory-search"');
    expect(indexText).toContain('id="workspace-rename-dialog"');
    expect(indexText).toContain('id="workspace-remove-dialog"');
    expect(indexText).toContain('id="session-rename-dialog"');
    expect(indexText).toContain('id="plugin-remove-dialog"');
    expect(indexText).toContain('id="goal-dock"');
    expect(indexText).toContain('id="todo-dock"');
    expect(indexText).toContain('id="queue-dock"');
    expect(indexText).toContain('/vendor/client-runtime.css?v=0.3.4-2');
    expect(indexText).toContain('id="locale"');
    expect(index.headers.get("cache-control")).toBe("no-cache");
    const appModule = await fetch(`${running.url}/app.js`);
    expect(appModule.status).toBe(200);
    expect(appModule.headers.get("content-encoding")).toBe("gzip");
    expect(appModule.headers.get("vary")).toBe("accept-encoding");
    const appText = await appModule.text(); expect(appText).toContain("appendReasoningDelta(assistant, event.delta)");
    expect(appText).toContain("event.result.details ?? event.result.meta");
    const rootImports = [...appText.matchAll(/from \"\/(.+?\.js)(?:\?[^\"]*)?\"/g)].map((match) => match[1]!);
    expect(rootImports).toContain("directory-browser.js");
    for (const imported of rootImports) {
      const module = await fetch(`${running.url}/${imported}`);
      expect(module.status, `root client module /${imported}`).toBe(200);
      expect(module.headers.get("content-type")).toContain("text/javascript");
    }
    expect((await fetch(`${running.url}/missing-client-helper.js`)).status).toBe(404);
    const uncompressedApp = await fetch(`${running.url}/app.js`, { headers: { "accept-encoding": "identity" } });
    expect(uncompressedApp.headers.get("content-encoding")).toBeNull();
    expect(uncompressedApp.headers.get("vary")).toBe("accept-encoding");
    expect(await (await fetch(`${running.url}/app.js`)).text()).toContain("function applyTranscriptView()");
    const layoutModule = await fetch(`${running.url}/layout.js`);
    expect(layoutModule.status).toBe(200);
    expect(await layoutModule.text()).toContain("export function computeColumns");
    const conversationWidthModule = await fetch(`${running.url}/conversation-width.js`);
    expect(conversationWidthModule.status).toBe(200);
    expect(await conversationWidthModule.text()).toContain("export function resolveContentWidth");
    const pendingInteractionModule = await fetch(`${running.url}/pending-interaction.js`);
    expect(pendingInteractionModule.status).toBe(200);
    expect(await pendingInteractionModule.text()).toContain("export function selectPendingInteraction");
    const stylesModule = await fetch(`${running.url}/styles.css`);
    expect(stylesModule.status).toBe(200);
    expect(await stylesModule.text()).toContain(".reasoning-content");
    const mascot = await fetch(`${running.url}/assets/seal-harness-mascot.png`);
    expect(mascot.status).toBe(200);
    expect(mascot.headers.get("content-type")).toBe("image/png");
    expect((await mascot.arrayBuffer()).byteLength).toBeGreaterThan(1_000);
    expect(mascot.headers.get("content-security-policy")).toContain("'sha256-E3SQIfHoNigirzojkfQFiN5doAfxnDW6T4UX/LFlXRc='");
    expect(await fetchJson(`${running.url}/api/dsh/skins`)).toEqual({ skins: [], target: "official" });
    const manifestResponse = await fetch(`${running.url}/manifest.webmanifest`);
    expect(manifestResponse.headers.get("content-type")).toContain("application/manifest+json");
    expect(await manifestResponse.json()).toMatchObject({ name: "Seal Harness", display: "standalone", start_url: "/" });
    const serviceWorker = await fetch(`${running.url}/sw.js`);
    expect(serviceWorker.headers.get("content-type")).toContain("text/javascript");
    const serviceWorkerText = await serviceWorker.text();
    expect(serviceWorkerText).toContain('url.pathname.startsWith("/api/")');
    expect(serviceWorkerText).toContain('url.searchParams.has("token")');
    const i18nModule = await fetch(`${running.url}/i18n.js`); expect(i18nModule.status).toBe(200); expect(i18nModule.headers.get("content-type")).toContain("text/javascript"); expect(await i18nModule.text()).toContain('"zh-CN"');
    const inputTriggerMenu = await fetch(`${running.url}/input-trigger-menu.js`); expect(inputTriggerMenu.status).toBe(200); expect(await inputTriggerMenu.text()).toContain("inputTriggerKeyAction");
    const katexModule = await fetch(`${running.url}/vendor/katex.mjs`); expect(katexModule.status).toBe(200); expect(katexModule.headers.get("content-type")).toContain("text/javascript");
    const katexCss = await fetch(`${running.url}/vendor/katex.css`); expect(await katexCss.text()).toContain("@font-face");
    const katexFont = await fetch(`${running.url}/vendor/fonts/KaTeX_Main-Regular.woff2`); expect(katexFont.status).toBe(200); expect(katexFont.headers.get("content-type")).toBe("font/woff2");
    const highlightModule = await fetch(`${running.url}/vendor/highlight.mjs`); expect(await highlightModule.text()).toContain("Highlight.js v11.12.0");
    const highlightCss = await fetch(`${running.url}/vendor/highlight.css`); expect(await highlightCss.text()).toContain(".hljs");
    const clientRuntime = await fetch(`${running.url}/vendor/client-runtime.mjs`); const clientRuntimeText = await clientRuntime.text(); expect(clientRuntime.status).toBe(200); expect(clientRuntimeText).toContain("SealDshPlugins"); expect(clientRuntimeText).not.toMatch(/^import .* from ["'][^./]/m);
    const clientBootstrap = await fetch(`${running.url}/client-bootstrap.js`); const clientBootstrapText = await clientBootstrap.text(); expect(clientBootstrap.status).toBe(200); expect(clientBootstrapText).toContain('location.hash === "#dsh-shell"'); expect(clientBootstrapText).toContain("mountOfficialShell(container)");
    const legacyApp = await fetch(`${running.url}/app.js?v=0.3.4-199`); const legacyAppText = await legacyApp.text(); expect(legacyApp.status).toBe(200); expect(legacyAppText).toContain('globalThis.location?.hash !== "#dsh-shell"');
    const clientRuntimeCss = await fetch(`${running.url}/vendor/client-runtime.css`); expect(clientRuntimeCss.status).toBe(200); expect(await clientRuntimeCss.text()).toContain("--dsh-state-ongoing");
    const registered = await postJson(`${running.url}/api/workspaces`, { path: cwd, title: "Primary workspace" });
    expect(registered).toMatchObject({ status: 201, body: { path: cwd, title: "Primary workspace" } });
    expect(await fetchJson(`${running.url}/api/workspaces`)).toEqual([expect.objectContaining({ id: registered.body.id, sessionIds: [] })]);
    expect((await requestJson(`${running.url}/api/workspaces/${encodeURIComponent(registered.body.id)}`, { title: "Renamed workspace" }))).toMatchObject({ status: 200, body: { title: "Renamed workspace" } });
    const uploaded = await postJson(`${running.url}/api/attachments`, { name: "notes.txt", mimeType: "text/plain", data: attachmentData.toString("base64") });
    expect(uploaded).toMatchObject({ status: 201, body: { type: "attachment", id: attachmentId, name: "notes.txt" } });
    expect((await postJson(`${running.url}/api/attachments`, { name: "bad.txt", mimeType: "text/plain", data: "not base64" })).status).toBe(400);
    expect((await postJson(`${running.url}/api/attachments`, { name: "fake.png", mimeType: "image/png", data: Buffer.from("not an image").toString("base64") })).status).toBe(400);
    const downloaded = await fetch(`${running.url}/api/attachments/${encodeURIComponent(attachmentId)}?name=notes.txt&mimeType=text%2Fplain`);
    expect(downloaded.headers.get("content-disposition")).toContain("attachment;"); expect(await downloaded.text()).toBe("attachment-body");
    const models = await fetchJson(`${running.url}/api/models`);
    expect(models).toEqual([expect.objectContaining({ provider: "scripted", model: "web" })]);
    expect(await fetchJson(`${running.url}/api/dsh/llm/providers`)).toEqual([
      { id: "scripted", name: "Scripted Provider" }, { id: "dormant", name: "Dormant Provider" },
    ]);
    expect(await fetchJson(`${running.url}/api/dsh/commands?sessionId=command-session`)).toEqual([
      { name: "plan", description: "Plan for command-session", input: { hint: "on|off" } },
    ]);
    expect((await postJson(`${running.url}/api/dsh/llm/discover-models`, { settingsNs: "llm-pi-ai", provider: "scripted" })).body).toEqual([
      { id: "web", contextWindow: 1_000, maxTokens: 100 },
    ]);
    expect(await fetchJson(`${running.url}/api/dsh/llm/configurable-providers`)).toEqual([
      { provider: "openai", displayName: "OpenAI", settingsNs: "llm-pi-ai", settingsPath: ["providers", "openai"], declared: false },
    ]);
    expect(await fetchJson(`${running.url}/api/dsh/settings/describe`)).toMatchObject({ writable: true, namespaces: [{ ns: "llm-pi-ai", revision: 4 }] });
    expect((await requestJson(`${running.url}/api/dsh/settings/llm-pi-ai`, { value: { providers: { openai: {} } }, expectedRevision: 4 })).body).toMatchObject({ ns: "llm-pi-ai", revision: 5 });
    expect(await postJson(`${running.url}/api/dsh/llm/discover-models`, { settingsNs: "llm-unknown", provider: "scripted" })).toMatchObject({
      status: 409, body: { code: "llm/model-discovery-rejected", details: { settingsNs: "llm-unknown" } },
    });
    expect((await postJson(`${running.url}/api/dsh/credentials`, { operation: "describe", refs: ["SCRIPTED_API_KEY"] })).body).toEqual({ SCRIPTED_API_KEY: { configured: false, writable: true } });
    expect((await fetch(`${running.url}/api/dsh/credentials`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ operation: "set", ref: "SCRIPTED_API_KEY", value: "secret-value" }) })).status).toBe(204);
    expect((await postJson(`${running.url}/api/dsh/credentials`, { operation: "describe", refs: ["SCRIPTED_API_KEY"] })).body).toEqual({ SCRIPTED_API_KEY: { configured: true, source: "official-test", writable: true } });
    expect((await fetch(`${running.url}/api/dsh/credentials`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ operation: "unset", ref: "SCRIPTED_API_KEY" }) })).status).toBe(204);
    expect((await postJson(`${running.url}/api/dsh/directory-picker`, { operation: "list" })).body).toEqual({ path: cwd, entries: [], crumbs: [] });
    expect((await postJson(`${running.url}/api/dsh/directory-picker`, { operation: "createDirectory", path: cwd, name: "child" })).body).toBe(join(cwd, "child"));
    expect((await fetch(`${running.url}/test-native-route`)).status).toBe(204);
    const pendingQuestion = running.questionAnswerer.answer({
      sessionId: "question-session" as never,
      questions: [{ id: "mode", question: "Choose mode", options: [{ label: "Safe" }] }],
    });
    const questions = await fetchJson(`${running.url}/api/questions`) as Array<{ id: string }>;
    expect(questions).toHaveLength(1);
    expect((await fetch(`${running.url}/api/questions/${encodeURIComponent(questions[0]!.id)}`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ answers: [{ id: "mode", selected: ["Safe"] }] }),
    })).status).toBe(200);
    await expect(pendingQuestion).resolves.toEqual({ answers: [{ id: "mode", selected: ["Safe"] }] });

    const response = await fetch(`${running.url}/api/runs`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ cwd, provider: "scripted", model: "web", prompt: "hello", attachments: [uploaded.body] }),
    });
    expect(response.status).toBe(200);
    const events = (await response.text()).trim().split("\n").map((line) => JSON.parse(line));
    expect(events).toContainEqual(expect.objectContaining({
      type: "event", event: { type: "text_delta", delta: "web-ok" },
    }));
    expect(events).toContainEqual(expect.objectContaining({ type: "completed", stopReason: "stop" }));
    const started = events.find((item) => item.type === "started");

    const sessions = await fetchJson(`${running.url}/api/sessions`) as Array<{ id: string }>;
    expect(sessions).toHaveLength(1);
    expect(sessions[0]?.id).toBe(started.sessionId);
    expect((await postJson(`${running.url}/api/dsh/skills`, { sessionId: started.sessionId })).body).toEqual({ skills: [{ name: "preset-visible", description: `Preset skill ${started.sessionId}`, modelInvocable: true }] });
    expect(await fetchJson(`${running.url}/api/sessions/search?query=hello`)).toEqual({ items: [{ sessionId: "official-search", snippet: "hello" }], hasMore: false });
    const renamedSession = await requestJson(`${running.url}/api/sessions/${encodeURIComponent(started.sessionId)}/title`, { title: "Named session" });
    expect(renamedSession.status, JSON.stringify({ body: renamedSession.body, events: (await running.kernel.use(sessionStoreToken).read(sessionId(started.sessionId)))?.events.slice(-4) })).toBe(200);
    expect(renamedSession.body).toMatchObject({ title: "Named session", seq: expect.any(Number) });
    expect(await fetchJson(`${running.url}/api/sessions`)).toEqual([expect.objectContaining({ id: started.sessionId, preview: "Named session" })]);
    expect(await fetchJson(`${running.url}/api/workspaces`)).toEqual([expect.objectContaining({ title: "Renamed workspace", sessionIds: [started.sessionId] })]);
    expect((await requestJson(`${running.url}/api/sessions/${encodeURIComponent(started.sessionId)}/archived`, { archived: true })).status).toBe(200);
    expect(await fetchJson(`${running.url}/api/workspaces`)).toEqual([expect.objectContaining({ sessionIds: [] })]);
    expect(await fetchJson(`${running.url}/api/sessions`)).toEqual([]);
    expect(await fetchJson(`${running.url}/api/archived-sessions`)).toEqual([expect.objectContaining({ id: started.sessionId })]);
    expect((await requestJson(`${running.url}/api/sessions/${encodeURIComponent(started.sessionId)}/archived`, { archived: false })).status).toBe(200);
    const session = await fetchJson(`${running.url}/api/sessions/${encodeURIComponent(started.sessionId)}`) as any;
    expect(session.messages).toEqual(expect.arrayContaining([
      expect.objectContaining({ role: "system-prompt", text: expect.stringContaining("web test") }),
      expect.objectContaining({ role: "user", content: expect.arrayContaining([expect.objectContaining({ type: "attachment", id: attachmentId })]) }),
      expect.objectContaining({ role: "assistant" }),
    ]));
    expect(await fetchJson(`${running.url}/api/commands`)).toEqual(expect.arrayContaining([expect.objectContaining({ name: "feedback" })]));
    expect(await fetchJson(`${running.url}/api/agent-presets`)).toEqual(expect.objectContaining({ defaultPreset: "standard", presets: expect.arrayContaining([expect.objectContaining({ id: "minimal" })]) }));
    expect(await fetchJson(`${running.url}/api/dsh/agent-presets`)).toEqual({ presets: [{ id: "standard", trust: "system", isDefault: true }], authorable: true });
    const presetDocument = await fetch(`${running.url}/api/dsh/agent-presets`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ operation: "read", agentPreset: "standard" }) });
    expect(await presetDocument.json()).toEqual({ agentPreset: "standard", trust: "system", content: "[]\n" });
    const missingPreset = await fetch(`${running.url}/api/dsh/agent-presets`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ operation: "read", agentPreset: "missing" }) });
    expect(missingPreset.status).toBe(404); expect(await missingPreset.json()).toMatchObject({ code: "agent-preset/not-found", details: { agentPreset: "missing", available: ["standard"] } });
    expect(await fetchJson(`${running.url}/api/dsh/plugin-inventory`)).toMatchObject({
      entries: [{ entryId: "official", moduleName: "@fixture/official", enabled: true, fiberPhase: "active" }],
      agentPresets: [{ id: "standard", trust: "system", isDefault: true, rows: [{ entryId: "tools", moduleName: "@deepseek-ai/dsh-tools", enabled: true, fiberPhase: "active" }] }],
    });
    expect(await fetchJson(`${running.url}/api/dsh/settings/capabilities`)).toEqual({ canOpenAgentPresetDirectory: false });
    expect(await fetchJson(`${running.url}/api/dsh/session/capabilities`)).toEqual({ canOpenWorkspacePath: false });
    expect(await postJson(`${running.url}/api/dsh/session/read`, { operation: "list" })).toMatchObject({ status: 200, body: { available: true, value: { items: [{ sessionId: "official-session", projections: { values: { title: "Official" } } }] } } });
    expect(await postJson(`${running.url}/api/dsh/session/read`, { operation: "search", request: { query: "needle" } })).toMatchObject({ status: 200, body: { available: true, value: { items: [{ sessionId: "official-search", snippet: "needle" }] } } });
    expect(await fetchJson(`${running.url}/api/sessions/search?query=needle`)).toEqual({ items: [{ sessionId: "official-search", snippet: "needle" }], hasMore: false });
    expect(await postJson(`${running.url}/api/dsh/session/read`, { operation: "modelCatalog" })).toMatchObject({ status: 200, body: { available: true, value: { failures: [{ provider: "broken", message: "isolated" }] } } });
    expect(await postJson(`${running.url}/api/dsh/session/read`, { operation: "attachment", request: { sessionId: started.sessionId, attachmentId: "sha256:official" } })).toMatchObject({ status: 200, body: { available: true, value: { attachment: { attachmentId: "sha256:official" }, data: "AA==" } } });
    const sessionWrites = [
      ["create", { sessionId: "requested" }], ["selectModel", { sessionId: started.sessionId, provider: "official", model: "model" }],
      ["rename", { sessionId: started.sessionId, title: "Official title" }], ["fork", { sessionId: started.sessionId }],
      ["prompt", { sessionId: started.sessionId, requestId: "official-request", mode: "queue", content: [] }], ["cancel", { sessionId: started.sessionId }],
      ["updateQueue", { sessionId: started.sessionId, itemId: "queued", action: { kind: "remove" } }],
    ] as const;
    for (const [operation, request] of sessionWrites) expect(await postJson(`${running.url}/api/dsh/session/write`, { operation, request })).toMatchObject({ status: 200, body: { available: true } });
    expect(officialSessionWriteCalls).toEqual(sessionWrites.map(([operation]) => operation));
    expect(await postJson(`${running.url}/api/dsh/session/page`, { address: { kind: "session", sessionId: started.sessionId }, throughSeq: 0 })).toMatchObject({ status: 200, body: { records: [{ event: { data: { content: [{ text: "official-page" }] } } }] } });
    expect(await postJson(`${running.url}/api/dsh/workspace`, { operation: "create", path: cwd })).toMatchObject({ status: 200, body: { available: true, value: { created: true, workspace: { workspaceId: "official-workspace", path: cwd } } } });
    expect(await postJson(`${running.url}/api/dsh/goals`, { operation: "create", sessionId: started.sessionId, request: { objective: "official" } })).toMatchObject({ status: 200, body: { available: true, value: { id: "official-goal", revision: 1, phase: "active" } } });
    expect(await postJson(`${running.url}/api/dsh/goals`, { operation: "edit", sessionId: started.sessionId, ref: { id: "official-goal", revision: 1 }, request: { objective: "edited" } })).toMatchObject({ status: 200, body: { value: { revision: 2, objective: "edited" } } });
    expect(await postJson(`${running.url}/api/dsh/goals`, { operation: "pause", sessionId: started.sessionId, ref: { id: "official-goal", revision: 2 } })).toMatchObject({ status: 200, body: { value: { revision: 3, phase: "paused" } } });
    expect(await postJson(`${running.url}/api/dsh/goals`, { operation: "clear", sessionId: started.sessionId, ref: { id: "official-goal", revision: 3 } })).toMatchObject({ status: 200, body: { value: { revision: 4 } } });
    expect(officialGoalCalls).toEqual([`create:${started.sessionId}`, `edit:${started.sessionId}`, `pause:${started.sessionId}`, `clear:${started.sessionId}`]);
    const workspaceSocket = new WsClient(running.url.replace(/^http/, "ws") + "/api/remote.mux");
    await new Promise<void>((resolve, reject) => { workspaceSocket.once("open", resolve); workspaceSocket.once("error", reject); });
    const workspaceFrames: any[] = []; workspaceSocket.on("message", (data) => workspaceFrames.push(JSON.parse(data.toString())));
    workspaceSocket.send(JSON.stringify({ type: "open", streamId: "official-workspace", endpoint: "workspace/follow", payload: { args: {} } }));
    workspaceSocket.send(JSON.stringify({ type: "open", streamId: "official-session-follow", endpoint: "session/follow", payload: { args: { request: { address: { kind: "session", sessionId: started.sessionId } } } } }));
    workspaceSocket.send(JSON.stringify({ type: "open", streamId: "official-session-control", endpoint: "session/control", payload: { args: {} } }));
    await vi.waitFor(() => expect(workspaceFrames).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: "item", streamId: "official-workspace", value: expect.objectContaining({ type: "baseline", value: expect.objectContaining({ archivedSessionIds: ["official-archived"] }) }) }),
      expect.objectContaining({ type: "item", streamId: "official-session-follow", value: expect.objectContaining({ type: "snapshot", header: expect.objectContaining({ id: "official-session" }) }) }),
      expect.objectContaining({ type: "item", streamId: "official-session-control", value: expect.objectContaining({ type: "baseline", value: expect.objectContaining({ queues: { "official-session": [] } }) }) }),
    ])));
    workspaceSocket.close();
    const emptyWorkspacePath = await fetch(`${running.url}/api/dsh/session/open-workspace-path`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ path: "" }) });
    expect(emptyWorkspacePath.status).toBe(400);
    const officialWorkspacePath = await fetch(`${running.url}/api/dsh/session/open-workspace-path`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ path: "notes/demo.txt" }) });
    expect(await officialWorkspacePath.json()).toEqual({ opened: true, path: "notes/demo.txt", source: "official-test" });
    const readOnlyPreset = await fetch(`${running.url}/api/dsh/settings/open-agent-preset-directory`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ agentPreset: "standard" }) });
    expect(readOnlyPreset.status).toBe(409); expect(await readOnlyPreset.json()).toMatchObject({ code: "agent-preset/read-only", details: { agentPreset: "standard" } });
    const command = await fetch(`${running.url}/api/sessions/${encodeURIComponent(started.sessionId)}/commands`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ line: "/feedback useful run" }) });
    expect(command.status).toBe(200);
    expect(await command.json()).toEqual(expect.objectContaining({ result: expect.objectContaining({ kind: "success" }) }));
    const lockedPreset = await fetch(`${running.url}/api/sessions/${encodeURIComponent(started.sessionId)}/agent-preset`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ agentPreset: "minimal" }) });
    expect(lockedPreset.status).toBe(409); expect(await lockedPreset.json()).toMatchObject({ code: "agent-preset/locked", details: { sessionId: started.sessionId, agentPreset: "minimal" } });
    const coldPreset = await fetch(`${running.url}/api/sessions/cold/agent-preset`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ agentPreset: "minimal" }) });
    expect(coldPreset.status).toBe(409); expect(dshResumeDisposals).toEqual(["cold"]);
    expect(await fetchJson(`${running.url}/api/dsh/commands?sessionId=cold`)).toEqual([
      { name: "plan", description: "Plan for cold", input: { hint: "on|off" } },
    ]);
    expect(dshResumeDisposals).toEqual(["cold", "cold"]);
    const unknownCommand = await fetch(`${running.url}/api/sessions/${encodeURIComponent(started.sessionId)}/commands`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ line: "/does-not-exist", images: [] }) });
    expect(unknownCommand.status).toBe(200); expect(await unknownCommand.json()).toBeNull();
    const imageCommand = await fetch(`${running.url}/api/sessions/${encodeURIComponent(started.sessionId)}/commands`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ line: "/feedback useful", images: [{ data: "x" }] }) });
    expect(imageCommand.status).toBe(200); expect(await imageCommand.json()).toEqual(expect.objectContaining({ result: { kind: "error", text: "invalid image attachment" } }));
    const assistantMessage = session.messages.find((message: any) => message.role === "assistant");
    expect(assistantMessage).toMatchObject({ turnCompleted: true, atSeq: expect.any(Number), turnUsage: { inputTokens: expect.any(Number), outputTokens: expect.any(Number) }, turnDurationMs: expect.any(Number), turnModel: { provider: "scripted", model: "web" } });
    expect(await fetchJson(`${running.url}/api/sessions/${encodeURIComponent(started.sessionId)}/messages`)).toMatchObject({ messages: expect.arrayContaining([expect.objectContaining({ messageId: assistantMessage.messageId, atSeq: assistantMessage.atSeq })]) });
    expect(await fetchJson(`${running.url}/api/sessions/${encodeURIComponent(started.sessionId)}/state`)).toMatchObject({ contextPressure: { pressureTokens: expect.any(Number), contextWindow: 1_000 } });
    expect(await fetchJson(`${running.url}/api/sessions/${encodeURIComponent(started.sessionId)}/trajectory?limit=5`)).toMatchObject({ sessionId: started.sessionId, records: expect.any(Array), window: { end: expect.any(Number), total: expect.any(Number), hasMore: expect.any(Boolean) } });
    expect(await fetchJson(`${running.url}/api/sessions/${encodeURIComponent(started.sessionId)}/trajectory`)).toMatchObject({ records: expect.arrayContaining([expect.objectContaining({ seq: expect.any(Number), type: "turn/end", data: expect.any(Object) })]) });
    const feedbackUrl = `${running.url}/api/sessions/${encodeURIComponent(started.sessionId)}/feedback/${encodeURIComponent(assistantMessage.messageId)}`;
    const feedbackResponse = await fetch(feedbackUrl, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ rating: "up", note: "Useful because it cites the exact file.", ifVersion: null }) });
    expect(feedbackResponse.status).toBe(200);
    const feedback = await feedbackResponse.json() as { version: string };
    expect(await fetchJson(`${running.url}/api/sessions/${encodeURIComponent(started.sessionId)}/feedback`)).toEqual([expect.objectContaining({ rating: "up", note: "Useful because it cites the exact file." })]);
    const preservedResponse = await fetch(feedbackUrl, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ rating: "down", note: "Useful because it cites the exact file.", ifVersion: feedback.version }) });
    expect(preservedResponse.status).toBe(200);
    const preserved = await preservedResponse.json() as { version: string };
    const dshFeedbackList = await postJson(`${running.url}/api/dsh/message-feedback`, { operation: "list", request: { sessionId: started.sessionId } });
    expect(dshFeedbackList).toMatchObject({ status: 200, body: { ok: true, value: { items: [expect.objectContaining({ rating: "negative", note: "Useful because it cites the exact file.", version: preserved.version, createdAt: expect.any(Number) })] } } });
    const dshFeedbackPut = await postJson(`${running.url}/api/dsh/message-feedback`, { operation: "put", request: { sessionId: started.sessionId, messageId: assistantMessage.messageId, rating: "positive", ifVersion: preserved.version } });
    expect(dshFeedbackPut).toMatchObject({ status: 200, body: { ok: true, value: expect.objectContaining({ rating: "positive" }) } });
    const dshVersion = (dshFeedbackPut.body as any).value.version;
    expect(await postJson(`${running.url}/api/dsh/message-feedback`, { operation: "put", request: { sessionId: started.sessionId, messageId: assistantMessage.messageId, rating: "negative", ifVersion: feedback.version } })).toMatchObject({ status: 200, body: { ok: false, error: { code: "version-conflict", current: { rating: "positive", version: dshVersion } } } });
    expect(await postJson(`${running.url}/api/dsh/message-feedback`, { operation: "delete", request: { sessionId: started.sessionId, messageId: assistantMessage.messageId, ifVersion: dshVersion } })).toEqual({ status: 200, body: { ok: true, value: { absent: true } } });
    expect((await fetch(feedbackUrl, { method: "DELETE", headers: { "content-type": "application/json" }, body: JSON.stringify({ ifVersion: feedback.version }) })).status).toBe(200);
    const encodedSession = encodeURIComponent(started.sessionId);
    expect(await fetchJson(`${running.url}/api/sessions/${encodedSession}/state`)).toEqual({
      goal: null, todos: null, plan: null, permissions: expect.objectContaining({ currentValue: "workspace-write" }), agentPreset: "standard", jobs: [], terminals: [], subagents: [], schedules: [], contextPressure: { pressureTokens: expect.any(Number), contextWindow: 1_000 },
    });
    expect(await fetchJson(`${running.url}/api/sessions/${encodedSession}/permissions`)).toEqual(expect.objectContaining({ currentValue: "workspace-write" }));
    const switchedPermissions = await fetch(`${running.url}/api/sessions/${encodedSession}/permissions`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ preset: "danger-full-access" }) });
    expect(await switchedPermissions.json()).toEqual(expect.objectContaining({ currentValue: "danger-full-access" }));
    expect((await fetch(`${running.url}/api/sessions/${encodedSession}/jobs/job%2Fone/kill`, { method: "POST" })).status).toBe(200);
    expect((await fetch(`${running.url}/api/sessions/${encodedSession}/terminals/terminal%2Fone/kill`, { method: "POST" })).status).toBe(200);
    expect((await fetch(`${running.url}/api/sessions/${encodedSession}/subagents/child%2Fone/abort`, { method: "POST" })).status).toBe(200);
    expect((await fetch(`${running.url}/api/sessions/${encodedSession}/schedules/schedule%2Fone/delete`, { method: "POST" })).status).toBe(200);
    expect(controlCalls).toEqual([
      `job:${started.sessionId}:job/one:Cancelled from Web UI`,
      `terminal:${started.sessionId}:terminal/one`,
      `subagent:${started.sessionId}:child/one:Aborted from Web UI`,
      `schedule:${started.sessionId}:schedule/one`,
    ]);
    const forked = await postJson(`${running.url}/api/sessions/${encodedSession}/fork`, { atSeq: assistantMessage.atSeq });
    expect(forked).toMatchObject({ status: 201, body: { sessionId: expect.stringMatching(/^session-/) } });
    const invalidPreset = await postJson(`${running.url}/api/sessions`, { cwd, sessionId: "invalid-preset-session", agentPreset: "minimal" });
    expect(invalidPreset).toMatchObject({ status: 400, body: { code: "agent-preset/invalid" } });
    expect((await fetch(`${running.url}/api/sessions/invalid-preset-session`)).status).toBe(404);
    const created = await postJson(`${running.url}/api/sessions`, { cwd, sessionId: "remote-created", agentPreset: "standard" });
    expect(created).toEqual({ status: 201, body: { sessionId: "remote-created", agentPreset: "standard" } });
    expect(await postJson(`${running.url}/api/sessions`, { cwd, sessionId: "cold" })).toMatchObject({ status: 201 });
    expect(await postJson(`${running.url}/api/sessions`, { cwd, sessionId: "reference-source" })).toMatchObject({ status: 201 });
    expect(await requestJson(`${running.url}/api/sessions/reference-source/title`, { title: "Reference ] source" })).toMatchObject({ status: 200 });
    expect(await postJson(`${running.url}/api/dsh/session-references`, { sessionId: "remote-created", query: "reference ]" })).toEqual({ status: 200, body: [{ sessionId: "reference-source", label: "Preset reference ]", sameWorkspace: true, createdAt: 1, mention: "@[preset](dsh-session:cHJlc2V0)" }] });
    const disposalsBeforeColdSessionReference = dshResumeDisposals.length;
    expect(await postJson(`${running.url}/api/dsh/session-references`, { sessionId: "cold", query: "cold-reference" })).toMatchObject({ status: 200, body: [{ label: "Preset cold-reference" }] });
    expect(dshResumeDisposals.slice(disposalsBeforeColdSessionReference)).toEqual(["cold"]);
    await writeFile(join(cwd, "reference-target.txt"), "target");
    expect(await postJson(`${running.url}/api/dsh/file-references`, { sessionId: "remote-created", query: "reference-target" })).toEqual({ status: 200, body: [{ path: "preset/remote-created/reference-target.txt", kind: "file" }] });
    const disposalsBeforeColdReference = dshResumeDisposals.length;
    expect(await postJson(`${running.url}/api/dsh/file-references`, { sessionId: "cold", query: "cold-target" })).toEqual({ status: 200, body: [{ path: "preset/cold/cold-target.txt", kind: "file" }] });
    expect(dshResumeDisposals.slice(disposalsBeforeColdReference)).toEqual(["cold"]);
    expect(await postJson(`${running.url}/api/dsh/subagents`, { operation: "list", parentSessionId: "remote-created" })).toMatchObject({ status: 200, body: { parentAvailable: true, entries: [{ kind: "child", id: "official-child", mode: "continuable", activity: "inactive", label: "Official child", hasChildren: false }] } });
    expect(await postJson(`${running.url}/api/dsh/subagents`, { operation: "prompt", requestId: "request-child", parentSessionId: "remote-created", childSessionId: "official-child", mode: "continuable", content: [{ type: "text", text: "continue" }], clientTimeZone: "Asia/Shanghai" })).toEqual({ status: 200, body: { messageId: "official-request-child" } });
    expect(await postJson(`${running.url}/api/dsh/subagents`, { operation: "interruptByParent", parentSessionId: "remote-created", childSessionId: "official-child", mode: "continuable" })).toEqual({ status: 200, body: { accepted: true } });
    expect(officialSubagentCalls).toEqual(["list:remote-created", "prompt:remote-created:official-child", "interrupt:remote-created:official-child"]);
    const goalCreated = await postJson(`${running.url}/api/sessions/remote-created/goal`, { objective: "Ship remote goals", maxGoalRounds: 4 });
    expect(goalCreated).toMatchObject({ status: 201, body: { ref: { id: expect.stringMatching(/^goal-/), revision: 1 } } });
    const goalRef = (goalCreated.body as any).ref;
    expect(await requestJson(`${running.url}/api/sessions/remote-created/goal`, { ...goalRef, action: "pause" })).toMatchObject({ status: 200, body: { phase: "paused", revision: 2 } });
    const clearedGoal = await fetch(`${running.url}/api/sessions/remote-created/goal`, { method: "DELETE", headers: { "content-type": "application/json" }, body: JSON.stringify({ id: goalRef.id, revision: 2 }) });
    expect(clearedGoal.status, await clearedGoal.clone().text()).toBe(200);
    expect(await clearedGoal.json()).toEqual({ id: goalRef.id, revision: 3 });
    expect((await fetchJson(`${running.url}/api/sessions/remote-created/state`) as any).goal).toBeNull();
    const adopted = await postJson(`${running.url}/api/sessions`, { cwd, sessionId: "remote-created" });
    expect(adopted).toEqual({ status: 200, body: { sessionId: "remote-created", agentPreset: "standard" } });
    const selectedModel = await requestJson(`${running.url}/api/sessions/remote-created/model`, { provider: "scripted", model: "web" });
    expect(selectedModel).toEqual({ status: 200, body: { selected: { provider: "scripted", model: "web" } } });
    expect((await fetchJson(`${running.url}/api/sessions/remote-created`) as any).events).toEqual(expect.arrayContaining([expect.objectContaining({ event: expect.objectContaining({ type: "session.metadata", payload: { patch: { "sealHarness.modelSelection": { provider: "scripted", model: "web" } } } }) })]));
    const selectedRun = await fetch(`${running.url}/api/runs`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ cwd, sessionId: "remote-created", prompt: "use saved model" }) });
    expect(selectedRun.status).toBe(200); expect(await selectedRun.text()).toContain("web-ok");
    const remotePrompt = await postJson(`${running.url}/api/sessions/remote-created/prompt`, { requestId: "request-1", mode: "queue", content: [{ type: "text", text: "detached prompt" }] });
    expect(remotePrompt).toEqual({ status: 202, body: { accepted: true } });
    await vi.waitFor(async () => { const snapshot = await fetchJson(`${running.url}/api/sessions/remote-created`) as any; expect(snapshot.messages.filter((message: any) => message.role === "assistant").length).toBeGreaterThanOrEqual(2); });
    const correlated = await fetchJson(`${running.url}/api/sessions/remote-created`) as any;
    expect(correlated.messages.find((message: any) => message.role === "user" && message.content.some((block: any) => block.text === "detached prompt"))).toMatchObject({ source: { kind: "user-rpc", rpcId: "request-1" } });
    const pixel = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";
    expect(await postJson(`${running.url}/api/sessions/remote-created/prompt`, { requestId: "request-image", mode: "queue", content: [{ type: "image", mediaType: "image/png", data: pixel, name: "pixel.png" }] })).toEqual({ status: 202, body: { accepted: true } });
    let imageReference: any;
    await vi.waitFor(async () => { const snapshot = await fetchJson(`${running.url}/api/sessions/remote-created`) as any; imageReference = snapshot.messages.flatMap((message: any) => message.content ?? []).find((block: any) => block.type === "attachment" && block.name === "pixel.png"); expect(imageReference).toBeDefined(); });
    const attachmentRead = await fetchJson(`${running.url}/api/sessions/remote-created/attachments/${encodeURIComponent(imageReference.id)}`) as any;
    expect(attachmentRead).toMatchObject({ attachment: { attachmentId: imageReference.id, mediaType: imageReference.mimeType, width: 1, height: 1, name: "pixel.png" }, data: expect.any(String) });
    const scopedImage = await fetch(`${running.url}/api/sessions/remote-created/attachment-content/${encodeURIComponent(imageReference.id)}`);
    expect(scopedImage.status).toBe(200); expect(scopedImage.headers.get("content-type")).toBe(imageReference.mimeType); expect(Buffer.from(await scopedImage.arrayBuffer())).toEqual(Buffer.from(attachmentRead.data, "base64"));
    const crossSessionImage = await fetch(`${running.url}/api/sessions/cold/attachment-content/${encodeURIComponent(imageReference.id)}`);
    expect(crossSessionImage.status).toBe(404); expect(await crossSessionImage.json()).toMatchObject({ code: "session/attachment-invalid" });
    const inactiveCancel = await postJson(`${running.url}/api/sessions/remote-created/cancel`, {});
    expect(inactiveCancel).toMatchObject({ status: 409, body: { code: "session/agent-busy", details: { reason: "no active run" } } });
  });

  it("discovers, registers, authenticates, and runs a custom provider", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "seal-harness-web-custom-provider-"));
    cleanup.push(() => rm(cwd, { recursive: true, force: true }));
    const received: Array<{ path: string; authorization: string | undefined }> = [];
    const upstream = createServer((request, response) => {
      received.push({ path: request.url ?? "", authorization: request.headers.authorization });
      if (request.method === "GET" && request.url === "/v1/models") {
        response.writeHead(200, { "content-type": "application/json" });
        response.end(JSON.stringify({ data: [{ id: "web-remote", context_window: 8_000 }] }));
        return;
      }
      if (request.method === "POST" && request.url === "/v1/chat/completions") {
        response.writeHead(200, { "content-type": "text/event-stream" });
        response.write(`data: ${JSON.stringify({
          id: "chatcmpl-web", object: "chat.completion.chunk", created: 1, model: "web-remote",
          choices: [{ index: 0, delta: { role: "assistant", content: "custom-web-ok" }, finish_reason: null }],
        })}\n\n`);
        response.write(`data: ${JSON.stringify({
          id: "chatcmpl-web", object: "chat.completion.chunk", created: 1, model: "web-remote",
          choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
        })}\n\n`);
        response.end("data: [DONE]\n\n");
        return;
      }
      response.writeHead(404).end();
    });
    await new Promise<void>((resolvePromise) => upstream.listen(0, "127.0.0.1", resolvePromise));
    cleanup.push(() => new Promise<void>((resolvePromise, reject) => upstream.close((error) => error ? reject(error) : resolvePromise())));
    const address = upstream.address();
    if (address === null || typeof address === "string") throw new Error("Missing upstream address");
    const credentialEnvironment: Record<string, string | undefined> = {};
    const running = await startWebServer({
      cwd, port: 0, providers: ["deepseek"], credentialEnvironment,
    });
    cleanup.push(() => running.close());

    expect(await postJson(`${running.url}/api/dsh/llm/discover-models`, {
      settingsNs: "llm-pi-ai", baseURL: `http://127.0.0.1:${address.port}/v1`, apiKey: "custom-secret",
    })).toEqual({ status: 200, body: [{ id: "web-remote", contextWindow: 8_000 }] });

    const discovery = await fetch(`${running.url}/api/providers/discover`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        id: "web-custom", baseUrl: `http://127.0.0.1:${address.port}/v1`,
        api: "openai-completions", apiKey: "custom-secret",
      }),
    });
    expect(discovery.status).toBe(201);
    expect(await discovery.json()).toEqual({
      provider: "web-custom",
      models: [expect.objectContaining({ provider: "web-custom", model: "web-remote" })],
    });
    expect(credentialEnvironment.WEB_CUSTOM_API_KEY).toBe("custom-secret");
    expect(await fetchJson(`${running.url}/api/models`)).toEqual(expect.arrayContaining([
      expect.objectContaining({ provider: "web-custom", model: "web-remote" }),
    ]));

    const run = await fetch(`${running.url}/api/runs`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ cwd, provider: "web-custom", model: "web-remote", prompt: "hello" }),
    });
    expect(run.status, await run.clone().text()).toBe(200);
    expect(await run.text()).toContain("custom-web-ok");
    expect(received).toEqual([
      { path: "/v1/models", authorization: "Bearer custom-secret" },
      { path: "/v1/models", authorization: "Bearer custom-secret" },
      { path: "/v1/chat/completions", authorization: "Bearer custom-secret" },
    ]);
  });

  it("rejects cross-origin state-changing requests", async () => {
    const running = await scriptedServer();
    cleanup.push(() => running.close());
    const response = await fetch(`${running.url}/api/runs`, {
      method: "POST",
      headers: { origin: "https://attacker.example", "content-type": "application/json" },
      body: "{}",
    });
    expect(response.status).toBe(403);
  });

  it("loads installed DSH host routes and serves client bundles", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "seal-harness-web-plugin-"));
    cleanup.push(() => rm(cwd, { recursive: true, force: true }));
    const home = join(cwd, "home");
    await writeWebPluginFixture(home);
    const running = await startWebServer({
      cwd,
      port: 0,
      pluginHome: home,
      profile: defineProfile([
        plugin(scriptedModelPlugin, {
          models: [{ provider: "scripted", model: "web", contextWindow: 1_000, maxOutputTokens: 100 }],
          async *respond() { yield { type: "done", stopReason: "stop" }; },
        }),
        plugin(jsonlSessionPlugin, { root: join(cwd, "sessions") }),
        plugin(localAttachmentPlugin, { root: join(cwd, "attachments") }),
        plugin(commandsPlugin, undefined),
        plugin(feedbackToolsPlugin, { root: join(cwd, "feedback") }),
        plugin(contextCorePlugin, {}),
        plugin(piRuntimePlugin, {}),
        plugin(agentCorePlugin, {}),
      ]),
    });
    cleanup.push(() => running.close());

    const dshContext = running.kernel.use(dshCompatServiceToken).context;
    expect(["agentDefaultModel", "agents", "attachments", "llm", "sessions", "sessionProjections", "sessionQuery", "typert", "workspaceRegistry"].filter((name) => dshContext.get(name) === undefined)).toEqual([]);
    expect(dshContext.get("sessionController")).toBeDefined();
    expect(dshContext.get("workspaceController")).toBeDefined();
    const workspaceFollowSocket = new WsClient(running.url.replace(/^http/, "ws") + "/api/remote.mux");
    await new Promise<void>((resolve, reject) => { workspaceFollowSocket.once("open", resolve); workspaceFollowSocket.once("error", reject); });
    const workspaceFollowFrames: any[] = []; workspaceFollowSocket.on("message", (data) => workspaceFollowFrames.push(JSON.parse(data.toString())));
    workspaceFollowSocket.send(JSON.stringify({ type: "open", streamId: "official-workspace-follow", endpoint: "workspace/follow", payload: { args: {} } }));
    await vi.waitFor(() => expect(workspaceFollowFrames).toEqual(expect.arrayContaining([expect.objectContaining({ type: "item", streamId: "official-workspace-follow", value: expect.objectContaining({ type: "baseline" }) })])));
    const officialWorkspacePath = join(cwd, "official-workspace");
    await mkdir(officialWorkspacePath);
    const officialWorkspaceCreate = await postJson(`${running.url}/api/dsh/workspace`, { operation: "create", path: officialWorkspacePath });
    expect(officialWorkspaceCreate).toMatchObject({ status: 200, body: { available: true, value: { created: true, workspace: { path: officialWorkspacePath } } } });
    const officialWorkspaceId = String((officialWorkspaceCreate.body as any).value.workspace.workspaceId);
    await vi.waitFor(() => expect(workspaceFollowFrames).toEqual(expect.arrayContaining([expect.objectContaining({ type: "item", streamId: "official-workspace-follow", value: expect.objectContaining({ type: "upsert", workspace: expect.objectContaining({ workspaceId: officialWorkspaceId, path: officialWorkspacePath }) }) })])));
    await vi.waitFor(() => expect(workspaceFollowFrames).toEqual(expect.arrayContaining([expect.objectContaining({ type: "item", streamId: "official-workspace-follow", value: expect.objectContaining({ type: "order", workspaceIds: expect.arrayContaining([officialWorkspaceId]) }) })])));
    expect(await postJson(`${running.url}/api/dsh/workspace`, { operation: "rename", workspaceId: officialWorkspaceId, title: "Official workspace" })).toMatchObject({ status: 200, body: { available: true, value: { workspace: { workspaceId: officialWorkspaceId, title: "Official workspace" } } } });
    await vi.waitFor(() => expect(workspaceFollowFrames).toEqual(expect.arrayContaining([expect.objectContaining({ type: "item", streamId: "official-workspace-follow", value: expect.objectContaining({ type: "upsert", workspace: expect.objectContaining({ workspaceId: officialWorkspaceId, title: "Official workspace" }) }) })])));
    expect(await postJson(`${running.url}/api/dsh/workspace`, { operation: "insertBefore", workspaceId: officialWorkspaceId })).toMatchObject({ status: 200, body: { available: true, value: { workspaceIds: expect.arrayContaining([officialWorkspaceId]) } } });
    const archivedSessionId = sessionId("official-workspace-archived");
    await running.kernel.use(sessionStoreToken).create({ id: archivedSessionId, cwd: officialWorkspacePath });
    expect(await postJson(`${running.url}/api/dsh/session/read`, { operation: "list" })).toMatchObject({ status: 200, body: { available: true, value: { items: expect.arrayContaining([expect.objectContaining({ sessionId: archivedSessionId })]) } } });
    expect(await postJson(`${running.url}/api/dsh/session/page`, { address: { kind: "session", sessionId: archivedSessionId }, throughSeq: -1 })).toMatchObject({ status: 200, body: { records: [], hasMore: false } });
    workspaceFollowSocket.send(JSON.stringify({ type: "open", streamId: "official-session-follow-real", endpoint: "session/follow", payload: { args: { request: { address: { kind: "session", sessionId: archivedSessionId } } } } }));
    await vi.waitFor(() => expect(workspaceFollowFrames).toEqual(expect.arrayContaining([expect.objectContaining({ type: "item", streamId: "official-session-follow-real", value: expect.objectContaining({ type: "snapshot", header: expect.objectContaining({ id: archivedSessionId }) }) })])));
    expect(await postJson(`${running.url}/api/dsh/workspace`, { operation: "archiveSession", sessionId: archivedSessionId })).toMatchObject({ status: 200, body: { available: true, value: { archivedSessionIds: [archivedSessionId] } } });
    await vi.waitFor(() => expect(workspaceFollowFrames).toEqual(expect.arrayContaining([expect.objectContaining({ type: "item", streamId: "official-workspace-follow", value: { type: "archived", archivedSessionIds: [archivedSessionId] } })])));
    expect(await postJson(`${running.url}/api/dsh/workspace`, { operation: "delete", workspaceId: officialWorkspaceId })).toMatchObject({ status: 200, body: { available: true, value: { deleted: true } } });
    await vi.waitFor(() => expect(workspaceFollowFrames).toEqual(expect.arrayContaining([expect.objectContaining({ type: "item", streamId: "official-workspace-follow", value: { type: "remove", workspaceId: officialWorkspaceId } })])));
    workspaceFollowSocket.close();
    expect(await fetchJson(`${running.url}/api/fixture-plugin`)).toEqual({ ok: true });
    await expect(rawUpgrade(running.port, "/api/fixture-upgrade")).resolves.toContain("fixture-upgrade-ok");
    await expect(rawUpgrade(running.port, "/api/missing-upgrade")).resolves.toContain("404 Not Found");
    const eventsSocket = new WsClient(running.url.replace(/^http/, "ws") + "/api/remote.mux");
    await new Promise<void>((resolve, reject) => { eventsSocket.once("open", resolve); eventsSocket.once("error", reject); });
    const eventFrames: any[] = []; eventsSocket.on("message", (data) => eventFrames.push(JSON.parse(data.toString())));
    eventsSocket.send(JSON.stringify({ type: "open", streamId: "fixture-events", endpoint: "$events", payload: { args: {} } }));
    await vi.waitFor(() => expect(eventFrames).toEqual(expect.arrayContaining([expect.objectContaining({ type: "item", value: expect.objectContaining({ type: "waterfall", event: "fixture/waterfall", agentId: "agent-1" }) })])));
    const waterfall = eventFrames.find((frame) => frame.value?.type === "waterfall").value;
    const resultEnvelope = { type: "client-request", rpcId: "fixture-result", method: "$events/result", payload: { args: { clientId: eventFrames.find((frame) => frame.value?.type === "ready").value.clientId, eventId: waterfall.eventId, outcome: { kind: "result", value: "claimed" } } } };
    expect(await (await fetch(`${running.url}/api/$events/result`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(resultEnvelope) })).json()).toMatchObject({ result: { ok: true } });
    await vi.waitFor(() => expect((globalThis as any).__sealFixtureRemoteOutcome).toEqual({ kind: "result", value: "claimed" }));
    eventsSocket.close();
    const clients = await fetchJson(`${running.url}/api/plugins/client`) as Array<{ name: string; url: string; initialUrl: string }>;
    expect(clients).toEqual([expect.objectContaining({ name: "@fixture/web-plugin" })]);
    const plugins = await fetchJson(`${running.url}/api/plugins`) as Array<{ name: string; status: string }>;
    expect(plugins).toEqual([expect.objectContaining({ name: "@fixture/web-plugin", status: "ready" })]);
    const bundle = await fetch(`${running.url}${clients[0]?.url}`);
    expect(bundle.status).toBe(200);
    await expect(bundle.text()).resolves.toContain("__ModuleLoader__");
    const batch = await fetch(`${running.url}${clients[0]?.initialUrl}`); expect(batch.status).toBe(200); await expect(batch.text()).resolves.toContain("__ModuleLoader__");
    const missingExport = await fetch(`${running.url}/api/session.export?sessionId=missing`);
    expect(missingExport.status, await missingExport.clone().text()).toBe(404);
    const exportRun = await fetch(`${running.url}/api/runs`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ cwd, provider: "scripted", model: "web", prompt: "archive this session" }) });
    expect(exportRun.status).toBe(200); await exportRun.text();
    const exportSessions = await fetchJson(`${running.url}/api/sessions`) as Array<{ id: string }>;
    expect(await fetchJson(`${running.url}/api/fixture-workspaces`)).toEqual([
      expect.objectContaining({ sessionIds: expect.arrayContaining([exportSessions[0]!.id]) }),
    ]);
    const archive = await fetch(`${running.url}/api/session.export?sessionId=${encodeURIComponent(exportSessions[0]!.id)}`);
    expect(archive.status, await archive.clone().text()).toBe(200);
    expect(archive.headers.get("content-type")).toBe("application/zip");
    expect(Buffer.from(await archive.arrayBuffer()).subarray(0, 2).toString("ascii")).toBe("PK");
    expect((await fetch(`${running.url}/api/plugins/client-batch?rev=stale`)).status).toBe(409);
    const invalidAdd = await fetch(`${running.url}/api/plugins`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "add", spec: "" }),
    });
    expect(invalidAdd.status).toBe(400);
    const disabled = await fetch(`${running.url}/api/plugins/${encodeURIComponent("@fixture/web-plugin")}/enabled`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ enabled: false }) });
    expect(disabled.status, await disabled.clone().text()).toBe(200); expect(await disabled.json()).toMatchObject({ enabled: false, restartRequired: false });
    expect((await fetch(`${running.url}/api/fixture-plugin`)).status).toBe(404);
    expect((await fetchJson(`${running.url}/api/dsh/skins`) as any).skins).toEqual([]);
    const enabled = await fetch(`${running.url}/api/plugins/${encodeURIComponent("@fixture/web-plugin")}/enabled`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ enabled: true }) });
    expect(enabled.status, await enabled.clone().text()).toBe(200); expect(await enabled.json()).toMatchObject({ enabled: true, restartRequired: false });
    expect((await fetchJson(`${running.url}/api/dsh/skins`) as any).skins).toEqual([expect.objectContaining({ id: "fixture-skin" })]);
    expect(await fetchJson(`${running.url}/api/fixture-plugin`)).toEqual({ ok: true });
  });

  it("loads installed DSH plugins over the complete default Web profile without tool collisions", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "seal-harness-web-default-plugin-"));
    cleanup.push(() => rm(cwd, { recursive: true, force: true }));
    const home = join(cwd, "home");
    await writeWebPluginFixture(home);
    const running = await startWebServer({ cwd, port: 0, pluginHome: home });
    cleanup.push(() => running.close());
    expect(running.kernel.use(dshCompatServiceToken).sealSessionAuthority).toBe(true);
    expect(await fetchJson(`${running.url}/api/fixture-plugin`)).toEqual({ ok: true });
    const createWorkspace = await fetch(`${running.url}/api/workspaces`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ path: cwd, title: "Fixture workspace" }),
    });
    expect(createWorkspace.status, await createWorkspace.clone().text()).toBe(201);
    const created = await createWorkspace.json() as { id: string };
    expect(await fetchJson(`${running.url}/api/fixture-workspaces`)).toEqual([
      expect.objectContaining({ id: created.id, title: "Fixture workspace" }),
    ]);
    const renamed = await fetch(`${running.url}/api/workspaces/${encodeURIComponent(created.id)}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: "Renamed workspace" }),
    });
    expect(renamed.status, await renamed.clone().text()).toBe(200);
    expect(await fetchJson(`${running.url}/api/fixture-workspaces`)).toEqual([
      expect.objectContaining({ id: created.id, title: "Renamed workspace" }),
    ]);
    expect(await fetchJson(`${running.url}/api/plugins`)).toEqual([
      expect.objectContaining({
        name: "@fixture/web-plugin",
        status: "ready",
        missingHostServices: [],
      }),
    ]);
    expect(await postJson(`${running.url}/api/sessions`, { cwd, sessionId: "official-title-authority" })).toMatchObject({ status: 201 });
    expect(await requestJson(`${running.url}/api/sessions/official-title-authority/title`, { title: "Official title authority" })).toMatchObject({ status: 200, body: { title: "Official title authority", seq: expect.any(Number) } });
    expect((await running.kernel.use(sessionStoreToken).read(sessionId("official-title-authority")))?.events).toEqual(expect.arrayContaining([
      expect.objectContaining({ event: { type: "dsh.imported", payload: expect.objectContaining({ type: "session/title", data: expect.objectContaining({ title: "Official title authority", source: { kind: "user" } }) }) } }),
    ]));
  });

  it("pauses a dangerous tool until the Web approval endpoint allows it", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "seal-harness-web-approval-"));
    cleanup.push(() => rm(cwd, { recursive: true, force: true }));
    const approvals = new WebApprovalService();
    const approvalPlugin = definePlugin<undefined, SealHarnessEvents>({
      name: "test-web-approval",
      provides: [approvalServiceToken],
      setup(context) { context.provide(approvalServiceToken, approvals); },
    });
    let step = 0;
    const profile = defineProfile([
      plugin(scriptedModelPlugin, {
        models: [{ provider: "scripted", model: "web", contextWindow: 1_000, maxOutputTokens: 100 }],
        async *respond() {
          step += 1;
          if (step === 1) {
            yield {
              type: "tool_call",
              call: {
                type: "tool_call",
                id: toolCallId("approval-shell"),
                name: "shell",
                arguments: { command: `\"${process.execPath}\" -e \"process.stdout.write('approved')\"` },
              },
            };
            yield { type: "done", stopReason: "tool_call" };
          } else {
            yield { type: "text_delta", delta: "approved-ok" };
            yield { type: "done", stopReason: "stop" };
          }
        },
      }),
      plugin(memorySessionPlugin, {}),
      plugin(contextCorePlugin, { systemPrompt: "approval test" }),
      plugin(basicPolicyPlugin, { mode: "workspace-write" }),
      plugin(approvalPlugin, undefined),
      plugin(toolsCorePlugin, {}),
      plugin(workspaceToolsPlugin, {}),
      plugin(piRuntimePlugin, {}),
      plugin(agentCorePlugin, {}),
    ]);
    const running = await startWebServer({ cwd, port: 0, profile, approvalService: approvals });
    cleanup.push(() => running.close());

    const run = fetch(`${running.url}/api/runs`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ cwd, provider: "scripted", model: "web", prompt: "run" }),
    });
    const pending = await waitForApproval(running.url);
    const decision = await fetch(`${running.url}/api/approvals/${encodeURIComponent(pending.id)}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ approved: true }),
    });
    expect(decision.status).toBe(200);
    const output = await (await run).text();
    expect(output).toContain("approved-ok");
    expect(output).toContain('"type":"tool_result"');
  });
});

async function scriptedServer(): Promise<RunningWebServer> {
  const cwd = await mkdtemp(join(tmpdir(), "seal-harness-web-origin-"));
  cleanup.push(() => rm(cwd, { recursive: true, force: true }));
  return startWebServer({
    cwd,
    port: 0,
    profile: defineProfile([
      plugin(scriptedModelPlugin, {
        models: [{ provider: "scripted", model: "web", contextWindow: 1_000, maxOutputTokens: 100 }],
        async *respond() { yield { type: "done", stopReason: "stop" }; },
      }),
      plugin(memorySessionPlugin, {}),
      plugin(contextCorePlugin, { systemPrompt: "test" }),
      plugin(piRuntimePlugin, {}),
      plugin(agentCorePlugin, {}),
    ]),
  });
}

async function fetchJson(url: string): Promise<unknown> {
  const response = await fetch(url);
  expect(response.status).toBe(200);
  return response.json();
}

async function requestJson(url: string, body?: object): Promise<{ status: number; body: any }> {
  return new Promise((resolvePromise, reject) => {
    const payload = body === undefined ? undefined : JSON.stringify(body);
    const request = httpRequest(url, { method: payload === undefined ? "GET" : "PUT", headers: payload === undefined ? {} : { "content-type": "application/json", "content-length": Buffer.byteLength(payload) } }, (response) => {
      const chunks: Buffer[] = []; response.on("data", (chunk) => chunks.push(Buffer.from(chunk))); response.on("end", () => resolvePromise({ status: response.statusCode ?? 0, body: JSON.parse(Buffer.concat(chunks).toString("utf8")) }));
    });
    request.on("error", reject); if (payload !== undefined) request.write(payload); request.end();
  });
}

async function postJson(url: string, body: object): Promise<{ status: number; body: any }> {
  const response = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  return { status: response.status, body: await response.json() };
}

async function waitForApproval(url: string): Promise<{ id: string }> {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const values = await fetchJson(`${url}/api/approvals`) as Array<{ id: string }>;
    if (values[0] !== undefined) return values[0];
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 25));
  }
  throw new Error("Approval did not become pending");
}

async function writeWebPluginFixture(home: string): Promise<void> {
  const profile = join(home, "profiles", "web");
  const root = join(profile, "node_modules", "@fixture", "web-plugin");
  await mkdir(join(root, "lib"), { recursive: true });
  await writeFile(join(root, "skin.json"), JSON.stringify({ id: "fixture-skin", name: "Fixture skin", package: "@fixture/web-plugin", bodyAttr: "data-fixture-skin" }));
  await writeFile(join(profile, "package.json"), JSON.stringify({
    name: "fixture-profile",
    private: true,
    type: "module",
    dependencies: { "@fixture/web-plugin": "file:fixture" },
  }, null, 2));
  await writeFile(join(profile, "cordis.patch.yml"), "[]\n");
  await writeFile(join(root, "package.json"), JSON.stringify({
    name: "@fixture/web-plugin",
    version: "1.0.0",
    type: "module",
    main: "lib/index.js",
    exports: { ".": "./lib/index.js", "./client": "./lib/client.js", "./package.json": "./package.json" },
    dsh: { bundle: { patch: "cordis.patch.yml" }, client: { inject: [], platform: "web" } },
  }));
  await writeFile(join(root, "cordis.patch.yml"), "- id: fixture-web-plugin\n");
  await writeFile(join(root, "lib", "index.js"), `
export const inject = ["webServer", "connection", "typertGateway", "agents", "directoryPicker", "workspaceRegistry"];
export function apply(ctx) {
  if (!Array.isArray(ctx.workspaceRegistry.list())) throw new Error("workspaceRegistry list is unavailable");
  ctx.effect(() => ctx.typertGateway.registerRemoteEvents(async function* (signal) {
    yield {
      event: "fixture/waterfall",
      request: { value: 7, signal },
      context: { value: { effect(callback) { return callback(); } }, subject: { agentId: "agent-1" } },
      resolve(outcome) { globalThis.__sealFixtureRemoteOutcome = outcome; },
      reject(error) { globalThis.__sealFixtureRemoteOutcome = { rejected: String(error) }; },
    };
    await new Promise((resolve) => signal.addEventListener("abort", resolve, { once: true }));
  }, { home: "/fixture/home" }));
  ctx.effect(() => ctx.webServer.register({
    kind: "exact",
    path: "/api/fixture-plugin",
    handler(_request, response) {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ ok: true }));
    },
  }));
  ctx.effect(() => ctx.webServer.register({
    kind: "exact",
    path: "/api/fixture-workspaces",
    handler(_request, response) {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify(ctx.workspaceRegistry.list().map((workspace) => ({
        id: workspace.id,
        title: workspace.title,
        sessionIds: workspace.sessionIds,
      }))));
    },
  }));
  ctx.effect(() => ctx.webServer.registerUpgrade({
    path: "/api/fixture-upgrade",
    handler(_request, socket) {
      socket.end("HTTP/1.1 101 Switching Protocols\\r\\nConnection: Upgrade\\r\\nUpgrade: websocket\\r\\n\\r\\nfixture-upgrade-ok");
    },
  }));
}
`);
  await writeFile(join(root, "lib", "client.js"), "window.__ModuleLoader__.load({id:'@fixture/web-plugin',factory:()=>({apply(){}})});\n");
}

function rawUpgrade(port: number, path: string): Promise<string> {
  return new Promise((resolvePromise, reject) => {
    const socket = connect(port, "127.0.0.1"); let value = "";
    socket.setTimeout(2_000, () => socket.destroy(new Error("upgrade response timed out")));
    socket.on("connect", () => socket.write(`GET ${path} HTTP/1.1\r\nHost: 127.0.0.1:${port}\r\nConnection: Upgrade\r\nUpgrade: websocket\r\nSec-WebSocket-Version: 13\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\n\r\n`));
    socket.on("data", (chunk) => { value += chunk.toString("utf8"); });
    socket.on("end", () => resolvePromise(value));
    socket.on("error", reject);
  });
}
