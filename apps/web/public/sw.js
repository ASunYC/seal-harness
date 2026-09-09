const CACHE = "seal-harness-shell-v247";
const SHELL = ["/", "/app.js?v=0.3.4-69", "/attachment-admission.js?v=0.3.4-1", "/attachment-drafts.js?v=0.3.4-1", "/attachment-drop.js?v=0.3.4-1", "/attachment-rail.js?v=0.3.4-1", "/context-message.js?v=0.3.4-2", "/conversation-draft.js?v=0.3.4-1", "/conversation-width.js?v=0.3.4-1", "/context-meter.js?v=0.3.4-1", "/goal-bar.js?v=0.3.4-1", "/todo-panel.js?v=0.3.4-1", "/plan-control.js?v=0.3.4-1", "/job-control.js?v=0.3.4-1", "/message-images.js?v=0.3.4-2", "/turn-navigator.js?v=0.3.4-1", "/layout.js?v=0.3.4-1", "/pending-interaction.js?v=0.3.4-1", "/queue-dock.js?v=0.3.4-1", "/scroll-follow.js?v=0.3.4-1", "/session-ancestry.js?v=0.3.4-1", "/session-overflow.js?v=0.3.4-1", "/session-reorder.js?v=0.3.4-1", "/session-search.js?v=0.3.4-1", "/sidebar-tree.js?v=0.3.4-1", "/transcript-view.js?v=0.3.4-3", "/vendor/client-runtime.mjs?v=0.3.4-1", "/vendor/client-runtime.css?v=0.3.4-1", "/vendor/react-runtime.mjs?v=0.3.4-1", "/markdown.js?v=0.3.4-4", "/i18n.js?v=0.3.4-23", "/styles.css?v=0.3.4-41", "/vendor/katex.css?v=0.3.4-3", "/vendor/highlight.css?v=0.3.4-4", "/manifest.webmanifest", "/assets/seal-harness-mascot.png"];

SHELL.push("/app.js?v=0.3.4-199", "/client-bootstrap.js?v=0.3.4-1", "/i18n.js?v=0.3.4-74", "/styles.css?v=0.3.4-98", "/plugin-inventory.js?v=0.3.4-2", "/agent-preset-management.js?v=0.3.4-2", "/file-open.js?v=0.3.4-1", "/directory-browser.js?v=0.3.4-6", "/input-trigger-menu.js?v=0.3.4-3", "/document-title.js?v=0.3.4-1", "/composer-height.js?v=0.3.4-3", "/composer-primary.js?v=0.3.4-1", "/scroll-follow.js?v=0.3.4-3", "/queue-dock.js?v=0.3.4-8", "/attachment-admission.js?v=0.3.4-5", "/attachment-drop.js?v=0.3.4-2", "/attachment-rail.js?v=0.3.4-2", "/message-clock.js?v=0.3.4-2", "/copy-action.js?v=0.3.4-2", "/message-action-visibility.js?v=0.3.4-1", "/dismissible-popovers.js?v=0.3.4-6", "/inline-error.js?v=0.3.4-1", "/mutation-gate.js?v=0.3.4-1", "/token-format.js?v=0.3.4-5", "/schedule-catalog.js?v=0.3.4-1", "/connection-status.js?v=0.3.4-1", "/session-search.js?v=0.3.4-5", "/session-hover.js?v=0.3.4-3", "/row-action-menu.js?v=0.3.4-1", "/session-reorder.js?v=0.3.4-2", "/sidebar-tree.js?v=0.3.4-2", "/vendor/react-runtime.mjs?v=0.3.4-7", "/vendor/client-runtime.mjs?v=0.3.4-10", "/vendor/client-runtime.css?v=0.3.4-2");
SHELL.push("/client-bootstrap.js?v=0.3.4-12", "/vendor/client-runtime.mjs?v=0.3.4-30", "/app.js?v=0.3.4-205", "/styles.css?v=0.3.4-107", "/i18n.js?v=0.3.4-75", "/provider-login.js?v=0.3.4-1");

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(SHELL)));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key)))));
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin || url.pathname.startsWith("/api/")) return;
  // The ephemeral launch token must reach the Host as a native navigation so
  // its 303 Set-Cookie exchange cannot be obscured or cached under a secret URL.
  if (url.pathname === "/" && url.searchParams.has("token")) return;
  event.respondWith(fetch(request).then((response) => {
    if (response.ok) event.waitUntil(caches.open(CACHE).then((cache) => cache.put(request, response.clone())));
    return response;
  }).catch(() => caches.match(request).then((cached) => cached || caches.match("/"))));
});
