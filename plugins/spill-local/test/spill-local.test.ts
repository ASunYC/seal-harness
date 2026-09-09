import { mkdtemp, readFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { sessionId, toolCallId } from "@seal-harness/core";
import { LocalSpillStore } from "../src/index.js";

describe("LocalSpillStore", () => {
  it("writes full text to a private session-scoped unpredictable file", async () => {
    const root = await mkdtemp(join(tmpdir(), "seal-spill-test-"));
    const store = new LocalSpillStore(root);
    const ref = await store.saveText({ owner: { sessionId: sessionId("alpha") }, source: { toolName: "bash", callId: toolCallId("call"), label: "result" }, suggestedName: "../bash.txt", content: "完整结果🙂" });
    expect(await readFile(ref.locator, "utf8")).toBe("完整结果🙂");
    expect(ref.locator).toContain("session-");
    expect(ref.locator).not.toContain("..");
    if (process.platform !== "win32") expect((await stat(ref.locator)).mode & 0o777).toBe(0o600);
  });
});
