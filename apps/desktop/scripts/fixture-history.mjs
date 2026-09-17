import { startWebServer } from "@seal-harness/web";
import { sessionStoreToken } from "../../../packages/core/dist/index.js";

// Development-only fixture using the workspace build; never packaged as app code.
export async function seedHistory(cwd, dataHome) {
  const server = await startWebServer({ cwd, dataHome, pluginHome: dataHome, host: "127.0.0.1", port: 0, authenticate: true });
  try {
    const store = server.kernel.use(sessionStoreToken);
    const id = "desktop-history-fixture";
    const initial = await store.create({ id, cwd });
    const events = [];
    for (let turn = 0; turn < 80; turn++) {
      const runId = `run-${turn}`, turnId = `turn-${turn}`;
      events.push({ type: "run.started", payload: { runId, model: { provider: "fixture", model: "fixture" } } },
        { type: "turn.started", payload: { runId, turnId } });
      for (const role of ["user", "assistant"]) events.push({ type: "message.appended", surfaceOp: "append", payload: {
        messageId: `${role}-${turn}`, runId, turnId, message: { role, content: [
          ...(role === "assistant" ? [{ type: "reasoning", text: turn === 0 ? "检查第 0 回合的历史记录。定位验证 **跨节点** 内容。" : `检查第 ${turn} 回合的历史记录。` }] : []),
          { type: "text", text: role === "user" ? `历史任务 ${turn}` : `### 结果 ${turn}\n\n已验证 **历史内容**。\n\n\`\`\`ts\nconst turn = ${turn};\n\`\`\`` },
        ] },
      } });
      events.push({ type: "turn.completed", payload: { runId, turnId, stopReason: "stop" } },
        { type: "run.completed", payload: { runId } });
    }
    await store.append({ id, expectedVersion: initial.version, events });
  } finally { await server.close(); }
}
