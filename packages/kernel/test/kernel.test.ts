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
});
