import { Context as CordisContext, Service as CordisService } from "@deepseek-ai/cordis";
import { canExecute, hasLinuxChooserBinary, resolveDirectoryPickerBackend } from "@deepseek-ai/dsh-host-directory-picker-auto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import sharp from "sharp";
import {
  toolCallId,
  messageId,
  text,
  agentServiceToken,
  sessionStoreToken,
  contextServiceToken,
  modelServiceToken,
  subagentServiceToken,
  attachmentServiceToken,
  sandboxServiceToken,
  credentialServiceToken,
  approvalServiceToken,
  userQuestionServiceToken,
  jobServiceToken,
  settingsServiceToken,
  messageFeedbackServiceToken,
  lspServiceToken,
  agentPresetServiceToken,
  MessageFeedbackError,
  type JsonObject,
  type ModelToolDefinition,
  type ModelService,
  type ToolDefinition,
  type ToolExecutionRequest,
  type ToolResult,
  type ToolRegistrationOptions,
  type ContextService,
  type ContextSource,
  type ToolService,
  type SealHarnessEvents,
  type LspService,
  type AgentPresetAuthority,
  type AgentPresetService,
  deriveSessionMessages,
  foldSessionInbox,
} from "@seal-harness/core";
import { toolServiceToken } from "@seal-harness/core";
import { Kernel, plugin } from "@seal-harness/kernel";
import { MemorySessionStore } from "@seal-harness/session-memory";
import { DefaultAgentService } from "@seal-harness/agent-core";
import { ContextRegistry } from "@seal-harness/context-core";
import { PiAgentRuntime } from "@seal-harness/runtime-pi";
import { LocalJobService } from "@seal-harness/jobs-local";
import { FileSettingsService } from "@seal-harness/settings-file";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { agentEvents } from "@deepseek-ai/dsh-agent";
import { storageBackendServiceKey } from "@deepseek-ai/dsh-storage";
import {
  dshCompatPlugin,
  dshCompatServiceToken,
  type DshPluginModule,
} from "../src/index.js";

let suiteDshHome: string;
let previousSuiteDshHome: string | undefined;

beforeAll(async () => {
  previousSuiteDshHome = process.env.DSH_HOME;
  suiteDshHome = await mkdtemp(join(tmpdir(), "seal-dsh-compat-suite-"));
  process.env.DSH_HOME = suiteDshHome;
});

afterAll(async () => {
  if (previousSuiteDshHome === undefined) delete process.env.DSH_HOME;
  else process.env.DSH_HOME = previousSuiteDshHome;
  await rm(suiteDshHome, { recursive: true, force: true });
});

class RecordingTools implements ToolService {
  readonly definitionsByName = new Map<string, ToolDefinition>();
  readonly ownersByName = new Map<string, string | undefined>();
  readonly modelFilters: Array<(definition: ModelToolDefinition, sessionId?: import("@seal-harness/core").SessionId) => boolean> = [];

  register(tool: ToolDefinition, options: ToolRegistrationOptions = {}): () => void {
    this.definitionsByName.set(tool.name, tool);
    this.ownersByName.set(tool.name, options.ownerSession);
    return () => {
      if (this.definitionsByName.get(tool.name) === tool) { this.definitionsByName.delete(tool.name); this.ownersByName.delete(tool.name); }
    };
  }

  definitions(sessionId?: import("@seal-harness/core").SessionId, options: { readonly includeHidden?: boolean } = {}): readonly ModelToolDefinition[] {
    return [...this.definitionsByName.values()].filter((tool) => (this.ownersByName.get(tool.name) === undefined || this.ownersByName.get(tool.name) === sessionId) && (tool.modelVisible !== false || options.includeHidden === true)).map((tool) => ({
      name: tool.name,
      description: tool.description,
      inputSchema: tool.inputSchema,
    })).filter((definition) => options.includeHidden === true || this.modelFilters.every((filter) => filter(definition, sessionId)));
  }

  filterModelDefinitions(filter: (definition: ModelToolDefinition, sessionId?: import("@seal-harness/core").SessionId) => boolean): () => void { this.modelFilters.push(filter); return () => { const index = this.modelFilters.indexOf(filter); if (index >= 0) this.modelFilters.splice(index, 1); }; }

  async execute(request: ToolExecutionRequest): Promise<ToolResult> {
    const tool = this.definitionsByName.get(request.name); if (tool === undefined) throw new Error(`missing tool ${request.name}`);
    return tool.execute(request.input, { callId: request.callId, sessionId: request.sessionId, cwd: request.cwd, signal: request.signal, reportProgress: request.reportProgress ?? (() => {}), ...(request.reportDispatch === undefined ? {} : { reportDispatch: request.reportDispatch }) });
  }
}

describe("dshCompatPlugin", () => {
  it("composes the official Dynamic Cordis Host runner and model tools only when opted in", async () => {
    const tools = new RecordingTools();
    const kernel = new Kernel<SealHarnessEvents>({ initialServices: [[toolServiceToken, tools]] });
    await kernel.start([plugin(dshCompatPlugin, { dynamicCordis: { vmTimeoutMs: 250 } })]);
    try {
      const cordis = kernel.use(dshCompatServiceToken).context;
      expect(cordis.get("dynamicCordisRunner")).toBeDefined();
      expect(cordis.get("cordisInspect")).toBeDefined();
      expect(cordis.get("tools")).toBeDefined();
      expect([...tools.definitionsByName.keys()]).toEqual(expect.arrayContaining([
        "cordis_inspect_list", "cordis_inspect_query", "cordis_define", "cordis_run", "cordis_stop", "cordis_undefine",
      ]));
    } finally { await kernel.stop(); }

    const disabled = new Kernel<SealHarnessEvents>({ initialServices: [[toolServiceToken, new RecordingTools()]] });
    await disabled.start([plugin(dshCompatPlugin, {})]);
    try { expect(disabled.use(dshCompatServiceToken).context.get("dynamicCordisRunner")).toBeUndefined(); }
    finally { await disabled.stop(); }
  });
  it("prepares bounded cross-Session snapshots with the official reference resolver", async () => {
    const sessions = new MemorySessionStore();
    const source = await sessions.create({ id: "reference-source" as never, cwd: "D:\\workspace" });
    await sessions.append({ id: source.id, expectedVersion: source.version, events: [{ type: "message.appended", payload: { messageId: "reference-message" as never, message: { role: "user", content: [{ type: "text", text: "source evidence" }], source: { kind: "user" } } } }] });
    await sessions.create({ id: "reference-target" as never, cwd: "D:\\workspace" });
    let candidates: any[] = []; let prepared: any;
    const consumer: DshPluginModule = { name: "session-reference-consumer", inject: ["agents", "sessionReferenceResolver"], async apply(context) {
      const target = await (context.get("agents") as any).resume({ resumeSessionId: "reference-target" });
      const resolver = context.get("sessionReferenceResolver") as any;
      candidates = await resolver.listCandidates(target.agent, "reference-source");
      prepared = await resolver.prepare(target.agent, [{ type: "text", text: "compare it" }], [{ sessionId: "reference-source", label: "Prior work" }]);
      await target.dispose();
    } };
    const kernel = new Kernel<SealHarnessEvents>({ initialServices: [[sessionStoreToken, sessions]] });
    await kernel.start([plugin(dshCompatPlugin, { plugins: [{ plugin: consumer }] })]);
    expect(candidates).toMatchObject([{ sessionId: "reference-source", sameWorkspace: true }]);
    expect(prepared.content).toEqual([{ type: "text", text: "compare it" }]);
    expect(prepared.additionalContext.source).toMatchObject({ kind: "session-reference", form: "recall", version: 1, references: [{ sessionId: "reference-source", label: "Prior work" }] });
    expect(prepared.additionalContext.content[0].text).toContain("source evidence");
    expect(prepared.additionalContext.content[0].text).toContain("untrusted, read-only snapshot");
    await kernel.stop();
  });

  it("injects the official durable time context before each eligible model step", async () => {
    const tools = new RecordingTools(); const requests: any[] = []; let events: any[] = []; let exercise!: () => Promise<void>;
    const models: ModelService = {
      async list() { return [{ provider: "seal", model: "time", contextWindow: 8_000, maxOutputTokens: 256 }]; },
      async get() { return (await this.list())[0]; },
      async *stream(request) { requests.push(request); yield { type: "text_delta", delta: "done" }; yield { type: "done", stopReason: "stop" }; },
    };
    const consumer: DshPluginModule = { name: "time-context-consumer", inject: ["agents"], async apply(context) { exercise = async () => {
      const handle = await (context.get("agents") as any).create({ sessionId: "time-context-session", agentOptions: { provider: "seal", model: "time" }, meta: { cwd: process.cwd() } });
      handle.agent.followup({ id: "time-context-prompt", role: "user", content: [{ type: "text", text: "what time is it?" }], source: { kind: "user", rpcId: "time-rpc", clientTimeZone: "Asia/Shanghai" } });
      await handle.agent.whenIdle();
      events = handle.agent.session.snapshotEvents();
      await handle.dispose();
    }; } };
    const sessions = new MemorySessionStore(undefined, (sessionId, events): Promise<void> => kernel.emit("session.appended", { sessionId, events })); const contexts = new ContextRegistry();
    const agents = new DefaultAgentService(sessions, contexts, new PiAgentRuntime(models, tools), (event, payload): Promise<void> => kernel.emit(event, payload));
    const kernel = new Kernel<SealHarnessEvents>({ initialServices: [[toolServiceToken, tools], [modelServiceToken, models], [sessionStoreToken, sessions], [contextServiceToken, contexts], [agentServiceToken, agents]] });
    await kernel.start([plugin(dshCompatPlugin, { timeContext: { timeZone: "UTC" }, sessionTitle: { llm: false }, plugins: [{ plugin: consumer }] })]);
    await exercise();
    const injected = requests[0].messages.find((message: any) => message.source?.kind === "plugin" && message.source?.plugin === "time-context");
    expect(injected, JSON.stringify(requests[0].messages)).toBeDefined();
    expect(injected?.content[0]?.text).toContain("Time sampled while preparing turn 1, step 1:");
    expect(injected?.content[0]?.text).toContain("Browser time zone for this request: Asia/Shanghai.");
    expect(events.filter((event) => event.type === "user/message").map(event => event.data)).toEqual(expect.arrayContaining([expect.objectContaining({ source: expect.objectContaining({ plugin: "time-context" }) })]));
    await kernel.stop();
  });

  it("drives an armed durable goal through an automatic official goal round", async () => {
    const tools = new RecordingTools(); const requests: any[] = []; let goal: any; let exercise!: () => Promise<void>;
    const models: ModelService = {
      async list() { return [{ provider: "seal", model: "goal-loop", contextWindow: 8_000, maxOutputTokens: 256 }]; },
      async get() { return (await this.list())[0]; },
      async *stream(request) { requests.push(request); yield { type: "text_delta", delta: "round complete" }; yield { type: "done", stopReason: "stop" }; },
    };
    const consumer: DshPluginModule = { name: "goal-round-consumer", inject: ["agents", "goals"], async apply(context) { exercise = async () => {
      const handle = await (context.get("agents") as any).create({ sessionId: "goal-round-session", agentOptions: { provider: "seal", model: "goal-loop" }, meta: { cwd: process.cwd() } });
      (context.get("goals") as any).create(handle.agent, { objective: "finish the verified task", maxGoalRounds: 1 });
      await vi.waitFor(() => expect(requests.length, JSON.stringify((context.get("goals") as any).get(handle.agent))).toBe(1));
      await handle.agent.whenIdle();
      await vi.waitFor(() => expect((context.get("goals") as any).get(handle.agent)?.phase).toBe("blocked"));
      goal = (context.get("goals") as any).get(handle.agent);
      await handle.dispose();
    }; } };
    const sessions = new MemorySessionStore(undefined, (sessionId, events): Promise<void> => kernel.emit("session.appended", { sessionId, events })); const contexts = new ContextRegistry();
    const agents = new DefaultAgentService(sessions, contexts, new PiAgentRuntime(models, tools), (event, payload): Promise<void> => kernel.emit(event, payload));
    const kernel = new Kernel<SealHarnessEvents>({ initialServices: [[toolServiceToken, tools], [modelServiceToken, models], [sessionStoreToken, sessions], [contextServiceToken, contexts], [agentServiceToken, agents]] });
    await kernel.start([plugin(dshCompatPlugin, { sessionTitle: { llm: false }, plugins: [{ plugin: consumer }] })]);
    await exercise();
    expect(requests[0].messages.some((message: any) => message.source?.kind === "goal")).toBe(true);
    expect(goal).toMatchObject({ objective: "finish the verified task", phase: "blocked", roundsStarted: 1 });
    await kernel.stop();
  });

  it("does not install an alternative AgentLoop when Seal has no AgentService", async () => {
    const tools = new RecordingTools(); const requests: any[] = []; let observed: any;
    const models: ModelService = {
      async list() { return [{ provider: "seal", model: "loop", contextWindow: 8_000, maxOutputTokens: 256 }]; },
      async get() { return (await this.list())[0]; },
      async *stream(request) { requests.push(request); yield { type: "text_delta", delta: "official loop response" }; yield { type: "done", stopReason: "stop" }; },
    };
    const consumer: DshPluginModule = { name: "official-loop-consumer", inject: ["agents", "agentLoop"], async apply(context) {
      const handle = await (context.get("agents") as any).create({ sessionId: "official-loop-session", agentOptions: { provider: "seal", model: "loop" }, meta: { cwd: process.cwd() } });
      handle.agent.followup({ id: "official-loop-prompt", role: "user", content: [{ type: "text", text: "run the loop" }], source: { kind: "user" } });
      await handle.agent.whenIdle();
      observed = { status: handle.agent.status, events: handle.agent.session.snapshotEvents().map((event: any) => event.type) };
      await handle.dispose();
    } };
    const kernel = new Kernel<SealHarnessEvents>({ initialServices: [[toolServiceToken, tools], [modelServiceToken, models]] });
    await kernel.start([plugin(dshCompatPlugin, { sessionTitle: { llm: false }, plugins: [{ plugin: consumer }] })]);
    expect(requests).toHaveLength(0);
    expect(observed).toBeUndefined();
    expect(kernel.use(dshCompatServiceToken).context.get("agentLoop")).toBeUndefined();
    await kernel.stop();
  });

  it("runs the official worker-thread workflow tool over Seal subagents", async () => {
    const tools = new RecordingTools(); const spawned: any[] = []; let result: any; let events: string[] = [];
    const subagents = {
      async spawn(request: any) { spawned.push(request); return { sessionId: request.sessionId ?? "workflow-child", parentSessionId: request.parentSessionId, label: request.label, status: "running", model: request.model }; },
      async list() { return []; }, async send() { throw new Error("not used"); }, async abort() { return true; },
      async wait(parentSessionId: any, childIds: any[]) { return { completed: [{ sessionId: childIds[0], parentSessionId, status: "completed", result: "child evidence" }], timedOut: false }; },
    };
    const consumer: DshPluginModule = { name: "workflow-consumer", inject: ["agents"], async apply(context) {
      const handle = await (context.get("agents") as any).create({ sessionId: "workflow-parent", meta: { cwd: process.cwd() } });
      result = await tools.execute({ callId: toolCallId("workflow-call"), sessionId: "workflow-parent" as never, cwd: process.cwd(), name: "workflow", input: { meta: { name: "collect-evidence", description: "Collect evidence" }, script: "const value = await agent('inspect the target', { label: 'inspection' }); return { value };" }, signal: new AbortController().signal });
      events = handle.agent.session.snapshotEvents().filter((event: any) => event.type.startsWith("tool-workflow/")).map((event: any) => event.type);
      await handle.dispose();
    } };
    const kernel = new Kernel<SealHarnessEvents>({ initialServices: [[toolServiceToken, tools], [subagentServiceToken, subagents as any], [sessionStoreToken, new MemorySessionStore()]] });
    await kernel.start([plugin(dshCompatPlugin, { plugins: [{ plugin: consumer }] })]);
    expect(result.isError).toBeUndefined();
    expect(spawned[0]).toMatchObject({ parentSessionId: "workflow-parent", prompt: "inspect the target" });
    expect(result.content[0].text).toContain('"value": "child evidence"');
    expect(events).toEqual(["tool-workflow/run-start", "tool-workflow/agent-start", "tool-workflow/agent-end", "tool-workflow/run-end"]);
    await kernel.stop();
  });

  it("keeps a Seal-owned workflow tool while still providing the official engine service", async () => {
    const tools = new RecordingTools();
    const nativeWorkflow: ToolDefinition = {
      name: "workflow",
      description: "Seal workflow",
      inputSchema: { type: "object" },
      classify: () => ({ kind: "tool", toolName: "workflow", risk: "workspace-write", summary: "Seal workflow" }),
      execute: async () => ({ content: [{ type: "text", text: "seal-owned" }] }),
    };
    tools.register(nativeWorkflow);
    const subagents = {
      async spawn() { throw new Error("not used"); }, async list() { return []; },
      async send() { throw new Error("not used"); }, async abort() { return true; },
      async wait() { return { completed: [], timedOut: false }; },
    };
    const kernel = new Kernel<SealHarnessEvents>({
      initialServices: [[toolServiceToken, tools], [subagentServiceToken, subagents as any]],
    });
    await kernel.start([plugin(dshCompatPlugin, {})]);
    expect(tools.definitionsByName.get("workflow")).toBe(nativeWorkflow);
    expect(kernel.use(dshCompatServiceToken).context.get("workflowEngine")).toBeDefined();
    await kernel.stop();
  });

  it("enforces official DSH tool deadlines and spills oversized text results", async () => {
    const directory = await mkdtemp(join(tmpdir(), "seal-dsh-spill-")); const tools = new RecordingTools(); let observed: any;
    try {
      const body = "oversized-evidence-".repeat(100);
      const consumer: DshPluginModule = { name: "tool-policy-consumer", inject: ["agents", "tools"], async apply(context) {
        const runtime = context.get("tools") as any;
        runtime.register({ name: "slow", description: "Wait forever", timeoutMs: 5, parameters: { type: "object" }, output: { schema: { type: "string" }, render: () => [{ type: "text", text: "late" }] }, async execute(_args: unknown, exec: any) { await new Promise<void>((resolve) => { exec.signal.addEventListener("abort", () => resolve(), { once: true }); setTimeout(resolve, 100); }); exec.signal.throwIfAborted(); return "late"; } });
        runtime.register({ name: "large", description: "Return large text", parameters: { type: "object" }, output: { schema: { type: "string" }, render: () => [{ type: "text", text: body }] }, async execute() { return body; } });
        const handle = await (context.get("agents") as any).create({ sessionId: "tool-policy-session", meta: { cwd: directory } });
        const call = (name: string) => tools.execute({ callId: toolCallId(name), sessionId: "tool-policy-session" as never, cwd: directory, name, input: {}, signal: new AbortController().signal });
        const timeout = await call("slow"); const spilled = await call("large");
        observed = { timeout, spilled };
        await handle.dispose();
      } };
      const kernel = new Kernel<SealHarnessEvents>({ initialServices: [[toolServiceToken, tools], [sessionStoreToken, new MemorySessionStore()]] });
      await kernel.start([plugin(dshCompatPlugin, { spill: { root: directory, cleanupPeriodDays: 0, maxInlineBytes: 400 }, plugins: [{ plugin: consumer }] })]);
      expect(observed.timeout).toMatchObject({ isError: true, content: [{ type: "text", text: "Error: tool call timed out after 5ms" }] });
      const replacement = observed.spilled.content[0].text as string;
      expect(Buffer.byteLength(replacement, "utf8")).toBeLessThanOrEqual(400);
      expect(replacement).toContain("Full formatted result stored at:");
      const locator = replacement.match(/Full formatted result stored at: (.+?)\. Use read/)?.[1];
      expect(locator).toBeDefined();
      expect(await readFile(locator!, "utf8")).toBe("oversized-evidence-".repeat(100));
      await kernel.stop();
    } finally { await rm(directory, { recursive: true, force: true }); }
  });

  it("publishes and loads official filesystem skills through the bridged skill tool", async () => {
    const directory = await mkdtemp(join(tmpdir(), "seal-dsh-skills-")); const tools = new RecordingTools(); let observed: any;
    try {
      const skillDirectory = join(directory, "skills", "evidence-check");
      await mkdir(skillDirectory, { recursive: true });
      await writeFile(join(skillDirectory, "SKILL.md"), "---\nname: evidence-check\ndescription: Verify evidence before completion\n---\n\nInspect authoritative state and report contradictions.\n", "utf8");
      const consumer: DshPluginModule = { name: "skills-consumer", inject: ["agents", "skills", "tools"], async apply(context) {
        const handle = await (context.get("agents") as any).create({ sessionId: "skills-session", meta: { cwd: directory } });
        const claimed = { id: "prompt", role: "user", content: [{ type: "text", text: "start" }], source: { kind: "user" } };
        const decision: any = await agentEvents(context, handle.agent).waterfall("agent/pre-step", { turn: 1, step: 1, signal: new AbortController().signal, messages: [claimed] } as any, () => Promise.resolve({ kind: "enter", messages: [claimed] } as any));
        const loaded = await tools.execute({ callId: toolCallId("load-skill"), sessionId: "skills-session" as never, cwd: directory, name: "skill", input: { name: "evidence-check" }, signal: new AbortController().signal });
        const badge = await tools.execute({ callId: toolCallId("load-badge"), sessionId: "skills-session" as never, cwd: directory, name: "skill", input: { name: "dsh-badge" }, signal: new AbortController().signal });
        observed = { catalog: decision.messages.find((message: any) => message.source?.kind === "skill-catalog"), loaded, badge };
        await handle.dispose();
      } };
      const kernel = new Kernel<SealHarnessEvents>({ initialServices: [[toolServiceToken, tools], [sessionStoreToken, new MemorySessionStore()]] });
      await kernel.start([plugin(dshCompatPlugin, { skills: { badge: true, filesystem: { includeDefaultRoots: false, customSkillDirs: [join(directory, "skills")], watch: false } }, plugins: [{ plugin: consumer }] })]);
      expect(observed.catalog.source.entries).toEqual(expect.arrayContaining([expect.objectContaining({ name: "evidence-check" }), expect.objectContaining({ name: "dsh-badge" })]));
      expect(observed.loaded.content.map((block: any) => block.text ?? "").join("\n")).toContain("Inspect authoritative state and report contradictions.");
      expect(observed.badge.content.map((block: any) => block.text ?? "").join("\n")).toContain("powered by dsh");
      await kernel.stop();
    } finally { await rm(directory, { recursive: true, force: true }); }
  });

  it("keeps the optional DSH badge skill disabled by default", async () => {
    const directory = await mkdtemp(join(tmpdir(), "seal-dsh-skills-default-")); let entries: any[] = [];
    try {
      const consumer: DshPluginModule = { name: "default-skills-consumer", inject: ["agents"], async apply(context) {
        const handle = await (context.get("agents") as any).create({ sessionId: "default-skills", meta: { cwd: directory } });
        const claimed = { id: "prompt", role: "user", content: [{ type: "text", text: "start" }], source: { kind: "user" } };
        const decision: any = await agentEvents(context, handle.agent).waterfall("agent/pre-step", { turn: 1, step: 1, signal: new AbortController().signal, messages: [claimed] } as any, () => Promise.resolve({ kind: "enter", messages: [claimed] } as any));
        entries = decision.messages.find((message: any) => message.source?.kind === "skill-catalog")?.source?.entries ?? [];
        await handle.dispose();
      } };
      const kernel = new Kernel<SealHarnessEvents>({ initialServices: [[sessionStoreToken, new MemorySessionStore()]] });
      await kernel.start([plugin(dshCompatPlugin, { skills: { filesystem: false }, plugins: [{ plugin: consumer }] })]);
      expect(entries.some((entry) => entry.name === "dsh-badge")).toBe(false);
      await kernel.stop();
    } finally { await rm(directory, { recursive: true, force: true }); }
  });

  it("loads the official hierarchical workspace instructions before the first request", async () => {
    const directory = await mkdtemp(join(tmpdir(), "seal-dsh-instructions-")); let messages: any[] = [];
    try {
      await writeFile(join(directory, "AGENTS.md"), "# Test instructions\nAlways preserve durable evidence.\n", "utf8");
      const consumer: DshPluginModule = { name: "instructions-consumer", inject: ["agents"], async apply(context) {
        const handle = await (context.get("agents") as any).create({ sessionId: "instructions-session", meta: { cwd: directory } });
        const claimed = { id: "prompt", role: "user", content: [{ type: "text", text: "start" }], source: { kind: "user" } };
        const decision: any = await agentEvents(context, handle.agent).waterfall("agent/pre-step", { turn: 1, step: 1, signal: new AbortController().signal, messages: [claimed] } as any, () => Promise.resolve({ kind: "enter", messages: [claimed] } as any));
        messages = decision.messages;
        await handle.dispose();
      } };
      const kernel = new Kernel<SealHarnessEvents>({ initialServices: [[sessionStoreToken, new MemorySessionStore()]] });
      await kernel.start([plugin(dshCompatPlugin, { agentInstructions: { dshHome: join(directory, ".dsh") }, plugins: [{ plugin: consumer }] })]);
      const workspace = messages.find((message) => message.source?.kind === "agent-instructions");
      expect(workspace?.content.map((block: any) => block.text ?? "").join("\n")).toContain("Always preserve durable evidence.");
      expect(workspace?.source).toMatchObject({ kind: "agent-instructions", baseline: true });
      await kernel.stop();
    } finally { await rm(directory, { recursive: true, force: true }); }
  });

  it("injects the official repeat-tool reminder through bridged DSH tool executions", async () => {
    const tools = new RecordingTools(); let contexts: any[] = [];
    const consumer: DshPluginModule = { name: "repeat-reminder-consumer", inject: ["agents", "tools"], async apply(context) {
      (context.get("tools") as any).register({
        name: "probe", description: "Probe repeatedly", parameters: { type: "object" },
        output: { schema: { type: "string" }, render: () => [{ type: "text", text: "same result" }] },
        async execute() { return "same result"; },
      });
      const handle = await (context.get("agents") as any).create({ sessionId: "repeat-session", meta: { cwd: process.cwd() } });
      const invoke = () => tools.execute({ callId: toolCallId(crypto.randomUUID()), sessionId: "repeat-session" as never, cwd: process.cwd(), name: "probe", input: { b: 2, a: 1 }, signal: new AbortController().signal });
      await invoke();
      contexts = [...(await invoke()).additionalContexts ?? []];
      await agentEvents(context, handle.agent).waterfall("agent/pre-step", { turn: 1, step: 2, signal: new AbortController().signal, messages: [{ id: "reset-message", role: "user", content: [{ type: "text", text: "try again" }], source: { kind: "user" } } as any] }, () => Promise.resolve({ kind: "enter", messages: [] }));
      contexts.push(...(await invoke()).additionalContexts ?? []);
      contexts.push(...(await invoke()).additionalContexts ?? []);
      await handle.dispose();
    } };
    const kernel = new Kernel<SealHarnessEvents>({ initialServices: [[toolServiceToken, tools], [sessionStoreToken, new MemorySessionStore()]] });
    await kernel.start([plugin(dshCompatPlugin, { repeatToolReminder: { thresholds: [2] }, plugins: [{ plugin: consumer }] })]);
    expect(contexts).toHaveLength(2);
    expect(contexts.map((message) => message.source)).toEqual([
      { kind: "plugin", plugin: "repeat-tool-reminder", form: "notice", summary: "probe × 2" },
      { kind: "plugin", plugin: "repeat-tool-reminder", form: "notice", summary: "probe × 2" },
    ]);
    expect(contexts[0].content[0].text).toContain("repeating the exact same tool call");
    await kernel.stop();
  });

  it("applies the official default model selection to Agents without explicit options", async () => {
    let selection: unknown; let options: unknown;
    const models: ModelService = {
      async list() { return [{ provider: "seal", model: "default", contextWindow: 8_000, maxOutputTokens: 128 }, { provider: "seal", model: "other", contextWindow: 8_000, maxOutputTokens: 128 }]; },
      async get(ref) { return (await this.list()).find((item) => item.provider === ref.provider && item.model === ref.model); },
      async *stream() { yield { type: "done", stopReason: "stop" }; },
    };
    const consumer: DshPluginModule = { name: "default-model-consumer", inject: ["agents", "agentDefaultModel"], async apply(context) {
      selection = (context.get("agentDefaultModel") as any).currentSelection();
      const handle = await (context.get("agents") as any).create({ sessionId: "default-model-session", meta: { cwd: process.cwd() } });
      options = handle.agent.options;
      await handle.dispose();
    } };
    const kernel = new Kernel<SealHarnessEvents>({ initialServices: [[modelServiceToken, models], [sessionStoreToken, new MemorySessionStore()]] });
    await kernel.start([plugin(dshCompatPlugin, { sessionTitle: { llm: false }, plugins: [{ plugin: consumer }] })]);
    expect(selection).toEqual({ provider: "seal", model: "default" });
    expect(options).toMatchObject({ provider: "seal", model: "default" });
    await kernel.stop();
  });

  it("executes provider-owned retry policy with durable retry audit", async () => {
    let action: unknown; let events: string[] = [];
    const consumer: DshPluginModule = { name: "retry-consumer", inject: ["agents"], async apply(context) {
      const handle = await (context.get("agents") as any).create({ sessionId: "retry-session", meta: { cwd: process.cwd() } });
      action = await agentEvents(context, handle.agent).waterfall("agent/request-error", {
        turn: 1, step: 1, provider: "seal",
        failure: { code: "RATE_LIMIT", message: "busy" },
        retryPolicy: { mode: "normal", maxRetries: 2, retryableCodes: ["RATE_LIMIT"], initialDelayMs: 1, maxDelayMs: 1, jitterRatio: 0 },
        signal: new AbortController().signal,
      }, () => Promise.resolve(undefined));
      events = handle.agent.session.snapshotEvents().filter((event: any) => event.type.startsWith("llm/retry")).map((event: any) => event.type);
      await handle.dispose();
    } };
    const kernel = new Kernel<SealHarnessEvents>({ initialServices: [[sessionStoreToken, new MemorySessionStore()]] });
    await kernel.start([plugin(dshCompatPlugin, { plugins: [{ plugin: consumer }] })]);
    expect(action).toEqual({ kind: "retry" });
    expect(events).toEqual(["llm/retry", "llm/retry-started"]);
    await kernel.stop();
  });

  it("persists identity-bound projection checkpoints through the official cache", async () => {
    const directory = await mkdtemp(join(tmpdir(), "seal-dsh-projection-cache-")); let cached: any;
    try {
      const consumer: DshPluginModule = { name: "projection-cache-consumer", inject: ["agents", "sessionProjectionCache"], async apply(context) {
        const handle = await (context.get("agents") as any).create({ sessionId: "projection-cache-session", meta: { cwd: process.cwd() } });
        handle.agent.session.append("turn/start", { turn: 1 });
        handle.agent.session.append("user/message", { role: "user", content: [{ type: "text", text: "Cache this projection" }], source: { kind: "user" } }, { surfaceOp: "append" });
        handle.agent.session.append("step/end", { turn: 1, step: 1, reason: "completed" });
        handle.agent.session.append("turn/end", { turn: 1, reason: "completed" });
        const cache = context.get("sessionProjectionCache") as any;
        await cache.write(handle.agent.session);
        cached = { header: handle.agent.session.header, inheritedEventCount: handle.agent.session.inheritedEventCount, snapshot: cache.cachedSnapshot(handle.agent.session.header, handle.agent.session.inheritedEventCount, ["sessionStats", "turnOutline"]) };
        await handle.dispose();
      } };
      const kernel = new Kernel<SealHarnessEvents>({ initialServices: [[sessionStoreToken, new MemorySessionStore()]] });
      await kernel.start([plugin(dshCompatPlugin, { storage: { root: directory }, sessionProjectionCache: { writeEveryEvents: 10, writeIntervalMs: 60_000 }, plugins: [{ plugin: consumer }] })]);
      await vi.waitFor(() => expect(cached).toBeDefined());
      expect(cached.snapshot).toMatchObject({ values: { sessionStats: { turns: 1, steps: 1 }, turnOutline: [expect.objectContaining({ turn: 1, prompt: "Cache this projection" })] } });
      await kernel.stop();
    } finally { await rm(directory, { recursive: true, force: true }); }
  });

  it("checkpoints the durable request prefix before DSH model dispatch", async () => {
    const order: string[] = []; const store = new MemorySessionStore();
    const models: ModelService = {
      async list() { return [{ provider: "seal", model: "chat", contextWindow: 8_000, maxOutputTokens: 128 }]; },
      async get(ref) { return ref.provider === "seal" && ref.model === "chat" ? (await this.list())[0] : undefined; },
      async *stream() { order.push("dispatch"); yield { type: "done", stopReason: "stop" }; },
    };
    const consumer: DshPluginModule = { name: "checkpoint-consumer", inject: ["agents", "llm"], async apply(context) {
      const sessions = context.get("sessions") as any; const originalFlush = sessions.flush.bind(sessions);
      sessions.flush = async (...args: any[]) => { order.push("flush"); return originalFlush(...args); };
      const handle = await (context.get("agents") as any).create({ sessionId: "checkpoint-session", meta: { cwd: process.cwd() } });
      handle.agent.session.append("request/header", { header: { config: { provider: "seal", model: "chat" } }, reason: "initial" });
      order.length = 0;
      for await (const _chunk of (context.get("llm") as any).stream({ provider: "seal", model: "chat", sessionId: handle.agent.id, messages: [] })) { /* drain */ }
      await handle.dispose();
    } };
    const kernel = new Kernel<SealHarnessEvents>({ initialServices: [[toolServiceToken, new RecordingTools()], [modelServiceToken, models], [sessionStoreToken, store]] });
    await kernel.start([plugin(dshCompatPlugin, { sessionTitle: { llm: false }, plugins: [{ plugin: consumer }] })]);
    expect(order.slice(0, 2)).toEqual(["flush", "dispatch"]);
    await kernel.stop();
  });

  it("registers the official whole-log turn outline with bounded prompt and response previews", async () => {
    let outline: unknown;
    const consumer: DshPluginModule = { name: "outline-consumer", inject: ["agents", "sessionProjections"], async apply(context) {
      const handle = await (context.get("agents") as any).create({ sessionId: "outline-session", meta: { cwd: process.cwd() } });
      handle.agent.session.append("turn/start", { turn: 1 });
      handle.agent.session.append("user/message", { role: "user", content: [{ type: "text", text: `Investigate   ${"deep alignment ".repeat(8)}` }], source: { kind: "user" } }, { surfaceOp: "append" });
      handle.agent.session.append("assistant/message", { turn: 1, step: 1, message: { role: "assistant", content: [{ type: "text", text: "The final response is durable and navigable." }] } }, { surfaceOp: "append" });
      handle.agent.session.append("turn/end", { turn: 1, reason: "completed" });
      outline = (context.get("sessionProjections") as any).stateOf(handle.agent.session, "turnOutline");
      await handle.dispose();
    } };
    const kernel = new Kernel<SealHarnessEvents>({ initialServices: [[sessionStoreToken, new MemorySessionStore()]] });
    await kernel.start([plugin(dshCompatPlugin, { localSandbox: false, plugins: [{ plugin: consumer }] })]);
    expect(outline).toEqual({ draft: "", turns: [expect.objectContaining({ turn: 1, seq: 0, prompt: expect.stringMatching(/^Investigate deep alignment.*…$/), response: "The final response is durable and navigable." })] });
    await kernel.stop();
  });

  it("registers the official whole-log session stats projection before consumers", async () => {
    let stats: unknown;
    const consumer: DshPluginModule = { name: "stats-consumer", inject: ["agents", "sessionProjections"], async apply(context) {
      const handle = await (context.get("agents") as any).create({ sessionId: "stats-session", meta: { cwd: process.cwd() } });
      handle.agent.session.append("step/start", { turn: 1, step: 1 });
      handle.agent.session.append("step/end", { turn: 1, step: 1, reason: "completed" });
      handle.agent.session.append("step/start", { turn: 1, step: 2 });
      handle.agent.session.append("step/end", { turn: 1, step: 2, reason: "cancelled" });
      handle.agent.session.append("step/start", { turn: 2, step: 1 });
      handle.agent.session.append("step/end", { turn: 2, step: 1, reason: "failed" });
      stats = (context.get("sessionProjections") as any).stateOf(handle.agent.session, "sessionStats");
      await handle.dispose();
    } };
    const kernel = new Kernel<SealHarnessEvents>({ initialServices: [[sessionStoreToken, new MemorySessionStore()]] });
    await kernel.start([plugin(dshCompatPlugin, { plugins: [{ plugin: consumer }] })]);
    expect(stats).toMatchObject({ turns: 2, steps: 3, llmMs: 0, toolMs: 0, ttftSteps: 0, decodeTokens: 0 });
    await kernel.stop();
  });

  it("routes the official first-prompt LLM title provider through Seal ModelService", async () => {
    const requests: any[] = []; let title: any; let titleEvents: any[] = [];
    const models: ModelService = {
      async list() { return [{ provider: "seal", model: "title", displayName: "Title Model", contextWindow: 8_000, maxOutputTokens: 128 }]; },
      async get(ref) { return ref.provider === "seal" && ref.model === "title" ? (await this.list())[0] : undefined; },
      async *stream(request) { requests.push(request); yield { type: "text_delta", delta: "Concise aligned title" }; yield { type: "done", stopReason: "stop" }; },
    };
    const consumer: DshPluginModule = { name: "title-llm-consumer", inject: ["agents", "sessionTitle"], async apply(context) {
      const handle = await (context.get("agents") as any).create({ sessionId: "title-llm-session", meta: { cwd: process.cwd() } });
      handle.agent.session.append("user/message", { role: "user", content: [{ type: "text", text: "Please align all runtime behavior with DeepSeek Harness" }], source: { kind: "user" } }, { surfaceOp: "append" });
      handle.agent.session.append("request/header", { header: { config: { provider: "seal", model: "title" } }, reason: "initial" });
      for (let index = 0; index < 20 && requests.length === 0; index += 1) await new Promise((resolve) => setTimeout(resolve, 0));
      for (let index = 0; index < 20 && (context.get("sessionTitle") as any).get(handle.agent.session)?.source?.kind !== "provider"; index += 1) await new Promise((resolve) => setTimeout(resolve, 0));
      title = (context.get("sessionTitle") as any).get(handle.agent.session);
      titleEvents = handle.agent.session.snapshotEvents().filter((event: any) => event.type === "session/title");
      await handle.dispose();
    } };
    const kernel = new Kernel<SealHarnessEvents>({ initialServices: [[modelServiceToken, models], [sessionStoreToken, new MemorySessionStore()]] });
    await kernel.start([plugin(dshCompatPlugin, { sessionTitle: { llm: { provider: "seal", model: "title" } }, plugins: [{ plugin: consumer }] })]);
    expect(requests[0]).toMatchObject({ model: { provider: "seal", model: "title" }, maxOutputTokens: 64, sessionId: "title-llm-session", purpose: "session-title" });
    expect(title).toMatchObject({ title: "Concise aligned title", source: { kind: "provider", provider: "session-title-first-prompt-llm" } });
    expect(titleEvents.map((event) => event.data.title)).toEqual(["Please align all runtime behavior", "Concise aligned title"]);
    await kernel.stop();
  });

  it("supports the official all-prompts LLM title cadence", async () => {
    const requests: any[] = []; let title: any; let titleEvents: any[] = [];
    const models: ModelService = {
      async list() { return [{ provider: "seal", model: "title", displayName: "Title Model", contextWindow: 8_000, maxOutputTokens: 128 }]; },
      async get(ref) { return ref.provider === "seal" && ref.model === "title" ? (await this.list())[0] : undefined; },
      async *stream(request) { requests.push(request); yield { type: "text_delta", delta: `Title revision ${requests.length}` }; yield { type: "done", stopReason: "stop" }; },
    };
    const consumer: DshPluginModule = { name: "title-all-prompts-consumer", inject: ["agents", "sessionTitle"], async apply(context) {
      const handle = await (context.get("agents") as any).create({ sessionId: "title-all-prompts", meta: { cwd: process.cwd() } });
      handle.agent.session.append("user/message", { role: "user", content: [{ type: "text", text: "Align runtime behavior" }], source: { kind: "user" } }, { surfaceOp: "append" });
      handle.agent.session.append("request/header", { header: { config: { provider: "seal", model: "title" } }, reason: "initial" });
      await vi.waitFor(() => expect(requests).toHaveLength(1));
      handle.agent.session.append("user/message", { role: "user", content: [{ type: "text", text: "Also align title updates" }], source: { kind: "user" } }, { surfaceOp: "append" });
      handle.agent.session.append("request/header", { header: { config: { provider: "seal", model: "title" } }, reason: "continuation" });
      await vi.waitFor(() => expect(requests).toHaveLength(2));
      await vi.waitFor(() => expect((context.get("sessionTitle") as any).get(handle.agent.session)?.title).toBe("Title revision 2"));
      title = (context.get("sessionTitle") as any).get(handle.agent.session);
      titleEvents = handle.agent.session.snapshotEvents().filter((event: any) => event.type === "session/title");
      await handle.dispose();
    } };
    const kernel = new Kernel<SealHarnessEvents>({ initialServices: [[modelServiceToken, models], [sessionStoreToken, new MemorySessionStore()]] });
    await kernel.start([plugin(dshCompatPlugin, { sessionTitle: { llm: { strategy: "all-prompts", provider: "seal", model: "title" } }, plugins: [{ plugin: consumer }] })]);
    expect(requests).toHaveLength(2);
    expect(JSON.stringify(requests[1])).toContain("Align runtime behavior");
    expect(JSON.stringify(requests[1])).toContain("Also align title updates");
    expect(title).toMatchObject({ title: "Title revision 2", source: { kind: "provider", provider: "session-title-all-prompts-llm" } });
    expect(titleEvents.map((event) => event.data.title)).toEqual(["Align runtime behavior", "Title revision 1", "Title revision 2"]);
    await kernel.stop();
  });

  it("installs the official log-backed session title projection and rename protocol", async () => {
    let fallback: unknown; let renamed: unknown; let events: string[] = [];
    const consumer: DshPluginModule = { name: "title-consumer", inject: ["agents", "sessionTitle"], async apply(context) {
      const handle = await (context.get("agents") as any).create({ sessionId: "title-session", meta: { cwd: process.cwd() } });
      handle.agent.session.append("user/message", { role: "user", content: [{ type: "text", text: "  Build durable session titles now  " }], source: { kind: "user" } }, { surfaceOp: "append" });
      await new Promise((resolve) => setTimeout(resolve, 0));
      const titles = context.get("sessionTitle") as any;
      fallback = titles.get(handle.agent.session);
      renamed = titles.rename(handle.agent.session, "  Verified title  ");
      events = handle.agent.session.snapshotEvents().filter((event: any) => event.type === "session/title").map((event: any) => event.data.title);
      await handle.dispose();
    } };
    const kernel = new Kernel<SealHarnessEvents>({ initialServices: [[sessionStoreToken, new MemorySessionStore()]] });
    await kernel.start([plugin(dshCompatPlugin, { plugins: [{ plugin: consumer }] })]);
    expect(fallback).toMatchObject({ title: "Build durable session titles now", source: { kind: "fallback" } });
    expect(renamed).toMatchObject({ title: "Verified title", source: { kind: "user" } });
    expect(events).toEqual(["Build durable session titles now", "Verified title"]);
    await kernel.stop();
  });

  it("installs the official Unicode-safe tool-result pruner ahead of compaction", async () => {
    const kernel = new Kernel<SealHarnessEvents>();
    await kernel.start([plugin(dshCompatPlugin, { toolResultPruner: { thresholdChars: 48, headChars: 4, tailChars: 3 } })]);
    const pruner = kernel.use(dshCompatServiceToken).context.get("toolResultPruner") as any;
    const source = [{ type: "text", text: `HEAD😀${"x".repeat(80)}TAIL` }, { type: "image", data: "AA==", mediaType: "image/png" }];
    const pruned = pruner.pruneContent(source);
    expect(pruner.config).toEqual({ thresholdChars: 48, headChars: 4, tailChars: 3 });
    expect(pruned).toEqual([
      { type: "text", text: "HEAD\n\n[... tool result middle pruned ...]\n\nAIL" },
      source[1],
    ]);
    await kernel.stop();
  });

  it("installs the official scoped DSH command runtime and persists execution lifecycle", async () => {
    let descriptors: unknown; let execution: unknown; let events: string[] = [];
    const consumer: DshPluginModule = { name: "command-consumer", inject: ["agents", "commands"], async apply(context) {
      const handle = await (context.get("agents") as any).create({ sessionId: "command-session", meta: { cwd: process.cwd() } });
      const commands = context.get("commands") as any;
      commands.register({ name: "echo", description: "Echo command input", input: { hint: "text" }, handler: ({ rawInput }: any) => ({ kind: "success", text: rawInput }) });
      descriptors = commands.list(handle.agent);
      execution = await commands.execute(handle.agent, "/echo aligned", [], new AbortController().signal);
      events = handle.agent.session.snapshotEvents().filter((event: any) => event.type.startsWith("command/")).map((event: any) => event.type);
      await handle.dispose();
    } };
    const kernel = new Kernel<SealHarnessEvents>({ initialServices: [[sessionStoreToken, new MemorySessionStore()]] });
    await kernel.start([plugin(dshCompatPlugin, { plugins: [{ plugin: consumer }] })]);
    expect(descriptors).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: "echo", description: "Echo command input", input: { hint: "text" } }),
      expect.objectContaining({ name: "feedback" }),
      expect.objectContaining({ name: "goal" }),
    ]));
    expect(execution).toMatchObject({ result: { kind: "success", text: " aligned" } });
    expect(events).toEqual(["command/run", "command/done"]);
    await kernel.stop();
  });

  it("installs the official durable DSH goal lifecycle on compatible Agent sessions", async () => {
    let phases: string[] = []; let events: string[] = [];
    const consumer: DshPluginModule = { name: "goal-consumer", inject: ["agents", "goals"], async apply(context) {
      const handle = await (context.get("agents") as any).create({ sessionId: "goal-session", meta: { cwd: process.cwd() } });
      const goals = context.get("goals") as any;
      let view = goals.create(handle.agent, { objective: "ship alignment", maxGoalRounds: 4 }); phases.push(view.phase);
      view = goals.edit(handle.agent, { id: view.id, revision: view.revision }, { objective: "ship verified alignment" });
      view = goals.pause(handle.agent, { id: view.id, revision: view.revision }); phases.push(view.phase);
      view = goals.resume(handle.agent, { id: view.id, revision: view.revision }); phases.push(view.phase);
      view = goals.complete(handle.agent, { id: view.id, revision: view.revision }); phases.push(view.phase);
      events = handle.agent.session.snapshotEvents().filter((event: any) => event.type.startsWith("goal/")).map((event: any) => event.type);
      await handle.dispose();
    } };
    const kernel = new Kernel<SealHarnessEvents>({ initialServices: [[sessionStoreToken, new MemorySessionStore()]] });
    await kernel.start([plugin(dshCompatPlugin, { plugins: [{ plugin: consumer }] })]);
    expect(phases).toEqual(["active", "paused", "active", "complete"]);
    expect(events.length).toBe(5);
    expect(events.every((event) => event === "goal/change")).toBe(true);
    await kernel.stop();
  });

  it("routes official scoped DSH user questions through Seal structured answers", async () => {
    const ask = vi.fn(async () => ({ answers: [{ id: "choice", selected: ["Yes"] }] })); let answer: unknown; let delegatedCode: unknown;
    const consumer: DshPluginModule = { name: "question-consumer", inject: ["agents", "userQuestions"], async apply(context) {
      const handle = await (context.get("agents") as any).create({ sessionId: "question-session", meta: { cwd: process.cwd() } });
      answer = await (context.get("userQuestions") as any).ask({ agent: handle.agent, questions: [{ id: "choice", question: "Continue?", options: [{ label: "Yes" }, { label: "No" }] }] });
      const child = await (context.get("agents") as any).create({ sessionId: "question-child", meta: { cwd: process.cwd(), parentSession: "question-session", origin: "subagent", delegationDepth: 1 } });
      try { await (context.get("userQuestions") as any).ask({ agent: child.agent, questions: [{ id: "blocked", question: "Ask root?" }] }); } catch (error) { delegatedCode = (error as any).code; }
      await child.dispose();
      await handle.dispose();
    } };
    const kernel = new Kernel<SealHarnessEvents>({ initialServices: [[userQuestionServiceToken, { ask, registerAnswerer: vi.fn() } as any], [sessionStoreToken, new MemorySessionStore()]] });
    await kernel.start([plugin(dshCompatPlugin, { plugins: [{ plugin: consumer }] })]);
    expect(answer).toEqual({ answers: [{ id: "choice", selected: ["Yes"] }] });
    expect(ask).toHaveBeenCalledWith(expect.objectContaining({ sessionId: "question-session", questions: [expect.objectContaining({ id: "choice" })] }));
    expect(delegatedCode).toBe("DELEGATED_CALLER");
    await kernel.stop();
  });

  it("uses the official ask-user tool only when Seal has no native owner", async () => {
    const tools = new RecordingTools();
    const ask = vi.fn(async () => ({ answers: [{ id: "choice", selected: ["Continue"], custom: "now" }] }));
    let result: ToolResult | undefined;
    const consumer: DshPluginModule = { name: "ask-user-tool-consumer", inject: ["agents"], async apply(context) {
      const handle = await (context.get("agents") as any).create({ sessionId: "ask-user-tool", meta: { cwd: process.cwd() } });
      result = await tools.execute({ callId: toolCallId("ask-user"), sessionId: "ask-user-tool" as never, cwd: process.cwd(), name: "ask_user_question", input: { questions: [{ id: "choice", question: "Continue?", multi_select: true }] }, signal: new AbortController().signal });
      await handle.dispose();
    } };
    const kernel = new Kernel<SealHarnessEvents>({ initialServices: [[toolServiceToken, tools], [userQuestionServiceToken, { ask, registerAnswerer: vi.fn() } as any], [sessionStoreToken, new MemorySessionStore()]] });
    await kernel.start([plugin(dshCompatPlugin, { plugins: [{ plugin: consumer }] })]);
    expect(result?.isError).not.toBe(true);
    expect(result).toMatchObject({ content: [{ type: "text", text: '{"answers":[{"id":"choice","selected":["Continue"],"custom":"now"}]}' }] });
    expect(ask).toHaveBeenCalledWith(expect.objectContaining({ sessionId: "ask-user-tool", questions: [expect.objectContaining({ id: "choice", multiSelect: true })] }));
    await kernel.stop();

    const nativeTools = new RecordingTools();
    const native = { name: "ask_user_question", description: "native", inputSchema: { type: "object" }, classify: () => ({ kind: "tool" as const, toolName: "ask_user_question", risk: "read" as const, summary: "native" }), execute: async () => ({ content: [] }) };
    nativeTools.register(native);
    const nativeKernel = new Kernel<SealHarnessEvents>({ initialServices: [[toolServiceToken, nativeTools]] });
    await nativeKernel.start([plugin(dshCompatPlugin, {})]);
    expect(nativeTools.definitionsByName.get("ask_user_question")).toBe(native);
    await nativeKernel.stop();
  });

  it("routes official DSH approval policy, waterfall, and audit through Seal approval", async () => {
    const request = vi.fn(async () => true); let outcome: unknown; let audit: string[] = [];
    const consumer: DshPluginModule = { name: "approval-consumer", inject: ["agents", "approval"], async apply(context) {
      const handle = await (context.get("agents") as any).create({ sessionId: "approval-session", meta: { cwd: process.cwd() } });
      handle.agent.session.append("turn/start", { turn: 1 });
      outcome = await (context.get("approval") as any).request({ agent: handle.agent, toolName: "write_file", callId: "call-1", reason: "update source" });
      audit = handle.agent.session.snapshotEvents().filter((event: any) => event.type.startsWith("approval/")).map((event: any) => event.type);
      await handle.dispose();
    } };
    const kernel = new Kernel<SealHarnessEvents>({ initialServices: [[approvalServiceToken, { request } as any], [sessionStoreToken, new MemorySessionStore()]] });
    await kernel.start([plugin(dshCompatPlugin, { localSandbox: false, plugins: [{ plugin: consumer }] })]);
    expect(outcome).toBe("allowed-once");
    expect(request).toHaveBeenCalledWith(expect.objectContaining({ title: "Approve write_file", message: "update source", details: { toolName: "write_file", callId: "call-1" } }));
    expect(audit).toEqual(["approval/asked", "approval/decided"]);
    await kernel.stop();
  });

  it("exposes Seal reference credentials through the DSH provider without leaking values from describe", async () => {
    const resolveRef = vi.fn(async (ref: string) => ref === "DEEPSEEK_API_KEY" ? "secret" : undefined);
    const kernel = new Kernel<SealHarnessEvents>({ initialServices: [[credentialServiceToken, { resolve: vi.fn(), resolveRef } as any]] });
    await kernel.start([plugin(dshCompatPlugin, {})]);
    const credentials = kernel.use(dshCompatServiceToken).context.get("credentials") as any;
    expect(await credentials.resolve("DEEPSEEK_API_KEY")).toEqual({ value: "secret", source: "seal" });
    expect(await credentials.describe("DEEPSEEK_API_KEY")).toEqual({ configured: true, source: "seal", writable: false });
    expect(await credentials.describe("MISSING_KEY")).toEqual({ configured: false, writable: false });
    await expect(credentials.set("DEEPSEEK_API_KEY", "replacement")).rejects.toThrow("read-only");
    await kernel.stop();
  });

  it("forwards official DSH credential writes to a writable Seal provider", async () => {
    const setRef = vi.fn(async () => {}); const unsetRef = vi.fn(async () => {});
    const describeRef = vi.fn(async () => ({ configured: true, source: "file", writable: true }));
    const record = { kind: "grant", payload: { token: "opaque" } }; const readRecord = vi.fn(async () => record);
    const describeRecord = vi.fn(async () => ({ configured: true, kind: "grant", writable: true }));
    const listRecords = vi.fn(async () => [{ key: "oauth/account", kind: "grant" }]);
    const modifyRecord = vi.fn(async (_key: string, mutate: any) => mutate(record)); const deleteRecord = vi.fn(async () => {});
    const kernel = new Kernel<SealHarnessEvents>({ initialServices: [[credentialServiceToken, { resolve: vi.fn(), resolveRef: vi.fn(), describeRef, setRef, unsetRef, readRecord, describeRecord, listRecords, modifyRecord, deleteRecord } as any]] });
    await kernel.start([plugin(dshCompatPlugin, {})]);
    const credentials = kernel.use(dshCompatServiceToken).context.get("credentials") as any;
    expect(await credentials.describe("DEEPSEEK_API_KEY")).toEqual({ configured: true, source: "file", writable: true });
    await credentials.set("DEEPSEEK_API_KEY", "replacement"); await credentials.unset("DEEPSEEK_API_KEY");
    expect(setRef).toHaveBeenCalledWith("DEEPSEEK_API_KEY", "replacement");
    expect(unsetRef).toHaveBeenCalledWith("DEEPSEEK_API_KEY");
    expect(await credentials.readRecord("oauth/account")).toEqual(record);
    expect(await credentials.describeRecord("oauth/account")).toEqual({ configured: true, kind: "grant", writable: true });
    expect(await credentials.listRecords()).toEqual([{ key: "oauth/account", kind: "grant" }]);
    await credentials.modifyRecord("oauth/account", async (current: any) => current); await credentials.deleteRecord("oauth/account");
    expect(modifyRecord).toHaveBeenCalled(); expect(deleteRecord).toHaveBeenCalledWith("oauth/account");
    await kernel.stop();
  });

  it("mounts the official authorization seam over the shared credential authority", async () => {
    let stored: any; const listeners = new Set<(change: any) => void>();
    const credentialsService = {
      resolve: vi.fn(), resolveRef: vi.fn(),
      subscribe(listener: (change: any) => void) { listeners.add(listener); return () => listeners.delete(listener); },
      async describeRecord() { return { configured: stored !== undefined, writable: true, ...(stored === undefined ? {} : { kind: stored.kind }) }; },
      async modifyRecord(key: string, mutate: (current: any) => Promise<any>) {
        stored = await mutate(stored);
        for (const listener of listeners) listener({ kind: "record", key });
        return stored;
      },
    };
    const kernel = new Kernel<SealHarnessEvents>({ initialServices: [[credentialServiceToken, credentialsService as any]] });
    await kernel.start([plugin(dshCompatPlugin, {})]);
    const context = kernel.use(dshCompatServiceToken).context;
    const authorization = context.get("authorization") as any;
    const credentials = context.get("credentials") as any;
    const notices: any[] = []; const prompts: any[] = [];
    authorization.registerFlow({
      key: "oauth/account", label: "Test OAuth", methods: [{ id: "device", label: "Device code" }],
      async run(session: any) {
        session.notify({ message: "Open login", url: "https://example.test/login", code: "ABCD" });
        const answer = await session.prompt({ kind: "text", message: "Enter code" });
        await credentials.modifyRecord("oauth/account", async () => ({ kind: "grant", payload: { answer } }));
      },
    });
    expect(authorization.list()).toContainEqual({ key: "oauth/account", label: "Test OAuth", methods: [{ id: "device", label: "Device code" }], inFlight: false });
    await expect(authorization.begin({ key: "oauth/account", interaction: { notify: (notice: any) => notices.push(notice), prompt: async (prompt: any) => { prompts.push(prompt); return "confirmed"; } } })).resolves.toEqual({ status: "authorized" });
    expect(notices).toEqual([{ message: "Open login", url: "https://example.test/login", code: "ABCD" }]);
    expect(prompts).toEqual([{ kind: "text", message: "Enter code" }]);
    expect(stored).toEqual({ kind: "grant", payload: { answer: "confirmed" } });
    await kernel.stop();

    const disabled = new Kernel<SealHarnessEvents>({ initialServices: [[credentialServiceToken, credentialsService as any]] });
    await disabled.start([plugin(dshCompatPlugin, { authorization: false })]);
    expect(disabled.use(dshCompatServiceToken).context.get("authorization")).toBeUndefined();
    await disabled.stop();
  });

  it("exposes Seal confinement through the official DSH sandbox service", async () => {
    const confine = vi.fn((argv: readonly string[], policy: any) => ({ argv: ["runner", policy.mode, ...argv], enforcement: "full", denialSignatures: ["denied"], runnerFailureSignatures: [] }));
    const kernel = new Kernel<SealHarnessEvents>({ initialServices: [[sandboxServiceToken, { confine } as any]] });
    await kernel.start([plugin(dshCompatPlugin, {})]);
    const sandbox = kernel.use(dshCompatServiceToken).context.get("sandbox") as any;
    expect(sandbox.confine(["git", "status"], { mode: "workspace-write", workspaceRoot: "/workspace", sessionId: "session" })).toEqual({ argv: ["runner", "workspace-write", "git", "status"], enforcement: "full", denialSignatures: ["denied"], runnerFailureSignatures: [] });
    expect(confine).toHaveBeenCalledWith(["git", "status"], { mode: "workspace-write", workspaceRoot: "/workspace", sessionId: "session" });
    await kernel.stop();
  });

  it("defaults to the official fail-closed platform sandbox and supports explicit opt-out", async () => {
    const enabled = new Kernel<SealHarnessEvents>();
    await enabled.start([plugin(dshCompatPlugin, {})]);
    expect(enabled.use(dshCompatServiceToken).context.get("sandbox")?.constructor.name).toBe("LocalSandboxProvider");
    expect(enabled.use(dshCompatServiceToken).context.get("sandboxPolicy")).toBeDefined();
    await enabled.stop();

    const disabled = new Kernel<SealHarnessEvents>();
    await disabled.start([plugin(dshCompatPlugin, { localSandbox: false })]);
    expect(disabled.use(dshCompatServiceToken).context.get("sandbox")).toBeUndefined();
    expect(disabled.use(dshCompatServiceToken).context.get("sandboxPolicy")).toBeUndefined();
    await disabled.stop();
  });

  it("derives permission defaults from DSH_PERMISSION_MODE while preserving explicit overrides", async () => {
    const previous = process.env.DSH_PERMISSION_MODE;
    process.env.DSH_PERMISSION_MODE = "danger-full-access";
    const ambient = new Kernel<SealHarnessEvents>();
    const overridden = new Kernel<SealHarnessEvents>();
    try {
      await ambient.start([plugin(dshCompatPlugin, {})]);
      const ambientContext = ambient.use(dshCompatServiceToken).context;
      expect((ambientContext.get("sandboxPolicy") as any).defaultMode).toBe("danger-full-access");
      expect((ambientContext.get("approval") as any).config.policy).toBe("never");
      expect((ambientContext.get("permissionPresets") as any).defaultPreset).toBe("danger-full-access");
      await ambient.stop();

      await overridden.start([plugin(dshCompatPlugin, {
        sandboxPolicy: { mode: "read-only" },
        approval: { policy: "ask" },
      })]);
      const overriddenContext = overridden.use(dshCompatServiceToken).context;
      expect((overriddenContext.get("sandboxPolicy") as any).defaultMode).toBe("read-only");
      expect((overriddenContext.get("approval") as any).config.policy).toBe("ask");
      expect((overriddenContext.get("permissionPresets") as any).defaultPreset).toBe("read-only");
      await overridden.stop();
    } finally {
      if (previous === undefined) delete process.env.DSH_PERMISSION_MODE;
      else process.env.DSH_PERMISSION_MODE = previous;
    }
  });

  it("persists official permission presets across sandbox and approval policy state", async () => {
    const tools = new RecordingTools(); let state: any; let events: string[] = [];
    const confine = vi.fn((argv: readonly string[]) => ({ argv, enforcement: "full", denialSignatures: [], runnerFailureSignatures: [] }));
    const consumer: DshPluginModule = { name: "permission-preset-consumer", inject: ["agents", "permissionPresets", "approval"], async apply(context) {
      const handle = await (context.get("agents") as any).create({ sessionId: "permission-session", meta: { cwd: process.cwd() } });
      const presets = context.get("permissionPresets") as any;
      presets.apply(handle.agent.session, "danger-full-access", (policy: string) => (context.get("approval") as any).setPolicy(handle.agent, policy));
      state = { current: presets.current(handle.agent.session), shellMode: (context.get("shell") as any).sandboxMode };
      events = handle.agent.session.snapshotEvents().filter((event: any) => ["permission/preset", "sandbox/mode", "approval/policy"].includes(event.type)).map((event: any) => event.type);
      await handle.dispose();
    } };
    const kernel = new Kernel<SealHarnessEvents>({ initialServices: [[toolServiceToken, tools], [sandboxServiceToken, { confine } as any], [sessionStoreToken, new MemorySessionStore()]] });
    await kernel.start([plugin(dshCompatPlugin, { plugins: [{ plugin: consumer }] })]);
    expect(state).toEqual({ current: "danger-full-access", shellMode: "workspace-write" });
    expect(events).toEqual(expect.arrayContaining(["permission/preset", "sandbox/mode", "approval/policy"]));
    await kernel.stop();
  });

  it("mounts official settings-file on the same document exposed by Seal settings", async () => {
    const directory = await mkdtemp(join(tmpdir(), "seal-dsh-settings-")); const path = join(directory, "settings.yaml");
    const settings = await FileSettingsService.open(path); let documentPath = "";
    const confine = vi.fn((argv: readonly string[]) => ({ argv, enforcement: "full", denialSignatures: [], runnerFailureSignatures: [] }));
    const consumer: DshPluginModule = { name: "shared-settings-consumer", inject: ["settings"], async apply(context) {
      const provider = context.get("settings") as any; documentPath = provider.documentPath;
      await provider.update("permission", { defaultPreset: "danger-full-access" });
    } };
    const kernel = new Kernel<SealHarnessEvents>({ initialServices: [[settingsServiceToken, settings], [sandboxServiceToken, { confine } as any], [sessionStoreToken, new MemorySessionStore()]] });
    try {
      await kernel.start([plugin(dshCompatPlugin, { settingsFile: { watch: false }, plugins: [{ plugin: consumer }] })]);
      expect(documentPath).toBe(path);
      expect(kernel.use(dshCompatServiceToken).context.get("settingsController")).toBeDefined();
      expect(await readFile(path, "utf8")).toContain("defaultPreset: danger-full-access");
      await kernel.stop();
    } finally { await rm(directory, { recursive: true, force: true }); }
  });

  it("defaults to the official DSH_HOME settings document and supports explicit opt-out", async () => {
    const directory = await mkdtemp(join(tmpdir(), "seal-dsh-default-settings-"));
    const previous = process.env.DSH_HOME;
    process.env.DSH_HOME = directory;
    const enabled = new Kernel<SealHarnessEvents>();
    const disabled = new Kernel<SealHarnessEvents>();
    try {
      await enabled.start([plugin(dshCompatPlugin, {})]);
      const context = enabled.use(dshCompatServiceToken).context;
      expect(context.get("settings")?.constructor.name).toBe("FileSettingsProvider");
      expect((context.get("settings") as any).documentPath).toBe(join(directory, "settings.yaml"));
      expect((context.get("settings") as any).describe().map((row: { ns: string }) => row.ns)).toContain("ui-onboarding");
      expect(context.get("settingsController")).toBeDefined();
      await enabled.stop();

      await disabled.start([plugin(dshCompatPlugin, { settingsFile: false })]);
      expect(disabled.use(dshCompatServiceToken).context.get("settings")).toBeUndefined();
      expect(disabled.use(dshCompatServiceToken).context.get("settingsController")).toBeDefined();
      await disabled.stop();
    } finally {
      if (previous === undefined) delete process.env.DSH_HOME;
      else process.env.DSH_HOME = previous;
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("installs the official package-scoped runtime invariant registry", async () => {
    let registry: any;
    const consumer: DshPluginModule = { name: "invariant-consumer", inject: ["invariants"], apply(context) { registry = context.get("invariants"); } };
    const kernel = new Kernel();
    await kernel.start([plugin(dshCompatPlugin, { plugins: [{ plugin: consumer }] })]);
    const dispose = registry.register("@seal-harness/fixture", (_context: any, fail: (message: string) => never) => { expect(() => fail("broken state")).toThrow('invariant violated by "@seal-harness/fixture": broken state'); });
    await Promise.resolve(dispose as any);
    await dispose();
    await kernel.stop();
  });

  it("bridges DSH image attachment persistence and request reads", async () => {
    const bytes = new Uint8Array(await sharp({ create: { width: 20, height: 10, channels: 3, background: "#abcdef" } }).jpeg().toBuffer());
    const put = vi.fn(async () => ({ type: "attachment", id: "sha256:image", mimeType: "image/jpeg", bytes: bytes.byteLength, width: 20, height: 10, name: "pixel.jpg" }));
    const get = vi.fn(async () => ({ data: bytes, mimeType: "image/jpeg", name: "pixel.jpg" }));
    const kernel = new Kernel<SealHarnessEvents>({ initialServices: [[attachmentServiceToken, { imageLimits: { maxImageBytes: 2048, maxImagesPerMessage: 2, maxMessageImageBytes: 4096, maxImagePixels: 1000, maxImageDimension: 100, mediaTypes: ["image/jpeg"] }, put, get } as any]] });
    await kernel.start([plugin(dshCompatPlugin, {})]);
    const attachments = kernel.use(dshCompatServiceToken).context.get("attachments") as any;
    const ref = await attachments.saveImage({ data: bytes, mediaType: "image/jpeg", name: "pixel.jpg" });
    expect(ref).toMatchObject({ attachmentId: "sha256:image", mediaType: "image/jpeg", bytes: bytes.byteLength, width: 20, height: 10 });
    expect((await attachments.readImage(ref)).data).toEqual(bytes);
    const [request, sharedRequest] = await Promise.all([
      attachments.readImageRequest(ref, { maxPixels: 50, maxBytes: 100 }),
      attachments.readImageRequest(ref, { maxPixels: 50, maxBytes: 100 }),
    ]);
    expect(request).toMatchObject({ attachment: ref, mediaType: "image/jpeg", width: 10, height: 5, depth: "uchar", space: "srgb", hasAlpha: false });
    expect(request.bytes).toBe(request.data.byteLength);
    expect(sharedRequest).toEqual(request);
    expect(get).toHaveBeenCalledTimes(2);
    const cancelled = new AbortController(); cancelled.abort(new Error("caller cancelled"));
    await expect(attachments.readImageRequest(ref, { maxPixels: 50, maxBytes: 100 }, cancelled.signal)).rejects.toThrow("caller cancelled");
    const gate = Promise.withResolvers<void>();
    get.mockImplementationOnce(async () => { await gate.promise; return { data: bytes, mimeType: "image/jpeg", name: "pixel.jpg" }; });
    const firstSignal = new AbortController();
    const firstWaiter = attachments.readImageRequest(ref, { maxPixels: 40, maxBytes: 100 }, firstSignal.signal);
    const survivingWaiter = attachments.readImageRequest(ref, { maxPixels: 40, maxBytes: 100 });
    firstSignal.abort(new Error("only first waiter cancelled")); gate.resolve();
    await expect(firstWaiter).rejects.toThrow("only first waiter cancelled");
    await expect(survivingWaiter).resolves.toMatchObject({ attachment: ref, width: 8, height: 4 });
    expect(get).toHaveBeenCalledTimes(3);
    await kernel.stop();
  });

  it("bridges DSH continuable subagent control to Seal ownership APIs", async () => {
    const child = { sessionId: "child", parentSessionId: "parent", label: "research", status: "running", model: { provider: "seal", model: "chat" } } as any;
    const spawn = vi.fn(async () => child);
    const list = vi.fn(async (parentId: string) => parentId === "parent" ? [child] : []);
    const send = vi.fn(async () => child);
    const abort = vi.fn(async () => true);
    const wait = vi.fn(async () => ({ completed: [{ ...child, status: "completed", result: "done" }], timedOut: false }));
    const image = new Uint8Array(await sharp({ create: { width: 1, height: 1, channels: 4, background: { r: 1, g: 2, b: 3, alpha: 1 } } }).png().toBuffer());
    const attachmentStore = { imageLimits: { maxImageBytes: 1024, maxImagesPerMessage: 2, maxMessageImageBytes: 2048, maxImagePixels: 100, maxImageDimension: 10, mediaTypes: ["image/png"] }, put: vi.fn(async () => ({ type: "attachment", id: "sha256:prompt", mimeType: "image/png" })), get: vi.fn() };
    const kernel = new Kernel<SealHarnessEvents>({ initialServices: [[subagentServiceToken, { spawn, list, send, abort, wait } as any], [attachmentServiceToken, attachmentStore as any]] });
    await kernel.start([plugin(dshCompatPlugin, {})]);
    const service = kernel.use(dshCompatServiceToken).context.get("subagents") as any;
    const parent = { id: "parent", session: { header: { cwd: "/workspace" } }, options: { provider: "seal", model: "chat", reasoningEffort: "high" } };
    const created = await service.startContinuable({ provider: "seal", label: "research", childId: "child", request: { parent, prompt: [{ type: "text", text: "investigate" }] }, signal: new AbortController().signal });
    expect(created.childId).toBe("child");
    expect(spawn).toHaveBeenCalledWith(expect.objectContaining({ sessionId: "child", parentSessionId: "parent", cwd: "/workspace", prompt: "investigate", label: "research", reasoning: "high" }));
    expect(await service.listChildren("parent")).toEqual([{ kind: "child", id: "child", activity: "running", hasChildren: false, mode: "continuable", label: "research" }]);
    const run = await service.start("seal", { parent, label: "one shot", prompt: [{ type: "text", text: "finish" }], signal: new AbortController().signal });
    expect(await run.result).toEqual({ output: [{ type: "text", text: "done" }], stopReason: "completed" });
    await run.dispose();
    expect(wait).toHaveBeenCalled();
    await service.sendMessage(parent, "child", [{ type: "text", text: "continue" }], { signal: new AbortController().signal });
    expect(send).toHaveBeenCalledWith("parent", "child", expect.objectContaining({ role: "user", content: [{ type: "text", text: "continue" }] }));
    expect(await service.prompt({ requestId: "browser-message", parentSessionId: "parent", childSessionId: "child", mode: "continuable", content: [{ type: "text", text: "from browser" }] }, new AbortController().signal)).toEqual({ messageId: "browser-message" });
    expect(send).toHaveBeenLastCalledWith("parent", "child", expect.objectContaining({ id: "browser-message", content: [{ type: "text", text: "from browser" }] }));
    await service.prompt({ requestId: "browser-image", parentSessionId: "parent", childSessionId: "child", mode: "continuable", content: [{ type: "image", mediaType: "image/png", data: Buffer.from(image).toString("base64") }] }, new AbortController().signal);
    expect(send).toHaveBeenLastCalledWith("parent", "child", expect.objectContaining({ content: [{ type: "attachment", id: "sha256:prompt", mimeType: "image/png" }] }));
    service.interrupt("child", { kind: "user", parentSessionId: "parent" });
    await vi.waitFor(() => expect(abort).toHaveBeenCalledWith("parent", "child", expect.any(String)));
    await kernel.stop();
  });

  it("registers external and in-process subagent providers without starting child processes", async () => {
    const kernel = new Kernel<SealHarnessEvents>();
    await kernel.start([plugin(dshCompatPlugin, { externalSubagents: { acp: { command: "test-acp-agent" } }, inProcessSubagents: { spawn: {}, fork: {} } })]);
    const subagents = kernel.use(dshCompatServiceToken).context.get("subagents") as any;
    expect([...subagents.providers.keys()].sort()).toEqual(["acp", "fork", "spawn"]);
    expect(subagents.providers.get("acp")).toMatchObject({ name: "acp", inheritsParentContext: false, capabilities: { outputSchema: false, agentOptions: false } });
    expect(subagents.providers.has("claude-code")).toBe(false);
    expect(subagents.providers.has("codex")).toBe(false);
    expect(subagents.providers.has("dsh-sdk")).toBe(false);
    expect(subagents.providers.get("spawn")).toMatchObject({ name: "spawn", inheritsParentContext: false, capabilities: { outputSchema: true, agentOptions: true, depthLimit: true, toolFilter: true, persona: true } });
    expect(subagents.providers.get("fork")).toMatchObject({ name: "fork", inheritsParentContext: true, capabilities: { outputSchema: true, agentOptions: true, depthLimit: true, toolFilter: true, persona: true } });
    await kernel.stop();
  });

  it.each(["claudeCode", "codex"])("rejects the legacy %s engine before startup", async name => {
    const kernel = new Kernel<SealHarnessEvents>();
    await expect(kernel.start([plugin(dshCompatPlugin, { externalSubagents: { [name]: {} } })])).rejects.toMatchObject({ cause: { message: expect.stringContaining("PI as its only agent engine") } });
    await kernel.stop();
  });

  it("defaults standalone hosts to the official in-process spawn and fork providers", async () => {
    const kernel = new Kernel<SealHarnessEvents>();
    await kernel.start([plugin(dshCompatPlugin, {})]);
    const context = kernel.use(dshCompatServiceToken).context;
    const subagents = context.get("subagents") as any;
    expect([...subagents.providers.keys()].sort()).toEqual(["fork", "spawn"]);
    expect(subagents.providers.get("spawn")).toMatchObject({ inheritsParentContext: false });
    expect(subagents.providers.get("fork")).toMatchObject({ inheritsParentContext: true });
    expect((context.get("workflowEngine") as any).config.provider).toBe("spawn");
    await kernel.stop();

    const disabled = new Kernel<SealHarnessEvents>();
    await disabled.start([plugin(dshCompatPlugin, { inProcessSubagents: false })]);
    expect(disabled.use(dshCompatServiceToken).context.get("subagents")).toBeUndefined();
    await disabled.stop();
  });

  it("defaults standalone hosts to the official search-disabled in-memory SQLite query backend", async () => {
    const kernel = new Kernel<SealHarnessEvents>();
    await kernel.start([plugin(dshCompatPlugin, {})]);
    const query = kernel.use(dshCompatServiceToken).context.get("sessionQuery") as any;
    expect(query.constructor.name).toBe("SqliteSessionQueryEngine");
    await expect(query.searchSessions({ query: "needle" })).rejects.toMatchObject({ code: "SESSION_QUERY_SEARCH_DISABLED" });
    await kernel.stop();

    const sealSessions = new MemorySessionStore();
    const bridged = new Kernel<SealHarnessEvents>({ initialServices: [[sessionStoreToken, sealSessions]] });
    await bridged.start([plugin(dshCompatPlugin, {})]);
    expect(bridged.use(dshCompatServiceToken).context.get("sessionQuery")?.constructor.name).toBe("SealSessionQuery");
    await bridged.stop();

    const searchDisabled = new Kernel<SealHarnessEvents>({ initialServices: [[sessionStoreToken, new MemorySessionStore()]] });
    await searchDisabled.start([plugin(dshCompatPlugin, { sessionQuerySqlite: false, sessionQuerySearch: false })]);
    const bridgedQuery = searchDisabled.use(dshCompatServiceToken).context.get("sessionQuery") as any;
    await expect(bridgedQuery.searchSessions({ query: "needle" })).rejects.toMatchObject({ code: "SESSION_QUERY_SEARCH_DISABLED" });
    await searchDisabled.stop();
  });

  it("keeps the official E2B world opt-in and validates credentials before mounting adapters", async () => {
    const kernel = new Kernel<SealHarnessEvents>();
    const failure = await kernel.start([plugin(dshCompatPlugin, { e2b: { apiKey: "" } })]).then(() => undefined, (error: unknown) => error);
    const diagnostics: string[] = []; let current = failure; const seen = new Set<unknown>();
    while (current !== undefined && current !== null && !seen.has(current)) { seen.add(current); diagnostics.push(current instanceof Error ? current.message : String(current)); current = typeof current === "object" ? Reflect.get(current, "cause") : undefined; }
    expect(diagnostics.join("\n")).toContain("configure apiKey or set E2B_API_KEY");
    await kernel.stop().catch(() => {});
  });

  it("defaults standalone hosts to the official durable JSONL session backend", async () => {
    const kernel = new Kernel<SealHarnessEvents>();
    await kernel.start([plugin(dshCompatPlugin, {})]);
    const persistence = kernel.use(dshCompatServiceToken).context.get("sessionPersistence") as any;
    expect(persistence?.constructor.name).toBe("JsonlSessionPersistence");
    expect(persistence.locate({ id: "default-jsonl", cwd: process.cwd() }).path).toContain(join(suiteDshHome, "sessions"));
    await kernel.stop();

    const sealSessions = new MemorySessionStore();
    const bridged = new Kernel<SealHarnessEvents>({ initialServices: [[sessionStoreToken, sealSessions]] });
    await bridged.start([plugin(dshCompatPlugin, {})]);
    expect(bridged.use(dshCompatServiceToken).context.get("sessionPersistence")?.constructor.name).toBe("SealSessionPersistenceBridge");
    await bridged.stop();
  });

  it("can use the official local credential provider when Seal does not own credentials", async () => {
    const directory = await mkdtemp(join(tmpdir(), "seal-dsh-credentials-"));
    const path = join(directory, "credentials.yaml");
    const kernel = new Kernel<SealHarnessEvents>();
    try {
      await kernel.start([plugin(dshCompatPlugin, { localCredentials: { path, watch: false } })]);
      const credentials = kernel.use(dshCompatServiceToken).context.get("credentials") as any;
      await credentials.set("DEEPSEEK_API_KEY", "secret-value");
      expect(await credentials.resolve("DEEPSEEK_API_KEY")).toMatchObject({ value: "secret-value", source: "file" });
      expect(await readFile(path, "utf8")).toContain("DEEPSEEK_API_KEY: secret-value");
    } finally {
      await kernel.stop();
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("defaults to the official managed credential provider and supports explicit opt-out", async () => {
    const directory = await mkdtemp(join(tmpdir(), "seal-dsh-default-credentials-"));
    const previous = process.env.DSH_HOME;
    process.env.DSH_HOME = directory;
    const enabled = new Kernel<SealHarnessEvents>();
    const disabled = new Kernel<SealHarnessEvents>();
    try {
      await enabled.start([plugin(dshCompatPlugin, {})]);
      const context = enabled.use(dshCompatServiceToken).context;
      expect(context.get("credentials")?.constructor.name).toBe("LocalCredentialProvider");
      expect(context.get("authorization")).toBeDefined();
      await enabled.stop();

      await disabled.start([plugin(dshCompatPlugin, { localCredentials: false })]);
      expect(disabled.use(dshCompatServiceToken).context.get("credentials")).toBeUndefined();
      expect(disabled.use(dshCompatServiceToken).context.get("authorization")).toBeUndefined();
      await disabled.stop();
    } finally {
      if (previous === undefined) delete process.env.DSH_HOME;
      else process.env.DSH_HOME = previous;
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("can select the official JSONL session persistence backend", async () => {
    const root = await mkdtemp(join(tmpdir(), "seal-dsh-sessions-"));
    const kernel = new Kernel<SealHarnessEvents>();
    try {
      await kernel.start([plugin(dshCompatPlugin, { sessionPersistenceJsonl: { root, compression: "none" } })]);
      const persistence = kernel.use(dshCompatServiceToken).context.get("sessionPersistence") as any;
      expect(persistence.name).toBe("session-persistence-jsonl");
      expect(await persistence.list()).toEqual([]);
    } finally {
      await kernel.stop();
      await rm(root, { recursive: true, force: true });
    }
  });

  it.runIf(process.platform === "win32")("can replace the foreground pwsh tool with the official persistent variant", async () => {
    const kernel = new Kernel<SealHarnessEvents>({ initialServices: [[toolServiceToken, new RecordingTools()]] });
    await kernel.start([plugin(dshCompatPlugin, { persistentPowerShell: {} })]);
    const tools = kernel.use(dshCompatServiceToken).context.get("tools") as any;
    const pwsh = tools.schemas().find((schema: any) => schema.name === "pwsh");
    expect(pwsh?.description).toContain("persistent PowerShell shell");
    await kernel.stop();
  });

  it("can use the official local attachment store when Seal does not own attachments", async () => {
    const dshHome = await mkdtemp(join(tmpdir(), "seal-dsh-attachments-"));
    const kernel = new Kernel<SealHarnessEvents>();
    try {
      await kernel.start([plugin(dshCompatPlugin, { localAttachments: { dshHome, maxImagesPerMessage: 3 } })]);
      const attachments = kernel.use(dshCompatServiceToken).context.get("attachments") as any;
      expect(attachments.root).toBe(join(dshHome, "attachments", "v1"));
      expect(attachments.imageLimits).toMatchObject({ maxImagesPerMessage: 3, maxImageBytes: 20 * 1024 * 1024 });
    } finally {
      await kernel.stop();
      await rm(dshHome, { recursive: true, force: true });
    }
  });

  it("runs the official continuable-by-default subagent tool over the Seal provider", async () => {
    const tools = new RecordingTools();
    const child = { sessionId: "official-child", parentSessionId: "official-parent", label: "research", status: "running", model: { provider: "seal", model: "chat" } } as any;
    const spawn = vi.fn(async () => child);
    const wait = vi.fn(async () => ({ completed: [{ ...child, status: "completed", result: "official result" }], timedOut: false }));
    let background: ToolResult | undefined; let foreground: ToolResult | undefined; let waitCallsAfterBackground = -1; let controlNames: string[] = [];
    const consumer: DshPluginModule = { name: "official-subagent-consumer", inject: ["agents"], async apply(context) {
      const handle = await (context.get("agents") as any).create({ sessionId: "official-parent", meta: { cwd: process.cwd() } });
      controlNames = tools.definitions("official-parent" as never, { includeHidden: true }).map((item) => item.name);
      background = await tools.execute({ callId: toolCallId("official-subagent-background"), sessionId: "official-parent" as never, cwd: process.cwd(), name: "subagent", input: { prompt: "inspect alignment", description: "research" }, signal: new AbortController().signal });
      waitCallsAfterBackground = wait.mock.calls.length;
      foreground = await tools.execute({ callId: toolCallId("official-subagent-foreground"), sessionId: "official-parent" as never, cwd: process.cwd(), name: "subagent", input: { prompt: "inspect alignment", description: "research", run_in_background: false }, signal: new AbortController().signal });
      await handle.dispose();
    } };
    const subagents = { spawn, wait, list: vi.fn(async () => []), send: vi.fn(), abort: vi.fn(async () => true) };
    const kernel = new Kernel<SealHarnessEvents>({ initialServices: [[toolServiceToken, tools], [subagentServiceToken, subagents as any], [sessionStoreToken, new MemorySessionStore()]] });
    await kernel.start([plugin(dshCompatPlugin, { plugins: [{ plugin: consumer }] })]);
    expect(tools.definitionsByName.has("subagent")).toBe(true);
    expect(controlNames).toEqual(expect.arrayContaining(["send_message", "interrupt_agent", "list_agents"]));
    expect(background?.isError).not.toBe(true);
    expect(background?.content.map((block) => block.type === "text" ? block.text : "").join("\n")).toContain("started subagent official-child");
    expect(waitCallsAfterBackground).toBe(0);
    expect(foreground?.isError).not.toBe(true);
    expect(foreground).toMatchObject({ content: [{ type: "text", text: "official result" }] });
    expect(spawn).toHaveBeenCalledWith(expect.objectContaining({ parentSessionId: "official-parent", prompt: "inspect alignment", label: "research" }));
    expect(wait).toHaveBeenCalled();
    await kernel.stop();
  });

  it("routes the official subagent_fork tool through completed-context inheritance", async () => {
    const tools = new RecordingTools();
    const child = { sessionId: "fork-child", parentSessionId: "fork-parent", label: "fork", status: "running", model: { provider: "seal", model: "chat" } } as any;
    const spawn = vi.fn(async (request: any) => { expect(request.inheritParentContext).toBe(true); return child; });
    const wait = vi.fn(async () => ({ completed: [{ ...child, status: "completed", result: "fork result" }], timedOut: false }));
    let result: ToolResult | undefined;
    const consumer: DshPluginModule = { name: "official-fork-consumer", inject: ["agents"], async apply(context) {
      const handle = await (context.get("agents") as any).create({ sessionId: "fork-parent", meta: { cwd: process.cwd() } });
      result = await tools.execute({ callId: toolCallId("official-fork"), sessionId: "fork-parent" as never, cwd: process.cwd(), name: "subagent_fork", input: { prompt: "continue inherited work", description: "fork" }, signal: new AbortController().signal });
      await handle.dispose();
    } };
    const subagents = { spawn, wait, list: vi.fn(async () => []), send: vi.fn(), abort: vi.fn(async () => true) };
    const kernel = new Kernel<SealHarnessEvents>({ initialServices: [[toolServiceToken, tools], [subagentServiceToken, subagents as any], [sessionStoreToken, new MemorySessionStore()]] });
    await kernel.start([plugin(dshCompatPlugin, { plugins: [{ plugin: consumer }] })]);
    expect(result?.isError).not.toBe(true);
    expect(result?.content).toEqual([{ type: "text", text: "fork result" }]);
    await kernel.stop();
  });

  it("runs the official Ralph loop through structured fresh Seal subagents", async () => {
    const tools = new RecordingTools();
    const report = { status: "complete", summary: "Alignment complete", evidence: ["tests passed"], nextSteps: [], blocker: "" };
    const child = { sessionId: "ralph-child", parentSessionId: "ralph-parent", label: "Ralph round 1", status: "running", model: { provider: "seal", model: "chat" } } as any;
    const spawn = vi.fn(async (request: any) => {
      expect(request.outputSchema).toMatchObject({ type: "object" });
      return child;
    });
    const wait = vi.fn(async () => ({ completed: [{ ...child, status: "completed", result: "reported", structuredResult: report }], timedOut: false }));
    let result: ToolResult | undefined;
    const consumer: DshPluginModule = { name: "official-ralph-consumer", inject: ["agents"], async apply(context) {
      const handle = await (context.get("agents") as any).create({ sessionId: "ralph-parent", meta: { cwd: process.cwd() } });
      result = await tools.execute({ callId: toolCallId("official-ralph"), sessionId: "ralph-parent" as never, cwd: process.cwd(), name: "ralph", input: { objective: "Finish alignment", maxRounds: 2 }, signal: new AbortController().signal });
      await handle.dispose();
    } };
    const subagents = { spawn, wait, list: vi.fn(async () => []), send: vi.fn(), abort: vi.fn(async () => true) };
    const kernel = new Kernel<SealHarnessEvents>({ initialServices: [[toolServiceToken, tools], [subagentServiceToken, subagents as any], [sessionStoreToken, new MemorySessionStore()]] });
    await kernel.start([plugin(dshCompatPlugin, { ralph: { maxRounds: 2 }, plugins: [{ plugin: consumer }] })]);
    expect(tools.definitionsByName.has("ralph")).toBe(true);
    expect(result?.isError).not.toBe(true);
    expect(result?.content.map((block) => block.type === "text" ? block.text : "").join("\n")).toContain("Alignment complete");
    expect(spawn).toHaveBeenCalledTimes(1);
    await kernel.stop();
  });

  it("runs official filesystem, search, and host shell tools over local DSH runtimes", async () => {
    const directory = await mkdtemp(join(tmpdir(), "seal-dsh-fs-tool-"));
    const tools = new RecordingTools();
    let result: ToolResult | undefined; let searchResult: ToolResult | undefined; let shellResult: ToolResult | undefined; let editorResult: ToolResult | undefined; let staleEditorResult: ToolResult | undefined;
    try {
      await writeFile(join(directory, "fixture.txt"), "alpha\nbeta\n", "utf8");
      const consumer: DshPluginModule = { name: "official-fs-tool-consumer", inject: ["agents"], async apply(context) {
        const handle = await (context.get("agents") as any).create({ sessionId: "fs-tool-session", meta: { cwd: directory } });
        result = await tools.execute({ callId: toolCallId("official-read"), sessionId: "fs-tool-session" as never, cwd: directory, name: "read", input: { file_path: "fixture.txt" }, signal: new AbortController().signal });
        searchResult = await tools.execute({ callId: toolCallId("official-glob"), sessionId: "fs-tool-session" as never, cwd: directory, name: "glob", input: { pattern: "*.txt" }, signal: new AbortController().signal });
        const shellName = process.platform === "win32" ? "pwsh" : "bash";
        const command = process.platform === "win32" ? "Write-Output aligned" : "printf aligned";
        shellResult = await tools.execute({ callId: toolCallId(`official-${shellName}`), sessionId: "fs-tool-session" as never, cwd: directory, name: shellName, input: { command, description: "Print the alignment marker" }, signal: new AbortController().signal });
        editorResult = await tools.execute({ callId: toolCallId("official-editor"), sessionId: "fs-tool-session" as never, cwd: directory, name: "str_replace_editor", input: { command: "str_replace", path: join(directory, "fixture.txt"), old_str: "beta", new_str: "aligned-editor" }, signal: new AbortController().signal });
        await writeFile(join(directory, "fixture.txt"), "alpha\naligned-editor\nexternal-change\n", "utf8");
        staleEditorResult = await tools.execute({ callId: toolCallId("stale-editor"), sessionId: "fs-tool-session" as never, cwd: directory, name: "str_replace_editor", input: { command: "str_replace", path: join(directory, "fixture.txt"), old_str: "aligned-editor", new_str: "must-not-write" }, signal: new AbortController().signal });
        await handle.dispose();
      } };
      const kernel = new Kernel<SealHarnessEvents>({ initialServices: [[toolServiceToken, tools], [sessionStoreToken, new MemorySessionStore()]] });
      await kernel.start([plugin(dshCompatPlugin, { localSandbox: false, fileSystem: { cwd: directory }, agentInstructions: false, plugins: [{ plugin: consumer }] })]);
      expect([...tools.definitionsByName.keys()]).toEqual(expect.arrayContaining(["read", "write", "edit", "str_replace_editor"]));
      expect(result?.isError).not.toBe(true);
      expect(result?.content.map((block) => block.type === "text" ? block.text : "").join("\n")).toContain("alpha");
      expect(searchResult?.content.map((block) => block.type === "text" ? block.text : "").join("\n")).toContain("fixture.txt");
      expect(shellResult?.isError).not.toBe(true);
      expect(shellResult?.content.map((block) => block.type === "text" ? block.text : "").join("\n")).toContain("aligned");
      expect(editorResult?.isError).not.toBe(true);
      expect(staleEditorResult?.isError).toBe(true);
      expect(await readFile(join(directory, "fixture.txt"), "utf8")).toBe("alpha\naligned-editor\nexternal-change\n");
      await kernel.stop();
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("mounts the official browse directory picker for Web hosts", async () => {
    const directory = await mkdtemp(join(tmpdir(), "seal-dsh-directory-picker-"));
    let observed: unknown;
    const consumer: DshPluginModule = {
      name: "directory-picker-consumer",
      inject: ["directoryPicker"],
      async apply(context) {
        const capability = (context.get("directoryPicker") as any).capability();
        const listing = await capability.list(directory);
        const created = await capability.createDirectory(directory, "created");
        observed = { kind: capability.kind, listing, created };
      },
    };
    const kernel = new Kernel<SealHarnessEvents>();
    try {
      await writeFile(join(directory, "file.txt"), "ignored", "utf8");
      await mkdir(join(directory, "child"));
      await kernel.start([plugin(dshCompatPlugin, {
        services: { webServer: {} },
        directoryPicker: { maxEntries: 10 },
        plugins: [{ plugin: consumer }],
      })]);
      expect(observed).toMatchObject({
        kind: "browse",
        listing: { path: directory, truncated: false, entries: [{ name: "child", path: join(directory, "child") }] },
        created: join(directory, "created"),
      });
    } finally {
      await kernel.stop();
      await rm(directory, { recursive: true, force: true });
    }

    const disabled = new Kernel<SealHarnessEvents>();
    await disabled.start([plugin(dshCompatPlugin, { services: { webServer: {} }, directoryPicker: false })]);
    expect(disabled.use(dshCompatServiceToken).context.get("directoryPicker")).toBeUndefined();
    await disabled.stop();

    let nativeCapabilities: unknown;
    const nativeConsumer: DshPluginModule = { name: "native-directory-picker-consumer", inject: ["directoryPicker"], apply(context) { const picker = context.get("directoryPicker") as any; nativeCapabilities = { first: picker.capability(), stable: picker.capability() === picker.capability() }; } };
    const native = new Kernel<SealHarnessEvents>();
    await native.start([plugin(dshCompatPlugin, { services: { webServer: { host: "127.0.0.1" } }, directoryPicker: { backend: "native" }, plugins: [{ plugin: nativeConsumer }] })]);
    expect(nativeCapabilities).toMatchObject({ first: { kind: "native", pick: expect.any(Function) }, stable: true });
    await native.stop();

    let automaticKind: unknown;
    const automaticConsumer: DshPluginModule = { name: "automatic-directory-picker-consumer", inject: ["directoryPicker"], apply(context) { automaticKind = (context.get("directoryPicker") as any).capability().kind; } };
    const automatic = new Kernel<SealHarnessEvents>();
    await automatic.start([plugin(dshCompatPlugin, { services: { webServer: { host: "127.0.0.1" } }, plugins: [{ plugin: automaticConsumer }] })]);
    expect(automaticKind).toBe(resolveDirectoryPickerBackend({
      bindHost: "127.0.0.1",
      platform: process.platform,
      env: process.env,
      linuxChooser: hasLinuxChooserBinary(process.env.PATH, canExecute),
    }));
    await automatic.stop();

    let exposedKind: unknown;
    const exposedConsumer: DshPluginModule = { name: "exposed-directory-picker-consumer", inject: ["directoryPicker"], apply(context) { exposedKind = (context.get("directoryPicker") as any).capability().kind; } };
    const exposed = new Kernel<SealHarnessEvents>();
    await exposed.start([plugin(dshCompatPlugin, { services: { webServer: { host: "0.0.0.0" } }, plugins: [{ plugin: exposedConsumer }] })]);
    expect(exposedKind).toBe("browse");
    await exposed.stop();
  });

  it("publishes the official immutable launch-environment provenance snapshot", async () => {
    const processKey = "SEAL_DSH_LAUNCH_PROCESS"; const fallbackKey = "SEAL_DSH_LAUNCH_FALLBACK";
    const previous = process.env[processKey]; process.env[processKey] = "process";
    let observed: unknown;
    const consumer: DshPluginModule = { name: "launch-environment-consumer", inject: ["launchEnvironment"], apply(context) {
      const environment = context.get("launchEnvironment") as any;
      observed = {
        process: environment.get(processKey),
        fallback: environment.get(fallbackKey),
        restricted: environment.getFrom(fallbackKey, ["user-env"]),
      };
    } };
    const kernel = new Kernel<SealHarnessEvents>();
    try {
      await kernel.start([plugin(dshCompatPlugin, { launchEnvironment: {
        project: { path: ".env.project", values: { [processKey]: "project", [fallbackKey]: "project" } },
        user: { path: ".env.user", values: { [fallbackKey]: "user" } },
      }, plugins: [{ plugin: consumer }] })]);
      expect(observed).toEqual({
        process: { value: "process", source: "process" },
        fallback: { value: "project", source: "project-env", path: resolve(".env.project") },
        restricted: { value: "user", source: "user-env", path: resolve(".env.user") },
      });
    } finally {
      await kernel.stop();
      if (previous === undefined) delete process.env[processKey]; else process.env[processKey] = previous;
    }

    const external = { get: () => ({ value: "external", source: "process" }), getFrom: () => undefined };
    const authoritative = new Kernel<SealHarnessEvents>();
    await authoritative.start([plugin(dshCompatPlugin, { services: { launchEnvironment: external } })]);
    expect(authoritative.use(dshCompatServiceToken).context.get("launchEnvironment")).toBe(external);
    await authoritative.stop();
  });

  it("fences filesystem mutations through the official per-call sandbox backend", async () => {
    const directory = await mkdtemp(join(tmpdir(), "seal-dsh-fs-sandbox-"));
    const tools = new RecordingTools(); let backend = ""; let denied: unknown;
    const consumer: DshPluginModule = { name: "fs-sandbox-consumer", inject: ["fs"], async apply(context) {
      const fs = context.get("fs") as any;
      backend = fs.constructor.name;
      const target = await fs.resolve("controlled.txt");
      denied = await fs.writeText(target, "denied").catch((error: unknown) => error);
      await fs.writeText(target, "allowed", undefined, undefined, { mode: "danger-full-access", workspaceRoot: directory });
    } };
    const kernel = new Kernel<SealHarnessEvents>({ initialServices: [[toolServiceToken, tools]] });
    try {
      await kernel.start([plugin(dshCompatPlugin, {
        fileSystem: { cwd: directory },
        sandboxPolicy: { mode: "read-only", workspaceRoot: directory },
        permissionPresets: { defaultPreset: "read-only", presets: { "read-only": { sandbox: "read-only", approval: "ask" } } },
        plugins: [{ plugin: consumer }],
      })]);
      expect(backend).toBe("SandboxedFileSystem");
      expect(denied).toMatchObject({ code: "FS_SANDBOX_DENIED" });
      expect(await readFile(join(directory, "controlled.txt"), "utf8")).toBe("allowed");
      expect(JSON.stringify(tools.definitionsByName.get("write")?.inputSchema)).toContain("sandbox_permissions");
    } finally {
      await kernel.stop();
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("mounts the official local jobs provider when Seal has no shared registry", async () => {
    const tools = new RecordingTools();
    const kernel = new Kernel<SealHarnessEvents>({ initialServices: [[toolServiceToken, tools]] });
    await kernel.start([plugin(dshCompatPlugin, { localJobs: { maxConcurrentJobsPerOwner: 2 } })]);
    expect(kernel.use(dshCompatServiceToken).context.get("jobs")?.constructor.name).toBe("LocalJobRegistry");
    expect([...tools.definitionsByName.keys()]).toEqual(expect.arrayContaining(["job_output", "job_list", "job_kill"]));
    await kernel.stop();

    const disabledTools = new RecordingTools();
    const disabled = new Kernel<SealHarnessEvents>({ initialServices: [[toolServiceToken, disabledTools]] });
    await disabled.start([plugin(dshCompatPlugin, { localJobs: false })]);
    expect(disabled.use(dshCompatServiceToken).context.get("jobs")).toBeUndefined();
    expect([...disabledTools.definitionsByName.keys()]).not.toEqual(expect.arrayContaining(["job_output", "job_list", "job_kill"]));
    await disabled.stop();
  });

  it("bridges official background host-shell jobs into the Seal JobService", async () => {
    const tools = new RecordingTools(); const jobs = new LocalJobService(); let jobId = ""; let output: ToolResult | undefined; let listed: ToolResult | undefined;
    const consumer: DshPluginModule = { name: "background-pwsh-consumer", inject: ["agents"], async apply(context) {
      const handle = await (context.get("agents") as any).create({ sessionId: "background-pwsh", meta: { cwd: process.cwd() } });
      const shellName = process.platform === "win32" ? "pwsh" : "bash";
      const command = process.platform === "win32" ? "Write-Output background-aligned" : "printf background-aligned";
      const result = await tools.execute({ callId: toolCallId(`background-${shellName}-call`), sessionId: "background-pwsh" as never, cwd: process.cwd(), name: shellName, input: { command, description: "Print background alignment marker", run_in_background: true }, signal: new AbortController().signal });
      jobId = String((result.details as any)?.value?.jobId ?? "");
      listed = await tools.execute({ callId: toolCallId("job-list"), sessionId: "background-pwsh" as never, cwd: process.cwd(), name: "job_list", input: {}, signal: new AbortController().signal });
      output = await tools.execute({ callId: toolCallId("job-output"), sessionId: "background-pwsh" as never, cwd: process.cwd(), name: "job_output", input: { job_id: jobId, wait: true, timeout_ms: 10_000 }, signal: new AbortController().signal });
      await handle.dispose();
    } };
    const kernel = new Kernel<SealHarnessEvents>({ initialServices: [[toolServiceToken, tools], [jobServiceToken, jobs], [sessionStoreToken, new MemorySessionStore()]] });
    await kernel.start([plugin(dshCompatPlugin, { plugins: [{ plugin: consumer }] })]);
    expect(jobId).toMatch(process.platform === "win32" ? /^pwsh-/ : /^bash-/);
    expect(listed?.content[0]).toMatchObject({ type: "text" });
    expect(output?.content.map((block) => block.type === "text" ? block.text : "").join("\n")).toContain("background-aligned");
    expect((await jobs.wait(jobId, 10_000, "background-pwsh" as never)).status).toBe("completed");
    await kernel.stop();
    await jobs.dispose();
  });

  it("uses the official event-sourced todo tool only when Seal has no native owner", async () => {
    const tools = new RecordingTools(); let events: any[] = [];
    const consumer: DshPluginModule = { name: "todo-fallback-consumer", inject: ["agents"], async apply(context) {
      const handle = await (context.get("agents") as any).create({ sessionId: "todo-fallback", meta: { cwd: process.cwd() } });
      const result = await tools.execute({ callId: toolCallId("todo-write"), sessionId: "todo-fallback" as never, cwd: process.cwd(), name: "todo_write", input: { todos: [{ content: "Align Todo", status: "in_progress" }, { content: "Verify Todo", status: "in_progress" }] }, signal: new AbortController().signal });
      expect(result.isError).not.toBe(true);
      events = handle.agent.session.snapshotEvents().filter((event: any) => event.type === "todo/write");
      await handle.dispose();
    } };
    const kernel = new Kernel<SealHarnessEvents>({ initialServices: [[toolServiceToken, tools], [sessionStoreToken, new MemorySessionStore()]] });
    await kernel.start([plugin(dshCompatPlugin, { plugins: [{ plugin: consumer }] })]);
    expect(events).toHaveLength(1);
    expect(events[0].data.todos).toEqual([{ content: "Align Todo", status: "in_progress" }, { content: "Verify Todo", status: "in_progress" }]);
    await kernel.stop();

    const serialTools = new RecordingTools(); let serialResult: ToolResult | undefined;
    const serialConsumer: DshPluginModule = { name: "serial-todo-consumer", inject: ["agents"], async apply(context) {
      const handle = await (context.get("agents") as any).create({ sessionId: "serial-todo", meta: { cwd: process.cwd() } });
      serialResult = await serialTools.execute({ callId: toolCallId("serial-todo-write"), sessionId: "serial-todo" as never, cwd: process.cwd(), name: "todo_write", input: { todos: [{ content: "One", status: "in_progress" }, { content: "Two", status: "in_progress" }] }, signal: new AbortController().signal });
      await handle.dispose();
    } };
    const serialKernel = new Kernel<SealHarnessEvents>({ initialServices: [[toolServiceToken, serialTools], [sessionStoreToken, new MemorySessionStore()]] });
    await serialKernel.start([plugin(dshCompatPlugin, { todoTool: { allowParallelInProgress: false }, plugins: [{ plugin: serialConsumer }] })]);
    expect(serialResult?.isError).toBe(true);
    await serialKernel.stop();

    const nativeTools = new RecordingTools();
    const native = { name: "todo_write", description: "native", inputSchema: { type: "object" }, classify: () => ({ kind: "tool" as const, toolName: "todo_write", risk: "read" as const, summary: "native" }), execute: async () => ({ content: [] }) };
    nativeTools.register(native);
    const nativeKernel = new Kernel<SealHarnessEvents>({ initialServices: [[toolServiceToken, nativeTools]] });
    await nativeKernel.start([plugin(dshCompatPlugin, {})]);
    expect(nativeTools.definitionsByName.get("todo_write")).toBe(native);
    await nativeKernel.stop();
  });

  it("uses official authority-checked goal tools only when Seal has no native owner", async () => {
    const tools = new RecordingTools(); let result: ToolResult | undefined;
    const consumer: DshPluginModule = { name: "goal-tools-fallback-consumer", inject: ["agents"], async apply(context) {
      const handle = await (context.get("agents") as any).create({ sessionId: "goal-tools-fallback", meta: { cwd: process.cwd() } });
      result = await tools.execute({ callId: toolCallId("get-goal"), sessionId: "goal-tools-fallback" as never, cwd: process.cwd(), name: "get_goal", input: {}, signal: new AbortController().signal });
      await handle.dispose();
    } };
    const kernel = new Kernel<SealHarnessEvents>({ initialServices: [[toolServiceToken, tools], [sessionStoreToken, new MemorySessionStore()]] });
    await kernel.start([plugin(dshCompatPlugin, { goalTools: { blockedAfterConsecutiveRounds: 4 }, plugins: [{ plugin: consumer }] })]);
    expect([...tools.definitionsByName.keys()]).toEqual(expect.arrayContaining(["get_goal", "create_goal", "update_goal"]));
    expect(result).toMatchObject({ isError: true, content: [{ type: "text", text: expect.stringContaining("active driver") }] });
    await kernel.stop();

    const nativeTools = new RecordingTools();
    const native = { name: "get_goal", description: "native", inputSchema: { type: "object" }, classify: () => ({ kind: "tool" as const, toolName: "get_goal", risk: "read" as const, summary: "native" }), execute: async () => ({ content: [] }) };
    nativeTools.register(native);
    const nativeKernel = new Kernel<SealHarnessEvents>({ initialServices: [[toolServiceToken, nativeTools]] });
    await nativeKernel.start([plugin(dshCompatPlugin, {})]);
    expect(nativeTools.definitionsByName.get("get_goal")).toBe(native);
    expect(nativeTools.definitionsByName.has("create_goal")).toBe(false);
    expect(nativeTools.definitionsByName.has("update_goal")).toBe(false);
    await nativeKernel.stop();
  });

  it("uses the official reviewed plan-mode fallback without replacing a native owner", async () => {
    const tools = new RecordingTools(); const ask = vi.fn(async () => ({ answers: [{ id: "plan-review", selected: ["Approve"] }] })); let result: ToolResult | undefined;
    const consumer: DshPluginModule = { name: "plan-fallback-consumer", inject: ["agents"], async apply(context) {
      const handle = await (context.get("agents") as any).create({ sessionId: "plan-fallback", meta: { cwd: process.cwd() } });
      handle.agent.session.append("plan/mode", { active: true });
      result = await tools.execute({ callId: toolCallId("exit-plan"), sessionId: "plan-fallback" as never, cwd: process.cwd(), name: "exit_plan_mode", input: { plan: "# Alignment plan\n\nVerify the official fallback." }, signal: new AbortController().signal });
      await handle.dispose();
    } };
    const kernel = new Kernel<SealHarnessEvents>({ initialServices: [[toolServiceToken, tools], [userQuestionServiceToken, { ask, registerAnswerer: vi.fn() } as any], [sessionStoreToken, new MemorySessionStore()]] });
    await kernel.start([plugin(dshCompatPlugin, { plugins: [{ plugin: consumer }] })]);
    expect(result?.isError).not.toBe(true);
    expect(ask).toHaveBeenCalledWith(expect.objectContaining({ sessionId: "plan-fallback", questions: [expect.objectContaining({ id: "plan-review" })] }));
    await kernel.stop();

    const nativeTools = new RecordingTools();
    const native = { name: "exit_plan_mode", description: "native", inputSchema: { type: "object" }, classify: () => ({ kind: "tool" as const, toolName: "exit_plan_mode", risk: "read" as const, summary: "native" }), execute: async () => ({ content: [] }) };
    nativeTools.register(native);
    const nativeKernel = new Kernel<SealHarnessEvents>({ initialServices: [[toolServiceToken, nativeTools]] });
    await nativeKernel.start([plugin(dshCompatPlugin, {})]);
    expect(nativeTools.definitionsByName.get("exit_plan_mode")).toBe(native);
    await nativeKernel.stop();
  });

  it("composes durable official Storage domains over the JSON backend", async () => {
    const directory = await mkdtemp(join(tmpdir(), "seal-dsh-storage-"));
    const spec = { name: "fixture", version: 1, global: { schema: z.object({ revision: z.number() }), initial: { revision: 0 } }, tables: { records: { valueSchema: z.object({ value: z.string() }) } } };
    try {
      let firstDomain: any;
      const writer: DshPluginModule = { name: "storage-writer", inject: ["storageDomain"], async apply(context) { firstDomain = await (context.get("storageDomain") as any).open(spec); await firstDomain.global.set({ revision: 1 }); await firstDomain.table("records").put("one", { value: "persisted" }); } };
      const first = new Kernel(); await first.start([plugin(dshCompatPlugin, { storage: { root: directory }, plugins: [{ plugin: writer }] })]);
      await vi.waitFor(() => expect(firstDomain?.table("records").get("one")).toEqual({ value: "persisted" }));
      await firstDomain.close(); await first.stop();

      let restored: unknown;
      const reader: DshPluginModule = { name: "storage-reader", inject: ["storageDomain"], async apply(context) { const domain = await (context.get("storageDomain") as any).open(spec); restored = { global: domain.global.get(), record: domain.table("records").get("one") }; await domain.close(); } };
      const second = new Kernel(); await second.start([plugin(dshCompatPlugin, { storage: { root: directory }, plugins: [{ plugin: reader }] })]);
      await vi.waitFor(() => expect(restored).toEqual({ global: { revision: 1 }, record: { value: "persisted" } }));
      await second.stop();
    } finally { await rm(directory, { recursive: true, force: true }); }
  });

  it("uses the DSH_HOME storages root for the default JSON backend", async () => {
    const kernel = new Kernel<SealHarnessEvents>();
    await kernel.start([plugin(dshCompatPlugin, {})]);
    const backend = kernel.use(dshCompatServiceToken).context.get(storageBackendServiceKey("json")) as any;
    expect(backend.root).toBe(join(suiteDshHome, "storages"));
    await kernel.stop();
  });

  it("composes durable official Storage domains over the SQLite backend", async () => {
    const directory = await mkdtemp(join(tmpdir(), "seal-dsh-storage-sqlite-"));
    const database = join(directory, "state.sqlite");
    const spec = { name: "sqlite_fixture", version: 1, global: { schema: z.object({ revision: z.number() }), initial: { revision: 0 } }, tables: { records: { valueSchema: z.object({ value: z.string() }) } } };
    try {
      let firstDomain: any;
      const writer: DshPluginModule = { name: "sqlite-storage-writer", inject: ["storageDomain"], async apply(context) { firstDomain = await (context.get("storageDomain") as any).open(spec); await firstDomain.global.set({ revision: 2 }); await firstDomain.table("records").put("one", { value: "persisted in sqlite" }); } };
      const first = new Kernel(); await first.start([plugin(dshCompatPlugin, { storage: { backend: "sqlite", path: database, journalMode: "delete" }, plugins: [{ plugin: writer }] })]);
      await vi.waitFor(() => expect(firstDomain?.table("records").get("one")).toEqual({ value: "persisted in sqlite" }));
      await firstDomain.close(); await first.stop();

      let restored: unknown;
      const reader: DshPluginModule = { name: "sqlite-storage-reader", inject: ["storageDomain"], async apply(context) { const domain = await (context.get("storageDomain") as any).open(spec); restored = { global: domain.global.get(), record: domain.table("records").get("one") }; await domain.close(); } };
      const second = new Kernel(); await second.start([plugin(dshCompatPlugin, { storage: { backend: "sqlite", path: database, journalMode: "delete" }, plugins: [{ plugin: reader }] })]);
      await vi.waitFor(() => expect(restored).toEqual({ global: { revision: 2 }, record: { value: "persisted in sqlite" } }));
      await second.stop();
    } finally { await rm(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 25 }); }
  });

  it("mounts official standing agent presets transactionally across create and resume", async () => {
    const directory = await mkdtemp(join(tmpdir(), "seal-dsh-agent-presets-"));
    const presetDirectory = join(directory, "fixture");
    const alternateDirectory = join(directory, "alternate");
    const modulePath = join(directory, "marker.mjs");
    await mkdir(presetDirectory, { recursive: true }); await mkdir(alternateDirectory, { recursive: true });
    await writeFile(modulePath, "export function apply() {}\n");
    await writeFile(join(presetDirectory, "agent.cordis.yml"), `- id: marker\n  name: ${JSON.stringify(pathToFileURL(modulePath).href)}\n`);
    await writeFile(join(alternateDirectory, "agent.cordis.yml"), `- id: marker\n  name: ${JSON.stringify(pathToFileURL(modulePath).href)}\n`);
    try {
      const sessions = new MemorySessionStore();
      let createdPreset: string | undefined; let selectedPreset: string | undefined; let childPreset: string | undefined; let resumedPreset: string | undefined; let createdHeader: unknown; let childHeader: unknown;
      const consumer: DshPluginModule = { name: "agent-preset-consumer", inject: ["agents", "agentPresets"], async apply(context) {
        const agents = context.get("agents") as any; const presets = context.get("agentPresets") as any;
        const created = await agents.create({ sessionId: "preset-session", meta: { cwd: process.cwd(), agentPreset: "fixture" }, setup: async (agentContext: CordisContext) => { await presets.mount(agentContext, "fixture"); createdPreset = presets.composedPreset(agentContext); } });
        createdHeader = created.agent.session.header;
        await presets.select(created.agent, "alternate"); selectedPreset = presets.composedPreset(created.agent.ctx);
        const child = await agents.create({ sessionId: "preset-child", meta: { cwd: process.cwd(), parentSession: "preset-session" }, setup: (agentContext: CordisContext) => { presets.composeFrom(agentContext, created.agent.ctx); childPreset = presets.composedPreset(agentContext); } });
        childHeader = child.agent.session.header; await child.dispose(); await created.dispose();
        const resumed = await agents.resume({ resumeSessionId: "preset-session", setup: async (agentContext: CordisContext) => { await presets.mount(agentContext, "alternate"); resumedPreset = presets.composedPreset(agentContext); } });
        await resumed.dispose();
        await expect(agents.create({ sessionId: "broken-preset-session", meta: { cwd: process.cwd(), agentPreset: "missing" } })).rejects.toThrow("missing");
      } };
      const kernel = new Kernel<SealHarnessEvents>({ initialServices: [[sessionStoreToken, sessions]] });
      await kernel.start([plugin(dshCompatPlugin, { agentPresets: { default: "fixture", roots: [{ path: directory, trust: "user" }], includeShippedRoot: false, includeUserRoot: false }, plugins: [{ plugin: consumer }] })]);
      expect(kernel.use(dshCompatServiceToken).context.get("pluginInventory")).toBeDefined();
      expect(createdPreset).toBe("fixture"); expect(selectedPreset).toBe("alternate"); expect(childPreset).toBe("alternate"); expect(resumedPreset).toBe("alternate");
      expect(createdHeader).toMatchObject({ agentPreset: "fixture" });
      expect(childHeader).toMatchObject({ parentSession: "preset-session", agentPreset: "alternate" });
      expect(await sessions.read("broken-preset-session" as never)).toBeUndefined();
      await kernel.stop();
    } finally { await rm(directory, { recursive: true, force: true }); }
  });

  it("registers the official preset roster as the Seal runtime authority and mounts it before context collection", async () => {
    const directory = await mkdtemp(join(tmpdir(), "seal-dsh-preset-authority-"));
    const presetDirectory = join(directory, "cordis"); const modulePath = join(directory, "marker.mjs");
    await mkdir(presetDirectory, { recursive: true });
    await writeFile(modulePath, "export function apply() {}\n");
    await writeFile(join(presetDirectory, "agent.cordis.yml"), `- id: marker\n  name: ${JSON.stringify(pathToFileURL(modulePath).href)}\n`);
    try {
      const sessions = new MemorySessionStore(); let authority: AgentPresetAuthority | undefined;
      const nativePresets: AgentPresetService = {
        defaultPreset: "standard", list: () => [], async validate() {}, async current() { return "standard"; }, async set(_id, preset) { return preset; }, async initialize(session) { return session; }, systemPrompt() { return undefined; },
        registerAuthority(value) { authority = value; return () => { if (authority === value) authority = undefined; }; },
      };
      const kernel = new Kernel<SealHarnessEvents>({ initialServices: [[sessionStoreToken, sessions], [agentPresetServiceToken, nativePresets]] });
      await kernel.start([plugin(dshCompatPlugin, { agentPresets: { default: "cordis", roots: [{ path: directory, trust: "user" }], includeShippedRoot: false, includeUserRoot: false } })]);
      expect(authority).toBeDefined();
      expect(await authority!.resolve("cordis")).toMatchObject({ id: "cordis", isDefault: true });
      expect(await authority!.resolve("missing")).toBeUndefined();
      const session = await sessions.create({ id: "authority-session" as never, cwd: process.cwd() });
      await authority!.prepare(session, "cordis");
      const runtime = kernel.use(dshCompatServiceToken); const agents = runtime.context.get("agents") as any; const presets = runtime.context.get("agentPresets") as any;
      expect(presets.composedPreset(agents.get("authority-session").ctx)).toBe("cordis");
      await kernel.stop();
      expect(authority).toBeUndefined();
    } finally { await rm(directory, { recursive: true, force: true }); }
  });

  it("composes the official isolated TypeScript Code Runtime", async () => {
    let result: unknown; let descriptor: unknown;
    const consumer: DshPluginModule = {
      name: "code-runtime-consumer",
      inject: ["codeRuntime"],
      async apply(context) {
        const runtime = context.get("codeRuntime") as { language: string; isolation: string; run(request: unknown): Promise<unknown> };
        descriptor = { language: runtime.language, isolation: runtime.isolation };
        result = await runtime.run({
          program: "console.log('worker'); return await tools.echo({ value: 2 })",
          bindings: [{ global: "tools", functions: { echo: async (args: unknown) => ({ doubled: (args as { value: number }).value * 2 }) } }],
        });
      },
    };
    const kernel = new Kernel<SealHarnessEvents>();
    await kernel.start([plugin(dshCompatPlugin, { plugins: [{ plugin: consumer }] })]);
    expect(descriptor).toEqual({ language: "typescript", isolation: "worker-thread" });
    await vi.waitFor(() => expect(result).toMatchObject({ value: { doubled: 4 }, logs: ["worker"] }));
    await kernel.stop();
  });

  it("runs hidden DSH tools through the PTC run_code transport", async () => {
    const tools = new RecordingTools(); const promptSources = new Map<string, ContextSource>(); const dispatches: import("@seal-harness/core").ToolDispatchEvent[] = [];
    const contexts: ContextService = { register(source) { promptSources.set(source.name, source); return () => { if (promptSources.get(source.name) === source) promptSources.delete(source.name); }; }, async prepare() { throw new Error("not used"); } };
    tools.register({ name: "native_tool", description: "Native", inputSchema: { type: "object" }, classify: () => ({ kind: "tool", toolName: "native_tool", risk: "read", summary: "native" }), execute: async () => ({ content: [] }) });
    const pluginModule: DshPluginModule = { name: "ptc-tool", inject: ["tools"], apply(context) { (context.get("tools") as any).register({ name: "double", description: "Double a number", parameters: { type: "object", properties: { value: { type: "number" } }, required: ["value"] }, output: { schema: { type: "number" }, render: (_args: unknown, value: unknown) => [{ type: "text", text: String(value) }] }, execute: async (args: unknown) => (args as { value: number }).value * 2 }); } };
    const kernel = new Kernel({ initialServices: [[toolServiceToken, tools], [contextServiceToken, contexts]] });
    await kernel.start([plugin(dshCompatPlugin, { toolPresentation: "ptc", plugins: [{ plugin: pluginModule }] })]);
    expect(tools.definitions(undefined).map((item) => item.name)).toEqual(["run_code"]);
    expect(tools.definitions(undefined, { includeHidden: true }).map((item) => item.name).sort()).toEqual(["ask_user_question", "create_goal", "double", "edit", "exit_plan_mode", "get_goal", "glob", "grep", "interrupt_agent", "job_kill", "job_list", "job_output", "list_agents", "lsp", "native_tool", process.platform === "win32" ? "pwsh" : "bash", "ralph", "read", "read_image", "run_code", "send_message", "session_event_read", "session_event_search", "session_event_trace", "session_search", "session_trace", "skill", "str_replace_editor", "subagent", "subagent_fork", "terminal_close", "terminal_list", "terminal_open", "terminal_read", "terminal_send", "terminal_signal", "todo_write", "update_goal", "web_fetch", "web_search", "workflow", "write"].sort());
    const guidance = await promptSources.get("dsh-ptc-sdk")?.contribute({ sessionId: "ptc-session" as never, cwd: process.cwd(), prompt: [], history: [], signal: new AbortController().signal }, []);
    expect(guidance?.systemPrompt).toContain("`run_code` is the only tool you can call directly");
    expect(guidance?.systemPrompt).toContain("double");
    expect(guidance?.systemPrompt).toContain("value: number");
    const result = await tools.execute({ callId: toolCallId("ptc"), sessionId: "ptc-session" as never, cwd: process.cwd(), name: "run_code", input: { code: "return await tools.double({ value: 21 })", description: "double" }, signal: new AbortController().signal, reportDispatch: async (event) => { dispatches.push(event); } });
    expect(result).toMatchObject({ content: [{ type: "text", text: "42" }], details: { value: 42, logs: [] } });
    expect(dispatches).toEqual([
      { type: "start", rootCallId: "ptc", parentCallId: "ptc", subCallId: "ptc:code:0", name: "double", arguments: { value: 21 } },
      { type: "settle", rootCallId: "ptc", parentCallId: "ptc", subCallId: "ptc:code:0", name: "double", arguments: { value: 21 }, result: { content: [{ type: "text", text: "42" }], details: { value: 42, dsh: { deferredContexts: [], concludesTurn: false } } } },
    ]);
    await kernel.stop();
  });

  it("inherits official tool presentation from each Agent Preset scope", async () => {
    const directory = await mkdtemp(join(tmpdir(), "seal-dsh-tool-presentation-"));
    const ptcDirectory = join(directory, "ptc"); const nativeDirectory = join(directory, "native");
    const configFile = join(directory, "deployment.cordis.yml");
    await mkdir(ptcDirectory, { recursive: true }); await mkdir(nativeDirectory, { recursive: true });
    await writeFile(configFile, "[]\n");
    const row = (mode: "ptc" | "native") => `- id: tool-presentation\n  name: "@deepseek-ai/dsh-agent-tool-presentation"\n  config:\n    mode: ${mode}\n`;
    await writeFile(join(ptcDirectory, "agent.cordis.yml"), row("ptc"));
    await writeFile(join(nativeDirectory, "agent.cordis.yml"), row("native"));
    const tools = new RecordingTools(); const promptSources = new Map<string, ContextSource>();
    const contexts: ContextService = { register(source) { promptSources.set(source.name, source); return () => { if (promptSources.get(source.name) === source) promptSources.delete(source.name); }; }, async prepare() { throw new Error("not used"); } };
    tools.register({ name: "native_tool", description: "Native", inputSchema: { type: "object" }, classify: () => ({ kind: "tool", toolName: "native_tool", risk: "read", summary: "native" }), execute: async () => ({ content: [] }) });
    let ptcNames: string[] = []; let nativeNames: string[] = []; let ptcPrompt: string | undefined; let nativePrompt: string | undefined;
    const consumer: DshPluginModule = { name: "scoped-presentation-consumer", inject: ["agents", "tools"], async apply(context) {
      (context.get("tools") as any).register({ name: "double", description: "Double", parameters: { type: "object" }, output: { render: (_args: unknown, value: unknown) => [{ type: "text", text: String(value) }] }, execute: async () => 2 });
      const agents = context.get("agents") as any;
      const ptc = await agents.create({ sessionId: "preset-ptc", meta: { cwd: process.cwd(), agentPreset: "ptc" } });
      const native = await agents.create({ sessionId: "preset-native", meta: { cwd: process.cwd(), agentPreset: "native" } });
      ptcNames = tools.definitions("preset-ptc" as never).map((definition) => definition.name);
      nativeNames = tools.definitions("preset-native" as never).map((definition) => definition.name);
      ptcPrompt = (await promptSources.get("dsh-ptc-sdk")?.contribute({ sessionId: "preset-ptc" as never, cwd: process.cwd(), prompt: [], history: [], signal: new AbortController().signal }, []))?.systemPrompt;
      nativePrompt = (await promptSources.get("dsh-ptc-sdk")?.contribute({ sessionId: "preset-native" as never, cwd: process.cwd(), prompt: [], history: [], signal: new AbortController().signal }, []))?.systemPrompt;
      await native.dispose(); await ptc.dispose();
    } };
    const kernel = new Kernel<SealHarnessEvents>({ initialServices: [[toolServiceToken, tools], [contextServiceToken, contexts], [sessionStoreToken, new MemorySessionStore()]] });
    try {
      await kernel.start([plugin(dshCompatPlugin, { configFile, agentPresets: { default: "native", roots: [{ path: directory, trust: "user" }], includeShippedRoot: false, includeUserRoot: false }, plugins: [{ plugin: consumer }] })]);
      expect(ptcNames).toEqual(["run_code"]);
      expect(nativeNames).toContain("native_tool"); expect(nativeNames).toContain("double"); expect(nativeNames).not.toContain("run_code");
      expect(ptcPrompt).toContain("`run_code` is the only tool you can call directly"); expect(ptcPrompt).toContain("double");
      expect(nativePrompt).toBeUndefined();
    } finally { await kernel.stop(); await rm(directory, { recursive: true, force: true }); }
  });

  it("assembles official DSH system prompt sections and runtime context into Seal context", async () => {
    let promptSource: ContextSource | undefined;
    const contexts: ContextService = { register(source) { promptSource = source; return () => { if (promptSource === source) promptSource = undefined; }; }, async prepare() { throw new Error("not used"); } };
    const contributor: DshPluginModule = {
      name: "system-prompt-contributor", inject: ["systemPrompt"],
      apply(context) {
        const prompt = context.get("systemPrompt") as any;
        prompt.variable("workspace_name", () => "Seal");
        prompt.section({ name: "test:persona", order: 10, text: "Work in {{workspace_name}}." });
        prompt.context({ name: "test:policy", order: 10, text: "Runtime policy is active." });
      },
    };
    const kernel = new Kernel({ initialServices: [[contextServiceToken, contexts]] });
    await kernel.start([plugin(dshCompatPlugin, { plugins: [{ plugin: contributor }] })]);
    const contribution = await promptSource!.contribute({ sessionId: "prompt-session" as never, cwd: process.cwd(), prompt: [], history: [], signal: new AbortController().signal }, []);
    expect(contribution?.systemPrompt).toContain("Work in Seal.");
    expect(contribution?.systemPrompt).not.toContain("powered by DeepSeek Harness");
    expect(contribution?.additions).toEqual([expect.objectContaining({ role: "user", content: [{ type: "text", text: "Runtime policy is active." }], source: { kind: "plugin", plugin: "dsh-system-prompt:test:policy" } })]);
    await kernel.stop();
  });

  it.each([false, true])("preserves deployment persona without foreign identity (legacy flag %s)", async (includeHarnessIdentity) => {
    let promptSource: ContextSource | undefined;
    const contexts: ContextService = { register(source) { promptSource = source; return () => { if (promptSource === source) promptSource = undefined; }; }, async prepare() { throw new Error("not used"); } };
    const kernel = new Kernel({ initialServices: [[contextServiceToken, contexts]] });
    await kernel.start([plugin(dshCompatPlugin, { systemPrompt: { includeHarnessIdentity, includeRuntimeContext: false, persona: "Configured deployment persona." } })]);
    const contribution = await promptSource!.contribute({ sessionId: "persona-session" as never, cwd: process.cwd(), prompt: [], history: [], signal: new AbortController().signal }, []);
    expect(contribution?.systemPrompt).toBe("Configured deployment persona.");
    expect(contribution?.additions).toBeUndefined();
    await kernel.stop();
  });

  it("publishes the official persistent terminal registry and supports disabling it", async () => {
    const enabled = new Kernel<SealHarnessEvents>();
    await enabled.start([plugin(dshCompatPlugin, { localSandbox: false })]);
    const terminals = enabled.use(dshCompatServiceToken).context.get("terminals") as any;
    expect(terminals).toBeDefined();
    expect(terminals.listBackends()).toEqual([]);
    await enabled.stop();

    const disabled = new Kernel<SealHarnessEvents>();
    await disabled.start([plugin(dshCompatPlugin, { terminal: false })]);
    expect(disabled.use(dshCompatServiceToken).context.get("terminals")).toBeUndefined();
    await disabled.stop();
  });

  it("bridges Seal LSP through the official DSH seam and supports disabling it", async () => {
    const requests: unknown[] = [];
    const sealLsp: LspService = {
      registerProvider() { throw new Error("not used"); },
      async query(request) {
        requests.push(request);
        return { kind: "hover", hover: { contents: "Seal hover" } };
      },
    };
    const enabled = new Kernel<SealHarnessEvents>({ initialServices: [[lspServiceToken, sealLsp]] });
    await enabled.start([plugin(dshCompatPlugin, {})]);
    const lsp = enabled.use(dshCompatServiceToken).context.get("lsp") as any;
    await expect(lsp.query({ operation: "hover", filePath: "a.ts", position: { line: 1, character: 2 }, workspaceRoot: process.cwd() })).resolves.toEqual({ kind: "hover", hover: { contents: "Seal hover" } });
    expect(requests).toHaveLength(1);
    await enabled.stop();

    const disabled = new Kernel<SealHarnessEvents>({ initialServices: [[lspServiceToken, sealLsp]] });
    await disabled.start([plugin(dshCompatPlugin, { lsp: false })]);
    expect(disabled.use(dshCompatServiceToken).context.get("lsp")).toBeUndefined();
    await disabled.stop();
  });

  it("mounts explicitly configured official stdio LSP providers without eager process launch", async () => {
    let provider: any; let unregistered = false; const resolved: unknown[] = []; const spawned: unknown[] = [];
    const lsp = {
      registerProvider(value: unknown) { provider = value; return () => { unregistered = true; }; },
      async query() { throw new Error("not used"); },
    };
    const subprocess = {
      async resolveExecutable(command: string, env: unknown) { resolved.push({ command, env }); return command; },
      spawn(spec: unknown) { spawned.push(spec); throw new Error("must remain lazy"); },
    };
    const kernel = new Kernel<SealHarnessEvents>();
    await kernel.start([plugin(dshCompatPlugin, {
      services: { lsp, fs: {}, subprocess },
      lsp: { tools: false, stdio: { servers: { typescript: { command: process.execPath, args: ["server.js"], env: { TEST_LSP: "1" }, extensionToLanguage: { ".ts": "typescript" } } } } },
      fileSystem: false, fileSystemObservationPolicy: false, fileSystemTools: false, strReplaceEditor: false, fileSearchTools: false,
      terminal: false, powerShell: false, bash: false,
    })]);
    expect(resolved).toEqual([{ command: process.execPath, env: { TEST_LSP: "1" } }]);
    expect(provider).toMatchObject({ id: "typescript" });
    expect(spawned).toEqual([]);
    await kernel.stop();
    expect(unregistered).toBe(true);
  });

  it("publishes the official Web registry and tools and supports disabling them", async () => {
    const tools = new RecordingTools();
    const enabled = new Kernel<SealHarnessEvents>({ initialServices: [[toolServiceToken, tools]] });
    await enabled.start([plugin(dshCompatPlugin, {})]);
    const web = enabled.use(dshCompatServiceToken).context.get("web") as any;
    expect(web).toBeDefined();
    expect(web.searchProviderId).toBe("deepseek-official");
    expect(web.fetchProviderId).toBe("http");
    expect([...web.searchProviders.keys()]).toContain("deepseek-official");
    expect([...web.fetchProviders.keys()]).toContain("http");
    expect(tools.definitionsByName.has("web_search")).toBe(true);
    expect(tools.definitionsByName.has("web_fetch")).toBe(true);
    expect(tools.definitionsByName.get("web_search")?.timeoutMs).toBe(60_000);
    await enabled.stop();

    const disabled = new Kernel<SealHarnessEvents>({ initialServices: [[toolServiceToken, new RecordingTools()]] });
    await disabled.start([plugin(dshCompatPlugin, { web: false })]);
    expect(disabled.use(dshCompatServiceToken).context.get("web")).toBeUndefined();
    await disabled.stop();
  });

  it("defaults to the official lazy local attachment store and supports explicit opt-out", async () => {
    const enabled = new Kernel<SealHarnessEvents>();
    await enabled.start([plugin(dshCompatPlugin, {})]);
    const attachments = enabled.use(dshCompatServiceToken).context.get("attachments") as any;
    expect(attachments?.constructor.name).toBe("LocalAttachmentStore");
    expect(attachments.root).toMatch(/[\\/]attachments[\\/]v1$/u);
    await enabled.stop();

    const disabled = new Kernel<SealHarnessEvents>();
    await disabled.start([plugin(dshCompatPlugin, { localAttachments: false })]);
    expect(disabled.use(dshCompatServiceToken).context.get("attachments")).toBeUndefined();
    await disabled.stop();
  });

  it("mounts the official default DeepSeek plus opt-in Exa and Perplexity Web search providers", async () => {
    const kernel = new Kernel<SealHarnessEvents>();
    await kernel.start([plugin(dshCompatPlugin, { web: { searchProvider: "deepseek-official", searchProviders: {
      deepseek: { apiKey: "test-deepseek-key" },
      exa: { apiKey: "test-exa-key" },
      perplexity: { apiKey: "test-perplexity-key" },
    } } })]);
    const web = kernel.use(dshCompatServiceToken).context.get("web") as any;
    expect([...web.searchProviders.keys()].sort()).toEqual(["deepseek-official", "exa", "perplexity"]);
    expect([...web.searchProviders.values()].every((provider: any) => provider.available())).toBe(true);
    await kernel.stop();
  });

  it("defaults official Session telemetry to non-uploading mode and validates upload configuration", async () => {
    const enabled = new Kernel<SealHarnessEvents>();
    await enabled.start([plugin(dshCompatPlugin, {})]);
    expect((enabled.use(dshCompatServiceToken).context.get("sessionTelemetry") as any).sharing).toBe("disabled");
    await enabled.stop();

    const disabled = new Kernel<SealHarnessEvents>();
    await disabled.start([plugin(dshCompatPlugin, { sessionTelemetry: false })]);
    expect(disabled.use(dshCompatServiceToken).context.get("sessionTelemetry")).toBeUndefined();
    await disabled.stop();

    const invalid = new Kernel<SealHarnessEvents>(); let failure: unknown;
    try { await invalid.start([plugin(dshCompatPlugin, { sessionTelemetry: { mode: "FULL", exporter: { url: "file:///not-otlp" } } })]); } catch (error) { failure = error; }
    expect(String((failure as Error & { cause?: unknown }).cause)).toMatch(/must be http\(s\)/i);
    await invalid.stop();
  });

  it("honors DSH telemetry environment overrides without weakening the local-only fallback", async () => {
    const previousDisabled = process.env.DSH_TELEMETRY_DISABLED;
    const previousMode = process.env.DSH_TELEMETRY_MODE;
    process.env.DSH_TELEMETRY_DISABLED = "1";
    const disabled = new Kernel<SealHarnessEvents>();
    const explicit = new Kernel<SealHarnessEvents>();
    try {
      await disabled.start([plugin(dshCompatPlugin, { sessionTelemetry: { mode: "FULL" } })]);
      expect(disabled.use(dshCompatServiceToken).context.get("sessionTelemetry")).toBeUndefined();
      await disabled.stop();

      delete process.env.DSH_TELEMETRY_DISABLED;
      process.env.DSH_TELEMETRY_MODE = "NOT_A_MODE";
      await explicit.start([plugin(dshCompatPlugin, { sessionTelemetry: { mode: "DISABLED" } })]);
      expect((explicit.use(dshCompatServiceToken).context.get("sessionTelemetry") as any).sharing).toBe("disabled");
      await explicit.stop();
    } finally {
      if (previousDisabled === undefined) delete process.env.DSH_TELEMETRY_DISABLED;
      else process.env.DSH_TELEMETRY_DISABLED = previousDisabled;
      if (previousMode === undefined) delete process.env.DSH_TELEMETRY_MODE;
      else process.env.DSH_TELEMETRY_MODE = previousMode;
    }
  });

  it("discovers bounded local @path candidates through the official File Reference service", async () => {
    const directory = await mkdtemp(join(tmpdir(), "seal-dsh-file-reference-")); let candidates: any[] = [];
    try {
      await writeFile(join(directory, "alpha-notes.txt"), "evidence", "utf8");
      await mkdir(join(directory, "alpha-folder"));
      const consumer: DshPluginModule = { name: "file-reference-consumer", inject: ["agents", "fileReferences"], async apply(context) {
        const handle = await (context.get("agents") as any).create({ sessionId: "file-reference-session", meta: { cwd: directory } });
        candidates = await (context.get("fileReferences") as any).list(handle.agent, "alpha", new AbortController().signal);
        await handle.dispose();
      } };
      const kernel = new Kernel<SealHarnessEvents>({ initialServices: [[sessionStoreToken, new MemorySessionStore()]] });
      await kernel.start([plugin(dshCompatPlugin, { fileReferences: { maxResults: 5 }, plugins: [{ plugin: consumer }] })]);
      expect(candidates.map((candidate) => candidate.path)).toEqual(expect.arrayContaining(["alpha-notes.txt", "alpha-folder"]));
      await kernel.stop();

      const disabled = new Kernel<SealHarnessEvents>();
      await disabled.start([plugin(dshCompatPlugin, { fileReferences: false })]);
      expect(disabled.use(dshCompatServiceToken).context.get("fileReferences")).toBeUndefined();
      await disabled.stop();
    } finally { await rm(directory, { recursive: true, force: true }); }
  });

  it("mounts official durable Schedule tools for root DSH Agents", async () => {
    const tools = new RecordingTools();
    const sessions = new MemorySessionStore();
    let names: string[] = [];
    const consumer: DshPluginModule = { name: "schedule-consumer", inject: ["agents"], async apply(context) {
      const handle = await (context.get("agents") as any).create({ sessionId: "schedule-root", meta: { cwd: process.cwd() } });
      await vi.waitFor(() => expect(tools.definitions("schedule-root" as never, { includeHidden: true }).map((item) => item.name)).toEqual(expect.arrayContaining(["schedule_create", "schedule_list", "schedule_delete"])));
      names = tools.definitions("schedule-root" as never, { includeHidden: true }).map((item) => item.name);
      await handle.dispose();
    } };
    const kernel = new Kernel<SealHarnessEvents>({ initialServices: [[toolServiceToken, tools], [sessionStoreToken, sessions]] });
    await kernel.start([plugin(dshCompatPlugin, { plugins: [{ plugin: consumer }] })]);
    expect(names).toEqual(expect.arrayContaining(["schedule_create", "schedule_list", "schedule_delete"]));
    await kernel.stop();
  });

  it("routes configured MCP endpoints through the official validated client plugin", async () => {
    const kernel = new Kernel<SealHarnessEvents>({ initialServices: [[toolServiceToken, new RecordingTools()]] });
    let failure: unknown;
    try { await kernel.start([plugin(dshCompatPlugin, { mcp: [{ transport: "stdio", serverName: "invalid namespace", command: process.execPath }] })]); } catch (error) { failure = error; }
    expect(failure).toBeInstanceOf(Error);
    expect(String((failure as Error & { cause?: unknown }).cause)).toMatch(/serverName|pattern|invalid/i);
    await kernel.stop();
  });

  it("bridges the official DSH LLM runtime to Seal model discovery and streaming", async () => {
    const requests: any[] = []; let result: any;
    const getImage = vi.fn(async () => ({ data: Uint8Array.of(1, 2, 3), mimeType: "image/png" }));
    const models: ModelService = {
      async list() { return [{ provider: "seal", model: "chat", displayName: "Seal Chat", description: "Multimodal chat", contextWindow: 32_000, maxOutputTokens: 4096, supportsReasoning: true, supportsImages: true }, { provider: "seal", model: "unknown-input", displayName: "Unknown Input", contextWindow: 8_000, maxOutputTokens: 1024 }]; },
      async get(ref) { return ref.provider === "seal" && ref.model === "chat" ? (await this.list())[0] : undefined; },
      async *stream(request) {
        requests.push(request);
        if (request.purpose === "usage-order") { yield { type: "text_delta", delta: "plain" }; yield { type: "usage", usage: { inputTokens: 2, outputTokens: 1 } }; yield { type: "done", stopReason: "stop" }; return; }
        if (request.purpose === "error-replay") { yield { type: "usage", usage: { inputTokens: 1, outputTokens: 0 } }; yield { type: "done", stopReason: "error", replayState: { response: { incomplete: true } } }; return; }
        yield { type: "reasoning_delta", delta: "think" }; yield { type: "text_delta", delta: "hello" }; yield { type: "tool_call", call: { type: "tool_call", id: toolCallId("call-1"), name: "echo", arguments: { value: 1 }, providerData: { dshArguments: " { \"value\": 1 } " } } }; yield { type: "usage", usage: { inputTokens: 10, outputTokens: 3, totalTokens: 17, costUsd: 0.25, routes: [{ provider: "deepseek", model: "deepseek-chat" }] } }; yield { type: "done", stopReason: "tool_call", replayState: { response: { responseId: "response-1", rawStopReason: "tool_calls" }, blocks: [{ thinkingSignature: "thinking-1" }, null, { thoughtSignature: "tool-1" }] } };
      },
    };
    const consumer: DshPluginModule = {
      name: "llm-consumer", inject: ["llm", "tokenMeter", "compaction"],
      async apply(context) {
        const seen: string[] = [];
        context.on("llm/stream" as any, (_options: any, next: any) => { seen.push("waterfall"); return next(); });
        const llm = context.get("llm") as any; const chunks: any[] = [];
        for await (const chunk of llm.stream({
          provider: "seal", model: "chat", reasoningEffort: "high", maxTokens: 1234, stop: ["END"], system: "system",
          messages: [
            { id: "u1", role: "user", content: [{ type: "text", text: "question" }, { type: "image", attachment: { attachmentId: "user-image", mediaType: "image/png", bytes: 3, width: 1, height: 1 } }], source: { kind: "user" } },
            { id: "a1", role: "assistant", content: [{ type: "image", attachment: { attachmentId: "assistant-image", mediaType: "image/png", bytes: 3, width: 1, height: 1 } }, { type: "tool-call", id: "prior-call", name: "read_file", arguments: " { \"path\": \"a.txt\" } " }], source: { kind: "model", provider: "seal", model: "chat", replayState: { response: { responseId: "prior-response" }, blocks: [null, { thoughtSignature: "prior-tool" }] } } },
            { id: "t1", role: "user", content: [{ type: "tool-result", toolCallId: "prior-call", content: [{ type: "text", text: "contents" }, { type: "image", attachment: { attachmentId: "tool-image", mediaType: "image/png", bytes: 3, width: 1, height: 1 } }] }], source: { kind: "tool", callId: "prior-call" } },
          ],
          tools: [{ name: "echo", description: "Echo", parameters: { type: "object" } }],
        })) chunks.push(chunk);
        const usageOrder: any[] = [];
        for await (const chunk of llm.stream({ provider: "seal", model: "chat", purpose: "usage-order", messages: [] })) usageOrder.push(chunk);
        const errorReplay: any[] = [];
        for await (const chunk of llm.stream({ provider: "seal", model: "chat", purpose: "error-replay", messages: [{ id: "bad-replay", role: "assistant", content: [{ type: "reasoning", text: "think" }, { type: "tool-call", id: "bad-call", name: "bad", arguments: "{}" }], source: { kind: "model", provider: "seal", model: "chat", replayState: { response: { responseId: "must-drop" }, blocks: [{ thinkingSignature: "wrong-length" }] } } }] })) errorReplay.push(chunk);
        result = { providers: llm.listProviders(), models: await llm.listModels("seal"), resolved: await llm.resolveModelInfo("seal", "chat"), chunks, usageOrder, errorReplay, seen, estimated: (context.get("tokenMeter") as any).estimateMessage({ role: "user", content: [{ type: "text", text: "count me" }] }), compaction: context.get("compaction")?.constructor.name };
      },
    };
    const kernel = new Kernel({ initialServices: [[modelServiceToken, models], [attachmentServiceToken, { get: getImage, put: vi.fn() } as any]] });
    await kernel.start([plugin(dshCompatPlugin, { plugins: [{ plugin: consumer }] })]);
    expect(result.providers).toEqual([{ id: "seal", name: "seal" }]);
    expect(result.models).toEqual([
      expect.objectContaining({ provider: "seal", id: "chat", name: "Seal Chat", description: "Multimodal chat", inputModalities: ["text", "image"] }),
      { provider: "seal", id: "unknown-input", name: "Unknown Input" },
    ]);
    expect(result.resolved).toMatchObject({ provider: "seal", id: "chat", description: "Multimodal chat", context: { contextWindow: 32_000 }, defaultMaxTokens: 4096, reasoning: { efforts: expect.arrayContaining([expect.objectContaining({ id: "high" })]) } });
    expect(result.seen).toEqual(["waterfall", "waterfall", "waterfall"]);
    expect(result.estimated).toBeGreaterThan(0);
    expect(result.compaction).toBe("BasicCompactionEngine");
    expect(result.chunks).toEqual(expect.arrayContaining([{ type: "reasoning-delta", index: 0, text: "think" }, { type: "text-delta", index: 1, text: "hello" }, expect.objectContaining({ type: "tool-call-delta", name: "echo" }), { type: "usage", usage: { inputTokens: 10, outputTokens: 3, totalTokens: 17 } }, expect.objectContaining({ type: "finish", reason: { kind: "tool-calls" } })]));
    expect(result.chunks).toEqual(expect.arrayContaining([
      { type: "tool-call-delta", index: 2, id: "call-1", name: "echo", argumentsDelta: " { \"value\": 1 } " },
      { type: "block-end", index: 2, block: { type: "tool-call", id: "call-1", name: "echo", arguments: " { \"value\": 1 } " } },
    ]));
    expect(result.chunks.slice(0, 9)).toEqual([
      { type: "block-start", index: 0, blockType: "reasoning" },
      { type: "reasoning-delta", index: 0, text: "think" },
      { type: "block-end", index: 0, block: { type: "reasoning", text: "think" } },
      { type: "block-start", index: 1, blockType: "text" },
      { type: "text-delta", index: 1, text: "hello" },
      { type: "block-end", index: 1, block: { type: "text", text: "hello" } },
      { type: "block-start", index: 2, blockType: "tool-call" },
      { type: "tool-call-delta", index: 2, id: "call-1", name: "echo", argumentsDelta: " { \"value\": 1 } " },
      { type: "block-end", index: 2, block: { type: "tool-call", id: "call-1", name: "echo", arguments: " { \"value\": 1 } " } },
    ]);
    expect(result.chunks.at(-1)).toEqual({ type: "finish", reason: { kind: "tool-calls" }, replayState: { response: { responseId: "response-1", rawStopReason: "tool_calls" }, blocks: [{ thinkingSignature: "thinking-1" }, null, { thoughtSignature: "tool-1" }] } });
    expect(result.usageOrder).toEqual([
      { type: "block-start", index: 0, blockType: "text" },
      { type: "text-delta", index: 0, text: "plain" },
      { type: "block-end", index: 0, block: { type: "text", text: "plain" } },
      { type: "usage", usage: { inputTokens: 2, outputTokens: 1, totalTokens: 3 } },
      { type: "finish", reason: { kind: "stop" } },
    ]);
    expect(result.errorReplay.at(-1)).toEqual({ type: "finish", reason: { kind: "error", failure: { message: "model request failed", code: "MODEL_ERROR" } } });
    expect(requests[2]?.messages).toEqual([{ role: "assistant", content: [{ type: "reasoning", text: "think" }, { type: "tool_call", id: "bad-call", name: "bad", arguments: {}, providerData: { dshArguments: "{}" } }] }]);
    expect(requests[0]).toMatchObject({
      model: { provider: "seal", model: "chat" }, systemPrompt: "system", reasoning: "high", maxOutputTokens: 1234, stop: ["END"],
      messages: [
        { id: "u1", role: "user", content: [{ type: "text", text: "question" }, { type: "image", data: "AQID", mimeType: "image/png" }], source: { kind: "user" } },
        { role: "assistant", content: [{ type: "image", data: "AQID", mimeType: "image/png" }, { type: "tool_call", id: "prior-call", name: "read_file", arguments: { path: "a.txt" }, providerData: { thoughtSignature: "prior-tool", dshArguments: " { \"path\": \"a.txt\" } " } }], providerData: { responseId: "prior-response" } },
        { role: "tool", callId: "prior-call", name: "read_file", content: [{ type: "text", text: "contents" }, { type: "image", data: "AQID", mimeType: "image/png" }], isError: false },
      ],
      tools: [{ name: "echo", description: "Echo", inputSchema: { type: "object" } }],
    });
    expect(getImage).toHaveBeenCalledTimes(3);
    await kernel.stop();
  });

  it("mounts the official DeepSeek V4 LLM adapter and default model route", async () => {
    let result: any;
    const consumer: DshPluginModule = { name: "deepseek-llm-consumer", inject: ["llm", "agentDefaultModel"], async apply(context) {
      const llm = context.get("llm") as any;
      const chunks: any[] = [];
      for await (const chunk of llm.stream({ provider: "deepseek-official", model: "deepseek-v4-flash", messages: [{ id: "u", role: "user", content: [{ type: "text", text: "hello" }], source: { kind: "user" } }], tools: [] })) chunks.push(chunk);
      result = { providers: llm.listProviders(), models: await llm.listModels("deepseek-official"), selected: (context.get("agentDefaultModel") as any).currentSelection(), chunks };
    } };
    const kernel = new Kernel<SealHarnessEvents>();
    await kernel.start([plugin(dshCompatPlugin, { deepseekLlm: { apiKeyEnv: "TEST_DEEPSEEK_API_KEY" }, plugins: [{ plugin: consumer }] })]);
    expect(result.providers).toContainEqual({ id: "deepseek-official", name: "DeepSeek" });
    expect(result.models).toEqual(expect.arrayContaining([
      expect.objectContaining({ provider: "deepseek-official", id: "deepseek-v4-flash", inputModalities: ["text"] }),
      expect.objectContaining({ provider: "deepseek-official", id: "deepseek-v4-pro", inputModalities: ["text"] }),
      expect.objectContaining({ provider: "deepseek-official", id: "deepseek-v4-flash-vision-exp", inputModalities: ["text", "image"] }),
    ]));
    expect(result.selected).toEqual({ provider: "deepseek-official", model: "deepseek-v4-flash" });
    expect(result.chunks).toEqual([{ type: "finish", reason: { kind: "error", failure: expect.objectContaining({ code: "MISSING_CREDENTIAL", message: expect.stringContaining("TEST_DEEPSEEK_API_KEY") }) } }]);
    await kernel.stop();
  });

  it("defaults standalone hosts to the official DeepSeek route and dormant pi-ai adapter", async () => {
    const kernel = new Kernel<SealHarnessEvents>();
    await kernel.start([plugin(dshCompatPlugin, {})]);
    const context = kernel.use(dshCompatServiceToken).context;
    const llm = context.get("llm") as any;
    expect(llm.listProviders()).toContainEqual({ id: "deepseek-official", name: "DeepSeek" });
    expect(await llm.listModels("deepseek-official")).toEqual(expect.arrayContaining([
      expect.objectContaining({ provider: "deepseek-official", id: "deepseek-v4-flash" }),
      expect.objectContaining({ provider: "deepseek-official", id: "deepseek-v4-pro" }),
    ]));
    expect((context.get("agentDefaultModel") as any).currentSelection()).toEqual({ provider: "deepseek-official", model: "deepseek-v4-flash" });
    await kernel.stop();

    const disabled = new Kernel<SealHarnessEvents>();
    await disabled.start([plugin(dshCompatPlugin, { deepseekLlm: false, piAiLlm: false })]);
    expect(disabled.use(dshCompatServiceToken).context.get("llm")).toBeUndefined();
    await disabled.stop();
  });

  it("mounts the official pi-ai adapter for declared provider routes", async () => {
    let providers: any; let models: any;
    const consumer: DshPluginModule = { name: "pi-ai-llm-consumer", inject: ["llm"], async apply(context) {
      const llm = context.get("llm") as any;
      providers = llm.listProviders();
      models = await llm.listModels("acme-gateway");
    } };
    const kernel = new Kernel<SealHarnessEvents>();
    await kernel.start([plugin(dshCompatPlugin, {
      piAiLlm: { providers: { "acme-gateway": {
        displayName: "Acme Gateway",
        apiKeyEnv: "ACME_GATEWAY_API_KEY",
        api: "openai-completions",
        baseURL: "https://gateway.acme.example/v1",
        models: [{ id: "acme-large", name: "Acme Large", contextWindow: 65_536, maxTokens: 4_096 }],
      } } },
      plugins: [{ plugin: consumer }],
    })]);
    expect(providers).toContainEqual({ id: "acme-gateway", name: "Acme Gateway" });
    expect(models).toEqual([{ provider: "acme-gateway", id: "acme-large", name: "Acme Large", inputModalities: ["text"] }]);
    await kernel.stop();
  });

  it("composes official DeepSeek request extensions with frozen fields and idempotent acceptance", async () => {
    let result: any; let accepted = 0;
    const consumer: DshPluginModule = { name: "deepseek-extension-consumer", inject: ["deepseekLlmApiExtensions"], async apply(context) {
      const registry = context.get("deepseekLlmApiExtensions") as any;
      registry.register("cache_control", { prepare: async (request: any) => ({ value: { session: request.sessionId, mode: "ephemeral" }, accept: () => { accepted++; } }) });
      const prepared = await registry.prepare({ sessionId: "extension-session", signal: new AbortController().signal });
      await prepared.accept(); await prepared.accept();
      result = { fields: prepared.fields, frozen: Object.isFrozen(prepared.fields) && Object.isFrozen(prepared.fields.cache_control) };
    } };
    const kernel = new Kernel<SealHarnessEvents>();
    await kernel.start([plugin(dshCompatPlugin, { plugins: [{ plugin: consumer }] })]);
    expect(result.fields).toEqual({ cache_control: { session: "extension-session", mode: "ephemeral" } });
    expect(result.frozen).toBe(true);
    expect(accepted).toBe(1);
    await kernel.stop();

    const disabled = new Kernel<SealHarnessEvents>();
    await disabled.start([plugin(dshCompatPlugin, { deepseekLlmApiExtensions: false })]);
    expect(disabled.use(dshCompatServiceToken).context.get("deepseekLlmApiExtensions")).toBeUndefined();
    await disabled.stop();
  });

  it("uploads canonical Session logs to DeepSeek incrementally after accepted watermarks", async () => {
    let first: any; let second: any; let acceptanceCount = 0;
    const consumer: DshPluginModule = { name: "deepseek-session-log-consumer", inject: ["agents", "deepseekLlmApiExtensions"], async apply(context) {
      const handle = await (context.get("agents") as any).create({ sessionId: "deepseek-log-session", meta: { cwd: process.cwd() } });
      const session = handle.agent.session;
      session.append("user/message", { role: "user", content: [{ type: "text", text: "first" }], source: { kind: "user" } }, { surfaceOp: "append" });
      const registry = context.get("deepseekLlmApiExtensions") as any;
      const prepared = await registry.prepare({ sessionId: "deepseek-log-session", signal: new AbortController().signal });
      first = prepared.fields.dsh_session_log;
      await prepared.accept();
      await prepared.accept();
      acceptanceCount = session.snapshotEvents().filter((event: any) => event.type === "session-log-deepseek/delivery-accepted").length;
      session.append("user/message", { role: "user", content: [{ type: "text", text: "second" }], source: { kind: "user" } }, { surfaceOp: "append" });
      second = (await registry.prepare({ sessionId: "deepseek-log-session", signal: new AbortController().signal })).fields.dsh_session_log;
      await handle.dispose();
    } };
    const kernel = new Kernel<SealHarnessEvents>({ initialServices: [[sessionStoreToken, new MemorySessionStore()]] });
    await kernel.start([plugin(dshCompatPlugin, { deepseekSessionLog: { enabled: true }, sessionTitle: false, plugins: [{ plugin: consumer }] })]);
    expect(first).toMatchObject({ version: 1, afterSeq: -1, session: { id: "deepseek-log-session", cwd: process.cwd() } });
    expect(first.events.at(-1)).toMatchObject({ type: "user/message", data: { content: [{ type: "text", text: "first" }] }, surfaceOp: "append" });
    expect(acceptanceCount).toBe(1);
    expect(second.afterSeq).toBe(first.throughSeq);
    expect(second.events.map((event: any) => event.type)).toEqual(["session-log-deepseek/delivery-accepted", "user/message"]);
    await kernel.stop();

    const defaultOff = new Kernel<SealHarnessEvents>({ initialServices: [[sessionStoreToken, new MemorySessionStore()]] });
    await defaultOff.start([plugin(dshCompatPlugin, {})]);
    const fields = await (defaultOff.use(dshCompatServiceToken).context.get("deepseekLlmApiExtensions") as any)
      .prepare({ sessionId: "absent", signal: new AbortController().signal });
    expect(fields.fields).toEqual({});
    await defaultOff.stop();
  });

  it("contributes Loader package provenance to official DeepSeek requests", async () => {
    const directory = await mkdtemp(join(tmpdir(), "seal-dsh-inventory-"));
    const configFile = join(directory, "cordis.yml");
    await writeFile(configFile, "[]\n");
    const kernel = new Kernel<SealHarnessEvents>();
    try {
      await kernel.start([plugin(dshCompatPlugin, { configFile })]);
      const registry = kernel.use(dshCompatServiceToken).context.get("deepseekLlmApiExtensions") as any;
      const prepared = await registry.prepare({ signal: new AbortController().signal });
      expect(prepared.fields.dsh_plugin_packages).toEqual({ version: 1, packages: [] });
    } finally {
      await kernel.stop();
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("mounts the official Typert registry and preserves a Host-owned gateway", async () => {
    const externalGateway = { registerRemoteEvents: vi.fn() };
    const kernel = new Kernel<SealHarnessEvents>();
    await kernel.start([plugin(dshCompatPlugin, { services: { typertGateway: externalGateway } })]);
    const context = kernel.use(dshCompatServiceToken).context;
    const typert = context.get("typert") as any;
    const dispose = typert.register({
      package: "fixture-typert",
      face: "host",
      schemas: [{ name: "Payload", schema: z.object({ value: z.string() }) }],
      model: { services: [], events: [], objects: [] },
      invocations: [],
    });
    expect(typert.listPackages()).toEqual([expect.objectContaining({ package: "fixture-typert", face: "host" })]);
    expect(context.get("typertGateway")).toBe(externalGateway);
    await dispose();
    expect(typert.listPackages()).toEqual([]);
    await kernel.stop();

    const standalone = new Kernel<SealHarnessEvents>();
    await standalone.start([plugin(dshCompatPlugin, {})]);
    expect(standalone.use(dshCompatServiceToken).context.get("typertGateway")?.constructor.name).toBe("TypertGatewayService");
    await standalone.stop();
  });

  it("loads existing Claude Code and Codex hook configurations through the official shell", async () => {
    const directory = await mkdtemp(join(tmpdir(), "seal-dsh-hooks-"));
    const claudeConfig = join(directory, "claude-hooks.json"); const codexConfig = join(directory, "codex-hooks.json");
    await writeFile(claudeConfig, JSON.stringify({ hooks: {} })); await writeFile(codexConfig, JSON.stringify({ hooks: {} }));
    const kernel = new Kernel<SealHarnessEvents>();
    try {
      await kernel.start([plugin(dshCompatPlugin, { hooks: { claudeCode: { configPath: claudeConfig, projectDir: directory }, codex: { configPath: codexConfig, model: "deepseek-v4-flash" } } })]);
      expect(kernel.use(dshCompatServiceToken).context.get("shell")).toBeDefined();
      expect(kernel.use(dshCompatServiceToken).context.get("sessionProjections")).toBeDefined();
    } finally { await kernel.stop(); await rm(directory, { recursive: true, force: true }); }

    const missingShell = new Kernel<SealHarnessEvents>(); let failure: unknown;
    try { await missingShell.start([plugin(dshCompatPlugin, { powerShell: false, hooks: { codex: { configPath: codexConfig } } })]); } catch (error) { failure = error; }
    expect(String((failure as Error & { cause?: unknown }).cause ?? failure)).toContain("hooks require the official shell");
    await missingShell.stop();
  });

  it("boots include and group entries through the official Cordis Loader", async () => {
    const directory = await mkdtemp(join(tmpdir(), "seal-dsh-loader-"));
    const observations: string[] = [];
    (globalThis as { __sealDshLoaderObservations?: string[] }).__sealDshLoaderObservations = observations;
    const moduleSource = (version: string) => `export function apply(ctx, config) { globalThis.__sealDshLoaderObservations.push("${version}:" + config.value); ctx.effect(() => () => { globalThis.__sealDshLoaderObservations.push("disposed:${version}:" + config.value); }); }\n`;
    await writeFile(join(directory, "observe.mjs"), moduleSource("v1"));
    await writeFile(join(directory, "cordis.yml"), [
      "- id: outer", "  name: cordis:group", "  group: true", "  config:",
      "    - id: active", "      name: ./observe.mjs", "      config:", "        value: nested",
      "    - id: disabled", "      name: ./observe.mjs", "      disabled: true", "      config:", "        value: disabled", "",
    ].join("\n"));
    const kernel = new Kernel();
    try {
      await kernel.start([plugin(dshCompatPlugin, { configFile: join(directory, "cordis.yml"), hmr: { roots: ["observe.mjs"], debounceMs: 10 } })]);
      expect(observations).toEqual(["v1:nested"]);
      await writeFile(join(directory, "observe.mjs"), moduleSource("v2"));
      await vi.waitFor(() => expect(observations).toContain("v2:nested"), { timeout: 5_000 });
      expect(observations).toEqual(["v1:nested", "disposed:v1:nested", "v2:nested"]);
      await kernel.stop();
      expect(observations).toEqual(["v1:nested", "disposed:v1:nested", "v2:nested", "disposed:v2:nested"]);
    } finally {
      await kernel.stop().catch(() => {});
      delete (globalThis as { __sealDshLoaderObservations?: string[] }).__sealDshLoaderObservations;
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("runs module-style Cordis plugins with inject and disposes their effects", async () => {
    const loaded: string[] = [];
    const disposed = vi.fn();
    const consumer: DshPluginModule = {
      name: "dsh-consumer",
      inject: ["greeting"],
      apply(context, config) {
        const greeting = context.get("greeting") as { value: string };
        loaded.push(`${greeting.value}:${String((config as { suffix: string }).suffix)}`);
        context.effect(() => disposed);
      },
    };
    const kernel = new Kernel();

    await kernel.start([
      plugin(dshCompatPlugin, {
        services: { greeting: { value: "hello" } },
        plugins: [{ plugin: consumer, config: { suffix: "cordis" } }],
      }),
    ]);

    expect(loaded).toEqual(["hello:cordis"]);
    expect(kernel.use(dshCompatServiceToken).context).toBeInstanceOf(CordisContext);
    await kernel.stop();
    expect(disposed).toHaveBeenCalledOnce();
  });

  it("bridges DSH tools into the Seal Harness policy-routed tool registry", async () => {
    const tools = new RecordingTools();
    const dshToolPlugin: DshPluginModule = {
      name: "dsh-tool-plugin",
      inject: ["tools"],
      apply(context) {
        const service = context.get("tools") as { register(definition: unknown): () => void };
        service.register({
          name: "dsh_echo",
          description: "Echo through the DSH compatibility bridge",
          parameters: {
            type: "object",
            properties: { value: { type: "string" } },
            required: ["value"],
            additionalProperties: false,
          },
          output: {
            schema: { type: "string" },
            render(_argumentsValue: unknown, value: unknown) {
              return [{ type: "text", text: `rendered:${String(value)}` }];
            },
          },
          async execute(argumentsValue: unknown, execution: { signal: AbortSignal; deferContext(message: unknown): void; concludeTurn(): void }) {
            execution.signal.throwIfAborted();
            execution.deferContext({ role: "user", content: [{ type: "text", text: "deferred:ok" }] });
            execution.concludeTurn();
            return (argumentsValue as { value: string }).value;
          },
        });
      },
    };
    const kernel = new Kernel({ initialServices: [[toolServiceToken, tools]] });

    await kernel.start([
      plugin(dshCompatPlugin, {
        plugins: [{ plugin: dshToolPlugin }],
        defaultToolRisk: "external",
        toolRisks: { dsh_echo: "read" },
      }),
    ]);

    const bridged = tools.definitionsByName.get("dsh_echo");
    expect(bridged?.classify({ value: "ok" } as JsonObject, {
      callId: toolCallId("classify"),
      sessionId: "session" as never,
      cwd: process.cwd(),
      signal: new AbortController().signal,
    })).toMatchObject({ risk: "read", toolName: "dsh_echo" });
    const result = await bridged?.execute({ value: "ok" } as JsonObject, {
      callId: toolCallId("call"),
      sessionId: "session" as never,
      cwd: process.cwd(),
      signal: new AbortController().signal,
      reportProgress: () => {},
    });
    expect(result).toMatchObject({
      content: [{ type: "text", text: "rendered:ok" }],
      additionalContexts: [{ role: "user", content: [{ type: "text", text: "deferred:ok" }] }],
      concludesTurn: true,
      details: { value: "ok", dsh: { concludesTurn: true } },
    });

    await kernel.stop();
    expect(tools.definitionsByName.size).toBe(0);
  });

  it("projects schemas and infers ToolRuntime ownership from agent.ctx", async () => {
    const tools = new RecordingTools(); let observations: unknown;
    const scopedPlugin: DshPluginModule = {
      name: "scoped-tools",
      inject: ["tools", "agents"],
      apply(context) {
        const registry = context.get("agents") as unknown as { adopt(id: string): { agent: { ctx: CordisContext }; dispose(): Promise<void> } };
        const adopted = registry.adopt("session-a"); context.effect(() => adopted.dispose);
        const scoped = adopted.agent.ctx.get("tools") as { register(value: unknown): () => void; get(name: string): unknown; schemas(): readonly { name: string }[] };
        const definition = { name: "scoped_echo", description: "Scoped", parameters: { type: "object" }, output: { schema: { type: "string" }, render: () => [] }, execute: async () => "ok" };
        scoped.register(definition);
        observations = { resolved: scoped.get("scoped_echo") === definition, schemas: scoped.schemas().map((item) => item.name) };
      },
    };
    const kernel = new Kernel({ initialServices: [[toolServiceToken, tools]] });
    await kernel.start([plugin(dshCompatPlugin, { deepseekLlm: false, piAiLlm: false, plugins: [{ plugin: scopedPlugin }] })]);
    expect(observations).toEqual({ resolved: true, schemas: ["str_replace_editor", "skill", "read", "write", "edit", "glob", "grep", process.platform === "win32" ? "pwsh" : "bash", "terminal_open", "terminal_send", "terminal_read", "terminal_signal", "terminal_close", "terminal_list", "read_image", "lsp", "web_search", "web_fetch", "job_output", "job_list", "job_kill", "session_search", "session_event_search", "session_trace", "session_event_trace", "session_event_read", "workflow", "ralph", "subagent", "send_message", "interrupt_agent", "list_agents", "subagent_fork", "get_goal", "create_goal", "update_goal", "ask_user_question", "todo_write", "exit_plan_mode", "schedule_create", "schedule_list", "schedule_delete", "scoped_echo"] });
    expect(tools.ownersByName.get("scoped_echo")).toBe("session-a");
    await kernel.stop();
    expect(tools.definitionsByName.has("scoped_echo")).toBe(false);
  });

  it("delegates create and resume through one lifecycle-scoped Agent factory", async () => {
    const calls: Array<{ kind: string; options: unknown; owner: CordisContext }> = []; let afterDispose: unknown;
    const consumer: DshPluginModule = {
      name: "agent-factory-consumer",
      inject: ["agents"],
      async apply(context) {
        const registry = context.get("agents") as any;
        const factory = {
          async createAgent(owner: CordisContext, options: unknown) { calls.push({ kind: "create", options, owner }); return registry.adopt("created"); },
          async resume(owner: CordisContext, options: unknown) { calls.push({ kind: "resume", options, owner }); return registry.adopt("resumed"); },
        };
        const remove = registry.setFactory(factory);
        await registry.create({ sessionId: "created" });
        await registry.resume({ resumeSessionId: "resumed" });
        remove();
        afterDispose = registry.create({ sessionId: "later" }).catch((error: Error) => error.message);
      },
    };
    const kernel = new Kernel();
    await kernel.start([plugin(dshCompatPlugin, { plugins: [{ plugin: consumer }] })]);
    expect(calls.map(({ kind, options }) => ({ kind, options }))).toEqual([
      { kind: "create", options: { sessionId: "created" } },
      { kind: "resume", options: { resumeSessionId: "resumed" } },
    ]);
    expect(calls.every((call) => call.owner instanceof CordisContext)).toBe(true);
    await expect(afterDispose).resolves.toBe("cannot create agent: Seal SessionStore is not available");
    await kernel.stop();
  });

  it("creates and resumes Agents through an unpublished setup/commit transaction", async () => {
    const sessions = new MemorySessionStore(); const observations: string[] = []; const lifecycle: string[] = []; const scopedLifecycle: string[] = []; let createdHandle: any; let resumedHandle: any; let registry: any;
    const consumer: DshPluginModule = {
      name: "transactional-agent-consumer", inject: ["agents"],
      async apply(context) {
        registry = context.get("agents");
        context.on("session/created" as any, (session: any) => { lifecycle.push(`session-created:${session.id}`); });
        context.on("agent/created", ({ agent }: any) => { lifecycle.push(`agent-created:${agent.id}`); });
        context.on("agent/disposed" as any, ({ agent }: any) => { lifecycle.push(`agent-disposed:${agent.id}`); });
        context.on("session/disposed" as any, (session: any) => { lifecycle.push(`session-disposed:${session.id}`); });
        createdHandle = await registry.create({
          sessionId: "transactional", meta: { cwd: process.cwd(), parentSession: "parent", isSeeded: true, origin: "subagent", delegationDepth: 2, agentPreset: "coding" }, inheritedEventCount: 2, agentOptions: { provider: "deepseek", model: "chat", reasoningEffort: "high" },
          seed: [
            { seq: 0, time: 1, type: "turn/start", data: { turn: 1 } },
            { seq: 1, time: 2, type: "user/message", data: { id: "seed-user", role: "user", content: [{ type: "text", text: "seed question" }, { type: "image", attachment: { attachmentId: "user-image", mediaType: "image/png", bytes: 12, width: 2, height: 3, name: "user.png" } }], source: { kind: "user" } } },
            { seq: 2, time: 3, type: "assistant/message", data: { turn: 1, step: 1, interrupted: true, usage: { inputTokens: 12, outputTokens: 3, cacheReadTokens: 4 }, message: { id: "seed-assistant", role: "assistant", content: [{ type: "text", text: "seed answer" }, { type: "image", attachment: { attachmentId: "assistant-image", mediaType: "image/webp", bytes: 24, width: 4, height: 5 } }, { type: "tool-call", id: "raw-call", name: "read_file", arguments: " { \"path\": \"a.txt\" } " }], source: { kind: "model", provider: "deepseek", model: "deepseek-chat", replayState: { response: "seed-response", blocks: [null, null, { thoughtSignature: "seed-tool" }] } } } } },
            { seq: 3, time: 4, type: "tool/call", data: { turn: 1, step: 1, callId: "seed-call", name: "read_file", arguments: "{}" } },
            { seq: 4, time: 5, type: "tool/result", data: { turn: 1, step: 1, error: { name: "ToolError", code: "ENOENT" }, meta: { path: "missing.txt" }, message: { id: "seed-tool", role: "user", content: [{ type: "tool-result", toolCallId: "seed-call", content: [{ type: "text", text: "tool output" }], isError: true }], source: { kind: "tool", callId: "seed-call" } } } },
            { seq: 5, time: 6, type: "agent/inbox.spliced", data: { target: "next-turn", start: 0, inserted: [{ id: "seed-pending", role: "user", content: [{ type: "text", text: "pending turn" }] }] } },
          ],
          setup: async (agentContext: any) => {
            observations.push(`setup-visible:${registry.get("transactional") !== undefined}`); observations.push(`setup-stored:${await sessions.read("transactional" as never) !== undefined}`);
            const session = agentContext.agent.session;
            observations.push(`setup-log:${session.seq}:${session.eventAt(0).type}:${session.snapshotEvents(1, 3).length}:${session.ownEvents().length}:${session.isOwnSeq(1)}:${session.isOwnSeq(2)}`);
            agentContext.on("session/event", (_session: any, event: any) => { observations.push(`session-event:${event.type}:${event.seq}`); });
            agentContext.on("session/created" as any, (created: any) => { scopedLifecycle.push(`session-created:${created.id}`); });
            agentContext.on("agent/created", ({ agent }: any) => { scopedLifecycle.push(`agent-created:${agent.id}`); });
            agentContext.on("agent/disposed" as any, ({ agent }: any) => { scopedLifecycle.push(`agent-disposed:${agent.id}`); });
            agentContext.on("session/disposed" as any, (disposed: any) => { scopedLifecycle.push(`session-disposed:${disposed.id}`); });
            session.append("plugin/custom", { value: 42 });
            return { commit() { observations.push("commit"); } };
          },
        });
        observations.push(`published:${registry.get("transactional") === createdHandle.agent}`);
        await createdHandle.dispose();
        observations.push(`disposed:${registry.get("transactional") === undefined}`);
        resumedHandle = await registry.resume({ resumeSessionId: "transactional", setup: () => { observations.push(`resume-visible:${registry.get("transactional") !== undefined}`); } });
        await expect(registry.create({ sessionId: "rollback", meta: { cwd: process.cwd() }, setup: () => { throw new Error("setup failed"); } })).rejects.toThrow("setup failed");
      },
    };
    const kernel = new Kernel<SealHarnessEvents>({ initialServices: [[sessionStoreToken, sessions]] });
    await kernel.start([plugin(dshCompatPlugin, { localSandbox: false, plugins: [{ plugin: consumer }] })]);
    expect(observations).toEqual(["setup-visible:false", "setup-stored:false", "setup-log:7:turn/start:2:5:false:true", "session-event:plugin/custom:7", "commit", "published:true", "disposed:true", "resume-visible:false"]);
    expect(lifecycle).toEqual(["session-created:transactional", "agent-created:transactional", "agent-disposed:transactional", "session-disposed:transactional", "session-created:transactional", "agent-created:transactional"]);
    expect(scopedLifecycle).toEqual(["session-created:transactional", "agent-created:transactional", "agent-disposed:transactional", "session-disposed:transactional"]);
    const persisted = await sessions.read("transactional" as never); expect(persisted).toBeDefined();
    expect(deriveSessionMessages(persisted!).map((message) => (message.content[0] as any).text)).toEqual(["seed question", "seed answer", "tool output"]);
    expect(persisted!.events.filter((entry) => entry.event.type === "message.appended").map((entry) => (entry.event as any).payload.turnId)).toEqual(["dsh-turn-1", "dsh-turn-1", "dsh-turn-1"]);
    expect(persisted!.events.find((entry) => entry.event.type === "message.appended" && entry.event.payload.message.role === "assistant")?.event).toMatchObject({ payload: { message: { providerData: { dsh: { interrupted: true, usage: { inputTokens: 12, outputTokens: 3, cacheReadTokens: 4 }, source: { provider: "deepseek", model: "deepseek-chat" } } } } } });
    expect(deriveSessionMessages(persisted!)[0]?.content[1]).toMatchObject({ type: "attachment", id: "user-image", mimeType: "image/png", name: "user.png", providerData: { dshAttachment: { attachment: { bytes: 12, width: 2, height: 3 } } } });
    expect(deriveSessionMessages(persisted!)[1]?.content[1]).toMatchObject({ type: "attachment", id: "assistant-image", mimeType: "image/webp", providerData: { dshAttachment: { attachment: { bytes: 24, width: 4, height: 5 } } } });
    expect(deriveSessionMessages(persisted!)[1]?.content[2]).toEqual({ type: "tool_call", id: "raw-call", name: "read_file", arguments: { path: "a.txt" }, providerData: { dshArguments: " { \"path\": \"a.txt\" } " } });
    expect(deriveSessionMessages(persisted!)[1]).toMatchObject({ replayState: { response: "seed-response", blocks: [null, null, { thoughtSignature: "seed-tool" }] } });
    expect(persisted!.events.find((entry) => entry.event.type === "message.appended" && entry.event.payload.message.role === "tool")?.event).toMatchObject({ payload: { message: { callId: "seed-call", name: "read_file", isError: true, providerData: { dsh: { error: { name: "ToolError", code: "ENOENT" }, meta: { path: "missing.txt" }, source: { kind: "tool", callId: "seed-call" } } } } } });
    expect(persisted!.events.some((entry) => entry.event.type === "dsh.imported" && entry.event.payload.type === "turn/start")).toBe(true);
    expect(persisted!.events.find((entry) => entry.event.type === "dsh.imported" && entry.event.payload.type === "turn/start")?.event).toMatchObject({ payload: { time: 1 } });
    expect(persisted!.events.some((entry) => entry.event.type === "dsh.imported" && entry.event.payload.type === "plugin/custom" && entry.event.payload.data.value === 42)).toBe(true);
    expect(persisted!.events.filter((entry) => entry.event.type === "dsh.imported" && entry.event.payload.type === "session/end-seed")).toHaveLength(2);
    expect(await sessions.read("rollback" as never)).toBeUndefined();
    expect(registry.get("transactional")).toBe(resumedHandle.agent);
    expect(resumedHandle.agent.session.header).toMatchObject({ version: 0, id: "transactional", cwd: process.cwd(), parentSession: "parent", isSeeded: true, origin: "subagent", delegationDepth: 2, agentPreset: "coding" });
    expect(resumedHandle.agent.session.inheritedEventCount).toBe(2);
    expect(resumedHandle.agent.session.seq).toBe(9);
    expect(resumedHandle.agent.inbox.nextTurn.map((message: any) => message.id)).toEqual(["seed-pending"]);
    expect(resumedHandle.agent.session.snapshotEvents().find((event: any) => event.type === "plugin/custom")).not.toHaveProperty("ignorable");
    const appended = resumedHandle.agent.session.append("user/message", { id: "session-appended", role: "user", content: [{ type: "text", text: "from session append" }], source: { kind: "plugin" } });
    expect(appended).toMatchObject({ seq: 9, type: "user/message" });
    const replaced = resumedHandle.agent.session.append("user/message", { id: "session-replacement", role: "user", content: [{ type: "text", text: "replacement" }], source: { kind: "plugin" } }, { surfaceOp: { op: "replace", start: 9, end: 9 }, sourceEventSeqs: [9] });
    expect(replaced).toMatchObject({ seq: 10, surfaceOp: { op: "replace", start: 9, end: 9 }, sourceEventSeqs: [9] });
    expect(resumedHandle.agent.session.surface).toMatchObject({ nodes: expect.arrayContaining([10]), replaceGeneration: 1 });
    expect(resumedHandle.agent.session.deriveMessages().at(-1)).toMatchObject({ id: "session-replacement" });
    await resumedHandle.agent.whenIdle();
    expect(deriveSessionMessages((await sessions.read("transactional" as never))!).at(-1)).toMatchObject({ role: "user", id: "session-replacement", content: [{ type: "text", text: "replacement" }] });
    await resumedHandle.dispose(); await kernel.stop();
  });

  it("projects Seal-owned persisted messages into native DSH session vocabulary", async () => {
    const sessions = new MemorySessionStore();
    const created = await sessions.create({ id: "seal-message-bridge" as never, cwd: process.cwd() });
    await sessions.append({ id: created.id, expectedVersion: created.version, events: [
      { type: "run.started", payload: { runId: "native-run" as never, model: { provider: "deepseek", model: "deepseek-chat" } } },
      { type: "message.appended", payload: { messageId: messageId("native-user"), message: { role: "user", content: [text("question")], source: { kind: "user" } } } },
      { type: "turn.started", payload: { runId: "native-run" as never, turnId: "native-turn" as never } },
      { type: "step.started", payload: { runId: "native-run" as never, turnId: "native-turn" as never, step: 0 } },
      { type: "request.context", payload: { provider: "deepseek", model: "deepseek-chat", contextWindow: 128000 } },
      { type: "assistant.chunk", payload: { runId: "native-run" as never, turnId: "native-turn" as never, step: 0, chunk: { type: "text-delta", index: 0, text: "partial" } } },
      { type: "message.appended", payload: { messageId: messageId("native-assistant"), runId: "native-run" as never, turnId: "native-turn" as never, message: { role: "assistant", content: [{ type: "tool_call", id: toolCallId("native-call"), name: "read_file", arguments: { path: "a.txt" }, providerData: { dshArguments: " { \"path\": \"a.txt\" } " } }], providerData: { dsh: { usage: { inputTokens: 3, outputTokens: 1 }, interrupted: true, source: { kind: "model", provider: "deepseek", model: "deepseek-chat" } } }, replayState: { response: "opaque", blocks: [{ thoughtSignature: "sig" }] } } } },
      { type: "tool.started", payload: { runId: "native-run" as never, turnId: "native-turn" as never, callId: toolCallId("native-call"), name: "read_file", input: { path: "a.txt" } } },
      { type: "message.appended", payload: { messageId: messageId("native-tool"), runId: "native-run" as never, turnId: "native-turn" as never, message: { role: "tool", callId: toolCallId("native-call"), name: "read_file", content: [text("missing")], isError: true, providerData: { dsh: { error: { name: "ToolError", code: "ENOENT" }, meta: { path: "a.txt" } } } } } },
      { type: "step.completed", payload: { runId: "native-run" as never, turnId: "native-turn" as never, step: 0 } },
      { type: "step.started", payload: { runId: "native-run" as never, turnId: "native-turn" as never, step: 1 } },
      { type: "message.appended", payload: { messageId: messageId("native-final"), runId: "native-run" as never, turnId: "native-turn" as never, message: { role: "assistant", content: [text("done")] } } },
      { type: "step.completed", payload: { runId: "native-run" as never, turnId: "native-turn" as never, step: 1 } },
      { type: "turn.completed", payload: { runId: "native-run" as never, turnId: "native-turn" as never, outcome: "completed", stopReason: "length" } },
    ] });
    let events: any[] = []; let extensionEvent: any;
    const consumer: DshPluginModule = { name: "seal-message-bridge-consumer", inject: ["agents"], async apply(context) {
      const handle = await (context.get("agents") as any).resume({ resumeSessionId: "seal-message-bridge" });
      const snapshot = handle.agent.session.snapshotEvents();
      extensionEvent = snapshot.find((event: any) => event.type === "run.started");
      events = snapshot.filter((event: any) => ["user/message", "turn/start", "step/start", "request/context", "assistant/chunk", "assistant/message", "tool/call", "tool/result", "step/end", "turn/end"].includes(event.type));
      await handle.dispose();
    } };
    const kernel = new Kernel<SealHarnessEvents>({ initialServices: [[sessionStoreToken, sessions]] });
    await kernel.start([plugin(dshCompatPlugin, { plugins: [{ plugin: consumer }] })]);
    expect(events).toMatchObject([
      { type: "user/message", data: { id: "native-user", role: "user", content: [{ type: "text", text: "question" }], source: { kind: "user" } } },
      { type: "turn/start", data: { turn: 1 } },
      { type: "step/start", data: { turn: 1, step: 0 } },
      { type: "request/context", data: { provider: "deepseek", model: "deepseek-chat", contextWindow: 128000 } },
      { type: "assistant/chunk", data: { turn: 1, step: 0, chunk: { type: "text-delta", index: 0, text: "partial" } } },
      { type: "assistant/message", data: { turn: 1, step: 0, usage: { inputTokens: 3, outputTokens: 1 }, interrupted: true, message: { id: "native-assistant", role: "assistant", content: [{ type: "tool-call", id: "native-call", name: "read_file", arguments: " { \"path\": \"a.txt\" } " }], source: { kind: "model", provider: "deepseek", model: "deepseek-chat", replayState: { response: "opaque", blocks: [{ thoughtSignature: "sig" }] } } } } },
      { type: "tool/call", data: { turn: 1, step: 0, callId: "native-call", name: "read_file", arguments: " { \"path\": \"a.txt\" } " } },
      { type: "tool/result", data: { turn: 1, step: 0, error: { name: "ToolError", code: "ENOENT" }, meta: { path: "a.txt" }, message: { id: "native-tool", role: "user", content: [{ type: "tool-result", toolCallId: "native-call", content: [{ type: "text", text: "missing" }], isError: true }], source: { kind: "tool", callId: "native-call" } } } },
      { type: "step/end", data: { turn: 1, step: 0 } },
      { type: "step/start", data: { turn: 1, step: 1 } },
      { type: "assistant/message", data: { turn: 1, step: 1, message: { id: "native-final", role: "assistant", content: [{ type: "text", text: "done" }] } } },
      { type: "step/end", data: { turn: 1, step: 1 } },
      { type: "turn/end", data: { turn: 1, reason: { kind: "max-tokens" } } },
    ]);
    expect(extensionEvent).toMatchObject({ type: "run.started", ignorable: true });
    await kernel.stop();
  });

  it("closes legacy Seal turns whose run failed before a turn completion was persisted", async () => {
    const sessions = new MemorySessionStore();
    const created = await sessions.create({ id: "legacy-failed-turn" as never, cwd: process.cwd() });
    await sessions.append({ id: created.id, expectedVersion: created.version, events: [
      { type: "turn.started", payload: { runId: "legacy-run" as never, turnId: "legacy-turn" as never } },
      { type: "run.completed", payload: { runId: "legacy-run" as never, outcome: "failed", error: "provider unavailable" } },
    ] });
    let ending: any;
    const consumer: DshPluginModule = { name: "legacy-failed-turn-consumer", inject: ["agents"], async apply(context) {
      const handle = await (context.get("agents") as any).resume({ resumeSessionId: "legacy-failed-turn" });
      ending = handle.agent.session.snapshotEvents().find((event: any) => event.type === "turn/end");
      await handle.dispose();
    } };
    const kernel = new Kernel<SealHarnessEvents>({ initialServices: [[sessionStoreToken, sessions]] });
    await kernel.start([plugin(dshCompatPlugin, { plugins: [{ plugin: consumer }] })]);
    expect(ending).toMatchObject({ type: "turn/end", data: { turn: 1, reason: { kind: "error", error: { message: "provider unavailable", code: "UNKNOWN" } } } });
    await kernel.stop();
  });

  it("validates DSH session creation metadata before publication", async () => {
    let registry: any; const sessions = new MemorySessionStore();
    const consumer: DshPluginModule = { name: "meta-validation", inject: ["agents"], apply(context) { registry = context.get("agents"); } };
    const kernel = new Kernel<SealHarnessEvents>({ initialServices: [[sessionStoreToken, sessions]] });
    await kernel.start([plugin(dshCompatPlugin, { plugins: [{ plugin: consumer }] })]);
    await expect(registry.create({ sessionId: "relative", meta: { cwd: "relative/path" } })).rejects.toThrow("absolute path");
    await expect(registry.create({ sessionId: "depth", meta: { cwd: process.cwd(), delegationDepth: -1 } })).rejects.toThrow("delegationDepth");
    await expect(registry.create({ sessionId: "inherited", meta: { cwd: process.cwd() }, inheritedEventCount: 0 })).rejects.toThrow("requires meta.isSeeded");
    expect(await sessions.read("relative" as never)).toBeUndefined();
    await kernel.stop();
  });

  it("provides the Host sessions service for standalone and Agent-owned sessions", async () => {
    const sealSessions = new MemorySessionStore(); let result: any;
    const consumer: DshPluginModule = {
      name: "sessions-service-consumer", inject: ["agents", "sessions", "sessionProjections", "sessionQuery"],
      async apply(context) {
        const sessions = context.get("sessions") as any; const agents = context.get("agents") as any;
        const projections = context.get("sessionProjections") as any;
        const query = context.get("sessionQuery") as any;
        projections.register({ key: "testValue", stateVersion: 0, stateSchema: z.number(), init: () => 0, apply: (state: number, event: any) => event.type === "plugin/state" ? event.data.value : state, wire: { viewSchema: z.number(), view: (state: number) => state } });
        const standalone = sessions.create("standalone", { meta: { cwd: process.cwd() } });
        standalone.append("user/message", { id: "standalone-user", role: "user", content: [{ type: "text", text: "hello" }], source: { kind: "user" } }, { surfaceOp: "append" });
        const handle = await agents.create({ sessionId: "agent-session", meta: { cwd: process.cwd() } });
        handle.agent.session.append("plugin/state", { value: 7 });
        const fork = sessions.fork(handle.agent.session, undefined, "agent-fork");
        handle.agent.session.append("turn/start", { turn: 1 });
        let openTurnCode: string | undefined;
        try { sessions.fork(handle.agent.session, undefined, "invalid-open-turn-fork"); } catch (error) { openTurnCode = (error as any).code; }
        result = {
          standalone: sessions.get("standalone") === standalone,
          agent: sessions.get("agent-session") === handle.agent.session,
          ids: sessions.list().map((session: any) => session.id),
          flushed: await sessions.flush(handle.agent.session),
          fork: { id: fork.id, parent: fork.header.parentSession, seeded: fork.header.isSeeded },
          openTurnCode,
          projection: projections.snapshot(handle.agent.session).values.testValue,
          liveQuery: (await query.readSession("agent-session")).events.map((event: any) => event.type),
        };
        await handle.dispose();
      },
    };
    const kernel = new Kernel<SealHarnessEvents>({ initialServices: [[sessionStoreToken, sealSessions]] });
    await kernel.start([plugin(dshCompatPlugin, { localSandbox: false, plugins: [{ plugin: consumer }] })]);
    expect(result).toEqual({ standalone: true, agent: true, ids: ["agent-session", "standalone", "agent-fork"], flushed: true, fork: { id: "agent-fork", parent: "agent-session", seeded: true }, openTurnCode: "OPEN_TURN", projection: 7, liveQuery: ["plugin/state", "turn/start"] });
    await kernel.stop();
  });

  it("exposes Seal SessionStore through current and legacy DSH persistence contracts", async () => {
    const sealSessions = new MemorySessionStore(); let result: any;
    Object.assign(sealSessions, {
      locate: (id: string) => ({ kind: "test", path: join(process.cwd(), `${id}.raw`) }),
      readRaw: async (id: import("@seal-harness/core").SessionId) => {
        const snapshot = await sealSessions.read(id);
        return snapshot === undefined ? undefined : { filename: `${id}.raw`, content: "verbatim\n", snapshot };
      },
    });
    const consumer: DshPluginModule = {
      name: "session-persistence-consumer", inject: ["sessionPersistence", "sessionQuery"],
      async apply(context) {
        const persistence = context.get("sessionPersistence") as any;
        const query = context.get("sessionQuery") as any;
        const header = { version: 0, id: "persisted", createdAt: 10, cwd: process.cwd(), isSeeded: false };
        const writer = await persistence.create(header, { inheritedEventCount: 0 });
        await writer.append([{ seq: 0, time: 11, type: "user/message", data: { id: "persisted-user", role: "user", content: [{ type: "text", text: "stored" }], source: { kind: "user" } }, surfaceOp: "append" }]);
        await writer.flush(); await writer.close();
        await persistence.append("persisted", [{ seq: 1, time: 12, type: "plugin/state", data: { value: 9 } }]);
        const writer2 = await persistence.open("persisted", "write");
        await Promise.all([writer2.append([{ seq: 2, time: 13, type: "plugin/first", data: {} }]), writer2.append([{ seq: 3, time: 14, type: "plugin/second", data: {} }])]);
        await writer2.close();
        const reader = await persistence.open("persisted", "read"); const read = await reader.read(); await reader.close();
        const inspection = await persistence.inspect("persisted"); const suffix = await persistence.readFrom("persisted", 1);
        const preparation = await persistence.prepare("persisted"); const preparedId = preparation.session.id; preparation[Symbol.dispose]();
        const observation = await query.observeSession("persisted"); const observed = { source: observation.source, cursor: observation.cursor }; observation[Symbol.dispose]();
        result = { read, inspection, suffix, preparedId, list: await persistence.list(), snapshots: await persistence.listSnapshots(), raw: persistence.supportsRawArtifacts,
          location: persistence.locate(header), rawArtifact: await persistence.readRaw("persisted"),
          query: { observed, log: await query.readSession("persisted"), events: await query.listEvents("persisted"), surface: await query.readSurface("persisted"), eventSearch: await query.searchEvents({ sessionId: "persisted", query: "stored", limit: 10 }), sessionSearch: await query.searchSessions({ query: "stored", limit: 10 }) } };
      },
    };
    const kernel = new Kernel<SealHarnessEvents>({ initialServices: [[sessionStoreToken, sealSessions]] });
    await kernel.start([plugin(dshCompatPlugin, { plugins: [{ plugin: consumer }] })]);
    expect(result.read.map((event: any) => event.type)).toEqual(["user/message", "plugin/state", "plugin/first", "plugin/second"]);
    expect(result.read.map((event: any) => event.seq)).toEqual([0, 1, 2, 3]);
    expect(result.inspection).toMatchObject({ meta: { id: "persisted", createdAt: 10, cwd: process.cwd(), isSeeded: false }, inheritedEventCount: 0 });
    expect(result.suffix.fromSeq).toBe(1);
    expect(result.suffix.events.map((event: any) => event.type)).toEqual(["plugin/state", "plugin/first", "plugin/second"]);
    expect(result.preparedId).toBe("persisted"); expect(result.list).toEqual([expect.objectContaining({ id: "persisted" })]);
    expect(result.snapshots).toEqual([{ header: expect.objectContaining({ id: "persisted" }), revision: expect.stringContaining("seal:persisted:") }]);
    expect(result.raw).toBe(true);
    expect(result.location).toEqual({ kind: "test", path: join(process.cwd(), "persisted.raw") });
    expect(result.rawArtifact).toMatchObject({ filename: "persisted.raw", content: "verbatim\n", meta: { id: "persisted" }, inheritedEventCount: 0 });
    expect(result.query.observed).toMatchObject({ source: "prepared", cursor: 3 });
    expect(result.query.log.events.map((event: any) => event.type)).toEqual(["user/message", "plugin/state", "plugin/first", "plugin/second"]);
    expect(result.query.events.map((event: any) => event.type)).toEqual(["user/message", "plugin/state", "plugin/first", "plugin/second"]);
    expect(result.query.surface.events.map((event: any) => event.type)).toEqual(["user/message"]);
    expect(result.query.eventSearch.items).toEqual([expect.objectContaining({ sessionId: "persisted", seq: 0, snippet: expect.stringContaining("stored") })]);
    expect(result.query.sessionSearch.items).toEqual([expect.objectContaining({ header: expect.objectContaining({ id: "persisted" }), bestMatch: expect.objectContaining({ seq: 0 }) })]);
    await kernel.stop();
  });

  it("executes the official session query tools against Seal session history", async () => {
    const sessions = new MemorySessionStore(); const tools = new RecordingTools(); let result: ToolResult | undefined;
    const source = await sessions.create({ id: "query-source" as never, cwd: process.cwd() });
    await sessions.append({ id: source.id, expectedVersion: source.version, events: [{ type: "message.appended", payload: { messageId: "query-message" as never, message: { role: "user", content: [{ type: "text", text: "official query needle" }], source: { kind: "user" } } } }] });
    await sessions.create({ id: "query-caller" as never, cwd: process.cwd() });
    const consumer: DshPluginModule = { name: "session-query-tool-consumer", inject: ["agents"], async apply(context) {
      const handle = await (context.get("agents") as any).resume({ resumeSessionId: "query-caller" });
      result = await tools.execute({ callId: toolCallId("session-query"), sessionId: "query-caller" as never, cwd: process.cwd(), name: "session_search", input: { query: "official query needle" }, signal: new AbortController().signal });
      await handle.dispose();
    } };
    const kernel = new Kernel<SealHarnessEvents>({ initialServices: [[toolServiceToken, tools], [sessionStoreToken, sessions]] });
    await kernel.start([plugin(dshCompatPlugin, { plugins: [{ plugin: consumer }] })]);
    expect(result).toMatchObject({ content: [{ type: "text", text: expect.stringContaining("query-source") }] });
    expect(result?.content[0]).toMatchObject({ type: "text", text: expect.stringContaining("official query needle") });
    await kernel.stop();
  });

  it("persists versioned feedback for finalized assistant messages", async () => {
    const root = await mkdtemp(join(tmpdir(), "seal-dsh-feedback-"));
    const sealSessions = new MemorySessionStore(); let result: any;
    const consumer: DshPluginModule = {
      name: "message-feedback-consumer", inject: ["sessionPersistence", "messageFeedback"],
      async apply(context) {
        const persistence = context.get("sessionPersistence") as any;
        const feedback = context.get("messageFeedback") as any;
        const writer = await persistence.create({ version: 0, id: "feedback-session", createdAt: 20, cwd: process.cwd(), isSeeded: false }, { inheritedEventCount: 0 });
        await writer.append([{ seq: 0, time: 21, type: "assistant/message", data: { turn: 1, step: 1, message: { id: "answer", role: "assistant", content: [{ type: "text", text: "done" }] } }, surfaceOp: "append" }]);
        await writer.close();
        const created = await feedback.put({ sessionId: "feedback-session", messageId: "answer", rating: "positive", note: "useful", ifVersion: null });
        if (!created.ok) throw new Error(`feedback creation failed: ${JSON.stringify(created.error)}`);
        const conflict = await feedback.put({ sessionId: "feedback-session", messageId: "answer", rating: "negative", ifVersion: null });
        const listed = await feedback.list({ sessionId: "feedback-session" });
        const removed = await feedback.delete({ sessionId: "feedback-session", messageId: "answer", ifVersion: created.value.version });
        result = { created, conflict, listed, removed, after: await feedback.list({ sessionId: "feedback-session" }) };
      },
    };
    const kernel = new Kernel<SealHarnessEvents>({ initialServices: [[sessionStoreToken, sealSessions]] });
    try {
      await kernel.start([plugin(dshCompatPlugin, { storage: { root }, messageFeedback: {}, plugins: [{ plugin: consumer }] })]);
      expect(result.created).toMatchObject({ ok: true, value: { messageId: "answer", rating: "positive", note: "useful" } });
      expect(result.conflict).toMatchObject({ ok: false, error: { code: "version-conflict", current: { messageId: "answer", rating: "positive" } } });
      expect(result.listed.value.items).toHaveLength(1);
      expect(result.removed).toEqual({ ok: true, value: { absent: true } });
      expect(result.after).toEqual({ ok: true, value: { items: [] } });
    } finally {
      await kernel.stop();
      await rm(root, { recursive: true, force: true });
    }
  });

  it("bridges the native Seal message-feedback service as the DSH Remote", async () => {
    const item = { messageId: "answer", rating: "up" as const, note: "native", version: "v1", createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:01.000Z" };
    const put = vi.fn(async (request: any) => {
      if (request.ifVersion === "stale") throw new MessageFeedbackError("conflict", "VERSION_CONFLICT", item);
      return item;
    });
    const native = { maxNoteBytes: 123, list: vi.fn(async () => [item]), put, delete: vi.fn(async () => true) };
    let result: any;
    const consumer: DshPluginModule = { name: "native-feedback-consumer", inject: ["messageFeedback"], async apply(context) {
      const feedback = context.get("messageFeedback") as any;
      result = {
        list: await feedback.list({ sessionId: "session" }),
        put: await feedback.put({ sessionId: "session", messageId: "answer", rating: "positive", ifVersion: null }),
        conflict: await feedback.put({ sessionId: "session", messageId: "answer", rating: "negative", ifVersion: "stale" }),
        deleted: await feedback.delete({ sessionId: "session", messageId: "answer", ifVersion: "v1" }),
      };
    } };
    const kernel = new Kernel<SealHarnessEvents>({ initialServices: [[messageFeedbackServiceToken, native]] });
    await kernel.start([plugin(dshCompatPlugin, { storage: false, messageFeedback: {}, plugins: [{ plugin: consumer }] })]);
    expect(result.list.value.items[0]).toMatchObject({ messageId: "answer", rating: "positive", note: "native", createdAt: Date.parse(item.createdAt) });
    expect(result.put).toMatchObject({ ok: true, value: { rating: "positive" } });
    expect(put).toHaveBeenCalledWith(expect.objectContaining({ rating: "up" }));
    expect(result.conflict).toMatchObject({ ok: false, error: { code: "version-conflict", current: { rating: "positive", version: "v1" } } });
    expect(result.deleted).toEqual({ ok: true, value: { absent: true } });
    await kernel.stop();
  });

  it("mounts and disposes the official Web session-log export route", async () => {
    const dispose = vi.fn(async () => {});
    const register = vi.fn(() => dispose);
    const connection = { fetch: { register } };
    const kernel = new Kernel<SealHarnessEvents>({ initialServices: [[sessionStoreToken, new MemorySessionStore()]] });
    await kernel.start([plugin(dshCompatPlugin, { services: { connection, attachments: {} }, storage: false, messageFeedback: false, sessionLogExport: {} })]);
    expect(register).toHaveBeenCalledWith(expect.objectContaining({ path: "/api/session.export", methods: ["GET", "HEAD"], fetch: expect.any(Function) }));
    await kernel.stop();
    expect(dispose).toHaveBeenCalledOnce();
  });

  it("mirrors Seal runtime activity into DSH Agent lifecycle and status", async () => {
    const observations: string[] = []; const inboxEvents: string[] = []; let registry: any; const followUp = vi.fn(); const steer = vi.fn(); const abort = vi.fn();
    const queued = { id: "queued" as never, placement: "queued" as const, message: { id: "queued" as never, role: "user" as const, content: [{ type: "text" as const, text: "pending" }] } };
    const splicePending = vi.fn(() => []); const execution = { followUp, steer, abort, pendingMessages: () => [queued], updatePendingMessage: vi.fn(() => "updated"), splicePending, result: Promise.resolve({}) };
    const sealAgents = { active: () => execution, prompt: vi.fn(), fork: vi.fn() } as any;
    const observer: DshPluginModule = {
      name: "agent-runtime-observer",
      inject: ["agents"],
      apply(context) {
        registry = context.get("agents");
        context.on("agent/created", ({ agent }: any) => { observations.push(`created:${agent.id}`); });
        context.on("agent/session-start", ({ agent }: any) => { observations.push(`started:${agent.id}`); });
        context.on("agent/status", ({ agent, status }: any) => { observations.push(`${status}:${agent.id}`); });
        context.on("agent/inbox/inserted" as any, ({ message }: any) => { inboxEvents.push(`inserted:${message.id}`); });
        context.on("agent/inbox/claimed" as any, ({ message, turn }: any) => { inboxEvents.push(`claimed:${message.id}:${turn}`); });
        context.on("agent/inbox/discarded" as any, ({ message }: any) => { inboxEvents.push(`discarded:${message.id}`); });
        context.on("agent/error" as any, ({ turn, step, error }: any) => { inboxEvents.push(`error:${turn}:${step}:${error.message}`); });
      },
    };
    const kernel = new Kernel<SealHarnessEvents>({ initialServices: [[agentServiceToken, sealAgents]] });
    await kernel.start([plugin(dshCompatPlugin, { plugins: [{ plugin: observer }] })]);
    await kernel.emit("runtime.event", { sessionId: "seal-live" as never, event: { type: "run_start", runId: "run" as never } });
    expect(registry.get("seal-live").status).toBe("running");
    registry.get("seal-live").followup({ id: "follow", role: "user", content: [{ type: "text", text: "later" }] });
    registry.get("seal-live").steer({ id: "steer", role: "user", content: [{ type: "text", text: "now" }] });
    expect(registry.get("seal-live").inbox.nextTurn).toEqual([queued.message]);
    registry.get("seal-live").inbox.prepend("next-step", { id: "prepended", role: "user", content: [{ type: "text", text: "first" }] });
    registry.get("seal-live").cancel({ kind: "user" }, { keepInbox: true });
    expect(followUp).toHaveBeenCalledWith(expect.objectContaining({ id: "follow" }));
    expect(steer).toHaveBeenCalledWith(expect.objectContaining({ id: "steer" }));
    expect(abort).toHaveBeenCalledWith({ kind: "user" });
    expect(splicePending).toHaveBeenCalledWith("steering", 0, 0, [expect.objectContaining({ id: "prepended" })]);
    await kernel.emit("runtime.event", { sessionId: "seal-live" as never, event: { type: "inbox_spliced", target: "next-step", start: 0, inserted: [{ id: "new" as never, role: "user", content: [{ type: "text", text: "new" }] }] } });
    await kernel.emit("runtime.event", { sessionId: "seal-live" as never, event: { type: "inbox_spliced", target: "next-step", start: 0, removedCount: 1, removed: [{ id: "new" as never, role: "user", content: [{ type: "text", text: "new" }] }], inserted: [] } });
    await kernel.emit("runtime.event", { sessionId: "seal-live" as never, event: { type: "inbox_spliced", target: "next-turn", start: 0, removedCount: 1, removed: [queued.message], inserted: [], outcome: "canceled" } });
    await kernel.emit("runtime.event", { sessionId: "seal-live" as never, event: { type: "run_error", step: 2, error: new Error("model failed") } });
    await kernel.emit("runtime.event", { sessionId: "seal-live" as never, event: { type: "run_end", stopReason: "stop" } });
    expect(registry.get("seal-live").status).toBe("idle");
    expect(observations).toEqual(["created:seal-live", "started:seal-live", "running:seal-live", "idle:seal-live"]);
    expect(inboxEvents).toEqual(["inserted:new", "claimed:new:1", "discarded:queued", "error:1:2:model failed"]);
    await kernel.stop();
  });

  it("wakes an idle mirrored Agent with its recorded route and queued injected context", async () => {
    let registry: any;
    const sessions = new MemorySessionStore(); await sessions.create({ id: "idle-agent" as never, cwd: "/workspace" });
    const execution = { followUp: vi.fn(), steer: vi.fn(), abort: vi.fn(), result: Promise.resolve({}) };
    const prompt = vi.fn(async () => execution);
    const sealAgents = { active: () => undefined, prompt, fork: vi.fn() } as any;
    const consumer: DshPluginModule = { name: "idle-agent-consumer", inject: ["agents"], apply(context) { registry = context.get("agents"); } };
    const kernel = new Kernel<SealHarnessEvents>({ initialServices: [[agentServiceToken, sealAgents], [sessionStoreToken, sessions]] });
    await kernel.start([plugin(dshCompatPlugin, { plugins: [{ plugin: consumer }] })]);
    await kernel.emit("session.appended", { sessionId: "idle-agent" as never, events: [
      { sequence: 0, timestamp: "2026-01-01T00:00:00.000Z", event: { type: "session.created", payload: { cwd: "/workspace" } } },
      { sequence: 1, timestamp: "2026-01-01T00:00:01.000Z", event: { type: "run.started", payload: { runId: "old-run" as never, model: { provider: "deepseek", model: "chat" }, reasoning: "high", maxTokens: 8192 } } },
    ] });
    await kernel.emit("runtime.event", { sessionId: "idle-agent" as never, event: { type: "run_start", runId: "old-run" as never } });
    await kernel.emit("runtime.event", { sessionId: "idle-agent" as never, event: { type: "run_end", stopReason: "stop" } });
    const agent = registry.get("idle-agent");
    agent.inbox.append("next-step", { id: "temporary", role: "user", content: [{ type: "text", text: "temporary" }] });
    agent.inbox.prepend("next-step", { id: "prefix", role: "user", content: [{ type: "text", text: "prefix" }] });
    expect(agent.inbox.nextStep.map((message: any) => message.id)).toEqual(["prefix", "temporary"]);
    expect(agent.inbox.splice("next-step", 0, 1, []).map((message: any) => message.id)).toEqual(["prefix"]);
    expect(agent.inbox.remove("temporary")).toBe(true);
    agent.inject({ id: "context", role: "user", content: [{ type: "text", text: "context" }] });
    agent.followup({ id: "prompt", role: "user", content: [{ type: "text", text: "continue" }], source: { kind: "user" } });
    await vi.waitFor(() => expect(prompt).toHaveBeenCalledOnce());
    expect(prompt).toHaveBeenCalledWith(expect.objectContaining({
      sessionId: "idle-agent", cwd: "/workspace", model: { provider: "deepseek", model: "chat" }, reasoning: "high", maxTokens: 8192,
      prompt: [{ type: "text", text: "continue" }], promptMessageId: "prompt",
      promptSource: { kind: "user" },
      injectedMessages: [{ id: "context", role: "user", content: [{ type: "text", text: "context" }] }],
    }));
    expect(foldSessionInbox((await sessions.read("idle-agent" as never))!.events)).toEqual({ nextTurn: [], nextStep: [] });
    await kernel.stop();
  });

  it("runs maintenance while idle and defers waking input until maintenance settles", async () => {
    let registry: any;
    const sessions = new MemorySessionStore(); await sessions.create({ id: "maintained" as never, cwd: "/workspace" });
    const execution = { followUp: vi.fn(), steer: vi.fn(), abort: vi.fn(), result: Promise.resolve({}) };
    const prompt = vi.fn(async () => execution);
    const sealAgents = { active: () => undefined, prompt, fork: vi.fn() } as any;
    const consumer: DshPluginModule = { name: "maintenance-consumer", inject: ["agents"], apply(context) { registry = context.get("agents"); } };
    const kernel = new Kernel<SealHarnessEvents>({ initialServices: [[agentServiceToken, sealAgents], [sessionStoreToken, sessions]] });
    await kernel.start([plugin(dshCompatPlugin, { plugins: [{ plugin: consumer }] })]);
    await kernel.emit("session.appended", { sessionId: "maintained" as never, events: [
      { sequence: 0, timestamp: "2026-01-01T00:00:00.000Z", event: { type: "session.created", payload: { cwd: "/workspace" } } },
      { sequence: 1, timestamp: "2026-01-01T00:00:01.000Z", event: { type: "run.started", payload: { runId: "old-run" as never, model: { provider: "deepseek", model: "chat" }, maxTokens: 2048 } } },
    ] });
    const agent = registry.adopt("maintained").agent;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const maintenance = agent.runMaintenance(async (signal: AbortSignal) => { expect(signal.aborted).toBe(false); await gate; return "done"; });
    expect(agent.status).toBe("idle");
    expect(() => agent.runMaintenance(async () => undefined)).toThrow("already has active work");
    agent.inject({ id: "context", role: "user", content: [{ type: "text", text: "context" }] });
    agent.followup({ id: "wake", role: "user", content: [{ type: "text", text: "wake" }] });
    expect(prompt).not.toHaveBeenCalled();
    release();
    await expect(maintenance).resolves.toBe("done");
    await vi.waitFor(() => expect(prompt).toHaveBeenCalledOnce());
    expect(prompt).toHaveBeenCalledWith(expect.objectContaining({
      sessionId: "maintained", maxTokens: 2048,
      promptMessageId: "wake",
      injectedMessages: [expect.objectContaining({ id: "context" })],
    }));
    await kernel.stop();
  });

  it("retries idle inbox persistence after an external Session version race", async () => {
    let registry: any;
    const sessions = new MemorySessionStore(); await sessions.create({ id: "raced-inbox" as never, cwd: "/workspace" });
    const append = sessions.append.bind(sessions); let injectRace = true;
    (sessions as any).append = async (request: any) => {
      if (injectRace && request.events[0]?.type === "agent/inbox.spliced") {
        injectRace = false;
        await append({ id: request.id, expectedVersion: request.expectedVersion, events: [{ type: "dsh.imported", payload: { type: "external/race", data: {} } }] });
      }
      return append(request);
    };
    const consumer: DshPluginModule = { name: "inbox-race-consumer", inject: ["agents"], apply(context) { registry = context.get("agents"); } };
    const kernel = new Kernel<SealHarnessEvents>({ initialServices: [[sessionStoreToken, sessions]] });
    await kernel.start([plugin(dshCompatPlugin, { localSandbox: false, plugins: [{ plugin: consumer }] })]);
    const handle = registry.adopt("raced-inbox", { cwd: "/workspace" });
    handle.agent.inject({ id: "durable", role: "user", content: [{ type: "text", text: "survive race" }] });
    await handle.agent.whenIdle();
    const stored = await sessions.read("raced-inbox" as never);
    expect(stored!.events.map(({ event }) => event.type)).toEqual(["session.created", "dsh.imported", "agent/inbox.spliced"]);
    expect(foldSessionInbox(stored!.events).nextStep.map((message) => message.id)).toEqual(["durable"]);
    await kernel.stop();
  });

  it("dispatches agent/request at the live model boundary and applies its replacement", async () => {
    let registry: any; let selected: unknown; let recovery: unknown; const seen: string[] = [];
    const sessions = new MemorySessionStore(); await sessions.create({ id: "request-hook" as never, cwd: "/workspace" });
    const execution = { result: Promise.resolve({}), followUp: vi.fn(), steer: vi.fn(), abort: vi.fn() };
    const prompt = vi.fn(async (request: any) => {
      const preStep = await request.runtimeHooks.preStep({ turn: 1, step: 3, signal: new AbortController().signal, messages: [{ id: "claimed", role: "user", content: [{ type: "text", text: "claimed" }] }] });
      expect(preStep).toEqual({ kind: "enter", messages: [{ id: "rewritten", role: "user", content: [{ type: "text", text: "rewritten" }] }] });
      selected = await request.runtimeHooks.request({ turn: 1, step: 3, signal: new AbortController().signal, config: { model: request.model, reasoning: request.reasoning, maxTokens: request.maxTokens } });
      recovery = await request.runtimeHooks.requestError({ turn: 1, step: 3, signal: new AbortController().signal, provider: "other", failure: { message: "busy", code: "RATE_LIMIT" } });
      await request.runtimeHooks.turnStopping({ turn: 1, signal: new AbortController().signal });
      return execution;
    });
    const sealAgents = { active: () => undefined, prompt, fork: vi.fn() } as any;
    const consumer: DshPluginModule = {
      name: "request-hook-consumer", inject: ["agents"], apply(context) {
        registry = context.get("agents");
        context.on("agent/pre-step" as any, async ({ agent, turn, step, messages }: any) => {
          seen.push(`pre:${agent.id}:${turn}:${step}:${messages[0].id}`);
          return { kind: "enter", messages: [{ id: "rewritten", role: "user", content: [{ type: "text", text: "rewritten" }] }] };
        });
        context.on("agent/request" as any, async ({ agent, turn, step }: any, next: () => Promise<any>) => {
          seen.push(`${agent.id}:${turn}:${step}`);
          expect(await next()).toEqual({ provider: "deepseek", model: "chat", reasoningEffort: "high", maxTokens: 2048 });
          return { provider: "other", model: "replacement", reasoningEffort: "low", maxTokens: 1024 };
        });
        context.on("agent/request-error" as any, async ({ agent, turn, step, provider, failure, retryPolicy }: any) => {
          seen.push(`error:${agent.id}:${turn}:${step}:${provider}:${failure.code}:${String(retryPolicy)}`);
          return { kind: "retry" };
        });
        context.on("agent/turn-stopping" as any, async ({ agent, turn }: any) => { seen.push(`stopping:${agent.id}:${turn}`); });
      },
    };
    const kernel = new Kernel<SealHarnessEvents>({ initialServices: [[agentServiceToken, sealAgents], [sessionStoreToken, sessions]] });
    await kernel.start([plugin(dshCompatPlugin, { timeContext: false, sessionReference: false, plugins: [{ plugin: consumer }] })]);
    await kernel.emit("session.appended", { sessionId: "request-hook" as never, events: [
      { sequence: 0, timestamp: "2026-01-01T00:00:00.000Z", event: { type: "session.created", payload: { cwd: "/workspace" } } },
      { sequence: 1, timestamp: "2026-01-01T00:00:01.000Z", event: { type: "run.started", payload: { runId: "prior" as never, model: { provider: "deepseek", model: "chat" }, reasoning: "high", maxTokens: 2048 } } },
    ] });
    registry.adopt("request-hook", { cwd: "/workspace" }).agent.followup({ id: "wake", role: "user", content: [{ type: "text", text: "go" }] });
    await vi.waitFor(() => expect(seen).toHaveLength(4));
    expect(prompt).toHaveBeenCalledOnce();
    expect(seen).toEqual(["pre:request-hook:2:3:claimed", "request-hook:2:3", "error:request-hook:2:3:other:RATE_LIMIT:undefined", "stopping:request-hook:2"]);
    expect(selected).toEqual({ model: { provider: "other", model: "replacement" }, reasoning: "low", maxTokens: 1024 });
    expect(recovery).toBe("retry");
    await kernel.stop();
  });

  it("preserves Cordis dynamic inject activation and disposal", async () => {
    const applied = vi.fn();
    const disposed = vi.fn();
    const waitingPlugin: DshPluginModule = {
      name: "waiting-plugin",
      inject: ["missing-service"],
      apply(context) {
        applied();
        context.effect(() => disposed);
      },
    };
    const kernel = new Kernel();

    await kernel.start([
      plugin(dshCompatPlugin, {
        plugins: [{ plugin: waitingPlugin }],
      }),
    ]);
    expect(applied).not.toHaveBeenCalled();

    const cordis = kernel.use(dshCompatServiceToken).context;
    const removeService = cordis.provide("missing-service", { ready: true });
    await vi.waitFor(() => expect(applied).toHaveBeenCalledOnce());

    removeService();
    await vi.waitFor(() => expect(disposed).toHaveBeenCalledOnce());
    await kernel.stop();
  });

  it("loads class-form DSH services and applies Standard Schema config validation", async () => {
    class GreetingService extends CordisService {
      readonly value: string;

      constructor(context: CordisContext, config: { value: string }) {
        super(context, "classGreeting");
        this.value = config.value;
      }
    }
    Object.assign(GreetingService, {
      Config: {
        "~standard": {
          version: 1,
          vendor: "seal-harness-test",
          validate(value: unknown) {
            if (typeof value === "object" && value !== null && typeof (value as { value?: unknown }).value === "string") {
              return { value: { value: `${(value as { value: string }).value}-normalized` } };
            }
            return { issues: [{ message: "value must be a string" }] };
          },
        },
      },
    });
    const observed: string[] = [];
    const consumer: DshPluginModule = {
      name: "class-service-consumer",
      inject: ["classGreeting"],
      apply(context) {
        observed.push((context.get("classGreeting") as GreetingService).value);
      },
    };
    const kernel = new Kernel();

    await kernel.start([
      plugin(dshCompatPlugin, {
        plugins: [
          { plugin: { default: GreetingService }, config: { value: "validated" } },
          { plugin: consumer },
        ],
      }),
    ]);
    expect(observed).toEqual(["validated-normalized"]);
    await kernel.stop();

    const invalidKernel = new Kernel();
    let invalidError: unknown;
    try {
      await invalidKernel.start([
        plugin(dshCompatPlugin, {
          plugins: [{ plugin: { default: GreetingService }, config: { value: 42 } }],
        }),
      ]);
    } catch (error) {
      invalidError = error;
    }
    expect(errorChain(invalidError)).toContain("value must be a string");
  });
});

function errorChain(error: unknown): string {
  const messages: string[] = [];
  let current = error;
  while (current instanceof Error) {
    messages.push(current.message);
    current = current.cause;
  }
  return messages.join("\n");
}
