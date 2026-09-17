// Lifecycle fixture: intentionally ignores graceful shutdown, never touches data.
process.on("SIGTERM", () => {});
process.on("message", () => {});
setInterval(() => {}, 1000);
setTimeout(() => {
  if (process.connected) process.send({ type: "ready", url: "http://127.0.0.1:12345/?token=fixture" });
}, 500);
