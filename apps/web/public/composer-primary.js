export function composerPrimaryModel({ running, draft, attachmentCount, blocked = false, continuableSubagent = false }) {
  const empty = String(draft ?? "").trim() === "" && Number(attachmentCount) === 0;
  const primaryStops = Boolean(running && !continuableSubagent && (empty || blocked));
  return Object.freeze({
    action: primaryStops ? "stop" : "submit",
    label: primaryStops ? "stop" : running ? "send" : "run",
    showSecondaryStop: Boolean(running && !primaryStops),
  });
}
