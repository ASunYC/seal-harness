// Projection owns only DOM placement, never copies or rewrites message content.
const reasoningPlacements = new WeakMap();

/** Update only the compact header; token updates must not move transcript nodes. */
export function updateTranscriptActivity(transcript, locale = "zh-CN") {
  const zh = locale === "zh-CN";
  for (const group of transcript.querySelectorAll(":scope > .turn-process")) {
    const summary = group.querySelector(":scope > summary");
    if (!summary) continue;
    let preview = summary.querySelector(".turn-activity-preview");
    if (group.dataset.completed === "true") { preview?.remove(); delete group.dataset.activity; continue; }
    const tools = [...group.querySelectorAll('.semantic-tool[data-phase="running"]')];
    const assistant = [...group.querySelectorAll("[data-activity-phase]")].at(-1);
    let phase, detail;
    if (tools.length) {
      phase = "tool";
      const tool = tools.at(-1);
      detail = [tool.querySelector(":scope > summary > strong")?.textContent, tool.querySelector(".semantic-tool-subject")?.textContent].filter(Boolean).join(" · ");
      if (tools.length > 1) detail += zh ? ` · ${tools.length} 个工具运行中` : ` · ${tools.length} tools running`;
    } else if (assistant?.dataset.activityPhase === "thinking") {
      phase = "thinking";
      const source = assistant.querySelector(".reasoning-content")?.dataset.source ?? "";
      detail = source.trimEnd().split(/\r?\n/).filter(line => line.trim()).at(-1)?.trim() ?? "";
    } else if (assistant?.dataset.activityPhase === "writing") {
      phase = "writing";
      detail = "";
    } else if (assistant?.dataset.activityPhase === "compacting") {
      phase = "compacting";
      detail = "";
    } else if (assistant?.dataset.activityPhase === "preparing") {
      phase = "preparing";
      detail = "";
    } else if (assistant?.dataset.activityPhase === "waiting") {
      phase = "waiting";
      detail = "";
    } else { preview?.remove(); delete group.dataset.activity; continue; }
    const labels = zh ? { compacting: "正在压缩上下文", preparing: "准备模型请求", tool: "正在执行", thinking: "正在思考", writing: "正在回答", waiting: "等待模型" } : { compacting: "Compacting context", preparing: "Preparing request", tool: "Executing", thinking: "Thinking", writing: "Responding", waiting: "Waiting for model" };
    const bounded = detail.length > 160 ? `${detail.slice(0, 160)}…` : detail;
    const value = `${labels[phase]}${bounded ? ` · ${bounded}` : ""}`;
    if (!preview) { preview = summary.ownerDocument.createElement("span"); preview.className = "turn-activity-preview"; summary.append(preview); }
    if (preview.textContent !== value) preview.textContent = value;
    group.dataset.activity = phase;
  }
}

/** Project Turn process rows without changing their durable message order. */
export function projectTranscriptView(transcript, mode, processLabel, locale = "zh-CN") {
  const focused = transcript.contains(transcript.ownerDocument.activeElement) ? transcript.ownerDocument.activeElement : null;
  const restoreFocus = () => {
    if (!focused || !transcript.contains(focused)) return;
    let target = focused;
    // A completed turn can fold around the control. Keep keyboard access at
    // the outermost closed disclosure, not on an invisible descendant.
    for (let parent = focused.parentElement; parent && transcript.contains(parent); parent = parent.parentElement) {
      if (parent.tagName === "DETAILS" && !parent.open) {
        const summary = parent.querySelector(":scope > summary");
        if (summary && !summary.contains(focused)) target = summary;
      }
    }
    if (target !== transcript.ownerDocument.activeElement) target.focus({ preventScroll: true });
  };
  for (const { node, anchor } of reasoningPlacements.get(transcript) ?? []) {
    if (anchor.parentNode) anchor.replaceWith(node);
    else node.remove();
  }
  const placements = [];
  reasoningPlacements.set(transcript, placements);
  const previous = new Map();
  for (const disclosure of [...transcript.querySelectorAll(":scope > .turn-process")]) {
    previous.set(disclosure.dataset.turnId, disclosure);
    disclosure.before(...[...disclosure.children].filter((child) => child.tagName !== "SUMMARY"));
    disclosure.remove();
  }
  if (mode !== "compact") { restoreFocus(); return; }
  const turnIds = new Set([...transcript.querySelectorAll(":scope > [data-turn-id]")].map((node) => node.dataset.turnId));
  for (const turnId of turnIds) {
    const nodes = [...transcript.querySelectorAll(":scope > [data-turn-id]")].filter((node) => node.dataset.turnId === turnId);
    const completed = nodes.some((node) => node.dataset.turnCompleted === "true");
    const answer = completed ? nodes.findLast((node) => node.classList.contains("assistant") && node.dataset.reply === "true") : undefined;
    const process = nodes.filter((node) => node !== answer && !node.classList.contains("user") && !node.classList.contains("turn-tail-message"));
    // The final answer remains outside the process disclosure, but its thinking
    // belongs at the end of the activity sequence, immediately before it.
    // Move the existing node (including copy controls and disclosure state),
    // leaving an exact insertion anchor for normal mode / the next projection.
    const finalReasoning = answer?.querySelector(":scope > .reasoning");
    if (finalReasoning) {
      const anchor = transcript.ownerDocument.createComment("reasoning placement");
      finalReasoning.replaceWith(anchor);
      answer.before(finalReasoning);
      placements.push({ node: finalReasoning, anchor });
      process.push(finalReasoning);
    }
    if (process.length === 0) continue;
    const disclosure = previous.get(turnId) ?? transcript.ownerDocument.createElement("details");
    disclosure.className = "turn-process";
    disclosure.dataset.turnId = turnId;
    // Preserve the user's disclosure choice during streamed updates. Only the
    // running -> completed transition folds automatically, once per turn.
    if (!previous.has(turnId) || disclosure.dataset.completed !== String(completed)) disclosure.open = !completed;
    disclosure.dataset.completed = String(completed);
    const summary = disclosure.querySelector(":scope > summary") ?? transcript.ownerDocument.createElement("summary");
    const messageCount = process.filter((node) => node.classList.contains("assistant") && node.dataset.reply === "true").length;
    const toolCount = process.reduce((count, node) => count + (Number(node.dataset.toolCallCount) || 0), 0);
    const subagentCount = process.reduce((count, node) => count + (Number(node.dataset.subagentCount) || 0), 0);
    summary.textContent = processLabel(messageCount, toolCount, subagentCount);
    process[0].before(disclosure);
    disclosure.replaceChildren(summary, ...process);
  }
  updateTranscriptActivity(transcript, locale);
  restoreFocus();
}
