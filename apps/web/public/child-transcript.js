import { createToolCard } from "./tool-card.js?v=0.3.4-6";

/** Isolated read-only rendering: no parent session state or mutation controls. */
export function renderChildTranscript(messages, { locale = "zh-CN", doc = document, sessionId, markdown, loadReview } = {}) {
  const zh = locale === "zh-CN";
  const root = doc.createDocumentFragment();
  const results = new Map(messages.filter(m => m.role === "tool" && m.callId).map(m => [m.callId, m]));
  const displayedResults = new Set();
  function textBlock(parent, value, rich = false) {
    const text = String(value ?? "");
    if (!text) return;
    const pre = doc.createElement(rich && markdown ? "div" : "pre");
    const render = value => { if (rich && markdown) { pre.className = "content"; pre.innerHTML = markdown(value); } else pre.textContent = value; };
    render(text.slice(0, 50_000)); parent.append(pre);
    if (text.length > 50_000) {
      const expand = doc.createElement("button"); expand.type = "button";
      expand.textContent = zh ? "显示完整文本" : "Show full text";
      expand.onclick = () => { render(text); expand.remove(); }; parent.append(expand);
    }
  }
  function media(parent, block) {
    if (block.type === "image" && /^image\/(png|jpeg|gif|webp)$/i.test(block.mimeType ?? "") && typeof block.data === "string") {
      const img = doc.createElement("img"); img.src = `data:${block.mimeType};base64,${block.data}`;
      img.alt = block.name || (zh ? "子任务图片" : "Child session image"); img.loading = "lazy"; parent.append(img); return true;
    }
    if (block.type !== "attachment" || typeof block.id !== "string" || !sessionId) return false;
    const link = doc.createElement("a");
    link.href = `/api/sessions/${encodeURIComponent(sessionId)}/attachment-content/${encodeURIComponent(block.id)}`;
    link.download = block.name || block.id; link.textContent = block.name || block.id; link.className = "message-attachment";
    parent.append(link); return true;
  }
  for (const [messageIndex, message] of messages.entries()) {
    if (message.role === "tool" && displayedResults.has(message.callId)) continue;
    const item = doc.createElement("article"); item.className = "child-message";
    if (message.role === "system-prompt") {
      const detail = doc.createElement("details"); detail.className = "child-diagnostic";
      detail.dataset.childDisclosure = `${message.messageId ?? message.atSeq ?? messageIndex}:system`;
      const title = doc.createElement("summary"); title.textContent = zh ? "系统提示词 · 查看记录" : "System prompt · View record";
      detail.append(title); textBlock(detail, message.text); item.append(detail); root.append(item); continue;
    }
    const heading = doc.createElement("h3");
    heading.textContent = ({ user: zh ? "任务" : "Task", assistant: "Seal", tool: message.name || (zh ? "工具结果" : "Tool result"), "turn-error": zh ? "运行失败" : "Run failed", "model-retry": zh ? "模型重试" : "Model retry" })[message.role] ?? message.role;
    item.append(heading);
    if (message.role === "model-retry") {
      const states = zh ? { scheduled: "等待重试", started: "已发起重试", cancelled: "已取消重试" } : { scheduled: "Retry scheduled", started: "Retry started", cancelled: "Retry cancelled" };
      const parts = [states[message.retryState] ?? message.retryState, message.provider];
      if (Number.isSafeInteger(message.retry) && Number.isSafeInteger(message.maxRetries)) parts.push(`${message.retry}/${message.maxRetries}`);
      textBlock(item, parts.filter(Boolean).join(" · "));
      textBlock(item, message.failure?.message);
    }
    if (message.live) {
      const note = doc.createElement("p"); note.className = "child-live-status";
      note.textContent = zh ? "进行中 · 内容尚未完成" : "In progress · Partial response";
      item.append(note);
    }
    if (message.truncated) {
      const note = doc.createElement("p");
      note.textContent = zh ? "实时预览已达长度上限；任务完成后可查看完整消息。" : "Live preview limit reached; the complete message is available after completion.";
      item.append(note);
    }
    for (const block of message.content ?? []) {
      if (block.type === "reasoning") {
        const reasoning = doc.createElement("details"); reasoning.className = "reasoning";
        reasoning.open = message.live === true;
        const title = doc.createElement("summary"); title.textContent = zh ? "思考过程" : "Thinking";
        reasoning.append(title); textBlock(reasoning, block.text, true); item.append(reasoning);
      } else if (block.type === "text") textBlock(item, block.text, message.role === "assistant");
      else if (block.type === "tool_call") {
        const result = results.get(block.id ?? block.callId);
        const card = createToolCard(block, locale, doc, { loadReview });
        if (card) {
          if (result) {
            card.update({ content: result.content, isError: result.isError, error: result.toolError, meta: result.toolMeta ?? result.providerData });
            for (const output of result.content ?? []) media(card.root, output);
            displayedResults.add(result.callId);
          } else if (message.turnCompleted) {
            // A result may be on an unloaded page. Do not label old calls running.
            card.root.dataset.phase = "unknown";
            card.root.querySelector(".semantic-tool-status").textContent = zh ? "结果未加载" : "Result not loaded";
          }
          item.append(card.root);
        } else {
          const detail = doc.createElement("details"); detail.className = "child-tool";
          const title = doc.createElement("summary");
          const failed = result?.isError === true || result?.toolError != null;
          const phase = result ? (failed ? "error" : "completed") : "unknown";
          detail.dataset.phase = phase;
          const status = result ? (failed ? (zh ? "失败" : "Failed") : (zh ? "已完成" : "Completed")) : (message.turnCompleted ? (zh ? "结果未加载" : "Result not loaded") : (zh ? "等待结果" : "Awaiting result"));
          title.textContent = `${block.name || (zh ? "工具调用" : "Tool call")} · ${status}`;
          detail.append(title);
          const parameters = doc.createElement("h4"); parameters.textContent = zh ? "调用参数" : "Arguments"; detail.append(parameters);
          textBlock(detail, JSON.stringify(block.arguments ?? {}, null, 2));
          if (result) {
            const heading = doc.createElement("h4"); heading.textContent = zh ? "执行结果" : "Result"; detail.append(heading);
            for (const output of result.content ?? []) {
              if (output.type === "text") textBlock(detail, output.text);
              else if (!media(detail, output)) textBlock(detail, JSON.stringify(output, null, 2));
            }
            if (result.toolError != null) textBlock(detail, typeof result.toolError === "string" ? result.toolError : JSON.stringify(result.toolError, null, 2));
            const metadata = result.toolMeta ?? result.providerData;
            if (metadata != null) {
              const extra = doc.createElement("details"); const label = doc.createElement("summary"); label.textContent = zh ? "结果元数据" : "Result metadata";
              extra.append(label); textBlock(extra, JSON.stringify(metadata, null, 2)); detail.append(extra);
            }
            displayedResults.add(result.callId);
          }
          item.append(detail);
        }
      } else if (!media(item, block)) {
        const label = doc.createElement("p"); label.textContent = `[${block.type}] ${block.name ?? ""}`; item.append(label);
      }
    }
    // Special event rows are not ordinary content-block messages.
    if (!(message.content?.length)) textBlock(item, message.text ?? message.error?.message ?? message.error ?? message.reason);
    let disclosureIndex = 0;
    for (const detail of item.querySelectorAll("details")) detail.dataset.childDisclosure = `${message.messageId ?? message.atSeq ?? messageIndex}:${disclosureIndex++}`;
    root.append(item);
  }
  return root;
}
