const modules = new Map();
const active = new Map();
const descriptors = new Map();
const listeners = new Map();

function requireModule(name) {
  const value = modules.get(name);
  if (value === undefined) throw new Error(`Unsupported DSH client dependency: ${name}`);
  return value;
}

window.__ModuleLoader__ = {
  load(entry) {
    if (!entry || typeof entry.id !== "string" || typeof entry.factory !== "function") {
      throw new TypeError("Invalid DSH client module");
    }
    modules.set(entry.id, entry.factory(requireModule));
  },
};

function createContext(owner) {
  const disposers = [];
  return {
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
    async emit(event, ...args) {
      for (const item of [...(listeners.get(event) || [])]) await item.handler(...args);
    },
    get(name) { return modules.get(name); },
    provide(name, value) { modules.set(name, value); return () => modules.delete(name); },
    async dispose() {
      for (const dispose of disposers.reverse()) await dispose();
      for (const [event, values] of listeners) {
        const remaining = values.filter((item) => item.owner !== owner);
        if (remaining.length === 0) listeners.delete(event);
        else listeners.set(event, remaining);
      }
    },
  };
}

async function activate(name) {
  if (active.has(name)) return;
  const module = modules.get(name);
  if (!module || typeof module.apply !== "function") throw new Error(`DSH client plugin did not register: ${name}`);
  const context = createContext(name);
  try {
    const returned = await module.apply(context, undefined);
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
  window.dispatchEvent(new CustomEvent("seal-harness:plugin-disposed", { detail: { name } }));
}

async function load(entries) {
  const results = [];
  for (const entry of entries) {
    descriptors.set(entry.name, entry);
    if (entry.inject.length > 0) {
      results.push({ name: entry.name, status: "adapter-required", missing: entry.inject });
      continue;
    }
    try {
      await import(entry.url);
      if (entry.enabled) await activate(entry.name);
      results.push({ name: entry.name, status: entry.enabled ? "active" : "loaded" });
    } catch (error) {
      results.push({ name: entry.name, status: "error", error: error instanceof Error ? error.message : String(error) });
    }
  }
  return results;
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
};
