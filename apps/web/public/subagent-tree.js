/** Only descendants reachable from this session are shown; malformed cycles cannot recurse forever. */
export function subagentTree(records, rootId) {
  const byParent = new Map(); const seenIds = new Set([rootId]);
  for (const record of records ?? []) {
    if (typeof record?.sessionId !== "string" || typeof record.parentSessionId !== "string" || seenIds.has(record.sessionId)) continue;
    seenIds.add(record.sessionId);
    const children = byParent.get(record.parentSessionId) ?? []; children.push(record); byParent.set(record.parentSessionId, children);
  }
  const visited = new Set([rootId]); const nodes = [];
  const pending = [{ parentId: rootId, target: nodes }];
  while (pending.length) {
    const { parentId, target } = pending.pop();
    for (const record of byParent.get(parentId) ?? []) {
      if (visited.has(record.sessionId)) continue;
      visited.add(record.sessionId);
      const node = { ...record, children: [] }; target.push(node);
      pending.push({ parentId: node.sessionId, target: node.children });
    }
  }
  return nodes;
}

export function subagentElapsed(agent, now = Date.now()) {
  const start = Date.parse(agent.startedAt); const end = agent.finishedAt ? Date.parse(agent.finishedAt) : agent.status === "running" ? now : NaN;
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return undefined;
  const seconds = Math.floor((end - start) / 1000);
  return seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}

export function renderSubagentTree(records, rootId, { locale = "zh-CN", onOpen, onAbort, expandedIds = new Set(), doc = document } = {}) {
  const zh = locale === "zh-CN"; const root = doc.createElement("div"); root.className = "subagent-tree";
  const nodes = subagentTree(records, rootId);
  if (!nodes.length) { const empty = doc.createElement("p"); empty.className = "state-muted"; empty.textContent = zh ? "尚未派发子任务" : "No delegated tasks"; root.append(empty); return root; }
  const pending = [{ nodes, container: root }];
  while (pending.length) {
    const { nodes, container } = pending.pop();
    const list = doc.createElement("ul"); container.append(list);
    for (const agent of nodes) {
      const item = doc.createElement("li"); const details = doc.createElement("details"); details.dataset.subagentId = agent.sessionId;
      details.open = expandedIds.has(agent.sessionId);
      const summary = doc.createElement("summary"); const label = doc.createElement("strong"); label.textContent = agent.label || agent.sessionId;
      const status = doc.createElement("span"); status.className = "subagent-status"; status.dataset.status = agent.status;
      status.textContent = zh ? ({ running: "运行中", completed: "已完成", failed: "失败", aborted: "已停止" }[agent.status] ?? agent.status) : agent.status;
      summary.append(label, status); details.append(summary);
      const meta = doc.createElement("p"); meta.className = "subagent-meta";
      meta.textContent = [agent.model?.provider, agent.model?.model, subagentElapsed(agent)].filter(Boolean).join(" · "); details.append(meta);
      if (typeof agent.task === "string" && agent.task.trim()) {
        const task = doc.createElement("section"); task.className = "subagent-task";
        const heading = doc.createElement("strong"); heading.textContent = zh ? "原始任务" : "Original task";
        const body = doc.createElement("pre"); body.className = "subagent-result"; body.textContent = agent.task.slice(0, 12_000);
        task.append(heading, body);
        if (agent.task.length > 12_000) { const note = doc.createElement("p"); note.textContent = zh ? "任务较长，请打开会话查看完整内容。" : "Open the session for the full task."; task.append(note); }
        details.append(task);
      }
      const actions = doc.createElement("div"); actions.className = "subagent-actions";
      function button(text, action) {
        if (!action) return;
        const control = doc.createElement("button"); control.type = "button"; control.textContent = text;
        control.onclick = async () => {
          control.disabled = true;
          try { await action(agent.sessionId); }
          catch (error) { const message = doc.createElement("p"); message.setAttribute("role", "alert"); message.textContent = error instanceof Error ? error.message : String(error); details.append(message); }
          finally { control.disabled = false; }
        };
        actions.append(control);
      }
      button(zh ? "查看会话" : "Open session", onOpen);
      if (agent.status === "running") button(zh ? "停止任务" : "Stop task", onAbort);
      details.append(actions);
      if (agent.error || agent.result) {
        const output = doc.createElement("pre"); output.className = "subagent-result"; output.textContent = String(agent.error || agent.result).slice(0, 12_000); details.append(output);
        if (String(agent.error || agent.result).length > 12_000) { const note = doc.createElement("p"); note.textContent = zh ? "内容较长，请打开会话查看完整结果。" : "Open the session for the full result."; details.append(note); }
      }
      item.append(details); list.append(item);
      // Branch hierarchy stays visible even while each task's details are folded.
      if (agent.children.length) pending.push({ nodes: agent.children, container: item });
    }
  }
  return root;
}
