// @vitest-environment jsdom

import { Context } from "@deepseek-ai/cordis";
import * as Cordis from "@deepseek-ai/cordis";
import * as Store from "@deepseek-ai/dsh-client-store";
import * as Slots from "@deepseek-ai/dsh-client-ui-slots";
import * as React from "react";
import * as ReactDom from "react-dom";
import * as ReactDomClient from "react-dom/client";
import * as JsxRuntime from "react/jsx-runtime";
import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => { document.body.replaceChildren(); document.head.querySelectorAll('meta[name="theme-color"]').forEach((node) => node.remove()); });

function localeService() {
  const dictionaries = new Map<string, Record<string, string>>();
  return {
    register(namespace: string, values: { en: Record<string, string> }) { dictionaries.set(namespace, values.en); return () => dictionaries.delete(namespace); },
    bind(namespace: string) { return (key: string) => dictionaries.get(namespace)?.[key] ?? key; },
  };
}

describe("official DSH shell ABI", () => {
  it("projects the published Session and Workspace Controller baselines", async () => {
    const factories = new Map<string, (require: (name: string) => unknown) => unknown>();
    Object.assign(window, { __ModuleLoader__: { load(entry: { id: string; factory: (require: (name: string) => unknown) => unknown }) { factories.set(entry.id.replace(/\/client$/, ""), entry.factory); } } });
    await import("@deepseek-ai/dsh-api-gateway/client");
    await import("@deepseek-ai/dsh-api-session-controller/client");
    await import("@deepseek-ai/dsh-api-workspace-controller/client");
    await import("@deepseek-ai/dsh-client-ui-settings/client");
    const dependencies = new Map<string, unknown>([["@deepseek-ai/cordis", Cordis], ["@deepseek-ai/dsh-client-store", Store]]);
    const materialize = (id: string): any => factories.get(id)!((name) => dependencies.get(name) ?? materialize(name.replace(/\/client$/, "")));
    const controller = materialize("@deepseek-ai/dsh-api-session-controller");
    const workspaceController = materialize("@deepseek-ai/dsh-api-workspace-controller");
    const settingsController = materialize("@deepseek-ai/dsh-client-ui-settings");
    const listeners = new Map<string, (...args: unknown[]) => void>();
    let disposed = false;
    const remote = {
      $host: { home: "/home/test", isLoopback: true },
      $on(event: string, listener: (...args: unknown[]) => void) { listeners.set(event, listener); return () => listeners.delete(event); },
      $stream(options: { name: string }) {
        return {
          restart() {}, async dispose() { disposed = true; },
          async *[Symbol.asyncIterator]() {
            const value = options.name === "Workspace state stream"
              ? { type: "baseline", value: { items: [{ workspaceId: "w1", path: "/work", title: "Work", sessionIds: ["s1"], createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" }], archivedSessionIds: [] } }
              : { type: "baseline", value: { queues: { s1: [] }, jobs: { s1: [] }, projections: {} } };
            yield { generation: 1, value, accept() {} };
          },
        };
      },
      commands: {}, subagents: {},
      session: {
        async list() { return { ok: true, value: { items: [{ sessionId: "s1", updatedAt: 1, running: false, blank: false, cwd: "/work" }] } }; },
        async *control() {},
      },
      workspace: { async *follow() {} },
      settings: { async describe() { return { ok: true, value: { writable: true, hasDocument: true, namespaces: [{ ns: "ui-chat", schema: {}, value: { transcriptView: "compact" }, revision: 1, applies: "live" }] } }; } },
    };
    const ctx = new Context();
    ctx.provide("remote", remote as never); ctx.provide("remote.commands", remote.commands as never); ctx.provide("remote.session", remote.session as never); ctx.provide("remote.subagents", remote.subagents as never);
    ctx.provide("remote.workspace", remote.workspace as never);
    ctx.provide("remote.settings", remote.settings as never);
    ctx.provide("typert", { contexts: { registerClient: vi.fn(() => () => {}) } } as never);
    const fiber = ctx.plugin(controller as never, {} as never); await fiber;
    const workspaceFiber = ctx.plugin(workspaceController as never, {} as never); await workspaceFiber;
    const settingsFiber = ctx.plugin(settingsController as never, {} as never); await settingsFiber;
    const sessions = ctx.get("sessions") as unknown as { list: { getSnapshot(): { byId: Record<string, { cwd?: string }> } } };
    await vi.waitFor(() => expect(sessions.list.getSnapshot().byId.s1).toMatchObject({ cwd: "/work" }));
    const workspaces = ctx.get("workspaces") as unknown as { list: { getSnapshot(): { items: Array<{ workspaceId: string }> } } };
    await vi.waitFor(() => expect(workspaces.list.getSnapshot().items).toEqual([expect.objectContaining({ workspaceId: "w1" })]));
    const settingsScope = ctx.get("settingsScope") as unknown as { describe(): { getSnapshot(): { status: string; view?: { namespaces: unknown[] } } } };
    await vi.waitFor(() => expect(settingsScope.describe().getSnapshot()).toMatchObject({ status: "ready", view: { namespaces: [expect.objectContaining({ ns: "ui-chat" })] } }));
    expect(listeners.has("api-session/added")).toBe(true);
    await settingsFiber.dispose(); await workspaceFiber.dispose(); await fiber.dispose(); expect(disposed).toBe(true);
  });

  it("activates the published Renderer, Layout, and Sidebar together on real Cordis", async () => {
    const factories = new Map<string, (require: (name: string) => unknown) => unknown>();
    Object.assign(window, { __ModuleLoader__: { load(entry: { id: string; factory: (require: (name: string) => unknown) => unknown }) { factories.set(entry.id.replace(/\/client$/, ""), entry.factory); } } });
    await import("@deepseek-ai/dsh-client-ui-renderer/client");
    await import("@deepseek-ai/dsh-client-ui-layout/client");
    await import("@deepseek-ai/dsh-client-ui-sidebar/client");
    const passthrough = ({ children }: React.PropsWithChildren) => React.createElement(React.Fragment, null, children);
    const icon = ({ size = 16 }: { size?: number }) => React.createElement("svg", { width: size, height: size });
    const primitives = { FishLogo: icon, IconPanelLeftOutline16: icon, IconNewChatOutline16: icon, Tooltip: passthrough };
    const dependencies = new Map<string, unknown>([["@deepseek-ai/cordis", Cordis], ["@deepseek-ai/dsh-client-store", Store], ["@deepseek-ai/dsh-client-ui-slots", Slots], ["@deepseek-ai/dsh-client-ui-primitives", primitives], ["react", React], ["react-dom", ReactDom], ["react-dom/client", ReactDomClient], ["react/jsx-runtime", JsxRuntime]]);
    const plugin = (id: string) => factories.get(id)!((name) => { const value = dependencies.get(name); if (value === undefined) throw new Error(`missing test module ${name}`); return value; }) as object;
    const rendererPlugin = plugin("@deepseek-ai/dsh-client-ui-renderer");
    const layoutPlugin = plugin("@deepseek-ai/dsh-client-ui-layout");
    const sidebarPlugin = plugin("@deepseek-ai/dsh-client-ui-sidebar");
    const ctx = new Context(); const startSession = vi.fn();
    const locale = localeService();
    ctx.provide("locale", locale as never);
    ctx.provide("theme", { getTheme: () => ({ preference: "dark", fontSize: 14, active: { id: "dark", colorScheme: "dark", tokens: {} }, themes: [], revision: 1 }) } as never);
    ctx.provide("uiWorkspace", { startSession } as never);
    const renderer = ctx.plugin(rendererPlugin as never, {} as never); await renderer;
    const slots = ctx.get("slots") as {
      installLocale(face: object): void;
      installScope(scope: "session", adapter: object): void;
      provideRoot(contribution: object): () => void;
      entries(key: string): readonly unknown[];
    };
    slots.installLocale({ ...locale, getSnapshot: () => ({ revision: 1 }), subscribe: () => () => {} });
    const absentSession = { key: undefined, hooks: {}, keyedHooks: {}, props: {} };
    slots.installScope("session", {
      current: { getSnapshot: () => absentSession, subscribe: () => () => {} },
      resolve: () => undefined,
      renderArea: (binding: { key?: string }, props: { empty?: () => React.ReactNode; children: React.ReactNode }) =>
        binding.key === undefined ? props.empty?.() : props.children,
    });
    slots.provideRoot({ hooks: { sessions: { getSnapshot: () => ({ current: undefined, byId: {} }), subscribe: () => () => {} } } });
    Object.assign(globalThis, { ResizeObserver: class { observe() {} disconnect() {} } });
    const layout = ctx.plugin(layoutPlugin as never, {} as never); await layout;
    const sidebar = ctx.plugin(sidebarPlugin as never, {} as never); await sidebar;
    const container = document.createElement("div"); document.body.append(container);
    const unmount = (ctx.get("uiRenderer") as { mount(element: HTMLElement): () => void }).mount(container);
    const button = [...container.querySelectorAll("button")].find((candidate) => candidate.textContent?.includes("New"));
    expect(button).toBeDefined(); button!.click(); expect(startSession).toHaveBeenCalledOnce();
    expect(slots.entries("root")).toHaveLength(1);
    unmount(); await sidebar.dispose(); await layout.dispose(); await renderer.dispose();
  });
});
