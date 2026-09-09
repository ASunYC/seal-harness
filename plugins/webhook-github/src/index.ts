import { createHmac, timingSafeEqual } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import {
  credentialServiceToken,
  webRouteServiceToken,
  webhookRuntimeToken,
  type JsonValue,
  type SealHarnessEvents,
  type VerifiedWebhookDelivery,
  type WebRoute,
} from "@seal-harness/core";
import { definePlugin } from "@seal-harness/kernel";

export interface GitHubWebhookConfig {
  readonly source: string;
  readonly path: string;
  readonly secretName: string;
  readonly credentialProvider?: string;
  readonly maxBodyBytes?: number;
}

export class WebhookHttpError extends Error {
  constructor(readonly status: 400 | 401 | 405 | 413 | 415 | 503, message: string) { super(message); }
}

export async function readBoundedUtf8Body(request: IncomingMessage, maxBodyBytes: number): Promise<string> {
  const rawLength = request.headers["content-length"];
  if (rawLength !== undefined && !/^(0|[1-9]\d*)$/.test(rawLength)) throw new WebhookHttpError(400, "invalid Content-Length");
  if (rawLength !== undefined && Number(rawLength) > maxBodyBytes) { request.resume(); throw new WebhookHttpError(413, "request body is too large"); }
  const chunks: Buffer[] = [];
  let size = 0;
  try {
    for await (const raw of request) {
      const chunk = Buffer.isBuffer(raw) ? raw : Buffer.from(raw as string);
      size += chunk.byteLength;
      if (size > maxBodyBytes) { request.resume(); throw new WebhookHttpError(413, "request body is too large"); }
      chunks.push(chunk);
    }
  } catch (error) {
    if (error instanceof WebhookHttpError) throw error;
    throw new WebhookHttpError(400, "request body was aborted");
  }
  if (!request.complete) throw new WebhookHttpError(400, "request body was aborted");
  try { return new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks, size)); }
  catch { throw new WebhookHttpError(400, "request body is not valid UTF-8"); }
}

export function createGitHubWebhookHandler(options: {
  readonly source: string;
  readonly maxBodyBytes: number;
  readonly resolveSecret: (signal: AbortSignal) => Promise<string | undefined>;
  readonly dispatch: (delivery: VerifiedWebhookDelivery<"github">) => void;
  readonly now?: () => number;
}): WebRoute["handler"] {
  return async (request, response) => {
    try {
      if (request.method !== "POST") { response.setHeader("allow", "POST"); throw new WebhookHttpError(405, "method not allowed"); }
      if (!isJsonContentType(request.headers["content-type"])) throw new WebhookHttpError(415, "content type must be application/json");
      const body = await readBoundedUtf8Body(request, options.maxBodyBytes);
      const signature = requiredHeader(request, "x-hub-signature-256");
      const deliveryId = requiredHeader(request, "x-github-delivery");
      const eventName = requiredHeader(request, "x-github-event");
      const controller = new AbortController();
      request.once("aborted", () => controller.abort());
      const secret = await options.resolveSecret(controller.signal);
      if (secret === undefined || secret === "") throw new WebhookHttpError(503, "GitHub webhook secret is unavailable");
      if (!verifySignature(secret, body, signature)) throw new WebhookHttpError(401, "invalid webhook signature");
      let parsed: unknown;
      try { parsed = JSON.parse(body); } catch { throw new WebhookHttpError(400, "request body is not valid JSON"); }
      if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) throw new WebhookHttpError(400, "GitHub webhook payload must be a JSON object");
      try {
        options.dispatch({ kind: "github", source: options.source, deliveryId, event: { name: eventName, payload: parsed } as JsonValue, receivedAt: (options.now ?? Date.now)() });
      } catch { throw new WebhookHttpError(503, "webhook runtime is unavailable"); }
      respond(response, 202);
    } catch (error) {
      if (error instanceof WebhookHttpError) { respond(response, error.status, error.message); return; }
      respond(response, 503, "webhook ingress is unavailable");
    }
  };
}

function requiredHeader(request: IncomingMessage, name: string): string {
  const values = request.headersDistinct[name];
  if (values?.length !== 1 || values[0]?.trim() === "") throw new WebhookHttpError(400, `missing ${name} header`);
  return values[0]!;
}

function isJsonContentType(value: string | undefined): boolean {
  if (value === undefined) return false;
  const [mediaType, parameter, ...extra] = value.split(";").map((part) => part.trim());
  return mediaType?.toLowerCase() === "application/json" && (parameter === undefined || (extra.length === 0 && /^charset=(?:utf-8|"utf-8")$/i.test(parameter)));
}

function verifySignature(secret: string, body: string, signature: string): boolean {
  const expected = `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`;
  const a = Buffer.from(expected);
  const b = Buffer.from(signature);
  return a.length === b.length && timingSafeEqual(a, b);
}

function respond(response: ServerResponse, status: number, message?: string): void {
  response.writeHead(status, message === undefined ? undefined : { "content-type": "text/plain; charset=utf-8" });
  response.end(message);
}

export const githubWebhookPlugin = definePlugin<GitHubWebhookConfig, SealHarnessEvents>({
  name: "webhook-github",
  requires: [webRouteServiceToken, webhookRuntimeToken, credentialServiceToken],
  setup(context, config) {
    if (config.source.trim() !== config.source || config.source === "") throw new Error("webhook-github source must be a non-empty trimmed string");
    if (!config.path.startsWith("/") || config.path === "/" || config.path.endsWith("/") || config.path.includes("?") || config.path.includes("#")) throw new Error("webhook-github path must be an absolute non-root pathname without a trailing slash, query, or fragment");
    if (!Number.isSafeInteger(config.maxBodyBytes ?? 1_048_576) || (config.maxBodyBytes ?? 1_048_576) < 1) throw new Error("webhook-github maxBodyBytes must be a positive safe integer");
    const credentials = context.use(credentialServiceToken);
    const runtime = context.use(webhookRuntimeToken);
    return context.use(webRouteServiceToken).register({
      kind: "exact",
      path: config.path,
      handler: createGitHubWebhookHandler({
        source: config.source,
        maxBodyBytes: config.maxBodyBytes ?? 1_048_576,
        resolveSecret: (signal) => credentials.resolve({ provider: config.credentialProvider ?? "github", name: config.secretName, signal }),
        dispatch: (delivery) => runtime.dispatch(delivery),
      }),
    });
  },
});
