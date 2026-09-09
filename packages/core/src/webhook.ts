import type { IncomingMessage, ServerResponse } from "node:http";
import type { Duplex } from "node:stream";
import type { JsonValue } from "./json.js";
import type { ModelRef } from "./model.js";

export interface VerifiedWebhookDelivery<K extends string = string> {
  readonly kind: K;
  readonly source: string;
  readonly deliveryId: string;
  readonly event: JsonValue;
  readonly receivedAt: number;
}

export interface WebhookSessionRequest {
  readonly workspacePath: string;
  readonly title: string;
  readonly prompt: string;
  readonly model?: ModelRef;
  readonly reasoning?: "off" | "low" | "medium" | "high" | "max";
}

export interface WebhookRule<K extends string = string> {
  readonly id: string;
  readonly kind: K;
  run(delivery: Readonly<VerifiedWebhookDelivery<K>>, signal: AbortSignal): WebhookSessionRequest | null | Promise<WebhookSessionRequest | null>;
}

export interface WebhookRuntime {
  register<K extends string>(rule: WebhookRule<K>): () => Promise<void>;
  dispatch<K extends string>(delivery: VerifiedWebhookDelivery<K>): void;
}

export interface WebRoute {
  readonly kind: "exact" | "prefix";
  readonly path: string;
  handler(request: IncomingMessage, response: ServerResponse): void | Promise<void>;
}

export interface WebRouteService {
  register(route: WebRoute): () => void;
  registerUpgrade?(route: WebUpgradeRoute): () => void;
}

export interface WebUpgradeRoute {
  readonly path: string;
  handler(request: IncomingMessage, socket: Duplex, head: Buffer): void;
}
