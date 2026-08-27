import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { agentCorePlugin } from "@seal-harness/agent-core";
import { localAttachmentPlugin } from "@seal-harness/attachment-local";
import { stdioApprovalPlugin } from "@seal-harness/approval-stdio";
import { contextCorePlugin } from "@seal-harness/context-core";
import { windowCompactionPlugin } from "@seal-harness/compaction-window";
import { fileContextPlugin } from "@seal-harness/context-files";
import {
  attachmentServiceToken,
  messageId,
  modelServiceToken,
  sessionStoreToken,
  sessionId,
  text,
  toolCallId,
  type ModelRequest,
} from "@seal-harness/core";
import { defineProfile, startProfile } from "@seal-harness/host";
import { plugin } from "@seal-harness/kernel";
import { scriptedModelPlugin } from "@seal-harness/model-scripted";
import { basicPolicyPlugin } from "@seal-harness/policy-basic";
import { piRuntimePlugin } from "@seal-harness/runtime-pi";
import { jsonlSessionPlugin } from "@seal-harness/session-jsonl";
import { memorySessionPlugin } from "@seal-harness/session-memory";
import { toolsCorePlugin } from "@seal-harness/tools-core";
import { workspaceToolsPlugin } from "@seal-harness/workspace-tools";
import { promptRequest, runHeadless } from "../src/index.js";

const temporary: string[] = [];
afterEach(async () => Promise.all(temporary.splice(0).map((path) => rm(path, { recursive: true, force: true }))));

describe("headless Agent E2E", () => {
  it("reads, edits, verifies, replies, and persists through the real Pi loop", async () => {
    const cwd = await directory();
    const sessionRoot = join(cwd, ".sessions");
    await writeFile(join(cwd, "target.txt"), "before\n", "utf8");
    let step = 0;
    const respond = async function* (_request: ModelRequest) {
      step += 1;
      if (step === 1) {
        const prompt = _request.messages.at(-1);
        expect(prompt?.role).toBe("user");
        expect(prompt?.content.some((block) =>
          block.type === "text" && block.text.includes("attachment evidence"),
        )).toBe(true);
        yield call("read-1", "read_file", { path: "target.txt" });
        yield { type: "done" as const, stopReason: "tool_call" as const };
      } else if (step === 2) {
        yield call("edit-1", "replace_text", {
          path: "target.txt", oldText: "before", newText: "after",
        });
        yield { type: "done" as const, stopReason: "tool_call" as const };
      } else if (step === 3) {
        yield call("shell-1", "shell", {
          command: `"${process.execPath}" -e "const fs=require('fs');process.exit(fs.readFileSync('target.txt','utf8').trim()==='after'?0:1)"`,
        });
        yield { type: "done" as const, stopReason: "tool_call" as const };
      } else {
        yield { type: "text_delta" as const, delta: "completed" };
        yield { type: "done" as const, stopReason: "stop" as const };
      }
    };
    const profile = defineProfile([
      plugin(scriptedModelPlugin, {
        models: [{
          provider: "scripted", model: "test", contextWindow: 32_000, maxOutputTokens: 4_096,
        }],
        respond,
      }),
      plugin(jsonlSessionPlugin, { root: sessionRoot }),
      plugin(contextCorePlugin, { systemPrompt: "Complete the task." }),
      plugin(localAttachmentPlugin, { root: join(cwd, ".attachments") }),
      plugin(fileContextPlugin, {}),
      plugin(basicPolicyPlugin, { mode: "workspace-write" }),
      plugin(stdioApprovalPlugin, { mode: "allow" }),
      plugin(toolsCorePlugin, {}),
      plugin(workspaceToolsPlugin, {}),
      plugin(piRuntimePlugin, {}),
      plugin(agentCorePlugin, { idFactory: sequentialIds() }),
    ]);
    const kernel = await startProfile(profile);
    let stdout = "";
    let stderr = "";
    try {
      const attachment = await kernel.use(attachmentServiceToken).put({
        data: Buffer.from("attachment evidence"),
        mimeType: "text/plain",
        name: "evidence.txt",
      });
      const result = await runHeadless(
        kernel,
        promptRequest(cwd, "scripted", "test", "update target and verify", {}, [attachment]),
        {
          stdout: { write(value) { stdout += value; } },
          stderr: { write(value) { stderr += value; } },
        },
      );
      expect(result.stopReason).toBe("stop");
      expect(stdout).toBe("completed\n");
      expect(stderr).toContain("read_file");
      expect(stderr).toContain("replace_text");
      expect(stderr).toContain("shell");
      await expect(readFile(join(cwd, "target.txt"), "utf8")).resolves.toBe("after\n");

      const sessions = await kernel.use(sessionStoreToken).list();
      expect(sessions).toHaveLength(1);
      expect(sessions[0]?.events.some((entry) =>
        entry.event.type === "run.completed" && entry.event.payload.outcome === "completed",
      )).toBe(true);
      expect(sessions[0]?.events.some((entry) =>
        entry.event.type === "message.appended"
        && entry.event.payload.message.role === "user"
        && entry.event.payload.message.content.some((block) => block.type === "attachment"),
      )).toBe(true);
      expect(await kernel.use(modelServiceToken).list()).toHaveLength(1);
    } finally {
      await kernel.stop();
    }
  });

  it("compacts long replayed history and continues through the real Pi loop", async () => {
    const cwd = await directory();
    const id = sessionId("long-session");
    const profile = defineProfile([
      plugin(scriptedModelPlugin, {
        models: [{
          provider: "scripted", model: "test", contextWindow: 32_000, maxOutputTokens: 4_096,
        }],
        async *respond(request) {
          const first = request.messages[0];
          expect(first?.role).toBe("user");
          expect(first?.content[0]).toMatchObject({
            type: "text",
            text: expect.stringContaining("Compacted conversation history"),
          });
          yield { type: "text_delta", delta: "continued-after-compaction" };
          yield { type: "done", stopReason: "stop" };
        },
      }),
      plugin(memorySessionPlugin, {}),
      plugin(contextCorePlugin, { systemPrompt: "test" }),
      plugin(windowCompactionPlugin, { thresholdMessages: 4, retainMessages: 2 }),
      plugin(piRuntimePlugin, {}),
      plugin(agentCorePlugin, { idFactory: sequentialIds() }),
    ]);
    const kernel = await startProfile(profile);
    try {
      const sessions = kernel.use(sessionStoreToken);
      await sessions.create({ id, cwd });
      const oldMessages = [
        { role: "user" as const, content: [text("one")] },
        { role: "assistant" as const, content: [text("answer one")] },
        { role: "user" as const, content: [text("two")] },
        { role: "assistant" as const, content: [text("answer two")] },
        { role: "user" as const, content: [text("three")] },
        { role: "assistant" as const, content: [text("answer three")] },
      ];
      await sessions.append({
        id,
        expectedVersion: 1,
        events: oldMessages.map((message, index) => ({
          type: "message.appended" as const,
          payload: { messageId: messageId(`old-${index}`), message },
        })),
      });
      let stdout = "";
      const result = await runHeadless(
        kernel,
        promptRequest(cwd, "scripted", "test", "continue", { sessionId: id }),
        {
          stdout: { write(value) { stdout += value; } },
          stderr: { write() {} },
        },
      );
      expect(result.stopReason).toBe("stop");
      expect(stdout).toBe("continued-after-compaction\n");
      const stored = await sessions.read(id);
      expect(stored?.events.some((entry) => entry.event.type === "context.compacted")).toBe(true);
    } finally {
      await kernel.stop();
    }
  });
});

function call(id: string, name: string, args: Record<string, string>) {
  return {
    type: "tool_call" as const,
    call: { type: "tool_call" as const, id: toolCallId(id), name, arguments: args },
  };
}

function sequentialIds(): () => string {
  let value = 0;
  return () => String(++value);
}

async function directory(): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), "seal-harness-e2e-"));
  temporary.push(path);
  return path;
}
