import { createInterface } from "node:readline";
import {
  agentServiceToken,
  modelServiceToken,
  sessionId,
  sessionStoreToken,
  text,
  type AgentPromptRequest,
  type JsonObject,
  type JsonValue,
} from "@piharness/core";
import type { Profile } from "@piharness/host";
import { startProfile } from "@piharness/host";

export interface RpcIo {
  readonly input: NodeJS.ReadableStream;
  readonly output: { write(value: string): unknown };
}

interface RpcRequest {
  readonly id: string | number | null;
  readonly method: string;
  readonly params?: JsonObject;
}

export async function runRpcServer(profile: Profile, io: RpcIo): Promise<void> {
  const kernel = await startProfile(profile);
  const lines = createInterface({ input: io.input, crlfDelay: Infinity });
  try {
    for await (const line of lines) {
      if (line.trim().length === 0) continue;
      let request: RpcRequest;
      try {
        request = parseRequest(line);
      } catch (error) {
        write(io, { id: null, error: message(error) });
        continue;
      }

      try {
        if (request.method === "shutdown") {
          write(io, { id: request.id, result: { stopped: true } });
          break;
        }
        const result = await dispatch(kernel, request, io);
        write(io, { id: request.id, result });
      } catch (error) {
        write(io, { id: request.id, error: message(error) });
      }
    }
  } finally {
    lines.close();
    await kernel.stop();
  }
}

async function dispatch(
  kernel: import("@piharness/kernel").Kernel<any>,
  request: RpcRequest,
  io: RpcIo,
): Promise<JsonValue> {
  if (request.method === "listModels") {
    return await kernel.use(modelServiceToken).list() as unknown as JsonValue;
  }
  if (request.method === "listSessions") {
    const sessions = await kernel.use(sessionStoreToken).list();
    return sessions.map(({ id, version }) => ({ id, version }));
  }
  if (request.method === "fork") {
    const params = requiredParams(request);
    const targetSessionId = optionalStringParam(params, "targetSessionId");
    const throughVersion = optionalNumberParam(params, "throughVersion");
    const fork = await kernel.use(agentServiceToken).fork({
      sourceSessionId: sessionId(stringParam(params, "sourceSessionId")),
      ...(targetSessionId === undefined ? {} : { targetSessionId: sessionId(targetSessionId) }),
      ...(throughVersion === undefined ? {} : { throughVersion }),
    });
    return { id: fork.id, version: fork.version };
  }
  if (request.method === "prompt") {
    const params = requiredParams(request);
    const promptRequest: AgentPromptRequest = {
      cwd: stringParam(params, "cwd"),
      model: {
        provider: stringParam(params, "provider"),
        model: stringParam(params, "model"),
      },
      prompt: [text(stringParam(params, "prompt"))],
      ...(optionalStringParam(params, "sessionId") === undefined
        ? {}
        : { sessionId: sessionId(optionalStringParam(params, "sessionId") ?? "") }),
      ...(optionalStringParam(params, "reasoning") === undefined
        ? {}
        : { reasoning: reasoningParam(params) }),
    };
    const execution = await kernel.use(agentServiceToken).prompt(promptRequest);
    for await (const event of execution) {
      write(io, {
        method: "event",
        params: { requestId: request.id, sessionId: execution.sessionId, event },
      });
    }
    const completed = await execution.result;
    return {
      sessionId: execution.sessionId,
      runId: execution.runId,
      stopReason: completed.runtime.stopReason,
      ...(completed.runtime.errorMessage === undefined
        ? {}
        : { errorMessage: completed.runtime.errorMessage }),
    };
  }
  throw new Error(`Unknown RPC method: ${request.method}`);
}

function parseRequest(line: string): RpcRequest {
  const value = JSON.parse(line) as unknown;
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("RPC request must be an object");
  }
  const record = value as Record<string, unknown>;
  if (!(typeof record.id === "string" || typeof record.id === "number" || record.id === null)) {
    throw new Error("RPC id must be a string, number, or null");
  }
  if (typeof record.method !== "string") throw new Error("RPC method must be a string");
  if (record.params !== undefined && (typeof record.params !== "object" || record.params === null || Array.isArray(record.params))) {
    throw new Error("RPC params must be an object");
  }
  return {
    id: record.id,
    method: record.method,
    ...(record.params === undefined ? {} : { params: record.params as JsonObject }),
  };
}

function requiredParams(request: RpcRequest): JsonObject {
  if (request.params === undefined) throw new Error(`${request.method} requires params`);
  return request.params;
}

function stringParam(params: JsonObject, name: string): string {
  const value = params[name];
  if (typeof value !== "string" || value.length === 0) throw new Error(`${name} must be a non-empty string`);
  return value;
}

function optionalStringParam(params: JsonObject, name: string): string | undefined {
  const value = params[name];
  if (value === undefined) return undefined;
  if (typeof value !== "string" || value.length === 0) throw new Error(`${name} must be a non-empty string`);
  return value;
}

function optionalNumberParam(params: JsonObject, name: string): number | undefined {
  const value = params[name];
  if (value === undefined) return undefined;
  if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }
  return value;
}

function reasoningParam(params: JsonObject): "off" | "low" | "medium" | "high" | "max" {
  const value = stringParam(params, "reasoning");
  if (value === "off" || value === "low" || value === "medium" || value === "high" || value === "max") {
    return value;
  }
  throw new Error(`Invalid reasoning level: ${value}`);
}

function write(io: RpcIo, value: unknown): void {
  io.output.write(`${JSON.stringify(value)}\n`);
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
