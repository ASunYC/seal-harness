import { lookup } from "node:dns/promises";
import { BlockList, isIP } from "node:net";
import { request as httpRequest, type RequestOptions } from "node:http";
import { request as httpsRequest } from "node:https";
import { WebError, webAccessServiceToken, type SealHarnessEvents, type WebFetchProvider, type WebFetchRequest, type WebFetchResult } from "@seal-harness/core";
import { definePlugin } from "@seal-harness/kernel";
export interface HttpWebFetchConfig { readonly timeoutMs?: number; readonly maxRedirects?: number; readonly maxResponseBytes?: number; readonly maxBodyChars?: number; readonly maxUrlChars?: number; readonly userAgent?: string }

export class HttpWebFetchProvider implements WebFetchProvider {
  readonly id = "http";
  readonly config: Required<HttpWebFetchConfig>;
  constructor(config: HttpWebFetchConfig = {}, readonly resolveAddresses = publicAddresses) { this.config = { timeoutMs: positive(config.timeoutMs ?? 30_000), maxRedirects: nonnegative(config.maxRedirects ?? 5), maxResponseBytes: positive(config.maxResponseBytes ?? 2_000_000), maxBodyChars: positive(config.maxBodyChars ?? 1_000_000), maxUrlChars: positive(config.maxUrlChars ?? 8_192), userAgent: config.userAgent ?? "SealHarness/0.3.4" }; }
  available(): boolean { return true; }
  async fetch(request: WebFetchRequest, signal?: AbortSignal): Promise<WebFetchResult> {
    const deadline = AbortSignal.timeout(this.config.timeoutMs); const combined = signal === undefined ? deadline : AbortSignal.any([signal, deadline]);
    let url = validateUrl(request.url, this.config.maxUrlChars);
    for (let redirects = 0;; redirects++) {
      const result = await requestOnce(url, combined, this.resolveAddresses, this.config);
      if (result.redirect === undefined) return result.value!;
      if (redirects >= this.config.maxRedirects) throw new WebError(`exceeded the maximum of ${this.config.maxRedirects} redirects`, "WEB_REDIRECT_BLOCKED");
      const next = validateUrl(new URL(result.redirect, url).toString(), this.config.maxUrlChars);
      if (next.origin !== url.origin) throw new WebError(`cross-origin redirect to ${next.origin} is not followed automatically`, "WEB_REDIRECT_BLOCKED");
      url = next;
    }
  }
}

async function requestOnce(url: URL, signal: AbortSignal, resolver: typeof publicAddresses, config: Required<HttpWebFetchConfig>): Promise<{ redirect?: string; value?: WebFetchResult }> {
  signal.throwIfAborted(); const addresses = await resolver(url.hostname, signal); const selected = addresses[0]; if (selected === undefined) throw new WebError("hostname has no public address", "WEB_NON_PUBLIC_ADDRESS");
  return new Promise((resolvePromise, reject) => {
    const request = (url.protocol === "https:" ? httpsRequest : httpRequest)(url, {
      method: "GET", headers: { accept: "text/html,text/plain,application/json,application/xml;q=0.9", "user-agent": config.userAgent },
      lookup(_hostname, options, callback) {
        const done = callback as unknown as (...args: unknown[]) => void;
        if ((options as { all?: boolean }).all) done(null, [selected]);
        else done(null, selected.address, selected.family);
      },
    } as RequestOptions, (response) => {
      const status = response.statusCode ?? 0; const location = response.headers.location;
      if ([301, 302, 303, 307, 308].includes(status)) { response.resume(); if (location === undefined) reject(new WebError("redirect response has no Location header", "WEB_PROVIDER_ERROR")); else resolvePromise({ redirect: location }); return; }
      const contentType = String(response.headers["content-type"] ?? ""); const kind = /^text\/html\b/i.test(contentType) ? "html" : /^(?:text\/|application\/(?:json|xml)\b)/i.test(contentType) ? "text" : undefined;
      if (kind === undefined) { response.resume(); reject(new WebError(`unsupported content type \"${contentType || "unknown"}\"`, "WEB_UNSUPPORTED_CONTENT_TYPE")); return; }
      const bodyKind: "html" | "text" = kind;
      const charset = /charset\s*=\s*"?([^;"\s]+)/i.exec(contentType)?.[1]?.toLowerCase(); if (charset !== undefined && charset !== "utf-8" && charset !== "utf8" && charset !== "us-ascii") { response.resume(); reject(new WebError(`unsupported charset \"${charset}\"`, "WEB_UNSUPPORTED_CHARSET")); return; }
      const declared = Number(response.headers["content-length"]); if (Number.isFinite(declared) && declared > config.maxResponseBytes) { response.resume(); reject(new WebError("response exceeds configured byte limit", "WEB_FETCH_TOO_LARGE")); return; }
      const chunks: Buffer[] = []; let bytes = 0; let truncated = false;
      response.on("data", (raw: Buffer) => { const chunk = Buffer.from(raw); const room = config.maxResponseBytes - bytes; if (chunk.length > room) { if (room > 0) chunks.push(chunk.subarray(0, room)); bytes += Math.max(room, 0); truncated = true; response.destroy(); } else { chunks.push(chunk); bytes += chunk.length; } });
      response.on("end", () => finish()); response.on("close", () => { if (truncated) finish(); }); let done = false;
      function finish() { if (done) return; done = true; let content: string; try { content = new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks, bytes)); } catch { reject(new WebError("response body is not valid UTF-8", "WEB_INVALID_ENCODING")); return; } if (content.length > config.maxBodyChars) { content = content.slice(0, config.maxBodyChars); truncated = true; } resolvePromise({ value: { url: url.toString(), status, body: { kind: bodyKind, content }, truncated } }); }
    });
    request.once("error", (error) => reject(signal.aborted ? new WebError("web fetch aborted", "WEB_ABORTED") : new WebError(`web fetch failed: ${error.message}`, "WEB_PROVIDER_ERROR")));
    const abort = () => request.destroy(signal.reason instanceof Error ? signal.reason : new Error("aborted")); signal.addEventListener("abort", abort, { once: true }); request.once("close", () => signal.removeEventListener("abort", abort)); request.end();
  });
}

export async function publicAddresses(hostname: string, signal?: AbortSignal): Promise<readonly { address: string; family: 4 | 6 }[]> {
  signal?.throwIfAborted(); const literal = isIP(hostname); const records = literal === 0 ? await lookup(hostname, { all: true, verbatim: true }) : [{ address: hostname, family: literal as 4 | 6 }]; signal?.throwIfAborted();
  if (records.length === 0 || records.some((item) => !isPublicIp(item.address))) throw new WebError(`destination \"${hostname}\" resolves to a non-public address`, "WEB_NON_PUBLIC_ADDRESS"); return records as { address: string; family: 4 | 6 }[];
}
export function isPublicIp(address: string): boolean {
  const family = isIP(address); return family !== 0 && !NON_PUBLIC.check(address, family === 4 ? "ipv4" : "ipv6");
}
const NON_PUBLIC = new BlockList();
for (const [network, prefix] of [["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8], ["169.254.0.0", 16], ["172.16.0.0", 12], ["192.0.0.0", 24], ["192.0.2.0", 24], ["192.168.0.0", 16], ["198.18.0.0", 15], ["198.51.100.0", 24], ["203.0.113.0", 24], ["224.0.0.0", 4]] as const) NON_PUBLIC.addSubnet(network, prefix, "ipv4");
for (const [network, prefix] of [["::", 128], ["::1", 128], ["100::", 64], ["2001:db8::", 32], ["fc00::", 7], ["fe80::", 10], ["ff00::", 8]] as const) NON_PUBLIC.addSubnet(network, prefix, "ipv6");
export function validateUrl(raw: string, maxChars = 8_192): URL { if (typeof raw !== "string" || raw.trim() === "" || raw.length > maxChars) throw new WebError("url must be a non-empty bounded string", "WEB_INVALID_URL"); let url: URL; try { url = new URL(raw); } catch { throw new WebError("url must be an absolute HTTP(S) URL", "WEB_INVALID_URL"); } if (!/^https?:$/.test(url.protocol) || url.username !== "" || url.password !== "") throw new WebError("url must be an anonymous HTTP(S) URL", "WEB_INVALID_URL"); return url; }
function positive(value: number): number { if (!Number.isSafeInteger(value) || value < 1) throw new Error("web fetch limits must be positive safe integers"); return value; } function nonnegative(value: number): number { if (!Number.isSafeInteger(value) || value < 0) throw new Error("maxRedirects must be a non-negative safe integer"); return value; }
export const httpWebFetchPlugin = definePlugin<HttpWebFetchConfig, SealHarnessEvents>({ name: "web-fetch-http", requires: [webAccessServiceToken], setup(context, config) { const provider = new HttpWebFetchProvider(config); return context.use(webAccessServiceToken).registerFetchProvider(provider); } });
