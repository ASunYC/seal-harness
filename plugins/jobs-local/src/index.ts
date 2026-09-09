import {
  agentServiceToken,
  jobServiceToken,
  messageId,
  sessionStoreToken,
  SessionConflictError,
  text,
  toolServiceToken,
  type AgentService,
  type JobHooks,
  type JobRead,
  type JobService,
  type JobSnapshot,
  type JobStart,
  type JobStatus,
  type JsonObject,
  type SealHarnessEvents,
  type SessionId,
  type SessionStore,
  type ToolDefinition,
  type UserMessage,
} from "@seal-harness/core";
import { definePlugin } from "@seal-harness/kernel";

export interface LocalJobsConfig {
  readonly maxConcurrentJobsPerOwner?: number;
  readonly defaultWaitTimeoutMs?: number;
  readonly maxWaitTimeoutMs?: number;
  /** Whether a completed job starts an Agent turn when its owner is idle. */
  readonly completionDelivery?: "quiet" | "wakeup";
  /** Maximum consecutive completion-triggered turns before delivery degrades to quiet injection. */
  readonly maxConsecutiveWakes?: number;
  readonly now?: () => number;
}

interface TrackedJob {
  readonly id: string;
  readonly kind: string;
  readonly label: string;
  readonly ownerSession?: SessionId;
  readonly outputLimitBytes?: number;
  readonly hooks: JobHooks;
  readonly startedAt: number;
  status: JobStatus;
  detail?: string;
  finishedAt?: number;
  readonly settled: Promise<void>;
  settle(): void;
}

export class LocalJobService implements JobService {
  readonly #jobs = new Map<string, TrackedJob>();
  readonly #counters = new Map<string, number>();
  readonly #listeners = new Set<(ownerSession: SessionId | undefined) => void>();

  constructor(
    readonly maxConcurrentJobsPerOwner = 8,
    readonly maxWaitTimeoutMs = 600_000,
    readonly now: () => number = Date.now,
    readonly onCompleted?: (job: JobSnapshot) => void | Promise<void>,
  ) {}

  start(spec: JobStart): string {
    const kind = nonEmpty(spec.kind, "job kind");
    const label = nonEmpty(spec.label, "job label");
    if (spec.outputLimitBytes !== undefined) positive(spec.outputLimitBytes, "outputLimitBytes");
    const active = [...this.#jobs.values()].filter(job =>
      job.ownerSession === spec.ownerSession && !terminal(job.status)).length;
    if (active >= this.maxConcurrentJobsPerOwner) {
      throw new Error(`background job limit reached for this owner (limit: ${this.maxConcurrentJobsPerOwner})`);
    }
    const hooks = spec.run();
    const count = (this.#counters.get(kind) ?? 0) + 1;
    this.#counters.set(kind, count);
    const id = `${kind}-${count}`;
    let settle!: () => void;
    const settled = new Promise<void>(resolve => { settle = resolve; });
    const job: TrackedJob = {
      id, kind, label, hooks, startedAt: this.now(), status: "running", settled, settle,
      ...(spec.ownerSession === undefined ? {} : { ownerSession: spec.ownerSession }),
      ...(spec.outputLimitBytes === undefined ? {} : { outputLimitBytes: spec.outputLimitBytes }),
    };
    this.#jobs.set(id, job);
    this.#publish(job.ownerSession);
    void hooks.done.then(
      outcome => this.finish(job, outcome.status, outcome.detail),
      error => this.finish(job, "failed", error instanceof Error ? error.message : String(error)),
    );
    return id;
  }

  list(ownerSession?: SessionId): readonly JobSnapshot[] {
    return [...this.#jobs.values()]
      .filter(job => job.ownerSession === undefined || job.ownerSession === ownerSession)
      .map(job => this.snapshot(job));
  }

  get(id: string, ownerSession?: SessionId): JobSnapshot {
    return this.snapshot(this.requireAccessible(id, ownerSession));
  }

  read(id: string, ownerSession?: SessionId): JobRead {
    const job = this.requireAccessible(id, ownerSession);
    const raw = job.hooks.readOutput?.() ?? "";
    return { job: this.snapshot(job), output: truncateUtf8(raw, job.outputLimitBytes) };
  }

  async wait(id: string, timeoutMs: number, ownerSession?: SessionId, signal?: AbortSignal): Promise<JobSnapshot> {
    const job = this.requireAccessible(id, ownerSession);
    positive(timeoutMs, "timeoutMs");
    if (!terminal(job.status)) await wait(job.settled, Math.min(timeoutMs, this.maxWaitTimeoutMs), signal);
    return this.snapshot(job);
  }

  cancel(id: string, ownerSession?: SessionId, reason?: string): JobSnapshot {
    const job = this.requireAccessible(id, ownerSession);
    if (terminal(job.status)) return this.snapshot(job);
    job.status = "stopping";
    this.#publish(job.ownerSession);
    try {
      job.hooks.cancel(reason);
    } catch (error) {
      this.finish(job, "failed", error instanceof Error ? error.message : String(error));
      throw error;
    }
    return this.snapshot(job);
  }

  async dispose(): Promise<void> {
    const active = [...this.#jobs.values()].filter(job => !terminal(job.status));
    for (const job of active) {
      try { this.cancel(job.id, job.ownerSession, "Job service stopped"); }
      catch { /* settlement was recorded by cancel */ }
    }
    await Promise.all(active.map(job => job.settled));
  }

  subscribe(listener: (ownerSession: SessionId | undefined) => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  private finish(job: TrackedJob, status: "completed" | "failed" | "cancelled", detail?: string): void {
    if (terminal(job.status)) return;
    job.status = status;
    job.finishedAt = this.now();
    if (detail !== undefined) job.detail = detail;
    this.#publish(job.ownerSession);
    job.settle();
    try {
      void Promise.resolve(this.onCompleted?.(this.snapshot(job))).catch(() => {});
    } catch { /* completion delivery must not corrupt the job registry */ }
  }

  #publish(ownerSession: SessionId | undefined): void {
    for (const listener of this.#listeners) listener(ownerSession);
  }

  private requireAccessible(id: string, ownerSession?: SessionId): TrackedJob {
    const job = this.#jobs.get(id);
    if (job === undefined) throw new Error(`background job not found: ${id}`);
    if (job.ownerSession !== undefined && job.ownerSession !== ownerSession) {
      throw new Error(`background job is not owned by this Session: ${id}`);
    }
    return job;
  }

  private snapshot(job: TrackedJob): JobSnapshot {
    return {
      id: job.id, kind: job.kind, label: job.label, status: job.status, startedAt: job.startedAt,
      ...(job.ownerSession === undefined ? {} : { ownerSession: job.ownerSession }),
      ...(job.detail === undefined ? {} : { detail: job.detail }),
      ...(job.finishedAt === undefined ? {} : { finishedAt: job.finishedAt }),
    };
  }
}

export const localJobsPlugin = definePlugin<LocalJobsConfig, SealHarnessEvents>({
  name: "jobs-local",
  provides: [jobServiceToken],
  requires: [toolServiceToken],
  optional: [agentServiceToken, sessionStoreToken],
  setup(context, config) {
    const delivery = context.has(agentServiceToken) && context.has(sessionStoreToken)
      ? new JobCompletionDelivery(
        context.use(agentServiceToken),
        context.use(sessionStoreToken),
        config.completionDelivery ?? "wakeup",
        nonNegative(config.maxConsecutiveWakes ?? 3, "maxConsecutiveWakes"),
      )
      : undefined;
    const service = new LocalJobService(
      positive(config.maxConcurrentJobsPerOwner ?? 8, "maxConcurrentJobsPerOwner"),
      positive(config.maxWaitTimeoutMs ?? 600_000, "maxWaitTimeoutMs"),
      config.now ?? Date.now,
      (job) => delivery?.deliver(job),
    );
    context.provide(jobServiceToken, service);
    for (const tool of jobTools(
      service,
      positive(config.defaultWaitTimeoutMs ?? 30_000, "defaultWaitTimeoutMs"),
      positive(config.maxWaitTimeoutMs ?? 600_000, "maxWaitTimeoutMs"),
    )) {
      context.effect(context.use(toolServiceToken).register(tool));
    }
    context.effect(() => service.dispose());
    if (delivery !== undefined) {
      context.on("session.appended", ({ sessionId, events }) => {
        if (events.some(({ event }) => event.type === "message.appended" && event.payload.message.role === "user" && isHumanSource(event.payload.message.source?.kind))) {
          delivery.reset(sessionId);
        }
      });
    }
  },
});

export class JobCompletionDelivery {
  readonly #wakeCounts = new Map<SessionId, number>();

  constructor(
    readonly agents: AgentService,
    readonly sessions: SessionStore,
    readonly mode: "quiet" | "wakeup" = "wakeup",
    readonly maxConsecutiveWakes = 3,
  ) {}

  reset(sessionId: SessionId): void { this.#wakeCounts.delete(sessionId); }

  async deliver(job: JobSnapshot): Promise<void> {
    const owner = job.ownerSession;
    if (owner === undefined) return;
    const message = {
      id: messageId(`job-completion-${job.id}-${job.finishedAt ?? Date.now()}`),
      role: "user" as const,
      content: [text(`Background job ${statusLine(job)}`)],
      source: { kind: "job-completion", jobId: job.id },
    };
    const active = this.agents.active?.(owner);
    if (active !== undefined) { active.followUp(message); return; }

    const count = this.#wakeCounts.get(owner) ?? 0;
    if (this.mode === "quiet" || count >= this.maxConsecutiveWakes) {
      await this.appendQuiet(owner, message);
      return;
    }

    const session = await this.sessions.read(owner);
    if (session === undefined) return;
    const newlyActive = this.agents.active?.(owner);
    if (newlyActive !== undefined) { newlyActive.followUp(message); return; }
    const created = session.events.find((stored) => stored.event.type === "session.created")?.event;
    const started = [...session.events].reverse().find((stored) => stored.event.type === "run.started")?.event;
    if (created?.type !== "session.created" || started?.type !== "run.started") {
      await this.appendQuiet(owner, message);
      return;
    }
    this.#wakeCounts.set(owner, count + 1);
    try {
      const execution = await this.agents.prompt({
        sessionId: owner,
        cwd: created.payload.cwd,
        model: started.payload.model,
        prompt: message.content,
        promptMessageId: message.id,
        promptSource: message.source,
        ...(started.payload.reasoning === undefined ? {} : { reasoning: started.payload.reasoning }),
        ...(started.payload.maxTokens === undefined ? {} : { maxTokens: started.payload.maxTokens }),
      });
      void execution.result.catch(() => {});
    } catch {
      this.#wakeCounts.set(owner, count);
      await this.appendQuiet(owner, message);
    }
  }

  private async appendQuiet(owner: SessionId, message: UserMessage): Promise<void> {
    for (;;) {
      const active = this.agents.active?.(owner);
      if (active !== undefined) { active.followUp(message); return; }
      const session = await this.sessions.read(owner);
      if (session === undefined) return;
      try {
        await this.sessions.append({ id: owner, expectedVersion: session.version, events: [{ type: "message.appended", payload: { messageId: message.id!, message } }] });
        return;
      } catch (error) {
        if (!(error instanceof SessionConflictError)) throw error;
      }
    }
  }
}

function jobTools(service: JobService, defaultWaitMs: number, maxWaitMs: number): ToolDefinition[] {
  return [
    {
      name: "job_list",
      description: "List background jobs owned by this Session.",
      inputSchema: objectSchema({}, []),
      classify: (_input, context) => action("job_list", "List background jobs", context.cwd),
      async execute(_input, context) {
        const jobs = service.list(context.sessionId);
        return { content: [text(jobs.length === 0 ? "(no background jobs)" : jobs.map(statusLine).join("\n"))], details: jobs.map(jsonJob) };
      },
    },
    {
      name: "job_output",
      description: "Read new output from a background job and show its status.",
      inputSchema: objectSchema({
        job_id: stringSchema("Background job id"),
        wait: { type: "boolean", description: "Wait for the job to finish before reading output" },
        timeout_ms: { type: "integer", minimum: 1, description: "Maximum time to wait in milliseconds" },
      }, ["job_id"]),
      classify: (_input, context) => action("job_output", "Read background job output", context.cwd),
      async execute(input, context) {
        const id = requiredString(input, "job_id");
        if (input.wait === true) {
          const requestedTimeout = typeof input.timeout_ms === "number" ? input.timeout_ms : defaultWaitMs;
          await service.wait(id, Math.min(requestedTimeout, maxWaitMs), context.sessionId, context.signal);
        }
        const read = service.read(id, context.sessionId);
        return { content: [text(`${read.output}${read.output ? "\n" : ""}${statusLine(read.job)}`)], details: { job: jsonJob(read.job), output: read.output } };
      },
    },
    {
      name: "job_wait",
      description: "Wait for a background job to finish or until the timeout, then return its status.",
      inputSchema: objectSchema({ job_id: stringSchema("Background job id"), timeout_ms: { type: "integer", minimum: 1 } }, ["job_id"]),
      classify: (_input, context) => action("job_wait", "Wait for a background job", context.cwd),
      async execute(input, context) {
        const job = await service.wait(requiredString(input, "job_id"), typeof input.timeout_ms === "number" ? input.timeout_ms : defaultWaitMs, context.sessionId, context.signal);
        return { content: [text(statusLine(job))], details: jsonJob(job) };
      },
    },
    {
      name: "job_kill",
      description: "Request cancellation of a background job owned by this Session.",
      inputSchema: objectSchema({
        job_id: stringSchema("Background job id"),
        reason: stringSchema("Reason for cancelling the job"),
      }, ["job_id"]),
      classify: (_input, context) => action("job_kill", "Cancel a background job", context.cwd),
      async execute(input, context) {
        const reason = typeof input.reason === "string" && input.reason.length > 0 ? input.reason : "Cancelled by owning Agent";
        const job = service.cancel(requiredString(input, "job_id"), context.sessionId, reason);
        return { content: [text(statusLine(job))], details: jsonJob(job) };
      },
    },
  ];
}

function statusLine(job: JobSnapshot): string {
  return `${job.id} · ${job.kind} · ${job.label} [status: ${job.status}${job.detail ? `, ${job.detail}` : ""}]`;
}

function jsonJob(job: JobSnapshot): JsonObject {
  return {
    id: job.id, kind: job.kind, label: job.label, status: job.status, startedAt: job.startedAt,
    ...(job.ownerSession === undefined ? {} : { ownerSession: job.ownerSession }),
    ...(job.detail === undefined ? {} : { detail: job.detail }),
    ...(job.finishedAt === undefined ? {} : { finishedAt: job.finishedAt }),
  };
}

async function wait(settled: Promise<void>, timeoutMs: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted === true) throw signal.reason ?? new Error("wait aborted");
  await new Promise<void>((resolve, reject) => {
    let timer: ReturnType<typeof setTimeout>;
    const finish = (): void => { clearTimeout(timer); signal?.removeEventListener("abort", abort); resolve(); };
    const abort = (): void => { clearTimeout(timer); reject(signal?.reason ?? new Error("wait aborted")); };
    timer = setTimeout(finish, timeoutMs);
    signal?.addEventListener("abort", abort, { once: true });
    void settled.then(finish, finish);
  });
}

function terminal(status: JobStatus): boolean { return status === "completed" || status === "failed" || status === "cancelled"; }
function nonEmpty(value: string, name: string): string { if (value.trim().length === 0) throw new Error(`${name} must be non-empty`); return value; }
function positive(value: number, name: string): number { if (!Number.isSafeInteger(value) || value <= 0) throw new TypeError(`${name} must be a positive integer`); return value; }
function nonNegative(value: number, name: string): number { if (!Number.isSafeInteger(value) || value < 0) throw new TypeError(`${name} must be a non-negative integer`); return value; }
function isHumanSource(kind: unknown): boolean { return typeof kind === "string" && (kind === "user" || kind.startsWith("user-")); }
function truncateUtf8(value: string, max?: number): string { if (max === undefined || Buffer.byteLength(value) <= max) return value; return Buffer.from(value).subarray(0, max).toString("utf8"); }
function action(toolName: string, summary: string, target: string) { return { kind: "tool" as const, toolName, risk: "read" as const, summary, target }; }
function objectSchema(properties: JsonObject, required: readonly string[]): JsonObject { return { type: "object", properties, required, additionalProperties: false }; }
function stringSchema(description: string): JsonObject { return { type: "string", minLength: 1, description }; }
function requiredString(input: JsonObject, key: string): string { const value = input[key]; if (typeof value !== "string" || value.length === 0) throw new Error(`${key} must be a non-empty string`); return value; }
