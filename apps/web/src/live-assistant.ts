import type { StoredSessionEvent } from "@seal-harness/core";

/** Read-only preview of the current native PI step; never a durable message. */
export function liveAssistantPreview(events: readonly StoredSessionEvent[]) {
  let pending: { key: string; runId: string; turnId: string; messageId: string; time: number; content: { type: "text" | "reasoning"; text: string; index: number }[]; bytes: number; truncated: boolean } | undefined;
  for (const stored of events) {
    let event = stored.event;
    // Compatibility sessions persist PI stream frames in the DSH wire envelope.
    // Decode the envelope only; execution remains in the existing PI runtime.
    if (event.type === "dsh.imported") {
      const { type, data } = event.payload;
      if (["turn/start", "turn/end", "step/end", "assistant/message"].includes(type)) { pending = undefined; continue; }
      if (type !== "assistant/chunk" || !data || typeof data !== "object" || Array.isArray(data)) continue;
      if (!data.chunk || typeof data.chunk !== "object" || Array.isArray(data.chunk)) continue;
      event = { type: "assistant.chunk", payload: { runId: "compat-preview", turnId: String(data.turn), step: Number(data.step), chunk: data.chunk } } as StoredSessionEvent["event"];
    }
    if (event.type === "run.started" || event.type === "run.completed" || event.type === "step.completed"
      || (event.type === "message.appended" && event.payload.message.role === "assistant")) { pending = undefined; continue; }
    if (event.type !== "assistant.chunk") continue;
    const { runId, turnId, step, chunk } = event.payload;
    const kind = chunk.type === "text-delta" ? "text" : chunk.type === "reasoning-delta" ? "reasoning" : undefined;
    if (!kind || typeof chunk.text !== "string" || !Number.isSafeInteger(chunk.index)) continue;
    const key = `${runId}:${turnId}:${step}`;
    if (pending?.key !== key) pending = { key, runId, turnId, messageId: `live:${key}`, time: Date.parse(stored.timestamp), content: [], bytes: 0, truncated: false };
    let block = pending.content.find(value => value.index === chunk.index && value.type === kind);
    const text = chunk.text.slice(0, Math.max(0, 200_000 - pending.bytes));
    pending.truncated ||= text.length < chunk.text.length;
    if (!text) continue;
    if (!block) { block = { type: kind, text: "", index: chunk.index as number }; pending.content.push(block); }
    block.text += text; pending.bytes += text.length;
  }
  return pending?.content.length ? [{ role: "assistant", messageId: pending.messageId, time: pending.time, turnId: pending.turnId, turnCompleted: false, live: true, truncated: pending.truncated, content: pending.content.map(({ type, text }) => ({ type, text })) }] : [];
}
