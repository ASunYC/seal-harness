import { Context as CordisContext, Service as CordisService } from "@deepseek-ai/cordis";
import {
  toolCallId,
  type JsonObject,
  type ModelToolDefinition,
  type ToolDefinition,
  type ToolExecutionRequest,
  type ToolResult,
  type ToolService,
} from "@seal-harness/core";
import { toolServiceToken } from "@seal-harness/core";
import { Kernel, plugin } from "@seal-harness/kernel";
import { describe, expect, it, vi } from "vitest";
import {
  dshCompatPlugin,
  dshCompatServiceToken,
  type DshPluginModule,
} from "../src/index.js";

class RecordingTools implements ToolService {
  readonly definitionsByName = new Map<string, ToolDefinition>();

  register(tool: ToolDefinition): () => void {
    this.definitionsByName.set(tool.name, tool);
    return () => {
      if (this.definitionsByName.get(tool.name) === tool) this.definitionsByName.delete(tool.name);
    };
  }

  definitions(): readonly ModelToolDefinition[] {
    return [...this.definitionsByName.values()].map((tool) => ({
      name: tool.name,
      description: tool.description,
      inputSchema: tool.inputSchema,
    }));
  }

  async execute(_request: ToolExecutionRequest): Promise<ToolResult> {
    throw new Error("not used");
  }
}

describe("dshCompatPlugin", () => {
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
          async execute(argumentsValue: unknown, execution: { signal: AbortSignal }) {
            execution.signal.throwIfAborted();
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
      details: { value: "ok", dsh: { deferredContexts: [], concludesTurn: false } },
    });

    await kernel.stop();
    expect(tools.definitionsByName.size).toBe(0);
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
