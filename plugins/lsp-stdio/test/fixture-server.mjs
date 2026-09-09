let buffer = Buffer.alloc(0);
process.stdin.on("data", (chunk) => { buffer = Buffer.concat([buffer, chunk]); drain(); });
function send(value) { const body = Buffer.from(JSON.stringify(value)); process.stdout.write(`Content-Length: ${body.length}\r\n\r\n`); process.stdout.write(body); }
function drain() {
  while (true) {
    const split = buffer.indexOf("\r\n\r\n"); if (split < 0) return;
    const match = /Content-Length: ([0-9]+)/i.exec(buffer.subarray(0, split).toString("ascii")); if (!match) process.exit(2);
    const length = Number(match[1]); const end = split + 4 + length; if (buffer.length < end) return;
    const message = JSON.parse(buffer.subarray(split + 4, end).toString("utf8")); buffer = buffer.subarray(end); handle(message);
  }
}
function handle(message) {
  if (message.method === "initialize") return send({ jsonrpc: "2.0", id: message.id, result: { capabilities: { definitionProvider: true, referencesProvider: true, implementationProvider: true, hoverProvider: true, textDocumentSync: { openClose: true } } } });
  if (message.method === "shutdown") return send({ jsonrpc: "2.0", id: message.id, result: null });
  if (message.method === "exit") return process.exit(0);
  if (message.method === "textDocument/hover") return send({ jsonrpc: "2.0", id: message.id, result: { contents: [{ language: "ts", value: "const answer: number" }, "docs"], range: { start: message.params.position, end: message.params.position } } });
  if (["textDocument/definition", "textDocument/references", "textDocument/implementation"].includes(message.method)) return send({ jsonrpc: "2.0", id: message.id, result: [{ uri: message.params.textDocument.uri, range: { start: message.params.position, end: message.params.position } }] });
}
