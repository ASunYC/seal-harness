import { createHash } from "node:crypto";
import type { SessionManager } from "@earendil-works/pi-coding-agent";
import type { Model } from "@earendil-works/pi-ai";
import type { AgentMessage, SessionId } from "@seal-harness/core";
import { toPiMessage } from "./messages.js";

const START = "seal-history-import-start";
const COMPLETE = "seal-history-import-complete";

/**
 * Import a resolved Seal history once into an empty, separately owned PI session.
 * This function never writes the source Seal store. After import the PI session
 * is authoritative; callers must not repeatedly project Seal history over it.
 *
 * SessionManager's public append APIs are the only native-session writer here.
 * A partially flushed import is detected on retry rather than silently resumed
 * or duplicated. The caller must hold its session lease throughout import/run.
 */
export function importSealHistory(
  manager: SessionManager,
  sealSessionId: SessionId,
  history: readonly AgentMessage[],
  model: Model<any>,
): "imported" | "already-imported" {
  const entries = manager.getEntries();
  const start = entries.find(entry => entry.type === "custom" && entry.customType === START);
  const complete = entries.find(entry => entry.type === "custom" && entry.customType === COMPLETE);
  if (start?.type === "custom") {
    const data = asRecord(start.data);
    if (data.sealSessionId !== sealSessionId) throw new Error("PI session belongs to a different Seal session");
    if (complete?.type !== "custom" || asRecord(complete.data).digest !== data.digest) {
      throw new Error("Incomplete Seal history import; retain the source and recover into a new PI session");
    }
    return "already-imported";
  }
  if (entries.length !== 0) throw new Error("Seal history may only be imported into an empty PI session");

  // Validate and convert every entry before the first write, so unsupported
  // attachment or assistant-image content cannot leave a half-created import.
  const converted = history.map(message => {
    if (message.role === "assistant" && message.content.some(block => block.type === "image")) {
      throw new Error("Resolve assistant images before importing Seal history into PI");
    }
    return toPiMessage(message, model);
  });
  const digest = createHash("sha256").update(JSON.stringify(history)).digest("hex");
  manager.appendCustomEntry(START, { sealSessionId, digest, messageCount: history.length, version: 1 });
  for (const message of converted) manager.appendMessage(message);
  manager.appendCustomEntry(COMPLETE, { digest, messageCount: history.length });
  return "imported";
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
