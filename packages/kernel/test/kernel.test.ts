import { describe, expect, it, vi } from "vitest";
import {
  CircularPluginDependencyError,
  createServiceToken,
  definePlugin,
  DuplicatePluginIdError,
  DuplicateServiceProviderError,
  Kernel,
  MissingProvidedServiceError,
  MissingServiceError,
  plugin,
  PluginStartError,
  UndeclaredServiceError,
  type EventMap,
} from "../src/index.js";

interface TestEvents extends EventMap {
  ping: { value: number };
}

describe("Kernel", () => {
  it("starts plugins in stable dependency order and exposes services", async () => {
    const clock = createServiceToken<{ now(): number }>("clock");
    const order: string[] = [];
    const consumer = definePlugin<undefined, TestEvents>({
      name: "consumer",
      requires: [clock],
      setup(ctx) {
        order.push(`consumer:${ctx.use(clock).now()}`);
      },
    });
    const provider = definePlugin<undefined, TestEvents>({
      name: "provider",
      provides: [clock],
      setup(ctx) {
        order.push("provider");
        ctx.provide(clock, { now: () => 42 });
      },
    });

    const kernel = new Kernel<TestEvents>();
    await kernel.start([plugin(consumer, undefined), plugin(provider, undefined)]);

    expect(order).toEqual(["provider", "consumer:42"]);
    expect(kernel.use(clock).now()).toBe(42);
    await kernel.stop();
    expect(kernel.has(clock)).toBe(false);
  });

  it("orders optional dependencies when their provider is present", async () => {
    const feature = createServiceToken<string>("feature");
    const order: string[] = [];
    const observer = definePlugin({
      name: "observer",
      optional: [feature],
      setup(ctx) {
        order.push(`observer:${ctx.has(feature)}`);
      },
    });
    const provider = definePlugin({
      name: "provider",
      provides: [feature],
      setup(ctx) {
        order.push("provider");
        ctx.provide(feature, "enabled");
      },
    });

    const kernel = new Kernel();
    await kernel.start([plugin(observer, undefined), plugin(provider, undefined)]);
    expect(order).toEqual(["provider", "observer:true"]);
    await kernel.stop();
  });

  it("emits events sequentially and removes scoped listeners", async () => {
    const calls: number[] = [];
    const listener = definePlugin<undefined, TestEvents>({
      name: "listener",
      setup(ctx) {
        ctx.on("ping", async ({ value }) => {
          await Promise.resolve();
          calls.push(value);
        });
        ctx.on("ping", ({ value }) => {
          calls.push(value * 2);
        });
      },
    });

    const kernel = new Kernel<TestEvents>();
    await kernel.start([plugin(listener, undefined)]);
    await kernel.emit("ping", { value: 3 });
    expect(calls).toEqual([3, 6]);
    await kernel.stop();
    await kernel.emit("ping", { value: 4 });
    expect(calls).toEqual([3, 6]);
  });

  it("disposes effects in LIFO order and plugins in reverse start order", async () => {
    const dependency = createServiceToken<string>("dependency");
    const order: string[] = [];
    const first = definePlugin({
      name: "first",
      provides: [dependency],
      setup(ctx) {
        ctx.effect(() => { order.push("first-effect-1"); });
        ctx.provide(dependency, "ready");
        ctx.effect(() => { order.push("first-effect-2"); });
        return () => { order.push("first-return"); };
      },
    });
    const second = definePlugin({
      name: "second",
      requires: [dependency],
      setup() {
        return () => { order.push("second-return"); };
      },
    });

    const kernel = new Kernel();
    await kernel.start([plugin(first, undefined), plugin(second, undefined)]);
    await kernel.stop();

    expect(order).toEqual([
      "second-return",
      "first-effect-2",
      "first-effect-1",
      "first-return",
    ]);
  });

  it("rolls back already started plugins after a start failure", async () => {
    const dispose = vi.fn();
    const first = definePlugin({
      name: "first",
      setup() {
        return dispose;
      },
    });
    const failure = new Error("boom");
    const second = definePlugin({
      name: "second",
      setup() {
        throw failure;
      },
    });
    const kernel = new Kernel();

    await expect(kernel.start([plugin(first, undefined), plugin(second, undefined)]))
      .rejects.toMatchObject({ name: "PluginStartError", pluginId: "second" });
    expect(dispose).toHaveBeenCalledOnce();
    expect(kernel.state).toBe("failed");
  });

  it("rejects missing, duplicate, cyclic, and dishonest service graphs", async () => {
    const one = createServiceToken<string>("one");
    const two = createServiceToken<string>("two");

    const missing = definePlugin({ name: "missing", requires: [one], setup() {} });
    await expect(new Kernel().start([plugin(missing, undefined)]))
      .rejects.toSatisfy((error: PluginStartError) => error.cause instanceof MissingServiceError);

    const duplicateProvider = (name: string) => definePlugin({
      name,
      provides: [one],
      setup(ctx) { ctx.provide(one, name); },
    });
    await expect(new Kernel().start([
      plugin(duplicateProvider("a"), undefined),
      plugin(duplicateProvider("b"), undefined),
    ])).rejects.toSatisfy(
      (error: PluginStartError) => error.cause instanceof DuplicateServiceProviderError,
    );

    const a = definePlugin({
      name: "a",
      provides: [one],
      requires: [two],
      setup(ctx) { ctx.provide(one, "a"); },
    });
    const b = definePlugin({
      name: "b",
      provides: [two],
      requires: [one],
      setup(ctx) { ctx.provide(two, "b"); },
    });
    await expect(new Kernel().start([plugin(a, undefined), plugin(b, undefined)]))
      .rejects.toSatisfy(
        (error: PluginStartError) => error.cause instanceof CircularPluginDependencyError,
      );

    const dishonest = definePlugin({ name: "dishonest", provides: [one], setup() {} });
    await expect(new Kernel().start([plugin(dishonest, undefined)]))
      .rejects.toSatisfy((error: PluginStartError) => {
        const nested = error.cause;
        return nested instanceof PluginStartError
          ? nested.cause instanceof MissingProvidedServiceError
          : nested instanceof MissingProvidedServiceError;
      });
  });

  it("rejects undeclared services and duplicate instance ids", async () => {
    const service = createServiceToken<string>("service");
    const undeclared = definePlugin({
      name: "undeclared",
      setup(ctx) {
        ctx.provide(service, "nope");
      },
    });
    await expect(new Kernel().start([plugin(undeclared, undefined)]))
      .rejects.toSatisfy((error: PluginStartError) => {
        const nested = error.cause;
        return nested instanceof PluginStartError
          ? nested.cause instanceof UndeclaredServiceError
          : nested instanceof UndeclaredServiceError;
      });

    const repeatable = definePlugin({ name: "repeatable", setup() {} });
    await expect(new Kernel().start([
      plugin(repeatable, undefined, { id: "same" }),
      plugin(repeatable, undefined, { id: "same" }),
    ])).rejects.toSatisfy(
      (error: PluginStartError) => error.cause instanceof DuplicatePluginIdError,
    );
  });

  it("reconfigures a live graph and disposes the previous graph in dependency order", async () => {
    const value = createServiceToken<string>("dynamic-value"); const order: string[] = [];
    const provider = (name: string) => definePlugin({ name, provides: [value], setup(ctx) { order.push(`start:${name}`); ctx.provide(value, name); return () => { order.push(`stop:${name}`); }; } });
    const consumer = definePlugin({ name: "consumer", requires: [value], setup(ctx) { order.push(`consume:${ctx.use(value)}`); return () => { order.push("stop:consumer"); }; } });
    const kernel = new Kernel(); await kernel.start([plugin(provider("one"), undefined), plugin(consumer, undefined)]);
    await kernel.reconfigure([plugin(provider("two"), undefined), plugin(consumer, undefined)]);
    expect(kernel.pluginIds).toEqual(["two", "consumer"]); expect(kernel.use(value)).toBe("two");
    expect(order).toEqual(["start:one", "consume:one", "stop:consumer", "stop:one", "start:two", "consume:two"]);
    await kernel.stop();
  });

  it("retains the unchanged prefix and restarts only the changed plugin and its downstream", async () => {
    const value = createServiceToken<string>("retained-value"); const order: string[] = [];
    const stable = definePlugin({ name: "stable-prefix", provides: [value], setup(ctx, config: { value: string }) { order.push(`start:stable:${config.value}`); ctx.provide(value, config.value); return () => { order.push("stop:stable"); }; } });
    const leaf = definePlugin({ name: "changing-leaf", requires: [value], setup(ctx, config: { value: string }) { order.push(`start:leaf:${ctx.use(value)}:${config.value}`); return () => { order.push(`stop:leaf:${config.value}`); }; } });
    const kernel = new Kernel(); await kernel.start([plugin(stable, { value: "same" }), plugin(leaf, { value: "one" })]);
    await kernel.reconfigure([plugin(stable, { value: "same" }), plugin(leaf, { value: "two" })]);
    expect(order).toEqual(["start:stable:same", "start:leaf:same:one", "stop:leaf:one", "start:leaf:same:two"]);
    expect(kernel.use(value)).toBe("same");
    await kernel.stop();
    expect(order.slice(-2)).toEqual(["stop:leaf:two", "stop:stable"]);
  });

  it("preserves the stable prefix while rolling back a failed suffix", async () => {
    const value = createServiceToken<string>("partial-rollback-value"); const order: string[] = [];
    const stable = definePlugin({ name: "partial-stable", provides: [value], setup(ctx) { order.push("start:stable"); ctx.provide(value, "stable"); return () => { order.push("stop:stable"); }; } });
    const oldLeaf = definePlugin({ name: "partial-old", requires: [value], setup(ctx) { order.push(`start:old:${ctx.use(value)}`); return () => { order.push("stop:old"); }; } });
    const brokenLeaf = definePlugin({ name: "partial-broken", requires: [value], setup(ctx) { order.push(`start:broken:${ctx.use(value)}`); throw new Error("suffix failed"); } });
    const kernel = new Kernel(); const stableSpec = plugin(stable, undefined); await kernel.start([stableSpec, plugin(oldLeaf, undefined)]);
    await expect(kernel.reconfigure([stableSpec, plugin(brokenLeaf, undefined)])).rejects.toMatchObject({ name: "PluginStartError", pluginId: "$reconfigure" });
    expect(kernel.state).toBe("running"); expect(kernel.pluginIds).toEqual(["partial-stable", "partial-old"]); expect(kernel.use(value)).toBe("stable");
    expect(order).toEqual(["start:stable", "start:old:stable", "stop:old", "start:broken:stable", "start:old:stable"]);
    await kernel.stop();
  });

  it("compares cyclic plain-object configs without overflowing", async () => {
    let starts = 0; const configured = definePlugin({ name: "cyclic-config", setup() { starts += 1; } });
    const first: Record<string, unknown> = { value: 1 }; first.self = first;
    const second: Record<string, unknown> = { value: 1 }; second.self = second;
    const kernel = new Kernel(); await kernel.start([plugin(configured, first)]);
    await kernel.reconfigure([plugin(configured, second)]);
    expect(starts).toBe(1);
    await kernel.stop();
  });

  it("restores the previous live graph when reconfiguration fails", async () => {
    const value = createServiceToken<string>("rollback-value"); let starts = 0;
    const stable = definePlugin({ name: "stable", provides: [value], setup(ctx) { starts += 1; ctx.provide(value, `stable-${starts}`); } });
    const broken = definePlugin({ name: "broken", setup() { throw new Error("broken graph"); } });
    const kernel = new Kernel(); await kernel.start([plugin(stable, undefined)]);
    await expect(kernel.reconfigure([plugin(broken, undefined)])).rejects.toMatchObject({ name: "PluginStartError", pluginId: "$reconfigure" });
    expect(kernel.state).toBe("running"); expect(kernel.pluginIds).toEqual(["stable"]); expect(kernel.use(value)).toBe("stable-2");
    await kernel.stop();
  });
});
