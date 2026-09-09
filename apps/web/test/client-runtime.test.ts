import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Web client plugin runtime", () => {
  it("reconciles enable, disable, re-enable, and removal without a page restart", async () => {
    const browserWindow = new EventTarget() as EventTarget & Record<string, any>;
    const documentStub = { documentElement: { lang: "zh-CN" }, querySelectorAll: () => [] as unknown[] };
    vi.stubGlobal("window", browserWindow); vi.stubGlobal("document", documentStub);
    class WebSocketStub extends EventTarget {
      static readonly OPEN = 1; readyState = WebSocketStub.OPEN;
      constructor(readonly url: string) { super(); queueMicrotask(() => this.dispatchEvent(new Event("open"))); }
      send(raw: string): void {
        const request = JSON.parse(raw);
        if (request.type !== "open") return;
        if (request.endpoint === "$events") {
          queueMicrotask(() => this.dispatchEvent(new MessageEvent("message", { data: JSON.stringify({ type: "item", streamId: request.streamId, value: { type: "ready", clientId: "client-1", host: { home: "/home/test" } } }) })));
          setTimeout(() => this.dispatchEvent(new MessageEvent("message", { data: JSON.stringify({ type: "item", streamId: request.streamId, value: { type: "emit", event: "session.appended", args: [{ sessionId: "s1" }] } }) })), 5);
          setTimeout(() => this.dispatchEvent(new MessageEvent("message", { data: JSON.stringify({ type: "item", streamId: request.streamId, value: { type: "waterfall", event: "fixture/waterfall", eventId: "event-1", agentId: "agent-1", request: { value: 9 } } }) })), 100);
          setTimeout(() => this.dispatchEvent(new MessageEvent("message", { data: JSON.stringify({ type: "item", streamId: request.streamId, value: { type: "waterfall", event: "fixture/global", eventId: "event-2", agentId: "s1", request: { value: 10 } } }) })), 120);
          return;
        }
        const value = request.endpoint === "session/follow"
          ? { type: "snapshot", header: { version: 0, id: "s1", createdAt: 1 }, cursor: 0, records: [], hasMore: false, projections: { asOfSeq: 0, values: {} } }
          : { type: "baseline", value: { queues: { s1: [] }, jobs: { s1: [] }, projections: {} } };
        queueMicrotask(() => {
          this.dispatchEvent(new MessageEvent("message", { data: JSON.stringify({ type: "item", streamId: request.streamId, value }) }));
          this.dispatchEvent(new MessageEvent("message", { data: JSON.stringify({ type: "end", streamId: request.streamId }) }));
        });
      }
      close(): void { this.readyState = 3; this.dispatchEvent(new Event("close")); }
    }
    vi.stubGlobal("WebSocket", WebSocketStub);
    const fetchMock = vi.fn(async (input: string, init?: RequestInit) => {
      if (input === "/probe/echo") { const request = JSON.parse(String(init?.body)); return new Response(JSON.stringify({ type: "server-response", rpcId: request.rpcId, result: { ok: true, value: { echoed: request.payload } } }), { status: 200 }); }
      if (input === "/api/$events/result") { const request = JSON.parse(String(init?.body)); return new Response(JSON.stringify({ type: "server-response", rpcId: request.rpcId, result: { ok: true } }), { status: 200 }); }
      if (input === "/api/dynamicCordisRunner/syncInspectManifest") { const request = JSON.parse(String(init?.body)); return new Response(JSON.stringify({ type: "server-response", rpcId: request.rpcId, result: { ok: true, value: null } }), { status: 200 }); }
      if (input === "/api/dynamicCordisRunner/inventory") { const request = JSON.parse(String(init?.body)); return new Response(JSON.stringify({ type: "server-response", rpcId: request.rpcId, result: { ok: true, value: [] } }), { status: 200 }); }
      if (input === "/api/dsh/commands?sessionId=s1") return new Response(JSON.stringify([{ name: "plan", description: "Plan mode" }]), { status: 200 });
      if (input === "/api/sessions/s1/commands") return new Response(JSON.stringify({ commandId: "c1", result: { kind: "success" } }), { status: 200 });
      if (input === "/api/dsh/settings/describe") return new Response(JSON.stringify({ writable: true, hasDocument: true, namespaces: [] }), { status: 200 });
      if (input === "/api/dsh/settings/capabilities") return new Response(JSON.stringify({ canOpenAgentPresetDirectory: true }), { status: 200 });
      if (input === "/api/dsh/settings/open-document") return new Response(JSON.stringify({ opened: true }), { status: 200 });
      if (input === "/api/dsh/settings/open-agent-preset-directory") return new Response(JSON.stringify({ opened: false, path: "/presets/minimal" }), { status: 200 });
      if (input === "/api/dsh/settings/ui") return new Response(JSON.stringify({ error: "stale", code: "SETTINGS_CONFLICT", expected: 2, actual: 3 }), { status: 409 });
      if (input === "/api/dsh/agent-presets" && init?.method === "POST") { const body = JSON.parse(String(init.body)); return new Response(JSON.stringify(body.operation === "read" ? { agentPreset: body.agentPreset, trust: "user", content: "[]\n" } : null), { status: 200 }); }
      if (input === "/api/dsh/agent-presets") return new Response(JSON.stringify({ presets: [{ id: "standard", name: "Standard", isDefault: true, trust: "system" }], authorable: true }), { status: 200 });
      if (input === "/api/sessions/s1/agent-preset") return new Response(JSON.stringify({ error: "locked", code: "agent-preset/locked", details: { sessionId: "s1", agentPreset: "minimal" } }), { status: 409 });
      if (input === "/api/dsh/plugin-inventory") return new Response(JSON.stringify({ entries: [{ entryId: "ready-plugin", moduleName: "ready-plugin", enabled: true, fiberPhase: "active" }, { entryId: "waiting-plugin", moduleName: "waiting-plugin", enabled: true, fiberPhase: "pending" }, { entryId: "off-plugin", moduleName: "off-plugin", enabled: false, fiberPhase: null }], agentPresets: [{ id: "standard", trust: "system", isDefault: true, rows: [{ entryId: "tools", moduleName: "@deepseek-ai/dsh-tools", enabled: true, fiberPhase: "active" }] }] }), { status: 200 });
      if (input === "/api/dsh/capabilities") return new Response(JSON.stringify({ dynamicCordisRunner: true }), { status: 200 });
      if (input === "/api/sessions" && (init?.method === undefined || init.method === "GET")) return new Response(JSON.stringify([{ id: "s1", updatedAt: "2026-09-05T00:00:00.000Z", running: true, blank: false, cwd: "/work" }]), { status: 200 });
      if (input === "/api/sessions/search?query=hello%20world") return new Response(JSON.stringify({ items: [{ sessionId: "s1", snippet: "hello world" }], hasMore: false }), { status: 200 });
      if (input === "/api/dsh/session/page") return new Response(JSON.stringify({ records: [{ type: "event", event: { type: "user/message", seq: 0, time: 1, data: {} } }], hasMore: false }), { status: 200 });
      if (input === "/api/dsh/session/read") return new Response(JSON.stringify({ available: false }), { status: 200 });
      if (input === "/api/dsh/session/write") return new Response(JSON.stringify({ available: false }), { status: 200 });
      if (input === "/api/dsh/session/follow") return new Response(`${JSON.stringify({ type: "snapshot", header: { version: 0, id: "s1", createdAt: 1 }, cursor: 0, records: [], hasMore: false, projections: { asOfSeq: 0, values: {} } })}\n`, { status: 200, headers: { "content-type": "application/x-ndjson" } });
      if (input === "/api/dsh/session/control") return new Response(`${JSON.stringify({ type: "baseline", value: { queues: { s1: [] }, jobs: { s1: [] }, projections: {} } })}\n`, { status: 200, headers: { "content-type": "application/x-ndjson" } });
      if (input === "/api/dsh/session/update-queue") return new Response(JSON.stringify({ accepted: true }), { status: 200 });
      if (input === "/api/dsh/session/capabilities") return new Response(JSON.stringify({ canOpenWorkspacePath: true }), { status: 200 });
      if (input === "/api/dsh/session/open-workspace-path") return new Response(JSON.stringify({ opened: true }), { status: 200 });
      if (input === "/api/models") return new Response(JSON.stringify([{ provider: "deepseek", model: "deepseek-chat", displayName: "DeepSeek Chat", supportsReasoning: true, contextWindow: 1, maxOutputTokens: 1 }]), { status: 200 });
      if (input === "/api/dsh/llm/providers") return new Response(JSON.stringify([{ id: "deepseek", name: "DeepSeek" }]), { status: 200 });
      if (input === "/api/dsh/llm/configurable-providers") return new Response(JSON.stringify([{ provider: "openai", displayName: "OpenAI", settingsNs: "llm-pi-ai", settingsPath: ["providers", "openai"], declared: false }]), { status: 200 });
      if (input === "/api/sessions" && init?.method === "POST") return new Response(JSON.stringify({ sessionId: "created", agentPreset: "standard" }), { status: 201 });
      if (input === "/api/sessions/s1/title") return new Response(JSON.stringify({ id: "s1", title: "Renamed", seq: 12 }), { status: 200 });
      if (input === "/api/sessions/s1/fork") return new Response(JSON.stringify({ sessionId: "forked" }), { status: 201 });
      if (input === "/api/sessions/s1/model") return new Response(JSON.stringify({ selected: { provider: "deepseek", model: "deepseek-chat", reasoningEffort: "high" } }), { status: 200 });
      if (input === "/api/sessions/s1/cancel") return new Response(JSON.stringify({ accepted: true }), { status: 202 });
      if (input === "/api/sessions/s1/prompt") return new Response(JSON.stringify({ accepted: true }), { status: 202 });
      if (input === "/api/sessions/s1/attachments/sha256%3Afixture") return new Response(JSON.stringify({ attachment: { attachmentId: "sha256:fixture", mediaType: "image/png", bytes: 1, width: 1, height: 1 }, data: "AA==" }), { status: 200 });
      return new Response(JSON.stringify({ error: `unexpected ${input} ${init?.method || "GET"}` }), { status: 500 });
    });
    vi.stubGlobal("fetch", fetchMock);
    // @ts-expect-error Browser runtime is intentionally shipped as an untyped public asset.
    await import("../public/client-runtime.js");
    await vi.waitFor(() => expect(browserWindow.SealDshPlugins.active()).toContain("@deepseek-ai/dsh-cordis-client-runner"));
    const source = `window.__ModuleLoader__.load({id:"fixture",factory:(require)=>{const dependency=require("dependency/client");return {async apply(ctx){window.fixtureDependency=dependency.value;window.fixtureStarts=(window.fixtureStarts||0)+1;ctx.effect(()=>ctx.locale.register("fixture",{zh:{hello:"你好"},en:{hello:"Hello"}}));window.fixtureTranslation=ctx.locale.bind("fixture")("hello");window.fixtureModuleVersion=ctx.modules.version;window.fixtureOwnModule=await ctx.modules.import("fixture");window.fixtureManifest=ctx.modules.manifest;window.fixtureConnection=await ctx.connection.rpc.call("/probe","echo",{message:"hello"});window.fixtureCommands=await ctx.remote.commands.list("s1");window.fixtureExecution=await ctx.remote.commands.execute("s1","/plan off",[]);window.fixtureSettings=await ctx.remote.settings.describe();window.fixtureCanOpenPresets=await ctx.remote.settings.canOpenAgentPresetDirectory();window.fixtureOpenSettings=await ctx.remote.settings.openSettingsDocument();window.fixtureOpenPreset=await ctx.remote.settings.openAgentPresetDirectory("minimal");window.fixtureConflict=await ctx.remote.settings.mutate("ui",[],2);window.fixturePresets=await ctx.remote.agentPresets.list();window.fixturePresetDocument=await ctx.remote.agentPresets.read("standard");window.fixturePresetCopy=await ctx.remote.agentPresets.copy("standard","custom","Custom");window.fixturePresetDelete=await ctx.remote.agentPresets.deletePreset("custom");window.fixtureGoalClear=typeof ctx.remote.goals.clear;window.fixtureFeedbackPut=typeof ctx.remote.messageFeedback.put;window.fixtureSubagentPrompt=typeof ctx.remote.subagents.prompt;window.fixtureSessionReferences=typeof ctx.remote.sessionReferenceResolver.candidates;window.fixtureFileReferences=typeof ctx.remote.fileReferences.list;window.fixturePresetSelect=await ctx.remote.agentPresets.select("s1","minimal");window.fixtureInventory=await ctx.remote.pluginInventory.list();window.fixtureSessions=await ctx.remote.session.list({});window.fixtureSearch=await ctx.remote.session.search({query:"hello world"});window.fixturePage=await ctx.remote.session.page({address:{kind:"session",sessionId:"s1"},throughSeq:0});for await(const frame of ctx.remote.session.follow({address:{kind:"session",sessionId:"s1"}})){window.fixtureFollow=frame;break}for await(const frame of ctx.remote.session.control()){window.fixtureControl=frame;break}window.fixtureQueueUpdate=await ctx.remote.session.updateQueue({sessionId:"s1",itemId:"m1",action:{kind:"remove"}});window.fixtureModels=await ctx.remote.session.modelCatalog();window.fixtureCreated=await ctx.remote.session.create({cwd:"/work"});window.fixtureSelectedModel=await ctx.remote.session.selectModel({sessionId:"s1",provider:"deepseek",model:"deepseek-chat",reasoningEffort:"high"});window.fixtureRenamed=await ctx.remote.session.rename({sessionId:"s1",title:"Renamed"});window.fixtureForked=await ctx.remote.session.fork({sessionId:"s1"});window.fixturePrompted=await ctx.remote.session.prompt({requestId:"req-1",sessionId:"s1",mode:"queue",content:[{type:"text",text:"hello"}]});window.fixtureAttachment=await ctx.remote.session.attachment({sessionId:"s1",attachmentId:"sha256:fixture"});window.fixtureCanOpenWorkspace=await ctx.remote.session.canOpenWorkspacePath();window.fixtureOpenWorkspace=await ctx.remote.session.openWorkspacePath({path:"/work"});window.fixtureCancelled=await ctx.remote.session.cancel({sessionId:"s1"});ctx.effect(()=>()=>{window.fixtureStops=(window.fixtureStops||0)+1})}}}})`;
    const remoteSource = source.replace("async apply(ctx){", "async apply(ctx){window.fixtureLoader=ctx.loader;ctx.remote.$on({agentId:'agent-1'},'fixture/waterfall',(request)=>{window.fixtureWaterfall=request.value;return 'claimed-client'});ctx.remote.$on('fixture/global',(request)=>{window.fixtureGlobalWaterfall={value:request.value,sessionId:request.agent?.sessionId};return 'claimed-global'});");
    const dependencySource = `window.__ModuleLoader__.load({id:"dependency",factory:()=>({value:7,apply(){}})})`;
    const initialUrl = `data:text/javascript,${encodeURIComponent(`${dependencySource};${remoteSource}`)}`;
    const dependency = { name: "dependency", version: "1.0.0", url: `data:text/javascript,${encodeURIComponent(dependencySource)}`, initialUrl, dependencies: [], services: [], enabled: true };
    const entry = { name: "fixture", version: "1.0.0", url: `data:text/javascript,${encodeURIComponent(remoteSource)}`, initialUrl, dependencies: ["dependency"], external: ["dependency/client"], services: ["locale", "modules", "loader", "connection", "remote", "remote.commands", "remote.agentPresets", "remote.goals", "remote.messageFeedback", "remote.subagents", "remote.sessionReferenceResolver", "remote.fileReferences", "remote.workspace", "remote.llm", "remote.credentials", "remote.skills", "remote.directoryPicker", "remote.dynamicCordisRunner", "remote.pluginInventory", "remote.session", "remote.settings"], enabled: true };

    const firstLoad = await browserWindow.SealDshPlugins.load([entry, dependency]);
    expect(firstLoad).toEqual([{ name: "fixture", status: "active" }, { name: "dependency", status: "active" }]);
    expect(browserWindow.fixtureStarts).toBe(1); expect(browserWindow.fixtureDependency).toBe(7); expect(browserWindow.fixtureTranslation).toBe("你好"); expect(browserWindow.fixtureModuleVersion).toBe("client"); expect(browserWindow.fixtureOwnModule).toBeDefined(); expect(browserWindow.SealDshPlugins.startSession).toEqual(expect.any(Function)); expect(browserWindow.SealDshPlugins.active()).toEqual(expect.arrayContaining(["dependency", "fixture"]));
    let navigation; browserWindow.addEventListener("seal-harness:client-navigate-session", (event) => { navigation = (event as CustomEvent).detail; }); browserWindow.SealDshPlugins.startSession(); expect(navigation).toEqual({ sessionId: null });
    expect(browserWindow.fixtureManifest).toMatchObject({ rev: expect.any(String), modules: [{ id: "dependency" }, { id: "fixture", inject: ["dependency"], external: ["dependency/client"] }] });
    expect(browserWindow.fixtureConnection).toEqual({ ok: true, value: { echoed: { message: "hello" } } });
    expect(browserWindow.fixtureCommands).toEqual({ ok: true, value: [{ name: "plan", description: "Plan mode" }] });
    expect(browserWindow.fixtureExecution).toEqual({ ok: true, value: { commandId: "c1", result: { kind: "success" } } });
    expect(browserWindow.fixtureSettings).toEqual({ ok: true, value: { writable: true, hasDocument: true, namespaces: [] } });
    expect(browserWindow.fixtureCanOpenPresets).toEqual({ ok: true, value: true });
    expect(browserWindow.fixtureOpenSettings).toEqual({ ok: true, value: { opened: true } });
    expect(browserWindow.fixtureOpenPreset).toEqual({ ok: true, value: { opened: false, path: "/presets/minimal" } });
    expect(browserWindow.fixtureConflict.ok).toBe(false); expect(browserWindow.fixtureConflict.error).toMatchObject({ isDSHRemoteError: true, code: "settings/conflict", details: { ns: "ui", expected: 2, actual: 3 } });
    expect(browserWindow.fixturePresets).toEqual({ ok: true, value: { presets: [{ id: "standard", name: "Standard", isDefault: true, trust: "system" }], authorable: true } });
    expect(browserWindow.fixturePresetDocument).toEqual({ ok: true, value: { agentPreset: "standard", trust: "user", content: "[]\n" } });
    expect(browserWindow.fixturePresetCopy).toEqual({ ok: true, value: null });
    expect(browserWindow.fixturePresetDelete).toEqual({ ok: true, value: null });
    expect(browserWindow.fixtureGoalClear).toBe("function");
    expect(browserWindow.fixtureFeedbackPut).toBe("function");
    expect(browserWindow.fixtureSubagentPrompt).toBe("function");
    expect(browserWindow.fixtureSessionReferences).toBe("function");
    expect(browserWindow.fixtureFileReferences).toBe("function");
    expect(browserWindow.fixturePresetSelect.ok).toBe(false); expect(browserWindow.fixturePresetSelect.error).toMatchObject({ code: "agent-preset/locked", details: { sessionId: "s1", agentPreset: "minimal" } });
    expect(browserWindow.fixtureInventory).toEqual({ ok: true, value: { entries: [
      { entryId: "ready-plugin", moduleName: "ready-plugin", enabled: true, fiberPhase: "active" },
      { entryId: "waiting-plugin", moduleName: "waiting-plugin", enabled: true, fiberPhase: "pending" },
      { entryId: "off-plugin", moduleName: "off-plugin", enabled: false, fiberPhase: null },
    ], agentPresets: [{ id: "standard", trust: "system", isDefault: true, rows: [{ entryId: "tools", moduleName: "@deepseek-ai/dsh-tools", enabled: true, fiberPhase: "active" }] }] } });
    expect(browserWindow.fixtureSessions).toEqual({ ok: true, value: { items: [{ sessionId: "s1", updatedAt: Date.parse("2026-09-05T00:00:00.000Z"), running: true, blank: false, cwd: "/work" }] } });
    expect(browserWindow.fixtureSearch).toEqual({ ok: true, value: { items: [{ sessionId: "s1", snippet: "hello world" }], hasMore: false } });
    expect(browserWindow.fixturePage).toMatchObject({ ok: true, value: { records: [{ event: { type: "user/message", seq: 0 } }], hasMore: false } });
    expect(browserWindow.fixtureFollow).toMatchObject({ type: "snapshot", cursor: 0, header: { id: "s1" } });
    expect(browserWindow.fixtureControl).toMatchObject({ type: "baseline", value: { queues: { s1: [] }, jobs: { s1: [] } } });
    expect(browserWindow.fixtureQueueUpdate).toEqual({ ok: true, value: { accepted: true } });
    expect(browserWindow.fixtureCanOpenWorkspace).toEqual({ ok: true, value: true });
    expect(browserWindow.fixtureOpenWorkspace).toEqual({ ok: true, value: { opened: true } });
    expect(browserWindow.fixtureModels).toMatchObject({ ok: true, value: { default: { provider: "deepseek", model: "deepseek-chat" }, routableProviders: ["deepseek"], groups: [{ id: "deepseek", models: [{ id: "deepseek-chat", name: "DeepSeek Chat" }] }], failures: [] } });
    expect(browserWindow.fixtureCreated).toEqual({ ok: true, value: { sessionId: "created", agentPreset: "standard" } });
    expect(browserWindow.fixtureSelectedModel).toEqual({ ok: true, value: { selected: { provider: "deepseek", model: "deepseek-chat", reasoningEffort: "high" } } });
    expect(browserWindow.fixtureRenamed).toEqual({ ok: true, value: { title: "Renamed", seq: 12 } });
    expect(browserWindow.fixtureForked).toEqual({ ok: true, value: { sessionId: "forked" } });
    expect(browserWindow.fixturePrompted).toEqual({ ok: true, value: { accepted: true } });
    expect(browserWindow.fixtureAttachment).toMatchObject({ ok: true, value: { attachment: { attachmentId: "sha256:fixture", width: 1, height: 1 }, data: "AA==" } });
    expect(browserWindow.fixtureCancelled).toEqual({ ok: true, value: { accepted: true } });
    const selectedEvent = new Event("seal-harness:session-selected"); Object.assign(selectedEvent, { detail: { sessionId: "s1" } }); browserWindow.dispatchEvent(selectedEvent);
    const referenceSource = {
      trigger: "@", name: "reference", warm: vi.fn(),
      candidates: vi.fn(async (_session: any, request: any) => [{ name: "docs/", icon: "folder", drill: true, value: request.query }]),
      onPick: vi.fn(({ candidate, action }: any) => action === "drill" ? { text: `@${candidate.name}`, continue: true } : { insert: { source: "reference", ref: candidate.value, label: candidate.name, appearance: "folder", clipboardText: '@"docs/"' } }),
    };
    const disposeInputTriggers = browserWindow.SealDshPlugins.provide("inputTriggers", { entries: () => [referenceSource] });
    const referenceCandidates = await browserWindow.SealDshPlugins.inputTriggerCandidates("@", "do", "leading", false, false);
    expect(referenceSource.warm).toHaveBeenCalledWith(expect.objectContaining({ sessionId: "s1" }));
    expect(referenceSource.candidates).toHaveBeenCalledWith(expect.objectContaining({ sessionId: "s1" }), expect.objectContaining({ query: "do", position: "leading", quoted: false, drilled: false, signal: expect.any(AbortSignal) }));
    expect(referenceCandidates).toEqual([{ name: "docs/", icon: "folder", drill: true, value: "do", trigger: "@", source: "reference", position: "leading" }]);
    expect(await browserWindow.SealDshPlugins.pickInputTrigger(referenceCandidates[0], "pick")).toMatchObject({ insert: { clipboardText: '@"docs/"' } });
    expect(await browserWindow.SealDshPlugins.pickInputTrigger(referenceCandidates[0], "drill")).toEqual({ text: "@docs/", continue: true });
    disposeInputTriggers();
    browserWindow.__ModuleLoader__.load({ id: "dyn/fixture", factory: () => ({ inject: ["locale"], apply() { browserWindow.fixtureDynamicStarts = (browserWindow.fixtureDynamicStarts ?? 0) + 1; return () => { browserWindow.fixtureDynamicStops = (browserWindow.fixtureDynamicStops ?? 0) + 1; }; } }) });
    const dynamicEntryId = await browserWindow.fixtureLoader.create({ name: "dyn/fixture" });
    expect(browserWindow.fixtureLoader.resolve(dynamicEntryId).fiber.inject).toEqual({ locale: null });
    expect(browserWindow.fixtureDynamicStarts).toBe(1);
    await browserWindow.fixtureLoader.remove(dynamicEntryId);
    expect(browserWindow.fixtureDynamicStops).toBe(1);
    await vi.waitFor(() => expect(browserWindow.fixtureWaterfall).toBe(9));
    await vi.waitFor(() => expect(browserWindow.fixtureGlobalWaterfall).toEqual({ value: 10, sessionId: "s1" }));
    expect(fetchMock).toHaveBeenCalledWith("/api/$events/result", expect.objectContaining({ body: expect.stringContaining('"kind":"result","value":"claimed-client"') }));
    expect(fetchMock).toHaveBeenCalledWith("/api/$events/result", expect.objectContaining({ body: expect.stringContaining('"kind":"result","value":"claimed-global"') }));
    const dependencyV2Source = `window.__ModuleLoader__.load({id:"dependency",factory:()=>({value:8,apply(){}})})`;
    const dependencyV2 = { ...dependency, version: "1.0.1", url: `data:text/javascript,${encodeURIComponent(dependencyV2Source)}` };
    await browserWindow.SealDshPlugins.load([entry, dependencyV2]);
    expect(browserWindow.fixtureStops).toBe(1); expect(browserWindow.fixtureStarts).toBe(2); expect(browserWindow.fixtureDependency).toBe(8);
    const entryGraphV2 = { ...entry, dependencies: ["dependency/client"] };
    await browserWindow.SealDshPlugins.load([entryGraphV2, dependencyV2]);
    expect(browserWindow.fixtureStops).toBe(2); expect(browserWindow.fixtureStarts).toBe(3);
    await browserWindow.SealDshPlugins.load([{ ...entryGraphV2, enabled: false }, dependencyV2]);
    expect(browserWindow.fixtureStops).toBe(3); expect(browserWindow.SealDshPlugins.active()).toEqual(expect.arrayContaining(["dependency"]));
    await browserWindow.SealDshPlugins.load([entryGraphV2, dependencyV2]);
    expect(browserWindow.fixtureStarts).toBe(4);
    await browserWindow.SealDshPlugins.load([]);
    expect(browserWindow.fixtureStops).toBe(4); expect(browserWindow.SealDshPlugins.descriptors()).toEqual([]);
  });
});
