import { openNativeSession } from "../../src/session-storage.ts";

try {
  const lease = await openNativeSession(process.argv[2], "process-test", process.argv[2]);
  lease.manager.appendMessage({ role: "user", content: "persisted before crash", timestamp: Date.now() });
  lease.manager.appendMessage({ role: "assistant", content: [{ type: "text", text: "persisted answer" }],
    api: "openai-completions", provider: "test", model: "fixture", stopReason: "stop", timestamp: Date.now(),
    usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } });
  process.on("message", async message => {
    if (message === "release") { await lease.release(); process.disconnect(); }
  });
  process.send({ ready: true });
} catch (error) {
  process.send({ error: String(error) });
  process.disconnect();
}
