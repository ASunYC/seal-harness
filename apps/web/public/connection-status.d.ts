export type ConnectionFeedback = "connecting" | "disconnected" | "recovered" | null;
export function nextConnectionFeedback(previous: ConnectionFeedback, transportState: string, networkAvailable?: boolean): ConnectionFeedback;
