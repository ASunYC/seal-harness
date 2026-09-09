// Seal owns the page; the compatibility runtime supplies plugin services only.
document.documentElement.dataset.dshClientBoot = "loading";
import("/vendor/client-runtime.mjs?v=0.3.4-30").then(() => {
  document.documentElement.dataset.dshClientBoot = "ready";
  if (location.hash === "#dsh-shell") {
    const mount = () => {
      if (!window.SealDshPlugins?.officialShellReady?.()) return;
      const legacy = document.getElementById("root"); if (legacy) legacy.hidden = true;
      let container = document.getElementById("dsh-official-shell");
      if (!container) { container = document.createElement("div"); container.id = "dsh-official-shell"; document.body.prepend(container); }
      window.SealDshPlugins.mountOfficialShell(container);
      document.documentElement.dataset.dshOfficialShellMounted = "true";
    };
    mount();
    window.addEventListener("seal-harness:official-shell-ready", mount, { once: true });
  }
}).catch((error) => {
  document.documentElement.dataset.dshClientBoot = "error";
  document.documentElement.dataset.dshClientError = error instanceof Error ? error.message : String(error);
  window.SealDshClientError = {
    name: error instanceof Error ? error.name : "Error",
    message: error instanceof Error ? error.message : String(error),
    stack: error instanceof Error ? error.stack : undefined,
  };
  console.error("DSH client runtime failed to load", error);
});
