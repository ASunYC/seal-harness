const $ = (id) => document.getElementById(id);
const state = { models: [], sessionId: null, runId: null, running: false };
const providerLabels = {
  "amazon-bedrock": "Amazon Bedrock", "ant-ling": "Ant Ling", anthropic: "Anthropic",
  "azure-openai-responses": "Azure OpenAI", baseten: "Baseten", cerebras: "Cerebras",
  "cloudflare-ai-gateway": "Cloudflare AI Gateway", "cloudflare-workers-ai": "Cloudflare Workers AI",
  deepseek: "DeepSeek", fireworks: "Fireworks", "github-copilot": "GitHub Copilot", google: "Google",
  "google-vertex": "Google Vertex AI", groq: "Groq", huggingface: "Hugging Face", "kimi-coding": "Kimi Coding",
  minimax: "MiniMax", "minimax-cn": "MiniMax China", mistral: "Mistral", moonshotai: "Moonshot AI",
  "moonshotai-cn": "Moonshot AI China", nvidia: "NVIDIA NIM", openai: "OpenAI", "openai-codex": "OpenAI Codex",
  opencode: "OpenCode Zen", "opencode-go": "OpenCode Go", openrouter: "OpenRouter",
  "qwen-token-plan": "Qwen Token Plan", "qwen-token-plan-cn": "Qwen Token Plan China",
  "qwen-token-plan-individual": "Qwen Token Plan Individual", together: "Together AI",
  "vercel-ai-gateway": "Vercel AI Gateway", xai: "xAI", xiaomi: "Xiaomi MiMo",
  "xiaomi-token-plan-ams": "Xiaomi Token Plan AMS", "xiaomi-token-plan-cn": "Xiaomi Token Plan China",
  "xiaomi-token-plan-sgp": "Xiaomi Token Plan Singapore", zai: "Z.AI", "zai-coding-cn": "Z.AI Coding China",
};

async function api(path, options = {}) {
  const response = await fetch(path, { headers: { "content-type": "application/json", ...(options.headers || {}) }, ...options });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.error || `${response.status} ${response.statusText}`);
  }
  return response;
}

function initialize() {
  $("cwd").value = localStorage.getItem("seal-harness.cwd") || "";
  $("provider").addEventListener("change", () => { updateModels(); localStorage.setItem("seal-harness.provider", $("provider").value); });
  $("cwd").addEventListener("change", () => localStorage.setItem("seal-harness.cwd", $("cwd").value));
  $("composer").addEventListener("submit", submit);
  $("cancel").addEventListener("click", cancelRun);
  $("new-session").addEventListener("click", newSession);
  $("save-key").addEventListener("click", saveKey);
  $("credential-onboarding-form").addEventListener("submit", saveOnboardingKey);
  $("onboarding-api-key").addEventListener("input", () => {
    $("onboarding-save").disabled = $("onboarding-api-key").value.trim().length === 0;
    $("onboarding-error").textContent = "";
  });
  $("onboarding-later").addEventListener("click", closeOnboarding);
  void bootstrap();
  setInterval(() => void loadApprovals(), 750);
}

async function bootstrap() {
  try {
    const health = await (await api("/api/health")).json();
    if (!$("cwd").value) $("cwd").value = health.cwd;
    state.models = await (await api("/api/models")).json();
    updateProviders();
    updateModels();
    await updateOnboarding();
    await loadSessions();
  } catch (error) { setStatus(error.message, true); }
}

function updateProviders() {
  const select = $("provider");
  const preferred = localStorage.getItem("seal-harness.provider") || "deepseek";
  const providers = [...new Set(state.models.map((model) => model.provider))];
  select.replaceChildren(...providers.map((provider) => new Option(providerLabels[provider] || provider, provider)));
  if (providers.includes(preferred)) select.value = preferred;
  else if (providers.includes("deepseek")) select.value = "deepseek";
}

async function updateOnboarding() {
  const status = await (await api("/api/credentials")).json();
  const available = new Set(state.models.map((model) => model.provider));
  const hasConfiguredProvider = status.configuredProviders.some((provider) => available.has(provider));
  if (status.managed && available.has("deepseek") && !hasConfiguredProvider) openOnboarding();
}

function openOnboarding() {
  $("credential-onboarding").hidden = false;
  document.querySelector(".shell").inert = true;
  requestAnimationFrame(() => $("onboarding-api-key").focus());
}

function closeOnboarding() {
  $("credential-onboarding").hidden = true;
  document.querySelector(".shell").inert = false;
  $("prompt").focus();
}

async function saveOnboardingKey(event) {
  event.preventDefault();
  const apiKey = $("onboarding-api-key").value.trim();
  if (!apiKey) return;
  $("onboarding-save").disabled = true;
  $("onboarding-later").disabled = true;
  $("onboarding-error").textContent = "";
  try {
    await api("/api/credentials/deepseek", { method: "PUT", body: JSON.stringify({ apiKey }) });
    $("onboarding-api-key").value = "";
    setStatus("DeepSeek API key configured for this process");
    closeOnboarding();
  } catch (error) {
    $("onboarding-error").textContent = error.message;
  } finally {
    $("onboarding-save").disabled = $("onboarding-api-key").value.trim().length === 0;
    $("onboarding-later").disabled = false;
  }
}

function updateModels() {
  const select = $("model");
  const previous = select.value;
  select.replaceChildren();
  for (const model of state.models.filter((item) => item.provider === $("provider").value)) {
    select.append(new Option(model.displayName || model.model, model.model));
  }
  if ([...select.options].some((option) => option.value === previous)) select.value = previous;
}

async function loadSessions() {
  const sessions = await (await api("/api/sessions")).json();
  const container = $("sessions");
  container.replaceChildren();
  for (const session of sessions) {
    const button = document.createElement("button");
    button.className = `session${session.id === state.sessionId ? " active" : ""}`;
    const title = document.createElement("strong");
    title.textContent = session.preview || "Session";
    const meta = document.createElement("span");
    meta.textContent = session.id;
    button.append(title, meta);
    button.addEventListener("click", () => void openSession(session.id));
    container.append(button);
  }
}

async function openSession(id) {
  if (state.running) return;
  const session = await (await api(`/api/sessions/${encodeURIComponent(id)}`)).json();
  state.sessionId = id;
  const created = session.events.find((entry) => entry.event.type === "session.created");
  if (created) $("cwd").value = created.event.payload.cwd;
  const transcript = $("transcript");
  transcript.replaceChildren();
  for (const message of session.messages) renderMessage(message);
  $("session-title").textContent = id;
  await loadSessions();
  transcript.scrollTop = transcript.scrollHeight;
}

function newSession() {
  if (state.running) return;
  state.sessionId = null;
  $("session-title").textContent = "New session";
  const welcome = document.createElement("div"); welcome.className = "welcome"; welcome.id = "welcome";
  const mark = document.createElement("img"); mark.className = "hero-mark"; mark.src = "/assets/seal-harness-mascot.png"; mark.alt = "Seal mascot";
  const title = document.createElement("h1"); title.textContent = "What should we work on?";
  const description = document.createElement("p"); description.textContent = "Choose a workspace, configure a model, and give the agent a task.";
  welcome.append(mark, title, description);
  $("transcript").replaceChildren(welcome);
  void loadSessions();
}

async function submit(event) {
  event.preventDefault();
  const prompt = $("prompt").value.trim();
  if (!prompt || state.running) return;
  const cwd = $("cwd").value.trim();
  if (!cwd) return setStatus("Choose a workspace", true);
  const provider = $("provider").value;
  const model = $("model").value;
  if (!model) return setStatus("No model is available for this provider", true);
  state.running = true;
  $("cancel").hidden = false;
  $("prompt").value = "";
  $("welcome")?.remove();
  appendBubble("user", prompt);
  const assistant = appendBubble("assistant", "");
  setStatus("Running");
  try {
    const response = await api("/api/runs", {
      method: "POST",
      body: JSON.stringify({ cwd, provider, model, prompt, sessionId: state.sessionId, reasoning: $("reasoning").value || undefined }),
    });
    await readLines(response.body, (message) => handleStream(message, assistant));
    await loadSessions();
  } catch (error) {
    appendNotice(error.message, true);
    setStatus("Failed", true);
  } finally {
    state.running = false;
    state.runId = null;
    $("cancel").hidden = true;
  }
}

async function readLines(stream, receive) {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffered = "";
  while (true) {
    const { value, done } = await reader.read();
    buffered += decoder.decode(value || new Uint8Array(), { stream: !done });
    const lines = buffered.split("\n");
    buffered = lines.pop() || "";
    for (const line of lines) if (line) receive(JSON.parse(line));
    if (done) break;
  }
}

function handleStream(message, assistant) {
  if (message.type === "started") {
    state.runId = message.runId;
    state.sessionId = message.sessionId;
    $("session-title").textContent = message.sessionId;
  } else if (message.type === "event") {
    const event = message.event;
    if (event.type === "text_delta") assistant.querySelector(".content").textContent += event.delta;
    else if (event.type === "reasoning_delta") setStatus("Reasoning…");
    else if (event.type === "tool_call") appendTool(`→ ${event.call.name}`, JSON.stringify(event.call.arguments, null, 2));
    else if (event.type === "tool_result") appendTool(`← ${event.name}${event.result.isError ? " · error" : ""}`, blocksText(event.result.content));
    else if (event.type === "tool_progress") setStatus(`Running tool…`);
    $("transcript").scrollTop = $("transcript").scrollHeight;
  } else if (message.type === "completed") {
    setStatus(message.stopReason === "error" ? "Failed" : "Ready", message.stopReason === "error");
    if (message.errorMessage) appendNotice(message.errorMessage, true);
  } else if (message.type === "error") {
    appendNotice(message.error, true);
    setStatus("Failed", true);
  }
}

async function cancelRun() {
  if (!state.runId) return;
  await api(`/api/runs/${encodeURIComponent(state.runId)}`, { method: "DELETE" }).catch((error) => setStatus(error.message, true));
}

async function saveKey() {
  try {
    await api(`/api/credentials/${encodeURIComponent($("provider").value)}`, {
      method: "PUT", body: JSON.stringify({ apiKey: $("api-key").value }),
    });
    $("api-key").value = "";
    setStatus("API key set for this process");
  } catch (error) { setStatus(error.message, true); }
}

async function loadApprovals() {
  if (document.hidden) return;
  try {
    const values = await (await api("/api/approvals")).json();
    const container = $("approvals");
    container.replaceChildren();
    for (const approval of values) {
      const card = document.createElement("div");
      card.className = "approval";
      const text = document.createElement("div");
      const title = document.createElement("strong"); title.textContent = approval.title;
      const message = document.createElement("span"); message.textContent = approval.message;
      text.append(title, message);
      const actions = document.createElement("div");
      const deny = document.createElement("button"); deny.textContent = "Deny";
      const allow = document.createElement("button"); allow.textContent = "Allow"; allow.className = "primary";
      deny.addEventListener("click", () => decideApproval(approval.id, false));
      allow.addEventListener("click", () => decideApproval(approval.id, true));
      actions.append(deny, allow); card.append(text, actions); container.append(card);
    }
  } catch {}
}

async function decideApproval(id, approved) {
  await api(`/api/approvals/${encodeURIComponent(id)}`, { method: "POST", body: JSON.stringify({ approved }) });
  await loadApprovals();
}

function renderMessage(message) {
  if (message.role === "user" || message.role === "assistant") appendBubble(message.role, blocksText(message.content));
  else if (message.role === "tool") appendTool(`← ${message.name}`, blocksText(message.content));
}

function blocksText(content = []) { return content.filter((block) => block.type === "text").map((block) => block.text).join("\n"); }
function appendBubble(role, value) {
  const item = document.createElement("article"); item.className = `message ${role}`;
  const label = document.createElement("div"); label.className = "label"; label.textContent = role === "user" ? "You" : "Seal Harness";
  const content = document.createElement("pre"); content.className = "content"; content.textContent = value;
  item.append(label, content); $("transcript").append(item); return item;
}
function appendTool(titleValue, value) {
  const details = document.createElement("details"); details.className = "tool";
  const summary = document.createElement("summary"); summary.textContent = titleValue;
  const content = document.createElement("pre"); content.textContent = value;
  details.append(summary, content); $("transcript").append(details);
}
function appendNotice(value, error = false) { const item = document.createElement("div"); item.className = `notice${error ? " error" : ""}`; item.textContent = value; $("transcript").append(item); }
function setStatus(value, error = false) { $("status").textContent = value; $("status").className = error ? "error" : ""; }

initialize();
