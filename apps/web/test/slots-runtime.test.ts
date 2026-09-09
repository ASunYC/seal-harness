// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => { vi.unstubAllGlobals(); (globalThis as any).document.body.innerHTML = ""; });

describe("DSH React Slots runtime", () => {
  it("renders declared list slots in order and removes the tree with its plugin scope", async () => {
    const browser = globalThis as any; const doc = browser.document;
    doc.body.innerHTML = '<div id="dsh-slot-root"></div><div id="dsh-sidebar-footer-slot"></div><div id="dsh-settings-general-slot"></div>';
    class WebSocketStub extends EventTarget {
      static readonly OPEN = 1; readyState = WebSocketStub.OPEN;
      constructor(readonly url: string) { super(); queueMicrotask(() => this.dispatchEvent(new Event("open"))); }
      send(raw: string): void { const frame = JSON.parse(raw); if (frame.type === "open" && frame.endpoint === "$events") queueMicrotask(() => this.dispatchEvent(new MessageEvent("message", { data: JSON.stringify({ type: "item", streamId: frame.streamId, value: { type: "ready", clientId: "slots-client", host: { home: "/home/test" } } }) }))); }
      close(): void { this.readyState = 3; this.dispatchEvent(new Event("close")); }
    }
    vi.stubGlobal("WebSocket", WebSocketStub);
    vi.resetModules();
    // @ts-expect-error Browser runtime is intentionally shipped as an untyped public asset.
    await import("../public/client-runtime.js");
    const source = `window.__ModuleLoader__.load({id:"slots-fixture",factory:(require)=>{const React=require("react");const {defineStore}=require("@deepseek-ai/dsh-client-store");const counter=defineStore({init:()=>({count:0}),actions:{inc:(draft)=>{draft.count+=1}}});return {apply(ctx){window.selectFixtureSession=ctx.uiSession.select;
      ctx.effect(()=>ctx.slots.register({name:"root",children:{"fixture.list":{kind:"list",scope:"root"},"fixture.keyed":{kind:"keyed",scope:"root"},"fixture.chain":{kind:"chain",scope:"root"},"fixture.session":{kind:"single",scope:"session"},"fixture.maybe":{kind:"single",scope:"session-maybe"}}},(props)=>{const sessions=props.useSessions();const workspaces=props.useWorkspaces();return React.createElement("section",{"data-testid":"root"},props.renderSlot("fixture.list",{}),props.renderSlot("fixture.keyed",{value:"K"},{entryKey:"alpha"}),props.renderSlotChain("fixture.chain",{kind:"hit"},{fallback:"fallback"}),React.createElement(props.SessionProvider,{empty:()=>React.createElement("i",null,"empty")},props.renderSlot("fixture.session",{})),props.renderSlot("fixture.maybe",{}),React.createElement("small",null,sessions.ids.length,"/",workspaces.items.length))}));
      ctx.effect(()=>ctx.slots.register({name:"fixture.list",id:"later",order:20},()=>React.createElement("span",null,"A")));
      ctx.effect(()=>ctx.slots.register({name:"fixture.list",id:"earlier",order:10,inject:()=>({hooks:{count:{getSnapshot:()=>7,subscribe:()=>()=>{}}}})},(props)=>React.createElement("span",null,"B",props.useCount())));
      ctx.effect(()=>ctx.slots.register({name:"fixture.keyed",key:"alpha"},(props)=>React.createElement("span",null,props.value)));
      ctx.effect(()=>ctx.slots.register({name:"fixture.keyed",key:"beta"},()=>React.createElement("span",null,"wrong")));
      ctx.effect(()=>ctx.slots.register({name:"fixture.chain",select:(owner)=>owner.kind==="hit"?"matched":null},(props)=>React.createElement("span",null,props.matched)));
      ctx.effect(()=>ctx.slots.register({name:"fixture.session",store:counter,inject:(sessionId,actions)=>({sessionId,actions})},(props)=>{window.bumpFixtureStore=props.actions.inc;return React.createElement("b",null,props.sessionId,":",props.useStore((state)=>state.count))}));
      ctx.effect(()=>ctx.slots.register({name:"fixture.maybe"},(props)=>React.createElement("u",null,props.sessionId??"none")));
      ctx.effect(()=>ctx.slots.register({name:"tool.call.toolview",key:"fixture_tool"},(props)=>React.createElement("em",{"data-testid":"tool-face"},props.callId,":",props.block.argsRaw)));
      ctx.effect(()=>ctx.slots.register({name:"sidebar.footer.action",id:"fixture-footer"},()=>React.createElement("button",{"data-testid":"sidebar-face"},"Panel")));
      ctx.effect(()=>ctx.slots.register({name:"settings.general.item",id:"fixture-setting",order:5},()=>React.createElement("label",{"data-testid":"settings-face"},"Preference")));
      ctx.effect(()=>ctx.inputTriggers.registerSource({trigger:"@",name:"fixture",candidates:(session,{query})=>Promise.resolve([{name:query+session.sessionId,description:"Fixture plugin"}])}));
    }}}})`;
    const entry = { name: "slots-fixture", version: "1.0.0", url: `data:text/javascript,${encodeURIComponent(source)}`, initialUrl: `data:text/javascript,${encodeURIComponent(source)}`, dependencies: [], external: ["react", "@deepseek-ai/dsh-client-store"], services: ["slots", "uiSession", "inputTriggers"], enabled: true };
    expect(await browser.window.SealDshPlugins.load([entry])).toEqual([{ name: "slots-fixture", status: "active" }]);
    browser.window.dispatchEvent(new CustomEvent("seal-harness:domain-snapshot", { detail: { sessions: [{ id: "s1", preview: "One" }], workspaces: [{ id: "w1", title: "Workspace", path: "/tmp", sessionIds: ["s1"] }], archivedSessionIds: [] } }));
    await vi.waitFor(() => expect(doc.querySelector('[data-testid="root"]')?.textContent).toBe("B7AKmatchedemptynone1/1"));
    await vi.waitFor(() => expect(doc.querySelector('#dsh-sidebar-footer-slot [data-testid="sidebar-face"]')?.textContent).toBe("Panel"));
    await vi.waitFor(() => expect(doc.querySelector('#dsh-settings-general-slot [data-testid="settings-face"]')?.textContent).toBe("Preference"));
    expect(doc.querySelector('#dsh-slot-root [data-testid="sidebar-face"]')).toBeNull();
    browser.window.selectFixtureSession("s1");
    await expect(browser.window.SealDshPlugins.inputTriggerCandidates("@", "plug")).resolves.toEqual([{ name: "plugs1", description: "Fixture plugin", trigger: "@", source: "fixture" }]);
    const toolHost = doc.createElement("div"); doc.body.append(toolHost);
    expect(browser.window.SealDshPlugins.mountToolView(toolHost, { callId: "call-1", toolName: "fixture_tool", block: { argsRaw: '{"x":1}' } })).toBe(true);
    await vi.waitFor(() => expect(doc.querySelector('[data-testid="tool-face"]')?.textContent).toBe('call-1:{"x":1}'));
    await vi.waitFor(() => expect(doc.querySelector('[data-testid="root"]')?.textContent).toContain("s1:0s1"));
    browser.window.bumpFixtureStore();
    await vi.waitFor(() => expect(doc.querySelector('[data-testid="root"]')?.textContent).toContain("s1:1s1"));
    browser.window.selectFixtureSession("s2");
    await vi.waitFor(() => expect(doc.querySelector('[data-testid="root"]')?.textContent).toContain("s2:0s2"));
    browser.window.selectFixtureSession("s1");
    await vi.waitFor(() => expect(doc.querySelector('[data-testid="root"]')?.textContent).toContain("s1:1s1"));
    await browser.window.SealDshPlugins.load([{ ...entry, enabled: false }]);
    await vi.waitFor(() => expect(doc.querySelector('[data-testid="root"]')).toBeNull());
    expect(browser.window.SealDshPlugins.unmountToolView(toolHost)).toBe(true);
    expect(browser.window.SealDshPlugins.unmountToolView(toolHost)).toBe(false);
  });
});
