import { test } from "node:test";
import assert from "node:assert/strict";
import { downloadNodeLicense } from "./node-license.mjs";

test("retries network and transient HTTP failure, preserving exact license", async () => {
  let attempts = 0;
  const waits = [];
  const license = "Node.js is licensed for use as follows:\nCopyright notice\n";
  const actual = await downloadNodeLicense("v24.19.0", {
    fetchImpl: async (url, options) => {
      assert.equal(url, attempts === 0
        ? "https://raw.githubusercontent.com/nodejs/node/v24.19.0/LICENSE"
        : "https://api.github.com/repos/nodejs/node/contents/LICENSE?ref=v24.19.0");
      assert.equal(options.headers.Accept, "application/vnd.github.raw+json");
      assert.ok(options.signal instanceof AbortSignal);
      if (++attempts === 1) throw new TypeError("fetch failed");
      return new Response(attempts === 2 ? "unavailable" : license, { status: attempts === 2 ? 503 : 200 });
    }, sleep: async ms => waits.push(ms), warn() {},
  });
  assert.equal(actual, license);
  assert.deepEqual(waits, [1000, 2000]);
});

test("permanent HTTP failure fails closed without retry", async () => {
  let attempts = 0;
  await assert.rejects(downloadNodeLicense("v24.19.0", {
    fetchImpl: async () => { attempts++; return new Response("missing", { status: 404 }); },
    sleep: async () => assert.fail("must not retry"), warn() {},
  }), /after 1 attempt/);
  assert.equal(attempts, 1);
});

test("empty or unexpected response bodies cannot produce a release license", async () => {
  let attempts = 0;
  await assert.rejects(downloadNodeLicense("v24.19.0", {
    fetchImpl: async () => { attempts++; return new Response(" "); }, sleep: async () => {}, warn() {},
  }), /after 3 attempt/);
  assert.equal(attempts, 3);
});

test("rejects non-release versions before making a request", async () => {
  await assert.rejects(downloadNodeLicense("../main", { fetchImpl: () => assert.fail("unexpected request") }), /Unsupported/);
});
