import type { IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";
import { WebSocket, WebSocketServer } from "ws";

export type RemoteStreamOpener = (endpoint: string, payload: unknown, signal: AbortSignal) => AsyncIterable<unknown> | Promise<AsyncIterable<unknown>>;

type ClientFrame =
  | { readonly type: "open"; readonly streamId: string; readonly endpoint: string; readonly payload: unknown }
  | { readonly type: "cancel"; readonly streamId: string };

/** DSH-compatible physical WebSocket carrier multiplexing independent logical streams. */
export class DshRemoteStreamMux {
  readonly #server = new WebSocketServer({ noServer: true });
  readonly #connections = new Set<Promise<void>>();

  constructor(readonly open: RemoteStreamOpener) {}

  handleUpgrade(request: IncomingMessage, socket: Duplex, head: Buffer): void {
    this.#server.handleUpgrade(request, socket, head, (websocket) => {
      const done = this.#run(websocket);
      this.#connections.add(done);
      void done.finally(() => this.#connections.delete(done));
    });
  }

  async close(): Promise<void> {
    for (const socket of this.#server.clients) socket.close(1001, "server stopped");
    await Promise.allSettled([...this.#connections]);
    await new Promise<void>((resolve) => this.#server.close(() => resolve()));
  }

  async #run(socket: WebSocket): Promise<void> {
    const streams = new Map<string, AbortController>();
    const tasks = new Set<Promise<void>>();
    const send = (frame: unknown): void => { if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(frame)); };
    socket.on("message", (data, binary) => {
      if (binary) { socket.close(1003, "text messages required"); return; }
      let frame: ClientFrame;
      try { frame = parseClientFrame(data.toString()); }
      catch { socket.close(1008, "invalid Remote stream request"); return; }
      if (frame.type === "cancel") { streams.get(frame.streamId)?.abort(new Error("Remote stream cancelled")); return; }
      if (streams.has(frame.streamId)) { socket.close(1008, "duplicate Remote stream id"); return; }
      const abort = new AbortController(); streams.set(frame.streamId, abort);
      const task = this.#pump(frame, abort.signal, send).finally(() => { streams.delete(frame.streamId); tasks.delete(task); });
      tasks.add(task);
    });
    await new Promise<void>((resolve) => { socket.once("close", resolve); socket.once("error", resolve); });
    for (const abort of streams.values()) abort.abort(new Error("Remote stream socket closed"));
    await Promise.allSettled([...tasks]);
  }

  async #pump(frame: Extract<ClientFrame, { type: "open" }>, signal: AbortSignal, send: (frame: unknown) => void): Promise<void> {
    try {
      const source = await this.open(frame.endpoint, frame.payload, signal);
      for await (const value of source) {
        if (signal.aborted) return;
        send(value === undefined ? { type: "item", streamId: frame.streamId } : { type: "item", streamId: frame.streamId, value });
      }
      if (!signal.aborted) send({ type: "end", streamId: frame.streamId });
    } catch (error) {
      if (signal.aborted) return;
      const projected = projectFailure(error);
      send({ type: "error", streamId: frame.streamId, error: projected });
    }
  }
}

function parseClientFrame(text: string): ClientFrame {
  const value = JSON.parse(text) as Record<string, unknown>;
  if (value.type === "cancel" && exactKeys(value, ["type", "streamId"]) && validId(value.streamId)) return value as ClientFrame;
  if (value.type === "open" && exactKeys(value, ["type", "streamId", "endpoint", "payload"]) && validId(value.streamId) && typeof value.endpoint === "string" && value.endpoint.length > 0) return value as ClientFrame;
  throw new Error("invalid Remote stream client message");
}

function exactKeys(value: object, expected: readonly string[]): boolean {
  const keys = Object.keys(value); return keys.length === expected.length && expected.every((key) => keys.includes(key));
}
function validId(value: unknown): value is string { return typeof value === "string" && value.length > 0 && value.length <= 200; }
function projectFailure(error: unknown): { code: string; message: string; details: object } {
  const value = error as { code?: unknown; message?: unknown; details?: unknown; payload?: { code?: unknown; details?: unknown } };
  const payload = value?.payload;
  return {
    code: typeof value?.code === "string" ? value.code : typeof payload?.code === "string" ? payload.code : "gateway/internal",
    message: typeof value?.message === "string" ? value.message : String(error),
    details: value?.details !== null && typeof value?.details === "object" && !Array.isArray(value.details) ? value.details
      : payload?.details !== null && typeof payload?.details === "object" && !Array.isArray(payload.details) ? payload.details : {},
  };
}
