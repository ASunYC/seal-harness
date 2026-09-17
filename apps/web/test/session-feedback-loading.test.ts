import { readFile } from "node:fs/promises";
import { expect, it } from "vitest";
const source = await readFile("apps/web/public/app.js", "utf8");
const helper = source.slice(source.indexOf("async function loadSessionFeedback("), source.indexOf("async function openSession("));
const make = (api: unknown) => new Function("api", `${helper}; return loadSessionFeedback;`)(api);
it("permits history reading without the optional feedback service", async () => {
  const load = make(async () => { throw Object.assign(new Error("unsupported"), { status: 501 }); });
  expect(await load("session")).toEqual([]);
});
it("retains feedback and does not hide authentication or network errors", async () => {
  expect(await make(async () => ({ json: async () => [{ messageId: "m" }] }))("session")).toEqual([{ messageId: "m" }]);
  for (const status of [401, 403, 404, 500, undefined]) {
    const error = Object.assign(new Error("failure"), { status });
    await expect(make(async () => { throw error; })("session")).rejects.toBe(error);
  }
});
