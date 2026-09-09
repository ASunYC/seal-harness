import { resolve } from "node:path";
import { spawn, type IPty } from "node-pty";
import {
  jobServiceToken,
  terminalServiceToken,
  sandboxServiceToken,
  permissionPresetServiceToken,
  text,
  toolServiceToken,
  type JobOutcome,
  type JobService,
  type JsonObject,
  type OpenTerminalRequest,
  type SealHarnessEvents,
  type SessionId,
  type TerminalRead,
  type TerminalService,
  type TerminalSnapshot,
  type ToolDefinition,
  type SandboxMode,
  type SandboxService,
  type PermissionPresetService,
} from "@seal-harness/core";
import { definePlugin } from "@seal-harness/kernel";

export interface TerminalPtyConfig {
  readonly maxOutputBytes?: number;
  readonly maxTerminalsPerOwner?: number;
  readonly shell?: string;
  readonly shellArgs?: readonly string[];
  readonly environment?: Readonly<Record<string, string | undefined>>;
  readonly now?: () => number;
  readonly sandboxMode?: SandboxMode;
}

export interface PtyProcess {
  readonly pid: number;
  write(data: string): void;
  kill(): void;
  onData(listener: (data: string) => void): { dispose(): void };
  onExit(listener: (event: { exitCode: number; signal?: number }) => void): { dispose(): void };
}

export type PtyFactory = (
  file: string,
  args: readonly string[],
  options: { cwd: string; cols: number; rows: number; env: Record<string, string> },
) => PtyProcess;

interface TerminalRecord {
  readonly id: string;
  readonly ownerSession: SessionId;
  readonly cwd: string;
  readonly process: PtyProcess;
  readonly startedAt: number;
  jobId: string;
  status: "running" | "exited";
  exitCode?: number;
  signal?: number;
  finishedAt?: number;
  output: string;
  readonly done: Promise<JobOutcome>;
  readonly sandbox?: TerminalSnapshot["sandbox"];
  finish(outcome: JobOutcome): void;
}

export class PtyTerminalService implements TerminalService {
  readonly #terminals = new Map<string, TerminalRecord>();
  #counter = 0;

  constructor(
    readonly jobs: JobService,
    readonly factory: PtyFactory = spawnPty,
    readonly options: Required<Pick<TerminalPtyConfig, "maxOutputBytes" | "maxTerminalsPerOwner">>
      & Omit<TerminalPtyConfig, "maxOutputBytes" | "maxTerminalsPerOwner"> = {
        maxOutputBytes: 256 * 1024,
        maxTerminalsPerOwner: 4,
      },
    readonly sandbox: SandboxService | undefined = undefined,
    readonly sandboxMode: SandboxMode = sandbox === undefined ? "danger-full-access" : "workspace-write",
    readonly permissions: PermissionPresetService | undefined = undefined,
  ) {}

  open(request: OpenTerminalRequest): TerminalSnapshot {
    const active = this.list(request.ownerSession).filter(item => item.status === "running");
    if (active.length >= this.options.maxTerminalsPerOwner) {
      throw new Error(`terminal limit reached for this Session (limit: ${this.options.maxTerminalsPerOwner})`);
    }
    const cwd = resolve(request.cwd);
    const shell = this.options.shell ?? defaultShell();
    const args = this.options.shellArgs ?? [];
    const sandboxMode = this.permissions?.sandboxMode(request.ownerSession) ?? this.sandboxMode;
    const confined = sandboxMode === "danger-full-access" ? undefined : this.sandbox?.confine([shell, ...args], {
      mode: sandboxMode,
      workspaceRoot: cwd,
      sessionId: request.ownerSession,
    });
    if (sandboxMode !== "danger-full-access" && confined === undefined) throw new Error(`sandbox mode "${sandboxMode}" requested but no SandboxService is available`);
    const executable = confined?.argv[0] ?? shell;
    if (executable === undefined) throw new Error("resolved terminal command is empty");
    const process = this.factory(executable, confined?.argv.slice(1) ?? args, {
      cwd,
      cols: dimension(request.cols ?? 120, "cols"),
      rows: dimension(request.rows ?? 30, "rows"),
      env: terminalEnvironment(this.options.environment),
    });
    const id = `terminal-${++this.#counter}`;
    let finish!: (outcome: JobOutcome) => void;
    const done = new Promise<JobOutcome>(resolveDone => { finish = resolveDone; });
    const terminal: TerminalRecord = {
      id,
      ownerSession: request.ownerSession,
      cwd,
      process,
      startedAt: (this.options.now ?? Date.now)(),
      jobId: "",
      status: "running",
      output: "",
      done,
      finish,
      sandbox: { mode: sandboxMode, ...(confined === undefined ? {} : { enforcement: confined.enforcement }) },
    };
    this.#terminals.set(id, terminal);
    process.onData(data => { terminal.output = retainTail(terminal.output + data, this.options.maxOutputBytes); });
    process.onExit(event => {
      if (terminal.status === "exited") return;
      terminal.status = "exited";
      terminal.exitCode = event.exitCode;
      if (event.signal !== undefined) terminal.signal = event.signal;
      terminal.finishedAt = (this.options.now ?? Date.now)();
      terminal.finish(event.exitCode === 0
        ? { status: "completed", detail: `exit ${event.exitCode}` }
        : { status: "failed", detail: `exit ${event.exitCode}` });
    });
    terminal.jobId = this.jobs.start({
      kind: "terminal",
      label: request.command?.trim() || shell,
      ownerSession: request.ownerSession,
      outputLimitBytes: this.options.maxOutputBytes,
      run: () => ({
        cancel: () => { if (terminal.status === "running") terminal.process.kill(); },
        done: terminal.done,
        readOutput: () => this.consume(terminal),
      }),
    });
    if (request.command !== undefined && request.command.length > 0) process.write(`${request.command}\r`);
    return this.snapshot(terminal);
  }

  list(ownerSession: SessionId): readonly TerminalSnapshot[] {
    return [...this.#terminals.values()]
      .filter(terminal => terminal.ownerSession === ownerSession)
      .map(terminal => this.snapshot(terminal));
  }

  get(id: string, ownerSession: SessionId): TerminalSnapshot {
    return this.snapshot(this.requireOwned(id, ownerSession));
  }

  write(id: string, ownerSession: SessionId, data: string): TerminalSnapshot {
    const terminal = this.requireOwned(id, ownerSession);
    if (terminal.status !== "running") throw new Error(`terminal has exited: ${id}`);
    terminal.process.write(data);
    return this.snapshot(terminal);
  }

  read(id: string, ownerSession: SessionId): TerminalRead {
    const terminal = this.requireOwned(id, ownerSession);
    return { terminal: this.snapshot(terminal), output: this.consume(terminal) };
  }

  close(id: string, ownerSession: SessionId): TerminalSnapshot {
    const terminal = this.requireOwned(id, ownerSession);
    if (terminal.status === "running") terminal.process.kill();
    return this.snapshot(terminal);
  }

  async dispose(): Promise<void> {
    const active = [...this.#terminals.values()].filter(terminal => terminal.status === "running");
    for (const terminal of active) terminal.process.kill();
    await Promise.all(active.map(terminal => terminal.done));
  }

  private consume(terminal: TerminalRecord): string {
    const output = terminal.output;
    terminal.output = "";
    return output;
  }

  private requireOwned(id: string, owner: SessionId): TerminalRecord {
    const terminal = this.#terminals.get(id);
    if (terminal === undefined) throw new Error(`terminal not found: ${id}`);
    if (terminal.ownerSession !== owner) throw new Error(`terminal is not owned by this Session: ${id}`);
    return terminal;
  }

  private snapshot(terminal: TerminalRecord): TerminalSnapshot {
    return {
      id: terminal.id,
      ownerSession: terminal.ownerSession,
      cwd: terminal.cwd,
      pid: terminal.process.pid,
      status: terminal.status,
      startedAt: terminal.startedAt,
      jobId: terminal.jobId,
      ...(terminal.sandbox === undefined ? {} : { sandbox: terminal.sandbox }),
      ...(terminal.exitCode === undefined ? {} : { exitCode: terminal.exitCode }),
      ...(terminal.signal === undefined ? {} : { signal: terminal.signal }),
      ...(terminal.finishedAt === undefined ? {} : { finishedAt: terminal.finishedAt }),
    };
  }
}

export const terminalPtyPlugin = definePlugin<TerminalPtyConfig, SealHarnessEvents>({
  name: "terminal-pty",
  provides: [terminalServiceToken],
  requires: [jobServiceToken, toolServiceToken],
  optional: [sandboxServiceToken, permissionPresetServiceToken],
  setup(context, config) {
    const service = new PtyTerminalService(context.use(jobServiceToken), spawnPty, {
      maxOutputBytes: positive(config.maxOutputBytes ?? 256 * 1024, "maxOutputBytes"),
      maxTerminalsPerOwner: positive(config.maxTerminalsPerOwner ?? 4, "maxTerminalsPerOwner"),
      ...(config.shell === undefined ? {} : { shell: config.shell }),
      ...(config.shellArgs === undefined ? {} : { shellArgs: config.shellArgs }),
      ...(config.environment === undefined ? {} : { environment: config.environment }),
      ...(config.now === undefined ? {} : { now: config.now }),
    }, context.has(sandboxServiceToken) ? context.use(sandboxServiceToken) : undefined, config.sandboxMode ?? (context.has(sandboxServiceToken) ? "workspace-write" : "danger-full-access"), context.has(permissionPresetServiceToken) ? context.use(permissionPresetServiceToken) : undefined);
    context.provide(terminalServiceToken, service);
    const mode = config.sandboxMode ?? (context.has(sandboxServiceToken) ? "workspace-write" : "danger-full-access");
    for (const tool of terminalTools(service, mode)) context.effect(context.use(toolServiceToken).register(tool));
    context.effect(() => service.dispose());
  },
});

function terminalTools(service: TerminalService, mode: SandboxMode): ToolDefinition[] {
  return [
    {
      name: "terminal_start",
      description: "Start a persistent pseudo-terminal in the workspace, optionally run an initial command, and return its terminal and job ids.",
      inputSchema: objectSchema({ command: stringSchema("Optional initial shell command"), cols: integerSchema(20, 500), rows: integerSchema(5, 200) }, []),
      classify: (_input, context) => action("terminal_start", "Start a persistent terminal", context.cwd, mode === "danger-full-access" ? "dangerous" : "workspace-write"),
      async execute(input, context) {
        const command = optionalString(input, "command");
        const terminal = service.open({
          ownerSession: context.sessionId,
          cwd: context.cwd,
          ...(command === undefined ? {} : { command }),
          ...(typeof input.cols === "number" ? { cols: input.cols } : {}),
          ...(typeof input.rows === "number" ? { rows: input.rows } : {}),
        });
        return { content: [text(`Started ${terminal.id} (job ${terminal.jobId}, pid ${terminal.pid})`)], details: jsonTerminal(terminal) };
      },
    },
    {
      name: "terminal_send",
      description: "Write text to a persistent terminal; submit=true appends Enter.",
      inputSchema: objectSchema({ terminal_id: stringSchema("Terminal id"), text: { type: "string" }, submit: { type: "boolean" } }, ["terminal_id", "text"]),
      classify: (_input, context) => action("terminal_send", "Write to a persistent terminal", context.cwd, "dangerous"),
      async execute(input, context) {
        const id = requiredString(input, "terminal_id");
        const value = `${typeof input.text === "string" ? input.text : ""}${input.submit === false ? "" : "\r"}`;
        const terminal = service.write(id, context.sessionId, value);
        return { content: [text(`Sent input to ${id}`)], details: jsonTerminal(terminal) };
      },
    },
    {
      name: "terminal_read",
      description: "Read output produced by a persistent terminal since the previous terminal/job output read.",
      inputSchema: objectSchema({ terminal_id: stringSchema("Terminal id") }, ["terminal_id"]),
      classify: (_input, context) => action("terminal_read", "Read terminal output", context.cwd, "read"),
      async execute(input, context) {
        const read = service.read(requiredString(input, "terminal_id"), context.sessionId);
        return { content: [text(`${read.output}${read.output ? "\n" : ""}[status: ${read.terminal.status}]`)], details: { terminal: jsonTerminal(read.terminal), output: read.output } };
      },
    },
    {
      name: "terminal_list",
      description: "List persistent terminals owned by this Session.",
      inputSchema: objectSchema({}, []),
      classify: (_input, context) => action("terminal_list", "List persistent terminals", context.cwd, "read"),
      async execute(_input, context) {
        const terminals = service.list(context.sessionId);
        return { content: [text(terminals.length === 0 ? "(no terminals)" : terminals.map(item => `${item.id} · pid ${item.pid} · ${item.status} · job ${item.jobId}`).join("\n"))], details: terminals.map(jsonTerminal) };
      },
    },
    {
      name: "terminal_kill",
      description: "Terminate a persistent terminal owned by this Session.",
      inputSchema: objectSchema({ terminal_id: stringSchema("Terminal id") }, ["terminal_id"]),
      classify: (_input, context) => action("terminal_kill", "Terminate a persistent terminal", context.cwd, "dangerous"),
      async execute(input, context) {
        const terminal = service.close(requiredString(input, "terminal_id"), context.sessionId);
        return { content: [text(`Termination requested for ${terminal.id}`)], details: jsonTerminal(terminal) };
      },
    },
  ];
}

function spawnPty(file: string, args: readonly string[], options: { cwd: string; cols: number; rows: number; env: Record<string, string> }): IPty {
  return spawn(file, [...args], { ...options, name: "xterm-256color" });
}

function terminalEnvironment(overrides?: Readonly<Record<string, string | undefined>>): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries({ ...process.env, ...overrides })) if (value !== undefined) env[key] = value;
  env.TERM ??= "xterm-256color";
  return env;
}

function defaultShell(): string {
  return process.platform === "win32" ? process.env.COMSPEC ?? "cmd.exe" : process.env.SHELL ?? "/bin/bash";
}

function retainTail(value: string, maxBytes: number): string {
  const buffer = Buffer.from(value);
  return buffer.length <= maxBytes ? value : buffer.subarray(buffer.length - maxBytes).toString("utf8");
}

function jsonTerminal(value: TerminalSnapshot): JsonObject {
  return {
    id: value.id, ownerSession: value.ownerSession, cwd: value.cwd, pid: value.pid,
    status: value.status, startedAt: value.startedAt, jobId: value.jobId,
    ...(value.sandbox === undefined ? {} : { sandbox: { mode: value.sandbox.mode, ...(value.sandbox.enforcement === undefined ? {} : { enforcement: value.sandbox.enforcement }) } }),
    ...(value.exitCode === undefined ? {} : { exitCode: value.exitCode }),
    ...(value.signal === undefined ? {} : { signal: value.signal }),
    ...(value.finishedAt === undefined ? {} : { finishedAt: value.finishedAt }),
  };
}

function dimension(value: number, name: string): number { if (!Number.isInteger(value) || value <= 0) throw new TypeError(`${name} must be a positive integer`); return value; }
function positive(value: number, name: string): number { return dimension(value, name); }
function action(toolName: string, summary: string, target: string, risk: "read" | "workspace-write" | "dangerous") { return { kind: "tool" as const, toolName, risk, summary, target }; }
function objectSchema(properties: JsonObject, required: readonly string[]): JsonObject { return { type: "object", properties, required, additionalProperties: false }; }
function stringSchema(description: string): JsonObject { return { type: "string", description }; }
function integerSchema(minimum: number, maximum: number): JsonObject { return { type: "integer", minimum, maximum }; }
function requiredString(input: JsonObject, key: string): string { const value = input[key]; if (typeof value !== "string" || value.length === 0) throw new Error(`${key} must be a non-empty string`); return value; }
function optionalString(input: JsonObject, key: string): string | undefined { const value = input[key]; return typeof value === "string" && value.length > 0 ? value : undefined; }
