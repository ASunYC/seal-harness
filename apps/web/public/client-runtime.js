import * as React from "react";
import * as ReactJsxRuntime from "react/jsx-runtime";
import * as ReactDom from "react-dom";
import { createRoot as createReactRoot } from "react-dom/client";
import * as Cordis from "@deepseek-ai/cordis";
import * as DshSlots from "@deepseek-ai/dsh-client-ui-slots";
import * as DshStore from "@deepseek-ai/dsh-client-store";

const modules = new Map();
const factories = new Map();
const active = new Map();
const descriptors = new Map();
const listeners = new Map();
const appliedStyles = new Map();
const moduleStyles = new Map();
const services = new Map();
const moduleRecords = new Map();
const materializing = [];
const reloadEpochs = new Map();
const reloadRevisions = new Map();
const dynamicLoaderEntries = new Map();
const cordisClientRoot = new Cordis.Context();
const officialShellRoot = new Cordis.Context();
const cordisProvided = new Set();
let moduleManifest = Object.freeze({ rev: "", modules: Object.freeze([]), plugins: Object.freeze([]) });
modules.set("react", React);
modules.set("react/jsx-runtime", ReactJsxRuntime);
modules.set("react-dom", ReactDom);
modules.set("react-dom/client", Object.freeze({ createRoot: createReactRoot }));
modules.set("@deepseek-ai/cordis", Cordis);
modules.set("@deepseek-ai/dsh-client-ui-slots", DshSlots);
modules.set("@deepseek-ai/dsh-client-store", DshStore);

function moduleId(name) { return name.endsWith("/client") ? name.slice(0, -7) : name; }
function moduleUrl(entry) { const epoch = reloadEpochs.get(entry.name) ?? 0; const revision = reloadRevisions.get(entry.name) ?? entry.version; const initial = epoch === 0 && !reloadRevisions.has(entry.name) ? entry.initialUrl : undefined; const base = initial ?? entry.url; const suffix = `seal-version=${encodeURIComponent(revision)}&seal-reload=${epoch}`; return initial ? base : /^(?:data|blob):/.test(base) ? `${base}#${suffix}` : `${base}${base.includes("?") ? "&" : "?"}${suffix}`; }
function sameList(left = [], right = []) { return left.length === right.length && left.every((value, index) => value === right[index]); }
function descriptorChanged(left, right) { return left.url !== right.url || left.initialUrl !== right.initialUrl || left.version !== right.version || left.immediately !== right.immediately || !sameList(left.dependencies, right.dependencies) || !sameList(left.external, right.external) || !sameList(left.services ?? left.inject, right.services ?? right.inject); }

function requireModule(name) {
  const id = moduleId(name); const parent = materializing.at(-1);
  if (parent) moduleRecords.get(parent)?.edges.add(id);
  if (!modules.has(id) && factories.has(id)) materialize(id);
  const value = modules.get(id);
  if (value === undefined) throw new Error(`Unsupported DSH client dependency: ${name}`);
  return value;
}

function materialize(name) {
  const id = moduleId(name); if (modules.has(id)) return modules.get(id);
  const factory = factories.get(id); if (factory === undefined) throw new Error(`DSH client module factory did not register: ${id}`);
  if (materializing.includes(id)) throw new Error(`DSH client module cycle: ${[...materializing, id].join(" -> ")}`);
  const record = { id, exports: undefined, styles: [], edges: new Set() }; moduleRecords.set(id, record); materializing.push(id);
  try { record.exports = factory(requireModule); modules.set(id, record.exports); return record.exports; }
  catch (error) { moduleRecords.delete(id); throw error; }
  finally { materializing.pop(); }
}

window.__ModuleLoader__ = {
  load(entry) {
    if (!entry || typeof entry.id !== "string" || typeof entry.factory !== "function") {
      throw new TypeError("Invalid DSH client module");
    }
    const id = moduleId(entry.id);
    if (factories.has(id)) throw new Error(`DSH client module registered twice without invalidation: ${id}`);
    factories.set(id, entry.factory);
  },
};

function createContext(owner) {
  const disposers = [];
  const context = {
    effect(callback) {
      const dispose = callback();
      if (typeof dispose === "function") disposers.push(dispose);
      let pending = true;
      return async () => {
        if (!pending) return;
        pending = false;
        if (typeof dispose === "function") await dispose();
      };
    },
    on(event, handler) {
      const values = listeners.get(event) || [];
      values.push({ owner, handler });
      listeners.set(event, values);
      return () => listeners.set(event, (listeners.get(event) || []).filter((item) => item.handler !== handler));
    },
    async emit(event, ...args) { await emitRuntimeEvent(event, ...args); },
    get(name) { return services.get(name) ?? modules.get(name); },
    provide(name, value) { services.set(name, value); return () => { if (services.get(name) === value) services.delete(name); }; },
    async dispose() {
      for (const dispose of disposers.reverse()) await dispose();
      for (const [event, values] of listeners) {
        const remaining = values.filter((item) => item.owner !== owner);
        if (remaining.length === 0) listeners.delete(event);
        else listeners.set(event, remaining);
      }
    },
  };
  return new Proxy(context, { get(target, property, receiver) { if (typeof property === "string" && services.has(property)) return services.get(property); return Reflect.get(target, property, receiver); } });
}

async function emitRuntimeEvent(event, ...args) {
  for (const item of [...(listeners.get(event) || [])]) await item.handler(...args);
}

async function activate(name) {
  if (active.has(name)) return;
  const exported = materialize(name); const module = exported?.default ?? exported;
  if (!module || typeof module.apply !== "function") throw new Error(`DSH client plugin did not register: ${name}`);
  const descriptor = descriptors.get(name) || {}; const declared = Array.isArray(module.inject) ? module.inject : Array.isArray(module.inject?.required) ? module.inject.required : [];
  const required = [...new Set([...(descriptor.services ?? descriptor.inject ?? []), ...declared])]; const missing = required.filter((service) => !services.has(service));
  if (missing.length > 0) { const error = new Error(`Missing DSH client services: ${missing.join(", ")}`); error.missing = missing; throw error; }
  const context = createContext(name);
  try {
    const returned = await captureStyles(appliedStyles, name, () => module.apply(context, undefined));
    if (typeof returned === "function") context.effect(() => returned);
    active.set(name, context);
    window.dispatchEvent(new CustomEvent("seal-harness:plugin-activated", { detail: { name } }));
  } catch (error) {
    await context.dispose();
    throw error;
  }
}

async function dispose(name) {
  const context = active.get(name);
  if (context === undefined) return;
  active.delete(name);
  await context.dispose();
  removeOwnedStyles(appliedStyles, name);
  window.dispatchEvent(new CustomEvent("seal-harness:plugin-disposed", { detail: { name } }));
}

async function load(entries) {
  const results = [];
  const desired = new Map(entries.map((entry) => [entry.name, entry]));
  updateManifest(entries);
  for (const [name, previous] of [...descriptors]) {
    const next = desired.get(name);
    const changed = next !== undefined && descriptorChanged(previous, next);
    if (next === undefined || !next.enabled || changed) await dispose(name);
    if (next === undefined || changed) {
      descriptors.delete(name);
      await invalidateCascade(name);
      removeOwnedStyles(moduleStyles, name);
    }
  }
  for (const entry of entries) descriptors.set(entry.name, entry);
  const loading = new Map();
  const loadEntry = async (entry, chain = []) => {
    if (loading.has(entry.name)) return loading.get(entry.name);
    if (chain.includes(entry.name)) throw new Error(`DSH client dependency cycle: ${[...chain, entry.name].join(" -> ")}`);
    const operation = (async () => {
      for (const request of entry.external ?? []) {
        if (services.has(request) || modules.has(moduleId(request))) continue;
        const target = desired.get(moduleId(request)); if (target) await loadEntry(target, [...chain, entry.name]);
      }
      for (const dependency of entry.dependencies ?? []) {
        const target = desired.get(moduleId(dependency)); if (!target) throw new Error(`Unknown DSH client dependency: ${dependency}`);
        await loadEntry(target, [...chain, entry.name]);
      }
      if (!factories.has(entry.name)) {
        await captureStyles(moduleStyles, entry.name, () => import(moduleUrl(entry)));
        reloadRevisions.delete(entry.name);
      }
      if (entry.enabled) await activate(entry.name); else await dispose(entry.name);
    })(); loading.set(entry.name, operation); return operation;
  };
  for (const entry of entries) {
    const previous = descriptors.get(entry.name);
    try {
      await loadEntry(entry);
      results.push({ name: entry.name, status: entry.enabled ? "active" : "loaded" });
    } catch (error) {
      const missing = error?.missing; results.push(missing ? { name: entry.name, status: "adapter-required", missing } : { name: entry.name, status: "error", error: error instanceof Error ? error.message : String(error) });
    }
  }
  return results;
}

function updateManifest(entries) {
  const ordered = graphOrder(entries); const rev = JSON.stringify([...entries].sort((left, right) => left.name.localeCompare(right.name)).map((entry) => [entry.name, entry.version, entry.url, entry.initialUrl, entry.dependencies ?? [], entry.external ?? [], entry.immediately === true]));
  const rows = ordered.map((entry) => Object.freeze({ id: entry.name, url: entry.url, initialUrl: entry.initialUrl ?? entry.url, rev: entry.version, inject: Object.freeze([...(entry.dependencies ?? [])]), external: Object.freeze([...(entry.external ?? [])]) }));
  moduleManifest = Object.freeze({ rev, modules: Object.freeze(rows), plugins: Object.freeze(ordered.map((entry) => Object.freeze({ id: entry.name, inject: Object.freeze([...(entry.dependencies ?? [])]), immediately: entry.immediately === true }))) });
  const batchEntries = new Map(); for (const entry of ordered) { const url = entry.initialUrl ?? entry.url; const values = batchEntries.get(url) ?? []; values.push(entry.name); batchEntries.set(url, values); }
  window.__DSH_BOOT__ = Object.freeze({ rev, entries: Object.freeze(ordered.map((entry) => Object.freeze({ id: entry.name, url: entry.url, rev: entry.version, inject: Object.freeze([...(entry.dependencies ?? [])]), external: Object.freeze([...(entry.external ?? [])]), immediately: entry.immediately === true }))), batches: Object.freeze([...batchEntries].map(([url, entries]) => Object.freeze({ phase: "application", url, rev, entries: Object.freeze(entries) }))) });
}

function graphOrder(entries) {
  const byName = new Map(entries.map((entry) => [entry.name, entry])); const result = []; const visited = new Set(); const visiting = [];
  const visit = (entry) => { if (visited.has(entry.name)) return; if (visiting.includes(entry.name)) throw new Error(`DSH client dependency cycle: ${[...visiting, entry.name].join(" -> ")}`); visiting.push(entry.name); for (const request of [...(entry.external ?? []), ...(entry.dependencies ?? [])]) { const target = byName.get(moduleId(request)); if (target) visit(target); } visiting.pop(); visited.add(entry.name); result.push(entry); };
  for (const entry of entries) visit(entry); return result;
}

async function invalidateCascade(name, revision) {
  const id = moduleId(name); const affected = new Set([id]); let changed = true;
  while (changed) { changed = false; for (const [candidate, descriptor] of descriptors) { const edges = new Set([...(descriptor.dependencies ?? []).map(moduleId), ...(descriptor.external ?? []).map(moduleId), ...[...(moduleRecords.get(candidate)?.edges ?? [])].map(moduleId)]); if (!affected.has(candidate) && [...edges].some((edge) => affected.has(edge))) { affected.add(candidate); changed = true; } } }
  for (const candidate of [...affected].reverse()) { await dispose(candidate); modules.delete(candidate); factories.delete(candidate); moduleRecords.delete(candidate); reloadEpochs.set(candidate, (reloadEpochs.get(candidate) ?? 0) + 1); if (candidate === id && revision !== undefined) reloadRevisions.set(candidate, revision); removeOwnedStyles(moduleStyles, candidate); }
}

async function captureStyles(registry, owner, callback) {
  const before = new Set(document.querySelectorAll("style, link[rel='stylesheet']"));
  const result = await callback();
  const owned = registry.get(owner) || new Set();
  for (const node of document.querySelectorAll("style, link[rel='stylesheet']")) if (!before.has(node)) owned.add(node);
  registry.set(owner, owned);
  return result;
}

function removeOwnedStyles(registry, owner) {
  for (const node of registry.get(owner) || []) node.remove();
  registry.delete(owner);
}

async function activateSkin(target, skins) {
  for (const skin of skins) {
    if (skin.id === target) await activate(skin.package);
    else await dispose(skin.package);
  }
}

window.SealDshPlugins = {
  load,
  activate,
  dispose,
  activateSkin,
  active: () => [...active.keys()],
  descriptors: () => [...descriptors.values()],
  mountToolView(container, owner) { return slotRuntime.mountToolView(container, owner); },
  unmountToolView(container) { return slotRuntime.unmountToolView(container); },
  themeSnapshot() { return cordisClientRoot.get("theme")?.getTheme?.(); },
  setTheme(preference) { const theme = cordisClientRoot.get("theme"); if (!theme?.setTheme) return false; theme.setTheme(preference); applyThemeSnapshot(theme.getTheme()); return true; },
  startSession(workspaceId) { services.get("uiWorkspace")?.startSession(workspaceId); },
  officialShellReady: () => officialShellState.ready,
  mountOfficialShell(container) { if (!officialShellState.ready || !container) return undefined; return officialShellRoot.get("uiRenderer")?.mount(container); },
  async inputTriggerCandidates(trigger, query, position, quoted = false, drilled = false) {
    const inputTriggers = services.get("inputTriggers"); const sessionId = slotRuntime.uiSession.current.getSnapshot();
    if (!inputTriggers || sessionId === undefined) return [];
    const session = { sessionId, agentId: sessionId, ctx: slotRuntime.uiSession.scope(sessionId) };
    const sources = inputTriggers.entries().filter((source) => source.trigger === trigger);
    const signal = new AbortController().signal; const resolvedPosition = position === "leading" ? "leading" : "inline";
    const groups = await Promise.all(sources.map(async (source) => { source.warm?.(session); const values = await source.candidates?.(session, { query, position: resolvedPosition, quoted, drilled, signal }) ?? []; return values.map((value) => ({ ...value, trigger, source: source.name, ...(position === undefined ? {} : { position: resolvedPosition }) })); }));
    return groups.flat();
  },
  async pickInputTrigger(candidate, action = "pick") {
    const inputTriggers = services.get("inputTriggers"); const sessionId = slotRuntime.uiSession.current.getSnapshot();
    if (!inputTriggers || sessionId === undefined || typeof candidate?.source !== "string") return undefined;
    const source = inputTriggers.entries().find((entry) => entry.name === candidate.source && entry.trigger === candidate.trigger);
    if (!source?.onPick) return undefined;
    const session = { sessionId, agentId: sessionId, ctx: slotRuntime.uiSession.scope(sessionId) };
    const { source: _source, trigger: _trigger, position, ...value } = candidate;
    return source.onPick({ candidate: value, session, position: position === "leading" ? "leading" : "inline", via: "menu", action, span: { start: 0, end: 0, draftRev: 0 } });
  },
  provide(name, value) {
    if (typeof name !== "string" || !name || value === undefined) throw new TypeError("Invalid DSH client service");
    services.set(name, value);
    void load([...descriptors.values()]);
    return () => { if (services.get(name) === value) { services.delete(name); void load([...descriptors.values()]); } };
  },
};

services.set("locale", createLocaleAdapter());
const slotRuntime = createSlotsRuntime();
services.set("slots", slotRuntime.slots);
services.set("uiSession", slotRuntime.uiSession);
services.set("inputTriggers", createInputTriggersAdapter());
services.set("settingsScope", createSettingsScopeAdapter());
services.set("typert", createTypertAdapter());
const remoteMux = createRemoteStreamMux(dshRemoteError);
const connection = createConnectionAdapter(remoteMux);
services.set("connection", connection);
const remote = createRemoteAdapter(remoteMux);
services.set("remote", remote);
services.set("remote.commands", remote.commands);
services.set("remote.agentPresets", remote.agentPresets);
services.set("remote.goals", remote.goals);
services.set("remote.messageFeedback", remote.messageFeedback);
services.set("remote.subagents", remote.subagents);
services.set("remote.sessionReferenceResolver", remote.sessionReferenceResolver);
services.set("remote.fileReferences", remote.fileReferences);
services.set("remote.workspace", remote.workspace);
services.set("remote.llm", remote.llm);
services.set("remote.credentials", remote.credentials);
services.set("remote.skills", remote.skills);
services.set("remote.directoryPicker", remote.directoryPicker);
services.set("remote.dynamicCordisRunner", remote.dynamicCordisRunner);
services.set("remote.pluginInventory", remote.pluginInventory);
services.set("remote.session", remote.session);
services.set("remote.settings", remote.settings);
const clientDomain = createClientDomainAdapters();
services.set("sessions", clientDomain.sessions);
services.set("workspaces", clientDomain.workspaces);
services.set("uiWorkspace", clientDomain.uiWorkspace);
const officialShellState = { ready: false };
const modulesService = Object.freeze({
  version: "client",
  get manifest() { return moduleManifest; },
  loadCache: moduleRecords,
  async import(specifier) {
    if (!modules.has(specifier)) await this.prefetch(specifier);
    return requireModule(specifier);
  },
  async prefetch(specifier) {
    if (modules.has(specifier)) return;
    const entry = descriptors.get(specifier);
    if (!entry) throw new Error(`Unknown DSH client module: ${specifier}`);
    await import(moduleUrl(entry));
  },
  async invalidate(specifier, revision) {
    await invalidateCascade(specifier, revision);
  },
});
services.set("modules", modulesService);
services.set("loader", Object.freeze({
  async create(input) {
    if (!input || typeof input.name !== "string" || input.name.length === 0) throw new TypeError("loader.create requires a module name");
    const name = moduleId(input.name); const id = `dynamic:${name}`;
    if (dynamicLoaderEntries.has(id)) throw new Error(`Dynamic loader entry already exists: ${name}`);
    const descriptor = { name, version: `dynamic-${Date.now()}`, url: `dynamic:${name}`, dependencies: [], external: [], services: [], enabled: true };
    descriptors.set(name, descriptor);
    let exported; try { exported = materialize(name); } catch (error) { descriptors.delete(name); throw error; }
    const plugin = exported?.default ?? exported; const declared = Array.isArray(plugin?.inject) ? plugin.inject : Array.isArray(plugin?.inject?.required) ? plugin.inject.required : [];
    const missing = [...new Set(declared)].filter((service) => !services.has(service));
    let fiber; let cordisFiber = false;
    if (name.startsWith("dyn/")) {
      provideCordisClientServices();
      fiber = cordisClientRoot.plugin(plugin); cordisFiber = true;
    } else fiber = { inject: Object.fromEntries(missing.map((name) => [name, true])), async await() { if (missing.length === 0) await activate(name); }, dispose: () => dispose(name) };
    dynamicLoaderEntries.set(id, { id, name, fiber });
    if (cordisFiber) await fiber; else await fiber.await(); return id;
  },
  resolve(id) { const entry = dynamicLoaderEntries.get(id); if (!entry) throw new Error(`Unknown dynamic loader entry: ${id}`); return entry; },
  async remove(id) { const entry = dynamicLoaderEntries.get(id); if (!entry) return; dynamicLoaderEntries.delete(id); if (typeof entry.fiber.dispose === "function") await entry.fiber.dispose(); else await dispose(entry.name); descriptors.delete(entry.name); },
}));
void bootstrapCordisClient();

async function bootstrapCordisClient() {
  try {
    provideCordisClientServices();
    let dynamicCordisRunner = false;
    try {
      const response = await fetch("/api/dsh/capabilities", { credentials: "same-origin" });
      dynamicCordisRunner = response.ok && (await response.json()).dynamicCordisRunner === true;
    } catch (error) { console.warn("Cordis Host capabilities are unavailable; continuing without the Dynamic Client Runner", error); }
    const officialShellRequested = typeof document.getElementById === "function" && globalThis.location?.hash === "#dsh-shell";
    if (dynamicCordisRunner && !officialShellRequested) {
      await import("@deepseek-ai/dsh-cordis-client-runner/client");
      const name = "@deepseek-ai/dsh-cordis-client-runner"; const exported = materialize(name); const plugin = exported?.default ?? exported;
      const fiber = cordisClientRoot.plugin(plugin); await fiber;
      active.set(name, { dispose: fiber.dispose });
    }
    if (typeof document.getElementById !== "function") return;
    const primitives = await import("@deepseek-ai/dsh-client-ui-primitives");
    modules.set("@deepseek-ai/dsh-client-ui-primitives", primitives);
    await import("@deepseek-ai/dsh-client-ui-theme/client");
    const themeName = "@deepseek-ai/dsh-client-ui-theme"; const themeExported = materialize(themeName); const themePlugin = themeExported?.default ?? themeExported;
    const stopTheme = cordisClientRoot.on("theme/change", applyThemeSnapshot);
    const themeFiber = cordisClientRoot.plugin(themePlugin); await themeFiber;
    applyThemeSnapshot(cordisClientRoot.get("theme").getTheme());
    active.set(themeName, { dispose: async () => { if (typeof stopTheme === "function") stopTheme(); await themeFiber.dispose(); } });
    await import("@deepseek-ai/dsh-client-ui-cordis/client");
    if (dynamicCordisRunner && !officialShellRequested) {
      const uiName = "@deepseek-ai/dsh-client-ui-cordis"; const uiExported = materialize(uiName); const uiPlugin = uiExported?.default ?? uiExported;
      const uiFiber = cordisClientRoot.plugin(uiPlugin); await uiFiber;
      active.set(uiName, { dispose: uiFiber.dispose });
    }
    if (officialShellRequested) await bootstrapOfficialShell({ dynamicCordisRunner });
    else if (typeof document.querySelector === "function") {
      const header = document.querySelector(".header-actions");
      if (header && !document.getElementById("seal-team-root")) {
        const host = document.createElement("span"); host.id = "seal-team-root"; header.prepend(host);
        installAgentTeamUi(undefined, services.get("remote"), host);
      }
    }
  } catch (error) {
    if (document.documentElement?.dataset.dshOfficialShell === "loading") {
      document.documentElement.dataset.dshOfficialShell = "error";
      document.documentElement.dataset.dshOfficialShellError = error instanceof Error ? error.message : String(error);
    }
    console.error("Cordis Client UI failed to start", error);
  }
}

async function bootstrapOfficialShell({ dynamicCordisRunner = false } = {}) {
  document.documentElement.dataset.dshOfficialShell = "loading";
  for (const [name, value] of services) if (!["slots", "uiSession", "sessions", "workspaces", "uiWorkspace", "settingsScope", "inputTriggers"].includes(name)) officialShellRoot.provide(name, value);
  officialShellRoot.provide("theme", cordisClientRoot.get("theme"));
  await import("@deepseek-ai/dsh-api-gateway/client");
  await import("@deepseek-ai/dsh-api-session-controller/client");
  await import("@deepseek-ai/dsh-api-workspace-controller/client");
  await import("@deepseek-ai/dsh-client-ui-renderer/client");
  await import("@deepseek-ai/dsh-client-ui-settings/client");
  await import("@deepseek-ai/dsh-client-ui-settings-general/client");
  await import("@deepseek-ai/dsh-client-ui-settings-models/client");
  await import("@deepseek-ai/dsh-client-ui-settings-plugins/client");
  await import("@deepseek-ai/dsh-client-ui-settings-plugin-inventory/client");
  await import("@deepseek-ai/dsh-client-ui-session/client");
  await import("@deepseek-ai/dsh-client-ui-layout/client");
  await import("@deepseek-ai/dsh-client-ui-sidebar/client");
  await import("@deepseek-ai/dsh-client-ui-workspace/client");
  await import("@deepseek-ai/dsh-client-ui-directory-picker-browse/client");
  await import("@deepseek-ai/dsh-client-ui-input-trigger/client");
  await import("@deepseek-ai/dsh-client-ui-commands/client");
  await import("@deepseek-ai/dsh-client-ui-skill/client");
  await import("@deepseek-ai/dsh-client-ui-reference/client");
  await import("@deepseek-ai/dsh-client-ui-subagent/client");
  await import("@deepseek-ai/dsh-client-ui-model-selection/client");
  await import("@deepseek-ai/dsh-client-ui-permission-presets/client");
  await import("@deepseek-ai/dsh-client-ui-plan/client");
  await import("@deepseek-ai/dsh-client-ui-goal/client");
  await import("@deepseek-ai/dsh-client-ui-jobs/client");
  await import("@deepseek-ai/dsh-client-ui-message-feedback/client");
  await import("@deepseek-ai/dsh-client-ui-schedule/client");
  await import("@deepseek-ai/dsh-client-ui-agent-preset/client");
  await import("@deepseek-ai/dsh-client-ui-workflow-run/client");
  await import("@deepseek-ai/dsh-client-ui-conversation/client");
  await import("@deepseek-ai/dsh-client-ui-approval/client");
  await import("@deepseek-ai/dsh-client-ui-user-questions/client");
  await import("@deepseek-ai/dsh-client-ui-chat/client");
  await import("@deepseek-ai/dsh-client-ui-brand-official/client");
  await import("@deepseek-ai/dsh-client-ui-attachment/client");
  await import("@deepseek-ai/dsh-client-ui-tool/client");
  await import("@deepseek-ai/dsh-client-ui-deliverables/client");
  await import("@deepseek-ai/dsh-client-ui-trajectory/client");
  const activateFactory = async (name) => { const exported = materialize(name); const fiber = officialShellRoot.plugin(exported?.default ?? exported, {}); await fiber; active.set(`${name}:official-shell`, { dispose: fiber.dispose }); return fiber; };
  await activateFactory("@deepseek-ai/dsh-client-ui-renderer");
  if (dynamicCordisRunner) {
    await import("@deepseek-ai/dsh-cordis-client-runner/client");
    await activateFactory("@deepseek-ai/dsh-cordis-client-runner");
  }
  await activateFactory("@deepseek-ai/dsh-client-ui-settings");
  const slots = officialShellRoot.get("slots"); const locale = services.get("locale");
  slots.installLocale(locale);
  let observedGeneration = connection.generation.getSnapshot()?.id;
  const stopConnectionBridge = connection.generation.subscribe(() => {
    const generation = connection.generation.getSnapshot()?.id;
    if (generation === undefined || generation === observedGeneration) return;
    observedGeneration = generation;
    void officialShellRoot.emit("connection/reset");
  });
  active.set("connection:official-shell", { dispose: stopConnectionBridge });
  await activateFactory("@deepseek-ai/dsh-api-session-controller");
  await activateFactory("@deepseek-ai/dsh-api-workspace-controller");
  await activateFactory("@deepseek-ai/dsh-client-ui-session");
  await activateFactory("@deepseek-ai/dsh-client-ui-workspace");
  await activateFactory("@deepseek-ai/dsh-client-ui-directory-picker-browse");
  await activateFactory("@deepseek-ai/dsh-client-ui-input-trigger");
  await activateFactory("@deepseek-ai/dsh-client-ui-layout");
  await activateFactory("@deepseek-ai/dsh-client-ui-sidebar");
  await activateFactory("@deepseek-ai/dsh-client-ui-settings-general");
  await activateFactory("@deepseek-ai/dsh-client-ui-settings-models");
  await activateFactory("@deepseek-ai/dsh-client-ui-settings-plugins");
  await activateFactory("@deepseek-ai/dsh-client-ui-settings-plugin-inventory");
  await activateFactory("@deepseek-ai/dsh-client-ui-conversation");
  const disposeTeamUi = installAgentTeamUi(slots, officialShellRoot.get("remote"));
  active.set("@seal-harness/agent-team-ui:official-shell", { dispose: disposeTeamUi });
  await activateFactory("@deepseek-ai/dsh-client-ui-approval");
  await activateFactory("@deepseek-ai/dsh-client-ui-user-questions");
  await activateFactory("@deepseek-ai/dsh-client-ui-chat");
  await activateFactory("@deepseek-ai/dsh-client-ui-commands");
  await activateFactory("@deepseek-ai/dsh-client-ui-skill");
  await activateFactory("@deepseek-ai/dsh-client-ui-reference");
  await activateFactory("@deepseek-ai/dsh-client-ui-subagent");
  if (dynamicCordisRunner) {
    await import("@deepseek-ai/dsh-client-ui-cordis/client");
    await activateFactory("@deepseek-ai/dsh-client-ui-cordis");
  }
  await activateFactory("@deepseek-ai/dsh-client-ui-model-selection");
  await activateFactory("@deepseek-ai/dsh-client-ui-permission-presets");
  await activateFactory("@deepseek-ai/dsh-client-ui-plan");
  await activateFactory("@deepseek-ai/dsh-client-ui-goal");
  await activateFactory("@deepseek-ai/dsh-client-ui-jobs");
  await activateFactory("@deepseek-ai/dsh-client-ui-message-feedback");
  await activateFactory("@deepseek-ai/dsh-client-ui-schedule");
  await activateFactory("@deepseek-ai/dsh-client-ui-agent-preset");
  await activateFactory("@deepseek-ai/dsh-client-ui-workflow-run");
  await activateFactory("@deepseek-ai/dsh-client-ui-brand-official");
  await activateFactory("@deepseek-ai/dsh-client-ui-attachment");
  await activateFactory("@deepseek-ai/dsh-client-ui-tool");
  await activateFactory("@deepseek-ai/dsh-client-ui-deliverables");
  await activateFactory("@deepseek-ai/dsh-client-ui-trajectory");
  officialShellState.ready = true;
  document.documentElement.dataset.dshOfficialShell = "ready";
  window.dispatchEvent(new CustomEvent("seal-harness:official-shell-ready"));
}

function installAgentTeamUi(slots, remote, host) {
  const emptyDraft = () => ({ subject: "", description: "", blockers: "", scopes: "" });
  const csv = value => [...new Set(value.split(",").map(item => item.trim()).filter(Boolean))];
  function TaskForm({ draft, setDraft, busy, save, cancel }) { const field = key => event => setDraft({ ...draft, [key]: event.target.value }); return React.createElement("form", { className: "seal-team-form", onSubmit: event => { event.preventDefault(); void save(); } }, React.createElement("input", { value: draft.subject, placeholder: "Subject", onChange: field("subject") }), React.createElement("textarea", { value: draft.description, placeholder: "Description", onChange: field("description") }), React.createElement("input", { value: draft.blockers, placeholder: "Blocked by: task-1, task-2", onChange: field("blockers") }), React.createElement("input", { value: draft.scopes, placeholder: "Write scopes: src/a, test/a", onChange: field("scopes") }), React.createElement("div", null, React.createElement("button", { disabled: busy || !draft.subject.trim() || !draft.description.trim() }, "Save"), React.createElement("button", { type: "button", disabled: busy, onClick: cancel }, "Cancel"))); }
  function TeamAction({ sessionId }) {
    const [open, setOpen] = React.useState(false); const [view, setView] = React.useState(null); const [error, setError] = React.useState(""); const [busy, setBusy] = React.useState(false); const [creating, setCreating] = React.useState(false); const [createDraft, setCreateDraft] = React.useState(emptyDraft); const [editing, setEditing] = React.useState(null); const [editDraft, setEditDraft] = React.useState(emptyDraft);
    React.useEffect(() => { setOpen(false); setView(null); setError(""); setCreating(false); setCreateDraft(emptyDraft()); setEditing(null); setEditDraft(emptyDraft()); }, [sessionId]);
    const refresh = React.useCallback(async () => { setBusy(true); const result = await remote.agentTeams.view(sessionId); setBusy(false); if (result.ok) { setView(result.value); setError(""); } else setError(`${result.error.message} (${result.error.code})`); }, [sessionId]);
    const mutate = async (operation, request) => { setBusy(true); const result = await remote.agentTeams[operation](sessionId, request); setBusy(false); if (!result.ok) { setError(`${result.error.message} (${result.error.code})`); return undefined; } setError(""); await refresh(); return result.value; };
    const update = (task, action, extra = {}) => mutate("updateTask", { taskId: task.id, expectedRevision: task.revision, action, ...extra });
    const memberRows = view?.members.map(member => React.createElement("div", { key: member.id, className: "seal-team-member" }, React.createElement("span", { className: `seal-team-dot is-${member.status}` }), React.createElement("span", null, React.createElement("strong", null, member.name), React.createElement("small", null, `${member.role} · ${member.status}${member.model ? ` · ${member.model.provider}/${member.model.model}` : ""}`)))) ?? [];
    const taskRows = view?.tasks.map(task => editing === task.id ? React.createElement(TaskForm, { key: task.id, draft: editDraft, setDraft: setEditDraft, busy, cancel: () => setEditing(null), save: async () => { const edited = await mutate("updateTask", { taskId: task.id, expectedRevision: task.revision, action: "edit", subject: editDraft.subject, description: editDraft.description, writeScopes: csv(editDraft.scopes) }); if (!edited) return; const blockers = csv(editDraft.blockers); if (JSON.stringify(blockers) !== JSON.stringify(edited.blockedBy)) { const dependency = await mutate("updateTask", { taskId: task.id, expectedRevision: edited.revision, action: "set_dependencies", blockedBy: blockers }); if (!dependency) return; } setEditing(null); } }) : React.createElement("article", { key: task.id, className: "seal-team-task" },
      React.createElement("div", null, React.createElement("strong", null, task.subject), React.createElement("span", null, task.status)), React.createElement("p", null, task.description), React.createElement("small", null, `${task.id} · rev ${task.revision}${task.ownerName ? ` · ${task.ownerName}` : ""}${task.ready ? " · ready" : ""}`),
      task.blockedBy.length > 0 && React.createElement("small", null, `Blocked by: ${task.blockedBy.join(", ")}`), task.writeScopes.length > 0 && React.createElement("small", null, `Writes: ${task.writeScopes.join(", ")}`), ...task.writeScopeWarnings.map(warning => React.createElement("small", { key: warning, className: "seal-team-warning" }, warning)),
      React.createElement("div", { className: "seal-team-task-actions" }, React.createElement("label", null, "Owner ", React.createElement("select", { value: task.ownerName ?? "", disabled: busy || task.status === "completed", onChange: event => void update(task, "reassign", { owner: event.target.value }) }, React.createElement("option", { value: "" }, "Unowned"), ...view.members.filter(member => member.status !== "failed" && member.status !== "provisioning").map(member => React.createElement("option", { key: member.id, value: member.name }, member.name)))), React.createElement("button", { disabled: busy, onClick: () => { setEditing(task.id); setEditDraft({ subject: task.subject, description: task.description, blockers: task.blockedBy.join(", "), scopes: task.writeScopes.join(", ") }); } }, "Edit"), task.status === "pending" && React.createElement("button", { disabled: busy || !task.ready, onClick: () => void update(task, "claim") }, "Claim"), task.status === "in_progress" && React.createElement("button", { disabled: busy, onClick: () => void update(task, "complete") }, "Complete"), task.status === "completed" && React.createElement("button", { disabled: busy, onClick: () => void update(task, "reopen") }, "Reopen"), React.createElement("button", { disabled: busy, onClick: () => void update(task, "delete") }, "Delete")))) ?? [];
    const createForm = creating && React.createElement(TaskForm, { draft: createDraft, setDraft: setCreateDraft, busy, cancel: () => setCreating(false), save: async () => { if (await mutate("createTask", { subject: createDraft.subject, description: createDraft.description, blockedBy: csv(createDraft.blockers), writeScopes: csv(createDraft.scopes) })) { setCreateDraft(emptyDraft()); setCreating(false); } } });
    const body = view && React.createElement(React.Fragment, null, React.createElement("section", null, React.createElement("h3", null, "Members"), React.createElement("div", { className: "seal-team-members" }, ...memberRows)), React.createElement("section", null, React.createElement("div", { className: "seal-team-section-title" }, React.createElement("h3", null, "Tasks"), React.createElement("button", { type: "button", onClick: () => setCreating(true) }, "+ Add")), createForm, view.tasks.length === 0 && !creating && React.createElement("p", null, "No shared tasks"), React.createElement("div", { className: "seal-team-tasks" }, ...taskRows)));
    const panel = open && React.createElement("div", { className: "seal-team-panel", role: "dialog", "aria-label": "Agent Team" }, React.createElement("header", null, React.createElement("strong", null, "Agent Team"), React.createElement("button", { type: "button", disabled: busy, onClick: () => void refresh(), "aria-label": "Refresh Team" }, "↻"), React.createElement("button", { type: "button", onClick: () => setOpen(false), "aria-label": "Close Team" }, "×")), error && React.createElement("div", { className: "seal-team-error", role: "alert" }, error), busy && !view && React.createElement("p", null, "Loading…"), body);
    return React.createElement("div", { className: "seal-team-action" }, React.createElement("button", { type: "button", className: "seal-team-trigger", "aria-expanded": open, onClick: () => { const next = !open; setOpen(next); if (next) void refresh(); } }, `Team${view?.members?.length > 1 ? ` ${view.members.length - 1}` : ""}`), panel);
  }
  if (host) {
    function CurrentTeam() {
      const current = slotRuntime.uiSession.current;
      const sessionId = React.useSyncExternalStore(current.subscribe, current.getSnapshot);
      return sessionId ? React.createElement(TeamAction, { key: sessionId, sessionId }) : null;
    }
    const root = createReactRoot(host); root.render(React.createElement(CurrentTeam));
    return () => root.unmount();
  }
  return slots.inject("conversation.session.header.actions", () => slots.register({ name: "conversation.session.header.actions", id: "agent-team", order: 20 }, TeamAction));
}

function createTypertAdapter() {
  const clients = new Map();
  return Object.freeze({ contexts: Object.freeze({
    registerClient(name, descriptor) {
      if (typeof name !== "string" || !descriptor || typeof descriptor.identity !== "function" || typeof descriptor.resolve !== "function") throw new TypeError("invalid Typert Client context");
      clients.set(name, descriptor);
      return () => { if (clients.get(name) === descriptor) clients.delete(name); };
    },
  }) });
}

function provideCordisClientServices() {
  for (const [name, value] of services) if (!cordisProvided.has(name)) { cordisClientRoot.provide(name, value); cordisProvided.add(name); }
}

function createInputTriggersAdapter() {
  const sources = new Set(); const listeners = new Set(); let version = 0;
  const changed = () => { version += 1; for (const listener of [...listeners]) listener(); };
  return Object.freeze({
    registerSource(source) { if (!source || typeof source !== "object") throw new TypeError("invalid input trigger source"); sources.add(source); changed(); return () => { if (sources.delete(source)) changed(); }; },
    entries() { return Object.freeze([...sources]); },
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    getSnapshot() { return version; },
  });
}

function createSettingsScopeAdapter() {
  const scopes = new Map();
  return Object.freeze({ bind({ namespace }) {
    let scope = scopes.get(namespace); if (scope) return scope;
    let value = namespace === "ui-theme" ? { preference: "system", fontSize: 14 } : undefined; let revision = 0; let writable = false; const listeners = new Set();
    const publish = () => { for (const listener of [...listeners]) listener(); };
    const refresh = async () => {
      try {
        const response = await fetch("/api/settings", { credentials: "same-origin" }); if (!response.ok) return;
        const body = await response.json(); const descriptor = body.namespaces?.find((entry) => entry.namespace === namespace); if (!descriptor || descriptor.revision < revision) return;
        value = descriptor.value; revision = descriptor.revision; writable = body.writable === true; publish();
      } catch { /* the last accepted snapshot remains active while disconnected */ }
    };
    scope = Object.freeze({
      getSnapshot: () => Object.freeze({ value, revision, writable }),
      subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
      async set(key, next) {
        const candidate = { ...(value ?? {}), [key]: next };
        if (writable) {
          const response = await fetch(`/api/settings/${encodeURIComponent(namespace)}`, { method: "PUT", credentials: "same-origin", headers: { "content-type": "application/json" }, body: JSON.stringify({ value: candidate, expectedRevision: revision }) });
          if (!response.ok) throw new Error((await response.json().catch(() => null))?.error ?? `HTTP ${response.status}`);
          const descriptor = await response.json(); value = descriptor.value; revision = descriptor.revision; writable = true;
        } else { value = candidate; revision += 1; }
        publish(); return Object.freeze({ value, revision, writable });
      },
    });
    scopes.set(namespace, scope);
    window.addEventListener("seal-harness:settings-updated", (event) => { if (event.detail?.namespace === namespace) void refresh(); });
    queueMicrotask(refresh);
    return scope;
  } });
}

let appliedThemeTokens = [];
function applyThemeSnapshot(snapshot) {
  if (!snapshot?.active || typeof document === "undefined") return;
  const dark = snapshot.active.colorScheme === "dark"; document.documentElement.style.colorScheme = dark ? "dark" : "light";
  document.body?.toggleAttribute("data-ds-dark-theme", dark); document.body?.style.setProperty("--dsh-content-font-size", `${snapshot.fontSize}px`);
  for (const name of appliedThemeTokens) document.body?.style.removeProperty(name);
  appliedThemeTokens = Object.keys(snapshot.active.tokens ?? {});
  for (const [name, value] of Object.entries(snapshot.active.tokens ?? {})) document.body?.style.setProperty(name, value);
  window.dispatchEvent(new CustomEvent("seal-harness:theme-change", { detail: { preference: snapshot.preference, active: snapshot.active.id, fontSize: snapshot.fontSize } }));
}

function createConnectionAdapter(mux) {
  const channelPattern = /^\/[A-Za-z0-9._~-]+$/; const segmentPattern = /^[A-Za-z0-9_$.-]+$/;
  const assertTarget = (channel, endpoint) => {
    if (!channelPattern.test(channel) || endpoint.split("/").some((part) => !part || part === "." || part === ".." || !segmentPattern.test(part))) throw new Error(`connection: invalid RPC target ${JSON.stringify(`${channel}/${endpoint}`)}`);
  };
  const rpc = Object.freeze({
    async call(channel, endpoint, payload, signal) {
      assertTarget(channel, endpoint);
      const rpcId = globalThis.crypto?.randomUUID?.() ?? `seal-${Date.now()}-${Math.random().toString(16).slice(2)}`;
      const response = await fetch(`${channel}/${endpoint}`, { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" }, body: JSON.stringify({ type: "client-request", rpcId, method: endpoint, payload }), ...(signal === undefined ? {} : { signal }) });
      if (!response.ok) throw new Error(`transport failure for ${channel}/${endpoint}: HTTP ${response.status}`);
      const envelope = await response.json();
      if (!envelope || envelope.type !== "server-response" || typeof envelope.rpcId !== "string" || !envelope.result || typeof envelope.result !== "object") throw new TypeError("connection: invalid server-response envelope");
      if (envelope.rpcId !== rpcId) throw new Error(`rpcId mismatch for ${endpoint}: sent ${rpcId}, got ${envelope.rpcId}`);
      if (envelope.result.ok === true) return { ok: true, value: envelope.result.value };
      const error = envelope.result.error;
      if (envelope.result.ok !== false || !error || typeof error.code !== "string" || typeof error.message !== "string" || !error.details || typeof error.details !== "object" || Array.isArray(error.details)) throw new TypeError("connection: invalid server-response result");
      return { ok: false, error: { code: error.code, message: error.message, details: error.details } };
    },
  });
  const generationListeners = new Set(); const stateListeners = new Set(); let generation; let state; let source; let running; let revision = 0;
  const publish = (target, value) => {
    if (target === "generation") generation = value; else state = value;
    for (const listener of [...(target === "generation" ? generationListeners : stateListeners)]) listener();
    if (target === "generation" && value !== undefined) void emitRuntimeEvent("connection/reset");
  };
  const run = () => {
    if (!source || running) return;
    const lifetime = new AbortController();
    running = { lifetime, task: (async () => {
      let delay = 100;
      while (!lifetime.signal.aborted) {
        publish("state", "connecting"); const attempt = new AbortController(); const signal = AbortSignal.any([lifetime.signal, attempt.signal]); let ready = false;
        try {
          await source(signal, (host) => { if (ready) return; ready = true; revision += 1; publish("generation", Object.freeze({ id: revision, host })); publish("state", "connected"); });
          if (lifetime.signal.aborted) break;
        } catch (error) { if (lifetime.signal.aborted) break; }
        publish("generation", undefined); publish("state", "disconnected");
        await new Promise((resolve) => { const timer = setTimeout(resolve, delay); lifetime.signal.addEventListener("abort", () => { clearTimeout(timer); resolve(); }, { once: true }); }); delay = Math.min(delay * 2, 5_000);
      }
    })().finally(() => { if (running?.lifetime === lifetime) running = undefined; }) };
  };
  return Object.freeze({
    rpc,
    generation: Object.freeze({ getSnapshot: () => generation, subscribe(listener) { generationListeners.add(listener); return () => generationListeners.delete(listener); } }),
    state: Object.freeze({ getSnapshot: () => state, subscribe(listener) { stateListeners.add(listener); return () => stateListeners.delete(listener); } }),
    isLoopback: ["localhost", "127.0.0.1", "::1", "[::1]"].includes(globalThis.location?.hostname),
    registerGenerationSource(next) {
      if (source) throw new Error("connection: generation source is already registered"); source = next; run();
      return () => { if (source !== next) return; source = undefined; running?.lifetime.abort(new Error("connection generation source removed")); publish("generation", undefined); publish("state", "disconnected"); };
    },
    reconnect() { mux.reconnect(); running?.lifetime.abort(new Error("connection reconnect requested")); running = undefined; if (source) run(); },
  });
}

function dshRemoteError(code, message, details = {}) {
  return Object.assign(new Error(message), { name: "RemoteError", isDSHRemoteError: true, code, details });
}

function dshWorkspaceView(row) {
  return Object.freeze({ workspaceId: row.workspaceId ?? row.id, path: row.path, title: row.title, sessionIds: Object.freeze([...(row.sessionIds ?? [])]), createdAt: row.createdAt, updatedAt: row.updatedAt });
}

function createRemoteAdapter(mux) {
  const remoteError = dshRemoteError;
  const call = async (path, options = {}) => {
    try {
      const response = await fetch(path, {
        credentials: "same-origin",
        ...options,
        headers: { "content-type": "application/json", ...(options.headers || {}) },
      });
      const payload = response.status === 204 ? undefined : await response.json().catch(() => undefined);
      if (response.ok) return { ok: true, value: payload };
      const message = typeof payload?.error === "string" ? payload.error : `Remote request failed with HTTP ${response.status}`;
      if (response.status === 409 && payload?.code === "SETTINGS_CONFLICT") {
        const ns = decodeURIComponent(path.split("/").pop() || "");
        return { ok: false, error: remoteError("settings/conflict", message, { ns, expected: payload.expected, actual: payload.actual }) };
      }
      if (typeof payload?.code === "string" && payload.code.includes("/")) {
        return { ok: false, error: remoteError(payload.code, message, payload.details && typeof payload.details === "object" ? payload.details : {}) };
      }
      const code = response.status === 400 ? "gateway/bad-request" : "gateway/internal";
      return { ok: false, error: remoteError(code, message, {}) };
    } catch (error) {
      const cancelled = options.signal?.aborted || error?.name === "AbortError";
      return { ok: false, error: remoteError(cancelled ? "gateway/cancelled" : "gateway/internal", cancelled ? "Remote request was cancelled" : (error instanceof Error ? error.message : String(error)), {}) };
    }
  };
  const officialWorkspace = (operation, request, signal) => call("/api/dsh/workspace", { method: "POST", body: JSON.stringify({ operation, ...request }), signal });
  const officialGoal = (operation, sessionId, ref, request) => call("/api/dsh/goals", { method: "POST", body: JSON.stringify({ operation, sessionId, ...(ref === undefined ? {} : { ref }), ...(request === undefined ? {} : { request }) }) });
  const officialSessionRead = (operation, signal, request) => call("/api/dsh/session/read", { method: "POST", body: JSON.stringify({ operation, ...(request === undefined ? {} : { request }) }), signal });
  const officialSessionWrite = (operation, request, signal) => call("/api/dsh/session/write", { method: "POST", body: JSON.stringify({ operation, request }), signal });
  const eventSubscribers = new Map();
  connection.registerGenerationSource(async (signal, ready) => {
    let clientId; const activeEvents = new Map();
    try { for await (const frame of mux.open("$events", { args: {} }, signal)) {
      if (clientId === undefined) {
        if (!frame || frame.type !== "ready" || typeof frame.clientId !== "string" || typeof frame.host?.home !== "string") throw new TypeError("Remote Event generation did not open with ready");
        clientId = frame.clientId; ready(Object.freeze({ home: frame.host.home })); continue;
      }
      if (!frame || typeof frame.type !== "string") continue;
      if (frame.type === "cancel" && typeof frame.eventId === "string") { activeEvents.get(frame.eventId)?.abort(new Error("Remote Event cancelled by Host")); continue; }
      if (frame.type === "emit" && typeof frame.event === "string" && Array.isArray(frame.args)) {
        for (const entry of [...(eventSubscribers.get(frame.event) ?? [])]) Promise.resolve().then(() => entry.listener(...frame.args)).catch((error) => console.error("Remote event listener failed", error));
        continue;
      }
      if (frame.type === "waterfall" && typeof frame.event === "string" && typeof frame.eventId === "string" && typeof frame.agentId === "string" && frame.request && typeof frame.request === "object") {
        const abort = new AbortController(); activeEvents.set(frame.eventId, abort); const deliverySignal = AbortSignal.any([signal, abort.signal]);
        void answerRemoteWaterfall(frame, clientId, eventSubscribers, deliverySignal, connection.rpc).catch((error) => { if (!deliverySignal.aborted) console.error("Remote waterfall result failed", error); }).finally(() => activeEvents.delete(frame.eventId));
      }
    } } finally { for (const abort of activeEvents.values()) abort.abort(new Error("Remote Event generation ended")); }
  });
  const writeSettings = (mode, ns, value, expectedRevision) => call(`/api/dsh/settings/${encodeURIComponent(ns)}`, {
    method: "PUT",
    body: JSON.stringify({ mode, [mode === "mutate" ? "ops" : mode === "replace" ? "value" : "value"]: value, expectedRevision }),
  });
  return Object.freeze({
    get $host() { return Object.freeze({ home: connection.generation.getSnapshot()?.host.home, isLoopback: connection.isLoopback }); },
    $stream(options) { return new (requireModule("@deepseek-ai/dsh-api-gateway").RemoteStream)(connection, options); },
    $on(contextOrEvent, eventOrListener, maybeListener) {
      const context = maybeListener === undefined ? undefined : contextOrEvent;
      const event = maybeListener === undefined ? contextOrEvent : eventOrListener;
      const listener = maybeListener === undefined ? eventOrListener : maybeListener;
      const values = eventSubscribers.get(event) ?? new Set(); const entry = { context, listener }; values.add(entry); eventSubscribers.set(event, values); return () => { values.delete(entry); if (values.size === 0) eventSubscribers.delete(event); };
    },
    commands: Object.freeze({
      async list(sessionId, signal) { return call(`/api/dsh/commands?sessionId=${encodeURIComponent(sessionId)}`, { signal }); },
      async execute(sessionId, line, images = [], signal) {
        return call(`/api/sessions/${encodeURIComponent(sessionId)}/commands`, { method: "POST", body: JSON.stringify({ line, images }), signal });
      },
    }),
    agentPresets: Object.freeze({
      async list(signal) {
        return call("/api/dsh/agent-presets", { signal });
      },
      async read(agentPreset, signal) { return call("/api/dsh/agent-presets", { method: "POST", body: JSON.stringify({ operation: "read", agentPreset }), signal }); },
      async copy(from, id, name, signal) { return call("/api/dsh/agent-presets", { method: "POST", body: JSON.stringify({ operation: "copy", from, id, ...(name === undefined ? {} : { name }) }), signal }); },
      async deletePreset(id, signal) { return call("/api/dsh/agent-presets", { method: "POST", body: JSON.stringify({ operation: "delete", id }), signal }); },
      async select(sessionId, agentPreset) { return call(`/api/sessions/${encodeURIComponent(sessionId)}/agent-preset`, { method: "PUT", body: JSON.stringify({ agentPreset }) }); },
    }),
    goals: Object.freeze({
      async create(sessionId, request) { const delegated = await officialGoal("create", sessionId, undefined, request); return delegated.ok && !delegated.value.available ? call(`/api/sessions/${encodeURIComponent(sessionId)}/goal`, { method: "POST", body: JSON.stringify(request) }) : delegated.ok ? { ok: true, value: delegated.value.value } : delegated; },
      async edit(sessionId, ref, request) { const delegated = await officialGoal("edit", sessionId, ref, request); return delegated.ok && !delegated.value.available ? call(`/api/sessions/${encodeURIComponent(sessionId)}/goal`, { method: "PUT", body: JSON.stringify({ ...ref, ...request, action: "edit" }) }) : delegated.ok ? { ok: true, value: delegated.value.value } : delegated; },
      async pause(sessionId, ref) { const delegated = await officialGoal("pause", sessionId, ref); return delegated.ok && !delegated.value.available ? call(`/api/sessions/${encodeURIComponent(sessionId)}/goal`, { method: "PUT", body: JSON.stringify({ ...ref, action: "pause" }) }) : delegated.ok ? { ok: true, value: delegated.value.value } : delegated; },
      async resume(sessionId, ref) { const delegated = await officialGoal("resume", sessionId, ref); return delegated.ok && !delegated.value.available ? call(`/api/sessions/${encodeURIComponent(sessionId)}/goal`, { method: "PUT", body: JSON.stringify({ ...ref, action: "resume" }) }) : delegated.ok ? { ok: true, value: delegated.value.value } : delegated; },
      async complete(sessionId, ref) { const delegated = await officialGoal("complete", sessionId, ref); return delegated.ok && !delegated.value.available ? call(`/api/sessions/${encodeURIComponent(sessionId)}/goal`, { method: "PUT", body: JSON.stringify({ ...ref, action: "complete" }) }) : delegated.ok ? { ok: true, value: delegated.value.value } : delegated; },
      async clear(sessionId, ref) { const delegated = await officialGoal("clear", sessionId, ref); return delegated.ok && !delegated.value.available ? call(`/api/sessions/${encodeURIComponent(sessionId)}/goal`, { method: "DELETE", body: JSON.stringify(ref) }) : delegated.ok ? { ok: true, value: delegated.value.value } : delegated; },
    }),
    messageFeedback: Object.freeze({
      async list(request, signal) { return call("/api/dsh/message-feedback", { method: "POST", body: JSON.stringify({ operation: "list", request }), signal }); },
      async put(request, signal) { return call("/api/dsh/message-feedback", { method: "POST", body: JSON.stringify({ operation: "put", request }), signal }); },
      async delete(request, signal) { return call("/api/dsh/message-feedback", { method: "POST", body: JSON.stringify({ operation: "delete", request }), signal }); },
    }),
    subagents: Object.freeze({
      async list(parentSessionId, signal) { return call("/api/dsh/subagents", { method: "POST", body: JSON.stringify({ operation: "list", parentSessionId }), signal }); },
      async prompt(request, signal) { return call("/api/dsh/subagents", { method: "POST", body: JSON.stringify({ operation: "prompt", ...request }), signal }); },
      async interruptByParent(childSessionId, parentSessionId, mode) { return call("/api/dsh/subagents", { method: "POST", body: JSON.stringify({ operation: "interruptByParent", childSessionId, parentSessionId, mode }) }); },
    }),
    agentTeams: Object.freeze({
      async view(sessionId, signal) { return call("/api/dsh/agent-teams", { method: "POST", body: JSON.stringify({ operation: "view", sessionId }), signal }); },
      async createTask(sessionId, request, signal) { return call("/api/dsh/agent-teams", { method: "POST", body: JSON.stringify({ operation: "createTask", sessionId, request }), signal }); },
      async updateTask(sessionId, request, signal) { return call("/api/dsh/agent-teams", { method: "POST", body: JSON.stringify({ operation: "updateTask", sessionId, request }), signal }); },
    }),
    sessionReferenceResolver: Object.freeze({
      async candidates(sessionId, query = "", signal) { return call("/api/dsh/session-references", { method: "POST", body: JSON.stringify({ sessionId, query }), signal }); },
    }),
    fileReferences: Object.freeze({
      async list(sessionId, query = "", signal) { return call("/api/dsh/file-references", { method: "POST", body: JSON.stringify({ sessionId, query }), signal }); },
    }),
    llm: Object.freeze({
      async listProviders(signal) {
        return call("/api/dsh/llm/providers", { signal });
      },
      async listConfigurableProviders(signal) { return call("/api/dsh/llm/configurable-providers", { signal }); },
      async discoverModels(settingsNs, request, signal) { return call("/api/dsh/llm/discover-models", { method: "POST", body: JSON.stringify({ settingsNs, ...request }), signal }); },
    }),
    credentials: Object.freeze({
      async describe(refs, signal) { return call("/api/dsh/credentials", { method: "POST", body: JSON.stringify({ operation: "describe", refs }), signal }); },
      async set(ref, value, signal) { return call("/api/dsh/credentials", { method: "POST", body: JSON.stringify({ operation: "set", ref, value }), signal }); },
      async unset(ref, signal) { return call("/api/dsh/credentials", { method: "POST", body: JSON.stringify({ operation: "unset", ref }), signal }); },
    }),
    skills: Object.freeze({
      async list(request, signal) { return call("/api/dsh/skills", { method: "POST", body: JSON.stringify(request), signal }); },
    }),
    directoryPicker: Object.freeze({
      async pick(signal) { return call("/api/dsh/directory-picker", { method: "POST", body: JSON.stringify({ operation: "pick" }), signal }); },
      async list(path, signal) { return call("/api/dsh/directory-picker", { method: "POST", body: JSON.stringify({ operation: "list", ...(path === undefined ? {} : { path }) }), signal }); },
      async createDirectory(path, name, signal) { return call("/api/dsh/directory-picker", { method: "POST", body: JSON.stringify({ operation: "createDirectory", path, name }), signal }); },
    }),
    dynamicCordisRunner: Object.freeze({
      getClientCode(agentId, pluginId, pluginRunId, signal) { return connection.rpc.call("/api", "dynamicCordisRunner/getClientCode", { args: { agentId, pluginId, pluginRunId } }, signal); },
      inventory(signal) { return connection.rpc.call("/api", "dynamicCordisRunner/inventory", { args: {} }, signal); },
      invoke(pluginId, pluginRunId, method, args, signal) { return connection.rpc.call("/api", "dynamicCordisRunner/invoke", { args: { pluginId, pluginRunId, method, args } }, signal); },
      reportClientGuardFailure(agentId, pluginId, pluginRunId, failure, signal) { return connection.rpc.call("/api", "dynamicCordisRunner/reportClientGuardFailure", { args: { agentId, pluginId, pluginRunId, failure } }, signal); },
      reportRenderFailure(agentId, pluginId, pluginRunId, failure, signal) { return connection.rpc.call("/api", "dynamicCordisRunner/reportRenderFailure", { args: { agentId, pluginId, pluginRunId, failure } }, signal); },
      resolveInspectQuery(agentId, requestId, resolution, signal) { return connection.rpc.call("/api", "dynamicCordisRunner/resolveInspectQuery", { args: { agentId, requestId, resolution } }, signal); },
      resolveRequestRun(requestId, resolution, signal) { return connection.rpc.call("/api", "dynamicCordisRunner/resolveRequestRun", { args: { requestId, resolution } }, signal); },
      runHostHalf(agentId, pluginId, packageId, mode, requestId, approveFutureVersions, signal) { return connection.rpc.call("/api", "dynamicCordisRunner/runHostHalf", { args: { agentId, pluginId, packageId, mode, requestId, approveFutureVersions } }, signal); },
      settleUserRun(agentId, pluginId, resolution, signal) { return connection.rpc.call("/api", "dynamicCordisRunner/settleUserRun", { args: { agentId, pluginId, resolution } }, signal); },
      stopFromPanel(agentId, pluginId, signal) { return connection.rpc.call("/api", "dynamicCordisRunner/stopFromPanel", { args: { agentId, pluginId } }, signal); },
      syncInspectManifest(providers, signal) { return connection.rpc.call("/api", "dynamicCordisRunner/syncInspectManifest", { args: { providers } }, signal); },
      undefineFromPanel(agentId, pluginId, signal) { return connection.rpc.call("/api", "dynamicCordisRunner/undefineFromPanel", { args: { agentId, pluginId } }, signal); },
    }),
    workspace: Object.freeze({
      async create(request, signal) {
        const delegated = await officialWorkspace("create", request, signal);
        if (!delegated.ok) return delegated;
        if (delegated.value.available) return { ok: true, value: delegated.value.value };
        const before = await call("/api/workspaces", { signal });
        if (!before.ok) return before;
        const result = await call("/api/workspaces", { method: "POST", body: JSON.stringify({ path: request.path }), signal });
        if (!result.ok) return result;
        const after = await call("/api/workspaces", { signal });
        if (!after.ok) return after;
        const workspace = dshWorkspaceView(after.value.find((row) => row.id === result.value.id) ?? result.value);
        return { ok: true, value: { workspace, created: !before.value.some((row) => row.id === result.value.id) } };
      },
      async rename(request, signal) {
        const delegated = await officialWorkspace("rename", request, signal);
        if (!delegated.ok) return delegated;
        if (delegated.value.available) return { ok: true, value: delegated.value.value };
        const result = await call(`/api/workspaces/${encodeURIComponent(request.workspaceId)}`, { method: "PUT", body: JSON.stringify({ title: request.title }), signal });
        return result.ok ? { ok: true, value: { workspace: dshWorkspaceView(result.value) } } : result;
      },
      async delete(request, signal) {
        const delegated = await officialWorkspace("delete", request, signal);
        if (!delegated.ok) return delegated;
        if (delegated.value.available) return { ok: true, value: delegated.value.value };
        const result = await call(`/api/workspaces/${encodeURIComponent(request.workspaceId)}`, { method: "DELETE", signal });
        return result.ok ? { ok: true, value: { deleted: true } } : result;
      },
      async insertBefore(request, signal) {
        const delegated = await officialWorkspace("insertBefore", request, signal);
        if (!delegated.ok) return delegated;
        if (delegated.value.available) return { ok: true, value: delegated.value.value };
        const listed = await call("/api/workspaces", { signal });
        if (!listed.ok) return listed;
        const ids = listed.value.map((row) => row.id).filter((id) => id !== request.workspaceId);
        const index = request.beforeWorkspaceId === undefined ? ids.length : ids.indexOf(request.beforeWorkspaceId);
        if (!listed.value.some((row) => row.id === request.workspaceId) || (request.beforeWorkspaceId !== undefined && index < 0)) return { ok: false, error: remoteError("gateway/bad-request", "Workspace order contains an unknown id", {}) };
        ids.splice(index, 0, request.workspaceId);
        const result = await call("/api/workspaces/order", { method: "PUT", body: JSON.stringify({ ids }), signal });
        return result.ok ? { ok: true, value: { workspaceIds: ids } } : result;
      },
      async insertSessionBefore(request, signal) {
        const delegated = await officialWorkspace("insertSessionBefore", request, signal);
        if (!delegated.ok) return delegated;
        if (delegated.value.available) return { ok: true, value: delegated.value.value };
        const result = await call(`/api/workspaces/${encodeURIComponent(request.workspaceId)}/sessions/order`, { method: "PUT", body: JSON.stringify({ sessionId: request.sessionId, ...(request.beforeSessionId === undefined ? {} : { beforeSessionId: request.beforeSessionId }) }), signal });
        if (!result.ok) return result;
        const listed = await call("/api/workspaces", { signal });
        if (!listed.ok) return listed;
        const row = listed.value.find((entry) => entry.id === request.workspaceId);
        return row ? { ok: true, value: { workspace: dshWorkspaceView(row) } } : { ok: false, error: remoteError("gateway/internal", "Workspace disappeared after reorder", {}) };
      },
      async archiveSession(request, signal) {
        const delegated = await officialWorkspace("archiveSession", request, signal);
        if (!delegated.ok) return delegated;
        if (delegated.value.available) return { ok: true, value: delegated.value.value };
        const result = await call(`/api/sessions/${encodeURIComponent(request.sessionId)}/archived`, { method: "PUT", body: JSON.stringify({ archived: true }), signal });
        if (!result.ok) return result;
        const archived = await call("/api/archived-sessions", { signal });
        return archived.ok ? { ok: true, value: { archivedSessionIds: archived.value.map((row) => row.id) } } : archived;
      },
      follow(signal) { return mux.open("workspace/follow", { args: {} }, signal); },
    }),
    pluginInventory: Object.freeze({
      async list(signal) {
        return call("/api/dsh/plugin-inventory", { signal });
      },
    }),
    session: Object.freeze({
      async list(_request = {}, signal) {
        const delegated = await officialSessionRead("list", signal);
        if (!delegated.ok) return delegated;
        if (delegated.value.available) return { ok: true, value: delegated.value.value };
        const result = await call("/api/sessions", { signal });
        if (!result.ok) return result;
        return { ok: true, value: { items: result.value.map((entry) => ({
          sessionId: entry.id,
          updatedAt: Number.isFinite(Date.parse(entry.updatedAt)) ? Date.parse(entry.updatedAt) : 0,
          running: entry.running === true,
          blank: entry.blank === true,
          ...(entry.parentSessionId === undefined ? {} : { parentSessionId: entry.parentSessionId, origin: "subagent" }),
          ...(entry.cwd === undefined ? {} : { cwd: entry.cwd }),
        })) } };
      },
      async search(request, signal) { const delegated = await call("/api/dsh/session/read", { method: "POST", body: JSON.stringify({ operation: "search", request }), signal }); return delegated.ok && delegated.value.available ? { ok: true, value: delegated.value.value } : delegated.ok ? call(`/api/sessions/search?query=${encodeURIComponent(request.query)}`, { signal }) : delegated; },
      async page(request, signal) { return call("/api/dsh/session/page", { method: "POST", body: JSON.stringify(request), signal }); },
      follow(request, signal) { return mux.open("session/follow", { args: { request } }, signal); },
      control(signal) { return mux.open("session/control", { args: {} }, signal); },
      async updateQueue(request, signal) { const delegated = await officialSessionWrite("updateQueue", request, signal); return delegated.ok && delegated.value.available ? { ok: true, value: delegated.value.value } : delegated.ok ? call("/api/dsh/session/update-queue", { method: "POST", body: JSON.stringify(request), signal }) : delegated; },
      async modelCatalog(signal) {
        const delegated = await officialSessionRead("modelCatalog", signal);
        if (!delegated.ok) return delegated;
        if (delegated.value.available) return { ok: true, value: delegated.value.value };
        const result = await call("/api/models", { signal });
        if (!result.ok) return result;
        if (result.value.length === 0) return { ok: false, error: remoteError("gateway/internal", "The active Profile advertises no models", {}) };
        const byProvider = new Map();
        for (const model of result.value) {
          const models = byProvider.get(model.provider) || []; byProvider.set(model.provider, models);
          models.push({ id: model.model, name: model.displayName || model.model, ...(model.supportsReasoning ? { reasoning: { efforts: ["off", "low", "medium", "high", "max"].map((id) => ({ id, name: id })) } } : {}) });
        }
        const first = result.value[0];
        return { ok: true, value: { default: { provider: first.provider, model: first.model }, routableProviders: [...byProvider.keys()], groups: [...byProvider].map(([id, models]) => ({ id, name: id, models })), failures: [] } };
      },
      async create(request) { const delegated = await officialSessionWrite("create", request); return delegated.ok && delegated.value.available ? { ok: true, value: delegated.value.value } : delegated.ok ? call("/api/sessions", { method: "POST", body: JSON.stringify(request) }) : delegated; },
      async selectModel(request) { const delegated = await officialSessionWrite("selectModel", request); return delegated.ok && delegated.value.available ? { ok: true, value: delegated.value.value } : delegated.ok ? call(`/api/sessions/${encodeURIComponent(request.sessionId)}/model`, { method: "PUT", body: JSON.stringify({ provider: request.provider, model: request.model, reasoningEffort: request.reasoningEffort }) }) : delegated; },
      async rename(request) {
        const delegated = await officialSessionWrite("rename", request);
        if (!delegated.ok) return delegated;
        if (delegated.value.available) return { ok: true, value: delegated.value.value };
        const result = await call(`/api/sessions/${encodeURIComponent(request.sessionId)}/title`, { method: "PUT", body: JSON.stringify({ title: request.title }) });
        return result.ok ? { ok: true, value: { title: result.value.title, seq: result.value.seq } } : result;
      },
      async fork(request) { const delegated = await officialSessionWrite("fork", request); return delegated.ok && delegated.value.available ? { ok: true, value: delegated.value.value } : delegated.ok ? call(`/api/sessions/${encodeURIComponent(request.sessionId)}/fork`, { method: "POST", body: JSON.stringify({ atSeq: request.atSeq }) }) : delegated; },
      async prompt(request, signal) { const delegated = await officialSessionWrite("prompt", request, signal); return delegated.ok && delegated.value.available ? { ok: true, value: delegated.value.value } : delegated.ok ? call(`/api/sessions/${encodeURIComponent(request.sessionId)}/prompt`, { method: "POST", body: JSON.stringify({ mode: request.mode, content: request.content, requestId: request.requestId, clientTimeZone: request.clientTimeZone }), signal }) : delegated; },
      async attachment(request, signal) { const delegated = await officialSessionRead("attachment", signal, request); return delegated.ok && delegated.value.available ? { ok: true, value: delegated.value.value } : delegated.ok ? call(`/api/sessions/${encodeURIComponent(request.sessionId)}/attachments/${encodeURIComponent(request.attachmentId)}`, { signal }) : delegated; },
      async cancel(request) { const delegated = await officialSessionWrite("cancel", request); return delegated.ok && delegated.value.available ? { ok: true, value: delegated.value.value } : delegated.ok ? call(`/api/sessions/${encodeURIComponent(request.sessionId)}/cancel`, { method: "POST", body: "{}" }) : delegated; },
      async canOpenWorkspacePath(signal) {
        const result = await call("/api/dsh/session/capabilities", { signal });
        return result.ok ? { ok: true, value: result.value.canOpenWorkspacePath === true } : result;
      },
      async openWorkspacePath(request, signal) { return call("/api/dsh/session/open-workspace-path", { method: "POST", body: JSON.stringify(request), signal }); },
    }),
    settings: Object.freeze({
      async describe(signal) { return call("/api/dsh/settings/describe", { signal }); },
      async canOpenAgentPresetDirectory(signal) {
        const result = await call("/api/dsh/settings/capabilities", { signal });
        return result.ok ? { ok: true, value: result.value.canOpenAgentPresetDirectory === true } : result;
      },
      async update(ns, patch, expectedRevision) { return writeSettings("update", ns, patch, expectedRevision); },
      async replace(ns, section, expectedRevision) { return writeSettings("replace", ns, section, expectedRevision); },
      async mutate(ns, ops, expectedRevision) { return writeSettings("mutate", ns, ops, expectedRevision); },
      async openSettingsDocument(signal) { return call("/api/dsh/settings/open-document", { method: "POST", body: "{}", signal }); },
      async openAgentPresetDirectory(agentPreset, signal) { return call("/api/dsh/settings/open-agent-preset-directory", { method: "POST", body: JSON.stringify({ agentPreset }), signal }); },
    }),
  });
}

function createRemoteStreamMux(remoteError) {
  const streams = new Map(); let socket; let connecting;
  const url = () => { const value = new URL("/api/remote.mux", globalThis.location?.href ?? "http://localhost/"); value.protocol = value.protocol === "https:" ? "wss:" : "ws:"; return value.href; };
  const failAll = (error) => { for (const inbox of streams.values()) inbox.fail(error); streams.clear(); };
  const connect = () => {
    if (socket?.readyState === WebSocket.OPEN) return Promise.resolve(socket);
    if (connecting) return connecting;
    connecting = new Promise((resolve, reject) => {
      const candidate = new WebSocket(url());
      candidate.addEventListener("open", () => { socket = candidate; connecting = undefined; resolve(candidate); }, { once: true });
      candidate.addEventListener("error", () => { if (connecting) { connecting = undefined; reject(new Error("Remote stream WebSocket failed")); } }, { once: true });
      candidate.addEventListener("message", (event) => {
        let frame; try { frame = JSON.parse(String(event.data)); } catch { candidate.close(1008, "invalid Remote stream response"); return; }
        const inbox = typeof frame?.streamId === "string" ? streams.get(frame.streamId) : undefined;
        if (!inbox || !["item", "end", "error"].includes(frame.type)) { candidate.close(1008, "invalid Remote stream response"); return; }
        inbox.push(frame);
      });
      candidate.addEventListener("close", () => { if (socket === candidate) socket = undefined; failAll(new Error("Remote stream WebSocket closed")); });
    });
    return connecting;
  };
  return Object.freeze({
    reconnect() { const current = socket; socket = undefined; if (current?.readyState === WebSocket.OPEN) current.close(4000, "reconnect requested"); },
    async *open(endpoint, payload, signal = new AbortController().signal) {
      signal.throwIfAborted(); const streamId = globalThis.crypto?.randomUUID?.() ?? `seal-${Date.now()}-${Math.random().toString(16).slice(2)}`; const inbox = remoteStreamInbox(); let carrier; let terminal = false;
      const abort = () => inbox.fail(signal.reason ?? new DOMException("Aborted", "AbortError")); signal.addEventListener("abort", abort, { once: true });
      try {
        carrier = await connect(); signal.throwIfAborted(); streams.set(streamId, inbox); carrier.send(JSON.stringify({ type: "open", streamId, endpoint, payload }));
        while (true) {
          const frame = await inbox.next(); signal.throwIfAborted();
          if (frame.type === "item") { yield frame.value; continue; }
          terminal = true;
          if (frame.type === "error") throw remoteError(frame.error?.code || "gateway/internal", frame.error?.message || "Remote stream failed", frame.error?.details || {});
          return;
        }
      } catch (error) {
        if (signal.aborted || error?.name === "AbortError") throw remoteError("gateway/cancelled", "Remote request was cancelled", {});
        throw error;
      } finally {
        signal.removeEventListener("abort", abort); streams.delete(streamId);
        if (!terminal && carrier?.readyState === WebSocket.OPEN) carrier.send(JSON.stringify({ type: "cancel", streamId }));
      }
    },
  });
}

async function answerRemoteWaterfall(frame, clientId, subscribers, signal, rpc) {
  const candidates = [...(subscribers.get(frame.event) ?? [])].filter((entry) => {
    const identity = clientContextIdentity(entry.context);
    return identity === undefined || identity === frame.agentId;
  });
  const NEXT = Symbol("remote-event-next");
  const dispatch = async (index) => {
    signal.throwIfAborted(); const entry = candidates[index]; if (!entry) return NEXT;
    const agent = entry.context ?? officialShellRoot.get("sessions")?.scope?.(frame.agentId) ?? clientDomain.sessions.scope(frame.agentId);
    const request = Object.freeze({ ...frame.request, agent, signal });
    return entry.listener.call(entry.context, request, () => dispatch(index + 1));
  };
  let outcome;
  try {
    const value = await dispatch(0); signal.throwIfAborted(); outcome = value === NEXT ? { kind: "next" } : value === undefined ? { kind: "result" } : { kind: "result", value };
    JSON.stringify(outcome);
  } catch (error) {
    if (signal.aborted) return;
    outcome = { kind: "rejected", error: { name: typeof error?.name === "string" ? error.name : "Error", message: typeof error?.message === "string" ? error.message : String(error), ...(typeof error?.code === "string" ? { code: error.code } : {}), ...(error?.details === undefined ? {} : { details: error.details }) } };
  }
  const result = await rpc.call("/api", "$events/result", { args: { clientId, eventId: frame.eventId, outcome } }, signal);
  if (!result.ok) throw result.error;
}

function clientContextIdentity(context) {
  if (typeof context === "string" && context) return context;
  if (!context || typeof context !== "object") return undefined;
  for (const key of ["agentId", "sessionId", "id"]) if (typeof context[key] === "string" && context[key]) return context[key];
  return undefined;
}

function remoteStreamInbox() {
  const frames = []; let wake; let failure;
  return {
    push(frame) { if (failure) return; frames.push(frame); wake?.(); wake = undefined; },
    fail(error) { if (failure) return; failure = error instanceof Error ? error : new Error(String(error)); frames.length = 0; wake?.(); wake = undefined; },
    async next() { while (frames.length === 0) { if (failure) throw failure; await new Promise((resolve) => { wake = resolve; }); } return frames.shift(); },
  };
}

function createLocaleAdapter() {
  const dictionaries = new Map(); const bound = new Map(); const listeners = new Set(); let revision = 0;
  const active = () => String(document.documentElement?.lang || "en").toLowerCase().startsWith("zh") ? "zh" : "en";
  const publish = () => { revision += 1; for (const listener of [...listeners]) listener(); };
  window.addEventListener("seal-harness:locale-change", publish);
  return {
    getLocale() { return this.getSnapshot(); },
    getSnapshot() { return Object.freeze({ active: active(), locales: Object.freeze([{ id: "zh", label: "中文", fallback: "en" }, { id: "en", label: "English" }]), revision }); },
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    setLocale(id) { const locale = String(id).toLowerCase().startsWith("zh") ? "zh-CN" : "en"; document.documentElement.lang = locale; globalThis.localStorage?.setItem("seal-harness.locale", locale); window.dispatchEvent(new CustomEvent("seal-harness:locale-change", { detail: { locale } })); },
    register(namespace, localeOrDictionaries, dictionary) {
      const pairs = typeof localeOrDictionaries === "string" ? [[localeOrDictionaries, dictionary]] : Object.entries(localeOrDictionaries);
      const values = dictionaries.get(namespace) || new Map(); dictionaries.set(namespace, values);
      for (const [locale, entries] of pairs) { const key = String(locale).toLowerCase(); if (values.has(key)) throw new Error(`locale namespace "${namespace}" already has locale "${locale}"`); values.set(key, entries); }
      publish(); let live = true; return () => { if (!live) return; live = false; for (const [locale, entries] of pairs) if (values.get(String(locale).toLowerCase()) === entries) values.delete(String(locale).toLowerCase()); publish(); };
    },
    bind(namespace) { if (!bound.has(namespace)) bound.set(namespace, (key, params) => { const values = dictionaries.get(namespace); const common = dictionaries.get("common"); const template = values?.get(active())?.[key] ?? values?.get("en")?.[key] ?? common?.get(active())?.[key] ?? common?.get("en")?.[key] ?? key; return params ? template.replace(/\{(\w+)\}/g, (match, name) => name in params ? String(params[name]) : match) : template; }); return bound.get(namespace); },
  };
}

function createSlotsRuntime() {
  const records = new Map([
    ["root", { spec: { kind: "single", scope: "root" }, entries: [], declaredBy: undefined }],
    ["sidebar.footer.action", { spec: { kind: "list", scope: "root" }, entries: [], declaredBy: undefined }],
    ["settings.general.item", { spec: { kind: "list", scope: "root" }, entries: [], declaredBy: undefined }],
    ["tool.call.toolview", { spec: { kind: "keyed", scope: "session" }, entries: [], declaredBy: undefined }],
  ]);
  const injectors = new Map();
  const listeners = new Set(); const entryErrorListeners = new Set(); const sessionListeners = new Set(); const sessionContexts = new Map(); const storeInstances = new WeakMap(); const toolRoots = new WeakMap(); let currentSessionId; let version = 0; let sequence = 0; let reactRoot; let sidebarRoot; let settingsGeneralRoot;
  const changed = () => { version += 1; for (const listener of [...listeners]) listener(); ensureRoots(); };
  const ensureRoots = () => {
    if (typeof document.getElementById !== "function") return;
    if (!reactRoot) { const container = document.getElementById("dsh-slot-root"); if (container) { reactRoot = createReactRoot(container); reactRoot.render(React.createElement(SlotRoot, { name: "root" })); } }
    if (!sidebarRoot) { const container = document.getElementById("dsh-sidebar-footer-slot"); if (container) { sidebarRoot = createReactRoot(container); sidebarRoot.render(React.createElement(SlotRoot, { name: "sidebar.footer.action" })); } }
    if (!settingsGeneralRoot) { const container = document.getElementById("dsh-settings-general-slot"); if (container) { settingsGeneralRoot = createReactRoot(container); settingsGeneralRoot.render(React.createElement(SlotRoot, { name: "settings.general.item" })); } }
  };
  const sorted = (record) => [...record.entries].sort((left, right) => {
    const priority = (left.options.priority ?? 0) - (right.options.priority ?? 0); if (priority) return priority;
    if (record.spec.kind === "list") { const order = (left.options.order ?? 0) - (right.options.order ?? 0); if (order) return order; }
    return left.sequence - right.sequence;
  });
  const winners = (record, opts = {}) => {
    const entries = sorted(record);
    if (record.spec.kind === "single") return entries.slice(0, 1);
    if (record.spec.kind === "keyed") return entries.filter((entry) => entry.options.key === opts.entryKey).slice(0, 1);
    if (record.spec.kind === "list") {
      const ids = new Set(); return entries.filter((entry) => (!opts.only || entry.options.id === opts.only) && !ids.has(entry.options.id) && Boolean(ids.add(entry.options.id)));
    }
    return entries;
  };
  const render = (name, owner = {}, opts = {}, chain = false) => {
    const record = records.get(name); if (!record) throw new Error(`slot "${name}" is not declared`);
    if (record.spec.scope === "session" && currentSessionId === undefined) return opts.fallback ?? null;
    if (record.spec.kind === "chain" || chain) {
      if (opts.fallbackOnly) return opts.fallback ?? null;
      for (const entry of sorted(record)) { const matched = entry.select(owner); if (matched !== null) return renderEntry(entry, owner, opts, matched); }
      return opts.fallback ?? null;
    }
    const entries = winners(record, opts); if (entries.length === 0) return opts.fallback ?? null;
    return React.createElement(React.Fragment, null, entries.map((entry) => React.createElement(React.Fragment, { key: entry.options.id ?? entry.options.key ?? entry.sequence }, renderEntry(entry, owner, opts))));
  };
  const renderEntry = (entry, owner, opts, matched) => {
    const record = records.get(entry.target); const scope = record?.spec.scope ?? "root";
    const children = entry.children ?? {};
    const store = resolveSlotStore(entry, scope, currentSessionId, storeInstances);
    const injectArgs = scope === "root" ? (store ? [store.actions] : []) : store ? [currentSessionId, store.actions] : [currentSessionId];
    const injected = typeof entry.inject === "function" ? entry.inject(...injectArgs) ?? {} : {};
    const locale = entry.locale === undefined ? {} : { t: services.get("locale")?.bind(entry.locale) ?? ((key) => key) };
    const sessions = services.get("sessions"); const workspaces = services.get("workspaces");
    const useSessions = (selector = (value) => value) => React.useSyncExternalStore(sessions?.list.subscribe ?? (() => () => {}), () => selector(sessions?.list.getSnapshot?.()));
    const useWorkspaces = (selector = (value) => value) => React.useSyncExternalStore(workspaces?.list.subscribe ?? (() => () => {}), () => selector(workspaces?.list.getSnapshot?.()));
    const sessionSource = currentSessionId === undefined ? undefined : sessions?.source?.(currentSessionId);
    const useSession = (selector = (value) => value) => React.useSyncExternalStore(sessionSource?.subscribe ?? (() => () => {}), () => selector(sessionSource?.getSnapshot?.()));
    const useProjection = (key, selector = (value) => value) => useSession((snapshot) => selector(snapshot?.projections?.[key]));
    const props = {
      ...owner, ...bindSlotInject(injected), ...locale,
      useSessions, useWorkspaces,
      ...(scope === "root" ? {} : { sessionId: currentSessionId, agent: currentSessionId === undefined ? undefined : sessionContext(currentSessionId) }),
      ...(scope === "root" ? {} : { useSession, useProjection }),
      ...(store === undefined ? {} : { actions: store.actions, useStore: (selector = (value) => value) => React.useSyncExternalStore(store.subscribe, () => selector(store.getSnapshot())) }),
      ...(matched === undefined ? {} : { matched }),
      renderSlot: (key, childOwner, childOpts) => { if (!(key in children)) throw new Error(`slot "${key}" is not owned by this entry`); return render(key, childOwner, childOpts); },
      renderSlotChain: (key, childOwner, childOpts) => { if (!(key in children)) throw new Error(`slot "${key}" is not owned by this entry`); return render(key, childOwner, childOpts, true); },
      SessionProvider: ({ children: body, empty }) => currentSessionId === undefined ? empty?.() ?? null : React.createElement(React.Fragment, { key: currentSessionId }, body),
      ...(opts.entryKey === undefined ? {} : { entryKey: opts.entryKey }),
    };
    return React.createElement(entry.component, props);
  };
  const disposeInjected = (injection) => { for (const dispose of injection.disposers.splice(0).reverse()) try { dispose(); } catch (error) { console.error("slot injection dispose failed", error); } };
  const activateInjected = (name, injection) => {
    if (!records.has(name) || injection.disposers.length) return;
    const result = injection.callback();
    if (typeof result === "function") injection.disposers.push(result);
    else if (result?.[Symbol.iterator]) for (const dispose of result) if (typeof dispose === "function") injection.disposers.push(dispose);
  };
  const activateInjectors = (name) => { for (const injection of injectors.get(name) ?? []) activateInjected(name, injection); };
  const deactivateInjectors = (name) => { for (const injection of injectors.get(name) ?? []) disposeInjected(injection); };
  function SlotRoot({ name }) { React.useSyncExternalStore((listener) => { listeners.add(listener); return () => listeners.delete(listener); }, () => version); return render(name, {}); }
  const api = {
    register(options, component) {
      if (!options || typeof options.name !== "string" || typeof component !== "function") throw new TypeError("invalid slot registration");
      const record = records.get(options.name); if (!record) throw new Error(`slot "${options.name}" is not declared (a parent entry's children table must declare it)`);
      const priority = options.priority ?? 0;
      const occupied = record.entries.find((entry) => (entry.options.priority ?? 0) === priority && (record.spec.kind === "single" || record.spec.kind === "keyed" && entry.options.key === options.key || record.spec.kind === "list" && entry.options.id === options.id));
      if (record.spec.kind === "keyed" && options.key === undefined) throw new Error(`keyed slot "${options.name}" requires options.key`);
      if (record.spec.kind === "list" && options.id === undefined) throw new Error(`list slot "${options.name}" requires options.id`);
      if (record.spec.kind === "chain" && typeof options.select !== "function") throw new Error(`chain slot "${options.name}" requires options.select`);
      if (occupied) throw new Error(`${record.spec.kind} slot "${options.name}" already has a registration at priority ${priority}`);
      const entry = { target: options.name, component, options: { key: options.key, id: options.id, order: options.order, label: options.label, priority: options.priority }, select: options.select, inject: options.inject, children: options.children, store: options.store, locale: options.locale, registrant: options.registrant, sequence: sequence++ };
      for (const [key, spec] of Object.entries(options.children ?? {})) { if (records.has(key)) throw new Error(`slot "${key}" is already declared`); records.set(key, { spec, entries: [], declaredBy: entry }); activateInjectors(key); }
      record.entries.push(entry); changed(); let active = true;
      return () => { if (!active) return; active = false; const at = record.entries.indexOf(entry); if (at >= 0) record.entries.splice(at, 1); for (const key of Object.keys(options.children ?? {})) if (records.get(key)?.declaredBy === entry) { deactivateInjectors(key); records.delete(key); } changed(); };
    },
    inject(name, callback) { if (typeof name !== "string" || typeof callback !== "function") throw new TypeError("invalid slot injection"); const injection = { callback, disposers: [] }; let set = injectors.get(name); if (!set) injectors.set(name, set = new Set()); set.add(injection); activateInjected(name, injection); return () => { set.delete(injection); disposeInjected(injection); if (set.size === 0) injectors.delete(name); }; },
    entries(name) { const record = records.get(name); return record ? Object.freeze(sorted(record)) : Object.freeze([]); },
    renderSlot(name, owner) { return render(name, owner); },
    onEntryError(listener) { entryErrorListeners.add(listener); return () => entryErrorListeners.delete(listener); },
  };
  const mountToolView = (container, owner) => {
    if (!container || typeof owner?.toolName !== "string") return false;
    const record = records.get("tool.call.toolview");
    if (!record || winners(record, { entryKey: owner.toolName }).length === 0) return false;
    let root = toolRoots.get(container); if (!root) { root = createReactRoot(container); toolRoots.set(container, root); }
    root.render(render("tool.call.toolview", { inspect: () => {}, ...owner }, { entryKey: owner.toolName }));
    return true;
  };
  const unmountToolView = (container) => { const root = toolRoots.get(container); if (!root) return false; root.unmount(); toolRoots.delete(container); return true; };
  const sessionContext = (id) => {
    let context = sessionContexts.get(id); if (context) return context;
    context = new Proxy({ id, sessionId: id, agentId: id, get: (name) => services.get(name) }, { get(target, property, receiver) { if (typeof property === "string" && services.has(property)) return services.get(property); return Reflect.get(target, property, receiver); } });
    sessionContexts.set(id, context); return context;
  };
  const selectSession = (id) => { const next = typeof id === "string" && id ? id : undefined; if (next === currentSessionId) return; currentSessionId = next; changed(); for (const listener of [...sessionListeners]) listener(); };
  window.addEventListener("seal-harness:session-selected", (event) => selectSession(event.detail?.sessionId));
  const uiSession = Object.freeze({
    scope(id) { return typeof id === "string" && id ? sessionContext(id) : undefined; },
    resolve(id) { const ctx = this.scope(id); return ctx === undefined ? undefined : { id, ctx }; },
    current: Object.freeze({ getSnapshot: () => currentSessionId, subscribe(listener) { sessionListeners.add(listener); return () => sessionListeners.delete(listener); } }),
    select: selectSession,
  });
  queueMicrotask(ensureRoots); return Object.freeze({ slots: Object.freeze(api), uiSession, mountToolView, unmountToolView });
}

function bindSlotInject(injected) {
  if (!injected || typeof injected !== "object") return {};
  const result = { ...injected }; delete result.hooks; delete result.keyedHooks;
  for (const [name, source] of Object.entries(injected.hooks ?? {})) result[`use${name[0]?.toUpperCase() ?? ""}${name.slice(1)}`] = (selector = (value) => value) => React.useSyncExternalStore(source.subscribe, () => selector(source.getSnapshot()));
  for (const [name, resolve] of Object.entries(injected.keyedHooks ?? {})) result[`use${name[0]?.toUpperCase() ?? ""}${name.slice(1)}`] = (key, selector = (value) => value) => { const source = resolve(key); return React.useSyncExternalStore(source?.subscribe ?? (() => () => {}), () => selector(source?.getSnapshot())); };
  return result;
}

function resolveSlotStore(entry, scope, sessionId, instances) {
  if (entry.store === undefined) return undefined;
  let handle = entry.storeHandle;
  if (handle === undefined) { handle = typeof entry.store === "function" ? entry.store() : entry.store; entry.storeHandle = handle; }
  if (!handle || typeof handle.create !== "function") throw new Error(`slot "${entry.target}" has an invalid store declaration`);
  let scoped = instances.get(handle); if (!scoped) { scoped = new Map(); instances.set(handle, scoped); }
  const key = scope === "root" ? "root" : sessionId ?? "session:none";
  let instance = scoped.get(key); if (!instance) { instance = handle.create(scope === "root" ? undefined : sessionId); scoped.set(key, instance); }
  return instance;
}

function createStoreModule() {
  const defineStore = (spec) => {
    if (!spec || typeof spec.init !== "function" || !spec.actions || typeof spec.actions !== "object") throw new TypeError("invalid store specification");
    return Object.freeze({
      spec,
      create(scopeKey) {
        const persistenceKey = typeof spec.persist === "string" ? `dsh.store.${spec.persist}${scopeKey === undefined ? "" : `.${scopeKey}`}` : undefined;
        let state = spec.init();
        if (persistenceKey !== undefined) { try { const stored = globalThis.localStorage?.getItem(persistenceKey); if (stored !== null && stored !== undefined) state = JSON.parse(stored); } catch {} }
        const listeners = new Set(); const actions = {};
        const publish = () => { if (persistenceKey !== undefined) { try { globalThis.localStorage?.setItem(persistenceKey, JSON.stringify(state)); } catch {} } for (const listener of [...listeners]) listener(); };
        for (const [name, reducer] of Object.entries(spec.actions)) actions[name] = (...args) => { const draft = structuredClone(state); reducer(draft, ...args); state = draft; publish(); };
        return Object.freeze({ actions: Object.freeze(actions), getSnapshot: () => state, subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); }, clearPersisted() { if (persistenceKey !== undefined) globalThis.localStorage?.removeItem(persistenceKey); } });
      },
    });
  };
  return Object.freeze({ defineStore, createStore: defineStore, createSnapshotStore: defineStore });
}

function createClientDomainAdapters() {
  const makeSource = (initial) => { let snapshot = initial; const listeners = new Set(); return Object.freeze({ getSnapshot: () => snapshot, subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); }, set(value) { snapshot = value; for (const listener of [...listeners]) listener(); } }); };
  const sessionSources = new Map(); const sessionBindings = new Map();
  const sessionList = makeSource(Object.freeze({ ids: [], byId: {}, current: undefined, phase: "pending", subagentsByParent: {}, jobsBySession: {}, currentAddress: undefined }));
  const workspaceList = makeSource(Object.freeze({ items: [], archivedSessionIds: [], state: "loading", phase: "pending", error: null }));
  const projectionFace = (source, key) => Object.freeze({ getSnapshot: () => source.getSnapshot()?.projections?.[key], subscribe: source.subscribe });
  const sessionSource = (id) => {
    let source = sessionSources.get(id); if (source) return source;
    const state = makeSource(Object.freeze({ sessionId: id, state: "idle", phase: "ready", running: false, queue: Object.freeze([]), projections: {} }));
    source = Object.freeze({
      getSnapshot: state.getSnapshot,
      subscribe: state.subscribe,
      set: state.set,
      projections: Object.freeze({ faceOf: (key) => projectionFace(state, key) }),
      async loadOlder() {}, async loadThrough() {},
      async cancel() { return remote.session.cancel({ sessionId: id }); },
      async updateQueue(itemId, action) { return remote.session.updateQueue({ sessionId: id, itemId, action }); },
      async command(line) { return remote.commands.execute(id, line, []); },
    });
    sessionSources.set(id, source); return source;
  };
  const install = (detail = {}) => {
    const rows = Array.isArray(detail.sessions) ? detail.sessions : []; const current = typeof detail.current === "string" ? detail.current : undefined; const byId = {};
    for (const row of rows) { byId[row.id] = Object.freeze({ ...row, sessionId: row.id, title: row.preview ?? row.title ?? "Session" }); sessionSource(row.id).set(Object.freeze({ ...row, sessionId: row.id, state: row.running ? "running" : "idle", phase: "ready", running: row.running === true, queue: Object.freeze(Array.isArray(row.queue) ? row.queue : []), projections: row.projections ?? {} })); }
    sessionList.set(Object.freeze({ ids: Object.freeze(rows.map((row) => row.id)), byId: Object.freeze(byId), current, phase: "ready", subagentsByParent: Object.freeze({}), jobsBySession: Object.freeze({}), currentAddress: undefined }));
    if (Array.isArray(detail.workspaces)) workspaceList.set(Object.freeze({ items: Object.freeze(detail.workspaces.map((row) => Object.freeze({ ...row, workspaceId: row.workspaceId ?? row.id }))), archivedSessionIds: Object.freeze(Array.isArray(detail.archivedSessionIds) ? [...detail.archivedSessionIds] : []), state: "idle", phase: "ready", error: null }));
  };
  window.addEventListener("seal-harness:domain-snapshot", (event) => install(event.detail));
  window.addEventListener("seal-harness:session-selected", (event) => { const previous = sessionList.getSnapshot(); sessionList.set(Object.freeze({ ...previous, current: typeof event.detail?.sessionId === "string" ? event.detail.sessionId : undefined })); });
  const json = async (url, init) => { const response = await fetch(url, { credentials: "same-origin", headers: { "content-type": "application/json", ...(init?.headers ?? {}) }, ...init }); if (!response.ok) throw new Error((await response.json().catch(() => null))?.error ?? `HTTP ${response.status}`); return response.status === 204 ? undefined : response.json(); };
  const refresh = async () => { try { const [sessionRows, workspaceRows, archived] = await Promise.all([json("/api/sessions"), json("/api/workspaces").catch(() => []), json("/api/archived-sessions").catch(() => [])]); install({ sessions: sessionRows, workspaces: workspaceRows, archivedSessionIds: archived.map((row) => row.id), current: sessionList.getSnapshot().current }); } catch (error) { workspaceList.set(Object.freeze({ ...workspaceList.getSnapshot(), state: "error", phase: "ready", error: { code: "gateway/internal", message: error instanceof Error ? error.message : String(error), details: {} } })); } };
  const workspaces = Object.freeze({
    list: workspaceList,
    async create(input) { const row = await json("/api/workspaces", { method: "POST", body: JSON.stringify(input) }); await refresh(); return { ...row, workspaceId: row.id }; },
    async rename(workspaceId, title) { const row = await json(`/api/workspaces/${encodeURIComponent(workspaceId)}`, { method: "PUT", body: JSON.stringify({ title }) }); await refresh(); return { ...row, workspaceId: row.id }; },
    async delete(workspaceId) { await json(`/api/workspaces/${encodeURIComponent(workspaceId)}`, { method: "DELETE" }); await refresh(); },
    async insertBefore(workspaceId, beforeWorkspaceId) { const ids = workspaceList.getSnapshot().items.map((row) => row.workspaceId).filter((id) => id !== workspaceId); const index = beforeWorkspaceId === undefined ? ids.length : ids.indexOf(beforeWorkspaceId); ids.splice(index < 0 ? ids.length : index, 0, workspaceId); await json("/api/workspaces/order", { method: "PUT", body: JSON.stringify({ ids }) }); await refresh(); },
    async archiveSession(sessionId) { await json(`/api/sessions/${encodeURIComponent(sessionId)}/archived`, { method: "PUT", body: JSON.stringify({ archived: true }) }); await refresh(); },
    async insertSessionBefore(workspaceId, sessionId, beforeSessionId) { await json(`/api/workspaces/${encodeURIComponent(workspaceId)}/sessions/order`, { method: "PUT", body: JSON.stringify({ sessionId, ...(beforeSessionId === undefined ? {} : { beforeSessionId }) }) }); await refresh(); return workspaceList.getSnapshot().items.find((row) => row.workspaceId === workspaceId); },
    refresh,
  });
  const navigate = (id) => {
    services.get("uiSession")?.select(id);
    window.dispatchEvent(new CustomEvent("seal-harness:client-navigate-session", { detail: { sessionId: id ?? null } }));
  };
  const binding = (id) => {
    if (typeof id !== "string" || !sessionList.getSnapshot().byId[id]) return undefined;
    let value = sessionBindings.get(id); if (value) return value;
    const ctx = officialShellRoot.extend({ sessionId: id, agentId: id });
    value = Object.freeze({ sessionId: id, ctx, session: sessionSource(id) }); sessionBindings.set(id, value); return value;
  };
  const sessions = Object.freeze({
    list: sessionList,
    searchResultLimit: 20,
    source: sessionSource,
    scope: (id) => binding(id)?.ctx,
    scopeOf: (ctx) => typeof ctx?.sessionId === "string" ? ctx.sessionId : undefined,
    sessionOf: (ctx) => { const id = typeof ctx?.sessionId === "string" ? ctx.sessionId : undefined; return id === undefined ? undefined : binding(id)?.session; },
    binding,
    open: navigate,
    openSubagent(address) { navigate(address?.sessionId ?? address?.childSessionId); },
    subagentAddress() { return undefined; },
    setSubagentCatalogOpen() {},
    async refreshSubagents() {},
    clear() { navigate(undefined); },
    async create(input = {}) {
      const result = await remote.session.create(input);
      if (!result.ok) throw new Error(result.error?.message ?? "Session creation failed");
      const id = typeof result.value === "string" ? result.value : result.value?.sessionId ?? result.value?.id;
      if (typeof id !== "string" || id.length === 0) throw new Error("Session creation returned no session id");
      await refresh();
      return id;
    },
    async search(query, signal) { return remote.session.search({ query }, signal); },
    async fork(input) { const result = await remote.session.fork(input); if (!result.ok) throw new Error(result.error?.message ?? "Session fork failed"); const id = result.value?.sessionId ?? result.value?.id; if (typeof id !== "string") throw new Error("Session fork returned no session id"); await refresh(); return id; },
    refresh,
  });
  const recentWorkspace = () => {
    const snapshot = sessionList.getSnapshot();
    let selected; let selectedTime = -Infinity;
    for (const workspace of workspaceList.getSnapshot().items) for (const id of workspace.sessionIds ?? []) {
      const session = snapshot.byId[id]; const time = Date.parse(session?.updatedAt ?? session?.createdAt ?? "");
      if (session && (Number.isFinite(time) ? time : 0) >= selectedTime) { selected = workspace.workspaceId; selectedTime = Number.isFinite(time) ? time : 0; }
    }
    return selected;
  };
  const connectWorkspace = async (workspaceId) => {
    const workspace = workspaceList.getSnapshot().items.find((item) => item.workspaceId === workspaceId);
    if (!workspace) throw new Error(`uiWorkspace.connectWorkspace: unknown workspace ${workspaceId}`);
    const archived = new Set(workspaceList.getSnapshot().archivedSessionIds);
    const snapshot = sessionList.getSnapshot();
    const blank = snapshot.ids.find((id) => { const session = snapshot.byId[id]; return session?.blank === true && session.cwd === workspace.path && workspace.sessionIds?.includes(id) && !archived.has(id); });
    return blank ?? sessions.create({ workspaceId });
  };
  const uiWorkspace = Object.freeze({
    connectWorkspace,
    startSession(workspaceId) {
      const workspaceSnapshot = workspaceList.getSnapshot(); const sessionSnapshot = sessionList.getSnapshot();
      const currentWorkspace = sessionSnapshot.current === undefined ? undefined : workspaceSnapshot.items.find((item) => item.sessionIds?.includes(sessionSnapshot.current))?.workspaceId;
      const target = workspaceId ?? currentWorkspace ?? recentWorkspace();
      if (target === undefined) { sessions.clear(); return; }
      void connectWorkspace(target).then((id) => sessions.open(id), (error) => console.warn("new session failed:", error));
    },
    archiveSession: (sessionId) => workspaces.archiveSession(sessionId),
    async pickDirectory() { const result = await remote.directoryPicker.pick(); if (!result.ok) throw new Error(result.error?.message ?? "Directory picker failed"); return result.value; },
    async listDirectory(path, signal) { const result = await remote.directoryPicker.list(path, signal); if (!result.ok) throw new Error(result.error?.message ?? "Directory listing failed"); return result.value; },
    async createDirectory(path, name) { const result = await remote.directoryPicker.createDirectory(path, name); if (!result.ok) throw new Error(result.error?.message ?? "Directory creation failed"); return result.value; },
  });
  queueMicrotask(refresh);
  return Object.freeze({ sessions, workspaces, uiWorkspace });
}
