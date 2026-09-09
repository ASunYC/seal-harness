import { spawn } from "node:child_process";
import { access, mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";

const target = process.argv[2];
if (!target) throw new Error("Usage: node scripts/smoke-official-shell.mjs <authenticated-url>");

const candidates = [
  process.env.SEAL_BROWSER_PATH,
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
  "/usr/bin/microsoft-edge",
  "/usr/bin/google-chrome",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
].filter(Boolean);

let executable;
for (const candidate of candidates) {
  try { await access(candidate); executable = candidate; break; } catch {}
}
if (!executable) throw new Error("No supported Chromium executable found; set SEAL_BROWSER_PATH");

const port = await new Promise((resolve, reject) => {
  const server = createServer();
  server.once("error", reject);
  server.listen(0, "127.0.0.1", () => {
    const address = server.address();
    if (!address || typeof address === "string") return reject(new Error("Could not allocate a CDP port"));
    server.close((error) => error ? reject(error) : resolve(address.port));
  });
});
const profile = await mkdtemp(join(tmpdir(), "seal-official-shell-"));
const browser = spawn(executable, [
  "--headless=new", "--disable-gpu", "--no-first-run", "--no-default-browser-check",
  `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, "about:blank",
], { stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
const browserExited = new Promise(resolve => browser.once("exit", resolve));
let browserOutput = "";
browser.stdout.on("data", chunk => { browserOutput += chunk; });
browser.stderr.on("data", chunk => { browserOutput += chunk; });

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const deadline = Date.now() + 30_000;
async function json(path, init) {
  let last;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}${path}`, init);
      if (response.ok) return await response.json();
      last = new Error(`CDP ${path} returned HTTP ${response.status}`);
    } catch (error) { last = error; }
    await delay(100);
  }
  throw new Error(`Chromium CDP did not become ready: ${last?.message ?? "timeout"}\n${browserOutput}`);
}

let socket;
try {
  await json("/json/version");
  const page = await json(`/json/new?${encodeURIComponent("about:blank")}`, { method: "PUT" });
  socket = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    socket.addEventListener("open", resolve, { once: true });
    socket.addEventListener("error", () => reject(new Error("CDP WebSocket failed to open")), { once: true });
  });
  let nextId = 0;
  const pending = new Map();
  const diagnostics = [];
  const httpFailures = [];
  socket.addEventListener("message", event => {
    const message = JSON.parse(String(event.data));
    if (message.id !== undefined) {
      const waiter = pending.get(message.id); if (!waiter) return;
      pending.delete(message.id); message.error ? waiter.reject(new Error(message.error.message)) : waiter.resolve(message.result);
      return;
    }
    if (message.method === "Runtime.exceptionThrown") diagnostics.push(message.params.exceptionDetails?.exception?.description ?? message.params.exceptionDetails?.text ?? "Runtime exception");
    if (message.method === "Runtime.consoleAPICalled" && ["error", "warning"].includes(message.params.type)) diagnostics.push(message.params.args.map(arg => arg.value ?? arg.description).join(" "));
    if (message.method === "Network.responseReceived" && message.params.response.status >= 400) {
      httpFailures.push(`${message.params.response.status} ${message.params.response.url}`);
    }
  });
  const call = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++nextId; pending.set(id, { resolve, reject }); socket.send(JSON.stringify({ id, method, params }));
  });
  await call("Runtime.enable");
  await call("Page.enable");
  await call("Network.enable");
  await call("Page.navigate", { url: target });
  const inspect = async () => {
    const result = await call("Runtime.evaluate", { returnByValue: true, expression: `(() => ({
      client: document.documentElement.dataset.dshClientBoot,
      shell: document.documentElement.dataset.dshOfficialShell,
      mounted: document.documentElement.dataset.dshOfficialShellMounted,
      clientError: document.documentElement.dataset.dshClientError,
      shellError: document.documentElement.dataset.dshOfficialShellError,
      legacyHidden: document.getElementById('root')?.hidden,
      officialChildren: document.getElementById('dsh-official-shell')?.childElementCount ?? 0,
      officialHeight: document.getElementById('dsh-official-shell')?.getBoundingClientRect().height ?? 0,
      viewportHeight: window.innerHeight,
      visibleLegacyDialogs: [...document.querySelectorAll('[role="dialog"]')].filter(element => {
        const style = getComputedStyle(element);
        const visible = style.display !== 'none' && style.visibility !== 'hidden' && element.getBoundingClientRect().height > 0;
        return visible && !document.getElementById('dsh-official-shell')?.contains(element);
      }).length,
      acknowledgementError: document.body.innerText.includes('acknowledgement could not be saved'),
      active: window.SealDshPlugins?.active?.() ?? [],
      text: document.body.innerText.slice(0, 500),
    }))()` });
    return result.result.value;
  };
  let state;
  while (Date.now() < deadline) {
    state = await inspect();
    if (state.client === "error" || state.shell === "error") break;
    if (state.client === "ready" && state.shell === "ready" && state.mounted === "true") break;
    await delay(100);
  }
  const required = [
    "@deepseek-ai/dsh-api-session-controller:official-shell",
    "@deepseek-ai/dsh-api-workspace-controller:official-shell",
    "@deepseek-ai/dsh-client-ui-renderer:official-shell",
    "@deepseek-ai/dsh-client-ui-conversation:official-shell",
    "@deepseek-ai/dsh-client-ui-chat:official-shell",
    "@seal-harness/agent-team-ui:official-shell",
  ];
  const missing = required.filter(name => !state?.active?.includes(name));
  const fillsViewport = state?.officialHeight >= state?.viewportHeight - 1;
  if (state?.client !== "ready" || state?.shell !== "ready" || state?.mounted !== "true" || state?.legacyHidden !== true || state?.officialChildren < 1 || !fillsViewport || state?.visibleLegacyDialogs !== 0 || state?.acknowledgementError || missing.length || diagnostics.length || httpFailures.length) {
    throw new Error(`Official shell smoke failed: ${JSON.stringify({ state, fillsViewport, missing, diagnostics, httpFailures }, null, 2)}`);
  }
  process.stdout.write(`${JSON.stringify({ ok: true, state, diagnostics, httpFailures }, null, 2)}\n`);
} finally {
  socket?.close();
  browser.kill();
  await Promise.race([browserExited, delay(5_000)]);
  for (let attempt = 0; attempt < 20; attempt++) {
    try { await rm(profile, { recursive: true, force: true }); break; }
    catch (error) { if (error?.code !== "EBUSY" || attempt === 19) throw error; await delay(100); }
  }
}
