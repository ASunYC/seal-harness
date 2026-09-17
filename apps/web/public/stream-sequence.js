// One streamed response can contain several assistant messages separated by
// tools. Never concatenate their text back into the first bubble.
export function createStreamSequence(first, createAssistant) {
  let current = first;
  let phase = "empty";
  let turnId;
  const turns = new Map();
  const assistants = [first];
  const userIds = new Set();
  return {
    assistants,
    claimUser(id) {
      if (!id) return true;
      if (userIds.has(id)) return false;
      userIds.add(id); return true;
    },
    start(id) { turnId = typeof id === "string" && id ? id : undefined; },
    track(node) {
      if (!turnId || !node?.dataset || node.dataset.turnId) return;
      node.dataset.turnId = turnId;
      node.dataset.turnCompleted = "false";
      if (!turns.has(turnId)) turns.set(turnId, new Set());
      turns.get(turnId).add(node);
    },
    finish(id = turnId) {
      for (const node of turns.get(id) ?? []) node.dataset.turnCompleted = "true";
    },
    accept(type) {
      if (type === "user_message") {
        // A queued message can be consumed before the first assistant token.
        // Retire the unused placeholder and allocate the reply after the user.
        if (phase === "empty") current.remove?.();
        phase = "boundary"; return current;
      }
      // Queue/steering can start another PI turn without an intervening tool.
      // Wait for actual content before allocating its bubble (empty turns exist).
      if (type === "turn_start") { if (phase !== "empty") phase = "boundary"; return current; }
      if (type === "tool_call") { phase = "tool"; return current; }
      if (type === "request_header" || type === "runtime_activity" || type === "compaction_activity") {
        if (phase === "boundary" || phase === "tool") { current = createAssistant(); assistants.push(current); phase = "empty"; }
        return current;
      }
      if (type !== "text_delta" && type !== "reasoning_delta") return current;
      const next = type === "text_delta" ? "text" : "reasoning";
      if (phase === "boundary" || phase === "tool" || (phase === "text" && next === "reasoning")) {
        current = createAssistant(); assistants.push(current);
      }
      phase = next;
      return current;
    },
  };
}
