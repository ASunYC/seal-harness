import { stat } from "node:fs/promises";
import { isAbsolute, resolve } from "node:path";
import {
  agentServiceToken,
  text,
  webhookRuntimeToken,
  type AgentService,
  type JsonValue,
  type ModelRef,
  type SealHarnessEvents,
  type VerifiedWebhookDelivery,
  type WebhookRule,
  type WebhookRuntime,
  type WebhookSessionRequest,
} from "@seal-harness/core";
import { definePlugin } from "@seal-harness/kernel";

export interface WebhookCoreConfig {
  readonly defaultModel?: ModelRef;
  readonly defaultReasoning?: "off" | "low" | "medium" | "high" | "max";
  readonly onError?: (error: unknown, context: { delivery: VerifiedWebhookDelivery; ruleId: string }) => void;
}

interface Registration {
  readonly rule: WebhookRule;
  readonly controller: AbortController;
  readonly active: Set<Promise<void>>;
  closing: boolean;
  disposal?: Promise<void>;
}

export class DefaultWebhookRuntime implements WebhookRuntime {
  readonly #rules = new Map<string, Registration>();
  #closing = false;

  constructor(readonly agents: AgentService, readonly config: WebhookCoreConfig = {}) {}

  register<K extends string>(rule: WebhookRule<K>): () => Promise<void> {
    if (this.#closing) throw new Error("webhook runtime is closing");
    requireText(rule.id, "webhook rule id");
    requireText(rule.kind, `webhook rule \"${rule.id}\" kind`);
    if (typeof rule.run !== "function") throw new TypeError(`webhook rule \"${rule.id}\" requires run()`);
    if (this.#rules.has(rule.id)) throw new Error(`webhook rule \"${rule.id}\" is already registered`);
    const registration: Registration = { rule: rule as WebhookRule, controller: new AbortController(), active: new Set(), closing: false };
    this.#rules.set(rule.id, registration);
    return () => this.#disposeRegistration(registration);
  }

  dispatch<K extends string>(delivery: VerifiedWebhookDelivery<K>): void {
    if (this.#closing) throw new Error("webhook runtime is closing");
    const snapshot = snapshotDelivery(delivery);
    for (const registration of [...this.#rules.values()]) {
      if (!registration.closing && registration.rule.kind === snapshot.kind) this.#start(registration, snapshot);
    }
  }

  async dispose(): Promise<void> {
    this.#closing = true;
    await Promise.all([...this.#rules.values()].map((registration) => this.#disposeRegistration(registration)));
  }

  #start(registration: Registration, delivery: VerifiedWebhookDelivery): void {
    const task = Promise.resolve().then(async () => {
      registration.controller.signal.throwIfAborted();
      const request = await registration.rule.run(delivery, registration.controller.signal);
      registration.controller.signal.throwIfAborted();
      if (request !== null) await this.#createSession(delivery, registration.rule.id, request, registration.controller.signal);
    }).catch((error: unknown) => {
      if (!registration.controller.signal.aborted) this.config.onError?.(error, { delivery, ruleId: registration.rule.id });
    }).finally(() => registration.active.delete(task));
    registration.active.add(task);
  }

  async #createSession(delivery: VerifiedWebhookDelivery, ruleId: string, request: WebhookSessionRequest, signal: AbortSignal): Promise<void> {
    requireText(request.title, "webhook Session title");
    requireText(request.prompt, "webhook Session prompt");
    if (!isAbsolute(request.workspacePath)) throw new TypeError("webhook Session workspacePath must be absolute");
    const cwd = resolve(request.workspacePath);
    if (!(await stat(cwd)).isDirectory()) throw new TypeError("webhook Session workspacePath must be an existing directory");
    const model = request.model ?? this.config.defaultModel;
    if (model === undefined) throw new Error("webhook Session has no model selection");
    requireText(model.provider, "webhook Session model provider");
    requireText(model.model, "webhook Session model id");
    const execution = await this.agents.prompt({
      cwd,
      model,
      prompt: [text(request.prompt)],
      signal,
      ...((request.reasoning ?? this.config.defaultReasoning) === undefined ? {} : { reasoning: request.reasoning ?? this.config.defaultReasoning }),
      metadata: {
        title: request.title,
        "sealHarness.webhook": { kind: delivery.kind, source: delivery.source, deliveryId: delivery.deliveryId, ruleId } as unknown as JsonValue,
      },
    });
    void execution.result.catch((error) => this.config.onError?.(error, { delivery, ruleId }));
  }

  #disposeRegistration(registration: Registration): Promise<void> {
    registration.disposal ??= (async () => {
      registration.closing = true;
      this.#rules.delete(registration.rule.id);
      registration.controller.abort(new Error(`webhook rule \"${registration.rule.id}\" was disposed`));
      while (registration.active.size > 0) await Promise.allSettled([...registration.active]);
    })();
    return registration.disposal;
  }
}

function requireText(value: unknown, label: string): asserts value is string {
  if (typeof value !== "string" || value.trim() === "") throw new TypeError(`${label} must be a non-empty string`);
}

function snapshotDelivery(delivery: VerifiedWebhookDelivery): VerifiedWebhookDelivery {
  requireText(delivery.kind, "webhook delivery kind");
  requireText(delivery.source, "webhook delivery source");
  requireText(delivery.deliveryId, "webhook delivery id");
  if (!Number.isSafeInteger(delivery.receivedAt) || delivery.receivedAt < 0) throw new TypeError("webhook delivery receivedAt must be a non-negative safe integer");
  if (!isJsonValue(delivery.event)) throw new TypeError("webhook delivery must be lossless JSON");
  let value: unknown;
  try { value = JSON.parse(JSON.stringify(delivery)); } catch { throw new TypeError("webhook delivery must be lossless JSON"); }
  if (value === undefined || JSON.stringify(value) !== JSON.stringify(delivery)) throw new TypeError("webhook delivery must be lossless JSON");
  return deepFreeze(value) as VerifiedWebhookDelivery;
}

function isJsonValue(value: unknown, seen = new Set<object>()): value is JsonValue {
  if (value === null || typeof value === "string" || typeof value === "boolean") return true;
  if (typeof value === "number") return Number.isFinite(value);
  if (typeof value !== "object" || seen.has(value)) return false;
  seen.add(value);
  const valid = Array.isArray(value)
    ? value.every((item) => isJsonValue(item, seen))
    : Object.getPrototypeOf(value) === Object.prototype && Object.values(value).every((item) => isJsonValue(item, seen));
  seen.delete(value);
  return valid;
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object") {
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

export const webhookCorePlugin = definePlugin<WebhookCoreConfig, SealHarnessEvents>({
  name: "webhook-core",
  provides: [webhookRuntimeToken],
  requires: [agentServiceToken],
  setup(context, config) {
    const runtime = new DefaultWebhookRuntime(context.use(agentServiceToken), config);
    context.provide(webhookRuntimeToken, runtime);
    return () => runtime.dispose();
  },
});
