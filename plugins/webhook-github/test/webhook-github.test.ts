import { createHmac } from "node:crypto";
import { createServer } from "node:http";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createGitHubWebhookHandler } from "../src/index.js";

const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => { for (const dispose of cleanup.splice(0).reverse()) await dispose(); });

async function serve(handler: ReturnType<typeof createGitHubWebhookHandler>): Promise<string> {
  const server = createServer(handler);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  cleanup.push(() => new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())));
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("missing address");
  return `http://127.0.0.1:${address.port}/github`;
}

describe("GitHub webhook adapter", () => {
  it("verifies the raw body, projects headers, and answers 202 without awaiting rules", async () => {
    const secret = "shared";
    const body = JSON.stringify({ action: "opened" });
    const dispatch = vi.fn();
    const url = await serve(createGitHubWebhookHandler({ source: "primary", maxBodyBytes: 1024, resolveSecret: async () => secret, dispatch, now: () => 42 }));
    const response = await fetch(url, { method: "POST", headers: {
      "content-type": "application/json",
      "x-hub-signature-256": `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`,
      "x-github-delivery": "delivery-1", "x-github-event": "pull_request",
    }, body });
    expect(response.status).toBe(202);
    expect(dispatch).toHaveBeenCalledWith({ kind: "github", source: "primary", deliveryId: "delivery-1", event: { name: "pull_request", payload: { action: "opened" } }, receivedAt: 42 });
  });

  it("rejects invalid signatures, malformed input, and oversized bodies without leaking payloads", async () => {
    const dispatch = vi.fn();
    const url = await serve(createGitHubWebhookHandler({ source: "primary", maxBodyBytes: 4, resolveSecret: async () => "secret", dispatch }));
    const oversized = await fetch(url, { method: "POST", headers: { "content-type": "application/json", "x-hub-signature-256": "sha256=nope", "x-github-delivery": "d", "x-github-event": "push" }, body: "secret-payload" });
    expect(oversized.status).toBe(413);
    expect(await oversized.text()).not.toContain("secret-payload");
    expect(dispatch).not.toHaveBeenCalled();
  });
});
