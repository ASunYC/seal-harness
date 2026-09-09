/** Project Turn process rows without changing their durable message order. */
export function projectTranscriptView(transcript, mode, processLabel) {
  for (const disclosure of [...transcript.querySelectorAll(":scope > .turn-process")]) {
    disclosure.before(...[...disclosure.children].filter((child) => child.tagName !== "SUMMARY"));
    disclosure.remove();
  }
  if (mode !== "compact") return;
  const turnIds = new Set([...transcript.querySelectorAll(":scope > [data-turn-id]")].map((node) => node.dataset.turnId));
  for (const turnId of turnIds) {
    const nodes = [...transcript.querySelectorAll(":scope > [data-turn-id]")].filter((node) => node.dataset.turnId === turnId);
    const completed = nodes.some((node) => node.dataset.turnCompleted === "true");
    const answer = completed ? nodes.findLast((node) => node.classList.contains("assistant") && node.dataset.reply === "true") : undefined;
    const process = nodes.filter((node) => node !== answer && !node.classList.contains("user") && !node.classList.contains("turn-tail-message"));
    if (process.length === 0) continue;
    const disclosure = document.createElement("details");
    disclosure.className = "turn-process";
    disclosure.dataset.turnId = turnId;
    disclosure.open = !completed;
    const summary = document.createElement("summary");
    const messageCount = process.filter((node) => node.classList.contains("assistant") && node.dataset.reply === "true").length;
    const toolCount = process.reduce((count, node) => count + (Number(node.dataset.toolCallCount) || 0), 0);
    const subagentCount = process.reduce((count, node) => count + (Number(node.dataset.subagentCount) || 0), 0);
    summary.textContent = processLabel(messageCount, toolCount, subagentCount);
    process[0].before(disclosure);
    disclosure.append(summary, ...process);
  }
}
