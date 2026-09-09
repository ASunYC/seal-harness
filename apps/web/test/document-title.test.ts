import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";

const moduleUrl = pathToFileURL(resolve(process.cwd(), "apps/web/public/document-title.js")).href;

describe("sessionDocumentTitle", () => {
  it("uses the product title when no durable session title is selected", async () => {
    const { PRODUCT_TITLE, sessionDocumentTitle } = await import(moduleUrl);
    expect(sessionDocumentTitle(undefined)).toBe(PRODUCT_TITLE);
    expect(sessionDocumentTitle("")).toBe(PRODUCT_TITLE);
  });

  it("prefixes the product title with the selected durable session title", async () => {
    const { sessionDocumentTitle } = await import(moduleUrl);
    expect(sessionDocumentTitle("Investigate failure")).toBe("Investigate failure — Seal Harness");
  });
});
