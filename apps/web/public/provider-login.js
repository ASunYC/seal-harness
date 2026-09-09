export function installProviderLogin({ api, provider, host, refresh }) {
  const actions = document.createElement("div"); actions.className = "provider-login-actions";
  const status = document.createElement("small"); status.textContent = "账号授权与供应商专用配置";
  const login = document.createElement("button"); login.type = "button"; login.textContent = "登录账号";
  const setup = document.createElement("button"); setup.type = "button"; setup.textContent = "配置供应商";
  const logout = document.createElement("button"); logout.type = "button"; logout.textContent = "退出授权账号";
  actions.append(status, login, setup, logout); host.append(actions);
  let revision = 0;
  async function update() {
    const current = ++revision; login.hidden = setup.hidden = logout.hidden = true;
    try {
      const info = await (await api("/api/provider-login?provider=" + encodeURIComponent(provider.value))).json();
      if (current !== revision) return;
      login.hidden = !info.oauth; setup.hidden = !info.apiKeySetup; logout.hidden = !info.configured;
      status.textContent = info.configured ? "供应商认证已就绪" : "可使用账号授权或供应商专用配置；云平台也可使用宿主环境凭据。";
    } catch { if (current === revision) status.textContent = "供应商账号状态暂不可用"; }
  }
  async function start(type) {
    const selected = provider.value;
    const dialog = document.createElement("dialog"); dialog.className = "onboarding-dialog";
    dialog.setAttribute("aria-label", "供应商授权");
    const title = document.createElement("h2"); title.textContent = selected + " · 授权";
    const content = document.createElement("div"); const close = document.createElement("button"); close.type = "button"; close.textContent = "取消";
    dialog.append(title, content, close); document.body.append(dialog); dialog.showModal();
    let id; let stopped = false; let timer; let promptId;
    async function stop() {
      stopped = true; clearTimeout(timer); dialog.close(); dialog.remove();
      if (id) await api("/api/provider-login", { method: "DELETE", body: JSON.stringify({ id }) }).catch(() => {});
      await update(); await refresh();
    }
    close.onclick = () => void stop(); dialog.oncancel = event => { event.preventDefault(); void stop(); };
    const link = (url, label) => {
      try { const parsed = new URL(url); if (!["https:", "http:"].includes(parsed.protocol)) return;
        const a = document.createElement("a"); a.href = parsed.href; a.target = "_blank"; a.rel = "noopener noreferrer"; a.textContent = label || "打开授权页面"; content.append(a);
      } catch {}
    };
    async function poll() {
      if (stopped) return;
      try {
        const flow = await (await api("/api/provider-login?id=" + encodeURIComponent(id))).json();
        if (stopped) return;
        if (flow.prompt?.id !== promptId || !flow.prompt) {
          promptId = flow.prompt?.id; content.replaceChildren();
          for (const event of flow.events) {
            const p = document.createElement("p"); p.textContent = event.message || event.instructions || event.userCode || ""; content.append(p);
            if (event.type === "auth_url") link(event.url);
            if (event.type === "device_code") link(event.verificationUri, "打开设备授权页面");
            for (const item of event.links || []) link(item.url, item.label);
          }
          if (flow.prompt) {
            const label = document.createElement("label"); label.textContent = flow.prompt.message;
            const field = document.createElement(flow.prompt.type === "select" ? "select" : "input");
            if (flow.prompt.type === "select") for (const option of flow.prompt.options) field.append(new Option(option.label, option.id));
            else { field.type = flow.prompt.type === "secret" || flow.prompt.type === "manual_code" ? "password" : "text"; field.autocomplete = "off"; field.placeholder = flow.prompt.placeholder || ""; }
            const send = document.createElement("button"); send.type = "button"; send.textContent = "继续";
            const answerId = flow.prompt.id;
            send.onclick = async () => {
              send.disabled = true;
              try { await api("/api/provider-login", { method: "POST", body: JSON.stringify({ action: "answer", id, promptId: answerId, value: field.value }) }); field.value = ""; }
              catch { send.disabled = false; status.textContent = "提交失败，请重试"; }
            };
            label.append(field); content.append(label, send); field.focus();
          }
        }
        if (flow.state !== "pending") {
          content.replaceChildren(); const p = document.createElement("p"); p.textContent = flow.state === "complete" ? "授权完成，凭据已保存在本机。" : "授权未完成，请重试。"; content.append(p); close.textContent = "关闭"; await update(); return;
        }
        timer = setTimeout(() => void poll(), 1000);
      } catch { if (!stopped) { content.textContent = "授权已过期或连接中断，请关闭后重试。"; } }
    }
    try {
      const result = await (await api("/api/provider-login", { method: "POST", body: JSON.stringify({ action: "start", provider: selected, type }) })).json();
      id = result.id; if (stopped) { await api("/api/provider-login", { method: "DELETE", body: JSON.stringify({ id }) }); return; } await poll();
    } catch { content.textContent = "无法启动授权，请检查供应商配置。"; }
  }
  login.onclick = () => void start("oauth"); setup.onclick = () => void start("api_key");
  logout.onclick = async () => { await api("/api/provider-login", { method: "DELETE", body: JSON.stringify({ provider: provider.value }) }); await update(); await refresh(); };
  provider.addEventListener("change", () => void update());
  return update;
}
