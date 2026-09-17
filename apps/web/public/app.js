import { renderMarkdown } from "/markdown.js?v=0.3.4-4";
import { createCompactionActivity } from "/compaction-activity.js?v=0.3.4-1";
import { createToolCard } from "/tool-card.js?v=0.3.4-6";
import { renderSubagentTree } from "/subagent-tree.js?v=0.3.4-2";
import { renderChildTranscript } from "/child-transcript.js?v=0.3.4-11";
import { createChildHistory, watchChildHistory } from "/child-history.js?v=0.3.4-4";
import { createHistoryWindow } from "/history-window.js?v=0.3.4-1";
import { createStreamSequence } from "/stream-sequence.js?v=0.3.4-6";
import { normalizeLocale, translator } from "/i18n.js?v=0.3.4-76";
import { installProviderLogin } from "/provider-login.js?v=0.3.4-1";
import { projectTranscriptView, updateTranscriptActivity } from "/transcript-view.js?v=0.3.4-9";
import { computeColumns, DETAILS_DEFAULT, DETAILS_MAX, DETAILS_MIN, effectiveSidebarCollapsed, SIDEBAR_AUTO_COLLAPSE, SIDEBAR_DEFAULT, SIDEBAR_MAX, SIDEBAR_MIN } from "/layout.js?v=0.3.4-1";
import { resolveContentWidth } from "/conversation-width.js?v=0.3.4-1";
import { activeTurnFromGeometry, normalizeTurnOutline } from "/turn-navigator.js?v=0.3.4-1";
import { contextOccupancy } from "/context-meter.js?v=0.3.4-1";
import { goalBarModel } from "/goal-bar.js?v=0.3.4-1";
import { todoPanelModel } from "/todo-panel.js?v=0.3.4-1";
import { planComposerPlaceholder, planModeTarget } from "/plan-control.js?v=0.3.4-1";
import { isLiveJob, jobCounts, jobDuration } from "/job-control.js?v=0.3.4-1";
import { formatScheduleFrequency, formatScheduleLocalTime, formatScheduleRelative, orderScheduleRecords } from "/schedule-catalog.js?v=0.3.4-1";
import { createMessageImageGallery } from "/message-images.js?v=0.3.4-2";
import { formatMessageClock, msUntilNextLocalMidnight } from "/message-clock.js?v=0.3.4-2";
import { createCopyAction } from "/copy-action.js?v=0.3.4-2";
import { messageActionRevealModes } from "/message-action-visibility.js?v=0.3.4-1";
import { installAttachmentDrop } from "/attachment-drop.js?v=0.3.4-2";
import { createAttachmentRail } from "/attachment-rail.js?v=0.3.4-2";
import { AttachmentDraftStore } from "/attachment-drafts.js?v=0.3.4-1";
import { AttachmentAdmission, canAcceptImageInput, clipboardFiles, imageAdmissionIssue, imageUploadError } from "/attachment-admission.js?v=0.3.4-5";
import { contextMessageModel } from "/context-message.js?v=0.3.4-2";
import { readConversationDraft, writeConversationDraft } from "/conversation-draft.js?v=0.3.4-1";
import { selectPendingInteraction } from "/pending-interaction.js?v=0.3.4-1";
import { canAccelerateQueuedMessages, canSteerQueueItem, pendingQueueItems, queueDockItems, queueEditableText, queueImageRefs, queueImageUrl, queueItemPreview, queueItemText, queueMutable, queueSnapshotKey, shouldSteerQueueOnAcceleratedEnter } from "/queue-dock.js?v=0.3.4-10";
import { deriveSessionAncestry } from "/session-ancestry.js?v=0.3.4-1";
import { localSessionSearchResults, mergeSessionSearchResults, sanitizeSessionSearchQuery, shouldDismissSessionSearch, locateTranscriptMatch, SESSION_SEARCH_DEBOUNCE_MS } from "/session-search.js?v=0.3.4-6";
import { abbreviateWorkspaceHomePath, sessionDisplayTitle, sessionRelativeTime, SESSION_HOVER_DELAY_MS, SESSION_HOVER_GRACE_MS } from "/session-hover.js?v=0.3.4-3";
import { rowActionMenuIndex, ROW_ACTION_MENU_GRACE_MS } from "/row-action-menu.js?v=0.3.4-1";
import { collapsedSessionRows } from "/session-overflow.js?v=0.3.4-1";
import { applyPreferredSessionOrder, dropSessionIds, moveSessionIds, promoteBlankSession, sortSessionsByUpdated } from "/session-reorder.js?v=0.3.4-2";
import { captureTranscriptPosition, installTranscriptScrollSampling, isTranscriptNearBottom, restoreTranscriptPosition, transcriptAnchorKey } from "/scroll-follow.js?v=0.3.4-3";
import { shouldShowSessionEmptyState, treeNavigationIndex } from "/sidebar-tree.js?v=0.3.4-2";
import { detectActiveAtTrigger, inputTriggerKeyAction, renderInputTriggerOptions, syncInputTriggerSelection } from "/input-trigger-menu.js?v=0.3.4-3";
import { PRODUCT_TITLE, sessionDocumentTitle } from "/document-title.js?v=0.3.4-1";
import { composerTextGeometry, observeComposerSeat } from "/composer-height.js?v=0.3.4-3";
import { composerPrimaryModel } from "/composer-primary.js?v=0.3.4-1";
import { nextConnectionFeedback } from "/connection-status.js?v=0.3.4-1";
import { isFolderOpenPath, openFailureMessage } from "/file-open.js?v=0.3.4-1";
import { directoryDraftParts, displayDirectoryCrumbs, editableDirectoryPath, matchingDirectoryEntry, parentDirectoryCrumb, validDirectoryName, visibleDirectoryEntries } from "/directory-browser.js?v=0.3.4-6";
import { installDismissiblePopovers } from "/dismissible-popovers.js?v=0.3.4-6";
import { clearInlineError, showInlineError } from "/inline-error.js?v=0.3.4-1";
import { createMutationGate } from "/mutation-gate.js?v=0.3.4-1";
import { formatCacheHitPercent, formatCompactDuration, formatCompactTokens, formatExactTokenCount, formatLatencySeconds, formatRunDuration, formatTokensPerSecond, promptTokensForUsage } from "/token-format.js?v=0.3.4-5";
import { defaultPluginInventoryPreset, enabledPluginPresets, filterPluginInventory, shortPluginModuleName } from "/plugin-inventory.js?v=0.3.4-2";
import { agentPresetCopyIssue, agentPresetDisplayText, groupedAgentPresets } from "/agent-preset-management.js?v=0.3.4-2";
import { sessionLogExportUrl, sessionLogZipFilename } from "/session-export.js?v=0.3.4-1";
import { HISTORY_JUMP_MESSAGES, HISTORY_PAGE_MESSAGES, refreshedHistorySize } from "/history-page.js?v=0.3.4-1";
import { credentialStatusModel } from "/onboarding.js?v=0.3.4-2";

const $ = (id) => document.getElementById(id);
const transcriptPositions = new Map();
const compactionActivity = createCompactionActivity();
const streamSequences = new WeakMap();
let historyWindow = null;
let historySnapshot = null;
let historyCanTrim = false;
let renderingHistory = false;
const copyButtonActions = new WeakMap();
let branchReasonSequence = 0;
let currentLocale = normalizeLocale(localStorage.getItem("seal-harness.locale") || navigator.language);
let t = translator(currentLocale);
const state = { models: [], presets: [], settings: [], sessions: [], workspaces: [], credential: null, groupBy: localStorage.getItem("dsh.workspace.groupBy") === "flat" ? "flat" : "workspace", orderBy: localStorage.getItem("dsh.workspace.orderBy") === "manual" ? "manual" : "updated", expandedSessionGroups: new Set(), collapsedWorkspaceGroups: readStringSet("dsh.workspace.collapsedGroups"), sessionDrag: null, workspaceDrag: null, pendingAttachments: [], pendingQueueSubmissions: [], sessionId: null, runId: null, running: false, transcriptFollowing: true, todos: null, todoExpanded: false, goal: null, contextPressure: null, sessionMetrics: null, schedules: [], scheduleOpen: false, scheduleTimer: null, turnOutline: [], activeTurn: null, busyTurn: null, trajectoryRecords: [], trajectoryBefore: null, skins: [], busyEnter: "queue", busyEnterRevision: 0, transcriptView: "compact", transcriptViewRevision: 0, feedback: new Map(), pendingInteractionKey: null, queueItems: [], queueKey: null, queueExpanded: false, searchTimer: null, searchController: null, searchRevision: 0, eventSource: null, connectionFeedback: null, connectionRecoveryTimer: null, messageBefore: null, loadedMessageCount: 0, sessionInvalidated: false, sessionRefreshTimer: null, sessionsRefreshTimer: null, sessionLoadGeneration: 0 };
const layout = {
  sidebar: Number(localStorage.getItem("dsh.layout.sidebar")) || SIDEBAR_DEFAULT,
  details: Number(localStorage.getItem("dsh.layout.details")) || DETAILS_DEFAULT,
  wideCollapsed: localStorage.getItem("dsh.layout.sidebarCollapsed") === "true",
  narrowExpanded: false,
};
let contentWidthPreference = (() => { const value = Number(localStorage.getItem("dsh.conversation.contentWidth")); return Number.isFinite(value) && value > 0 ? value : null; })();
let renderedAttachmentCount = null;
let currentAttachmentRail = null;
const attachmentDrafts = new AttachmentDraftStore();
let attachmentAdmissionLocked = false;
let fileOpenError = null;
let fileOpenBusy = false;
let pluginInventorySnapshot = null;
let pluginInventoryError = null;
let installedPluginsSnapshot = null;
let installedPluginsError = null;
let dshGeneralSnapshot = null;
let dshGeneralError = null;
let dshGeneralWarning = null;
let agentPresetCopySource = null;
let agentPresetDeleteTarget = null;
let agentPresetMutationBusy = false;
let agentPresetDefaultBusy = null;
let agentPresetDefaultId = null;
let agentPresetSelectBusy = false;
const agentPresetRevealedPaths = new Map();
let pluginInventoryPresetId = null;
let pluginInventoryPresetOpen = true;
let pluginInventoryGlobalOpen = null;
let fileOpenRequest = 0;
let directoryListing = null;
let directoryChildListing = null;
let directorySelected = null;
let directoryShowHidden = false;
let directoryRequest = 0;
let directoryPathEditing = false;
let directoryCreateParent = null;
let directoryCreateLabel = null;
let directoryPreviewTimer = null;
let directoryPreviewSuspended = false;
let directoryScannedDraft = null;
let directoryScanController = null;
let directorySlowTimer = null;
let directoryInputComposing = false;
let directoryOpenGeneration = 0;
let directoryCreateGeneration = 0;
let directoryCreating = false;
let workspaceRenameTarget = null;
let workspaceRenameBusy = false;
let workspaceRenameConflict = false;
let workspaceRenameComposing = false;
let workspaceRemoveTarget = null;
let workspaceRemoveBusy = false;
let sessionRenameTarget = null;
let sessionRenameBusy = false;
let sessionRenameComposing = false;
let pluginRemoveTarget = null;
let pluginRemoveBusy = false;
let sessionHoverOpenTimer = null;
let sessionHoverCloseTimer = null;
let sessionHoverCard = null;
let sessionActionMenu = null;
let sessionActionMenuTrigger = null;
let sessionActionMenuCloseTimer = null;
let hostHome = "";
let promotedBlankSessionId = null;
let blankPromotionSuppressedAccounts = new Set();

function readStringSet(key) { try { const value = JSON.parse(localStorage.getItem(key) ?? "[]"); return new Set(Array.isArray(value) ? value.filter((item) => typeof item === "string") : []); } catch { return new Set(); } }

function applyLayout() {
  const shell = $("root"); if (!shell) return;
  const viewport = shell.getBoundingClientRect().width || window.innerWidth;
  const collapsed = effectiveSidebarCollapsed(viewport, layout.wideCollapsed, layout.narrowExpanded);
  const columns = computeColumns(viewport, collapsed ? 0 : layout.sidebar, state.sessionId ? layout.details : 0);
  shell.style.setProperty("--sidebar-width", `${columns.sidebar}px`);
  shell.style.setProperty("--details-width", `${columns.details}px`);
  shell.dataset.sidebarCollapsed = String(collapsed);
  shell.dataset.detailsCollapsed = String(columns.details === 0);
  $("sidebar-toggle").setAttribute("aria-expanded", String(!collapsed));
  requestAnimationFrame(applyContentWidth);
}

function toggleSidebar() {
  const viewport = $("root").getBoundingClientRect().width || window.innerWidth;
  if (viewport < SIDEBAR_AUTO_COLLAPSE) layout.narrowExpanded = !layout.narrowExpanded;
  else { layout.wideCollapsed = !layout.wideCollapsed; localStorage.setItem("dsh.layout.sidebarCollapsed", String(layout.wideCollapsed)); }
  applyLayout();
}

function installLayoutResize(handle, side) {
  let origin = 0; let latest = 0; let base = 0; let frame = null; let active = false;
  const cancelFrame = () => { if (frame !== null) { cancelAnimationFrame(frame); frame = null; } };
  const update = (clientX) => {
    const delta = clientX - origin;
    layout[side] = side === "sidebar" ? Math.min(SIDEBAR_MAX, Math.max(SIDEBAR_MIN, base + delta)) : Math.min(DETAILS_MAX, Math.max(DETAILS_MIN, base - delta));
    applyLayout();
  };
  const clearDrag = () => { delete document.body.dataset.layoutDragging; };
  handle.addEventListener("pointerdown", (event) => {
    event.preventDefault(); origin = event.clientX; latest = event.clientX; base = layout[side]; active = true; handle.setPointerCapture(event.pointerId); document.body.dataset.layoutDragging = side;
  });
  handle.addEventListener("pointermove", (event) => {
    if (!handle.hasPointerCapture(event.pointerId)) return;
    latest = event.clientX;
    frame ??= requestAnimationFrame(() => { frame = null; update(latest); });
  });
  handle.addEventListener("pointerup", (event) => {
    if (!handle.hasPointerCapture(event.pointerId)) return;
    cancelFrame(); latest = event.clientX; update(latest); active = false; clearDrag(); localStorage.setItem(`dsh.layout.${side}`, String(layout[side])); handle.releasePointerCapture(event.pointerId);
  });
  handle.addEventListener("pointercancel", (event) => { cancelFrame(); layout[side] = base; active = false; clearDrag(); if (handle.hasPointerCapture(event.pointerId)) handle.releasePointerCapture(event.pointerId); applyLayout(); });
  handle.addEventListener("lostpointercapture", () => { cancelFrame(); if (active) { layout[side] = base; active = false; } clearDrag(); applyLayout(); });
}

function applyContentWidth() {
  const main = document.querySelector(".main"); if (!main) return;
  const column = main.getBoundingClientRect().width || main.offsetWidth;
  if (column > 0) main.style.setProperty("--content-width", `${resolveContentWidth(column, contentWidthPreference)}px`);
}

function installContentResize(handle, side) {
  let origin = 0; let latest = 0; let base = 0; let frame = null;
  const cancelFrame = () => { if (frame !== null) { cancelAnimationFrame(frame); frame = null; } };
  const requestedWidth = (clientX) => base + (side === "right" ? 2 * (clientX - origin) : -2 * (clientX - origin));
  const renderWidth = (clientX) => {
    const main = document.querySelector(".main");
    main.style.setProperty("--content-width", `${resolveContentWidth(main.getBoundingClientRect().width || main.offsetWidth, requestedWidth(clientX))}px`);
  };
  const clearDrag = () => { delete handle.dataset.dragging; delete document.body.dataset.contentDragging; applyContentWidth(); };
  handle.addEventListener("pointerdown", (event) => {
    event.preventDefault(); origin = event.clientX; latest = event.clientX;
    const main = document.querySelector(".main"); base = resolveContentWidth(main.getBoundingClientRect().width || main.offsetWidth, contentWidthPreference);
    handle.setPointerCapture(event.pointerId); handle.dataset.dragging = "true"; document.body.dataset.contentDragging = side;
  });
  handle.addEventListener("pointermove", (event) => {
    const box = handle.getBoundingClientRect(); handle.style.setProperty("--dsh-width-handle-pointer-y", `${event.clientY - box.top}px`);
    if (!handle.hasPointerCapture(event.pointerId)) return;
    latest = event.clientX;
    frame ??= requestAnimationFrame(() => { frame = null; renderWidth(latest); });
  });
  handle.addEventListener("pointerup", (event) => {
    if (!handle.hasPointerCapture(event.pointerId)) return;
    cancelFrame(); latest = event.clientX;
    if (latest !== origin) { const main = document.querySelector(".main"); contentWidthPreference = resolveContentWidth(main.getBoundingClientRect().width || main.offsetWidth, requestedWidth(latest)); localStorage.setItem("dsh.conversation.contentWidth", String(contentWidthPreference)); }
    handle.releasePointerCapture(event.pointerId); clearDrag();
  });
  handle.addEventListener("pointercancel", (event) => { cancelFrame(); if (handle.hasPointerCapture(event.pointerId)) handle.releasePointerCapture(event.pointerId); clearDrag(); });
  handle.addEventListener("lostpointercapture", () => { cancelFrame(); clearDrag(); });
}

async function api(path, options = {}) {
  const response = await fetch(path, { headers: { "content-type": "application/json", ...(options.headers || {}) }, ...options });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    const error = new Error(body.error || `${response.status} ${response.statusText}`);
    error.status = response.status;
    if (typeof body.code === "string") error.code = body.code;
    if (body.details && typeof body.details === "object") error.details = body.details;
    throw error;
  }
  return response;
}

function initialize() {
  if ("serviceWorker" in navigator) void navigator.serviceWorker.register("/sw.js").catch(() => {});
  $("attachment-input").accept = "image/png,image/jpeg,image/webp,image/gif";
  $("prompt").addEventListener("paste", (event) => { const files = clipboardFiles(event.clipboardData); if (files.length === 0) return; if (!event.clipboardData?.getData("text/plain")) event.preventDefault(); void uploadFiles(files, true); });
  $("cwd").value = localStorage.getItem("seal-harness.cwd") || "";
  $("locale").value = currentLocale;
  $("locale").addEventListener("change", () => { currentLocale = normalizeLocale($("locale").value); t = translator(currentLocale); localStorage.setItem("seal-harness.locale", currentLocale); applyLocale(); window.dispatchEvent(new CustomEvent("seal-harness:locale-change", { detail: { locale: currentLocale } })); });
  window.addEventListener("seal-harness:locale-change", (event) => { const next = normalizeLocale(event.detail?.locale || document.documentElement.lang); if (next === currentLocale) return; currentLocale = next; t = translator(currentLocale); $("locale").value = currentLocale; applyLocale(); });
  window.addEventListener("seal-harness:theme-change", () => { if (!state.skins.some((skin) => document.body.hasAttribute(skin.bodyAttr))) $("theme").value = "official"; });
  window.addEventListener("seal-harness:client-navigate-session", (event) => {
    const id = event.detail?.sessionId;
    if (typeof id === "string" && id) void openSession(id);
    else newSession();
  });
  window.addEventListener("offline", () => setConnectionTransportState("closed"));
  window.addEventListener("online", () => reconnectLiveEvents());
  applyLocale();
  armMessageClockDayChange();
  $("provider").addEventListener("change", () => { updateModels(); localStorage.setItem("seal-harness.provider", $("provider").value); void refreshCredentialStatus(); });
  $("model").addEventListener("change", () => {
    localStorage.setItem(`seal-harness.model.${$("provider").value}`, $("model").value);
    updateModelDetails();
  });
  $("cwd").addEventListener("change", () => localStorage.setItem("seal-harness.cwd", $("cwd").value));
  $("composer").addEventListener("submit", submit);
  $("prompt").addEventListener("input", () => { resizeComposerDraft(); persistComposerDraft(); renderPlanControl(); renderComposerPrimary(); refreshInputTriggers(); });
  $("prompt").addEventListener("keydown", handleInputTriggerKey);
  $("prompt").addEventListener("keydown", handleComposerSubmitKey);
  $("transcript").addEventListener("click", (event) => { const button = event.target.closest?.(".copy-code"); if (button) void copyActionFor(button).activate(button.parentElement.querySelector("code")?.textContent || ""); });
  installTranscriptScrollSampling($("transcript"), () => { updateTranscriptFollow(); updateActiveTurn(); });
  $("back-to-bottom").addEventListener("click", () => scrollTranscriptToBottom());
  observeComposerSeat(document.querySelector("[data-composer-seat]"), $("transcript"), globalThis.ResizeObserver, () => { if (state.transcriptFollowing) scrollTranscriptToBottom(); });
  document.addEventListener("pointerdown", (event) => { const meter = $("context-meter"); if (!meter.contains(event.target)) meter.querySelector(".context-panel")?.remove(); });
  document.addEventListener("keydown", (event) => { if (event.key === "Escape") $("context-meter").querySelector(".context-panel")?.remove(); });
  $("attachment-input").addEventListener("change", uploadAttachments);
  installAttachmentDrop({ canAccept: () => canAcceptImageInput({ admissionLocked: attachmentAdmissionLocked, interactionActive: state.pendingInteractionKey !== null || $("composer").hidden, imageCount: state.pendingAttachments.filter((block) => /^image\//i.test(block.mimeType || "")).length, maxImages: 20 }), onFiles: (files) => uploadFiles(files, true), labels: () => ({ title: t("image.dropTitle"), blocked: t("image.dropBlocked"), description: t("image.dropDesc").replace("{count}", "20").replace("{size}", "20MB") }) });
  $("cancel").addEventListener("click", cancelRun);
  $("new-session").addEventListener("click", () => newSession());
  $("session-export").addEventListener("click", downloadSessionLog);
  $("sidebar-toggle").addEventListener("click", toggleSidebar);
  installLayoutResize($("sidebar-resize"), "sidebar");
  installLayoutResize($("details-resize"), "details");
  installContentResize($("content-resize-left"), "left");
  installContentResize($("content-resize-right"), "right");
  window.addEventListener("resize", () => { applyLayout(); applyContentWidth(); });
  $("add-workspace").addEventListener("click", () => { $("workspace-path").value = $("cwd").value; $("workspace-title").value = ""; $("workspace-dialog").hidden = false; $("workspace-path").focus(); });
  $("session-search-open").addEventListener("click", openSessionSearch);
  $("session-search-input").addEventListener("focus", openSessionSearch);
  $("session-search-clear").addEventListener("click", closeSessionSearch);
  $("session-search-input").addEventListener("input", handleSessionSearchInput);
  $("session-search-input").addEventListener("keydown", (event) => { if (event.key === "Escape") closeSessionSearch(); });
  document.addEventListener("pointerdown", (event) => { const root = $("session-search"); if (shouldDismissSessionSearch(root.classList.contains("expanded"), $("session-search-input").value, event.target instanceof Node && root.contains(event.target))) closeSessionSearch(); });
  $("sessions").addEventListener("keydown", handleSidebarTreeKey);
  $("session-group-by").value = state.groupBy; $("session-order-by").value = state.orderBy;
  $("session-group-by").addEventListener("change", () => { state.groupBy = $("session-group-by").value; localStorage.setItem("dsh.workspace.groupBy", state.groupBy); void loadSessions(); });
  $("session-order-by").addEventListener("change", () => { state.orderBy = $("session-order-by").value; localStorage.setItem("dsh.workspace.orderBy", state.orderBy); void loadSessions(); });
  $("workspace-cancel").addEventListener("click", () => { $("workspace-dialog").hidden = true; });
  $("workspace-dialog").addEventListener("click", (event) => { if (event.target === $("workspace-dialog")) $("workspace-dialog").hidden = true; });
  $("workspace-form").addEventListener("submit", addWorkspace);
  $("workspace-browse").addEventListener("click", () => void pickWorkspaceDirectory());
  $("workspace-rename-form").addEventListener("submit", submitWorkspaceRename);
  $("workspace-rename-name").addEventListener("input", updateWorkspaceRenameDraft);
  $("workspace-rename-name").addEventListener("compositionstart", () => { workspaceRenameComposing = true; });
  $("workspace-rename-name").addEventListener("compositionend", () => { workspaceRenameComposing = false; });
  $("workspace-rename-name").addEventListener("keydown", (event) => { if (event.key === "Enter" && (event.isComposing || workspaceRenameComposing)) event.preventDefault(); });
  $("workspace-rename-cancel").addEventListener("click", closeWorkspaceRename);
  $("workspace-rename-close").addEventListener("click", closeWorkspaceRename);
  $("workspace-rename-dialog").addEventListener("click", (event) => { if (event.target === $("workspace-rename-dialog")) closeWorkspaceRename(); });
  $("workspace-remove-form").addEventListener("submit", submitWorkspaceRemove);
  $("workspace-remove-cancel").addEventListener("click", closeWorkspaceRemove);
  $("workspace-remove-close").addEventListener("click", closeWorkspaceRemove);
  $("workspace-remove-dialog").addEventListener("click", (event) => { if (event.target === $("workspace-remove-dialog")) closeWorkspaceRemove(); });
  $("session-rename-form").addEventListener("submit", submitSessionRename);
  $("session-rename-name").addEventListener("input", updateSessionRenameDraft);
  $("session-rename-name").addEventListener("compositionstart", () => { sessionRenameComposing = true; });
  $("session-rename-name").addEventListener("compositionend", () => { sessionRenameComposing = false; });
  $("session-rename-name").addEventListener("keydown", (event) => { if (event.key === "Enter" && (event.isComposing || sessionRenameComposing)) event.preventDefault(); });
  $("session-rename-cancel").addEventListener("click", closeSessionRename);
  $("session-rename-close").addEventListener("click", closeSessionRename);
  $("session-rename-dialog").addEventListener("click", (event) => { if (event.target === $("session-rename-dialog")) closeSessionRename(); });
  $("plugin-remove-form").addEventListener("submit", submitPluginRemove);
  $("plugin-remove-cancel").addEventListener("click", closePluginRemove);
  $("plugin-remove-close").addEventListener("click", closePluginRemove);
  $("plugin-remove-dialog").addEventListener("click", (event) => { if (event.target === $("plugin-remove-dialog")) closePluginRemove(); });
  $("directory-browser-close").addEventListener("click", closeDirectoryBrowser);
  $("directory-browser-cancel").addEventListener("click", closeDirectoryBrowser);
  $("directory-browser-dialog").addEventListener("click", (event) => { if (event.target === $("directory-browser-dialog")) closeDirectoryBrowser(); });
  $("directory-browser-hidden").addEventListener("click", () => { directoryShowHidden = !directoryShowHidden; renderDirectoryBrowser(); });
  $("directory-browser-new").addEventListener("click", openDirectoryCreate);
  $("directory-browser-open").addEventListener("click", acceptBrowsedDirectory);
  $("directory-browser-edit").addEventListener("click", beginDirectoryPathEdit);
  $("directory-browser-path-form").addEventListener("submit", (event) => { event.preventDefault(); if (directoryInputComposing) return; const path = $("directory-browser-path").value; if (!path.trim()) return; directoryPreviewSuspended = true; if (directoryPreviewTimer !== null) clearTimeout(directoryPreviewTimer); directoryPreviewTimer = null; void loadBrowsedDirectory(path).then((loaded) => { if (!loaded) return; directoryPathEditing = false; $("directory-browser-open").disabled = false; $("directory-browser-new").disabled = false; renderDirectoryBrowser(); }); });
  $("directory-browser-path-form").addEventListener("focusout", (event) => { if (!directoryPathEditing) return; const next = event.relatedTarget; if (next instanceof Node && $("directory-browser-path-form").contains(next)) return; if (next === null && !document.hasFocus()) return; cancelDirectoryPathEdit(); });
  $("directory-browser-path").addEventListener("input", scheduleDirectoryPreview);
  for (const input of [$("directory-browser-path"), $("directory-create-name")]) {
    input.addEventListener("compositionstart", () => { directoryInputComposing = true; });
    input.addEventListener("compositionend", () => { directoryInputComposing = false; });
    input.addEventListener("keydown", (event) => { if (event.key === "Enter" && (event.isComposing || directoryInputComposing)) event.preventDefault(); });
  }
  $("directory-create-cancel").addEventListener("click", closeDirectoryCreate);
  $("directory-create-dialog").addEventListener("click", (event) => { if (event.target === $("directory-create-dialog")) closeDirectoryCreate(); });
  $("directory-create-form").addEventListener("submit", (event) => { if (directoryInputComposing) { event.preventDefault(); return; } void createBrowsedDirectory(event); });
  $("permission-risk-ack").addEventListener("change", () => { $("permission-risk-confirm").disabled = !$("permission-risk-ack").checked; });
  $("permission-risk-cancel").addEventListener("click", () => settlePermissionRisk(false));
  $("permission-risk-dialog").addEventListener("click", (event) => { if (event.target === $("permission-risk-dialog")) settlePermissionRisk(false); });
  $("permission-risk-form").addEventListener("submit", (event) => { event.preventDefault(); if ($("permission-risk-ack").checked) settlePermissionRisk(true); });
  $("file-open-cancel").addEventListener("click", closeFileOpenError);
  $("file-open-retry").addEventListener("click", () => { if (fileOpenError !== null) void requestOpenFile(fileOpenError.path); });
  $("file-open-dialog").addEventListener("click", (event) => { if (event.target === $("file-open-dialog")) closeFileOpenError(); });
  $("save-key").addEventListener("click", saveKey);
  $("clear-key").addEventListener("click", clearKey);
  $("custom-provider-form").addEventListener("submit", discoverCustomProvider);
  $("theme").addEventListener("change", () => void switchTheme($("theme").value));
  $("agent-preset").addEventListener("change", () => void selectAgentPreset());
  $("busy-enter").addEventListener("change", () => void saveBusyEnter($("busy-enter").value));
  $("transcript-view").addEventListener("change", () => void saveTranscriptView($("transcript-view").value));
  $("settings-open").addEventListener("click", () => openSettings("general"));
  $("model-settings-open").addEventListener("click", () => openSettings("models"));
  $("settings-close").addEventListener("click", closeSettings);
  $("settings-modal").addEventListener("click", (event) => { if (event.target === $("settings-modal")) closeSettings(); });
  for (const button of document.querySelectorAll("[data-settings-target]")) {
    button.addEventListener("click", () => showSettingsSection(button.dataset.settingsTarget));
  }
  $("plugin-install").addEventListener("submit", installPlugin);
  $("plugins-refresh").addEventListener("click", () => void loadPlugins());
  $("plugin-inventory-search").addEventListener("input", renderPluginInventory);
  $("settings-document-open").addEventListener("click", () => void openSettingsDocument());
  $("agent-preset-view-close").addEventListener("click", closeAgentPresetView);
  $("agent-preset-view-dialog").addEventListener("click", (event) => { if (event.target === $("agent-preset-view-dialog")) closeAgentPresetView(); });
  $("agent-preset-copy-form").addEventListener("submit", submitAgentPresetCopy); $("agent-preset-copy-cancel").addEventListener("click", closeAgentPresetCopy); $("agent-preset-copy-close").addEventListener("click", closeAgentPresetCopy); $("agent-preset-copy-id").addEventListener("input", renderAgentPresetCopyDialog); $("agent-preset-copy-name").addEventListener("input", () => { $("agent-preset-copy-error").hidden = true; });
  $("agent-preset-delete-form").addEventListener("submit", submitAgentPresetDelete); $("agent-preset-delete-cancel").addEventListener("click", closeAgentPresetDelete); $("agent-preset-delete-close").addEventListener("click", closeAgentPresetDelete);
  for (const id of ["agent-preset-copy-dialog", "agent-preset-delete-dialog"]) $(id).addEventListener("click", (event) => { if (event.target === $(id)) id.includes("copy") ? closeAgentPresetCopy() : closeAgentPresetDelete(); });
  document.addEventListener("keydown", (event) => { if (event.key !== "Escape") return; if (!$("agent-preset-view-dialog").hidden) closeAgentPresetView(); else if (!$("agent-preset-copy-dialog").hidden) closeAgentPresetCopy(); else if (!$("agent-preset-delete-dialog").hidden) closeAgentPresetDelete(); });
  $("settings-refresh").addEventListener("click", () => void loadSettingsConfiguration());
  $("state-refresh").addEventListener("click", () => void loadSessionState());
  $("state-tab").addEventListener("click", () => selectDetailsTab("state"));
  $("trajectory-tab").addEventListener("click", () => selectDetailsTab("trajectory"));
  $("load-earlier").addEventListener("click", () => void loadEarlierMessages());
  document.addEventListener("keydown", (event) => { if (event.key !== "Escape") return; if (sessionActionMenu !== null) closeSessionActionMenu(true); else if (!$("plugin-remove-dialog").hidden) closePluginRemove(); else if (!$("session-rename-dialog").hidden) closeSessionRename(); else if (!$("workspace-rename-dialog").hidden) closeWorkspaceRename(); else if (!$("workspace-remove-dialog").hidden) closeWorkspaceRemove(); else if (!$("directory-create-dialog").hidden) closeDirectoryCreate(); else if (!$("directory-browser-dialog").hidden && directoryPathEditing) cancelDirectoryPathEdit(); else if (!$("directory-browser-dialog").hidden) closeDirectoryBrowser(); else if (!$("file-open-dialog").hidden) closeFileOpenError(); else if (!$("permission-risk-dialog").hidden) settlePermissionRisk(false); else if (!$("settings-modal").hidden) closeSettings(); });
  document.addEventListener("pointerdown", (event) => { if (sessionActionMenu !== null && !sessionActionMenu.contains(event.target) && event.target !== sessionActionMenuTrigger) closeSessionActionMenu(); });
  document.addEventListener("pointerdown", (event) => { if (state.jobOpen && !event.target.closest?.(".job-control")) { state.jobOpen = false; renderJobControl(); } });
  connectLiveEvents();
  void bootstrap();
  applyLayout();
  applyContentWidth();
  setInterval(() => { void loadApprovals(); void loadQueue(); }, 750);
  let refreshingState = false;
  setInterval(async () => {
    if (refreshingState || document.hidden || !state.sessionId) return;
    if (!state.running && !document.querySelector('.subagent-status[data-status="running"]')) return;
    refreshingState = true;
    try { await loadSessionState(); } finally { refreshingState = false; }
  }, 2000);
}

function applyLocale() {
  closeSessionHover();
  document.documentElement.lang = currentLocale;
  for (const node of document.querySelectorAll("[data-i18n]")) node.textContent = t(node.dataset.i18n);
  for (const node of document.querySelectorAll("[data-i18n-placeholder]")) node.placeholder = t(node.dataset.i18nPlaceholder);
  for (const node of document.querySelectorAll("[data-i18n-aria-label]")) node.setAttribute("aria-label", t(node.dataset.i18nAriaLabel));
  localizeCodeCopyButtons(document);
  for (const button of document.querySelectorAll("[data-copy-action]")) labelCopyButton(button, copyButtonActions.get(button)?.state() === "copied");
  for (const button of document.querySelectorAll("[data-branch-action]")) labelBranchButton(button, button.dataset.branchUnavailable === "true");
  refreshMessageClocks();
  renderPlanControl();
  renderComposerPrimary();
  renderStatsLine();
  renderScheduleCatalog();
  renderConnectionIndicator();
  updateProviders(); updateModelDetails();
  renderFileOpenError();
  renderDirectoryBrowser();
  renderDirectoryCreateTitle();
  renderWorkspaceMutationDialogs();
  renderPluginRemoveDialog();
  renderInstalledPlugins();
  renderPluginInventory();
  renderDshGeneralSettings();
  renderAgentPresetSelector($("agent-preset").value);
  renderAgentPresetCopyDialog(); renderAgentPresetDeleteDialog();
  renderSettingsConfigurationLabels();
  renderAttachmentChips();
  if (state.sessionId && !state.running) void refreshOpenSession(state.sessionId);
}

function refreshMessageClocks(now = Date.now()) {
  for (const clock of document.querySelectorAll("time.message-clock")) {
    const time = new Date(clock.dateTime).getTime();
    if (Number.isFinite(time)) clock.textContent = formatMessageClock(time, currentLocale, now);
  }
}

function armMessageClockDayChange() {
  const arm = () => { const now = Date.now(); refreshMessageClocks(now); setTimeout(arm, msUntilNextLocalMidnight(now)); };
  const now = Date.now(); setTimeout(arm, msUntilNextLocalMidnight(now));
}

function persistComposerDraft() { writeConversationDraft(localStorage, state.sessionId, $("prompt").value); }
function resizeComposerDraft() { const input = $("prompt"); input.style.height = "auto"; const geometry = composerTextGeometry(input.scrollHeight); input.style.height = `${geometry.height}px`; input.style.overflowY = geometry.overflowY; }
function restoreComposerDraft() { $("prompt").value = readConversationDraft(localStorage, state.sessionId); resizeComposerDraft(); hideInputTriggers(); renderPlanControl(); renderComposerPrimary(); }
function setComposerDraft(value) { $("prompt").value = value; resizeComposerDraft(); persistComposerDraft(); renderPlanControl(); renderComposerPrimary(); }

function connectLiveEvents() {
  if (!("EventSource" in window)) { setConnectionTransportState("closed"); return; }
  if (state.eventSource) return;
  setConnectionTransportState("connecting");
  const source = new EventSource("/api/events");
  state.eventSource = source;
  source.addEventListener("open", () => { if (state.eventSource === source) { setConnectionTransportState("open"); window.dispatchEvent(new Event("seal-harness:events-connected")); } });
  source.addEventListener("error", () => { if (state.eventSource === source) setConnectionTransportState(navigator.onLine === false ? "closed" : "connecting"); });
  source.addEventListener("models.updated", () => void refreshModels());
  source.addEventListener("settings.updated", (event) => {
    let payload; try { payload = JSON.parse(event.data); } catch { payload = {}; }
    window.dispatchEvent(new CustomEvent("seal-harness:settings-updated", { detail: payload }));
    if (payload.namespace === "ui-conversation" || payload.namespace === undefined) void loadBusyEnter();
    if (payload.namespace === "ui-chat" || payload.namespace === undefined) void loadTranscriptView();
    if (!$("settings-modal").hidden && document.querySelector('[data-settings-page="configuration"]')?.classList.contains("active")) void loadSettingsConfiguration();
  });
  source.addEventListener("session.appended", (event) => {
    let payload; try { payload = JSON.parse(event.data); } catch { return; }
    window.dispatchEvent(new CustomEvent("seal-harness:session-appended", { detail: payload }));
    const compacting = compactionActivity.consume(payload, state.sessionId);
    if (compacting !== undefined) setStatus(compacting === 'failed' ? (currentLocale === "zh-CN" ? "上下文压缩失败" : "Context compaction failed") : compacting ? (currentLocale === "zh-CN" ? "正在压缩上下文" : "Compacting context") : state.running ? (currentLocale === "zh-CN" ? "准备模型请求" : "Preparing request") : t("status.ready"), compacting === 'failed');
    scheduleSessionRefresh(payload.sessionId);
  });
}

function setConnectionTransportState(transportState) {
  const previous = state.connectionFeedback; const next = nextConnectionFeedback(previous, transportState, navigator.onLine !== false);
  if (state.connectionRecoveryTimer) { clearTimeout(state.connectionRecoveryTimer); state.connectionRecoveryTimer = null; }
  state.connectionFeedback = next; renderConnectionIndicator();
  if (next === "recovered") state.connectionRecoveryTimer = setTimeout(() => { state.connectionRecoveryTimer = null; if (state.connectionFeedback === "recovered") { state.connectionFeedback = null; renderConnectionIndicator(); } }, 2_000);
}

function reconnectLiveEvents() {
  state.eventSource?.close(); state.eventSource = null; setConnectionTransportState("connecting"); connectLiveEvents();
}

function renderConnectionIndicator() {
  const root = $("connection-indicator"); if (!root) return; const phase = state.connectionFeedback; root.replaceChildren(); root.hidden = phase === null;
  if (phase === null) return;
  const recovered = phase === "recovered"; const node = document.createElement(recovered ? "span" : "button"); node.className = `connection-status ${recovered ? "success" : "warning"}`;
  if (!recovered) { node.type = "button"; node.addEventListener("click", reconnectLiveEvents); }
  const label = t(phase === "disconnected" ? "connection.error" : phase === "connecting" ? "connection.connecting" : "connection.connected");
  node.setAttribute(recovered ? "aria-label" : "aria-label", recovered ? label : t(phase === "connecting" ? "connection.restart" : "connection.reconnect")); node.setAttribute(recovered ? "role" : "data-phase", recovered ? "status" : phase);
  node.textContent = `${recovered ? "✓" : "⚠"} ${label}${phase === "connecting" ? "…" : ""}`; root.append(node);
}

function scheduleSessionRefresh(sessionId) {
  clearTimeout(state.sessionsRefreshTimer);
  state.sessionsRefreshTimer = setTimeout(() => void loadSessions(), 60);
  if (sessionId !== state.sessionId) return;
  if (state.running) { state.sessionInvalidated = true; return; }
  clearTimeout(state.sessionRefreshTimer);
  state.sessionRefreshTimer = setTimeout(() => void refreshOpenSession(sessionId), 60);
}

async function refreshModels() {
  try {
    state.models = await (await api("/api/models")).json();
    updateProviders();
    updateModels();
    await refreshCredentialStatus();
  } catch (error) { setStatus(error.message, true); }
}

async function refreshCredentialStatus() {
  const provider = $("provider").value;
  try {
    const descriptor = await (await api(`/api/credentials/${encodeURIComponent(provider)}`)).json();
    if (provider !== $("provider").value) return; state.credential = descriptor; renderCredentialStatus();
    if (!refreshCredentialStatus.loginUpdate) refreshCredentialStatus.loginUpdate = installProviderLogin({ api, provider: $("provider"), host: $("credential-status").parentElement, refresh: () => refreshCredentialStatus() });
    void refreshCredentialStatus.loginUpdate();
    // Missing credentials belong to the selected provider's settings, not a
    // startup modal. Local/custom endpoints may not require an API key at all.
  } catch { if (provider !== $("provider").value) return; state.credential = null; renderCredentialStatus(); }
}

function renderCredentialStatus() {
  const model = credentialStatusModel(state.credential); const label = $("credential-status");
  label.textContent = t(`models.credential${model.label[0].toUpperCase()}${model.label.slice(1)}`);
  $("api-key").disabled = !model.writable; $("save-key").disabled = !model.writable; $("clear-key").disabled = !model.clearable;
}

async function refreshAgentPresetSelector() {
  const selected = $("agent-preset").value;
  try { const roster = await (await api("/api/dsh/agent-presets")).json(); state.presets = roster.presets ?? []; agentPresetDefaultId = state.presets.find((preset) => preset.isDefault)?.id ?? null; $("agent-preset").title = ""; renderAgentPresetSelector(selected); if (!state.sessionId) $("agent-preset").dataset.committed = $("agent-preset").value; }
  catch (error) { renderAgentPresetSelector(selected); $("agent-preset").title = error instanceof Error ? error.message : String(error); setStatus($("agent-preset").title, true); }
}

function renderAgentPresetSelector(selected) { const select = $("agent-preset"); const available = state.presets.filter((preset) => !preset.broken); select.replaceChildren(...available.map((preset) => new Option(agentPresetDisplayText(preset, t).name, preset.id))); select.value = available.some((preset) => preset.id === selected) ? selected : agentPresetDefaultId ?? available[0]?.id ?? ""; }

async function selectAgentPreset() {
  const select = $("agent-preset"); const selected = select.value; const previous = select.dataset.committed || agentPresetDefaultId || "";
  if (!state.sessionId) { select.dataset.committed = selected; return; }
  const sessionId = state.sessionId; const summary = state.sessions.find((session) => session.id === sessionId);
  if (summary?.blank !== true || state.running || agentPresetSelectBusy) { select.value = previous; return; }
  agentPresetSelectBusy = true; select.disabled = true;
  try { await api(`/api/sessions/${encodeURIComponent(sessionId)}/agent-preset`, { method: "PUT", body: JSON.stringify({ agentPreset: selected }) }); if (state.sessionId !== sessionId) return; select.dataset.committed = selected; await loadSessionState(); }
  catch (error) { if (state.sessionId !== sessionId) return; select.value = previous; setStatus(t("settings.presetSwitchRefused").replace("{reason}", error instanceof Error ? error.message : String(error)), true); }
  finally { agentPresetSelectBusy = false; if (state.sessionId === sessionId) select.disabled = state.running || state.sessions.find((session) => session.id === sessionId)?.blank !== true; }
}

async function bootstrap() {
  document.documentElement.dataset.sealBoot = "loading";
  try {
    const health = await (await api("/api/health")).json();
    hostHome = typeof health.home === "string" ? health.home : "";
    if (!$("cwd").value) $("cwd").value = health.cwd;
    state.models = await (await api("/api/models")).json();
    await refreshAgentPresetSelector();
    updateProviders();
    updateModels();
    await refreshCredentialStatus();
    await loadClientPlugins();
    await loadThemes();
    await loadBusyEnter();
    await loadTranscriptView();
    await loadSessions();
    const requestedSettings = new URL(window.location.href).searchParams.get("settings");
    if (["general", "models", "configuration", "plugins"].includes(requestedSettings)) openSettings(requestedSettings);
    document.documentElement.dataset.sealBoot = "ready";
  } catch (error) { document.documentElement.dataset.sealBoot = "error"; setStatus(error.message, true); }
}

async function loadBusyEnter() {
  try {
    const response = await (await api("/api/settings")).json();
    const descriptor = response.namespaces?.find((entry) => entry.namespace === "ui-conversation");
    if (!descriptor) return;
    state.busyEnter = descriptor.value?.busyEnter === "steer" ? "steer" : "queue";
    state.busyEnterRevision = descriptor.revision;
    $("busy-enter").value = state.busyEnter;
  } catch (error) { setStatus(error.message, true); }
}

async function saveBusyEnter(value) {
  const busyEnter = value === "steer" ? "steer" : "queue";
  try {
    const descriptor = await (await api("/api/settings/ui-conversation", { method: "PUT", body: JSON.stringify({ mode: "mutate", expectedRevision: state.busyEnterRevision, ops: [{ op: "set", path: ["busyEnter"], value: busyEnter }] }) })).json();
    state.busyEnter = descriptor.value.busyEnter;
    state.busyEnterRevision = descriptor.revision;
    $("busy-enter").value = state.busyEnter;
  } catch (error) { $("busy-enter").value = state.busyEnter; setStatus(error.message, true); }
}

async function loadTranscriptView() {
  try {
    const response = await (await api("/api/settings")).json();
    const descriptor = response.namespaces?.find((entry) => entry.namespace === "ui-chat");
    if (!descriptor) return;
    state.transcriptView = descriptor.value?.transcriptView === "normal" ? "normal" : "compact";
    state.transcriptViewRevision = descriptor.revision;
    $("transcript-view").value = state.transcriptView;
    applyTranscriptView();
  } catch (error) { setStatus(error.message, true); }
}

async function saveTranscriptView(value) {
  const transcriptView = value === "normal" ? "normal" : "compact";
  try {
    const descriptor = await (await api("/api/settings/ui-chat", { method: "PUT", body: JSON.stringify({ mode: "mutate", expectedRevision: state.transcriptViewRevision, ops: [{ op: "set", path: ["transcriptView"], value: transcriptView }] }) })).json();
    state.transcriptView = descriptor.value.transcriptView;
    state.transcriptViewRevision = descriptor.revision;
    $("transcript-view").value = state.transcriptView;
    applyTranscriptView();
  } catch (error) { $("transcript-view").value = state.transcriptView; setStatus(error.message, true); }
}

function updateProviders() {
  const select = $("provider");
  const requested = localStorage.getItem("seal-harness.provider") || $("provider").value;
  const names = [...new Set(state.models.map((model) => model.provider))].sort((left, right) => left.localeCompare(right));
  select.replaceChildren(...names.map((name) => new Option(name, name)));
  if (names.includes(requested)) select.value = requested;
  else if (names.length > 0) select.value = names[0];
  $("model-catalog-count").textContent = t("models.catalogCount").replace("{models}", state.models.length).replace("{providers}", names.length);
}

async function loadClientPlugins() {
  // Share the bootstrap import promise; network timing must not gate startup.
  await import("/vendor/client-runtime.mjs?v=0.3.4-30");
  const entries = await (await api("/api/plugins/client")).json();
  const results = await window.SealDshPlugins.load(entries);
  await api("/api/plugins/client-state", {
    method: "POST",
    body: JSON.stringify({
      results,
      active: window.SealDshPlugins.active(),
      surfaces: {
        characterStage: document.querySelector("[data-skin-chrome='character-stage']") !== null,
        sidebarMascot: document.querySelector("[data-skin-chrome='sidebar-mascot']") !== null,
        topTrim: document.querySelector("[data-skin-chrome='top-trim']") !== null,
        conversationPane: document.querySelector("[data-pane='conversation']") !== null,
      },
    }),
  });
  const active = results.filter((entry) => entry.status === "active").length;
  const waiting = results.filter((entry) => entry.status === "adapter-required").length;
  $("plugin-status").textContent = `${active} active${waiting ? ` · ${waiting} need adapters` : ""}`;
}

async function loadThemes() {
  try {
    const body = await (await api("/api/dsh/skins")).json();
    state.skins = body.skins || [];
    const select = $("theme");
    select.replaceChildren(new Option("Official", "official"));
    for (const skin of state.skins) select.append(new Option(skin.name, skin.id));
    const target = state.skins.some((skin) => skin.id === body.target) ? body.target : "official";
    await window.SealDshPlugins.activateSkin(target, state.skins);
    select.value = target;
  } catch {
    state.skins = [];
    $("theme").replaceChildren(new Option("Official", "official"));
  }
}

async function switchTheme(target) {
  try {
    await api("/api/dsh/skins", { method: "POST", body: JSON.stringify({ target }) });
    await window.SealDshPlugins.activateSkin(target, state.skins);
    setStatus(t("status.skinActive").replace("{name}", target));
  } catch (error) {
    setStatus(error.message, true);
  }
}

function openSettings(section) {
  showSettingsSection(section);
  $("settings-modal").hidden = false;
  $("root").inert = true;
  requestAnimationFrame(() => $("settings-close").focus());
}

function closeSettings() {
  $("settings-modal").hidden = true;
  $("root").inert = false;
  $("settings-open").focus();
}

function showSettingsSection(section = "general") {
  for (const button of document.querySelectorAll("[data-settings-target]")) {
    button.classList.toggle("active", button.dataset.settingsTarget === section);
  }
  for (const page of document.querySelectorAll("[data-settings-page]")) {
    page.classList.toggle("active", page.dataset.settingsPage === section);
  }
  if (section === "plugins") void loadPlugins();
  if (section === "configuration") void loadSettingsConfiguration();
  if (section === "general") void loadDshGeneralSettings();
}

async function loadDshGeneralSettings() {
  dshGeneralSnapshot = null; dshGeneralError = null; dshGeneralWarning = null; renderDshGeneralSettings();
  const [settings, presets, capabilities] = await Promise.allSettled([
    api("/api/dsh/settings/describe").then((response) => response.json()),
    api("/api/dsh/agent-presets").then((response) => response.json()),
    api("/api/dsh/settings/capabilities").then((response) => response.json()),
  ]);
  if (presets.status === "rejected") dshGeneralError = presets.reason instanceof Error ? presets.reason.message : String(presets.reason);
  else {
    const degraded = [settings, capabilities].filter((result) => result.status === "rejected");
    if (degraded.length > 0) dshGeneralWarning = degraded.map((result) => result.reason instanceof Error ? result.reason.message : String(result.reason)).join("; ");
    dshGeneralSnapshot = {
      settings: settings.status === "fulfilled" ? settings.value : { writable: false, hasDocument: false, namespaces: [] },
      presets: presets.value,
      capabilities: capabilities.status === "fulfilled" ? capabilities.value : { canOpenAgentPresetDirectory: false },
    };
  }
  renderDshGeneralSettings();
}

function renderDshGeneralSettings() {
  const container = $("agent-preset-management"); if (!container) return; container.replaceChildren(); const notice = $("dsh-general-notice"); const open = $("settings-document-open"); open.hidden = !dshGeneralSnapshot?.settings?.hasDocument; open.disabled = false;
  if (dshGeneralError !== null) { notice.replaceChildren(document.createTextNode(`${dshGeneralError} `)); const retry = document.createElement("button"); retry.type = "button"; retry.textContent = t("common.retry"); retry.addEventListener("click", () => void loadDshGeneralSettings()); notice.append(retry); return; }
  if (dshGeneralSnapshot === null) { notice.textContent = t("settings.filesLoading"); return; }
  const presets = dshGeneralSnapshot.presets?.presets ?? [];
  if (dshGeneralWarning !== null) { notice.replaceChildren(document.createTextNode(`${t("settings.partialUnavailable")}: ${dshGeneralWarning} `)); const retry = document.createElement("button"); retry.type = "button"; retry.textContent = t("common.retry"); retry.addEventListener("click", () => void loadDshGeneralSettings()); notice.append(retry); }
  else notice.textContent = presets.length === 0 && !open.hidden ? "" : presets.length === 0 ? t("settings.noPresetManagement") : "";
  const grouped = groupedAgentPresets(presets);
  const creatorAvailable = presets.some((preset) => preset.id === "cordis");
  for (const trust of ["system", "user"]) {
    const rows = grouped[trust]; if (rows.length === 0 && !(trust === "user" && creatorAvailable)) continue;
    const group = document.createElement("section"); group.className = "agent-preset-group"; const heading = document.createElement("h4"); heading.textContent = t(trust === "system" ? "settings.presetBuiltIn" : "settings.presetCustom"); group.append(heading);
    for (const preset of rows) {
      const text = agentPresetDisplayText(preset, t); const card = document.createElement("div"); card.className = `agent-preset-card${preset.isDefault ? " active" : ""}${preset.broken ? " broken" : ""}`; const copy = document.createElement("div"); const name = document.createElement("strong"); name.textContent = text.name; const description = document.createElement("span"); description.className = "agent-preset-description"; description.textContent = text.description || t("settings.presetNoDescription"); description.title = description.textContent; const meta = document.createElement("span"); meta.textContent = [preset.id, preset.isDefault ? t("plugins.runtimeDefault") : "", preset.broken || ""].filter(Boolean).join(" · "); copy.append(name, description, meta); const actions = document.createElement("div"); actions.className = "agent-preset-actions"; if (!preset.isDefault && !preset.broken) { const makeDefault = document.createElement("button"); makeDefault.type = "button"; makeDefault.textContent = agentPresetDefaultBusy === preset.id ? t("settings.presetSettingDefault") : t("settings.presetSetDefault"); makeDefault.disabled = !dshGeneralSnapshot.settings?.writable || agentPresetDefaultBusy !== null; makeDefault.title = dshGeneralSnapshot.settings?.writable ? "" : t("settings.presetDefaultReadOnly"); makeDefault.addEventListener("click", () => void makeAgentPresetDefault(preset.id)); actions.append(makeDefault); } if (preset.trust === "system" && !preset.broken) { const view = document.createElement("button"); view.type = "button"; view.textContent = t("settings.presetView"); view.addEventListener("click", () => void viewAgentPreset(preset)); actions.append(view); } const duplicate = document.createElement("button"); duplicate.type = "button"; duplicate.textContent = t("settings.presetCopy"); duplicate.disabled = !dshGeneralSnapshot.presets?.authorable || Boolean(preset.broken); duplicate.title = preset.broken ? t("settings.presetBrokenNoCopy") : dshGeneralSnapshot.presets?.authorable ? "" : t("settings.presetCopyUnavailable"); duplicate.addEventListener("click", () => openAgentPresetCopy(preset)); actions.append(duplicate);
      if (preset.trust === "user") { const folder = document.createElement("button"); folder.type = "button"; folder.textContent = dshGeneralSnapshot.capabilities?.canOpenAgentPresetDirectory ? t("settings.presetOpenFolder") : t("settings.presetRevealFolder"); folder.addEventListener("click", () => void openAgentPresetDirectory(preset.id, folder)); actions.append(folder); }
      if (preset.trust === "user") { const remove = document.createElement("button"); remove.type = "button"; remove.className = "danger"; remove.textContent = t("settings.presetDelete"); remove.addEventListener("click", () => openAgentPresetDelete(preset)); actions.append(remove); }
      card.append(copy, actions); const revealed = agentPresetRevealedPaths.get(preset.id); if (revealed) { const path = document.createElement("code"); path.className = "agent-preset-revealed-path"; path.textContent = revealed; card.append(path); } group.append(card);
    }
    if (trust === "user" && creatorAvailable) { const creator = document.createElement("button"); creator.type = "button"; creator.className = "agent-preset-creator"; creator.disabled = !dshGeneralSnapshot.presets?.authorable || state.running; creator.title = !dshGeneralSnapshot.presets?.authorable ? t("settings.presetCreatorUnavailable") : state.running ? t("settings.presetCreatorBusy") : ""; creator.textContent = `＋ ${t("settings.presetCreator")}`; creator.addEventListener("click", startAgentPresetCreator); group.append(creator); }
    container.append(group);
  }
}

function startAgentPresetCreator() { if (state.running) return; const preset = dshGeneralSnapshot?.presets?.presets?.find((row) => row.id === "cordis"); if (preset && !state.presets.some((row) => row.id === preset.id)) state.presets.push(preset); newSession("cordis"); closeSettings(); $("prompt").focus(); }

async function makeAgentPresetDefault(id) { if (agentPresetDefaultBusy !== null || !dshGeneralSnapshot?.settings?.writable) return; agentPresetDefaultBusy = id; $("dsh-general-notice").textContent = ""; renderDshGeneralSettings(); try { await api("/api/dsh/settings/agent-presets", { method: "PUT", body: JSON.stringify({ mode: "update", value: { default: id } }) }); agentPresetDefaultBusy = null; await refreshAgentPresetSurfaces(); } catch (error) { agentPresetDefaultBusy = null; renderDshGeneralSettings(); $("dsh-general-notice").textContent = error instanceof Error ? error.message : String(error); } }

async function openSettingsDocument() { const button = $("settings-document-open"); button.disabled = true; $("dsh-general-notice").textContent = ""; try { await api("/api/dsh/settings/open-document", { method: "POST", body: "{}" }); } catch (error) { $("dsh-general-notice").textContent = error instanceof Error ? error.message : String(error); } finally { button.disabled = false; } }

async function viewAgentPreset(preset) { try { const result = await (await api("/api/dsh/agent-presets", { method: "POST", body: JSON.stringify({ operation: "read", agentPreset: preset.id }) })).json(); $("agent-preset-view-title").textContent = preset.trust === "system" ? agentPresetDisplayText(preset, t).name : result.name || agentPresetDisplayText(preset, t).name; $("agent-preset-view-content").textContent = result.content; $("agent-preset-view-dialog").hidden = false; $("agent-preset-view-close").focus(); } catch (error) { $("dsh-general-notice").textContent = error instanceof Error ? error.message : String(error); } }
function closeAgentPresetView() { $("agent-preset-view-dialog").hidden = true; }
async function openAgentPresetDirectory(id, button = null) { if (button) button.disabled = true; try { const result = await (await api("/api/dsh/settings/open-agent-preset-directory", { method: "POST", body: JSON.stringify({ agentPreset: id }) })).json(); if (result?.opened === false && typeof result.path === "string") { agentPresetRevealedPaths.set(id, result.path); renderDshGeneralSettings(); } } catch (error) { $("dsh-general-notice").textContent = error instanceof Error ? error.message : String(error); } finally { if (button?.isConnected) button.disabled = false; } }

async function refreshAgentPresetSurfaces() { await Promise.all([loadDshGeneralSettings(), refreshAgentPresetSelector(), loadPlugins()]); }

function openAgentPresetCopy(preset) { agentPresetCopySource = preset; agentPresetMutationBusy = false; $("agent-preset-copy-id").value = ""; $("agent-preset-copy-name").value = ""; $("agent-preset-copy-error").hidden = true; $("agent-preset-copy-dialog").hidden = false; renderAgentPresetCopyDialog(); $("agent-preset-copy-id").focus(); }
function closeAgentPresetCopy() { if (agentPresetMutationBusy) return; agentPresetCopySource = null; $("agent-preset-copy-dialog").hidden = true; }
function renderAgentPresetCopyDialog() { if (!$(`agent-preset-copy-dialog`) || agentPresetCopySource === null) return; $("agent-preset-copy-description").textContent = t("settings.presetCopyDescription").replace("{name}", agentPresetDisplayText(agentPresetCopySource, t).name); const issue = agentPresetCopyIssue($("agent-preset-copy-id").value, dshGeneralSnapshot?.presets?.presets); $("agent-preset-copy-submit").disabled = agentPresetMutationBusy || issue !== null; $("agent-preset-copy-cancel").disabled = agentPresetMutationBusy; $("agent-preset-copy-close").disabled = agentPresetMutationBusy; if (!agentPresetMutationBusy && issue !== null && $("agent-preset-copy-id").value !== "") { $("agent-preset-copy-error").textContent = t(`settings.presetId.${issue}`); $("agent-preset-copy-error").hidden = false; } else if (!agentPresetMutationBusy) $("agent-preset-copy-error").hidden = true; }
async function submitAgentPresetCopy(event) { event.preventDefault(); if (agentPresetCopySource === null || agentPresetMutationBusy) return; const id = $("agent-preset-copy-id").value; if (agentPresetCopyIssue(id, dshGeneralSnapshot?.presets?.presets) !== null) return; agentPresetMutationBusy = true; renderAgentPresetCopyDialog(); try { const name = $("agent-preset-copy-name").value.trim(); await api("/api/dsh/agent-presets", { method: "POST", body: JSON.stringify({ operation: "copy", from: agentPresetCopySource.id, id, ...(name ? { name } : {}) }) }); agentPresetMutationBusy = false; agentPresetCopySource = null; $("agent-preset-copy-dialog").hidden = true; await refreshAgentPresetSurfaces(); await openAgentPresetDirectory(id); } catch (error) { agentPresetMutationBusy = false; renderAgentPresetCopyDialog(); $("agent-preset-copy-error").textContent = error instanceof Error ? error.message : String(error); $("agent-preset-copy-error").hidden = false; } }

function openAgentPresetDelete(preset) { agentPresetDeleteTarget = preset; agentPresetMutationBusy = false; $("agent-preset-delete-error").hidden = true; $("agent-preset-delete-dialog").hidden = false; renderAgentPresetDeleteDialog(); $("agent-preset-delete-submit").focus(); }
function closeAgentPresetDelete() { if (agentPresetMutationBusy) return; agentPresetDeleteTarget = null; $("agent-preset-delete-dialog").hidden = true; }
function renderAgentPresetDeleteDialog() { if (!$(`agent-preset-delete-dialog`) || agentPresetDeleteTarget === null) return; $("agent-preset-delete-description").textContent = t("settings.presetDeleteDescription").replace("{name}", agentPresetDisplayText(agentPresetDeleteTarget, t).name); $("agent-preset-delete-submit").disabled = agentPresetMutationBusy; $("agent-preset-delete-cancel").disabled = agentPresetMutationBusy; $("agent-preset-delete-close").disabled = agentPresetMutationBusy; }
async function submitAgentPresetDelete(event) { event.preventDefault(); if (agentPresetDeleteTarget === null || agentPresetMutationBusy) return; const id = agentPresetDeleteTarget.id; agentPresetMutationBusy = true; renderAgentPresetDeleteDialog(); try { await api("/api/dsh/agent-presets", { method: "POST", body: JSON.stringify({ operation: "delete", id }) }); agentPresetRevealedPaths.delete(id); agentPresetMutationBusy = false; agentPresetDeleteTarget = null; $("agent-preset-delete-dialog").hidden = true; await refreshAgentPresetSurfaces(); } catch (error) { agentPresetMutationBusy = false; $("agent-preset-delete-error").textContent = error instanceof Error ? error.message : String(error); $("agent-preset-delete-error").hidden = false; renderAgentPresetDeleteDialog(); } }

async function loadSettingsConfiguration() {
  const list = $("settings-config-list"); list.replaceChildren(); setSettingsConfigurationNotice("loading");
  try {
    const response = await (await api("/api/settings")).json(); state.settings = response.namespaces || [];
    setSettingsConfigurationNotice(state.settings.length ? "count" : "empty", { count: state.settings.length, writable: response.writable });
    for (const descriptor of state.settings) list.append(settingsNamespaceCard(descriptor, response.writable));
  } catch (error) { setSettingsConfigurationNotice("error", { message: error.message }); }
}

function setSettingsConfigurationNotice(mode, detail = {}) { const notice = $("settings-config-notice"); notice.dataset.mode = mode; notice.dataset.count = String(detail.count ?? ""); notice.dataset.writable = String(detail.writable ?? ""); notice.dataset.message = detail.message ?? ""; renderSettingsConfigurationLabels(); }
function renderSettingsConfigurationLabels() {
  const notice = $("settings-config-notice"); if (!notice) return; const mode = notice.dataset.mode;
  if (mode === "loading") notice.textContent = t("settings.loadingConfiguration");
  else if (mode === "empty") notice.textContent = t("settings.configurationEmpty");
  else if (mode === "error") notice.textContent = notice.dataset.message;
  else if (mode === "count") notice.textContent = `${t("settings.namespaceCount").replace("{count}", notice.dataset.count)}${notice.dataset.writable === "true" ? "" : ` · ${t("settings.readOnly")}`}`;
  for (const timing of document.querySelectorAll("[data-settings-applies]")) timing.textContent = timing.dataset.settingsApplies === "restart" ? t("settings.restartRequired") : t("settings.liveRevision").replace("{revision}", timing.dataset.settingsRevision);
  for (const input of document.querySelectorAll("[data-settings-secret]")) input.placeholder = t(input.dataset.settingsSecret === "set" ? "settings.secretSet" : "settings.secretEmpty");
  for (const reset of document.querySelectorAll(".settings-use-default")) reset.textContent = t(reset.disabled ? "settings.defaultSelected" : "settings.useDefault");
}

function settingsNamespaceCard(descriptor, writable) {
  const form = document.createElement("form"); form.className = "settings-card";
  const header = document.createElement("div"); header.className = "settings-config-header"; const name = document.createElement("code"); name.textContent = descriptor.namespace; const timing = document.createElement("span"); timing.className = "settings-note"; timing.dataset.settingsApplies = descriptor.applies; timing.dataset.settingsRevision = String(descriptor.revision); timing.textContent = descriptor.applies === "restart" ? t("settings.restartRequired") : t("settings.liveRevision").replace("{revision}", descriptor.revision); header.append(name, timing); form.append(header);
  const fields = document.createElement("div"); fields.className = "settings-config-fields";
  const properties = descriptor.schema?.properties;
  if (properties && typeof properties === "object") {
    renderSettingsProperties(fields, descriptor.schema, descriptor.value || {}, descriptor.user || {}, descriptor.secrets || [], []);
  } else {
    const label = document.createElement("label"); label.textContent = t("settings.userOverrides"); const editor = document.createElement("textarea"); editor.className = "settings-json-editor"; editor.dataset.jsonEditor = "true"; editor.value = JSON.stringify(descriptor.user || {}, null, 2); label.append(editor); fields.append(label);
  }
  form.append(fields); const actions = document.createElement("div"); actions.className = "settings-config-actions"; const status = document.createElement("span"); status.className = "settings-note"; const save = document.createElement("button"); save.type = "submit"; save.className = "primary"; save.dataset.i18n = "settings.save"; save.textContent = t("settings.save"); save.disabled = !writable; actions.append(status, save); form.append(actions);
  form.addEventListener("submit", async (event) => { event.preventDefault(); save.disabled = true; status.textContent = t("settings.saving"); try { const next = collectSettingsDraft(form, descriptor.user || {}); const payload = { mode: "mutate", ops: settingsJsonOps(descriptor.user || {}, next, descriptor.secrets || []) }; const updated = await (await api(`/api/settings/${encodeURIComponent(descriptor.namespace)}`, { method: "PUT", body: JSON.stringify({ ...payload, expectedRevision: descriptor.revision }) })).json(); status.textContent = t(updated.applies === "restart" ? "settings.savedRestart" : "settings.saved"); await loadSettingsConfiguration(); } catch (error) { status.textContent = error.message; save.disabled = false; } });
  return form;
}

function renderSettingsProperties(container, schema, current, user, secrets, path) {
  const required = new Set(Array.isArray(schema.required) ? schema.required : []);
  for (const [key, property] of Object.entries(schema.properties || {})) {
    if (!property || typeof property !== "object") continue;
    const childPath = [...path, key]; const value = current?.[key]; const userSet = hasSettingsPath(user, childPath);
    if (property.type === "object" && property.properties && typeof property.properties === "object") {
      const group = document.createElement("fieldset"); group.className = "settings-object-group"; const legend = document.createElement("legend"); legend.textContent = property.title || key; group.append(legend);
      if (property.description) { const note = document.createElement("small"); note.textContent = property.description; group.append(note); }
      renderSettingsProperties(group, property, value || {}, user, secrets, childPath); container.append(group);
    } else {
      container.append(settingsField(childPath, property, value, settingsSecretAt(secrets, childPath), userSet, required.has(key)));
    }
  }
}

function settingsField(path, property, current, secretState, userSet, required) {
  const key = path.at(-1);
  const label = document.createElement("label"); const caption = document.createElement("span"); caption.textContent = property.title || key; label.append(caption); let input;
  if (Array.isArray(property.enum)) { input = document.createElement("select"); for (const value of property.enum) input.append(new Option(String(value), JSON.stringify(value))); input.value = JSON.stringify(current); }
  else if (property.type === "boolean") { label.classList.add("checkbox"); input = document.createElement("input"); input.type = "checkbox"; input.checked = Boolean(current); }
  else if (["array", "object"].includes(property.type)) { input = document.createElement("textarea"); input.className = "settings-json-editor compact"; input.value = JSON.stringify(current ?? (property.type === "array" ? [] : {}), null, 2); input.dataset.settingsType = "json"; }
  else { input = document.createElement("input"); input.type = secretState ? "password" : property.type === "number" || property.type === "integer" ? "number" : "text"; if (!secretState && current !== undefined) input.value = String(current); if (secretState) { input.dataset.settingsSecret = secretState.set ? "set" : "empty"; input.placeholder = t(secretState.set ? "settings.secretSet" : "settings.secretEmpty"); } }
  input.dataset.settingsPath = JSON.stringify(path); input.dataset.settingsType ||= property.type || "string"; input.dataset.settingsDirty = "false"; input.required = required && property.type !== "boolean"; input.addEventListener("input", () => { input.dataset.settingsDirty = "true"; }); input.addEventListener("change", () => { input.dataset.settingsDirty = "true"; }); label.append(input);
  if (userSet) { const reset = document.createElement("button"); reset.type = "button"; reset.className = "settings-use-default"; reset.dataset.i18n = "settings.useDefault"; reset.textContent = t("settings.useDefault"); reset.addEventListener("click", () => { input.dataset.settingsReset = "true"; input.dataset.settingsDirty = "true"; input.disabled = true; reset.disabled = true; reset.dataset.i18n = "settings.defaultSelected"; reset.textContent = t("settings.defaultSelected"); }); label.append(reset); }
  if (property.description) { const note = document.createElement("small"); note.textContent = property.description; label.append(note); } return label;
}

function collectSettingsDraft(form, previous) {
  const editor = form.querySelector("[data-json-editor]:not([data-settings-path])"); if (editor) { const parsed = JSON.parse(editor.value || "{}"); if (!parsed || Array.isArray(parsed) || typeof parsed !== "object") throw new Error(t("settings.jsonObjectRequired")); return parsed; }
  const draft = structuredClone(previous);
  for (const input of form.querySelectorAll("[data-settings-path]")) {
    if (input.dataset.settingsDirty !== "true") continue;
    const path = JSON.parse(input.dataset.settingsPath);
    if (input.dataset.settingsReset === "true") { unsetSettingsPath(draft, path); continue; }
    if (input.type === "password" && input.value === "") continue;
    let value;
    if (input.dataset.settingsType === "json") value = JSON.parse(input.value);
    else if (input.type === "checkbox") value = input.checked;
    else if (input.tagName === "SELECT") value = JSON.parse(input.value);
    else if (["number", "integer"].includes(input.dataset.settingsType)) { value = Number(input.value); if (!Number.isFinite(value)) throw new Error(t("settings.numberRequired").replace("{path}", path.join("."))); }
    else value = input.value;
    setSettingsPath(draft, path, value);
  }
  return draft;
}

function hasSettingsPath(value, path) { let cursor = value; for (const part of path) { if (!cursor || typeof cursor !== "object" || !Object.prototype.hasOwnProperty.call(cursor, part)) return false; cursor = cursor[part]; } return true; }
function settingsSecretAt(secrets, path) { return secrets.find((item) => item.path.length === path.length && item.path.every((part, index) => part === path[index])); }
function setSettingsPath(value, path, next) { let cursor = value; for (const part of path.slice(0, -1)) { if (!cursor[part] || typeof cursor[part] !== "object" || Array.isArray(cursor[part])) cursor[part] = {}; cursor = cursor[part]; } cursor[path.at(-1)] = next; }
function unsetSettingsPath(value, path) { let cursor = value; for (const part of path.slice(0, -1)) { if (!cursor?.[part] || typeof cursor[part] !== "object") return; cursor = cursor[part]; } delete cursor[path.at(-1)]; }

function settingsJsonOps(previous, next, secrets) {
  const secretPaths = secrets.map((item) => item.path);
  const ops = [];
  const isObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
  const samePath = (left, right) => left.length === right.length && left.every((part, index) => part === right[index]);
  const hasSecretBelow = (path) => secretPaths.some((secret) => path.every((part, index) => secret[index] === part));
  const visit = (before, after, path) => {
    if (secretPaths.some((secret) => samePath(secret, path))) {
      if (after !== undefined && JSON.stringify(before) !== JSON.stringify(after)) ops.push({ op: "set", path, value: after });
      return;
    }
    if (isObject(before) && isObject(after)) {
      for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) {
        const childPath = [...path, key];
        if (!(key in after)) {
          if (hasSecretBelow(childPath)) visit(before[key], {}, childPath);
          else ops.push({ op: "unset", path: childPath });
        } else if (!(key in before)) {
          if (hasSecretBelow(childPath) && isObject(after[key])) visit({}, after[key], childPath);
          else if (hasSecretBelow(childPath)) throw new Error(`Cannot replace ${childPath.join(".")} because it contains a hidden secret`);
          else ops.push({ op: "set", path: childPath, value: after[key] });
        }
        else visit(before[key], after[key], childPath);
      }
      return;
    }
    if (Array.isArray(before) && Array.isArray(after) && before.length === after.length) {
      for (let index = 0; index < before.length; index += 1) visit(before[index], after[index], [...path, String(index)]);
      return;
    }
    if (JSON.stringify(before) === JSON.stringify(after)) return;
    if (hasSecretBelow(path)) throw new Error(`Cannot replace ${path.join(".")} because it contains a hidden secret`);
    ops.push({ op: "set", path, value: after });
  };
  visit(previous, next, []);
  return ops;
}

async function loadPlugins() {
  installedPluginsSnapshot = null; installedPluginsError = null; renderInstalledPlugins();
  pluginInventorySnapshot = null; pluginInventoryError = null; renderPluginInventory();
  const installedRequest = api("/api/plugins").then((response) => response.json());
  const inventoryRequest = api("/api/dsh/plugin-inventory").then((response) => response.json());
  const [installedResult, inventoryResult] = await Promise.allSettled([installedRequest, inventoryRequest]);
  if (installedResult.status === "fulfilled") {
    installedPluginsSnapshot = installedResult.value;
  } else installedPluginsError = installedResult.reason instanceof Error ? installedResult.reason.message : String(installedResult.reason);
  if (inventoryResult.status === "fulfilled") pluginInventorySnapshot = inventoryResult.value;
  else pluginInventoryError = inventoryResult.reason instanceof Error ? inventoryResult.reason.message : String(inventoryResult.reason);
  renderInstalledPlugins(); renderPluginInventory();
}

function renderInstalledPlugins() {
  const container = $("plugins-list"); if (!container) return; container.replaceChildren();
  if (installedPluginsError !== null) { $("plugins-notice").textContent = installedPluginsError; return; }
  if (installedPluginsSnapshot === null) { $("plugins-notice").textContent = t("plugins.loading"); return; }
  $("plugins-notice").textContent = installedPluginsSnapshot.length === 0 ? t("plugins.noneInstalled") : t("plugins.installedCount").replace("{count}", installedPluginsSnapshot.length);
  for (const entry of installedPluginsSnapshot) container.append(pluginCard(entry));
}

function renderPluginInventory() {
  const container = $("plugin-inventory-list"); if (!container) return;
  container.replaceChildren(); const notice = $("plugin-inventory-notice");
  if (pluginInventoryError !== null) { notice.replaceChildren(document.createTextNode(`${t("plugins.runtimeUnavailable")}: ${pluginInventoryError} `)); const retry = document.createElement("button"); retry.type = "button"; retry.textContent = t("common.retry"); retry.addEventListener("click", () => void loadPlugins()); notice.append(retry); return; }
  if (pluginInventorySnapshot === null) { notice.textContent = t("plugins.runtimeLoading"); return; }
  const query = $("plugin-inventory-search").value; const searching = query.trim().length > 0;
  const filtered = filterPluginInventory(pluginInventorySnapshot, query); const allPresets = pluginInventorySnapshot.agentPresets ?? [];
  const selected = defaultPluginInventoryPreset(allPresets, pluginInventoryPresetId); const selectedFiltered = filtered.agentPresets.find((preset) => preset.id === selected?.id); const selectedRows = selectedFiltered?.rows ?? [];
  const otherMatches = searching ? filtered.agentPresets.filter((preset) => preset.id !== selected?.id && preset.rows.length > 0) : [];
  notice.textContent = filtered.entries.length === 0 && selectedRows.length === 0 && otherMatches.length === 0 ? t("plugins.runtimeEmpty") : "";
  const providers = enabledPluginPresets(allPresets);
  const appendRow = (group, entry, preset = null) => {
    const row = document.createElement("details"); row.className = `plugin-inventory-row${entry.fiberPhase === "failed" ? " failed" : ""}`; row.dataset.pluginModule = entry.moduleName;
    const summary = document.createElement("summary"); const title = document.createElement("strong"); title.title = entry.moduleName; title.textContent = shortPluginModuleName(entry.moduleName) || entry.entryId;
    const conditional = entry.enabled === "conditional"; const supplied = !preset && entry.enabled === false && providers.has(entry.moduleName); const stateKey = entry.fiberPhase === "failed" ? "failed" : conditional ? "conditional" : supplied ? "preset" : entry.enabled ? "enabled" : "disabled";
    const status = document.createElement("span"); status.className = `plugin-runtime-badge ${stateKey}`; status.textContent = t(`plugins.state.${stateKey}`); summary.append(title, status);
    const facts = document.createElement("dl"); facts.className = "plugin-inventory-facts"; const fact = (label, value, code = false) => { if (value === null || value === undefined || value === "") return; const dt = document.createElement("dt"); dt.textContent = label; const dd = document.createElement("dd"); const node = document.createElement(code ? "code" : "span"); node.textContent = String(value); dd.append(node); facts.append(dt, dd); };
    fact(t("plugins.fact.module"), entry.moduleName, true); fact(t("plugins.fact.entry"), entry.entryId, true); if (preset) fact(t("plugins.fact.preset"), agentPresetDisplayText(preset, t).name); fact(t("plugins.fact.configuration"), status.textContent); if (entry.fiberPhase !== null) fact(t("plugins.fact.runtime"), t(`plugins.phase.${entry.fiberPhase}`)); fact(t("plugins.fact.condition"), entry.condition, true); if (supplied) fact(t("plugins.fact.enabledIn"), providers.get(entry.moduleName).map((item) => agentPresetDisplayText(item, t).name).join(" · "));
    row.append(summary, facts); group.append(row);
  };
  if (selected) {
    const group = document.createElement("section"); group.className = "plugin-inventory-group"; const open = searching || pluginInventoryPresetOpen;
    const header = document.createElement("div"); header.className = "plugin-inventory-group-heading"; const toggle = document.createElement("button"); toggle.type = "button"; toggle.setAttribute("aria-expanded", String(open)); toggle.textContent = `${open ? "⌄" : "›"} ${t("plugins.runtimePreset")}`; toggle.addEventListener("click", () => { pluginInventoryPresetOpen = !pluginInventoryPresetOpen; renderPluginInventory(); });
    const select = document.createElement("select"); select.setAttribute("aria-label", t("plugins.runtimePresetSelect")); for (const preset of allPresets) { const option = document.createElement("option"); option.value = preset.id; option.selected = preset.id === selected.id; option.textContent = `${agentPresetDisplayText(preset, t).name}${preset.broken ? ` · ${t("plugins.state.failed")}` : preset.isDefault ? ` · ${t("plugins.runtimeDefault")}` : ""}`; select.append(option); } select.addEventListener("change", () => { pluginInventoryPresetId = select.value; renderPluginInventory(); }); header.append(toggle, select); group.append(header);
    const sub = document.createElement("p"); sub.className = "plugin-inventory-subtitle"; sub.textContent = `${selected.trust} · ${selectedRows.length} ${t("plugins.runtimeCount")}`; group.append(sub);
    if (open && selected.broken) { const broken = document.createElement("p"); broken.className = "plugin-inventory-broken"; broken.setAttribute("role", "alert"); broken.textContent = selected.broken; group.append(broken); }
    if (open) for (const entry of selectedRows) appendRow(group, entry, selected);
    if (otherMatches.length) { const hint = document.createElement("p"); hint.className = "plugin-inventory-hint"; hint.append(`${t("plugins.runtimeOtherMatches")} `); for (const preset of otherMatches) { const jump = document.createElement("button"); jump.type = "button"; jump.textContent = agentPresetDisplayText(preset, t).name; jump.addEventListener("click", () => { pluginInventoryPresetId = preset.id; renderPluginInventory(); }); hint.append(jump); } group.append(hint); }
    container.append(group);
  }
  if ((pluginInventorySnapshot.entries ?? []).length) {
    const group = document.createElement("section"); group.className = "plugin-inventory-group"; const failed = filtered.entries.filter((entry) => entry.fiberPhase === "failed").length; const open = searching || (pluginInventoryGlobalOpen ?? !selected);
    const header = document.createElement("div"); header.className = "plugin-inventory-group-heading"; const toggle = document.createElement("button"); toggle.type = "button"; toggle.setAttribute("aria-expanded", String(open)); toggle.textContent = `${open ? "⌄" : "›"} ${t("plugins.runtimeGlobal")}`; toggle.addEventListener("click", () => { pluginInventoryGlobalOpen = !open; renderPluginInventory(); }); header.append(toggle); group.append(header); const sub = document.createElement("p"); sub.className = "plugin-inventory-subtitle"; sub.textContent = `${filtered.entries.length} ${t("plugins.runtimeCount")}${failed ? ` · ${failed} ${t("plugins.state.failed")}` : ""}`; group.append(sub); if (open) for (const entry of filtered.entries) appendRow(group, entry); container.append(group);
  }
}

function pluginCard(entry) {
  const card = document.createElement("article");
  card.className = "plugin-card";
  const header = document.createElement("div"); header.className = "plugin-card-header";
  const identity = document.createElement("div");
  const title = document.createElement("strong"); title.textContent = entry.name;
  const version = document.createElement("span"); version.textContent = entry.version;
  identity.append(title, version);
  const badge = document.createElement("span"); badge.className = `plugin-badge ${entry.status}`; badge.textContent = entry.enabled ? t(`plugins.packageStatus.${entry.status}`) : t("plugins.state.disabled");
  header.append(identity, badge);
  const spec = document.createElement("code"); spec.textContent = entry.spec;
  const details = document.createElement("p");
  const missing = [...entry.missingHostServices, ...entry.missingClientServices];
  details.textContent = missing.length ? t("plugins.missingAdapters").replace("{names}", missing.join(", ")) : entry.skin?.tagline || t("plugins.contractsReady");
  const actions = document.createElement("div"); actions.className = "plugin-card-actions";
  const toggle = document.createElement("button"); toggle.type = "button"; toggle.textContent = entry.enabled ? t("plugins.disable") : t("plugins.enable");
  toggle.addEventListener("click", () => void updatePluginEnabled(entry.name, !entry.enabled));
  const remove = document.createElement("button"); remove.type = "button"; remove.className = "danger"; remove.dataset.i18n = "plugins.remove"; remove.textContent = t("plugins.remove");
  remove.addEventListener("click", () => openPluginRemove(entry.name));
  actions.append(toggle, remove);
  card.append(header, spec, details, actions);
  return card;
}

async function installPlugin(event) {
  event.preventDefault();
  const spec = $("plugin-spec").value.trim();
  if (!spec) return;
  $("plugins-notice").textContent = t("plugins.installing");
  try {
    await api("/api/plugins", { method: "POST", body: JSON.stringify({ action: "add", spec }) });
    $("plugin-spec").value = "";
    await loadClientPlugins();
    await loadPlugins();
    $("plugins-notice").textContent = t("plugins.installed");
  } catch (error) { $("plugins-notice").textContent = error.message; }
}

async function updatePluginEnabled(name, enabled) {
  try {
    await api(`/api/plugins/${encodeURIComponent(name)}/enabled`, { method: "POST", body: JSON.stringify({ enabled }) });
    await loadClientPlugins();
    await loadPlugins();
    $("plugins-notice").textContent = enabled ? t("plugins.enabled") : t("plugins.disabled");
  } catch (error) { $("plugins-notice").textContent = error.message; }
}

function openPluginRemove(name) {
  pluginRemoveTarget = name; pluginRemoveBusy = false; $("plugin-remove-submit").disabled = false; $("plugin-remove-cancel").disabled = false; $("plugin-remove-close").disabled = false; $("plugin-remove-status").hidden = true; $("plugin-remove-error").hidden = true; $("plugin-remove-dialog").hidden = false; renderPluginRemoveDialog(); $("plugin-remove-submit").focus();
}

function closePluginRemove() {
  if (pluginRemoveBusy) return; pluginRemoveTarget = null; $("plugin-remove-dialog").hidden = true; $("plugin-remove-status").hidden = true; $("plugin-remove-error").hidden = true;
}

async function submitPluginRemove(event) {
  event.preventDefault(); if (pluginRemoveTarget === null || pluginRemoveBusy) return; const target = pluginRemoveTarget; pluginRemoveBusy = true; $("plugin-remove-submit").disabled = true; $("plugin-remove-cancel").disabled = true; $("plugin-remove-close").disabled = true; $("plugin-remove-status").hidden = false; $("plugin-remove-error").hidden = true;
  try { await api(`/api/plugins/${encodeURIComponent(target)}`, { method: "DELETE" }); await loadClientPlugins(); await loadPlugins(); $("plugins-notice").textContent = t("plugins.removed"); pluginRemoveBusy = false; closePluginRemove(); }
  catch (error) { if (pluginRemoveTarget !== target) return; pluginRemoveBusy = false; $("plugin-remove-submit").disabled = false; $("plugin-remove-cancel").disabled = false; $("plugin-remove-close").disabled = false; $("plugin-remove-status").hidden = true; $("plugin-remove-error").textContent = error instanceof Error ? error.message : String(error); $("plugin-remove-error").hidden = false; }
}

function renderPluginRemoveDialog() {
  if (pluginRemoveTarget !== null) $("plugin-remove-description").textContent = t("plugins.removeDescription").replace("{name}", pluginRemoveTarget);
}

function updateModels() {
  const select = $("model");
  const previous = select.value || localStorage.getItem(`seal-harness.model.${$("provider").value}`) || "";
  select.replaceChildren();
  for (const model of state.models.filter((item) => item.provider === $("provider").value)) {
    select.append(new Option(model.displayName || model.model, model.model));
  }
  if ([...select.options].some((option) => option.value === previous)) select.value = previous;
  if (select.value) localStorage.setItem(`seal-harness.model.${$("provider").value}`, select.value);
  updateModelDetails();
}

function updateModelDetails() {
  const model = state.models.find((item) => item.provider === $("provider").value && item.model === $("model").value);
  const container = $("model-details");
  container.replaceChildren();
  if (!model) {
    container.textContent = t("models.noneAdvertised");
    return;
  }
  const route = document.createElement("code");
  route.textContent = `${model.provider}/${model.model}`;
  const capacities = document.createElement("span");
  capacities.textContent = t("models.capacities").replace("{context}", formatTokens(model.contextWindow)).replace("{output}", formatTokens(model.maxOutputTokens));
  container.append(route, capacities);
  if (model.supportsReasoning) container.append(capability(t("models.reasoning")));
  if (model.supportsImages) container.append(capability(t("models.images")));
}

function capability(label) {
  const badge = document.createElement("span");
  badge.className = "model-capability";
  badge.textContent = label;
  return badge;
}

function formatTokens(value) {
  return formatCompactTokens(value, t("number.thousand"), t("number.million"));
}

function statsDuration(ms) { return formatCompactDuration(ms, t("duration.compactSeconds"), t("duration.compactMinutes")); }
function renderStatsLine() {
  const root = $("stats-line"); const metrics = state.sessionMetrics; const groups = [];
  if (metrics?.stats?.steps > 0) {
    const stats = metrics.stats;
    groups.push(t("stats.counts").replace("{turns}", String(stats.turns)).replace("{steps}", String(stats.steps)));
    const durations = [];
    if (stats.llmMs > 0) durations.push(t("stats.llm").replace("{duration}", statsDuration(stats.llmMs)));
    if (stats.toolMs > 0) durations.push(t("stats.toolCall").replace("{duration}", statsDuration(stats.toolMs)));
    if (durations.length > 0) groups.push(durations.join(" · "));
    const speeds = [];
    if (stats.ttftSteps > 0) speeds.push(t("stats.ttftAverage").replace("{duration}", statsDuration(stats.ttftMs / stats.ttftSteps)));
    if (stats.decodeMs > 0) speeds.push(t("stats.tokensPerSecond").replace("{throughput}", formatTokensPerSecond(stats.decodeTokens / (stats.decodeMs / 1_000))));
    if (speeds.length > 0) groups.push(speeds.join(" · "));
  }
  const usage = metrics?.usage;
  if (usage && (usage.totalTokens > usage.outputTokens || usage.outputTokens > 0)) {
    const prompt = usage.totalTokens - usage.outputTokens; const cacheHit = formatCacheHitPercent(usage.cacheReadTokens, prompt);
    if (cacheHit !== null) groups.push(t("stats.cacheHit").replace("{percent}", cacheHit));
    groups.push(t("stats.tokens").replace("{input}", formatTokens(prompt)).replace("{output}", formatTokens(usage.outputTokens)));
  }
  root.replaceChildren(); root.hidden = groups.length === 0; root.title = groups.join(" | ");
  groups.forEach((group, index) => { if (index > 0) { const separator = document.createElement("span"); separator.className = "stats-separator"; separator.textContent = "|"; separator.setAttribute("aria-hidden", "true"); root.append(separator); } const item = document.createElement("span"); item.textContent = group; root.append(item); });
}

async function loadSessions() {
  closeSessionHover();
  closeSessionActionMenu();
  const [sessions, workspaces, archivedSessions] = await Promise.all([
    api("/api/sessions").then((response) => response.json()),
    api("/api/workspaces").then((response) => response.json()).catch(() => []),
    api("/api/archived-sessions").then((response) => response.json()).catch(() => []),
  ]);
  state.workspaces = workspaces;
  state.sessions = sessions;
  const currentBlank = sessions.find((session) => session.id === state.sessionId && session.blank === true)?.id ?? null; if (currentBlank !== promotedBlankSessionId) { promotedBlankSessionId = currentBlank; blankPromotionSuppressedAccounts = new Set(); }
  const container = $("sessions");
  container.replaceChildren();
  const sessionsById = new Map(sessions.map((session) => [session.id, session]));
  const groupedIds = new Set(workspaces.flatMap((workspace) => workspace.sessionIds));
  $("session-list-label").textContent = t(state.groupBy === "flat" ? "view.sessions" : "nav.workspaces");
  if (state.groupBy === "flat") {
    const ordered = promoteBlankSession(state.orderBy === "updated" ? [...sessions] : applyPreferredSessionOrder(sessions, [...readStringSet("dsh.workspace.flatOrder")]), promotedBlankSessionId, blankPromotionSuppressedAccounts.has("__flat__"));
    appendSessionGroupRows(container, "__flat__", ordered, "dsh.workspace.flatOrder");
  } else for (const workspace of workspaces) {
    const group = document.createElement("section"); group.className = "workspace-group";
    installWorkspaceDrag(group, workspace.id, workspaces.map((item) => item.id));
    const header = document.createElement("div"); header.className = "workspace-header"; header.title = workspace.path;
    const collapse = workspaceCollapseButton(workspace.id);
    const choose = document.createElement("button"); choose.type = "button"; choose.className = "workspace-choose"; choose.textContent = workspace.title; choose.setAttribute("role", "treeitem"); choose.setAttribute("aria-expanded", String(!state.collapsedWorkspaceGroups.has(workspace.id)));
    choose.addEventListener("click", () => collapse.click());
    const actions = document.createElement("span"); actions.className = "workspace-actions";
    const position = workspaces.findIndex((item) => item.id === workspace.id);
    const trigger = document.createElement("button"); trigger.type = "button"; trigger.textContent = "•••"; trigger.setAttribute("aria-haspopup", "menu"); trigger.setAttribute("aria-expanded", "false"); trigger.setAttribute("aria-label", t("workspace.actionsNamed").replace("{name}", workspace.title)); trigger.addEventListener("click", (event) => { event.stopPropagation(); if (sessionActionMenuTrigger === trigger) closeSessionActionMenu(true); else openWorkspaceActionMenu(trigger, workspace, position, workspaces.length); });
    const create = document.createElement("button"); create.type = "button"; create.className = "workspace-create-session"; create.textContent = "+"; create.setAttribute("aria-label", t("workspace.newSessionNamed").replace("{name}", workspace.title)); create.addEventListener("click", () => { closeSessionHover(); if (state.collapsedWorkspaceGroups.has(workspace.id)) collapse.click(); $("cwd").value = workspace.path; localStorage.setItem("seal-harness.cwd", workspace.path); newSession(); });
    actions.addEventListener("pointerenter", closeSessionHover); actions.append(trigger, create); header.append(collapse, choose, actions); installWorkspaceHover(header, workspace); group.append(header);
    let groupSessions = workspace.sessionIds.map((id) => sessionsById.get(id)).filter(Boolean); if (state.orderBy === "updated") groupSessions = sortSessionsByUpdated(groupSessions); groupSessions = promoteBlankSession(groupSessions, promotedBlankSessionId, blankPromotionSuppressedAccounts.has(workspace.id)); if (!state.collapsedWorkspaceGroups.has(workspace.id)) appendSessionGroupRows(group, workspace.id, groupSessions);
    container.append(group);
  }
  let ungrouped = sessions.filter((session) => !groupedIds.has(session.id)); ungrouped = state.orderBy === "updated" ? sortSessionsByUpdated(ungrouped) : applyPreferredSessionOrder(ungrouped, [...readStringSet("dsh.workspace.ungroupedOrder")]); ungrouped = promoteBlankSession(ungrouped, promotedBlankSessionId, blankPromotionSuppressedAccounts.has("__ungrouped__"));
  if (state.groupBy === "workspace" && ungrouped.length) {
    const group = document.createElement("section"); group.className = "workspace-group";
    const label = document.createElement("div"); label.className = "workspace-header workspace-ungrouped"; const collapse = workspaceCollapseButton("__ungrouped__"); const text = document.createElement("span"); text.dataset.i18n = "workspace.ungrouped"; text.textContent = t("workspace.ungrouped"); label.tabIndex = 0; label.setAttribute("role", "treeitem"); label.setAttribute("aria-expanded", String(!state.collapsedWorkspaceGroups.has("__ungrouped__"))); label.append(collapse, text); group.append(label);
    if (!state.collapsedWorkspaceGroups.has("__ungrouped__")) appendSessionGroupRows(group, "__ungrouped__", ungrouped, "dsh.workspace.ungroupedOrder");
    container.append(group);
  }
  if (archivedSessions.length) {
    const group = document.createElement("details"); group.className = "workspace-group archived-sessions";
    const summary = document.createElement("summary"); summary.textContent = t("sessions.hidden").replace("{count}", String(archivedSessions.length)); group.append(summary);
    for (const session of archivedSessions) group.append(sessionButton(session, true));
    container.append(group);
  }
  if (shouldShowSessionEmptyState(container.childElementCount, $("session-search-input").value)) { const empty = document.createElement("div"); empty.className = "sidebar-empty"; empty.textContent = t("sessions.none"); container.append(empty); }
  if ($("session-search-input").value.trim()) scheduleSessionSearch(true);
  renderSessionBreadcrumbs();
  window.dispatchEvent(new CustomEvent("seal-harness:domain-snapshot", { detail: { sessions, workspaces, archivedSessionIds: archivedSessions.map((session) => session.id), current: state.sessionId } }));
}

function workspaceCollapseButton(key) {
  const collapsed = state.collapsedWorkspaceGroups.has(key); const button = document.createElement("button"); button.type = "button"; button.className = "workspace-collapse"; button.textContent = collapsed ? "›" : "⌄"; button.title = collapsed ? t("workspace.expand") : t("workspace.collapse"); button.setAttribute("aria-label", button.title); button.setAttribute("aria-expanded", String(!collapsed));
  button.addEventListener("click", () => { if (collapsed) state.collapsedWorkspaceGroups.delete(key); else { state.collapsedWorkspaceGroups.add(key); state.expandedSessionGroups.delete(key); } localStorage.setItem("dsh.workspace.collapsedGroups", JSON.stringify([...state.collapsedWorkspaceGroups])); void loadSessions(); }); return button;
}

function appendSessionGroupRows(group, key, sessions, localOrderKey) {
  const collapsed = collapsedSessionRows(sessions); const expanded = state.expandedSessionGroups.has(key);
  for (const session of expanded ? sessions : collapsed.rows) group.append(sessionButton(session, false, state.orderBy === "manual" ? { key, sessions, index: sessions.indexOf(session), localOrderKey } : undefined));
  if (collapsed.hiddenCount === 0) return;
  const toggle = document.createElement("button"); toggle.type = "button"; toggle.className = "session-overflow"; toggle.setAttribute("aria-expanded", String(expanded));
  toggle.textContent = expanded ? t("sessions.collapse") : t("sessions.expand").replace("{n}", String(collapsed.hiddenCount));
  toggle.addEventListener("click", () => { if (expanded) state.expandedSessionGroups.delete(key); else state.expandedSessionGroups.add(key); void loadSessions(); }); group.append(toggle);
}

function openSessionSearch() {
  const viewport = $("root").getBoundingClientRect().width || window.innerWidth;
  if (effectiveSidebarCollapsed(viewport, layout.wideCollapsed, layout.narrowExpanded)) {
    if (viewport < SIDEBAR_AUTO_COLLAPSE) layout.narrowExpanded = true;
    else { layout.wideCollapsed = false; localStorage.setItem("dsh.layout.sidebarCollapsed", "false"); }
    applyLayout();
  }
  const root = $("session-search"); root.classList.add("expanded"); $("session-search-open").setAttribute("aria-expanded", "true"); $("session-search-input").tabIndex = 0; $("session-search-clear").hidden = false; $("session-search-input").focus();
}

function closeSessionSearch() {
  clearTimeout(state.searchTimer); state.searchController?.abort(); state.searchController = null; state.searchRevision += 1;
  $("session-search-input").value = ""; $("session-search-input").tabIndex = -1; $("session-search-clear").hidden = true; $("session-search").classList.remove("expanded"); $("session-search-open").setAttribute("aria-expanded", "false"); $("session-search-status").hidden = true; void loadSessions();
}

function handleSessionSearchInput(event) {
  const value = sanitizeSessionSearchQuery(event.target.value); if (value !== event.target.value) event.target.value = value; scheduleSessionSearch();
}

function scheduleSessionSearch(immediate = false) {
  clearTimeout(state.searchTimer); state.searchController?.abort(); state.searchController = null;
  const query = $("session-search-input").value.trim(); if (!query) { $("session-search-status").hidden = true; void loadSessions(); return; }
  renderSessionSearchResults(localSessionSearchResults(state.sessions, state.workspaces, query));
  const revision = ++state.searchRevision; const status = $("session-search-status"); status.hidden = false; status.textContent = t("search.pending");
  state.searchTimer = setTimeout(() => void runSessionSearch(query, revision), immediate ? 0 : SESSION_SEARCH_DEBOUNCE_MS);
}

async function runSessionSearch(query, revision) {
  const controller = new AbortController(); state.searchController = controller;
  try {
    const result = await api(`/api/sessions/search?query=${encodeURIComponent(query)}`, { signal: controller.signal }).then((response) => response.json());
    if (controller.signal.aborted || revision !== state.searchRevision) return;
    const items = mergeSessionSearchResults(localSessionSearchResults(state.sessions, state.workspaces, query), result.items); renderSessionSearchResults(items);
    const status = $("session-search-status"); status.hidden = false; status.textContent = items.length === 0 ? t("search.noMatches") : result.hasMore ? t("search.more") : ""; status.hidden = status.textContent === "";
  } catch (error) { if (!controller.signal.aborted && revision === state.searchRevision) { const status = $("session-search-status"); status.hidden = false; status.textContent = t("search.error"); } }
  finally { if (state.searchController === controller) state.searchController = null; }
}

function renderSessionSearchResults(items) {
  const container = $("sessions"); container.replaceChildren();
  for (const match of items) {
      const summary = state.sessions.find((session) => session.id === match.sessionId); const button = document.createElement("button"); button.type = "button"; button.className = `session search-result${match.sessionId === state.sessionId ? " active" : ""}`;
      button.setAttribute("role", "treeitem"); button.setAttribute("aria-selected", String(match.sessionId === state.sessionId));
      const title = document.createElement("strong"); title.textContent = summary?.preview || match.sessionId; const meta = document.createElement("span"); meta.className = "search-result-meta"; const workspace = document.createElement("span"); workspace.className = "search-result-workspace"; workspace.textContent = match.workspace ?? state.workspaces.find((entry) => entry.sessionIds.includes(match.sessionId))?.title ?? t("workspace.ungrouped"); meta.append(workspace); if (match.snippet) { const snippet = document.createElement("span"); snippet.className = "search-result-snippet"; snippet.textContent = match.snippet; meta.append(snippet); } button.append(title, meta); button.addEventListener("click", () => void openSession(match.sessionId, { searchQuery: $("session-search-input").value.trim(), contentHit: Boolean(match.snippet) }).catch(error => setStatus(error.message, true))); container.append(button);
  }
}

function renderSessionBreadcrumbs() {
  const nav = $("session-breadcrumbs"); nav.replaceChildren();
  if (!state.sessionId) { document.title = PRODUCT_TITLE; const title = document.createElement("strong"); title.id = "session-title"; title.textContent = t("nav.newSession"); nav.append(title); return; }
  const ancestry = deriveSessionAncestry(state.sessions, state.sessionId);
  for (const [index, crumb] of ancestry.entries()) {
    if (index > 0) { const separator = document.createElement("span"); separator.className = "session-crumb-separator"; separator.textContent = "/"; nav.append(separator); }
    const current = index === ancestry.length - 1; const button = document.createElement("button"); button.type = "button"; button.className = `session-crumb${crumb.subagent ? " subagent" : ""}${current ? " current" : ""}`; button.textContent = crumb.displayTitle; button.disabled = current;
    if (current) button.id = "session-title"; else button.addEventListener("click", () => void openSession(crumb.id)); nav.append(button);
  }
  document.title = sessionDocumentTitle(state.sessions.find((session) => session.id === state.sessionId)?.preview);
}

function handleSidebarTreeKey(event) {
  if (!["ArrowDown", "ArrowUp", "Home", "End", "ArrowLeft", "ArrowRight"].includes(event.key)) return;
  const items = [...$("sessions").querySelectorAll('[role="treeitem"]')].filter((item) => item.getClientRects().length > 0 && !item.disabled);
  const current = event.target.closest?.('[role="treeitem"]'); const index = items.indexOf(current);
  if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
    if (!current?.hasAttribute("aria-expanded")) return;
    const expanded = current.getAttribute("aria-expanded") === "true"; const shouldExpand = event.key === "ArrowRight";
    if (expanded === shouldExpand) return;
    event.preventDefault(); current.closest(".workspace-header")?.querySelector(".workspace-collapse")?.click(); return;
  }
  const target = treeNavigationIndex(items.length, index, event.key); if (target === index || target < 0) return;
  event.preventDefault(); items[target]?.focus();
}

function sessionButton(session, archived = false, reorder) {
    const row = document.createElement("div"); row.className = "session-row";
    if (reorder) installSessionDrag(row, session.id, reorder);
    const button = document.createElement("button");
    button.className = `session${session.id === state.sessionId ? " active" : ""}`;
    button.setAttribute("role", "treeitem");
    button.setAttribute("aria-selected", String(session.id === state.sessionId));
    const displayTitle = sessionDisplayTitle(session, t("nav.newSession"), t("session.defaultTitle"));
    const title = document.createElement("strong");
    title.className = "session-title";
    title.textContent = displayTitle;
    const meta = document.createElement("span");
    meta.className = "session-row-time"; meta.title = session.id; meta.textContent = session.blank ? "" : sessionCompactTime(session.updatedAt);
    const statusDot = document.createElement("span"); statusDot.className = "session-row-status"; statusDot.dataset.state = session.running ? "running" : "idle"; if (session.running) { statusDot.setAttribute("role", "img"); statusDot.setAttribute("aria-label", t("status.running")); } else statusDot.setAttribute("aria-hidden", "true");
    button.append(statusDot, title, meta);
    button.addEventListener("click", () => void openSession(session.id));
    const actions = document.createElement("span"); actions.className = "session-actions"; const trigger = document.createElement("button"); trigger.type = "button"; trigger.textContent = "•••"; trigger.setAttribute("aria-haspopup", "menu"); trigger.setAttribute("aria-expanded", "false"); trigger.setAttribute("aria-label", t("session.actionsNamed").replace("{name}", displayTitle)); trigger.addEventListener("click", (event) => { event.stopPropagation(); if (sessionActionMenuTrigger === trigger) closeSessionActionMenu(true); else openSessionActionMenu(trigger, session, archived, reorder); });
    actions.addEventListener("pointerenter", closeSessionHover); actions.append(trigger); row.append(button, actions); installSessionHover(row, session); return row;
}

function confirmSessionDeletion() {
  return new Promise((resolve) => {
    const dialog = document.createElement("dialog"); dialog.className = "onboarding-dialog";
    const heading = document.createElement("h2"); heading.textContent = "删除会话？";
    const description = document.createElement("p"); description.textContent = "会话及其消息将从列表移除，不会删除工作区文件。";
    const actions = document.createElement("div"); actions.className = "dialog-actions";
    const cancel = document.createElement("button"); cancel.textContent = "取消"; cancel.autofocus = true;
    const remove = document.createElement("button"); remove.textContent = "删除会话";
    const finish = (confirmed) => { dialog.close(); dialog.remove(); resolve(confirmed); };
    cancel.onclick = () => finish(false); remove.onclick = () => finish(true);
    dialog.addEventListener("cancel", (event) => { event.preventDefault(); finish(false); });
    actions.append(cancel, remove); dialog.append(heading, description, actions); document.body.append(dialog); dialog.showModal();
  });
}

function openSessionActionMenu(trigger, session, archived, reorder) {
  const items = [{ label: t("workspace.rename"), action: () => openSessionRename(session) }, { label: t("session.fork"), action: (item) => forkSession(session.id, undefined, item) }, { label: t(archived ? "session.restore" : "session.hide"), action: async () => { try { await api(`/api/sessions/${encodeURIComponent(session.id)}/archived`, { method: "PUT", body: JSON.stringify({ archived: !archived }) }); if (!archived && state.sessionId === session.id) newSession(); else await loadSessions(); } catch (error) { setStatus(error.message, true); } } }];
  if (reorder) items.push({ label: t("session.moveUp"), action: (item) => moveSession(reorder, -1, item), disabled: reorder.index === 0 }, { label: t("session.moveDown"), action: (item) => moveSession(reorder, 1, item), disabled: reorder.index === reorder.sessions.length - 1 });
  items.push({ label: "删除会话…", action: async () => {
    if (!await confirmSessionDeletion()) return;
    try {
      await api(`/api/sessions/${encodeURIComponent(session.id)}`, { method: "DELETE" });
      if (state.sessionId === session.id) newSession();
      await loadSessions();
    } catch (error) { setStatus(error.message, true); }
  } });
  openRowActionMenu(trigger, items);
}

function openWorkspaceActionMenu(trigger, workspace, position, count) {
  openRowActionMenu(trigger, [
    { label: t("workspace.rename"), action: () => renameWorkspace(workspace) },
    { label: t("workspace.remove"), action: () => removeWorkspace(workspace) },
    { label: t("workspace.moveUp"), action: () => moveWorkspace(position, -1), disabled: position === 0 },
    { label: t("workspace.moveDown"), action: () => moveWorkspace(position, 1), disabled: position === count - 1 },
  ]);
}

function openRowActionMenu(trigger, items) {
  closeSessionActionMenu(); closeSessionHover(); sessionActionMenuTrigger = trigger; trigger.parentElement?.classList.add("open"); trigger.setAttribute("aria-expanded", "true"); const menu = document.createElement("div"); menu.className = "session-action-menu"; menu.setAttribute("role", "menu");
  for (const entry of items) { const item = document.createElement("button"); item.type = "button"; item.setAttribute("role", "menuitem"); item.textContent = entry.label; item.disabled = entry.disabled === true; item.addEventListener("click", () => { closeSessionActionMenu(); void entry.action(item); }); menu.append(item); }
  menu.addEventListener("pointerenter", () => clearTimeout(sessionActionMenuCloseTimer)); menu.addEventListener("pointerleave", scheduleSessionActionMenuClose); trigger.onpointerenter = () => clearTimeout(sessionActionMenuCloseTimer); trigger.onpointerleave = scheduleSessionActionMenuClose; menu.addEventListener("keydown", handleSessionActionMenuKey); document.body.append(menu); sessionActionMenu = menu;
  const anchor = trigger.getBoundingClientRect(); const bounds = menu.getBoundingClientRect(); const left = Math.max(12, Math.min(anchor.right - bounds.width, window.innerWidth - bounds.width - 12)); let top = anchor.bottom + 4; if (top + bounds.height > window.innerHeight - 12) top = Math.max(12, anchor.top - bounds.height - 4); menu.style.left = `${left}px`; menu.style.top = `${top}px`; menu.querySelector(':scope > button:not(:disabled)')?.focus();
}

function scheduleSessionActionMenuClose() { clearTimeout(sessionActionMenuCloseTimer); sessionActionMenuCloseTimer = setTimeout(closeSessionActionMenu, ROW_ACTION_MENU_GRACE_MS); }
function closeSessionActionMenu(restoreFocus = false) { clearTimeout(sessionActionMenuCloseTimer); sessionActionMenuCloseTimer = null; const trigger = sessionActionMenuTrigger; sessionActionMenu?.remove(); sessionActionMenu = null; sessionActionMenuTrigger = null; if (trigger) { trigger.onpointerenter = null; trigger.onpointerleave = null; trigger.parentElement?.classList.remove("open"); trigger.setAttribute("aria-expanded", "false"); } if (restoreFocus && trigger?.isConnected) trigger.focus(); }
function handleSessionActionMenuKey(event) { const items = [...sessionActionMenu.querySelectorAll('[role="menuitem"]:not(:disabled)')]; const index = items.indexOf(document.activeElement); const next = rowActionMenuIndex(items.length, index, event.key); if (next === index) return; event.preventDefault(); items[next]?.focus(); }

function installSessionHover(row, session) {
  row.addEventListener("pointerenter", () => {
    clearTimeout(sessionHoverCloseTimer); clearTimeout(sessionHoverOpenTimer);
    sessionHoverOpenTimer = setTimeout(() => openSessionHover(row, session), SESSION_HOVER_DELAY_MS);
  });
  row.addEventListener("pointerleave", () => { clearTimeout(sessionHoverOpenTimer); scheduleSessionHoverClose(); });
  row.addEventListener("dragstart", closeSessionHover);
}

function installWorkspaceHover(row, workspace) {
  row.addEventListener("pointerenter", () => { clearTimeout(sessionHoverCloseTimer); clearTimeout(sessionHoverOpenTimer); sessionHoverOpenTimer = setTimeout(() => openWorkspaceHover(row, workspace), SESSION_HOVER_DELAY_MS); });
  row.addEventListener("pointerleave", () => { clearTimeout(sessionHoverOpenTimer); scheduleSessionHoverClose(); });
  row.addEventListener("dragstart", closeSessionHover);
}

function scheduleSessionHoverClose() {
  clearTimeout(sessionHoverCloseTimer); sessionHoverCloseTimer = setTimeout(closeSessionHover, SESSION_HOVER_GRACE_MS);
}

function sessionHoverTime(updatedAt) {
  const time = Date.parse(updatedAt); if (!Number.isFinite(time)) return ""; const relative = sessionRelativeTime(time);
  if (relative.unit === "now") return t("session.timeNow");
  return t("session.timeAgo").replace("{time}", t(`session.time.${relative.unit}`).replace("{n}", String(relative.n)));
}

function sessionCompactTime(updatedAt) {
  const time = Date.parse(updatedAt); if (!Number.isFinite(time)) return ""; const relative = sessionRelativeTime(time);
  return relative.unit === "now" ? t("session.timeNow") : t(`session.time.${relative.unit}`).replace("{n}", String(relative.n));
}

function openSessionHover(row, session) {
  if (!row.isConnected || state.sessionDrag !== null) return; closeSessionHover();
  const title = sessionDisplayTitle(session, t("nav.newSession"), t("session.defaultTitle")); const card = document.createElement(session.blank ? "div" : "button"); card.className = "session-hover-card"; card.dataset.state = session.running ? "running" : "idle"; if (!session.blank) { card.type = "button"; card.setAttribute("aria-label", `${t("message.copy")}: ${title}`); }
  const heading = document.createElement("strong"); heading.textContent = title; const time = document.createElement("span"); time.className = "session-hover-time"; time.textContent = session.blank ? "" : sessionHoverTime(session.updatedAt); const status = document.createElement("span"); status.className = "session-hover-status"; status.textContent = t(session.running ? "status.running" : "session.idle"); const feedback = document.createElement("span"); feedback.className = "session-hover-feedback"; feedback.setAttribute("role", "status");
  card.append(heading, time, status, feedback); card.addEventListener("pointerenter", () => clearTimeout(sessionHoverCloseTimer)); card.addEventListener("pointerleave", scheduleSessionHoverClose);
  if (!session.blank) card.addEventListener("click", async () => { try { await copyText(title); feedback.textContent = t("message.copied"); } catch { feedback.textContent = t("message.copyFailed"); } });
  document.body.append(card); sessionHoverCard = card; const anchor = row.getBoundingClientRect(); const bounds = card.getBoundingClientRect(); let left = anchor.right + 8; if (left + bounds.width > window.innerWidth - 12) left = Math.max(12, anchor.left - bounds.width - 8); const top = Math.max(12, Math.min(anchor.top, window.innerHeight - bounds.height - 12)); card.style.left = `${left}px`; card.style.top = `${top}px`;
}

function workspaceCreatedTime(createdAt) {
  const value = Date.parse(createdAt); if (!Number.isFinite(value)) return ""; const date = new Date(value); const pad = (part) => String(part).padStart(2, "0"); const stamp = currentLocale === "zh-CN" ? `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日 ${pad(date.getHours())}:${pad(date.getMinutes())}` : `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()} ${pad(date.getHours())}:${pad(date.getMinutes())}`; return t("workspace.created").replace("{time}", stamp);
}

function openWorkspaceHover(row, workspace) {
  if (!row.isConnected || state.workspaceDrag !== null || (sessionActionMenuTrigger !== null && row.contains(sessionActionMenuTrigger))) return; closeSessionHover(); const card = document.createElement("button"); card.type = "button"; card.className = "session-hover-card workspace-hover-card"; card.setAttribute("aria-label", `${t("message.copy")}: ${workspace.path}`);
  const heading = document.createElement("strong"); heading.textContent = workspace.title; const path = document.createElement("span"); path.className = "workspace-hover-path"; path.textContent = abbreviateWorkspaceHomePath(workspace.path, hostHome); const created = document.createElement("span"); created.className = "session-hover-time"; created.textContent = workspaceCreatedTime(workspace.createdAt); const feedback = document.createElement("span"); feedback.className = "session-hover-feedback"; feedback.setAttribute("role", "status"); card.append(heading, path, created, feedback);
  card.addEventListener("pointerenter", () => clearTimeout(sessionHoverCloseTimer)); card.addEventListener("pointerleave", scheduleSessionHoverClose); card.addEventListener("click", async () => { try { await copyText(workspace.path); feedback.textContent = t("message.copied"); } catch { feedback.textContent = t("message.copyFailed"); } }); document.body.append(card); sessionHoverCard = card;
  const anchor = row.getBoundingClientRect(); const bounds = card.getBoundingClientRect(); let left = anchor.right + 8; if (left + bounds.width > window.innerWidth - 12) left = Math.max(12, anchor.left - bounds.width - 8); const top = Math.max(12, Math.min(anchor.top, window.innerHeight - bounds.height - 12)); card.style.left = `${left}px`; card.style.top = `${top}px`;
}

function closeSessionHover() {
  clearTimeout(sessionHoverOpenTimer); clearTimeout(sessionHoverCloseTimer); sessionHoverOpenTimer = null; sessionHoverCloseTimer = null; sessionHoverCard?.remove(); sessionHoverCard = null;
}

async function moveSession(reorder, offset, trigger) {
  trigger.disabled = true; const ids = reorder.sessions.map((session) => session.id);
  try { await commitSessionOrder(reorder, ids[reorder.index], moveSessionIds(ids, reorder.index, offset)); }
  catch (error) { trigger.disabled = false; setStatus(error.message, true); }
}

function installSessionDrag(row, sessionId, reorder) {
  row.draggable = true;
  row.addEventListener("dragstart", (event) => { state.sessionDrag = { sessionId, reorder }; row.classList.add("dragging"); if (event.dataTransfer) { event.dataTransfer.effectAllowed = "move"; event.dataTransfer.setData("text/plain", sessionId); } });
  row.addEventListener("dragover", (event) => { if (!state.sessionDrag || state.sessionDrag.reorder.key !== reorder.key) return; event.preventDefault(); const bounds = row.getBoundingClientRect(); row.dataset.dropHalf = event.clientY < bounds.top + bounds.height / 2 ? "before" : "after"; if (event.dataTransfer) event.dataTransfer.dropEffect = "move"; });
  row.addEventListener("dragleave", () => { delete row.dataset.dropHalf; });
  row.addEventListener("drop", (event) => { if (!state.sessionDrag || state.sessionDrag.reorder.key !== reorder.key) return; event.preventDefault(); const drag = state.sessionDrag; const ids = drag.reorder.sessions.map((item) => item.id); const next = dropSessionIds(ids, drag.sessionId, sessionId, row.dataset.dropHalf === "after" ? "after" : "before"); clearSessionDrag(); void commitSessionOrder(drag.reorder, drag.sessionId, next).catch((error) => setStatus(error.message, true)); });
  row.addEventListener("dragend", clearSessionDrag);
}

function clearSessionDrag() { state.sessionDrag = null; for (const row of document.querySelectorAll(".session-row.dragging, .session-row[data-drop-half]")) { row.classList.remove("dragging"); delete row.dataset.dropHalf; } }

async function commitSessionOrder(reorder, sessionId, ids) {
  if (sessionId === promotedBlankSessionId) blankPromotionSuppressedAccounts.add(reorder.key);
  if (reorder.localOrderKey) localStorage.setItem(reorder.localOrderKey, JSON.stringify(ids));
  else { const position = ids.indexOf(sessionId); await api(`/api/workspaces/${encodeURIComponent(reorder.key)}/sessions/order`, { method: "PUT", body: JSON.stringify({ sessionId, beforeSessionId: ids[position + 1] }) }); }
  await loadSessions();
}

async function moveWorkspace(index, offset) {
  const reordered = [...state.workspaces]; const target = index + offset;
  if (target < 0 || target >= reordered.length) return;
  [reordered[index], reordered[target]] = [reordered[target], reordered[index]];
  try { await commitWorkspaceOrder(reordered.map((item) => item.id)); }
  catch (error) { setStatus(error.message, true); }
}

function installWorkspaceDrag(group, workspaceId, ids) {
  group.draggable = true;
  group.addEventListener("dragstart", (event) => { if (event.target.closest?.(".session-row")) return; state.workspaceDrag = { workspaceId, ids }; group.classList.add("dragging"); if (event.dataTransfer) { event.dataTransfer.effectAllowed = "move"; event.dataTransfer.setData("text/plain", workspaceId); } });
  group.addEventListener("dragover", (event) => { if (!state.workspaceDrag) return; event.preventDefault(); const bounds = group.getBoundingClientRect(); group.dataset.workspaceDropHalf = event.clientY < bounds.top + bounds.height / 2 ? "before" : "after"; if (event.dataTransfer) event.dataTransfer.dropEffect = "move"; });
  group.addEventListener("dragleave", (event) => { if (!group.contains(event.relatedTarget)) delete group.dataset.workspaceDropHalf; });
  group.addEventListener("drop", (event) => { if (!state.workspaceDrag) return; event.preventDefault(); event.stopPropagation(); const drag = state.workspaceDrag; const next = dropSessionIds(drag.ids, drag.workspaceId, workspaceId, group.dataset.workspaceDropHalf === "after" ? "after" : "before"); clearWorkspaceDrag(); void commitWorkspaceOrder(next).catch((error) => setStatus(error.message, true)); });
  group.addEventListener("dragend", clearWorkspaceDrag);
}

function clearWorkspaceDrag() { state.workspaceDrag = null; for (const group of document.querySelectorAll(".workspace-group.dragging, .workspace-group[data-workspace-drop-half]")) { group.classList.remove("dragging"); delete group.dataset.workspaceDropHalf; } }
async function commitWorkspaceOrder(ids) { await api("/api/workspaces/order", { method: "PUT", body: JSON.stringify({ ids }) }); await loadSessions(); }

async function addWorkspace(event) {
  event.preventDefault();
  try {
    const workspace = await (await api("/api/workspaces", { method: "POST", body: JSON.stringify({ path: $("workspace-path").value, title: $("workspace-title").value || undefined }) })).json();
    $("workspace-dialog").hidden = true; $("cwd").value = workspace.path; localStorage.setItem("seal-harness.cwd", workspace.path);
    await loadSessions(); newSession();
  } catch (error) { setStatus(error.message, true); }
}

async function pickWorkspaceDirectory() {
  const button = $("workspace-browse"); button.disabled = true;
  try {
    const response = await api("/api/dsh/directory-picker", { method: "POST", body: JSON.stringify({ operation: "pick" }) });
    const path = await response.json(); if (typeof path === "string" && path) $("workspace-path").value = path;
  } catch (error) {
    if (error.code !== "directory-picker/unavailable") { setStatus(error.message, true); return; }
    directoryOpenGeneration += 1; $("directory-browser-dialog").hidden = false; directoryShowHidden = false; await loadBrowsedDirectory();
  } finally { button.disabled = false; }
}

async function loadBrowsedDirectory(path, { preview = false } = {}) {
  const { id, signal } = beginDirectoryScan(); $("directory-browser-open").disabled = true; if (!preview) $("directory-browser-error").hidden = true;
  let parentPending = false;
  try {
    const response = await api("/api/dsh/directory-picker", { method: "POST", signal, body: JSON.stringify({ operation: "list", ...(path ? { path } : {}) }) });
    const target = await response.json(); if (id !== directoryRequest) return false;
    if (preview && typeof path === "string") directoryScannedDraft = { directory: path, landed: target.path };
    const parentCrumb = parentDirectoryCrumb(target, t("directory.home"));
    if (parentCrumb === null) { directoryListing = target; directoryChildListing = null; directorySelected = null; $("directory-browser-error").hidden = true; renderDirectoryBrowser(); return true; }
    parentPending = true;
    const parentSignal = continueDirectoryScan(id);
    if (preview) {
      try {
        const parentResponse = await api("/api/dsh/directory-picker", { method: "POST", signal: parentSignal, body: JSON.stringify({ operation: "list", path: parentCrumb.path }) });
        const parent = await parentResponse.json(); if (id !== directoryRequest) return false;
        const match = matchingDirectoryEntry(parent, target.path); if (match === null) return false;
        directoryListing = parent; directorySelected = match; directoryChildListing = target; $("directory-browser-error").hidden = true; renderDirectoryBrowser(); return true;
      } catch { return false; }
      finally { parentPending = false; finishDirectoryScan(id); }
    }
    return await new Promise((resolve) => {
      let landed = false;
      const landSingle = () => {
        if (landed) return;
        if (id !== directoryRequest) { landed = true; resolve(false); return; }
        landed = true; directoryListing = target; directoryChildListing = null; directorySelected = null; renderDirectoryBrowser();
        $("directory-browser-open").disabled = directoryPathEditing; $("directory-browser-new").disabled = directoryPathEditing; $("directory-browser-loading").hidden = true; resolve(true);
      };
      const wait = setTimeout(landSingle, 200);
      void api("/api/dsh/directory-picker", { method: "POST", signal: parentSignal, body: JSON.stringify({ operation: "list", path: parentCrumb.path }) }).then(async (parentResponse) => {
        const parent = await parentResponse.json(); if (id !== directoryRequest) { landSingle(); return; }
        const match = matchingDirectoryEntry(parent, target.path);
        if (match === null) { landSingle(); return; }
        clearTimeout(wait); const firstLanding = !landed; landed = true;
        directoryListing = parent; directorySelected = match; directoryChildListing = target; renderDirectoryBrowser();
        if (firstLanding) resolve(true);
      }).catch(() => { landSingle(); }).finally(() => { parentPending = false; finishDirectoryScan(id); });
    });
  } catch (error) { if (id !== directoryRequest) return false; if (!preview) { $("directory-browser-error").textContent = error.message; $("directory-browser-error").hidden = false; } return false; }
  finally { finishDirectoryScan(id, parentPending); }
}

function renderDirectoryBrowser() {
  const crumbs = $("directory-browser-crumbs"); crumbs.replaceChildren();
  const list = $("directory-browser-list"); list.replaceChildren(); list.classList.toggle("two-pane", directoryListing !== null && directoryChildListing !== null);
  crumbs.hidden = directoryPathEditing; $("directory-browser-edit").hidden = directoryPathEditing; $("directory-browser-path-form").hidden = !directoryPathEditing;
  $("directory-browser-hidden").setAttribute("aria-pressed", String(directoryShowHidden));
  if (directoryListing === null) { $("directory-browser-truncated").hidden = true; return; }
  const activeListing = directoryChildListing ?? directoryListing;
  for (const crumb of displayDirectoryCrumbs(activeListing, t("directory.home"))) { const button = document.createElement("button"); button.type = "button"; button.textContent = crumb.name; button.addEventListener("click", () => void loadBrowsedDirectory(crumb.path)); crumbs.append(button); }
  crumbs.scrollLeft = crumbs.scrollWidth;
  list.append(directoryColumn(directoryListing, false)); if (directoryChildListing !== null) list.append(directoryColumn(directoryChildListing, true));
  if (directoryChildListing !== null) list.scrollLeft = list.scrollWidth;
  $("directory-browser-truncated").hidden = !activeListing.truncated;
}

function beginDirectoryPathEdit() { directoryPreviewSuspended = false; directoryPathEditing = true; $("directory-browser-open").disabled = true; $("directory-browser-new").disabled = true; $("directory-browser-path").value = directoryListing === null ? "" : editableDirectoryPath(directorySelected === null || directoryChildListing === null ? directoryListing : directoryChildListing); renderDirectoryBrowser(); $("directory-browser-path").focus(); $("directory-browser-path").select(); }

function cancelDirectoryPathEdit() {
  if (directoryPreviewTimer !== null) clearTimeout(directoryPreviewTimer); directoryPreviewTimer = null;
  directoryRequest += 1; directoryScanController?.abort(); directoryScanController = null;
  if (directorySlowTimer !== null) clearTimeout(directorySlowTimer); directorySlowTimer = null; $("directory-browser-loading").hidden = true;
  directoryPathEditing = false; $("directory-browser-error").hidden = true;
  directoryPreviewSuspended = false;
  if (directoryChildListing === null) directorySelected = null;
  $("directory-browser-open").disabled = directoryListing === null; $("directory-browser-new").disabled = directoryListing === null;
  renderDirectoryBrowser(); $("directory-browser-edit").focus(); if (directoryListing === null) void loadBrowsedDirectory();
}

function scheduleDirectoryPreview() {
  directoryPreviewSuspended = false; if (directoryPreviewTimer !== null) clearTimeout(directoryPreviewTimer); if (directoryScanController !== null) supersedeDirectoryScan(); renderDirectoryBrowser(); if (directoryListing === null) return;
  const active = directoryChildListing ?? directoryListing; const parts = directoryDraftParts(active, $("directory-browser-path").value, directoryScannedDraft);
  if (parts.directory === null || editableDirectoryPath(active) === parts.directory) return;
  directoryPreviewTimer = setTimeout(() => { directoryPreviewTimer = null; if (directoryPathEditing && !directoryPreviewSuspended) void loadBrowsedDirectory(parts.directory, { preview: true }); }, 250);
}

function directoryColumn(listing, child) {
  const column = document.createElement("div"); column.className = "directory-browser-column"; column.setAttribute("role", "list");
  const active = directoryChildListing ?? directoryListing; const prefix = directoryPathEditing && listing === active ? directoryDraftParts(listing, $("directory-browser-path").value, directoryScannedDraft).tail : null;
  for (const entry of visibleDirectoryEntries(listing.entries, directoryShowHidden, prefix, !child ? directorySelected?.path : null)) { const selected = !child && directorySelected?.path === entry.path; const seat = document.createElement("span"); seat.setAttribute("role", "listitem"); const button = document.createElement("button"); button.type = "button"; button.dataset.directoryPath = entry.path; if (selected) button.setAttribute("aria-current", "true"); button.textContent = `${selected ? "▾" : "▸"}  ${entry.name}`; if (directoryPathEditing) button.addEventListener("mousedown", (event) => event.preventDefault()); button.addEventListener("click", () => void selectBrowsedEntry(entry, child)); button.addEventListener("dblclick", () => { $("workspace-path").value = entry.path; closeDirectoryBrowser(); }); seat.append(button); column.append(seat); }
  return column;
}

function focusDirectoryEntry(path) {
  for (const button of $("directory-browser-list").querySelectorAll("button[data-directory-path]")) {
    if (button.dataset.directoryPath === path) { button.focus(); return; }
  }
  $("directory-browser-edit").focus();
}

async function selectBrowsedEntry(entry, fromChild) {
  const { id, signal } = beginDirectoryScan(); $("directory-browser-open").disabled = true;
  if (fromChild && directoryChildListing !== null) directoryListing = directoryChildListing;
  directoryPathEditing = false;
  directorySelected = entry; directoryChildListing = null; $("directory-browser-error").hidden = true; renderDirectoryBrowser();
  try {
    const response = await api("/api/dsh/directory-picker", { method: "POST", signal, body: JSON.stringify({ operation: "list", path: entry.path }) }); const child = await response.json(); if (id !== directoryRequest) return;
    directoryChildListing = child; renderDirectoryBrowser(); focusDirectoryEntry(entry.path);
  } catch (error) { if (id !== directoryRequest) return; directorySelected = null; directoryChildListing = null; $("directory-browser-error").textContent = error.message; $("directory-browser-error").hidden = false; renderDirectoryBrowser(); focusDirectoryEntry(entry.path); }
  finally { finishDirectoryScan(id); if (id === directoryRequest) $("directory-browser-open").disabled = false; }
}

function beginDirectoryScan() {
  directoryScanController?.abort(); if (directorySlowTimer !== null) clearTimeout(directorySlowTimer); $("directory-browser-loading").hidden = true;
  $("directory-browser-open").disabled = true; $("directory-browser-new").disabled = true;
  const id = ++directoryRequest; directoryScanController = new AbortController(); directorySlowTimer = setTimeout(() => { directorySlowTimer = null; if (id === directoryRequest) $("directory-browser-loading").hidden = false; }, 300); return { id, signal: directoryScanController.signal };
}
function supersedeDirectoryScan() {
  directoryRequest += 1; directoryScanController?.abort(); directoryScanController = null;
  if (directorySlowTimer !== null) clearTimeout(directorySlowTimer); directorySlowTimer = null;
  $("directory-browser-loading").hidden = true; $("directory-browser-open").disabled = directoryPathEditing || directoryListing === null; $("directory-browser-new").disabled = directoryPathEditing || directoryListing === null;
}
function continueDirectoryScan(id) {
  directoryScanController = new AbortController();
  if (directorySlowTimer !== null) clearTimeout(directorySlowTimer);
  directorySlowTimer = setTimeout(() => { directorySlowTimer = null; if (id === directoryRequest) $("directory-browser-loading").hidden = false; }, 300);
  return directoryScanController.signal;
}
function finishDirectoryScan(id, preserveController = false) { if (id !== directoryRequest) return; if (!preserveController) directoryScanController = null; if (directorySlowTimer !== null) clearTimeout(directorySlowTimer); directorySlowTimer = null; $("directory-browser-loading").hidden = true; $("directory-browser-open").disabled = directoryPathEditing || directoryListing === null; $("directory-browser-new").disabled = directoryPathEditing || directoryListing === null; }
function closeDirectoryBrowser() { directoryOpenGeneration += 1; directoryRequest += 1; directoryScanController?.abort(); directoryScanController = null; if (directorySlowTimer !== null) clearTimeout(directorySlowTimer); directorySlowTimer = null; $("directory-browser-loading").hidden = true; if (directoryPreviewTimer !== null) clearTimeout(directoryPreviewTimer); directoryPreviewTimer = null; directoryPreviewSuspended = false; directoryScannedDraft = null; directoryListing = null; directoryChildListing = null; directorySelected = null; directoryPathEditing = false; directoryInputComposing = false; closeDirectoryCreate({ force: true }); $("directory-browser-dialog").hidden = true; }
function acceptBrowsedDirectory() { if (directoryListing === null) return; $("workspace-path").value = directorySelected?.path ?? directoryListing.path; closeDirectoryBrowser(); }
function openDirectoryCreate() {
  if (directoryListing === null) return; directoryCreateGeneration += 1; directoryCreating = false; directoryCreateParent = directorySelected?.path ?? directoryListing.path; directoryCreateLabel = directorySelected?.name ?? directoryListing.crumbs.at(-1)?.name ?? directoryListing.path;
  renderDirectoryCreateTitle(); $("directory-create-name").value = t("directory.untitledFolder"); $("directory-create-error").hidden = true; $("directory-browser-dialog").inert = true; $("directory-create-dialog").hidden = false; $("directory-create-name").focus(); $("directory-create-name").select();
}
function renderDirectoryCreateTitle() { if (directoryCreateLabel !== null) $("directory-create-title").textContent = t("directory.createIn").replace("{name}", directoryCreateLabel); }
function closeDirectoryCreate({ force = false } = {}) { if (directoryCreating && !force) return; directoryCreateGeneration += 1; directoryCreating = false; directoryCreateParent = null; directoryCreateLabel = null; $("directory-create-dialog").hidden = true; $("directory-browser-dialog").inert = false; $("directory-create-submit").disabled = false; }
async function createBrowsedDirectory(event) {
  event.preventDefault(); if (directoryCreating || directoryListing === null || directoryCreateParent === null) return; const parent = directoryCreateParent; const name = $("directory-create-name").value;
  if (!validDirectoryName(name)) { $("directory-create-error").textContent = t("directory.invalidName"); $("directory-create-error").hidden = false; return; }
  directoryCreating = true; $("directory-create-submit").disabled = true; const openGeneration = directoryOpenGeneration; const createGeneration = directoryCreateGeneration;
  try { const response = await api("/api/dsh/directory-picker", { method: "POST", body: JSON.stringify({ operation: "createDirectory", path: parent, name }) }); const path = await response.json(); if (openGeneration !== directoryOpenGeneration || createGeneration !== directoryCreateGeneration) return; const fromChild = directorySelected !== null; closeDirectoryCreate({ force: true }); await selectBrowsedEntry({ name, path, hidden: false }, fromChild); }
  catch (error) { if (openGeneration !== directoryOpenGeneration || createGeneration !== directoryCreateGeneration) return; directoryCreating = false; $("directory-create-error").textContent = error.message; $("directory-create-error").hidden = false; $("directory-create-submit").disabled = false; }
}

function renameWorkspace(workspace) {
  workspaceRenameTarget = workspace; workspaceRenameBusy = false; workspaceRenameConflict = false; workspaceRenameComposing = false; $("workspace-rename-name").disabled = false; $("workspace-rename-cancel").disabled = false; $("workspace-rename-close").disabled = false; $("workspace-rename-name").value = workspace.title; $("workspace-rename-error").hidden = true; $("workspace-rename-dialog").hidden = false; updateWorkspaceRenameDraft(); $("workspace-rename-name").focus(); $("workspace-rename-name").select();
}

function updateWorkspaceRenameDraft() {
  if (workspaceRenameTarget === null) return; const title = $("workspace-rename-name").value.trim(); const duplicate = state.workspaces.some((item) => item.id !== workspaceRenameTarget.id && item.title === title);
  workspaceRenameConflict = duplicate;
  $("workspace-rename-error").textContent = duplicate ? t("workspace.nameConflict").replace("{name}", title) : ""; $("workspace-rename-error").hidden = !duplicate;
  $("workspace-rename-submit").disabled = workspaceRenameBusy || title === "" || title === workspaceRenameTarget.title || duplicate;
}

function closeWorkspaceRename() {
  if (workspaceRenameBusy) return; workspaceRenameTarget = null; workspaceRenameConflict = false; $("workspace-rename-dialog").hidden = true; $("workspace-rename-error").hidden = true;
}

async function submitWorkspaceRename(event) {
  event.preventDefault(); if (workspaceRenameComposing || workspaceRenameTarget === null || workspaceRenameBusy || $("workspace-rename-submit").disabled) return; const target = workspaceRenameTarget; const title = $("workspace-rename-name").value.trim(); workspaceRenameBusy = true; $("workspace-rename-name").disabled = true; $("workspace-rename-submit").disabled = true; $("workspace-rename-cancel").disabled = true; $("workspace-rename-close").disabled = true;
  try { await api(`/api/workspaces/${encodeURIComponent(target.id)}`, { method: "PUT", body: JSON.stringify({ title }) }); await loadSessions(); workspaceRenameBusy = false; closeWorkspaceRename(); }
  catch (error) { if (workspaceRenameTarget?.id !== target.id) return; workspaceRenameBusy = false; workspaceRenameConflict = false; $("workspace-rename-name").disabled = false; $("workspace-rename-cancel").disabled = false; $("workspace-rename-close").disabled = false; $("workspace-rename-submit").disabled = false; $("workspace-rename-error").textContent = error instanceof Error ? error.message : String(error); $("workspace-rename-error").hidden = false; }
}

function removeWorkspace(workspace) {
  workspaceRemoveTarget = workspace; workspaceRemoveBusy = false; $("workspace-remove-submit").disabled = false; $("workspace-remove-cancel").disabled = false; $("workspace-remove-close").disabled = false; $("workspace-remove-error").hidden = true; $("workspace-remove-status").hidden = true; $("workspace-remove-dialog").hidden = false; renderWorkspaceMutationDialogs(); $("workspace-remove-submit").focus();
}

function closeWorkspaceRemove() {
  if (workspaceRemoveBusy) return; workspaceRemoveTarget = null; $("workspace-remove-dialog").hidden = true; $("workspace-remove-error").hidden = true; $("workspace-remove-status").hidden = true;
}

async function submitWorkspaceRemove(event) {
  event.preventDefault(); if (workspaceRemoveTarget === null || workspaceRemoveBusy) return; const target = workspaceRemoveTarget; workspaceRemoveBusy = true; $("workspace-remove-submit").disabled = true; $("workspace-remove-cancel").disabled = true; $("workspace-remove-close").disabled = true; $("workspace-remove-status").hidden = false; $("workspace-remove-error").hidden = true;
  try { await api(`/api/workspaces/${encodeURIComponent(target.id)}`, { method: "DELETE" }); await loadSessions(); workspaceRemoveBusy = false; closeWorkspaceRemove(); }
  catch (error) { if (workspaceRemoveTarget?.id !== target.id) return; workspaceRemoveBusy = false; $("workspace-remove-submit").disabled = false; $("workspace-remove-cancel").disabled = false; $("workspace-remove-close").disabled = false; $("workspace-remove-status").hidden = true; $("workspace-remove-error").textContent = error instanceof Error ? error.message : String(error); $("workspace-remove-error").hidden = false; }
}

function renderWorkspaceMutationDialogs() {
  if (workspaceRemoveTarget !== null) $("workspace-remove-description").textContent = t("workspace.removeDescription").replace("{name}", workspaceRemoveTarget.title);
  if (workspaceRenameTarget !== null && workspaceRenameConflict) $("workspace-rename-error").textContent = t("workspace.nameConflict").replace("{name}", $("workspace-rename-name").value.trim());
}

function openSessionRename(session) {
  sessionRenameTarget = { id: session.id, title: session.preview || t("session.defaultTitle") }; sessionRenameBusy = false; sessionRenameComposing = false; $("session-rename-name").disabled = false; $("session-rename-cancel").disabled = false; $("session-rename-close").disabled = false; $("session-rename-name").value = sessionRenameTarget.title; $("session-rename-error").hidden = true; $("session-rename-dialog").hidden = false; updateSessionRenameDraft(); $("session-rename-name").focus(); $("session-rename-name").select();
}

function updateSessionRenameDraft() {
  if (sessionRenameTarget === null) return; $("session-rename-error").hidden = true; $("session-rename-submit").disabled = sessionRenameBusy || $("session-rename-name").value.trim() === "";
}

function closeSessionRename() {
  if (sessionRenameBusy) return; sessionRenameTarget = null; sessionRenameComposing = false; $("session-rename-dialog").hidden = true; $("session-rename-error").hidden = true;
}

async function submitSessionRename(event) {
  event.preventDefault(); if (sessionRenameComposing || sessionRenameTarget === null || sessionRenameBusy || $("session-rename-submit").disabled) return; const target = sessionRenameTarget; const title = $("session-rename-name").value.trim(); sessionRenameBusy = true; $("session-rename-name").disabled = true; $("session-rename-submit").disabled = true; $("session-rename-cancel").disabled = true; $("session-rename-close").disabled = true; $("session-rename-error").hidden = true;
  try { await api(`/api/sessions/${encodeURIComponent(target.id)}/title`, { method: "PUT", body: JSON.stringify({ title }) }); await loadSessions(); if (state.sessionId === target.id) $("session-title").textContent = title; sessionRenameBusy = false; closeSessionRename(); }
  catch (error) { if (sessionRenameTarget?.id !== target.id) return; sessionRenameBusy = false; $("session-rename-name").disabled = false; $("session-rename-submit").disabled = false; $("session-rename-cancel").disabled = false; $("session-rename-close").disabled = false; $("session-rename-error").textContent = error instanceof Error ? error.message : String(error); $("session-rename-error").hidden = false; }
}

async function loadSessionFeedback(id) {
  try { return await (await api(`/api/sessions/${encodeURIComponent(id)}/feedback`)).json(); }
  catch (error) { if (error.status === 501) return []; throw error; }
}

async function openSession(id, search = null) {
  if (state.running) return;
  const savedPosition = transcriptPositions.get(id);
  const generation = ++state.sessionLoadGeneration;
  const [page, feedback] = await Promise.all([
    api(`/api/sessions/${encodeURIComponent(id)}/messages`).then((response) => response.json()),
    loadSessionFeedback(id),
  ]);
  if (state.running || generation !== state.sessionLoadGeneration) return;
  state.feedback = new Map(feedback.map((item) => [item.messageId, item]));
  state.pendingAttachments = attachmentDrafts.switch(state.sessionId, id, state.pendingAttachments);
  state.sessionId = id;
  state.todoExpanded = false;
  restoreComposerDraft();
  renderedAttachmentCount = null; renderAttachmentChips();
  renderSessionBreadcrumbs();
  applyLayout();
  window.dispatchEvent(new CustomEvent("seal-harness:session-selected", { detail: { sessionId: id } }));
  renderSessionPage(page);
  globalThis.CSS?.highlights?.delete("seal-search");
  state.trajectoryRecords = []; state.trajectoryBefore = null;
  $("agent-preset").disabled = true;
  document.querySelector(".main")?.setAttribute("data-phase", "active");
  $("cwd").value = page.cwd;
  $("session-title").textContent = id;
  await loadSessions();
  await loadSessionState();
  if ($("trajectory-tab").getAttribute("aria-selected") === "true") await loadTrajectory();
  await updateSessionExportAvailability(id);
  if (state.running || generation !== state.sessionLoadGeneration || state.sessionId !== id) return;
  if (savedPosition === undefined || savedPosition === null) scrollTranscriptToBottom();
  else { restoreTranscriptPosition($("transcript"), savedPosition); updateTranscriptFollow(); updateActiveTurn(); }
  if (search && generation === state.sessionLoadGeneration && state.sessionId === id) await focusSessionSearch(search, id, generation);
}

async function focusSessionSearch({ searchQuery, contentHit }, id, generation) {
  const active = () => !state.running && state.sessionId === id && state.sessionLoadGeneration === generation;
  const transcript = $("transcript");
  globalThis.CSS?.highlights?.delete("seal-search");
  const match = await locateTranscriptMatch({
    root: transcript, query: searchQuery, active,
    cursor: () => contentHit && (state.messageBefore !== null || historyWindow?.hidden) ? `${state.messageBefore}:${historyWindow?.hidden}` : null,
    loadEarlier: () => loadEarlierMessages(HISTORY_JUMP_MESSAGES),
  });
  if (!active()) return;
  if (!match) { setStatus(currentLocale === "zh-CN" ? (contentHit ? "已打开会话，未在可显示正文中找到匹配内容" : "已打开匹配的会话标题或工作区") : "Session opened; no matching displayed text found"); return; }
  for (let parent = match.element.parentElement; parent && parent !== transcript; parent = parent.parentElement) if (parent.tagName === "DETAILS") parent.open = true;
  if (globalThis.CSS?.highlights && globalThis.Highlight) CSS.highlights.set("seal-search", new Highlight(match.range));
  match.element.tabIndex = -1;
  match.element.focus({ preventScroll: true });
  match.element.scrollIntoView({ block: "center" });
  state.transcriptFollowing = false; updateTranscriptFollow(); updateActiveTurn();
  setStatus(currentLocale === "zh-CN" ? "已定位匹配内容" : "Matching text located");
}

function transcriptInteractionActive() {
  const transcript = $("transcript");
  if (!transcript) return false;
  if (transcript.querySelector(".review-confirmation")) return true;
  const focused = document.activeElement;
  if (transcript.contains(focused) && focused?.matches("button, input, textarea, select, summary, a[href], [contenteditable]")) return true;
  const selection = window.getSelection();
  if (!selection || selection.isCollapsed) return false;
  for (let index = 0; index < selection.rangeCount; index++) {
    if (selection.getRangeAt(index).intersectsNode(transcript)) return true;
  }
  return false;
}

function deferSessionRefresh(id) {
  state.sessionInvalidated = true;
  clearTimeout(state.sessionRefreshTimer);
  state.sessionRefreshTimer = setTimeout(() => {
    if (state.sessionId === id && !state.running) flushInvalidatedSession();
  }, 250);
}

async function refreshOpenSession(id) {
  if (state.running || state.sessionId !== id) return;
  if (transcriptInteractionActive()) { deferSessionRefresh(id); return; }
  const limit = refreshedHistorySize(state.loadedMessageCount);
  const [page, feedback] = await Promise.all([
    api(`/api/sessions/${encodeURIComponent(id)}/messages?limit=${limit}`).then((response) => response.json()),
    loadSessionFeedback(id),
  ]);
  if (state.running || state.sessionId !== id) return;
  // The user may begin interacting while the history request is in flight.
  if (transcriptInteractionActive()) { deferSessionRefresh(id); return; }
  state.feedback = new Map(feedback.map((item) => [item.messageId, item]));
  const transcript = $("transcript"); const atBottom = state.transcriptFollowing; const position = atBottom ? null : captureTranscriptPosition(transcript);
  renderSessionPage(page, !atBottom); await loadSessionState();
  if ($("trajectory-tab").getAttribute("aria-selected") === "true") await loadTrajectory();
  if (atBottom) scrollTranscriptToBottom(); else { restoreTranscriptPosition(transcript, position); updateTranscriptFollow(); updateActiveTurn(); }
}

function updateTranscriptFollow() { const transcript = $("transcript"); state.transcriptFollowing = isTranscriptNearBottom(transcript); if (state.sessionId) transcriptPositions.set(state.sessionId, state.transcriptFollowing ? null : captureTranscriptPosition(transcript)); $("back-to-bottom").hidden = state.transcriptFollowing; }
function scrollTranscriptToBottom() { const transcript = $("transcript"); if (!state.running && historyCanTrim && historySnapshot && historyWindow?.canTrim) renderSessionPage({ ...historySnapshot, messages: historyWindow.messages }); state.transcriptFollowing = true; transcript.scrollTop = transcript.scrollHeight; if (state.sessionId) transcriptPositions.set(state.sessionId, null); $("back-to-bottom").hidden = true; updateActiveTurn(); }

function renderSessionPage(page, preserveReading = false) {
  historySnapshot = page;
  historyCanTrim = true;
  historyWindow = createHistoryWindow(page.messages, preserveReading ? page.messages.length : 60);
  const transcript = $("transcript"); const earlier = $("load-earlier"); const turnNav = $("turn-navigator-slot"); const toBottom = $("back-to-bottom-slot");
  state.activeTurn = null; state.sessionMetrics = page.sessionMetrics ?? null; renderStatsLine();
  for (const host of liveToolHosts) window.SealDshPlugins?.unmountToolView?.(host);
  disposeCopyActions(transcript);
  transcript.replaceChildren(earlier);
  liveToolViews.clear(); settledToolResults.clear(); liveToolHosts.clear();
  renderHistoryMessages(historyWindow.visible);
  transcript.append(turnNav, toBottom);
  state.turnOutline = normalizeTurnOutline(page.turnOutline); renderTurnNavigator();
  applyTranscriptView();
  updateMessageActionVisibility();
  state.messageBefore = page.window.nextBefore; state.loadedMessageCount = page.messages.length;
  earlier.hidden = !page.window.hasMore && !historyWindow.hidden; earlier.disabled = false;
}

async function loadEarlierMessages(maxMessages = HISTORY_PAGE_MESSAGES) {
  if (!state.sessionId || (state.messageBefore === null && !historyWindow?.hidden)) return;
  const sessionId = state.sessionId; const before = state.messageBefore;
  const button = $("load-earlier"); button.disabled = true;
  try {
    const local = historyWindow?.hidden > 0;
    const page = local ? { ...historySnapshot, messages: historyWindow.reveal(maxMessages) } : await (await api(`/api/sessions/${encodeURIComponent(sessionId)}/messages?before=${before}&limit=${maxMessages}`)).json();
    if (state.sessionId !== sessionId || state.messageBefore !== before) { button.disabled = false; return; }
    const transcript = $("transcript"); const height = transcript.scrollHeight; const anchor = button.nextSibling;
    renderHistoryMessages(page.messages, anchor);
    applyTranscriptView();
    updateMessageActionVisibility();
    if (!local) { historyWindow?.prepend(page.messages); if (historySnapshot) historySnapshot = { ...historySnapshot, window: page.window, turnOutline: page.turnOutline }; state.messageBefore = page.window.nextBefore; state.loadedMessageCount += page.messages.length; }
    button.hidden = !page.window.hasMore && !historyWindow?.hidden; button.disabled = false; transcript.scrollTop += transcript.scrollHeight - height;
    state.turnOutline = normalizeTurnOutline(page.turnOutline); renderTurnNavigator();
  } catch (error) { button.disabled = false; setStatus(error.message, true); }
}

function newSession(stagedPreset = null) {
  if (state.running) return;
  historyWindow = null; historySnapshot = null;
  state.sessionLoadGeneration += 1;
  state.pendingAttachments = attachmentDrafts.switch(state.sessionId, null, state.pendingAttachments);
  state.sessionId = null;
  state.sessionMetrics = null; renderStatsLine();
  restoreComposerDraft();
  renderedAttachmentCount = null; renderAttachmentChips();
  renderSessionBreadcrumbs();
  applyLayout();
  window.dispatchEvent(new CustomEvent("seal-harness:session-selected", { detail: { sessionId: null } }));
  $("agent-preset").disabled = false;
  renderAgentPresetSelector(stagedPreset ?? agentPresetDefaultId); $("agent-preset").dataset.committed = $("agent-preset").value;
  document.querySelector(".main")?.setAttribute("data-phase", "hero");
  $("session-title").textContent = t("nav.newSession");
  const welcome = document.createElement("div"); welcome.className = "welcome"; welcome.id = "welcome"; welcome.dataset.chatFlow = "";
  const mark = document.createElement("img"); mark.className = "hero-mark"; mark.src = "/assets/seal-harness-mascot.png"; mark.alt = "Seal mascot";
  const title = document.createElement("h1"); title.textContent = t("hero.title");
  const description = document.createElement("p"); description.textContent = t("hero.description");
  welcome.append(mark, title, description);
  const earlier = $("load-earlier"); earlier.hidden = true; disposeCopyActions($("transcript")); $("transcript").replaceChildren(earlier, welcome, $("turn-navigator-slot"), $("back-to-bottom-slot"));
  state.messageBefore = null; state.loadedMessageCount = 0; state.sessionInvalidated = false;
  state.turnOutline = []; state.activeTurn = null; state.busyTurn = null; renderTurnNavigator();
  state.contextPressure = null; renderContextMeter();
  state.goal = null; renderGoalBar();
  state.todos = null; state.todoExpanded = false; renderTodoPanel();
  state.plan = null; renderPlanControl();
  state.jobs = null; state.jobOpen = false; renderJobControl();
  state.schedules = []; state.scheduleOpen = false; renderScheduleCatalog();
  state.transcriptFollowing = true; $("back-to-bottom").hidden = true;
  $("session-export").disabled = true;
  $("state-cards").replaceChildren();
  $("state-cards").hidden = true;
  $("state-empty").hidden = false;
  selectDetailsTab("state");
  void loadSessions();
}

let sessionStateRevision = 0;
async function loadSessionState() {
  if (!state.sessionId) return;
  const requestedSessionId = state.sessionId;
  const revision = ++sessionStateRevision;
  try {
    const snapshot = await (await api(`/api/sessions/${encodeURIComponent(state.sessionId)}/state`)).json();
    if (state.sessionId !== requestedSessionId || revision !== sessionStateRevision) return;
    state.contextPressure = snapshot.contextPressure; renderContextMeter();
    state.goal = snapshot.goal; renderGoalBar();
    state.todos = snapshot.todos; renderTodoPanel();
    state.plan = snapshot.plan; renderPlanControl();
    state.jobs = snapshot.jobs; renderJobControl();
    state.schedules = Array.isArray(snapshot.schedules) ? snapshot.schedules : []; renderScheduleCatalog();
    const presetSelect = $("agent-preset"); const session = state.sessions.find((item) => item.id === state.sessionId); if (snapshot.agentPreset && state.presets.some((preset) => preset.id === snapshot.agentPreset && !preset.broken)) presetSelect.value = snapshot.agentPreset; presetSelect.dataset.committed = presetSelect.value; presetSelect.disabled = state.running || session?.blank !== true || agentPresetSelectBusy;
    const cards = $("state-cards");
    const expandedIds = new Set([...cards.querySelectorAll("details[data-subagent-id][open]")].map(node => node.dataset.subagentId));
    cards.replaceChildren();
    const agents = stateCard(currentLocale === "zh-CN" ? "子任务调用树" : "Delegation tree");
    agents.append(renderSubagentTree(snapshot.subagents, requestedSessionId, {
      locale: currentLocale, onOpen: inspectSubagentSession, expandedIds,
      onAbort: async id => { await api(`/api/sessions/${encodeURIComponent(requestedSessionId)}/subagents/${encodeURIComponent(id)}/abort`, { method: "POST" }); await loadSessionState(); },
    }));
    cards.append(agentPresetCard(snapshot.agentPreset), permissionCard(snapshot.permissions), planCard(snapshot.plan), goalCard(snapshot.goal), listCard("Todos", snapshot.todos, todoLine, "No active checklist"), listCard("Schedules", snapshot.schedules, scheduleLine, "No reminders"), listCard("Jobs", snapshot.jobs, jobLine, "No background jobs"), agents, listCard("Terminals", snapshot.terminals, terminalLine, "No terminals"));
    cards.hidden = $("trajectory-tab").getAttribute("aria-selected") === "true"; $("state-empty").hidden = true;
  } catch (error) { if (state.sessionId !== requestedSessionId || revision !== sessionStateRevision) return; $("state-empty").textContent = error.message; $("state-empty").hidden = false; }
}

async function inspectSubagentSession(id) {
  if (!state.running) return openSession(id);
  const dialog = document.createElement("dialog"); dialog.className = "onboarding-dialog subagent-inspector";
  const title = document.createElement("h2"); title.textContent = currentLocale === "zh-CN" ? "子任务会话" : "Child session";
  const note = document.createElement("p"); note.textContent = currentLocale === "zh-CN" ? "只读查看子任务；不会中断主任务。" : "Read-only child session; the parent task continues.";
  const content = document.createElement("div"); const refresh = document.createElement("button"); refresh.textContent = currentLocale === "zh-CN" ? "刷新" : "Refresh";
  const close = document.createElement("button"); close.textContent = currentLocale === "zh-CN" ? "关闭" : "Close";
  const older = document.createElement("button"); older.type = "button"; older.hidden = true; older.textContent = currentLocale === "zh-CN" ? "加载更早消息" : "Load earlier messages";
  dialog.append(title, note, older, content, refresh, close); document.body.append(dialog); dialog.showModal();
  const canRefresh = () => !document.hidden && content.scrollHeight - content.scrollTop - content.clientHeight <= 64 && !document.getSelection()?.toString();
  const history = createChildHistory({
    canPoll: canRefresh,
    fetchPage: async before => {
      const query = before !== null ? `?before=${encodeURIComponent(before)}` : "";
      const page = await (await api(`/api/sessions/${encodeURIComponent(id)}/messages${query}`)).json();
      return { ...page, messages: [...page.messages, ...(before === null ? page.liveMessages ?? [] : [])] };
    },
    onBusy: busy => { refresh.disabled = busy; older.disabled = busy; },
    onError: error => { note.textContent = error.message; },
    onPage: ({ messages, hasMore, kind }) => {
      const height = content.scrollHeight; const scroll = content.scrollTop;
      const disclosures = new Map([...content.querySelectorAll("details")].filter(node => node.dataset.childDisclosure).map(node => [node.dataset.childDisclosure, node.open]));
      content.replaceChildren(renderChildTranscript(messages, { locale: currentLocale, sessionId: id, markdown: renderMarkdown, loadReview: async snapshotId => (await api(`/api/sessions/${encodeURIComponent(id)}/reviews/${encodeURIComponent(snapshotId)}`)).json() }));
      for (const detail of content.querySelectorAll("details")) if (disclosures.has(detail.dataset.childDisclosure)) detail.open = disclosures.get(detail.dataset.childDisclosure);
      older.hidden = !hasMore;
      content.scrollTop = kind === "older" ? scroll + content.scrollHeight - height : content.scrollHeight;
      note.textContent = currentLocale === "zh-CN" ? (kind === "older" ? "正在阅读历史，自动更新已暂停；刷新返回最新消息。" : "只读查看；已保存的消息变化时自动更新。") : (kind === "older" ? "Reading history; refresh to resume live updates." : "Read-only; updates when saved messages change.");
    },
  });
  const stopWatching = watchChildHistory({ sessionId: id, target: window, refresh: () => history.load("poll"),
    canRefresh,
  });
  close.onclick = () => dialog.close();
  dialog.addEventListener("close", () => { stopWatching(); history.dispose(); dialog.remove(); }, { once: true });
  older.onclick = () => void history.load("older"); refresh.onclick = () => void history.load(); await history.load();
}

function renderContextMeter() {
  const root = $("context-meter"); const occupancy = contextOccupancy(state.contextPressure); root.replaceChildren(); root.hidden = occupancy === null;
  if (occupancy === null) return;
  const label = t("context.aria").replace("{percent}", `${occupancy.percent}%`);
  const button = document.createElement("button"); button.type = "button"; button.className = "context-trigger"; button.setAttribute("aria-label", label); button.setAttribute("aria-haspopup", "dialog"); button.setAttribute("aria-expanded", "false"); button.title = label;
  const ring = document.createElementNS("http://www.w3.org/2000/svg", "svg"); ring.setAttribute("viewBox", "0 0 14 14"); ring.setAttribute("aria-hidden", "true");
  const track = document.createElementNS(ring.namespaceURI, "circle"); track.setAttribute("class", "context-track"); track.setAttribute("cx", "7"); track.setAttribute("cy", "7"); track.setAttribute("r", "5.5");
  const fill = document.createElementNS(ring.namespaceURI, "circle"); fill.setAttribute("class", "context-fill"); fill.setAttribute("cx", "7"); fill.setAttribute("cy", "7"); fill.setAttribute("r", "5.5"); fill.setAttribute("transform", "rotate(-90 7 7)"); fill.setAttribute("stroke-dasharray", `${2 * Math.PI * 5.5 * occupancy.percent / 100} ${2 * Math.PI * 5.5}`); ring.append(track, fill); button.append(ring);
  button.addEventListener("click", () => { const existing = root.querySelector(".context-panel"); if (existing) { existing.remove(); button.setAttribute("aria-expanded", "false"); return; } const panel = document.createElement("div"); panel.className = "context-panel"; panel.setAttribute("role", "dialog"); panel.setAttribute("aria-label", t("context.used")); const headline = document.createElement("strong"); headline.textContent = label; const figures = document.createElement("span"); figures.textContent = `~${formatTokens(occupancy.usedTokens)} / ${formatTokens(occupancy.contextWindow)}`; const bar = document.createElement("div"); bar.className = "context-bar"; const used = document.createElement("i"); used.style.width = `${occupancy.percent}%`; bar.append(used); panel.append(headline, figures, bar); root.append(panel); button.setAttribute("aria-expanded", "true"); });
  root.append(button);
}

function renderGoalBar() {
  const dock = $("goal-dock"); const goal = goalBarModel(state.goal); dock.replaceChildren(); dock.hidden = goal === null;
  if (goal === null) return;
  const bar = document.createElement("div"); bar.className = `goal-bar goal-${goal.phase}`;
  const glyph = document.createElement("span"); glyph.className = "goal-glyph"; glyph.textContent = "◎";
  const phase = document.createElement("span"); phase.className = "goal-phase"; phase.textContent = t(`goal.phase.${goal.phase}`);
  const objective = document.createElement("span"); objective.className = "goal-objective"; objective.textContent = goal.objective; objective.title = goal.objective;
  const actions = document.createElement("div"); actions.className = "goal-actions";
  if (goal.canPause) actions.append(goalButton("Ⅱ", "goal.pause", () => updateGoal("pause", goal)));
  if (goal.canResume) actions.append(goalButton("▶", "goal.resume", () => updateGoal("resume", goal)));
  actions.append(goalButton("✎", "goal.edit", () => editGoal(goal)), goalButton("×", "goal.clear", () => updateGoal("clear", goal)));
  bar.append(glyph, phase, objective, actions); dock.append(bar);
}

function renderTodoPanel() {
  const dock = $("todo-dock"); const model = todoPanelModel(state.todos); dock.replaceChildren(); dock.hidden = model === null;
  if (model === null) return;
  const panel = document.createElement("div"); panel.className = "todo-panel"; panel.setAttribute("aria-label", t("todo.title"));
  const header = document.createElement("button"); header.type = "button"; header.className = "todo-header"; header.setAttribute("aria-expanded", String(state.todoExpanded));
  const lead = document.createElement("span"); lead.textContent = "☷"; lead.setAttribute("aria-hidden", "true"); const title = document.createElement("strong"); title.textContent = t("todo.title");
  const counts = [[model.completed, "todo.done"], [model.active, "todo.active"], [model.pending, "todo.pending"]].filter(([count]) => count > 0).map(([count, key]) => t(key).replace("{count}", count)).join(" · ");
  const progress = document.createElement("span"); progress.className = "todo-progress"; progress.textContent = counts; const chevron = document.createElement("span"); chevron.textContent = state.todoExpanded ? "⌄" : "⌃"; chevron.setAttribute("aria-hidden", "true");
  header.append(lead, title, progress, chevron); header.addEventListener("click", () => { state.todoExpanded = !state.todoExpanded; renderTodoPanel(); }); panel.append(header);
  if (state.todoExpanded) { const list = document.createElement("ul"); for (const item of model.items) { const row = document.createElement("li"); row.dataset.status = item.status; const glyph = document.createElement("span"); glyph.className = "todo-glyph"; glyph.textContent = item.status === "completed" ? "✓" : item.status === "in_progress" ? "◌" : "◯"; glyph.setAttribute("aria-hidden", "true"); const text = document.createElement("span"); text.textContent = item.content; row.append(glyph, text); list.append(row); } panel.append(list); }
  dock.append(panel);
}

function renderPlanControl() {
  const root = $("plan-control"); if (!root) return;
  const target = planModeTarget(state.plan); root.replaceChildren(); root.hidden = !target;
  const canSteerQueue = queueMutable(state.sessionId, state.sessions) && canAccelerateQueuedMessages({ draft: $("prompt").value, attachmentCount: state.pendingAttachments.length, running: state.running, items: state.queueItems });
  $("prompt").placeholder = canSteerQueue ? t("composer.steerQueuePlaceholder") : planComposerPlaceholder(state.plan, t("composer.placeholder"), t("composer.planPlaceholder"));
  if (!target) return;
  const button = document.createElement("button"); button.type = "button"; button.className = "plan-chip"; button.disabled = state.running;
  button.textContent = `${t("plan.chip")} ×`; button.title = t("plan.turnOffTitle"); button.setAttribute("aria-label", t("plan.turnOffAria"));
  button.addEventListener("click", async () => { button.disabled = true; try { await setPlanMode(false); } catch (error) { setStatus(`${t("plan.exitFailed")}: ${error.message}`, true); button.disabled = false; } });
  root.append(button);
}

function renderComposerPrimary() {
  const model = composerPrimaryModel({ running: state.running, draft: $("prompt").value, attachmentCount: state.pendingAttachments.length });
  const primary = $("submit-run");
  primary.dataset.action = model.action;
  primary.textContent = t(`composer.${model.label}`);
  $("cancel").hidden = !model.showSecondaryStop;
}

function renderJobControl() {
  const root = $("job-control"); if (!root) return; if (state.jobTimer) { clearInterval(state.jobTimer); state.jobTimer = null; }
  const model = jobCounts(state.jobs); root.replaceChildren(); root.hidden = model.total === 0; if (model.total === 0) { state.jobOpen = false; return; }
  const label = t(model.live > 0 ? (model.live === 1 ? "jobs.liveOne" : "jobs.liveMany") : (model.total === 1 ? "jobs.idleOne" : "jobs.idleMany")).replace("{count}", model.live || model.total);
  const trigger = document.createElement("button"); trigger.type = "button"; trigger.className = "job-trigger"; trigger.setAttribute("aria-expanded", String(Boolean(state.jobOpen))); trigger.setAttribute("aria-label", label);
  if (model.live) { const dot = document.createElement("i"); dot.className = "job-live-dot"; dot.setAttribute("aria-hidden", "true"); trigger.append(dot); }
  const text = document.createElement("span"); text.textContent = label; trigger.append(text, document.createTextNode(state.jobOpen ? " ▴" : " ▾"));
  trigger.addEventListener("click", () => { state.jobOpen = !state.jobOpen; renderJobControl(); }); trigger.addEventListener("keydown", (event) => { if (event.key === "Escape" && state.jobOpen) { event.preventDefault(); state.jobOpen = false; renderJobControl(); root.querySelector("button")?.focus(); } }); root.append(trigger);
  if (state.jobOpen) {
    const list = document.createElement("ul"); list.className = "job-popover"; list.setAttribute("aria-label", t("jobs.list"));
    for (const job of model.rows) { const row = document.createElement("li"); row.dataset.status = job.status; const dot = document.createElement("i"); dot.className = "job-row-dot"; const kind = document.createElement("code"); kind.textContent = job.kind; const name = document.createElement("span"); name.className = "job-label"; name.textContent = job.label || job.id; name.title = job.label || job.id; const status = document.createElement("span"); status.textContent = job.detail || t(`jobs.status.${job.status}`); status.title = job.detail || status.textContent; const duration = document.createElement("time"); duration.textContent = formatJobDuration(jobDuration(job)); row.append(dot, kind, name, status, duration); list.append(row); }
    root.append(list); if (model.live) state.jobTimer = setInterval(renderJobControl, 1000);
  }
}

function updateScheduleRelativeTimes(now = Date.now()) {
  for (const node of document.querySelectorAll("#schedule-catalog [data-scheduled-at]")) node.textContent = formatScheduleRelative(node.dataset.scheduledAt, now, t);
}

function renderScheduleCatalog() {
  const root = $("schedule-catalog"); if (!root) return; if (state.scheduleTimer) { clearInterval(state.scheduleTimer); state.scheduleTimer = null; }
  const records = Array.isArray(state.schedules) ? state.schedules : []; const wasOpen = root.querySelector("details")?.open === true; root.replaceChildren(); root.hidden = records.length === 0;
  if (records.length === 0) return;
  const details = document.createElement("details"); details.dataset.dismissiblePopover = ""; details.open = wasOpen;
  const label = t(records.length === 1 ? "schedule.trigger.one" : "schedule.trigger.other").replace("{count}", String(records.length));
  const trigger = document.createElement("summary"); trigger.className = "schedule-trigger"; trigger.setAttribute("aria-label", label); trigger.setAttribute("aria-expanded", String(wasOpen)); trigger.textContent = `◷ ${label} ▾`;
  const list = document.createElement("ul"); list.className = "schedule-popover"; list.setAttribute("role", "dialog"); list.setAttribute("aria-label", t("schedule.list"));
  const now = Date.now();
  for (const schedule of orderScheduleRecords(records, now)) {
    const row = document.createElement("li"); const overdue = Date.parse(schedule.scheduledAt) <= now; row.dataset.overdue = String(overdue);
    const status = document.createElement("span"); status.className = "schedule-status"; status.textContent = t(overdue ? "schedule.status.overdue" : "schedule.status.scheduled");
    const prompt = document.createElement("span"); prompt.className = "schedule-prompt"; prompt.textContent = schedule.prompt;
    const meta = document.createElement("span"); meta.className = "schedule-meta";
    const frequency = document.createElement("span"); frequency.textContent = formatScheduleFrequency(schedule, t);
    const local = document.createElement("span"); local.textContent = formatScheduleLocalTime(schedule.scheduledAt, currentLocale);
    const relative = document.createElement("span"); relative.dataset.scheduledAt = schedule.scheduledAt; relative.textContent = formatScheduleRelative(schedule.scheduledAt, now, t);
    meta.append(frequency, document.createTextNode(" · "), local, document.createTextNode(" · "), relative); row.append(status, prompt, meta); list.append(row);
  }
  details.append(trigger, list); details.addEventListener("toggle", () => { if (details.open) { if (state.scheduleTimer) clearInterval(state.scheduleTimer); updateScheduleRelativeTimes(); state.scheduleTimer = setInterval(updateScheduleRelativeTimes, 1000); } else if (state.scheduleTimer) { clearInterval(state.scheduleTimer); state.scheduleTimer = null; } }); root.append(details);
  if (wasOpen) state.scheduleTimer = setInterval(updateScheduleRelativeTimes, 1000);
}

function formatJobDuration(ms) { const total = Math.max(0, Math.floor(ms / 1000)); const seconds = total % 60; const minutes = Math.floor(total / 60) % 60; const hours = Math.floor(total / 3600); return hours ? `${hours}h ${minutes}m` : minutes ? `${minutes}m ${seconds}s` : `${seconds}s`; }

async function setPlanMode(active) {
  if (!state.sessionId) return;
  await api(`/api/sessions/${encodeURIComponent(state.sessionId)}/plan`, { method: "PUT", body: JSON.stringify({ active }) });
  await loadSessionState();
}

function goalButton(text, labelKey, action) { const button = document.createElement("button"); button.type = "button"; button.textContent = text; button.title = t(labelKey); button.setAttribute("aria-label", t(labelKey)); button.addEventListener("click", action); return button; }

async function updateGoal(action, goal, patch = {}) {
  const buttons = $("goal-dock").querySelectorAll("button"); buttons.forEach((button) => { button.disabled = true; });
  try { await api(`/api/sessions/${encodeURIComponent(state.sessionId)}/goal`, { method: action === "clear" ? "DELETE" : "PUT", body: JSON.stringify({ id: goal.id, revision: goal.revision, ...(action === "clear" ? {} : { action }), ...patch }) }); await loadSessionState(); }
  catch (error) { setStatus(error.message, true); buttons.forEach((button) => { button.disabled = false; }); }
}

function editGoal(goal) {
  const bar = $("goal-dock").querySelector(".goal-bar"); if (!bar) return; bar.replaceChildren();
  const input = document.createElement("input"); input.type = "text"; input.value = goal.objective; input.setAttribute("aria-label", t("goal.objective"));
  const save = goalButton("✓", "goal.save", () => { const objective = input.value.trim(); if (objective) void updateGoal("edit", goal, { objective }); });
  const cancel = goalButton("×", "goal.cancel", renderGoalBar); input.addEventListener("keydown", (event) => { if (event.key === "Enter") save.click(); else if (event.key === "Escape") renderGoalBar(); });
  bar.append(input, save, cancel); input.focus();
}

async function updateSessionExportAvailability(sessionId) {
  const button = $("session-export"); button.disabled = true;
  try { const response = await fetch(sessionLogExportUrl(sessionId), { method: "HEAD" }); if (state.sessionId === sessionId) button.disabled = !response.ok; } catch {}
}

function downloadSessionLog() {
  if (!state.sessionId || $("session-export").disabled) return;
  const link = document.createElement("a"); link.href = sessionLogExportUrl(state.sessionId); link.download = sessionLogZipFilename(state.sessionId); document.body.append(link); link.click(); link.remove(); setStatus(t("session.exportStarted"));
}

function selectDetailsTab(tab) {
  document.querySelector(".trajectory-inspector")?.remove();
  const trajectory = tab === "trajectory"; $("state-tab").setAttribute("aria-selected", String(!trajectory)); $("trajectory-tab").setAttribute("aria-selected", String(trajectory));
  $("state-cards").hidden = trajectory || !state.sessionId; $("state-empty").hidden = trajectory || Boolean(state.sessionId); $("trajectory-ledger").hidden = !trajectory;
  if (trajectory) void loadTrajectory();
}

async function loadTrajectory(earlier = false) {
  const sessionId = state.sessionId; const ledger = $("trajectory-ledger"); ledger.replaceChildren();
  if (!sessionId) { ledger.textContent = t("state.empty"); return; }
  try {
    const before = earlier ? state.trajectoryBefore : null; const suffix = before === null ? "" : `?before=${before}`;
    const page = await api(`/api/sessions/${encodeURIComponent(sessionId)}/trajectory${suffix}`).then((response) => response.json()); if (state.sessionId !== sessionId) return;
    state.trajectoryRecords = earlier ? [...page.records, ...state.trajectoryRecords] : page.records; state.trajectoryBefore = page.window.nextBefore;
    if (page.window.hasMore) { const more = document.createElement("button"); more.type = "button"; more.className = "trajectory-more"; more.textContent = t("trajectory.loadEarlier"); more.addEventListener("click", () => void loadTrajectory(true)); ledger.append(more); }
    const table = document.createElement("table"); table.setAttribute("aria-label", t("trajectory.title")); const body = document.createElement("tbody");
    for (const record of state.trajectoryRecords) { const row = document.createElement("tr"); row.dataset.kind = trajectoryKind(record.type); if (record.type === "turn/start") row.dataset.turnStart = "true"; const seq = document.createElement("td"); seq.textContent = String(record.seq); const event = document.createElement("td"); const button = document.createElement("button"); button.type = "button"; button.textContent = record.type; button.addEventListener("click", () => inspectTrajectoryRecord(record, trajectoryToolResult(record))); event.append(button); row.append(seq, event); body.append(row); }
    table.append(body); ledger.append(table);
  } catch (error) { ledger.textContent = error.message; }
}

function trajectoryKind(type) { if (type.startsWith("tool/")) return "tool"; if (type.endsWith("/message")) return "message"; if (type.startsWith("turn/")) return "turn"; if (type.startsWith("agent/")) return "agent"; return "event"; }

function trajectoryToolResult(record) {
  if (record.type === "tool/result") return record;
  const callId = record.type === "tool/call" && typeof record.data?.callId === "string" ? record.data.callId : null; if (!callId) return null;
  return state.trajectoryRecords.find((candidate) => candidate.type === "tool/result" && candidate.data?.message?.content?.some?.((block) => block?.toolCallId === callId)) ?? null;
}

function inspectTrajectoryRecord(record, result) {
  document.querySelector(".trajectory-inspector")?.remove(); const inspector = document.createElement("aside"); inspector.className = "trajectory-inspector"; inspector.setAttribute("role", "complementary"); inspector.setAttribute("aria-label", t("trajectory.eventDetails")); const title = document.createElement("h2"); title.textContent = `#${record.seq} ${record.type}`;
  const tabs = document.createElement("div"); tabs.className = "trajectory-inspector-tabs"; tabs.setAttribute("role", "tablist"); const payloadTab = document.createElement("button"); payloadTab.type = "button"; payloadTab.setAttribute("role", "tab"); payloadTab.setAttribute("aria-selected", "true"); payloadTab.textContent = t("trajectory.payload"); const resultTab = document.createElement("button"); resultTab.type = "button"; resultTab.setAttribute("role", "tab"); resultTab.setAttribute("aria-selected", "false"); resultTab.textContent = t("trajectory.result"); resultTab.disabled = result === null;
  const content = document.createElement("pre"); content.setAttribute("role", "tabpanel"); const show = (kind) => { const showingResult = kind === "result" && result !== null; payloadTab.setAttribute("aria-selected", String(!showingResult)); resultTab.setAttribute("aria-selected", String(showingResult)); content.textContent = JSON.stringify(showingResult ? result : record, null, 2); }; payloadTab.addEventListener("click", () => show("payload")); resultTab.addEventListener("click", () => show("result")); show("payload"); tabs.append(payloadTab, resultTab);
  const close = document.createElement("button"); close.type = "button"; close.setAttribute("aria-label", t("trajectory.closeDetails")); close.textContent = "×"; close.addEventListener("click", () => inspector.remove()); inspector.append(title, tabs, content, close); $("session-state").append(inspector);
}

function stateCard(title) { const card = document.createElement("section"); card.className = "state-card"; const heading = document.createElement("h3"); heading.textContent = title; card.append(heading); return card; }
function emptyLine(text) { const node = document.createElement("p"); node.className = "state-muted"; node.textContent = text; return node; }
function listCard(title, values, render, empty) { const card = stateCard(title); if (!Array.isArray(values) || values.length === 0) card.append(emptyLine(empty)); else { const list = document.createElement("div"); list.className = "state-list"; for (const value of values) list.append(render(value)); card.append(list); } return card; }
function stateRow(primary, secondary, status, action) { const row = document.createElement("div"); row.className = "state-row"; const body = document.createElement("div"); const strong = document.createElement("strong"); strong.textContent = primary; const small = document.createElement("span"); small.textContent = secondary; body.append(strong, small); row.append(body); const trailing = document.createElement("div"); trailing.className = "state-row-trailing"; if (status) { const badge = document.createElement("em"); badge.textContent = status; trailing.append(badge); } if (action) trailing.append(action); if (trailing.childNodes.length > 0) row.append(trailing); return row; }
function stateAction(label, path) { const button = document.createElement("button"); button.type = "button"; button.className = "state-action danger"; button.textContent = label; button.addEventListener("click", async () => { button.disabled = true; try { await api(path, { method: "POST" }); await loadSessionState(); } catch (error) { setStatus(error.message, true); button.disabled = false; } }); return button; }
function todoLine(todo) { return stateRow(todo.content, "", todo.status.replace("_", " ")); }
function scheduleLine(schedule) { const action = stateAction("Delete", sessionActionPath("schedules", schedule.id, "delete")); return stateRow(schedule.prompt, new Date(schedule.scheduledAt).toLocaleString(), schedule.kind, action); }
function sessionActionPath(kind, id, action) { return `/api/sessions/${encodeURIComponent(state.sessionId)}/${kind}/${encodeURIComponent(id)}/${action}`; }
function jobLine(job) { const action = ["running", "stopping"].includes(job.status) ? stateAction("Cancel", sessionActionPath("jobs", job.id, "kill")) : undefined; return stateRow(job.label || job.id, `${job.kind} · ${job.id}`, job.status, action); }
function terminalLine(terminal) { const action = terminal.status === "running" ? stateAction("Kill", sessionActionPath("terminals", terminal.id, "kill")) : undefined; return stateRow(terminal.id, `pid ${terminal.pid} · ${terminal.sandbox?.mode || "unconfined"}`, terminal.status, action); }
function goalCard(goal) { const card = stateCard("Goal"); if (!goal) { card.append(emptyLine("No active goal")); return card; } card.append(stateRow(goal.objective, `${goal.roundsStarted}/${goal.maxGoalRounds} rounds · rev ${goal.revision}`, goal.phase)); if (goal.blockedReason) card.append(emptyLine(goal.blockedReason.message)); return card; }
function planCard(plan) { const card = stateCard("Plan mode"); const controls = document.createElement("div"); controls.className = "state-plan"; const target = planModeTarget(plan); const label = document.createElement("span"); label.textContent = target ? "Planning guidance active" : "Default execution mode"; const toggle = document.createElement("button"); toggle.type = "button"; toggle.textContent = target ? "Turn off" : "Turn on"; toggle.disabled = !plan; toggle.addEventListener("click", async () => { try { await setPlanMode(!target); } catch (error) { setStatus(error.message, true); } }); controls.append(label, toggle); card.append(controls); return card; }

function permissionCard(permissions) {
  const card = stateCard("Permissions");
  if (!permissions) { card.append(emptyLine("Permission presets unavailable")); return card; }
  const select = document.createElement("select");
  for (const option of permissions.options) { const node = new Option(option.name, option.value); node.title = option.description || ""; select.append(node); }
  select.value = permissions.currentValue; select.disabled = permissions.currentValue === "custom";
  select.addEventListener("change", async () => {
    const selected = select.value; select.disabled = true;
    if (selected === "danger-full-access" && !(await confirmFullAccess())) { select.value = permissions.currentValue; select.disabled = false; return; }
    try { await api(`/api/sessions/${encodeURIComponent(state.sessionId)}/permissions`, { method: "PUT", body: JSON.stringify({ preset: selected }) }); await loadSessionState(); }
    catch (error) { select.value = permissions.currentValue; setStatus(error.message, true); select.disabled = false; }
  });
  card.append(select); return card;
}

let permissionRiskResolve;
function confirmFullAccess() {
  if (permissionRiskResolve) permissionRiskResolve(false);
  $("permission-risk-ack").checked = false; $("permission-risk-confirm").disabled = true; $("permission-risk-dialog").hidden = false;
  $("permission-risk-ack").focus();
  return new Promise((resolve) => { permissionRiskResolve = resolve; });
}
function settlePermissionRisk(accepted) {
  if (!permissionRiskResolve) return;
  const resolve = permissionRiskResolve; permissionRiskResolve = undefined; $("permission-risk-dialog").hidden = true; resolve(accepted);
}

function agentPresetCard(id) { const preset = state.presets.find((item) => item.id === id); const text = preset ? agentPresetDisplayText(preset, t) : null; const card = stateCard("Agent preset"); card.append(stateRow(text?.name || id || "Unavailable", text?.description || "", id ? "fixed" : "")); return card; }

async function submit(event) {
  event.preventDefault();
  hideInputTriggers();
  if (event.submitter?.id === "submit-run" && event.submitter.dataset.action === "stop") { await cancelRun(); return; }
  const prompt = $("prompt").value.trim();
  if (!prompt && state.pendingAttachments.length === 0) return;
  if (state.running) {
    if (!state.runId) return setStatus(t("status.waitingRun"), true);
    const requestId = crypto.randomUUID();
    try {
      const mode = $("delivery-mode").value;
      const outgoingAttachments = [...state.pendingAttachments];
      const pending = { requestId, sessionId: state.sessionId, placement: mode === "steer" ? "steering" : "queued", message: { content: [...(prompt ? [{ type: "text", text: prompt }] : []), ...outgoingAttachments.map((block) => ({ ...block, type: "seal/attachment" }))] } };
      if (pending) { state.pendingQueueSubmissions.push(pending); state.queueKey = null; renderQueue(state.queueItems); }
      attachmentAdmissionLocked = true; renderAttachmentChips();
      await api(`/api/runs/${encodeURIComponent(state.runId)}/messages`, {
        method: "POST", body: JSON.stringify({ prompt, mode, attachments: outgoingAttachments, requestId }),
      });
      attachmentAdmissionLocked = false; setComposerDraft(""); consumeAttachments(outgoingAttachments);
      // Pending messages remain in the queue dock until PI consumes them.
      // The user_message event inserts the durable message at that boundary.
      scrollTranscriptToBottom();
      setStatus(t(mode === "steer" ? "status.steeringQueued" : "status.followUpQueued"));
      await loadQueue();
    } catch (error) { state.pendingQueueSubmissions = state.pendingQueueSubmissions.filter((item) => item.requestId !== requestId); state.queueKey = null; renderQueue(state.queueItems); attachmentAdmissionLocked = false; renderAttachmentChips(); setStatus(error.message, true); }
    return;
  }
  if (prompt.startsWith("/") && state.pendingAttachments.length === 0) {
    if (!state.sessionId) return setStatus(t("status.openSessionForCommand"), true);
    state.running = true; $("agent-preset").disabled = true; renderPlanControl(); setComposerDraft("");
    try {
      const execution = await (await api(`/api/sessions/${encodeURIComponent(state.sessionId)}/commands`, { method: "POST", body: JSON.stringify({ line: prompt }) })).json();
      appendNotice(execution.result.text || (execution.result.kind === "success" ? "Command completed" : "Command failed"), execution.result.kind === "error");
      setStatus(t(execution.result.kind === "success" ? "status.ready" : "status.commandFailed"), execution.result.kind === "error");
      await loadSessions();
    } catch (error) { setStatus(error.message, true); appendNotice(error.message, true); }
    finally { state.running = false; $("agent-preset").disabled = state.sessionId !== null && state.sessions.find((session) => session.id === state.sessionId)?.blank !== true; renderPlanControl(); renderComposerPrimary(); flushInvalidatedSession(); }
    return;
  }
  const cwd = $("cwd").value.trim();
  if (!cwd) return setStatus(t("status.chooseWorkspace"), true);
  const provider = $("provider").value;
  const model = $("model").value;
  if (!model) return setStatus(t("status.noModel"), true);
  state.running = true; $("agent-preset").disabled = true; renderPlanControl();
  $("delivery-picker").hidden = false;
  renderComposerPrimary();
  document.querySelector(".main")?.setAttribute("data-phase", "active");
  setComposerDraft("");
  $("welcome")?.remove();
  const outgoingAttachments = [...state.pendingAttachments];
  const attachmentAdmission = new AttachmentAdmission(outgoingAttachments, consumeAttachments, restoreAttachments);
  attachmentAdmissionLocked = true; renderAttachmentChips();
  const userBubble = appendBubble("user", prompt); renderMediaBlocks(userBubble.querySelector(".content"), outgoingAttachments, false);
  const assistant = appendBubble("assistant", "");
  scrollTranscriptToBottom();
  setStatus(t("status.running"));
  let runStarted = false;
  const startupController = new AbortController();
  state.startupController = startupController;
  try {
    const response = await api("/api/runs", {
      method: "POST",
      signal: startupController.signal,
      body: JSON.stringify({ startupProgress: true, cwd, provider, model, prompt, attachments: outgoingAttachments, sessionId: state.sessionId, agentPreset: state.sessionId ? undefined : $("agent-preset").value || undefined, reasoning: $("reasoning").value || undefined }),
    });
    await readLines(response.body, (message) => {
      if (!runStarted && message.type === "error") throw new Error(message.error);
      if (message.type === "started") { runStarted = true; state.startupController = null; attachmentAdmissionLocked = false; attachmentAdmission.accepted(); }
      handleStream(message, assistant);
    });
    attachmentAdmissionLocked = false; attachmentAdmission.accepted();
    await loadSessions();
    await loadSessionState();
  } catch (error) {
    if (!runStarted) {
      disposeCopyActions(userBubble); disposeCopyActions(assistant); userBubble.remove(); assistant.remove();
      if (!$("prompt").value) setComposerDraft(prompt);
      attachmentAdmissionLocked = false; attachmentAdmission.failed();
    }
    const stoppedBeforeRun = !runStarted && startupController.signal.aborted;
    if (!stoppedBeforeRun) appendNotice(error.message, true);
    setStatus(stoppedBeforeRun ? (currentLocale === "zh-CN" ? "已停止启动，输入已保留" : "Startup stopped; input retained") : t("status.failed"), !stoppedBeforeRun);
  } finally {
    if (state.startupController === startupController) state.startupController = null;
    attachmentAdmissionLocked = false; state.running = false; $("agent-preset").disabled = state.sessionId !== null && state.sessions.find((session) => session.id === state.sessionId)?.blank !== true; renderPlanControl();
    state.runId = null;
    $("delivery-picker").hidden = true;
    renderComposerPrimary();
    flushInvalidatedSession();
  }
}

let inputTriggerRequest = 0; let inputTriggerIndex = 0; let inputTriggerRange; let inputTriggerDrilled = false;
async function refreshInputTriggers() {
  const prompt = $("prompt"); const hit = detectActiveAtTrigger(prompt.value, prompt.selectionStart);
  if (!hit || !window.SealDshPlugins?.inputTriggerCandidates) return hideInputTriggers();
  const request = ++inputTriggerRequest; const candidates = await window.SealDshPlugins.inputTriggerCandidates(hit.trigger, hit.query, hit.position, hit.quoted, inputTriggerDrilled).catch(() => []);
  if (request !== inputTriggerRequest) return;
  inputTriggerRange = { start: hit.start, end: hit.end, trigger: hit.trigger };
  renderInputTriggers(candidates);
}
function renderInputTriggers(candidates) {
  inputTriggerIndex = 0;
  renderInputTriggerOptions($("input-trigger-menu"), candidates, acceptInputTrigger);
}
function handleInputTriggerKey(event) {
  const menu = $("input-trigger-menu"); if (menu.hidden) return;
  const options = [...menu.querySelectorAll(".input-trigger-option")];
  const selectedCandidate = options[inputTriggerIndex]?.dataset.candidate ? JSON.parse(options[inputTriggerIndex].dataset.candidate) : undefined;
  const action = inputTriggerKeyAction(event.key, selectedCandidate);
  if (action === "dismiss") { event.preventDefault(); hideInputTriggers(); return; }
  if (action === "next" || action === "previous") { event.preventDefault(); inputTriggerIndex = (inputTriggerIndex + (action === "next" ? 1 : -1) + options.length) % options.length; const selected = syncInputTriggerSelection(menu, inputTriggerIndex); selected?.scrollIntoView({ block: "nearest" }); return; }
  if ((action === "accept" || action === "drill") && !event.shiftKey && selectedCandidate) { event.preventDefault(); void acceptInputTrigger(selectedCandidate, action === "drill" ? "drill" : "pick"); }
}
function handleComposerSubmitKey(event) {
  if (event.defaultPrevented || event.key !== "Enter" || event.shiftKey || event.isComposing || event.repeat) return;
  event.preventDefault();
  const accelerated = event.ctrlKey || event.metaKey;
  if (queueMutable(state.sessionId, state.sessions) && shouldSteerQueueOnAcceleratedEnter({ draft: $("prompt").value, attachmentCount: state.pendingAttachments.length, running: state.running, items: state.queueItems, accelerated })) {
    void steerQueuedMessages();
    return;
  }
  if (state.running) {
    const preferred = state.busyEnter === "steer" ? "steer" : "followUp";
    $("delivery-mode").value = accelerated ? (preferred === "steer" ? "followUp" : "steer") : preferred;
  }
  $("composer").requestSubmit();
}
async function acceptInputTrigger(candidate, action = "pick") {
  if (!inputTriggerRange) return; const prompt = $("prompt"); const range = { ...inputTriggerRange };
  const outcome = await window.SealDshPlugins?.pickInputTrigger?.(candidate, action).catch(() => undefined);
  if (!inputTriggerRange || inputTriggerRange.start !== range.start || inputTriggerRange.end !== range.end) return;
  const replacement = outcome?.insert?.clipboardText ?? outcome?.text ?? `${range.trigger}${candidate.name}`;
  const insertion = `${replacement}${outcome?.continue === true ? "" : " "}`;
  prompt.setRangeText(insertion, range.start, range.end, "end"); persistComposerDraft();
  if (outcome?.continue === true) { inputTriggerDrilled = true; void refreshInputTriggers(); } else hideInputTriggers();
  prompt.focus();
}
function hideInputTriggers() { inputTriggerRequest += 1; inputTriggerRange = undefined; inputTriggerDrilled = false; $("input-trigger-menu").hidden = true; $("input-trigger-menu").replaceChildren(); $("prompt").removeAttribute("aria-activedescendant"); }

async function uploadAttachments(event) {
  const files = [...event.target.files]; event.target.value = "";
  await uploadFiles(files, true);
}
async function uploadFiles(files, imagesOnly = false) {
  if (attachmentAdmissionLocked) { setStatus(t("status.waitAdmission"), true); return; }
  const supportedImageTypes = ["image/png", "image/jpeg", "image/webp", "image/gif"];
  const imageFiles = files.filter((file) => supportedImageTypes.includes(file.type));
  const existingImages = state.pendingAttachments.filter((block) => /^image\//i.test(block.mimeType || ""));
  const issue = imageAdmissionIssue(existingImages, imagesOnly ? files : imageFiles, { mediaTypes: supportedImageTypes, maxImagesPerMessage: 20, maxImageBytes: 20 * 1024 * 1024, maxMessageImageBytes: 200 * 1024 * 1024 });
  if (issue?.kind === "unsupported") { setStatus(t("image.unsupportedNamed").replace("{name}", files.find((file) => !supportedImageTypes.includes(file.type))?.name ?? t("image.label")), true); return; }
  if (issue?.kind === "too-many") { setStatus(t("image.tooMany").replace("{count}", String(issue.count)), true); return; }
  if (issue?.kind === "file-too-large") { setStatus(t("image.fileTooLarge").replace("{size}", "20 MiB"), true); return; }
  if (issue?.kind === "total-too-large") { setStatus(t("image.totalTooLarge").replace("{size}", "200 MiB"), true); return; }
  for (const file of files) {
    try {
      setStatus(t("status.uploading").replace("{name}", file.name));
      const dataUrl = await new Promise((resolvePromise, reject) => { const reader = new FileReader(); reader.onload = () => resolvePromise(String(reader.result)); reader.onerror = () => reject(reader.error); reader.readAsDataURL(file); });
      const data = dataUrl.slice(dataUrl.indexOf(",") + 1);
      const block = await (await api("/api/attachments", { method: "POST", body: JSON.stringify({ name: file.name, mimeType: file.type || "application/octet-stream", data }) })).json();
      state.pendingAttachments.push(block); renderAttachmentChips(); setStatus(t("status.attachmentReady"));
    } catch (error) { const mapped = imageUploadError(error); setStatus(mapped ? Object.entries(mapped.values ?? {}).reduce((text, [key, value]) => text.replace(`{${key}}`, value), t(mapped.key)) : error.message, true); }
  }
}

function renderAttachmentChips() {
  attachmentDrafts.update(state.sessionId, state.pendingAttachments);
  renderPlanControl();
  renderComposerPrimary();
  const container = $("attachment-chips"); currentAttachmentRail?.dispose?.(); currentAttachmentRail = null; container.replaceChildren(); container.hidden = state.pendingAttachments.length === 0;
  const images = state.pendingAttachments.map((block, index) => ({ block, index })).filter(({ block }) => /^image\/(?:png|jpeg|gif|webp)$/i.test(block.mimeType || ""));
  const grew = renderedAttachmentCount !== null && state.pendingAttachments.length > renderedAttachmentCount; renderedAttachmentCount = state.pendingAttachments.length;
  if (images.length) { currentAttachmentRail = createAttachmentRail(images.map(({ block, index }) => { const query = new URLSearchParams(); if (block.name) query.set("name", block.name); if (block.mimeType) query.set("mimeType", block.mimeType); return { index, name: block.name || block.id, src: `/api/attachments/${encodeURIComponent(block.id)}?${query}` }; }), { locked: attachmentAdmissionLocked, revealEnd: grew, labels: { group: t("image.pending"), open: t("image.openOriginal"), openNamed: (name) => t("image.openOriginalLabel").replace("{label}", name), removeNamed: (name) => t("image.remove").replace("{name}", name), scrollLeft: t("image.scrollLeft"), scrollRight: t("image.scrollRight"), lightbox: { dialog: t("image.preview"), close: t("image.closePreview") } }, onRemove: ({ index }) => { if (attachmentAdmissionLocked) return; state.pendingAttachments.splice(index, 1); renderAttachmentChips(); } }); container.append(currentAttachmentRail); }
  state.pendingAttachments.forEach((block, index) => {
    if (/^image\/(?:png|jpeg|gif|webp)$/i.test(block.mimeType || "")) return;
    const chip = document.createElement("span"); chip.textContent = block.name || block.id;
    const remove = document.createElement("button"); remove.type = "button"; remove.textContent = "×"; remove.setAttribute("aria-label", `Remove ${block.name || "attachment"}`);
    remove.disabled = attachmentAdmissionLocked;
    remove.addEventListener("click", () => { state.pendingAttachments.splice(index, 1); renderAttachmentChips(); });
    chip.append(remove); container.append(chip);
  });
}

function consumeAttachments(consumed) {
  attachmentDrafts.removeEverywhere(consumed);
  state.pendingAttachments = state.pendingAttachments.filter((block) => !consumed.includes(block));
  renderAttachmentChips();
}

function restoreAttachments(restored) {
  const present = new Set(state.pendingAttachments.map((block) => block.id));
  state.pendingAttachments = [...restored.filter((block) => !present.has(block.id)), ...state.pendingAttachments];
  renderAttachmentChips();
}

function flushInvalidatedSession() {
  if (state.sessionInvalidated && state.sessionId) { state.sessionInvalidated = false; void refreshOpenSession(state.sessionId); }
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
  let sequence = streamSequences.get(assistant);
  if (!sequence) { sequence = createStreamSequence(assistant, () => appendBubble("assistant", "")); streamSequences.set(assistant, sequence); }
  // Once live events arrive, the saved page is no longer a complete snapshot.
  // Keep local older rows available, but never rebuild from stale tail data.
  historyCanTrim = false;
  if (message.type === "startup_activity" && message.activity === "compaction") {
    const active = message.state === "started";
    assistant.dataset.startupActivity = active ? "compacting" : "preparing";
    setStatus(currentLocale === "zh-CN" ? (active ? "正在压缩上下文" : "准备模型请求") : (active ? "Compacting context" : "Preparing request"));
  } else if (message.type === "started") {
    delete assistant.dataset.startupActivity;
    state.runId = message.runId;
    renderComposerPrimary();
    if (state.sessionId !== message.sessionId) attachmentDrafts.adopt(state.sessionId, message.sessionId, state.pendingAttachments);
    state.sessionId = message.sessionId;
    window.dispatchEvent(new CustomEvent("seal-harness:session-selected", { detail: { sessionId: message.sessionId } }));
    $("session-title").textContent = message.sessionId;
  } else if (message.type === "event") {
    delete assistant.dataset.startupActivity;
    const event = message.event;
    let structureChanged = false;
    if (event.type === "user_message" && !sequence.claimUser(event.message.id)) return;
    if (event.type === "turn_start") sequence.start(event.turnId);
    assistant = sequence.accept(event.type);
    if (event.type === "compaction_activity") {
      const active = event.state === "started";
      sequence.track(assistant); assistant.dataset.activityPhase = active ? "compacting" : "preparing"; structureChanged = true;
      setStatus(currentLocale === "zh-CN"
        ? (active ? "正在压缩上下文" : event.outcome === "failed" ? "上下文压缩失败" : event.outcome === "aborted" ? "已停止压缩" : "准备模型请求")
        : (active ? "Compacting context" : event.outcome === "failed" ? "Context compaction failed" : event.outcome === "aborted" ? "Compaction stopped" : "Preparing request"));
    }
    else if (event.type === "runtime_activity") {
      if (event.phase === "preparing" || event.phase === "waiting-model") {
        sequence.track(assistant); assistant.dataset.activityPhase = event.phase === "preparing" ? "preparing" : "waiting"; structureChanged = true;
        setStatus(currentLocale === "zh-CN" ? (event.phase === "preparing" ? "准备模型请求" : "等待模型") : (event.phase === "preparing" ? "Preparing request" : "Waiting for model"));
      }
    }
    else if (event.type === "request_header") {
      sequence.track(assistant); if (assistant.dataset.activityPhase !== "preparing") assistant.dataset.activityPhase = "waiting"; structureChanged = true;
    }
    else if (event.type === "user_message") {
      renderAnchoredMessage({ ...event.message, messageId: event.message.id });
      structureChanged = true;
    }
    else if (event.type === "text_delta") {
      assistant.dataset.activityPhase = "writing";
      structureChanged = assistant.dataset.reply !== "true";
      sequence.track(assistant); assistant.dataset.reply = "true";
      const content = assistant.querySelector(".content");
      content.dataset.source = (content.dataset.source || "") + event.delta;
      disposeCopyActions(content); content.innerHTML = renderMarkdown(content.dataset.source);
      localizeCodeCopyButtons(content);
    }
    else if (event.type === "reasoning_delta") {
      assistant.dataset.activityPhase = "thinking";
      structureChanged = !assistant.querySelector(".reasoning");
      sequence.track(assistant); appendReasoningDelta(assistant, event.delta); setStatus(t("status.reasoning"));
    }
    else if (event.type === "tool_call") {
      structureChanged = true;
      const fragment = document.createDocumentFragment(); const card = appendToolCall(event.call, fragment);
      if (card?.dataset) card.dataset.toolCallCount = "1";
      for (const node of [...fragment.childNodes]) { sequence.track(node); appendTranscriptNode(node); }
    }
    else if (event.type === "tool_result") { appendToolResult(event); structureChanged = true; }
    else if (event.type === "tool_progress") {
      liveToolViews.get(event.callId)?.native?.progress(event.content);
      setStatus(t("status.toolRunning"));
    }
    else if (event.type === "turn_end") { sequence.finish(event.turnId); structureChanged = true; }
    if (structureChanged) applyTranscriptView();
    else updateTranscriptActivity($("transcript"), currentLocale);
    if (state.transcriptFollowing) scrollTranscriptToBottom();
  } else if (message.type === "completed") {
    delete assistant.dataset.startupActivity;
    sequence.finish(); applyTranscriptView();
    for (const item of sequence.assistants) { const reasoning = item.querySelector(".reasoning"); if (reasoning) reasoning.open = false; }
    setStatus(t(message.stopReason === "error" ? "status.failed" : message.stopReason === "aborted" ? "status.stopped" : "status.ready"), message.stopReason === "error");
    if (message.stopReason === "aborted") appendNotice(t("status.stopped"));
    if (message.errorMessage) appendNotice(message.errorMessage, true);
  } else if (message.type === "error") {
    delete assistant.dataset.startupActivity;
    sequence.finish(); applyTranscriptView();
    appendNotice(message.error, true);
    setStatus(t("status.failed"), true);
  }
}

async function cancelRun() {
  if (!state.runId) { state.startupController?.abort(); return; }
  await api(`/api/runs/${encodeURIComponent(state.runId)}`, { method: "DELETE" }).catch((error) => setStatus(error.message, true));
}

async function saveKey() {
  try {
    await api(`/api/credentials/${encodeURIComponent($("provider").value)}`, {
      method: "PUT", body: JSON.stringify({ apiKey: $("api-key").value }),
    });
    $("api-key").value = "";
    await refreshCredentialStatus(); setStatus(t("status.apiKeyStored"));
  } catch (error) { setStatus(error.message, true); }
}

async function clearKey() {
  try { await api(`/api/credentials/${encodeURIComponent($("provider").value)}`, { method: "PUT", body: JSON.stringify({ apiKey: "" }) }); await refreshCredentialStatus(); setStatus(t("status.apiKeyCleared")); }
  catch (error) { setStatus(error instanceof Error ? error.message : String(error), true); }
}

async function discoverCustomProvider(event) {
  event.preventDefault();
  const status = $("custom-provider-status");
  status.textContent = t("status.discoveringModels");
  try {
    const response = await api("/api/providers/discover", {
      method: "POST",
      body: JSON.stringify({
        id: $("custom-provider-id").value,
        name: $("custom-provider-name").value || undefined,
        baseUrl: $("custom-provider-url").value,
        api: $("custom-provider-api").value,
        apiKey: $("custom-provider-key").value || undefined,
      }),
    });
    const result = await response.json();
    state.models = await (await api("/api/models")).json();
    localStorage.setItem("seal-harness.provider", result.provider);
    updateProviders();
    $("provider").value = result.provider;
    updateModels();
    $("custom-provider-key").value = "";
    status.textContent = t("models.addedCount").replace("{count}", result.models.length);
  } catch (error) {
    status.textContent = error.message;
  }
}

async function loadApprovals() {
  if (document.hidden) return;
  try {
    const [values, questions] = await Promise.all([
      api("/api/approvals").then((response) => response.json()),
      api("/api/questions").then((response) => response.json()),
    ]);
    const matched = selectPendingInteraction(values, questions, state.sessionId, state.running); const key = matched ? `${matched.kind}:${matched.value.id}` : null;
    if (state.pendingInteractionKey === key) return;
    state.pendingInteractionKey = key;
    const container = $("approvals"); container.replaceChildren(); container.hidden = matched === undefined;
    $("composer").hidden = matched !== undefined;
    document.querySelector(".main")?.toggleAttribute("data-composer-takeover", matched !== undefined);
    if (matched?.kind === "approval") container.append(approvalCard(matched.value));
    else if (matched?.kind === "question") container.append(questionCard(matched.value));
  } catch {}
}

async function loadQueue() {
  const sessionId = state.sessionId;
  if (document.hidden || !sessionId) { renderQueue([]); return; }
  try {
    const items = await api(`/api/sessions/${encodeURIComponent(sessionId)}/queue`).then((response) => response.json());
    if (state.sessionId === sessionId) renderQueue(items);
  } catch {}
}

function renderQueue(items) {
  state.queueItems = [...items];
  renderPlanControl();
  const queue = queueDockItems(items);
  const pending = pendingQueueItems(queue, state.pendingQueueSubmissions, state.sessionId);
  const pendingIds = new Set(pending.map((item) => item.requestId));
  state.pendingQueueSubmissions = state.pendingQueueSubmissions.filter((item) => item.sessionId !== state.sessionId || pendingIds.has(item.requestId));
  const visibleItems = [...queue, ...pending.map((item) => ({ ...item, id: `pending:${item.requestId}`, pending: true }))];
  const container = $("queue-dock"); const key = queueSnapshotKey(visibleItems);
  if (state.queueKey === key) return;
  state.queueKey = key; container.replaceChildren(); container.hidden = visibleItems.length === 0;
  if (visibleItems.length === 0) return;
  if (visibleItems.length > 1) {
    const toggle = document.createElement("button"); toggle.type = "button"; toggle.className = "queue-toggle";
    toggle.setAttribute("aria-controls", "queue-list"); toggle.setAttribute("aria-expanded", String(state.queueExpanded));
    const lead = document.createElement("span"); lead.className = "queue-lead"; lead.textContent = "◷"; lead.setAttribute("aria-hidden", "true");
    const count = document.createElement("span"); count.className = "queue-count"; count.textContent = t("queue.count").replace("{n}", String(visibleItems.length));
    const chevron = document.createElement("span"); chevron.className = "queue-chevron"; chevron.textContent = state.queueExpanded ? "⌄" : "⌃"; chevron.setAttribute("aria-hidden", "true");
    toggle.append(lead, count, chevron);
    toggle.addEventListener("click", () => { state.queueExpanded = !state.queueExpanded; state.queueKey = null; renderQueue(items); }); container.append(toggle);
  }
  const list = document.createElement("ul"); list.id = "queue-list"; list.hidden = visibleItems.length > 1 && !state.queueExpanded;
  for (const item of visibleItems) list.append(queueRow(item, visibleItems.length === 1));
  container.append(list);
}

function queueRow(item, single = false) {
  const row = document.createElement("li"); row.className = "queue-row"; row.dataset.queueItemId = item.id;
  if (item.placement === "steering") { const label = document.createElement("small"); label.textContent = t("composer.steering"); row.append(label); }
  if (single) { const lead = document.createElement("span"); lead.className = "queue-lead"; lead.textContent = "◷"; lead.setAttribute("aria-hidden", "true"); row.append(lead); }
  const images = queueImageRefs(item);
  if (images.length > 0) {
    const thumbs = document.createElement("span"); thumbs.className = "queue-thumbs";
    for (const image of images) {
      const thumb = document.createElement("img"); thumb.className = "queue-thumb"; thumb.src = queueImageUrl(image, state.sessionId, item.pending); thumb.alt = t("queue.image"); thumb.loading = "lazy"; thumbs.append(thumb);
    }
    row.append(thumbs);
  }
  const content = document.createElement("span"); content.className = "queue-content"; content.textContent = queueItemPreview(item) || t("queue.attachment");
  if (item.pending) { row.dataset.submissionEcho = ""; row.append(content); return row; }
  if (!queueMutable(state.sessionId, state.sessions)) { row.append(content); return row; }
  const actions = document.createElement("span"); actions.className = "queue-actions";
  const editableText = queueEditableText(item);
  const edit = queueButton(t("queue.edit"), () => beginQueueEdit(row, item, editableText)); edit.disabled = editableText === null; if (editableText === null) edit.title = t("queue.editUnsupported");
  const remove = queueButton(t("queue.remove"), () => updateQueue(item.id, { kind: "remove" }, row, [], true, t("queue.removeFailed")));
  actions.append(edit, remove);
  if (canSteerQueueItem(item, state.running)) actions.append(queueButton(t("queue.steer"), () => updateQueue(item.id, { kind: "steer" }, row, [], true, t("queue.steerFailed"))));
  row.append(content, actions); return row;
}

function queueButton(label, action) { const button = document.createElement("button"); button.type = "button"; button.textContent = label; button.addEventListener("click", () => void action()); return button; }

function beginQueueEdit(row, item, editableText = queueEditableText(item)) {
  if (editableText === null) return;
  row.querySelector(".queue-thumbs")?.toggleAttribute("hidden", true);
  const list = row.closest("ul"); if (list) list.hidden = false;
  const toggle = $("queue-dock").querySelector(".queue-toggle"); if (toggle) toggle.disabled = true;
  const input = document.createElement("input"); input.type = "text"; input.className = "queue-edit"; input.setAttribute("aria-label", t("queue.edit")); input.value = editableText;
  const save = async () => { const value = input.value.trim(); if (!value) return; await updateQueue(item.id, { kind: "edit", content: [{ type: "text", text: input.value }] }, row, [], true, t("queue.editFailed")); };
  const cancel = () => { state.queueKey = null; void loadQueue(); };
  input.addEventListener("keydown", (event) => { if (event.key === "Escape") cancel(); else if (event.key === "Enter" && !event.isComposing) { event.preventDefault(); void save(); } });
  row.querySelector(".queue-content").replaceWith(input); input.focus(); input.select();
  const actions = row.querySelector(".queue-actions"); actions.replaceChildren();
  const saveButton = queueButton(t("queue.save"), save); saveButton.disabled = input.value.trim() === "";
  const cancelButton = queueButton(t("queue.cancelEdit"), cancel);
  input.addEventListener("input", () => { saveButton.disabled = input.value.trim() === ""; });
  actions.append(saveButton, cancelButton);
}

function setQueueInteractionLocked(locked) {
  for (const button of $("queue-dock").querySelectorAll("button")) {
    if (locked) { button.dataset.queueWasDisabled = String(button.disabled); button.disabled = true; }
    else { button.disabled = button.dataset.queueWasDisabled === "true"; delete button.dataset.queueWasDisabled; }
  }
}

async function updateQueue(itemId, action, row, silentCodes = [], reportError = true, failureMessage) {
  setQueueInteractionLocked(true);
  try { await api("/api/dsh/session/update-queue", { method: "POST", body: JSON.stringify({ sessionId: state.sessionId, itemId, action }) }); state.queueKey = null; await loadQueue(); return "updated"; }
  catch (error) {
    setQueueInteractionLocked(false);
    if (silentCodes.includes(error.code)) return "converged";
    if (reportError) setStatus(failureMessage ?? error.message, true);
    return "failed";
  }
}

async function steerQueuedMessages() {
  if (!queueMutable(state.sessionId, state.sessions)) return;
  const queued = state.queueItems.filter((item) => item.placement === "queued");
  for (const item of queued) {
    const outcome = await updateQueue(item.id, { kind: "steer" }, undefined, ["session/steer-unavailable", "session/queue-item-not-found"], false);
    if (outcome === "updated") continue;
    if (outcome === "failed") setStatus(t("queue.steerFailed"), true);
    return;
  }
}

function approvalCard(approval) {
  const card = document.createElement("div"); card.className = "approval"; card.dataset.approvalKey = approval.id;
  const text = document.createElement("div");
  const title = document.createElement("strong"); title.textContent = approval.title;
  const message = document.createElement("span"); message.textContent = approval.message; text.append(title, message);
  if (approval.details?.kind === "plan-review" && typeof approval.details.plan === "string") { card.classList.add("plan-review"); const plan = document.createElement("pre"); plan.textContent = approval.details.plan; text.append(plan); }
  const actions = document.createElement("div"); const deny = document.createElement("button"); deny.textContent = approval.details?.kind === "plan-review" ? "Keep planning" : "Reject";
  const allow = document.createElement("button"); allow.textContent = approval.details?.kind === "plan-review" ? "Approve" : "Allow once"; allow.className = "primary";
  const decide = async (approved) => { deny.disabled = true; allow.disabled = true; try { await decideApproval(approval.id, approved); } catch (error) { deny.disabled = false; allow.disabled = false; setStatus(error.message, true); } };
  deny.addEventListener("click", () => void decide(false)); allow.addEventListener("click", () => void decide(true));
  actions.append(deny, allow); card.append(text, actions); return card;
}

function questionCard(request) {
  const card = document.createElement("form"); card.className = "approval question-request";
  const body = document.createElement("div");
  const title = document.createElement("strong"); title.dataset.i18n = "ask.title"; title.textContent = t("ask.title"); body.append(title);
  for (const question of request.questions) {
    const field = document.createElement("fieldset"); field.dataset.questionId = question.id;
    const legend = document.createElement("legend"); legend.textContent = question.header || question.question; field.append(legend);
    if (question.header) { const prompt = document.createElement("p"); prompt.textContent = question.question; field.append(prompt); }
    if (question.detail) { const detail = document.createElement("pre"); detail.textContent = question.detail; field.append(detail); }
    for (const option of question.options || []) {
      const label = document.createElement("label"); const input = document.createElement("input");
      input.type = question.multiSelect ? "checkbox" : "radio"; input.name = `question-${request.id}-${question.id}`; input.value = option.label;
      const optionText = document.createElement("span"); optionText.textContent = option.description ? `${option.label} — ${option.description}` : option.label;
      label.append(input, optionText); field.append(label);
    }
    const custom = document.createElement("input"); custom.type = "text"; custom.placeholder = "Other (optional)"; custom.dataset.customAnswer = question.id; field.append(custom); body.append(field);
  }
  const actions = document.createElement("div"); const submit = document.createElement("button"); submit.type = "submit"; submit.className = "primary"; submit.dataset.i18n = "ask.submit"; submit.textContent = t("ask.submit"); actions.append(submit); card.append(body, actions);
  card.addEventListener("submit", async (event) => { event.preventDefault(); submit.disabled = true; const answers = request.questions.map((question) => { const selected = [...card.querySelectorAll(`fieldset[data-question-id="${CSS.escape(question.id)}"] input:checked`)].map((input) => input.value); const custom = card.querySelector(`input[data-custom-answer="${CSS.escape(question.id)}"]`).value.trim(); return { id: question.id, selected, ...(custom ? { custom } : {}) }; }); try { await api(`/api/questions/${encodeURIComponent(request.id)}`, { method: "POST", body: JSON.stringify({ answers }) }); await loadApprovals(); } catch (error) { submit.disabled = false; setStatus(error.message, true); } });
  return card;
}

async function decideApproval(id, approved) {
  await api(`/api/approvals/${encodeURIComponent(id)}`, { method: "POST", body: JSON.stringify({ approved }) });
  state.pendingInteractionKey = null;
  await loadApprovals();
}

function appendTranscriptNode(node) {
  if (!renderingHistory) historyCanTrim = false;
  const transcript = $("transcript");
  localizeCodeCopyButtons(node);
  transcript.insertBefore(node, $("turn-navigator-slot")?.parentElement === transcript ? $("turn-navigator-slot") : null);
}

function updateMessageActionVisibility() {
  const messages = [...$("transcript").querySelectorAll(".message.user, .message.assistant")];
  const modes = messageActionRevealModes(messages.map((message) => message.classList.contains("user") ? "user" : "assistant"));
  messages.forEach((message, index) => { message.dataset.actionsReveal = modes[index]; });
}

function renderHistoryMessages(messages, anchor) {
  renderingHistory = true;
  try {
    for (const message of messages) {
      const transcript = $("transcript");
      const existing = anchor ? new Set(transcript.children) : null;
      renderAnchoredMessage(message);
      if (anchor) for (const node of [...transcript.children]) {
        if (!existing.has(node)) transcript.insertBefore(node, anchor);
      }
    }
  } finally { renderingHistory = false; }
}

function renderAnchoredMessage(message) {
  const node = renderMessage(message); const key = transcriptAnchorKey(message);
  if (node && key !== null) node.dataset.chatAnchorKey = key;
  return node;
}

function renderMessage(message) {
  if (message.role === "command") return renderCommandMessage(message);
  if (message.role === "compaction") return renderCompactionMessage(message);
  if (message.role === "model-retry") return renderModelRetryMessage(message);
  if (message.role === "system-prompt") return renderSystemPromptMessage(message);
  if (message.role === "turn-error") return renderTurnErrorMessage(message);
  if (message.role === "turn-max-tokens") return renderTurnMaxTokensMessage(message);
  if (message.role === "turn-tail") return renderTurnTailMessage(message);
  if (message.role === "unknown-surface") return renderUnknownSurfaceMessage(message);
  if (message.role === "workflow-run") return renderWorkflowRunMessage(message);
  const context = message.role === "user" ? contextMessageModel(message.source) : null;
  if (context) {
    const item = document.createElement("details"); item.className = "context-message"; item.dataset.form = context.form;
    const summary = document.createElement("summary"); const label = document.createElement("strong"); label.dataset.i18n = "message.context"; label.textContent = t("message.context"); const account = document.createElement("span"); account.textContent = context.summary || context.provenance; summary.append(label, account);
    const provenance = document.createElement("div"); provenance.className = "context-provenance"; provenance.textContent = context.provenance;
    const content = document.createElement("div"); content.className = "context-content"; renderContextBody(content, context, message); item.append(summary, provenance, content); attachTurnMetadata(item, message); appendTranscriptNode(item); return item;
  }
  if (message.role === "user" || message.role === "assistant") {
    const item = appendBubble(message.role, blocksText(message.content), message.messageId, message.time);
    if (message.messageKind === "steering") item.dataset.messageKind = "steering";
    if (message.role === "user" && message.referenceLabels?.length) {
      const summary = document.createElement("div"); summary.className = "message-reference-summary";
      summary.textContent = `${currentLocale === "zh-CN" ? "引用会话" : "Referenced session"} · ${message.referenceLabels.join(currentLocale === "zh-CN" ? "、" : ", ")}`;
      item.querySelector(".content")?.after(summary);
    }
    attachTurnMetadata(item, message);
    if (message.role === "assistant" && message.interrupted) {
      const stopped = document.createElement("span"); stopped.className = "assistant-interrupted"; stopped.textContent = currentLocale === "zh-CN" ? "已停止" : "Stopped"; item.querySelector(".content")?.after(stopped);
    }
    if (message.role === "assistant" && message.turnCompleted) {
      const available = Number.isSafeInteger(message.atSeq); const fork = document.createElement("button"); fork.type = "button"; fork.dataset.branchAction = ""; fork.dataset.branchUnavailable = String(!available); fork.replaceChildren(branchActionIcon()); labelBranchButton(fork, !available);
      const actionRow = item.querySelector(".message-actions");
      if (!available) { const reason = document.createElement("span"); reason.id = `branch-unavailable-${++branchReasonSequence}`; reason.className = "visually-hidden"; reason.dataset.i18n = "message.forkUnavailable"; reason.textContent = t("message.forkUnavailable"); fork.setAttribute("aria-describedby", reason.id); insertBeforeAssistantClock(actionRow, fork, reason); }
      else { fork.addEventListener("click", () => void forkSession(state.sessionId, message.atSeq, fork)); insertBeforeAssistantClock(actionRow, fork); }
      if (message.producedFiles?.length) appendProducedFiles(item, message.producedFiles);
      appendTurnMetrics(item, message);
    }
    if (message.role === "assistant" && blocksText(message.content).trim()) item.dataset.reply = "true";
    if (message.role === "assistant") {
      item.dataset.toolCallCount = "0"; item.dataset.subagentCount = "0";
    }
    renderMediaBlocks(item.querySelector(".content"), message.content);
    if (message.role === "assistant") {
      const reasoning = (message.content ?? []).filter((block) => block.type === "reasoning").map((block) => block.text).join("\n");
      if (reasoning) renderReasoning(item, reasoning, false);
      for (const block of message.content ?? []) if (block.type === "tool_call") {
        const fragment = document.createDocumentFragment();
        const card = appendToolCall(block, fragment);
        if (card?.dataset) {
          const subagent = block.name === "subagent" || block.name?.startsWith("subagent_");
          card.dataset.toolCallCount = subagent ? "0" : "1";
          card.dataset.subagentCount = subagent ? "1" : "0";
        }
        for (const node of [...fragment.childNodes]) { attachTurnMetadata(node, message); appendTranscriptNode(node); }
      }
    }
    return item;
  }
  if (message.role === "tool") {
    const item = appendToolResult({ callId: message.callId, name: message.name, result: { content: message.content, isError: message.isError, error: message.toolError, meta: message.toolMeta ?? message.providerData } });
    attachTurnMetadata(item, message); return item;
  }
}

function renderSystemPromptMessage(message) {
  const item = document.createElement("details"); item.className = "system-prompt-message";
  const summary = document.createElement("summary"); summary.textContent = currentLocale === "zh-CN" ? "系统提示词" : "System prompt";
  const body = document.createElement("pre"); body.textContent = message.text; item.append(summary, body); appendTranscriptNode(item); return item;
}

function renderCompactionMessage(message) {
  const item = document.createElement("details"); item.className = "compaction-message";
  const summary = document.createElement("summary"); const icon = document.createElement("span"); icon.className = "compaction-icon"; icon.textContent = "◇"; icon.setAttribute("aria-hidden", "true");
  const title = document.createElement("strong"); title.textContent = currentLocale === "zh-CN" ? "上下文已压缩" : "Context compacted";
  const account = document.createElement("span");
  account.textContent = message.shadowedItemCount !== null && message.shadowedTokenCount !== null
    ? (currentLocale === "zh-CN" ? `折叠 ${message.shadowedItemCount} 项 · ${message.shadowedTokenCount} tokens` : `${message.shadowedItemCount} items · ${message.shadowedTokenCount} tokens`)
    : message.shadowedItemCount !== null
      ? (currentLocale === "zh-CN" ? `折叠 ${message.shadowedItemCount} 项` : `${message.shadowedItemCount} items compacted`)
      : (message.summary === null ? (currentLocale === "zh-CN" ? "摘要不可用" : "Summary unavailable") : (currentLocale === "zh-CN" ? "展开摘要" : "Expand summary"));
  summary.append(icon, title, account); item.append(summary);
  if (message.summary === null) item.addEventListener("toggle", () => { if (item.open) item.open = false; });
  else { const body = document.createElement("div"); body.className = "compaction-body"; body.innerHTML = renderMarkdown(message.summary); item.append(body); }
  appendTranscriptNode(item); return item;
}

function renderModelRetryMessage(message) {
  const item = document.createElement("details"); item.className = "model-retry-message"; item.dataset.state = message.retryState;
  const summary = document.createElement("summary"); const status = document.createElement("span"); status.setAttribute("role", "status"); summary.append(status); item.append(summary);
  const maximum = message.mode === "normal" ? message.maxRetries : "∞"; const scheduledSeconds = Math.max(1, Math.ceil(message.delayMs / 1000));
  const label = message.retryState === "scheduled" ? (currentLocale === "zh-CN" ? "正在重试模型请求" : "Retrying model request") : message.retryState === "started" ? (currentLocale === "zh-CN" ? "已重试模型请求" : "Retried model request") : (currentLocale === "zh-CN" ? "模型请求重试已取消" : "Model request retry cancelled");
  const writeStatus = (seconds) => { status.textContent = currentLocale === "zh-CN" ? `${label}（${message.retry}/${maximum}） · ${seconds}s` : `${label} (${message.retry}/${maximum}) · ${seconds}s`; };
  writeStatus(scheduledSeconds);
  if (message.retryState === "scheduled" && scheduledSeconds > 1) { const deadline = Date.now() + message.delayMs; const timer = setInterval(() => { const seconds = Math.max(1, Math.ceil((deadline - Date.now()) / 1000)); writeStatus(seconds); if (seconds === 1 || !document.contains(item)) clearInterval(timer); }, 250); }
  const details = document.createElement("div"); details.className = "model-retry-details"; const delay = document.createElement("div"); delay.textContent = `${currentLocale === "zh-CN" ? "重试延迟" : "Retry delay"}: ${Math.round(message.delayMs)}ms`; const failure = document.createElement("div"); failure.textContent = `${currentLocale === "zh-CN" ? "失败原因" : "Failure reason"}: ${message.failure.code === "AUTH" ? (currentLocale === "zh-CN" ? "认证失败" : "Authentication failed") : message.failure.message}`; details.append(delay, failure); item.append(details); appendTranscriptNode(item); return item;
}

function renderTurnErrorMessage(message) {
  const item = document.createElement("div"); item.className = "turn-error-message"; item.setAttribute("role", "alert");
  const title = document.createElement("strong"); title.textContent = currentLocale === "zh-CN" ? "运行失败" : "Run failed";
  const detail = document.createElement("span"); detail.textContent = message.code === "AUTH" ? (currentLocale === "zh-CN" ? "认证失败" : "Authentication failed") : message.message; item.append(title, detail);
  if (message.code) { const code = document.createElement("code"); code.textContent = message.code; item.append(code); }
  appendTranscriptNode(item); return item;
}

function renderTurnMaxTokensMessage(message) {
  const item = document.createElement("div"); item.className = "turn-max-tokens-message"; item.setAttribute("role", "status");
  const dot = document.createElement("span"); dot.className = "turn-max-tokens-dot"; dot.setAttribute("aria-hidden", "true");
  const copy = document.createElement("div"); const title = document.createElement("strong"); title.textContent = currentLocale === "zh-CN" ? "已达到最大输出长度" : "Maximum output length reached";
  const hint = document.createElement("span"); hint.textContent = t("turn.maxTokens"); copy.append(title, hint); item.append(dot, copy);
  if (message.producedFiles?.length) appendProducedFiles(item, message.producedFiles); appendTurnMetrics(item, message); appendTranscriptNode(item); return item;
}

function renderTurnTailMessage(message) {
  const item = document.createElement("div"); item.className = "turn-tail-message"; item.dataset.turnId = message.turnId; item.dataset.turnCompleted = "true";
  if (message.producedFiles?.length) appendProducedFiles(item, message.producedFiles); appendTurnMetrics(item, message); appendTranscriptNode(item); return item;
}

function renderUnknownSurfaceMessage(message) {
  const item = document.createElement("details"); item.className = "unknown-surface-message";
  const summary = document.createElement("summary"); summary.textContent = currentLocale === "zh-CN" ? `未知会话事件：${message.type}` : `Unknown session event: ${message.type}`;
  const serialized = JSON.stringify(message.data, null, 2) ?? "null"; const limit = 50_000; const body = document.createElement("pre");
  body.textContent = serialized.length <= limit ? serialized : `${serialized.slice(0, limit)}\n… ${currentLocale === "zh-CN" ? `已截断 ${serialized.length - limit} 个字符` : `${serialized.length - limit} characters truncated`}`;
  item.append(summary, body); appendTranscriptNode(item); return item;
}

function renderWorkflowRunMessage(message) {
  const item = document.createElement("details"); item.className = "workflow-run-message"; item.dataset.state = message.status; item.open = message.status === "running" || message.status === "failed";
  const summary = document.createElement("summary"); const title = document.createElement("strong"); title.textContent = message.name || (currentLocale === "zh-CN" ? "工作流" : "Workflow");
  const count = message.phases.reduce((total, phase) => total + phase.members.length, 0); const statusLabels = currentLocale === "zh-CN" ? { running: "运行中", completed: "已完成", failed: "失败", cancelled: "已取消", interrupted: "已中断" } : { running: "Running", completed: "Completed", failed: "Failed", cancelled: "Cancelled", interrupted: "Interrupted" };
  const stateLabel = document.createElement("span"); stateLabel.textContent = `${statusLabels[message.status] ?? message.status} · ${count}`; summary.append(title, stateLabel); item.append(summary);
  const phases = document.createElement("div"); phases.className = "workflow-phases";
  for (const phase of message.phases) { const section = document.createElement("details"); section.open = phase.members.some((member) => member.status === "running" || member.status === "failed"); const heading = document.createElement("summary"); heading.textContent = phase.phase === null ? (currentLocale === "zh-CN" ? "未分组" : "Ungrouped") : phase.phase; section.append(heading); const members = document.createElement("div");
    for (const member of phase.members) { const row = document.createElement("button"); row.type = "button"; row.className = "workflow-member"; row.dataset.state = member.status; row.textContent = `${member.label} · ${statusLabels[member.status] ?? member.status}`; row.addEventListener("click", () => void openSession(member.childSessionId)); members.append(row); }
    section.append(members); phases.append(section); }
  if (message.phases.length === 0) { const empty = document.createElement("span"); empty.className = "workflow-empty"; empty.textContent = currentLocale === "zh-CN" ? "尚无已启动成员" : "No members started"; phases.append(empty); }
  item.append(phases); appendTranscriptNode(item); return item;
}

function renderCommandMessage(message) {
  if (message.name === "compact" && message.compaction) return renderManualCompactionMessage(message);
  const item = document.createElement("details"); item.className = "command-message"; item.dataset.state = message.outcome?.kind ?? "running";
  const summary = document.createElement("summary"); const name = document.createElement("strong"); name.textContent = message.name || (currentLocale === "zh-CN" ? "指令" : "Command");
  const status = document.createElement("span"); status.textContent = message.outcome === null ? (currentLocale === "zh-CN" ? "执行中…" : "Running…") : message.outcome.text?.split("\n", 1)[0] || (message.outcome.kind === "error" ? (currentLocale === "zh-CN" ? "指令失败" : "Command failed") : (currentLocale === "zh-CN" ? "已完成" : "Completed"));
  summary.append(name, status); item.append(summary);
  const bodyText = message.outcome?.text?.includes("\n") ? message.outcome.text : message.args;
  if (bodyText) { const body = document.createElement("pre"); body.textContent = bodyText; item.append(body); } else item.addEventListener("toggle", () => { if (item.open) item.open = false; });
  appendTranscriptNode(item); return item;
}

function renderManualCompactionMessage(message) {
  const item = document.createElement("details"); item.className = "compaction-message manual-compaction-message"; item.dataset.state = message.outcome?.kind ?? "running";
  const summary = document.createElement("summary"); const icon = document.createElement("span"); icon.className = "compaction-icon"; icon.textContent = "◇"; icon.setAttribute("aria-hidden", "true");
  const title = document.createElement("strong"); title.textContent = "/compact"; const account = document.createElement("span");
  const compacted = message.compaction; account.textContent = compacted.shadowedItemCount !== null && compacted.shadowedTokenCount !== null
    ? (currentLocale === "zh-CN" ? `折叠 ${compacted.shadowedItemCount} 项 · ${compacted.shadowedTokenCount} tokens` : `${compacted.shadowedItemCount} items · ${compacted.shadowedTokenCount} tokens`)
    : message.outcome?.text || (message.outcome === null ? (currentLocale === "zh-CN" ? "执行中…" : "Running…") : (currentLocale === "zh-CN" ? "上下文已压缩" : "Context compacted"));
  summary.append(icon, title, account); item.append(summary);
  if (compacted.summary !== null) { const body = document.createElement("div"); body.className = "compaction-body"; body.innerHTML = renderMarkdown(compacted.summary); item.append(body); }
  else if (message.args) { const body = document.createElement("pre"); body.textContent = message.args; item.append(body); }
  else item.addEventListener("toggle", () => { if (item.open) item.open = false; });
  appendTranscriptNode(item); return item;
}

function renderContextBody(container, context, message) {
  const structured = context.structured;
  if (!structured) { container.textContent = blocksText(message.content); renderMediaBlocks(container, message.content); return; }
  if (structured.kind === "instructions") {
    const list = document.createElement("ul"); list.className = "context-records"; for (const change of structured.changes) { const row = document.createElement("li"); row.title = change.digest || ""; const path = document.createElement("code"); path.textContent = change.path; const action = document.createElement("span"); action.textContent = change.action === "remove" ? "Removed" : structured.baseline && change.action === "set" ? "Loaded" : "Updated"; row.append(path, action); list.append(row); } container.append(list, document.createTextNode(blocksText(message.content))); return;
  }
  if (structured.kind === "catalog") {
    if (structured.update) { const notice = document.createElement("p"); notice.textContent = t("message.contextCatalogReplaced"); container.append(notice); }
    const list = document.createElement("ul"); list.className = "context-records"; for (const entry of structured.entries) { const row = document.createElement("li"); const name = document.createElement("code"); name.textContent = entry.name; const desc = document.createElement("span"); desc.textContent = entry.description; row.append(name, desc); list.append(row); } container.append(list); if (structured.omitted) { const more = document.createElement("p"); more.textContent = `${structured.omitted} more entries`; container.append(more); } return;
  }
  if (structured.kind === "snapshot") {
    const notice = document.createElement("p"); notice.textContent = t("message.contextSnapshotSupersedes"); const list = document.createElement("dl"); list.className = "context-sections"; for (const section of structured.sections) { const name = document.createElement("dt"); name.textContent = section.name; const value = document.createElement("dd"); value.textContent = section.text; list.append(name, value); } container.append(notice, list); return;
  }
  const list = document.createElement("ul"); list.className = "context-records"; for (const reference of structured.references) { const row = document.createElement("li"); const name = document.createElement("code"); name.textContent = reference.label; const completeness = document.createElement("span"); completeness.textContent = `${reference.retained} retained · ${reference.omitted} omitted${reference.truncated ? " · truncated" : ""}`; row.append(name, completeness); list.append(row); } container.append(list, document.createTextNode(blocksText(message.content))); renderMediaBlocks(container, message.content);
}


function appendProducedFiles(item, paths) {
  const block = document.createElement("section"); block.className = "produced-files"; block.setAttribute("aria-label", t("deliverables.title"));
  const title = document.createElement("strong"); title.textContent = t("deliverables.title"); const list = document.createElement("div");
  for (const path of paths) { const group = document.createElement("span"); group.className = "produced-file"; const chip = document.createElement("button"); chip.type = "button"; chip.textContent = path; chip.title = t("deliverables.open"); chip.addEventListener("click", () => void requestOpenFile(path)); const mention = document.createElement("button"); mention.type = "button"; mention.className = "produced-file-mention"; mention.textContent = "@"; mention.title = t("deliverables.mention"); mention.setAttribute("aria-label", t("deliverables.mention")); mention.addEventListener("click", () => { const prefix = $("prompt").value.trimEnd(); setComposerDraft(`${prefix}${prefix ? " " : ""}@${path} `); $("prompt").focus(); }); group.append(chip, mention); list.append(group); }
  block.append(title, list); item.append(block);
}

async function requestOpenFile(path) {
  const id = ++fileOpenRequest; fileOpenBusy = true; renderFileOpenError();
  try {
    await api("/api/dsh/session/open-workspace-path", { method: "POST", body: JSON.stringify({ path }) });
    if (id !== fileOpenRequest) return; fileOpenError = null; fileOpenBusy = false; renderFileOpenError();
  } catch (error) {
    if (id !== fileOpenRequest) return;
    fileOpenError = { path, message: openFailureMessage(error, t(isFolderOpenPath(path) ? "fileOpen.folderUnknown" : "fileOpen.unknown")) };
    fileOpenBusy = false; renderFileOpenError();
  }
}

function closeFileOpenError() { fileOpenRequest += 1; fileOpenError = null; fileOpenBusy = false; renderFileOpenError(); }

function renderFileOpenError() {
  const dialog = $("file-open-dialog");
  if (fileOpenError === null) { dialog.hidden = true; return; }
  $("file-open-title").textContent = t(isFolderOpenPath(fileOpenError.path) ? "fileOpen.folderTitle" : "fileOpen.title");
  $("file-open-message").textContent = fileOpenError.message;
  $("file-open-retry").disabled = fileOpenBusy; dialog.hidden = false;
}

function appendTurnMetrics(item, message) {
  const actionRow = item.querySelector(".message-actions");
  const tail = actionRow ?? document.createElement("div");
  if (!actionRow) tail.className = "turn-tail";
  const appendMetric = (metric) => {
    if (!actionRow) { tail.append(metric); return; }
    metric.dataset.dismissiblePopover = ""; metric.dataset.popoverSide = "top"; metric.dataset.popoverGap = "8";
    const trigger = metric.querySelector(":scope > summary");
    trigger?.setAttribute("aria-haspopup", "dialog"); trigger?.setAttribute("aria-expanded", "false");
    insertBeforeAssistantClock(actionRow, metric);
  };
  if (message.turnUsage) {
    const usage = message.turnUsage; const total = Number.isSafeInteger(usage.totalTokens) ? usage.totalTokens : (usage.inputTokens || 0) + (usage.outputTokens || 0) + (usage.cacheReadTokens || 0) + (usage.cacheWriteTokens || 0);
    const details = document.createElement("details"); details.className = "turn-metric";
    const summary = document.createElement("summary"); const label = document.createElement("span"); label.className = "turn-metric-label"; label.textContent = `${t("turn.usage")} ${formatTokens(total)}`; summary.append(turnMetricIcon("usage"), label);
    const body = document.createElement("dl"); body.setAttribute("aria-label", t("turn.usageTitle"));
    const appendUsageFact = (name, value, extra) => { const dt = document.createElement("dt"); dt.textContent = name; const dd = document.createElement("dd"); dd.textContent = value; if (extra) { const detail = document.createElement("span"); detail.className = "turn-metric-reasoning"; detail.textContent = extra; dd.append(detail); } body.append(dt, dd); };
    const routes = Array.isArray(usage.routes) ? usage.routes.filter((route) => route && typeof route.provider === "string" && typeof route.model === "string").map((route) => `${route.provider}/${route.model}`) : [];
    if (routes.length > 0) appendUsageFact(t("turn.model"), routes.join(", "));
    else if (message.turnModel) appendUsageFact(t("turn.model"), `${message.turnModel.provider}/${message.turnModel.model}`);
    const promptTokens = promptTokensForUsage(usage); const cacheHit = usage.cacheReadTokens === undefined ? null : formatCacheHitPercent(usage.cacheReadTokens, promptTokens, 1);
    if (cacheHit !== null) appendUsageFact(t("turn.cacheHit"), `${cacheHit}%`);
    appendUsageFact(t("turn.input"), formatExactTokens(usage.inputTokens || 0));
    if (usage.cacheReadTokens !== undefined) appendUsageFact(t("turn.cacheRead"), formatExactTokens(usage.cacheReadTokens));
    if (usage.cacheWriteTokens !== undefined) appendUsageFact(t("turn.cacheWrite"), formatExactTokens(usage.cacheWriteTokens));
    appendUsageFact(t("turn.output"), formatExactTokens(usage.outputTokens || 0), usage.reasoningTokens === undefined ? undefined : t("turn.reasoning").replace("{tokens}", formatExactTokens(usage.reasoningTokens)));
    details.append(summary, turnMetricPanel("usage", t("turn.usageTitle"), body, formatExactTokens(total))); appendMetric(details);
  }
  if (Number.isFinite(message.turnDurationMs)) {
    const duration = formatRunDuration(message.turnDurationMs);
    const time = document.createElement("details"); time.className = "turn-metric turn-duration"; const summary = document.createElement("summary"); const label = document.createElement("span"); label.className = "turn-metric-label"; label.textContent = `${t("turn.ranFor")} ${duration}`; summary.append(turnMetricIcon("time"), label);
    const body = document.createElement("dl"); body.setAttribute("aria-label", t("turn.timeTitle"));
    const appendFact = (label, value) => { const dt = document.createElement("dt"); dt.textContent = label; const dd = document.createElement("dd"); dd.textContent = value; body.append(dt, dd); };
    appendFact(t("turn.duration"), duration);
    if (Number.isFinite(message.turnDecodeTokensPerSecond)) appendFact(t("turn.decoding"), `${formatTokensPerSecond(message.turnDecodeTokensPerSecond)} tok/s`);
    if (Number.isFinite(message.turnFirstTokenMs)) appendFact(t("turn.ttft"), `${formatLatencySeconds(message.turnFirstTokenMs)}s`);
    time.append(summary, turnMetricPanel("time", t("turn.timeTitle"), body));
    appendMetric(time);
  }
  if (!actionRow && tail.childElementCount) item.append(tail);
}

function formatExactTokens(value) { return formatExactTokenCount(value, t("number.groupSeparator")); }

function turnMetricPanel(kind, titleText, body, titleValue) {
  const panel = document.createElement("div"); panel.className = "turn-metric-panel"; panel.setAttribute("role", "dialog"); panel.setAttribute("aria-label", titleText);
  const title = document.createElement("div"); title.className = "turn-metric-title";
  const label = document.createElement("span"); label.className = "turn-metric-title-label"; label.append(turnMetricIcon(kind), document.createTextNode(titleText)); title.append(label);
  if (titleValue !== undefined) { const value = document.createElement("span"); value.className = "turn-metric-title-value"; value.textContent = titleValue; title.append(value); }
  const rule = document.createElement("div"); rule.className = "turn-metric-rule"; rule.setAttribute("aria-hidden", "true"); panel.append(title, rule, body); return panel;
}

function turnMetricIcon(kind) {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg"); svg.setAttribute("viewBox", "0 0 16 16"); svg.setAttribute("width", "16"); svg.setAttribute("height", "16"); svg.setAttribute("fill", "none"); svg.setAttribute("aria-hidden", "true");
  if (kind === "usage") {
    const top = document.createElementNS(svg.namespaceURI, "ellipse"); top.setAttribute("cx", "8"); top.setAttribute("cy", "3.6"); top.setAttribute("rx", "5.75"); top.setAttribute("ry", "2.4"); top.setAttribute("stroke", "currentColor"); top.setAttribute("stroke-width", "1.25");
    const side = document.createElementNS(svg.namespaceURI, "path"); side.setAttribute("d", "M2.25 3.6V12.3A5.75 2.4 0 0 0 13.75 12.3V3.6"); side.setAttribute("stroke", "currentColor"); side.setAttribute("stroke-width", "1.25");
    const tier = document.createElementNS(svg.namespaceURI, "path"); tier.setAttribute("d", "M2.25 7.95A5.75 2.4 0 0 0 13.75 7.95"); tier.setAttribute("stroke", "currentColor"); tier.setAttribute("stroke-width", "1.25"); svg.append(top, side, tier);
  } else {
    const dial = document.createElementNS(svg.namespaceURI, "circle"); dial.setAttribute("cx", "8"); dial.setAttribute("cy", "8"); dial.setAttribute("r", "6.375"); dial.setAttribute("stroke", "currentColor"); dial.setAttribute("stroke-width", "1.25");
    const hands = document.createElementNS(svg.namespaceURI, "path"); hands.setAttribute("d", "M8 4.4V8.3L10.7 9.85"); hands.setAttribute("stroke", "currentColor"); hands.setAttribute("stroke-width", "1.25"); svg.append(dial, hands);
  }
  return svg;
}

async function forkSession(sessionId, atSeq, trigger) {
  trigger.disabled = true;
  try {
    const created = await (await api(`/api/sessions/${encodeURIComponent(sessionId)}/fork`, { method: "POST", body: JSON.stringify(atSeq === undefined ? {} : { atSeq }) })).json();
    await loadSessions();
    if (!state.running) await openSession(created.sessionId); else setStatus(t("session.forkCreated"));
  } catch (error) { trigger.disabled = false; setStatus(error.message, true); }
}

function attachTurnMetadata(item, message) {
  if (!item || !message.turnId) return;
  item.dataset.turnId = message.turnId;
  if (Number.isSafeInteger(message.turnNumber)) item.dataset.turnNumber = String(message.turnNumber);
  item.dataset.turnCompleted = String(message.turnCompleted === true);
}

function updateActiveTurn() {
  const transcript = $("transcript");
  const rows = [...transcript.querySelectorAll("[data-turn-number]")].map((node) => ({ turn: Number(node.dataset.turnNumber), top: node.getBoundingClientRect().top }));
  const next = activeTurnFromGeometry(rows, transcript.getBoundingClientRect().top);
  if (next !== state.activeTurn) { state.activeTurn = next; renderTurnNavigator(); }
}

function renderTurnNavigator() {
  const nav = $("turn-navigator"); if (!nav) return;
  nav.replaceChildren(); nav.hidden = state.turnOutline.length < 2;
  nav.style.setProperty("--turn-natural-height", `${Math.max(0, state.turnOutline.length - 1) * 10 + 12}px`);
  nav.setAttribute("aria-label", t("turn.navigation"));
  for (const item of state.turnOutline) {
    const button = document.createElement("button"); button.type = "button"; button.className = "turn-mark"; button.title = [item.prompt || t("turn.number").replace("{turn}", item.turn), item.response].filter(Boolean).join("\n");
    const loaded = document.querySelector(`[data-turn-id="${CSS.escape(item.turnId)}"]`) !== null;
    button.setAttribute("aria-label", t(loaded ? "turn.jump" : "turn.jumpLoad").replace("{turn}", item.turn));
    if (!loaded) button.classList.add("unloaded");
    if (item.turn === state.activeTurn) button.setAttribute("aria-current", "true");
    if (item.turn === state.busyTurn) button.setAttribute("aria-busy", "true");
    button.addEventListener("click", () => void navigateToTurn(item)); nav.append(button);
  }
}

async function navigateToTurn(item) {
  state.busyTurn = item.turn; renderTurnNavigator();
  try {
    let node = document.querySelector(`[data-turn-id="${CSS.escape(item.turnId)}"]`);
    while (!node && (state.messageBefore !== null || historyWindow?.hidden)) { const before = state.messageBefore; const hidden = historyWindow?.hidden; await loadEarlierMessages(HISTORY_JUMP_MESSAGES); node = document.querySelector(`[data-turn-id="${CSS.escape(item.turnId)}"]`); if (!node && state.messageBefore === before && historyWindow?.hidden === hidden) break; }
    node?.scrollIntoView({ block: "start", behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
  } finally { state.busyTurn = null; renderTurnNavigator(); }
}

function applyTranscriptView() {
  const transcript = $("transcript"); if (!transcript) return;
  projectTranscriptView(transcript, state.transcriptView, (messages, tools, subagents) => {
    const labels = [];
    if (tools > 0) labels.push(t("transcript.processTools").replace("{count}", String(tools)));
    if (messages > 0) labels.push(t("transcript.processMessages").replace("{count}", String(messages)));
    if (subagents > 0) labels.push(t("transcript.processSubagents").replace("{count}", String(subagents)));
    return labels.length === 0 ? t("transcript.processThought") : labels.join(t("transcript.processSeparator"));
  }, currentLocale);
}

function blocksText(content = []) { return content.filter((block) => block.type === "text").map((block) => block.text).join("\n"); }
function renderReasoning(item, value, open) {
  let details = item.querySelector(".reasoning");
  if (!details) {
    details = document.createElement("details"); details.className = "reasoning"; details.open = open;
    const summary = document.createElement("summary"); summary.dataset.i18n = "message.reasoning"; summary.textContent = t("message.reasoning");
    const content = document.createElement("div"); content.className = "reasoning-content"; details.append(summary, content);
    item.insertBefore(details, item.querySelector(".content"));
  }
  const content = details.querySelector(".reasoning-content"); content.dataset.source = value; disposeCopyActions(content); content.innerHTML = renderMarkdown(value); localizeCodeCopyButtons(content); return details;
}
function appendReasoningDelta(item, delta) {
  const current = item.querySelector(".reasoning-content")?.dataset.source ?? "";
  renderReasoning(item, current + delta, true);
}
function renderMediaBlocks(container, blocks = [], sessionScoped = true) {
  const images = [];
  for (const block of blocks) {
    if (block.type === "image" && typeof block.data === "string" && /^image\/(?:png|jpeg|gif|webp)$/i.test(block.mimeType || "")) {
      images.push({ src: `data:${block.mimeType};base64,${block.data}`, alt: block.name || t("image.label"), width: block.width, height: block.height });
    } else if (block.type === "attachment" && typeof block.id === "string") {
      const query = new URLSearchParams(); if (block.name) query.set("name", block.name); if (block.mimeType) query.set("mimeType", block.mimeType);
      const prefix = sessionScoped && state.sessionId
        ? `/api/sessions/${encodeURIComponent(state.sessionId)}/attachment-content/${encodeURIComponent(block.id)}`
        : `/api/attachments/${encodeURIComponent(block.id)}`;
      const href = `${prefix}${query.size ? `?${query}` : ""}`;
      if (/^image\/(?:png|jpeg|gif|webp)$/i.test(block.mimeType || "")) images.push({ src: href, alt: block.name || t("image.label"), width: block.width, height: block.height });
      else { const link = document.createElement("a"); link.className = "message-attachment"; link.textContent = block.name || block.id; link.href = href; link.download = block.name || "attachment"; container.append(link); }
    }
  }
  const gallery = createMessageImageGallery(images, { image: t("image.label"), open: t("image.openOriginal"), openNamed: (label) => t("image.openOriginalLabel").replace("{label}", label), loading: t("image.loading"), loadFailed: t("image.loadFailed"), lightbox: { dialog: t("image.preview"), close: t("image.closePreview") } }); if (gallery) container.prepend(gallery);
}
function appendBubble(role, value, messageId, time) {
  const item = document.createElement("article"); item.className = `message ${role}`; item.dataset.chatFlow = "";
  const label = document.createElement("div"); label.className = "label"; if (role === "user") { label.dataset.i18n = "message.you"; label.textContent = t("message.you"); } else label.textContent = "Seal Harness";
  const content = document.createElement(role === "assistant" ? "div" : "pre"); content.className = "content";
  if (role === "assistant") { content.dataset.source = value; content.innerHTML = renderMarkdown(value); }
  else content.textContent = value;
  item.append(label, content);
  const actions = messageActions(role, content, time); item.append(actions);
  if (role === "assistant" && messageId) insertBeforeAssistantClock(actions, feedbackControls(messageId));
  appendTranscriptNode(item); updateMessageActionVisibility(); return item;
}
function messageActions(role, content, time) {
  const actions = document.createElement("div"); actions.className = "message-actions";
  const clock = Number.isFinite(time) ? document.createElement("time") : null;
  if (clock) { clock.className = "message-clock"; clock.dateTime = new Date(time).toISOString(); clock.textContent = formatMessageClock(time, currentLocale); }
  if (role === "user" && clock) actions.append(clock);
  const source = () => content.dataset.source ?? content.textContent ?? "";
  const copy = document.createElement("button"); copy.type = "button"; labelCopyButton(copy, false);
  copy.addEventListener("click", () => void copyActionFor(copy).activate(source())); actions.append(copy);
  if (role === "user") { const reuse = document.createElement("button"); reuse.type = "button"; reuse.textContent = t("message.useAgain"); reuse.title = t("message.useAgain"); reuse.setAttribute("aria-label", t("message.useAgain")); reuse.addEventListener("click", () => { setComposerDraft(source()); $("prompt").focus(); }); actions.append(reuse); }
  if (role !== "user" && clock) actions.append(clock);
  return actions;
}
function insertBeforeAssistantClock(actions, ...nodes) {
  if (!actions) return;
  const clock = actions.querySelector(".message-clock");
  for (const node of nodes) actions.insertBefore(node, clock);
}
async function copyText(value) {
  if (navigator.clipboard?.writeText && window.isSecureContext) { await navigator.clipboard.writeText(value); return; }
  const input = document.createElement("textarea"); input.value = value; input.style.position = "fixed"; input.style.opacity = "0"; document.body.append(input);
  try { input.select(); if (!document.execCommand("copy")) throw new Error(t("message.copyFailed")); }
  finally { input.remove(); }
}
function labelCopyButton(button, copied) {
  button.dataset.copyAction = "";
  const label = t(copied ? "message.copied" : "message.copy"); button.replaceChildren(copyActionIcon(copied)); button.title = label; button.setAttribute("aria-label", label);
  if (copied) button.setAttribute("aria-disabled", "true"); else button.removeAttribute("aria-disabled");
}
function copyActionIcon(copied) {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg"); svg.setAttribute("viewBox", "0 0 16 16"); svg.setAttribute("width", "16"); svg.setAttribute("height", "16"); svg.setAttribute("fill", "none"); svg.setAttribute("aria-hidden", "true");
  const path = document.createElementNS(svg.namespaceURI, "path"); path.setAttribute("fill", "currentColor");
  path.setAttribute("d", copied
    ? "M15.0498 3.92579L8.49512 12.3818C8.25774 12.6881 8.04517 12.9645 7.84668 13.1689C7.63957 13.3823 7.38732 13.5841 7.04492 13.6719C6.86373 13.7183 6.6757 13.7346 6.48926 13.7197C6.13666 13.6915 5.8528 13.5355 5.6123 13.3604C5.38201 13.1926 5.12573 12.9567 4.83984 12.6953L1.03125 9.21289L1.96875 8.1875L5.77734 11.6699C6.08684 11.9529 6.27773 12.1249 6.43066 12.2363C6.50183 12.2882 6.54699 12.3135 6.57324 12.3252C6.58525 12.3305 6.59269 12.3322 6.5957 12.333C6.59802 12.3336 6.59961 12.334 6.59961 12.334C6.63317 12.3367 6.66758 12.3335 6.7002 12.3252C6.7002 12.3252 6.70211 12.3251 6.7041 12.3242C6.70698 12.3229 6.71348 12.319 6.72461 12.3115C6.74849 12.2956 6.78843 12.2642 6.84961 12.2012C6.98138 12.0654 7.13957 11.8628 7.39648 11.5313L13.9502 3.07422L15.0498 3.92579Z"
    : "M6.14929 4.02032C7.11197 4.02032 7.87983 4.02016 8.49597 4.07598C9.12128 4.13269 9.65792 4.25188 10.1415 4.53106C10.7202 4.8653 11.2008 5.3459 11.535 5.92462C11.8142 6.40818 11.9334 6.94481 11.9901 7.57012C12.0459 8.18625 12.0458 8.95419 12.0458 9.9168C12.0458 10.8795 12.0459 11.6473 11.9901 12.2635C11.9334 12.8888 11.8142 13.4254 11.535 13.909C11.2008 14.4877 10.7202 14.9683 10.1415 15.3025C9.65792 15.5817 9.12128 15.7009 8.49597 15.7576C7.87984 15.8134 7.11196 15.8133 6.14929 15.8133C5.18667 15.8133 4.41874 15.8134 3.80261 15.7576C3.1773 15.7009 2.64067 15.5817 2.1571 15.3025C1.5784 14.9683 1.09778 14.4877 0.76355 13.909C0.484366 13.4254 0.365184 12.8888 0.308472 12.2635C0.252649 11.6473 0.252808 10.8795 0.252808 9.9168C0.252808 8.95418 0.252664 8.18625 0.308472 7.57012C0.365184 6.94481 0.484366 6.40818 0.76355 5.92462C1.09777 5.34589 1.57839 4.86529 2.1571 4.53106C2.64067 4.25188 3.1773 4.13269 3.80261 4.07598C4.41874 4.02017 5.18666 4.02032 6.14929 4.02032ZM6.14929 5.37774C5.16181 5.37774 4.46634 5.37761 3.92566 5.42657C3.39434 5.47472 3.07859 5.56574 2.83582 5.70587C2.4632 5.92106 2.15354 6.2307 1.93835 6.60333C1.79823 6.8461 1.70721 7.16185 1.65906 7.69317C1.6101 8.23385 1.61023 8.92933 1.61023 9.9168C1.61023 10.9043 1.61009 11.5998 1.65906 12.1404C1.70721 12.6717 1.79823 12.9875 1.93835 13.2303C2.15356 13.6029 2.46321 13.9126 2.83582 14.1277C3.07859 14.2679 3.39434 14.3589 3.92566 14.407C4.46634 14.456 5.16182 14.4559 6.14929 14.4559C7.13682 14.4559 7.83224 14.456 8.37292 14.407C8.90425 14.3589 9.21999 14.2679 9.46277 14.1277C9.83535 13.9126 10.145 13.6029 10.3602 13.2303C10.5004 12.9875 10.5914 12.6717 10.6395 12.1404C10.6885 11.5998 10.6884 10.9043 10.6884 9.9168C10.6884 8.92934 10.6885 8.23384 10.6395 7.69317C10.5914 7.16185 10.5004 6.8461 10.3602 6.60333C10.1451 6.23071 9.83536 5.92107 9.46277 5.70587C9.21999 5.56574 8.90424 5.47472 8.37292 5.42657C7.83224 5.3776 7.13682 5.37774 6.14929 5.37774ZM9.80164 0.367975C10.7638 0.367975 11.5314 0.36788 12.1473 0.423639C12.7726 0.480307 13.3093 0.598759 13.7928 0.877741C14.3717 1.21192 14.8521 1.69355 15.1864 2.27227C15.4655 2.75574 15.5857 3.29164 15.6425 3.9168C15.6983 4.53301 15.6971 5.3016 15.6971 6.26446V7.82989C15.6971 8.29264 15.6989 8.58993 15.6649 8.84844C15.4668 10.3525 14.401 11.5738 12.9833 11.9988V10.5467C13.6973 10.1903 14.2105 9.49662 14.3192 8.67169C14.3387 8.52347 14.3407 8.3358 14.3407 7.82989V6.26446C14.3407 5.27706 14.3398 4.58149 14.2909 4.04083C14.2428 3.50968 14.1526 3.19372 14.0126 2.95098C13.7974 2.57849 13.4876 2.26869 13.1151 2.05352C12.8724 1.91347 12.5564 1.82237 12.0253 1.77423C11.4847 1.72528 10.7888 1.7254 9.80164 1.7254H7.71472C6.7562 1.72558 5.92665 2.27697 5.52332 3.07891H4.07019C4.54221 1.51132 5.9932 0.368186 7.71472 0.367975H9.80164Z");
  svg.append(path); return svg;
}
function branchActionIcon() {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg"); svg.setAttribute("viewBox", "0 0 16 16"); svg.setAttribute("width", "16"); svg.setAttribute("height", "16"); svg.setAttribute("fill", "none"); svg.setAttribute("aria-hidden", "true");
  const path = document.createElementNS(svg.namespaceURI, "path"); path.setAttribute("fill", "currentColor"); path.setAttribute("fill-rule", "evenodd"); path.setAttribute("clip-rule", "evenodd"); path.setAttribute("d", "M13.0762 1.37207C14.0846 1.37228 14.9021 2.19077 14.9023 3.19922C14.9022 4.20772 14.0847 5.02518 13.0762 5.02539C12.2967 5.02539 11.6325 4.53691 11.3701 3.84961H4.35547C4.79397 4.26458 5.15861 4.7644 5.41699 5.33496L7.10645 9.06738C7.88526 10.7875 9.55104 11.9228 11.4189 12.0371C11.7085 11.4109 12.3411 10.9756 13.0762 10.9756C14.0843 10.9759 14.9023 11.7936 14.9023 12.8018C14.9023 13.81 14.0843 14.6277 13.0762 14.6279C12.2534 14.6279 11.5574 14.0832 11.3291 13.335C8.9868 13.1879 6.89981 11.7612 5.92285 9.60352L4.23242 5.87109C3.67503 4.64033 2.44878 3.84961 1.09766 3.84961V2.54883C1.10665 2.54883 1.11601 2.54975 1.125 2.5498L11.3701 2.54883C11.6326 1.86151 12.2969 1.37207 13.0762 1.37207ZM13.0762 12.2764C12.7858 12.2764 12.5508 12.5114 12.5508 12.8018C12.5508 13.0921 12.7858 13.3281 13.0762 13.3281C13.3664 13.3279 13.6025 13.092 13.6025 12.8018C13.6025 12.5115 13.3664 12.2766 13.0762 12.2764ZM13.0762 2.67285C12.7855 2.67285 12.55 2.90861 12.5498 3.19922C12.5499 3.48987 12.7855 3.72559 13.0762 3.72559C13.3667 3.72538 13.6024 3.48975 13.6025 3.19922C13.6023 2.90874 13.3666 2.67306 13.0762 2.67285Z"); svg.append(path); return svg;
}
function labelBranchButton(button, unavailable) {
  button.title = t(unavailable ? "message.forkUnavailable" : "message.forkHere"); button.setAttribute("aria-label", t("message.forkHere"));
  if (unavailable) { button.setAttribute("aria-disabled", "true"); button.dataset.unavailable = ""; } else { button.removeAttribute("aria-disabled"); delete button.dataset.unavailable; }
}
function localizeCodeCopyButtons(root) {
  for (const button of root.matches?.(".copy-code") ? [root] : root.querySelectorAll?.(".copy-code") ?? []) labelCopyButton(button, false);
}
function disposeCopyActions(root) {
  for (const button of root.matches?.("[data-copy-action]") ? [root] : root.querySelectorAll?.("[data-copy-action]") ?? []) {
    copyButtonActions.get(button)?.dispose(); copyButtonActions.delete(button);
  }
}
function copyActionFor(button) {
  let action = copyButtonActions.get(button);
  if (!action) {
    action = createCopyAction({ write: copyText, copied: () => labelCopyButton(button, true), reset: () => labelCopyButton(button, false), failed: () => setStatus(t("message.copyFailed"), true) });
    copyButtonActions.set(button, action);
  }
  return action;
}
function feedbackControls(messageId) {
  const controls = document.createElement("div"); controls.className = "message-feedback"; controls.dataset.dismissiblePopoverRoot = "";
  const ratingButtons = []; let noteButton = null;
  const mutation = createMutationGate((pending) => { for (const candidate of ratingButtons) candidate.disabled = pending; if (noteButton) noteButton.disabled = pending; });
  for (const rating of ["up", "down"]) {
    const button = document.createElement("button"); button.type = "button"; const ratingLabel = rating === "up" ? t("feedback.useful") : t("feedback.notUseful"); button.title = ratingLabel; button.setAttribute("aria-label", ratingLabel); button.replaceChildren(feedbackActionIcon(rating)); ratingButtons.push(button);
    if (state.feedback.get(messageId)?.rating === rating) { button.classList.add("active"); button.setAttribute("aria-pressed", "true"); } else button.setAttribute("aria-pressed", "false");
    button.addEventListener("click", async () => {
      if (!mutation.tryLock()) return; clearInlineError(controls, "message-feedback-row-error"); if (controls.querySelector(".message-feedback-note")) controls.dispatchEvent(new CustomEvent("dismissible-popover-close", { bubbles: true }));
      const existing = state.feedback.get(messageId);
      try {
        if (existing?.rating === rating) { await api(`/api/sessions/${encodeURIComponent(state.sessionId)}/feedback/${encodeURIComponent(messageId)}`, { method: "DELETE", body: JSON.stringify({ ifVersion: existing.version }) }); state.feedback.delete(messageId); }
        else { const item = await (await api(`/api/sessions/${encodeURIComponent(state.sessionId)}/feedback/${encodeURIComponent(messageId)}`, { method: "PUT", body: JSON.stringify({ rating, ...(existing?.note === undefined ? {} : { note: existing.note }), ifVersion: existing?.version ?? null }) })).json(); state.feedback.set(messageId, item); }
        controls.replaceWith(feedbackControls(messageId));
      } catch (error) { mutation.unlock(); showInlineError(controls, "message-feedback-row-error", error.message); setStatus(error.message, true); }
    });
    controls.append(button);
  }
  const existing = state.feedback.get(messageId);
  if (existing) {
    noteButton = document.createElement("button"); noteButton.type = "button"; noteButton.textContent = existing.note ? t("feedback.editNote") : t("feedback.addNote"); noteButton.classList.toggle("active", Boolean(existing.note)); noteButton.dataset.dismissibleTrigger = ""; noteButton.setAttribute("aria-haspopup", "dialog"); noteButton.setAttribute("aria-expanded", "false");
    noteButton.addEventListener("click", () => {
      if (mutation.pending()) return;
      const current = controls.querySelector(".message-feedback-note");
      if (current) { controls.dispatchEvent(new CustomEvent("dismissible-popover-close", { bubbles: true })); return; }
      const editor = document.createElement("form"); editor.className = "message-feedback-note"; editor.setAttribute("role", "dialog"); editor.setAttribute("aria-label", t("feedback.note"));
      const textarea = document.createElement("textarea"); textarea.rows = 3; textarea.placeholder = t("feedback.notePlaceholder"); textarea.setAttribute("aria-label", t("feedback.note")); textarea.value = existing.note ?? "";
      const actions = document.createElement("div"); actions.className = "message-feedback-note-actions";
      const cancel = document.createElement("button"); cancel.type = "button"; cancel.textContent = t("feedback.cancel"); cancel.addEventListener("click", () => controls.dispatchEvent(new CustomEvent("dismissible-popover-close", { bubbles: true, detail: { restoreFocus: true } })));
      const save = document.createElement("button"); save.type = "submit"; save.textContent = t("feedback.save");
      actions.append(cancel, save); editor.append(textarea, actions);
      editor.addEventListener("submit", async (event) => {
        event.preventDefault(); if (!mutation.tryLock()) return; const draft = textarea.value.trim(); clearInlineError(editor, "message-feedback-note-error"); textarea.disabled = true; cancel.disabled = true; save.disabled = true; controls.dataset.dismissibleLocked = "true";
        try {
          const latest = state.feedback.get(messageId); if (!latest) throw new Error(t("feedback.removed"));
          const item = await (await api(`/api/sessions/${encodeURIComponent(state.sessionId)}/feedback/${encodeURIComponent(messageId)}`, { method: "PUT", body: JSON.stringify({ rating: latest.rating, ...(draft ? { note: draft } : {}), ifVersion: latest.version }) })).json();
          state.feedback.set(messageId, item); controls.replaceWith(feedbackControls(messageId));
        } catch (error) { delete controls.dataset.dismissibleLocked; mutation.unlock(); textarea.disabled = false; cancel.disabled = false; save.disabled = false; showInlineError(editor, "message-feedback-note-error", error.message); setStatus(error.message, true); textarea.focus(); }
      });
      controls.append(editor); controls.dataset.popoverOpen = ""; noteButton.setAttribute("aria-expanded", "true"); controls.dispatchEvent(new CustomEvent("dismissible-popover-open", { bubbles: true })); textarea.focus();
    });
    controls.append(noteButton);
  }
  return controls;
}
function feedbackActionIcon(rating) {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg"); svg.setAttribute("viewBox", "0 0 16 16"); svg.setAttribute("width", "16"); svg.setAttribute("height", "16"); svg.setAttribute("fill", "none"); svg.setAttribute("aria-hidden", "true");
  const path = document.createElementNS(svg.namespaceURI, "path"); path.setAttribute("fill", "currentColor"); path.setAttribute("d", rating === "up"
    ? "M8.27868 0.811572C8.81991 0.142194 9.79022 0.0421835 10.4538 0.557601L10.5823 0.669306L10.6066 0.693544L10.6097 0.695652L10.6392 0.725159C11.355 1.44679 11.6337 2.49468 11.3716 3.47669L11.3706 3.48091L10.889 5.22604C10.8796 5.25997 10.8707 5.29157 10.8627 5.32088C10.8934 5.32095 10.927 5.32194 10.9628 5.32194H11.9007C12.4264 5.32194 12.7831 5.319 13.0651 5.36725C14.8182 5.66719 15.9851 7.34568 15.6565 9.09357C15.6036 9.37487 15.477 9.7092 15.294 10.2022L14.3371 12.7798C14.1402 13.3104 13.9774 13.7518 13.8102 14.1024C13.6376 14.4645 13.4386 14.7793 13.1442 15.0424C12.9712 15.197 12.7802 15.3303 12.5751 15.4386C12.226 15.6231 11.8608 15.7 11.4612 15.7358C11.0743 15.7705 10.6035 15.7695 10.0375 15.7695H4.87377C4.08053 15.7695 3.42928 15.7702 2.90734 15.7137C2.37212 15.6557 1.88991 15.5311 1.46676 15.2237C1.22415 15.0474 1.01078 14.8339 0.834466 14.5914C0.527021 14.1682 0.401373 13.686 0.343384 13.1508C0.286822 12.6287 0.287531 11.9769 0.287531 11.1833V9.51405C0.287531 8.84778 0.281347 8.36714 0.399237 7.9565C0.671152 7.00935 1.41115 6.26832 2.35829 5.99638C2.76894 5.87849 3.24958 5.88573 3.91585 5.88573C4.11983 5.88573 4.14548 5.88319 4.16244 5.88046C4.23532 5.86863 4.30409 5.83663 4.35845 5.78667C4.3711 5.77504 4.38761 5.75604 4.51442 5.59488L8.25655 0.838972L8.2576 0.837918L8.27868 0.811572ZM1.69122 11.1833C1.69122 12.0082 1.69217 12.5711 1.73865 13.0001C1.78371 13.4157 1.86473 13.6221 1.96943 13.7662C2.0592 13.8898 2.16733 13.9989 2.29085 14.0887C2.43501 14.1934 2.64216 14.2744 3.05803 14.3195C3.45897 14.3629 3.97637 14.3656 4.7157 14.3659C4.30801 13.8053 4.06453 13.1171 4.06444 12.371V8.59406H5.46813V12.371C5.46838 13.4733 6.36166 14.3669 7.46407 14.3669H10.0375C10.6286 14.3669 11.0269 14.3663 11.3369 14.3385C11.6339 14.3118 11.7956 14.2638 11.9196 14.1983C12.0241 14.1431 12.1213 14.0747 12.2094 13.996C12.314 13.9025 12.4151 13.7678 12.5435 13.4986C12.6774 13.2176 12.8162 12.845 13.0219 12.2909L13.9788 9.71322C14.1848 9.15816 14.2531 8.96731 14.2781 8.83433C14.4618 7.85692 13.8093 6.91895 12.8291 6.75092C12.6957 6.7281 12.4928 6.72458 11.9007 6.72458H10.9628C10.7737 6.72458 10.5693 6.72657 10.4 6.70666C10.2211 6.68562 9.96702 6.63024 9.74771 6.43161C9.64454 6.33811 9.55957 6.2261 9.4969 6.10177C9.3639 5.83784 9.37799 5.57899 9.40521 5.40097C9.431 5.23261 9.48672 5.03616 9.53694 4.85404L10.008 3.14579L10.0175 3.11102C10.1488 2.61338 10.0078 2.08338 9.64654 1.71681L9.6086 1.67887L9.55064 1.64304C9.48795 1.62043 9.41425 1.63814 9.36938 1.69362L9.35779 1.70627L9.35884 1.70732L5.61672 6.46217C5.51822 6.58735 5.42237 6.7133 5.30689 6.81942C5.05075 7.05471 4.73126 7.20939 4.38796 7.26519C4.23315 7.29032 4.07513 7.28837 3.91585 7.28837C3.15356 7.28837 2.91916 7.2957 2.7461 7.34528C2.26364 7.48379 1.88564 7.86081 1.74708 8.34325C1.69738 8.51636 1.69122 8.7511 1.69122 9.51405V11.1833Z"
    : "M7.72451 15.1086C7.18929 15.7705 6.22975 15.8694 5.57357 15.3597L5.44643 15.2492L5.42247 15.2253L5.41934 15.2232L5.39016 15.194C4.68239 14.4804 4.40679 13.4441 4.66589 12.473L4.66693 12.4689L5.14318 10.7431C5.15243 10.7096 5.1613 10.6783 5.16923 10.6493C5.13878 10.6493 5.10558 10.6483 5.07023 10.6483H4.14274C3.62288 10.6483 3.27015 10.6512 2.9912 10.6035C1.25757 10.3069 0.103662 8.64702 0.42863 6.91854C0.480965 6.64037 0.606164 6.30975 0.787119 5.82223L1.73336 3.27321C1.92812 2.74852 2.08912 2.31209 2.25442 1.96535C2.42515 1.60724 2.62191 1.29594 2.91304 1.03578C3.08408 0.882951 3.273 0.751121 3.47579 0.643944C3.82102 0.461504 4.18214 0.38551 4.57731 0.350066C4.95993 0.315784 5.42553 0.316718 5.98521 0.316718H11.0916C11.876 0.316718 12.52 0.31607 13.0362 0.37195C13.5655 0.429293 14.0423 0.552534 14.4608 0.856536C14.7007 1.03085 14.9117 1.24193 15.086 1.48181C15.3901 1.90027 15.5143 2.37709 15.5717 2.90638C15.6276 3.42269 15.6269 4.06721 15.6269 4.85202V6.50274C15.6269 7.1616 15.633 7.6369 15.5164 8.04299C15.2475 8.97962 14.5158 9.71242 13.5791 9.98133C13.173 10.0979 12.6977 10.0908 12.0389 10.0908C11.8372 10.0908 11.8118 10.0933 11.795 10.096C11.723 10.1077 11.6549 10.1393 11.6012 10.1887C11.5887 10.2002 11.5724 10.219 11.447 10.3784L7.74639 15.0815L7.74535 15.0825L7.72451 15.1086ZM14.2388 4.85202C14.2388 4.03628 14.2379 3.47965 14.1919 3.05541C14.1473 2.64443 14.0672 2.4403 13.9637 2.29779C13.8749 2.17562 13.768 2.06769 13.6458 1.9789C13.5033 1.87532 13.2984 1.79523 12.8872 1.75067C12.4907 1.70773 11.979 1.70511 11.2479 1.70482C11.6511 2.25917 11.8918 2.93968 11.8919 3.67755V7.41251H10.5038V3.67755C10.5036 2.58745 9.62023 1.70378 8.53007 1.70378H5.98521C5.40065 1.70378 5.00679 1.70442 4.70028 1.73192C4.40651 1.7583 4.24662 1.80571 4.12399 1.87052C4.02069 1.92511 3.92452 1.99276 3.8374 2.07061C3.73401 2.16306 3.634 2.2962 3.50705 2.56249C3.37462 2.84027 3.23734 3.20873 3.03393 3.75675L2.08768 6.30578C1.88395 6.85467 1.81646 7.0434 1.79172 7.1749C1.61005 8.14146 2.25533 9.06902 3.22464 9.23517C3.35654 9.25773 3.55717 9.26123 4.14274 9.26123H5.07023C5.25717 9.26123 5.4593 9.25926 5.62672 9.27894C5.80364 9.29975 6.05492 9.35452 6.27179 9.55094C6.37381 9.6434 6.45784 9.75417 6.51982 9.87712C6.65133 10.1381 6.6374 10.3941 6.61048 10.5701C6.58498 10.7366 6.52988 10.9309 6.48022 11.111L6.01439 12.8003L6.00501 12.8347C5.87513 13.3268 6.01464 13.8509 6.37184 14.2134L6.40935 14.2509L6.46667 14.2863C6.52866 14.3087 6.60155 14.2912 6.64591 14.2363L6.65738 14.2238L6.65633 14.2228L10.3569 9.52072C10.4543 9.39693 10.5491 9.27238 10.6633 9.16744C10.9166 8.93476 11.2325 8.7818 11.572 8.72662C11.7251 8.70177 11.8814 8.70369 12.0389 8.70369C12.7927 8.70369 13.0245 8.69645 13.1956 8.64742C13.6727 8.51045 14.0465 8.13761 14.1836 7.66053C14.2327 7.48935 14.2388 7.25721 14.2388 6.50274V4.85202Z"); svg.append(path); return svg;
}
function appendTool(titleValue, value, parent = $("transcript")) {
  const details = document.createElement("details"); details.className = "tool"; details.dataset.chatFlow = "";
  const summary = document.createElement("summary"); summary.textContent = titleValue;
  const content = document.createElement("pre"); content.textContent = value;
  details.append(summary, content); parent.append(details); return details;
}
const liveToolViews = new Map(); const settledToolResults = new Map(); const liveToolHosts = new Set();
function appendToolCall(call, parent = $("transcript")) {
  const reviewSessionId = state.sessionId;
  const reviewUrl = id => `/api/sessions/${encodeURIComponent(reviewSessionId)}/reviews/${encodeURIComponent(id)}`;
  const native = createToolCard(call, currentLocale, document, {
    loadReview: async id => (await api(reviewUrl(id))).json(),
    rollbackReview: async id => (await api(`${reviewUrl(id)}/rollback`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ confirm: true }) })).json(),
  });
  if (native) {
    parent.append(native.root); liveToolViews.set(call.id, { host: native.root, native });
    const settled = settledToolResults.get(call.id);
    if (settled) { settledToolResults.delete(call.id); settled.fallback.remove(); appendToolResult(settled.event); }
    return native.root;
  }
  const argsRaw = typeof call.providerData?.dshArguments === "string" ? call.providerData.dshArguments : JSON.stringify(call.arguments ?? {});
  const fallback = appendTool(`→ ${call.name}`, typeof call.providerData?.dshArguments === "string" ? argsRaw : JSON.stringify(call.arguments, null, 2), parent);
  const host = document.createElement("div"); host.className = "dsh-tool-view";
  const mounted = window.SealDshPlugins?.mountToolView?.(host, { callId: call.id, toolName: call.name, block: { argsRaw } });
  if (!mounted) return fallback;
  fallback.hidden = true; parent.append(host); liveToolHosts.add(host); liveToolViews.set(call.id, { host, name: call.name, args: call.arguments });
  const settled = settledToolResults.get(call.id); if (settled) { settledToolResults.delete(call.id); settled.fallback.remove(); appendToolResult(settled.event); }
  return host;
}
function appendToolResultFallback(event) {
  const fallback = appendTool(`← ${event.name}${event.result.isError ? " · error" : ""}`, blocksText(event.result.content));
  const media = document.createElement("div"); media.className = "tool-result-media"; renderMediaBlocks(media, event.result.content);
  if (media.childElementCount > 0) fallback.append(media);
  return fallback;
}
function appendToolResult(event) {
  const pending = liveToolViews.get(event.callId);
  if (!pending) { const fallback = appendToolResultFallback(event); settledToolResults.set(event.callId, { event, fallback }); return fallback; }
  liveToolViews.delete(event.callId);
  if (pending.native) {
    pending.native.update(event.result);
    const media = document.createElement("div"); media.className = "tool-result-media"; renderMediaBlocks(media, event.result.content ?? []);
    if (media.childElementCount) pending.host.append(media);
    return pending.host;
  }
  window.SealDshPlugins?.mountToolView?.(pending.host, { callId: event.callId, toolName: event.name, block: { kind: "tool-result", call: { name: event.name, argsRaw: JSON.stringify(pending.args ?? {}) }, content: event.result.content ?? [], isError: event.result.isError === true, error: event.result.error, meta: event.result.details ?? event.result.meta } });
  return pending.host;
}
function appendNotice(value, error = false) { const item = document.createElement("div"); item.className = `notice${error ? " error" : ""}`; item.textContent = value; appendTranscriptNode(item); }
function setStatus(value, error = false) { $("status").textContent = value; $("status").className = error ? "error" : ""; }

// Seal owns dialogs and execution controls in the default application.
if (globalThis.location?.hash !== "#dsh-shell") {
  installDismissiblePopovers();
  initialize();
}
