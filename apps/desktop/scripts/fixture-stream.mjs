import { join } from "node:path";
import { defineProfile } from "../../../packages/host/dist/index.js";
import { plugin, definePlugin } from "../../../packages/kernel/dist/index.js";
import { compactionServiceToken } from "../../../packages/core/dist/index.js";
import { writeFile } from "node:fs/promises";
import { scriptedModelPlugin } from "../../../plugins/model-scripted/dist/index.js";
import { jsonlSessionPlugin } from "../../../plugins/session-jsonl/dist/index.js";
import { contextCorePlugin } from "../../../plugins/context-core/dist/index.js";
import { basicPolicyPlugin } from "../../../plugins/policy-basic/dist/index.js";
import { toolsCorePlugin } from "../../../plugins/tools-core/dist/index.js";
import { workspaceToolsPlugin } from "../../../plugins/workspace-tools/dist/index.js";
import { piRuntimePlugin } from "../../../plugins/runtime-pi/dist/index.js";
import { agentCorePlugin } from "../../../plugins/agent-core/dist/index.js";
import { localAttachmentPlugin } from "../../../plugins/attachment-local/dist/index.js";
import { subagentToolsPlugin } from "../../../plugins/subagent-tools/dist/index.js";
import { localJobsPlugin } from "../../../plugins/jobs-local/dist/index.js";

// Deterministic local provider; the normal PI loop still executes the real tool.
export function streamProfile(dataHome) {
  let calls = 0;
  const startupCompaction = definePlugin({ name: 'desktop-startup-compaction', provides: [compactionServiceToken], setup(context) {
    context.provide(compactionServiceToken, { async compact(request) {
      request.onProgress?.({state:'started'});
      await new Promise(resolve => { if(request.signal.aborted) resolve(); else request.signal.addEventListener('abort',resolve,{once:true}); });
      await writeFile(join(dataHome,'startup-cancelled.txt'),'aborted');
      request.onProgress?.({state:'finished',outcome:'aborted'});
      request.signal.throwIfAborted();
    } });
  } });
  const cancelTool = process.env.SEAL_DESKTOP_SMOKE_TOOL_CANCEL === "1";
  const progressFixture = process.env.SEAL_DESKTOP_SMOKE_TOOL_PROGRESS === "1" || cancelTool;
  return defineProfile([
    ...(process.env.SEAL_DESKTOP_SMOKE_STARTUP_CANCEL === '1' ? [plugin(startupCompaction,{})] : []),
    plugin(scriptedModelPlugin, { models: [{ provider: "scripted", model: "desktop-stream", contextWindow: 10000, maxOutputTokens: 1000, supportsReasoning: true, supportsImages: true }], async *respond(request) {
      if (request.systemPrompt?.includes("You are an AI agent powered by DeepSeek Harness.")) throw new Error("Compatibility layer replaced Seal product identity");
      if (process.env.SEAL_DESKTOP_SMOKE_MULTI === "1") {
        const task = request.messages.filter(message => message.role === "user").at(-1)?.content.filter(block => block.type === "text").map(block => block.text).join('');
        if (task?.startsWith('desktop-child-')) {
          yield { type: "reasoning_delta", delta: `正在处理 ${task}` };
          if (process.env.SEAL_DESKTOP_SMOKE_MULTI_LIVE === "1") {
            yield { type: "text_delta", delta: `阶段进展 ${task}\n` };
            await new Promise(resolve => setTimeout(resolve, 6000));
          }
          await new Promise(resolve => setTimeout(resolve, 1500));
          yield { type: "text_delta", delta: `完成 ${task}` };
          yield { type: "done", stopReason: "stop" }; return;
        }
        const step = calls++;
        if (step === 0) {
          for (const label of ['alpha', 'beta']) yield { type: "tool_call", call: { type: "tool_call", id: `spawn-${label}`, name: "spawn_agent", arguments: { prompt: `desktop-child-${label}`, label } } };
          yield { type: "done", stopReason: "tool_call" };
        } else if (step === 1) {
          yield { type: "tool_call", call: { type: "tool_call", id: "wait-children", name: "wait_agents", arguments: { timeout_ms: 10000 } } };
          yield { type: "done", stopReason: "tool_call" };
        } else {
          await new Promise(resolve => setTimeout(resolve, 500));
          yield { type: "text_delta", delta: "子任务协调完成" };
          yield { type: "done", stopReason: "stop" };
        }
        return;
      }
      if (process.env.SEAL_DESKTOP_SMOKE_QUEUE === "1") {
        if (calls++ === 0) {
          yield { type: "text_delta", delta: "第一轮仍在执行" };
          await new Promise(resolve => setTimeout(resolve, process.env.SEAL_DESKTOP_SMOKE_QUEUE_IMAGE === "1" ? 10000 : 5000));
        } else {
          if (process.env.SEAL_DESKTOP_SMOKE_QUEUE_REMOVE === "1") throw new Error("Removed queue message was executed");
          const queued = request.messages.some(message => message.role === "user" && message.content.some(block => block.type === "text" && block.text === "追加任务验证"));
          if (!queued) throw new Error("Queued prompt did not reach the model");
          if (process.env.SEAL_DESKTOP_SMOKE_QUEUE_IMAGE === "1" && !request.messages.some(message => message.role === "user" && message.content.some(block => block.type === "image" && block.data))) throw new Error("Queued image did not reach the model");
          yield { type: "text_delta", delta: "追加任务已完成" };
        }
        yield { type: "done", stopReason: "stop" }; return;
      }
      if (progressFixture) {
        if(calls++===0) {
          const command = cancelTool
            ? `"${process.execPath}" -e "process.stdout.write('live-shell-first');setTimeout(()=>require('fs').writeFileSync('cancel-effect.txt','unexpected'),4000)"`
            : `"${process.execPath}" -e "process.stdout.write('live-shell-first');setTimeout(()=>process.stdout.write(' live-shell-last'),1200)"`;
          yield {type:"tool_call",call:{type:"tool_call",id:"progress-shell",name:"shell",arguments:{command}}};
          yield {type:"done",stopReason:"tool_call"};
        } else { await new Promise(resolve => setTimeout(resolve, 1200)); yield {type:"text_delta",delta:"工具进度验证完成"};yield {type:"done",stopReason:"stop"}; }
        return;
      }
      if (process.env.SEAL_DESKTOP_SMOKE_FAILURE === "1") {
        if (calls++ === 0) {
          yield { type: "reasoning_delta", delta: "失败前的思考" };
          yield { type: "text_delta", delta: "失败前的部分正文" };
          throw new Error("Fixture provider failure");
        }
        yield { type: "text_delta", delta: "恢复请求成功" };
        yield { type: "done", stopReason: "stop" }; return;
      }
      if (process.env.SEAL_DESKTOP_SMOKE_CANCEL === "1") {
        yield { type: "reasoning_delta", delta: "取消测试思考" };
        yield { type: "text_delta", delta: "取消前已生成的内容" };
        const deadline = Date.now() + 10000;
        while (!request.signal?.aborted && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 50));
        if (!request.signal?.aborted) throw new Error("Cancel fixture was not interrupted");
        yield { type: "done", stopReason: "aborted" }; return;
      }
      await new Promise(resolve => setTimeout(resolve, 150));
      if (calls++ === 0) {
        yield { type: "reasoning_delta", delta: "先写入测试文件。" };
        yield { type: "text_delta", delta: "正在写入测试文件。" };
        yield { type: "tool_call", call: { type: "tool_call", id: "desktop-write", name: "write_file", arguments: { path: "stream-check.txt", content: "desktop stream verified\n" } } };
        yield { type: "done", stopReason: "tool_call" };
      } else {
        yield { type: "reasoning_delta", delta: "写入成功，汇总结果。" };
        yield { type: "text_delta", delta: "已完成 **文件写入**。" };
        yield { type: "done", stopReason: "stop" };
      }
    } }),
    plugin(jsonlSessionPlugin, { root: join(dataHome, "sessions") }),
    plugin(localAttachmentPlugin, { root: join(dataHome, "attachments") }),
    plugin(contextCorePlugin, {}), plugin(basicPolicyPlugin, { mode: progressFixture ? "danger-full-access" : "workspace-write" }),
    plugin(toolsCorePlugin, {}), plugin(workspaceToolsPlugin, { enableShell: progressFixture, reviewRoot: join(dataHome, "review-changes") }),
    plugin(piRuntimePlugin, {}), plugin(agentCorePlugin, {}),
    ...(process.env.SEAL_DESKTOP_SMOKE_MULTI === "1" ? [plugin(localJobsPlugin, {}), plugin(subagentToolsPlugin, {})] : []),
  ]);
}
