import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { agentCorePlugin } from "@piharness/agent-core";
import { stdioApprovalPlugin } from "@piharness/approval-stdio";
import { fileContextPlugin } from "@piharness/context-files";
import { modelServiceToken, sessionStoreToken, toolCallId, type ModelRequest } from "@piharness/core";
import { defineProfile, startProfile } from "@piharness/host";
import { plugin } from "@piharness/kernel";
import { scriptedModelPlugin } from "@piharness/model-scripted";
import { basicPolicyPlugin } from "@piharness/policy-basic";
import { piRuntimePlugin } from "@piharness/runtime-pi";
import { jsonlSessionPlugin } from "@piharness/session-jsonl";
import { toolsCorePlugin } from "@piharness/tools-core";
import { workspaceToolsPlugin } from "@piharness/workspace-tools";
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
      plugin(fileContextPlugin, { systemPrompt: "Complete the task." }),
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
      const result = await runHeadless(
        kernel,
        promptRequest(cwd, "scripted", "test", "update target and verify"),
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
      expect(await kernel.use(modelServiceToken).list()).toHaveLength(1);
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
  const path = await mkdtemp(join(tmpdir(), "piharness-e2e-"));
  temporary.push(path);
  return path;
}
