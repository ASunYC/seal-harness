export function nextConnectionFeedback(previous, transportState, networkAvailable = true) {
  if (!networkAvailable || transportState === "closed") return "disconnected";
  if (transportState === "connecting") return "connecting";
  if (transportState === "open" && (previous === "connecting" || previous === "disconnected")) return "recovered";
  return null;
}
