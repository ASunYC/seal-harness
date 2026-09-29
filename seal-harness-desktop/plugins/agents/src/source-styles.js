// 来源与转换记录见 ../stratex/ui-provenance.json；保留来源布局，仅添加插件作用域。
export const sourceStyles = `
.zz-agents .feature-page-header {
  display: flex;
  min-height: 52px;
  align-items: flex-start;
  justify-content: space-between;
  gap: var(--sp-6);
  padding: 0 0 var(--sp-3);
}
.zz-agents .feature-page-header__heading {
  display: flex;
  min-width: 0;
  align-items: flex-start;
  gap: var(--sp-3);
}
.zz-agents .feature-page-header__copy {
  min-width: 0;
}
.zz-agents .feature-page-header h1 {
  margin: 0 0 3px;
  color: var(--ink);
  font: 700 var(--fs-500) / 1.25 var(--font-sans);
  letter-spacing: -0.02em;
}
.zz-agents .feature-page-header p {
  max-width: 70ch;
  margin: 0;
  color: var(--muted2);
  font-size: var(--fs-200);
  line-height: 1.35;
}
.zz-agents .feature-page-header__back {
  width: 30px;
  height: 30px;
  display: inline-grid;
  min-width: 30px;
  flex: 0 0 auto;
  place-items: center;
  margin-top: -3px;
  padding: 0;
  border: 0;
  border-radius: var(--r-md);
  color: var(--muted2);
  background: transparent;
  cursor: pointer;
}
.zz-agents .feature-page-header__back:hover {
  color: var(--ink);
  background: var(--sunken);
}
.zz-agents .feature-page-header__back:focus-visible {
  outline: none;
  box-shadow: var(--focus-ring-flat);
}
.zz-agents .feature-page-header__actions {
  display: flex;
  min-height: 30px;
  align-items: center;
  justify-content: flex-end;
  gap: var(--sp-3);
  flex-wrap: wrap;
}
@media (max-width: 760px) {
  .zz-agents .feature-page-header {
    align-items: stretch;
    flex-direction: column;
    gap: var(--sp-3);
  }
  .zz-agents .feature-page-header__actions {
    justify-content: flex-start;
  }
}
.zz-agents .instance-center {
  --agent-flow: light-dark(#0d7b6e, #70c9bb);
  --agent-autonomous: light-dark(#7353c9, #b9a0f5);
  position: relative;
  min-height: 100%;
  padding: 24px 32px 56px;
  color: var(--ink);
  background: var(--bg);
}
.zz-agents .center-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}
.zz-agents .center-actions .center-icon-button {
  display: grid;
  width: 36px;
  padding: 0;
  place-items: center;
  color: var(--muted2);
}
.zz-agents .center-refresh-spinner {
  animation: center-refresh-spin 0.8s linear infinite;
}
@keyframes center-refresh-spin {
  to {
    transform: rotate(360deg);
  }
}
.zz-agents .center-actions button,
.zz-agents .center-toolbar button,
.zz-agents .card-actions button,
.zz-agents .center-card--autonomous .card-shortcuts > button {
  min-height: 36px;
  padding: 0 12px;
  border: 1px solid var(--line);
  border-radius: 8px;
  color: var(--ink);
  background: var(--panel);
  cursor: pointer;
  transition:
    background-color var(--dur-1) var(--ease-out),
    border-color var(--dur-1) var(--ease-out),
    color var(--dur-1) var(--ease-out),
    box-shadow var(--dur-1) var(--ease-out),
    transform var(--dur-1) var(--ease-out);
}
.zz-agents .center-actions button.primary,
.zz-agents .card-actions button.primary,
.zz-agents .center-card--autonomous .card-shortcuts > button.primary,
.zz-agents .create-dialog button.primary {
  border-color: var(--btn-p-bg);
  color: var(--btn-p-fg);
  background: var(--btn-p-bg);
}
.zz-agents .center-group > header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
}
.zz-agents .center-group h2 {
  margin: 0;
  font-size: 15px;
}
.zz-agents .center-group header p {
  margin: 3px 0 0;
  color: var(--muted2);
  font-size: 12px;
}
.zz-agents .center-status-summary {
  margin: var(--sp-3) 0 var(--sp-5);
  padding: 20px;
  border: 1px solid var(--line);
  border-radius: var(--r-lg);
  background: var(--panel);
}
.zz-agents .center-status-summary h2 {
  margin: 0 0 20px;
  font-size: 15px;
  line-height: 1.4;
}
.zz-agents .overview-stats {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  margin: 0;
}
.zz-agents .overview-stat {
  display: flex;
  min-width: 0;
  align-items: center;
  gap: 14px;
  padding: 4px 24px;
}
.zz-agents .overview-stat:first-child {
  padding-left: 0;
}
.zz-agents .overview-stat + .overview-stat {
  border-left: 1px solid var(--line);
}
.zz-agents .overview-stat dt {
  color: var(--muted2);
  font-size: 13px;
  line-height: 1.5;
}
.zz-agents .overview-stat dd {
  margin: 4px 0 0;
  color: var(--ink);
  font-size: 28px;
  font-weight: 650;
  line-height: 1.15;
  font-variant-numeric: tabular-nums;
}
.zz-agents .overview-icon {
  display: grid;
  width: 48px;
  height: 48px;
  flex: 0 0 auto;
  place-items: center;
  border-radius: 10px;
  line-height: 0;
}
.zz-agents .overview-icon svg {
  display: block;
}
.zz-agents .overview-icon.total {
  color: light-dark(#2265c5, #8abaff);
  background: light-dark(#edf4ff, #24354e);
}
.zz-agents .overview-icon.running {
  color: var(--ok-text);
  background: var(--ok-soft);
}
.zz-agents .overview-icon.attention {
  color: var(--warn-text);
  background: var(--warn-soft);
}
.zz-agents .overview-icon.stopped {
  color: var(--muted2);
  background: var(--sunken);
}
.zz-agents .center-alert {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: -8px 0 18px;
  padding: 10px 12px;
  border: 1px solid var(--warn);
  border-radius: 9px;
  color: var(--warn-text); /* 作文字用 -text 变体（D2.8） */
  background: var(--warn-soft);
  font-size: 13px;
}
.zz-agents .center-alert button {
  min-height: 28px;
  margin-left: auto;
  padding: 0 9px;
  border: 1px solid currentColor;
  border-radius: 7px;
  color: inherit;
  background: transparent;
  cursor: pointer;
  transition:
    background-color var(--dur-1) var(--ease-out),
    border-color var(--dur-1) var(--ease-out),
    transform var(--dur-1) var(--ease-out);
}
.zz-agents .center-sync-note {
  display: flex;
  align-items: center;
  gap: 6px;
  margin: -10px 0 16px;
  color: var(--muted2);
  font-size: 12px;
}
.zz-agents .center-sync-note .app-icon {
  color: var(--muted);
}
.zz-agents .center-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 26px;
}
.zz-agents .center-tabs .tab-count {
  display: inline-grid;
  min-width: 20px;
  height: 20px;
  place-items: center;
  margin-left: 4px;
  padding: 0 6px;
  border-radius: var(--r-pill);
  color: var(--muted2);
  background: color-mix(in srgb, var(--ink) 6%, transparent);
  font-size: 11px;
  font-variant-numeric: tabular-nums;
}
.zz-agents .center-tabs button[aria-pressed='true'] .tab-count {
  color: var(--ink);
  background: color-mix(in srgb, var(--panel) 76%, transparent);
}
.zz-agents .center-tabs {
  display: inline-flex;
  gap: 3px;
  padding: 3px;
  border: 1px solid var(--line);
  border-radius: 10px;
  background: var(--sunken);
}
.zz-agents .center-tabs button {
  border: 0;
  background: transparent;
  color: var(--muted2);
}
.zz-agents .center-tabs button[aria-pressed='true'] {
  color: var(--ink);
  background: var(--panel);
  font-weight: 650;
  box-shadow: var(--sh-1);
}
.zz-agents .center-search input {
  width: 240px;
  min-height: 36px;
  padding: 0 12px;
  border: 1px solid var(--line);
  border-radius: 9px;
  color: var(--ink);
  background: var(--panel);
  transition:
    border-color var(--dur-1) var(--ease-out),
    box-shadow var(--dur-1) var(--ease-out);
}
.zz-agents .center-group {
  margin-top: 26px;
}
.zz-agents .group-loading {
  display: flex;
  align-items: center;
  gap: 9px;
  min-height: 64px;
  padding: 0 16px;
  border: 1px solid var(--line);
  border-radius: 12px;
  color: var(--muted2);
  background: var(--panel);
  font-size: 13px;
}
.zz-agents .center-group > header {
  align-items: flex-end;
  margin-bottom: 11px;
}
.zz-agents .center-group > header > span {
  color: var(--muted2);
  font-size: 12px;
}
.zz-agents .center-group h2 {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 18px;
}
.zz-agents .type-dot {
  width: 9px;
  height: 9px;
  border-radius: 50%;
}
.zz-agents .type-dot.flow {
  background: var(--agent-flow);
}
.zz-agents .type-dot.autonomous {
  background: var(--agent-autonomous);
}
.zz-agents .center-cards {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(320px, 1fr));
  gap: 12px;
}
.zz-agents .center-cards--autonomous {
  grid-template-columns: repeat(auto-fit, minmax(min(100%, 520px), 1fr));
}
.zz-agents .center-card {
  display: grid;
  grid-template-rows: auto auto 1fr auto;
  min-height: 178px;
  padding: 18px;
  border: 1px solid var(--line);
  border-radius: 14px;
  background: var(--panel);
  box-shadow: var(--sh-1);
  transition:
    border-color var(--dur-1) var(--ease-out),
    box-shadow var(--dur-1) var(--ease-out);
}
.zz-agents .card-top,
.zz-agents .card-title,
.zz-agents .card-actions,
.zz-agents .card-shortcuts {
  display: flex;
  align-items: center;
}
.zz-agents .card-top {
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
}
.zz-agents .card-title {
  min-width: 0;
  gap: 10px;
}
.zz-agents .card-title-text {
  min-width: 0;
}
.zz-agents .card-title h3 {
  overflow: hidden;
  margin: 0;
  font-size: 16px;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.zz-agents .type-icon {
  display: grid;
  width: 34px;
  height: 34px;
  flex: 0 0 auto;
  place-items: center;
  border-radius: 9px;
  font-size: 21px;
}
.zz-agents .type-icon.flow {
  color: var(--agent-flow);
  background: color-mix(in srgb, var(--agent-flow) 12%, var(--panel));
}
.zz-agents .type-icon.autonomous {
  color: var(--agent-autonomous);
  background: color-mix(in srgb, var(--agent-autonomous) 12%, var(--panel));
}
.zz-agents .status {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 4px 8px;
  border-radius: 999px;
  font-size: 11px;
  white-space: nowrap;
}
.zz-agents .status.checking .app-icon {
  animation: instance-status-spin 1s linear infinite;
}
@keyframes instance-status-spin {
  to {
    transform: rotate(360deg);
  }
}
.zz-agents .status.running {
  color: var(--ok-text);
  background: var(--ok-soft);
}
.zz-agents .status.checking {
  color: var(--accent-text);
  background: var(--accent-soft);
}
.zz-agents .status.attention {
  color: var(--warn-text); /* 作文字用 -text 变体（D2.8） */
  background: var(--warn-soft);
}
.zz-agents .status.unavailable {
  color: var(--danger-text);
  background: color-mix(in srgb, var(--danger-text) 10%, var(--panel));
}
.zz-agents .status.stopped {
  color: var(--muted2);
  background: var(--sunken);
}
.zz-agents .card-subtitle {
  margin: 9px 0 0 44px;
  color: var(--muted2);
  font-size: 12px;
}
.zz-agents .card-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 8px 16px;
  align-self: end;
  margin: 18px 0 14px;
  color: var(--muted2);
  font-size: 12px;
}
.zz-agents .card-actions {
  gap: 8px;
  padding-top: 14px;
  border-top: 1px solid var(--line);
}
.zz-agents .card-actions button {
  min-height: 32px;
  padding: 0 10px;
}
.zz-agents .card-shortcuts {
  gap: 5px;
  margin-left: auto;
}
.zz-agents .card-shortcuts > button {
  display: inline-grid;
  width: 32px;
  height: 32px;
  place-items: center;
  padding: 0;
  color: var(--muted2);
  line-height: 0;
}
.zz-agents .card-shortcuts .instance-delete-trigger {
  display: inline-grid;
  width: 32px;
  height: 32px;
  min-height: 32px;
  place-items: center;
  padding: 0;
  line-height: 0;
}
.zz-agents .center-card--autonomous {
  grid-template-rows: auto auto;
  min-height: 184px;
  padding: 22px 28px;
}
.zz-agents .center-card--autonomous .card-top {
  min-height: 64px;
}
.zz-agents .center-card--autonomous .card-title {
  flex: 1 1 auto;
  align-items: flex-start;
  gap: 16px;
}
.zz-agents .center-card--autonomous .type-icon {
  width: 48px;
  height: 48px;
  border-radius: 10px;
}
.zz-agents .center-card--autonomous .card-title h3 {
  padding-top: 2px;
  font-size: 18px;
  line-height: 1.35;
}
.zz-agents .center-card-name-row,
.zz-agents .center-card-name-editor {
  display: flex;
  min-width: 0;
  align-items: center;
  gap: 6px;
}
.zz-agents .center-card-name-row h3 {
  min-width: 0;
}
.zz-agents .center-card-name-edit,
.zz-agents .center-card-name-editor button {
  display: grid;
  width: 28px;
  height: 28px;
  min-height: 28px;
  flex: 0 0 28px;
  place-items: center;
  padding: 0;
  border: 1px solid transparent;
  border-radius: 7px;
  color: var(--muted2);
  background: transparent;
}
.zz-agents .center-card-name-edit {
  opacity: 0;
}
.zz-agents .center-card--autonomous:hover .center-card-name-edit,
.zz-agents .center-card-name-edit:focus-visible {
  opacity: 1;
}
.zz-agents .center-card-name-editor input {
  width: min(260px, 100%);
  min-width: 120px;
  height: 34px;
  padding: 0 9px;
  border: 1px solid var(--line);
  border-radius: 8px;
  color: var(--ink);
  background: var(--bg);
  font: inherit;
}
.zz-agents .center-card-name-error {
  margin: 5px 0 0;
  color: var(--danger-text);
  font-size: 12px;
}
.zz-agents .center-card--autonomous .card-location {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 7px 0 0;
  font-size: 13px;
  line-height: 1.4;
}
.zz-agents .center-card--autonomous .card-location .app-icon {
  flex: 0 0 auto;
  color: var(--muted2);
}
.zz-agents .center-card--autonomous .status {
  flex: 0 0 auto;
  gap: 7px;
  padding: 6px 10px;
  font-size: 12px;
  font-weight: 650;
}
.zz-agents .autonomous-card-footer {
  display: flex;
  min-width: 0;
  align-items: center;
  justify-content: space-between;
  gap: 14px;
  margin-top: 14px;
  padding-top: 18px;
  border-top: 1px solid var(--line);
}
.zz-agents .center-card--autonomous .autonomous-card-meta {
  min-width: 0;
  flex: 1 1 auto;
  align-self: center;
  gap: 14px;
  margin: 0;
  padding: 0;
  border-top: 0;
  font-size: 13px;
}
.zz-agents .card-meta-item {
  display: inline-flex;
  align-items: center;
  gap: 8px;
}
.zz-agents .card-meta-item .app-icon {
  flex: 0 0 auto;
  color: var(--muted2);
}
.zz-agents .card-meta-divider {
  width: 1px;
  height: 20px;
  background: var(--line-strong);
}
.zz-agents .center-card--autonomous .card-shortcuts {
  flex: 0 0 auto;
  gap: 8px;
  margin-left: auto;
}
.zz-agents .center-card--autonomous .card-shortcuts > button,
.zz-agents .center-card--autonomous .card-shortcuts .instance-delete-trigger {
  width: 42px;
  height: 42px;
  min-height: 42px;
}
.zz-agents .center-card--autonomous .card-shortcuts .instance-delete-trigger {
  color: var(--danger-text);
}
.zz-agents .center-card--autonomous .card-shortcuts > .compact-primary-action {
  width: auto;
  padding: 0 12px;
}
.zz-agents .card-shortcut-separator {
  width: 1px;
  height: 24px;
  margin: 0 4px;
  background: var(--line-strong);
}
.zz-agents .center-empty {
  padding: 28px 18px;
  border: 1px dashed var(--line-strong);
  border-radius: 12px;
  color: var(--muted2);
  text-align: center;
}
.zz-agents .center-empty--primary {
  display: grid;
  min-height: 220px;
  place-items: center;
  align-content: center;
  gap: var(--sp-2);
  border-style: solid;
  background: var(--panel);
}
.zz-agents .center-empty--primary > .app-icon {
  margin-bottom: var(--sp-2);
  color: var(--accent-text);
}
.zz-agents .center-empty--primary strong {
  color: var(--ink);
  font-size: 15px;
}
.zz-agents .center-empty--primary span {
  margin-bottom: var(--sp-3);
  font-size: 12px;
}
.zz-agents .create-dialog {
  width: min(620px, 100%);
  pointer-events: auto;
  border: 1px solid var(--line);
  border-radius: 16px;
  background: var(--panel);
  box-shadow: 0 8px 18px rgb(20 35 60 / 20%);
}
.zz-agents .settings-dialog {
  width: min(500px, 100%);
  pointer-events: auto;
  border: 1px solid var(--line);
  border-radius: 14px;
  background: var(--panel);
  box-shadow: 0 8px 18px rgb(20 35 60 / 20%);
}
.zz-agents .settings-dialog > header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  padding: 20px 22px 16px;
  border-bottom: 1px solid var(--line);
}
.zz-agents .settings-dialog h2 {
  margin: 0;
  font-size: 19px;
}
.zz-agents .settings-dialog header p,
.zz-agents .settings-dialog-body p {
  margin: 5px 0 0;
  color: var(--muted2);
  font-size: 12px;
  line-height: 1.55;
}
.zz-agents .settings-dialog header button {
  display: grid;
  width: 32px;
  min-height: 32px;
  padding: 0;
  place-items: center;
  border: 1px solid var(--line);
  border-radius: 8px;
  color: var(--muted2);
  background: var(--panel);
  cursor: pointer;
}
.zz-agents .settings-dialog-body {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: 8px;
  padding: 20px 22px;
}
.zz-agents .settings-local-runtime {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: center;
  gap: 8px 16px;
  margin-bottom: 8px;
  padding-bottom: 18px;
  border-bottom: 1px solid var(--line);
}
.zz-agents .settings-local-runtime h3 {
  margin: 0;
  font-size: 14px;
}
.zz-agents .settings-local-runtime button {
  display: inline-flex;
  min-height: 36px;
  align-items: center;
  justify-content: center;
  gap: 7px;
  padding: 0 12px;
  border: 1px solid var(--line);
  border-radius: 8px;
  color: var(--ink);
  background: var(--panel);
  cursor: pointer;
}
.zz-agents .settings-dialog-body .settings-local-runtime .settings-dialog-error {
  grid-column: 1 / -1;
  margin: 0;
}
.zz-agents .settings-dialog-body label {
  margin-top: 8px;
  color: var(--ink);
  font-size: 13px;
  font-weight: 650;
}
.zz-agents .settings-dialog-body label:first-child {
  margin-top: 0;
}
.zz-agents .settings-dialog-body input,
.zz-agents .settings-dialog-body select {
  width: 100%;
  min-height: 40px;
  box-sizing: border-box;
  padding: 0 11px;
  border: 1px solid var(--line);
  border-radius: 8px;
  color: var(--ink);
  background: var(--bg);
  font: inherit;
}
.zz-agents .settings-url-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 8px;
}
.zz-agents .settings-url-row button {
  display: inline-flex;
  min-height: 40px;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 0 12px;
  border: 1px solid var(--line);
  border-radius: 8px;
  color: var(--ink);
  background: var(--panel);
  cursor: pointer;
  white-space: nowrap;
}
.zz-agents .settings-url-row button.validation-success {
  border-color: color-mix(in srgb, var(--ok-text) 30%, var(--line));
  color: var(--ok-text);
  background: var(--ok-soft);
}
.zz-agents .settings-url-row button.validation-error {
  border-color: color-mix(in srgb, var(--danger-text) 30%, var(--line));
  color: var(--danger-text);
  background: color-mix(in srgb, var(--danger-text) 7%, var(--panel));
}
.zz-agents .settings-validation-spinner {
  animation: settings-validation-spin 0.8s linear infinite;
}
@keyframes settings-validation-spin {
  to {
    transform: rotate(360deg);
  }
}
.zz-agents .settings-dialog-body .settings-dialog-error {
  margin-top: 8px;
  color: var(--danger-text);
}
.zz-agents .settings-dialog > footer {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  padding: 14px 22px 18px;
  border-top: 1px solid var(--line);
}
.zz-agents .settings-dialog > footer button {
  min-height: 36px;
  padding: 0 13px;
  border: 1px solid var(--line);
  border-radius: 8px;
  color: var(--ink);
  background: var(--panel);
  cursor: pointer;
}
.zz-agents .settings-dialog > footer button.primary {
  border-color: var(--btn-p-bg);
  color: var(--btn-p-fg);
  background: var(--btn-p-bg);
}
.zz-agents .create-dialog-positioner {
  display: grid;
  width: 100%;
  height: 100%;
  padding: var(--sp-5);
  place-items: center;
  pointer-events: none;
}
.zz-agents .create-dialog > header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  padding: 22px 24px 16px;
  border-bottom: 1px solid var(--line);
}
.zz-agents .create-dialog h2 {
  margin: 0;
  font-size: 20px;
}
.zz-agents .create-dialog p {
  margin: 5px 0 0;
  color: var(--muted2);
  font-size: 13px;
}
.zz-agents .create-dialog > header button {
  width: 32px;
  min-height: 32px;
  padding: 0;
  border: 1px solid var(--line);
  border-radius: 8px;
  color: var(--muted2);
  background: var(--panel);
  font-size: 20px;
  cursor: pointer;
  transition:
    background-color var(--dur-1) var(--ease-out),
    border-color var(--dur-1) var(--ease-out),
    color var(--dur-1) var(--ease-out),
    transform var(--dur-1) var(--ease-out);
}
.zz-agents .create-types {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
  padding: 22px 24px;
}
.zz-agents .create-types > button {
  display: grid;
  gap: 8px;
  padding: 14px;
  border: 1px solid var(--line);
  border-radius: 12px;
  color: var(--ink);
  background: var(--panel);
  text-align: left;
  cursor: pointer;
  transition:
    background-color var(--dur-1) var(--ease-out),
    border-color var(--dur-1) var(--ease-out),
    box-shadow var(--dur-1) var(--ease-out),
    transform var(--dur-1) var(--ease-out);
}
.zz-agents .create-types > button.selected {
  border-color: var(--accent);
  box-shadow: inset 0 0 0 1px var(--accent);
}
.zz-agents .create-types img {
  width: 100%;
  height: 92px;
  object-fit: contain;
}
.zz-agents .create-types span {
  color: var(--muted2);
  font-size: 12px;
  line-height: 1.6;
}
.zz-agents .create-dialog > footer {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  padding: 15px 24px 20px;
  border-top: 1px solid var(--line);
}
.zz-agents .create-dialog > footer button {
  min-height: 36px;
  padding: 0 13px;
  border: 1px solid var(--line);
  border-radius: 8px;
  color: var(--ink);
  background: var(--panel);
  cursor: pointer;
  transition:
    background-color var(--dur-1) var(--ease-out),
    border-color var(--dur-1) var(--ease-out),
    box-shadow var(--dur-1) var(--ease-out),
    transform var(--dur-1) var(--ease-out);
}
.zz-agents .center-actions button:focus-visible,
.zz-agents .center-toolbar button:focus-visible,
.zz-agents .card-actions button:focus-visible,
.zz-agents .center-card--autonomous .card-shortcuts > button:focus-visible,
.zz-agents .center-alert button:focus-visible,
.zz-agents .create-dialog button:focus-visible,
.zz-agents .settings-dialog button:focus-visible,
.zz-agents .settings-dialog input:focus-visible,
.zz-agents .settings-dialog select:focus-visible,
.zz-agents .center-search input:focus-visible,
.zz-agents .center-card-name-edit:focus-visible,
.zz-agents .center-card-name-editor button:focus-visible,
.zz-agents .center-card-name-editor input:focus-visible {
  outline: none;
  box-shadow: var(--focus-ring);
}
.zz-agents .center-search input:focus-visible {
  border-color: var(--accent);
}
.zz-agents .center-actions button:active:not(:disabled),
.zz-agents .center-toolbar button:active:not(:disabled),
.zz-agents .card-actions button:active:not(:disabled),
.zz-agents .center-card--autonomous .card-shortcuts > button:active:not(:disabled),
.zz-agents .center-alert button:active:not(:disabled),
.zz-agents .create-dialog button:active:not(:disabled) {
  transform: translateY(1px);
}
.zz-agents .settings-dialog button:active:not(:disabled) {
  transform: translateY(1px);
}
.zz-agents .center-actions button:disabled,
.zz-agents .center-toolbar button:disabled,
.zz-agents .card-actions button:disabled,
.zz-agents .center-card--autonomous .card-shortcuts > button:disabled,
.zz-agents .center-alert button:disabled,
.zz-agents .create-dialog button:disabled {
  color: var(--muted);
  border-color: var(--line);
  background: var(--line);
  cursor: not-allowed;
  box-shadow: none;
}
.zz-agents .settings-dialog button:disabled,
.zz-agents .settings-dialog input:disabled,
.zz-agents .settings-dialog select:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.zz-agents .center-actions button:not(.primary):disabled,
.zz-agents .center-toolbar button:disabled,
.zz-agents .card-actions button:not(.primary):disabled,
.zz-agents .center-card--autonomous .card-shortcuts > button:not(.primary):disabled,
.zz-agents .center-alert button:disabled,
.zz-agents .create-dialog button:not(.primary):disabled {
  background: transparent;
}
@media (hover: hover) {
  .zz-agents .center-actions button:hover:not(:disabled),
  .zz-agents .card-actions button:hover:not(:disabled),
  .zz-agents .center-card--autonomous .card-shortcuts > button:hover:not(:disabled),
  .zz-agents .center-alert button:hover:not(:disabled),
  .zz-agents .create-dialog > header button:hover:not(:disabled),
  .zz-agents .create-dialog > footer button:hover:not(:disabled) {
    border-color: var(--line-strong);
    background: var(--sunken);
  }
  .zz-agents .settings-dialog header button:hover:not(:disabled),
  .zz-agents .settings-local-runtime button:hover:not(:disabled),
  .zz-agents .settings-url-row button:hover:not(:disabled),
  .zz-agents .settings-dialog > footer button:not(.primary):hover:not(:disabled) {
    border-color: var(--line-strong);
    background: var(--sunken);
  }
  .zz-agents .center-actions button.primary:hover:not(:disabled),
  .zz-agents .card-actions button.primary:hover:not(:disabled),
  .zz-agents .center-card--autonomous .card-shortcuts > button.primary:hover:not(:disabled),
  .zz-agents .create-dialog button.primary:hover:not(:disabled) {
    border-color: var(--btn-p-bg);
    background: var(--btn-p-bg);
    box-shadow: 0 4px 16px color-mix(in srgb, var(--btn-p-bg) 30%, transparent);
  }
  .zz-agents .settings-dialog > footer button.primary:hover:not(:disabled) {
    border-color: var(--btn-p-bg);
    background: var(--btn-p-bg);
  }
  .zz-agents .center-tabs button:hover:not(:disabled):not([aria-pressed='true']) {
    color: var(--ink);
    background: color-mix(in srgb, var(--panel) 64%, transparent);
  }
  .zz-agents .card-shortcuts > button:hover:not(:disabled) {
    color: var(--ink);
    border-color: var(--line-strong);
    background: var(--sunken);
  }
  .zz-agents .center-card-name-edit:hover:not(:disabled),
  .zz-agents .center-card-name-editor button:hover:not(:disabled) {
    color: var(--ink);
    border-color: var(--line-strong);
    background: var(--sunken);
  }
  .zz-agents .center-card:hover {
    border-color: var(--line-strong);
    box-shadow: 0 4px 8px light-dark(rgba(25, 25, 20, 0.1), rgba(0, 0, 0, 0.32));
  }
  .zz-agents .create-types > button:hover:not(:disabled):not(.selected) {
    border-color: var(--accent-line);
    background: var(--accent-soft);
    transform: translateY(-1px);
  }
}
@media (hover: none) {
  .zz-agents .center-card-name-edit {
    opacity: 1;
  }
}
.zz-agents .sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
}
@media (max-width: 760px) {
  .zz-agents .instance-center {
    padding: 20px;
  }
  .zz-agents .overview-stats {
    grid-template-columns: repeat(2, minmax(0, 1fr));
    row-gap: 20px;
  }
  .zz-agents .overview-stat {
    padding: 0 12px;
    gap: 10px;
  }
  .zz-agents .overview-stat:nth-child(odd) {
    padding-left: 0;
    border-left: 0;
  }
  .zz-agents .overview-icon {
    width: 40px;
    height: 40px;
  }
  .zz-agents .center-toolbar {
    align-items: stretch;
    flex-direction: column;
  }
  .zz-agents .center-search input {
    width: 100%;
  }
  .zz-agents .center-card--autonomous {
    min-height: 0;
    padding: 20px;
  }
  .zz-agents .center-card--autonomous .card-top {
    min-height: 0;
  }
  .zz-agents .autonomous-card-footer {
    align-items: flex-start;
    flex-direction: column;
  }
  .zz-agents .center-card--autonomous .card-shortcuts {
    width: 100%;
    justify-content: flex-end;
    margin-left: 0;
  }
  .zz-agents .create-types {
    grid-template-columns: 1fr;
  }
  .zz-agents .settings-url-row {
    grid-template-columns: 1fr;
  }
  .zz-agents .settings-local-runtime {
    grid-template-columns: 1fr;
  }
}
@media (min-width: 761px) and (max-width: 1100px) {
  .zz-agents .overview-stat {
    padding: 4px 12px;
    gap: 10px;
  }
  .zz-agents .overview-stat:first-child {
    padding-left: 0;
  }
  .zz-agents .overview-icon {
    width: 40px;
    height: 40px;
  }
}
@media (prefers-reduced-motion: reduce) {
  .zz-agents .center-actions button,
  .zz-agents .center-toolbar button,
  .zz-agents .card-actions button,
  .zz-agents .center-alert button,
  .zz-agents .center-card,
  .zz-agents .create-dialog button,
  .zz-agents .center-search input,
  .zz-agents .create-types > button {
    transition: none;
  }
  .zz-agents .status.checking .app-icon {
    animation: none;
  }
  .zz-agents .settings-validation-spinner {
    animation: none;
  }
  .zz-agents .center-refresh-spinner {
    animation: none;
  }
}
.zz-agents .agent-local-ui .local-agent {
  max-width: 1120px;
  margin: 28px auto;
  display: grid;
  gap: 18px;
  color: var(--ink);
}
.zz-agents .agent-local-ui .local-heading,
.zz-agents .agent-local-ui .heading-actions,
.zz-agents .agent-local-ui .actions,
.zz-agents .agent-local-ui .overview-top,
.zz-agents .agent-local-ui .instance-identity,
.zz-agents .agent-local-ui .maintenance,
.zz-agents .agent-local-ui .maintenance > div {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
}
.zz-agents .agent-local-ui .local-heading,
.zz-agents .agent-local-ui .overview-top,
.zz-agents .agent-local-ui .maintenance {
  justify-content: space-between;
}
.zz-agents .agent-local-ui .eyebrow {
  color: var(--accent-text, var(--accent));
  font-size: 12px;
}
.zz-agents .agent-local-ui h2 {
  font-size: 26px;
  margin: 8px 0;
}
.zz-agents .agent-local-ui h3 {
  font-size: 18px;
  margin: 0;
}
.zz-agents .agent-local-ui p {
  color: var(--muted2);
  font-size: 13px;
  line-height: 1.7;
  margin: 8px 0;
}
.zz-agents .agent-local-ui button {
  padding: 9px 14px;
  border: 1px solid var(--line);
  border-radius: 8px;
  background: var(--panel);
  color: var(--ink);
  font: inherit;
  font-size: 13px;
  cursor: pointer;
  transition:
    background-color var(--dur-1) var(--ease-out),
    border-color var(--dur-1) var(--ease-out),
    color var(--dur-1) var(--ease-out),
    box-shadow var(--dur-1) var(--ease-out),
    transform var(--dur-1) var(--ease-out);
}
.zz-agents .agent-local-ui button:not(.primary):hover:not(:disabled) {
  background: var(--raised, var(--bg));
  border-color: var(--accent);
}
.zz-agents .agent-local-ui button:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}
.zz-agents .agent-local-ui button.primary {
  background: var(--btn-p-bg);
  border-color: var(--btn-p-bg);
  color: var(--btn-p-fg);
}
.zz-agents .agent-local-ui button.primary:hover:not(:disabled) {
  background: var(--btn-p-bg);
  border-color: var(--btn-p-bg);
  box-shadow: 0 4px 16px color-mix(in srgb, var(--btn-p-bg) 30%, transparent);
}
.zz-agents .agent-local-ui button.primary:active:not(:disabled) {
  transform: translateY(1px);
}
.zz-agents .agent-local-ui button:not(.primary):active:not(:disabled) {
  transform: translateY(1px);
}
.zz-agents .agent-local-ui button:focus-visible,
.zz-agents .agent-local-ui input:focus-visible,
.zz-agents .agent-local-ui select:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 3px;
}
@media (prefers-reduced-motion: reduce) {
  .zz-agents .agent-local-ui button,
  .zz-agents .agent-local-ui input,
  .zz-agents .agent-local-ui select {
    transition: none;
  }
}
.zz-agents .agent-local-ui input,
.zz-agents .agent-local-ui select {
  box-sizing: border-box;
  min-width: 0;
  width: 100%;
  padding: 11px 12px;
  background: var(--bg);
  border: 1px solid var(--line);
  border-radius: 8px;
  color: var(--ink);
  font: inherit;
  font-size: 13px;
}
.zz-agents .agent-local-ui .instance-selector {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto auto auto;
  align-items: center;
  justify-content: space-between;
  padding: 14px 20px;
  gap: 20px;
  border: 1px solid var(--line);
  background: var(--panel);
  border-radius: 12px;
}
.zz-agents .agent-local-ui .instance-selector > .help {
  grid-column: 4;
  grid-row: 1;
  white-space: nowrap;
  padding-left: 16px;
  border-left: 1px solid var(--line);
}
.zz-agents .agent-local-ui .instance-selector label {
  display: flex;
  align-items: center;
  gap: 16px;
  font-size: 13px;
  white-space: nowrap;
}
.zz-agents .agent-local-ui .instance-selector select {
  width: 260px;
}
.zz-agents .agent-local-ui .help {
  color: var(--muted2);
  font-size: 12px;
}
.zz-agents .agent-local-ui .instance-overview,
.zz-agents .agent-local-ui .access-card,
.zz-agents .agent-local-ui .create-card,
.zz-agents .agent-local-ui .configuration-summary {
  background: var(--panel);
  border: 1px solid var(--line);
  padding: 24px;
  border-radius: 14px;
  min-width: 0;
}
.zz-agents .agent-local-ui .instance-overview {
  border-color: color-mix(in srgb, var(--accent) 32%, var(--line));
  background: color-mix(in srgb, var(--accent) 3%, var(--panel));
}
.zz-agents .agent-local-ui .instance-overview > p {
  margin: 12px 0 20px;
}
.zz-agents .agent-local-ui .instance-icon {
  width: 42px;
  height: 42px;
  border-radius: 10px;
  background: color-mix(in srgb, var(--accent) 10%, var(--panel));
  color: var(--accent);
  font-size: 28px;
  display: grid;
  place-items: center;
}
.zz-agents .agent-local-ui .status-badge {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  padding: 5px 10px;
  border-radius: 20px;
  background: var(--bg);
  font-size: 12px;
  color: var(--muted2);
}
.zz-agents .agent-local-ui .status-badge::before {
  content: '';
  width: 7px;
  height: 7px;
  background: currentColor;
  border-radius: 50%;
}
.zz-agents .agent-local-ui .status-badge.ready {
  background: color-mix(in srgb, #239953 10%, var(--panel));
  color: light-dark(#23864b, #73c991);
}
.zz-agents .agent-local-ui .access-grid {
  display: grid;
  grid-template-columns: 1.2fr 1fr;
  gap: 18px;
}
.zz-agents .agent-local-ui .address-row {
  display: grid;
  grid-template-columns: 70px minmax(0, 1fr) auto;
  align-items: center;
  gap: 10px;
  padding: 12px 0;
  border-bottom: 1px solid var(--line);
  font-size: 12px;
}
.zz-agents .agent-local-ui code {
  font-size: 12px;
  overflow-wrap: anywhere;
}
.zz-agents .agent-local-ui .text-button {
  color: var(--accent-text, var(--accent));
  border: 0;
  padding: 10px 0 0;
  background: transparent;
}
.zz-agents .agent-local-ui .share-row {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  font-size: 12px;
  align-items: center;
  margin-top: 12px;
}
.zz-agents .agent-local-ui .share-row code {
  flex: 1;
  min-width: 140px;
}
.zz-agents .agent-local-ui .maintenance {
  border: 1px solid var(--line);
  border-radius: 12px;
  background: var(--panel);
  padding: 12px 20px;
}
.zz-agents .agent-local-ui .maintenance span {
  font-size: 12px;
  color: var(--muted2);
}
.zz-agents .agent-local-ui .danger-button {
  color: var(--danger-text, #bd3030);
}
.zz-agents .agent-local-ui .form-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 20px;
  margin: 22px 0;
}
.zz-agents .agent-local-ui .form-grid label {
  display: grid;
  gap: 8px;
  font-size: 13px;
}
.zz-agents .agent-local-ui .field-error {
  color: var(--danger-text, #bd3030);
  font-size: 12px;
}
.zz-agents .agent-local-ui .create-card > button {
  margin: 16px 10px 0 0;
}
.zz-agents .agent-local-ui .error,
.zz-agents .agent-local-ui .environment-alert {
  padding: 14px 18px;
  border: 1px solid var(--line);
  border-radius: 10px;
  background: var(--panel);
}
.zz-agents .agent-local-ui .error {
  color: var(--danger-text, #bd3030);
}
.zz-agents .agent-local-ui .configuration-summary dl {
  display: grid;
  grid-template-columns: 1fr 1.4fr 0.7fr;
  gap: 20px;
  margin: 16px 0;
}
.zz-agents .agent-local-ui .configuration-summary dt {
  color: var(--muted2);
  font-size: 12px;
  margin-bottom: 7px;
}
.zz-agents .agent-local-ui .configuration-summary dd {
  margin: 0;
  overflow-wrap: anywhere;
  font-size: 13px;
}
@media (max-width: 760px) {
  .zz-agents .agent-local-ui .local-heading {
    align-items: flex-start;
  }
  .zz-agents .agent-local-ui .access-grid,
  .zz-agents .agent-local-ui .form-grid,
  .zz-agents .agent-local-ui .configuration-summary dl {
    grid-template-columns: 1fr;
  }
  .zz-agents .agent-local-ui .instance-selector {
    grid-template-columns: minmax(0, 1fr) auto;
  }
  .zz-agents .agent-local-ui .instance-selector label {
    grid-column: 1 / -1;
    width: 100%;
  }
  .zz-agents .agent-local-ui .instance-selector > .help {
    grid-column: 1;
    grid-row: 2;
    padding-left: 0;
    border-left: 0;
  }
  .zz-agents .agent-local-ui .instance-selector select {
    width: 100%;
  }
  .zz-agents .agent-local-ui .address-row {
    grid-template-columns: 60px minmax(0, 1fr);
  }
  .zz-agents .agent-local-ui .address-row button {
    grid-column: 2;
    justify-self: start;
  }
  .zz-agents .agent-local-ui .local-agent {
    margin: 20px auto;
  }
}

.zz-agents .agent-local-ui .instance-lifecycle {
  grid-column: 2;
  grid-row: 1;
  display: flex;
  gap: 8px;
  align-items: center;
}
.zz-agents .agent-local-ui .instance-note {
  grid-column: 1/-1;
  grid-row: 2;
  margin: 0;
  color: var(--muted2);
  font-size: 12px;
}
@media (max-width: 760px) {
  .zz-agents .agent-local-ui .instance-lifecycle {
    grid-column: 1;
    grid-row: 2;
  }
  .zz-agents .agent-local-ui .instance-selector > .help {
    grid-column: 1/-1;
    grid-row: 3;
  }
  .zz-agents .agent-local-ui .instance-note {
    grid-row: 4;
  }
}

.zz-agents .agent-local-ui .autonomous-instance-card {
  display: grid;
  grid-template-columns: minmax(240px, 1.05fr) minmax(350px, 1.35fr) 230px;
  align-items: center;
  gap: 24px;
  padding: 22px 24px;
  border: 1px solid var(--line);
  border-radius: 12px;
  background: var(--panel);
  transition:
    border-color var(--dur-1) var(--ease-out),
    box-shadow var(--dur-1) var(--ease-out);
}
.zz-agents .agent-local-ui .autonomous-instance-card:hover {
  border-color: color-mix(in srgb, var(--ink) 24%, var(--line));
  box-shadow: 0 4px 8px light-dark(rgba(25, 25, 20, 0.1), rgba(0, 0, 0, 0.32));
}
.zz-agents .agent-local-ui .instance-card-identity {
  min-width: 0;
}
.zz-agents .agent-local-ui .instance-kind-row {
  display: flex;
  align-items: center;
  gap: 9px;
  margin-bottom: 11px;
}
.zz-agents .agent-local-ui .instance-kind {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 5px 9px;
  border-radius: 7px;
  font-size: 11px;
  font-weight: 700;
}
.zz-agents .agent-local-ui .instance-kind.remote {
  background: color-mix(in srgb, var(--accent) 9%, var(--panel));
  color: var(--accent-text, var(--accent));
}
.zz-agents .agent-local-ui .instance-kind.local {
  background: color-mix(in srgb, light-dark(#1f806f, #70c9bb) 12%, var(--panel));
  color: light-dark(#17685e, #70c9bb);
}
.zz-agents .agent-local-ui .instance-kind.platform {
  background: color-mix(in srgb, light-dark(#7c4dff, #b69cff) 12%, var(--panel));
  color: light-dark(#5c35c8, #c8b7ff);
}
.zz-agents .agent-local-ui .instance-location {
  color: var(--muted2);
  font-size: 11px;
}
.zz-agents .agent-local-ui .instance-card-identity h3 {
  margin: 0;
  font-size: 18px;
}
.zz-agents .agent-local-ui .instance-name-row,
.zz-agents .agent-local-ui .instance-name-editor {
  display: flex;
  min-width: 0;
  align-items: center;
  gap: 6px;
}
.zz-agents .agent-local-ui .instance-name-row h3 {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.zz-agents .agent-local-ui .instance-name-edit,
.zz-agents .agent-local-ui .instance-name-editor-action {
  display: grid;
  width: 28px;
  height: 28px;
  min-height: 28px;
  flex: 0 0 28px;
  place-items: center;
  padding: 0;
  border-color: transparent;
  background: transparent;
  color: var(--muted2);
}
.zz-agents .agent-local-ui .instance-name-edit {
  opacity: 0;
}
.zz-agents .agent-local-ui .autonomous-instance-card:hover .instance-name-edit,
.zz-agents .agent-local-ui .instance-name-edit:focus-visible {
  opacity: 1;
}
.zz-agents .agent-local-ui .instance-name-edit:hover:not(:disabled),
.zz-agents .agent-local-ui .instance-name-editor-action:hover:not(:disabled) {
  border-color: var(--line);
  background: var(--bg);
  color: var(--ink);
}
.zz-agents .agent-local-ui .instance-name-editor {
  max-width: 360px;
}
.zz-agents .agent-local-ui .instance-name-editor input {
  min-width: 0;
  height: 34px;
  flex: 1;
  padding: 0 9px;
}
.zz-agents .agent-local-ui .instance-name-editor-action.is-confirm {
  color: var(--accent-text, var(--accent));
}
.zz-agents .agent-local-ui .instance-name-feedback {
  margin: 5px 0 0;
  color: var(--muted2);
  font-size: 12px;
}
.zz-agents .agent-local-ui .instance-name-feedback.is-error {
  color: var(--danger-text);
}
@media (hover: none) {
  .zz-agents .agent-local-ui .instance-name-edit {
    opacity: 1;
  }
}
.zz-agents .agent-local-ui .instance-facts {
  display: grid;
  grid-template-columns: repeat(3, minmax(90px, 1fr));
  gap: 24px;
  margin: 0;
}
.zz-agents .agent-local-ui .instance-facts dt {
  margin-bottom: 5px;
  color: var(--muted2);
  font-size: 11px;
}
.zz-agents .agent-local-ui .instance-facts dd {
  margin: 0;
  font-size: 13px;
  font-weight: 650;
}
.zz-agents .agent-local-ui .instance-card-operations {
  display: grid;
  justify-items: end;
  gap: 13px;
}
.zz-agents .agent-local-ui .instance-status {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  padding: 5px 10px;
  border-radius: 20px;
  background: var(--bg);
  color: var(--muted2);
  font-size: 12px;
  font-weight: 650;
  white-space: nowrap;
}
.zz-agents .agent-local-ui .instance-status::before {
  content: '';
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: currentColor;
}
.zz-agents .agent-local-ui .instance-status.running {
  background: color-mix(in srgb, #239953 10%, var(--panel));
  color: light-dark(#23864b, #73c991);
}
.zz-agents .agent-local-ui .instance-status.checking {
  background: var(--accent-soft);
  color: var(--accent-text);
}
.zz-agents .agent-local-ui .instance-status.incomplete {
  background: color-mix(in srgb, light-dark(#d89418, #e5b85e) 13%, var(--panel));
  color: light-dark(#8a5a0a, #e5b85e);
}
.zz-agents .agent-local-ui .instance-action-toolbar {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 6px;
}
.zz-agents .agent-local-ui .icon-action {
  display: grid;
  width: 38px;
  height: 38px;
  min-height: 38px;
  place-items: center;
  padding: 0;
  border-radius: 8px;
  color: var(--muted2);
}
.zz-agents .agent-local-ui .icon-action.primary {
  border-color: var(--accent);
  background: var(--accent);
  color: #fff;
}
.zz-agents .agent-local-ui .icon-action.danger:hover:not(:disabled) {
  border-color: color-mix(in srgb, var(--danger-text, #bd3030) 28%, var(--line));
  background: color-mix(in srgb, var(--danger-text, #bd3030) 7%, var(--panel));
}
.zz-agents .agent-local-ui .resume-action {
  display: inline-flex;
  align-items: center;
  gap: 7px;
}
.zz-agents .agent-local-ui .instance-recovery-note {
  grid-column: 1 / -1;
  margin: 0;
  padding: 10px 12px;
  border: 1px solid color-mix(in srgb, light-dark(#d89418, #e5b85e) 38%, var(--line));
  border-radius: 8px;
  background: color-mix(in srgb, light-dark(#d89418, #e5b85e) 11%, var(--panel));
  color: light-dark(#725017, #e5c782);
  font-size: 12px;
  line-height: 1.55;
}
@media (max-width: 1050px) {
  .zz-agents .agent-local-ui .autonomous-instance-card {
    grid-template-columns: minmax(220px, 1fr) minmax(300px, 1.2fr);
  }
  .zz-agents .agent-local-ui .instance-card-operations {
    grid-column: 1 / -1;
    display: flex;
    align-items: center;
    justify-content: space-between;
    justify-items: initial;
    padding-top: 16px;
    border-top: 1px solid var(--line);
  }
}
@media (max-width: 760px) {
  .zz-agents .agent-local-ui .autonomous-instance-card {
    grid-template-columns: 1fr;
    padding: 20px;
  }
  .zz-agents .agent-local-ui .instance-facts {
    grid-template-columns: repeat(3, minmax(76px, 1fr));
    gap: 14px;
  }
  .zz-agents .agent-local-ui .instance-card-operations {
    grid-column: 1;
    flex-wrap: wrap;
  }
}
.zz-agents .agent-local-ui .local-agent.is-embedded {
  display: block;
  max-width: none;
  margin: 0 0 var(--sp-4);
}
.zz-agents .agent-local-ui .creation-dialog-positioner {
  display: grid;
  width: 100%;
  height: 100%;
  padding: var(--sp-5);
  place-items: center;
  pointer-events: none;
}
.zz-agents .agent-local-ui .creation-flow {
  width: min(780px, 100%);
  max-height: min(760px, calc(100vh - (var(--sp-5) * 2)));
  overflow: hidden;
  overflow-y: auto;
  pointer-events: auto;
  border: 1px solid var(--line);
  border-radius: 14px;
  background: var(--panel);
}
.zz-agents .agent-local-ui .creation-runtime-progress {
  width: min(900px, 100%);
  max-height: min(820px, calc(100vh - (var(--sp-5) * 2)));
  overflow-y: auto;
  pointer-events: auto;
}
.zz-agents .agent-local-ui .creation-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: var(--sp-5);
  padding: 18px 22px;
  border-bottom: 1px solid var(--line);
}
.zz-agents .agent-local-ui .creation-header h3 {
  margin: 0;
  font-size: 19px;
}
.zz-agents .agent-local-ui .creation-context {
  display: grid;
  gap: 3px;
  max-width: 64ch;
  margin: 5px 0 0;
  line-height: 1.45;
}
.zz-agents .agent-local-ui .creation-context strong {
  color: var(--ink);
  font-size: 13px;
}
.zz-agents .agent-local-ui .creation-context span {
  color: var(--muted2);
  font-size: 12px;
}
.zz-agents .agent-local-ui .creation-close {
  display: grid;
  width: 32px;
  height: 32px;
  flex: 0 0 auto;
  place-items: center;
  padding: 0;
  color: var(--muted2);
  font-size: 20px;
  line-height: 1;
}
.zz-agents .agent-local-ui .creation-steps {
  display: flex;
  gap: 0;
  margin: 0;
  padding: 13px 22px;
  border-bottom: 1px solid var(--line);
  list-style: none;
}
.zz-agents .agent-local-ui .creation-steps li {
  display: flex;
  flex: 1;
  align-items: center;
  gap: 8px;
  color: var(--muted2);
  font-size: 12px;
}
.zz-agents .agent-local-ui .creation-steps li:not(:last-child)::after {
  content: '';
  height: 1px;
  flex: 1;
  margin: 0 14px;
  background: var(--line);
}
.zz-agents .agent-local-ui .creation-steps li > span {
  display: grid;
  width: 25px;
  height: 25px;
  place-items: center;
  border: 1px solid var(--line);
  border-radius: 50%;
}
.zz-agents .agent-local-ui .creation-steps li.done,
.zz-agents .agent-local-ui .creation-steps li.current {
  color: var(--accent-text, var(--accent));
  font-weight: 650;
}
.zz-agents .agent-local-ui .creation-steps li.done > span {
  border-color: light-dark(#23864b, #73c991);
  background: light-dark(#23864b, #4b9e6a);
  color: #fff;
}
.zz-agents .agent-local-ui .creation-steps li.current > span {
  border-color: var(--accent);
  background: color-mix(in srgb, var(--accent) 8%, var(--panel));
}
.zz-agents .agent-local-ui .creation-body {
  padding: 22px;
}
.zz-agents .agent-local-ui .creation-body h4 {
  margin: 0 0 8px;
  font-size: 18px;
}
.zz-agents .agent-local-ui .creation-copy {
  max-width: 68ch;
  margin: 0 0 16px;
}
.zz-agents .agent-local-ui .target-choices {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 16px;
}
.zz-agents .agent-local-ui .target-choices button {
  display: grid;
  min-height: 132px;
  align-content: start;
  gap: 8px;
  padding: 18px;
  text-align: left;
}
.zz-agents .agent-local-ui .target-choices button:hover:not(:disabled) {
  border-color: color-mix(in srgb, var(--accent) 55%, var(--line));
  background: color-mix(in srgb, var(--accent) 4%, var(--panel));
  transform: translateY(-1px);
}
.zz-agents .agent-local-ui .target-choices strong {
  font-size: 16px;
}
.zz-agents .agent-local-ui .target-choices span {
  color: var(--muted2);
  line-height: 1.6;
}
.zz-agents .agent-local-ui .target-choices .target-choice-title {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  color: var(--ink);
  line-height: 1.2;
}
.zz-agents .agent-local-ui .target-choice-title em {
  padding: 3px 7px;
  border: 1px solid var(--line-strong);
  border-radius: var(--r-pill);
  color: var(--muted2);
  font-size: 11px;
  font-style: normal;
  font-weight: var(--fw-label);
  white-space: nowrap;
}
.zz-agents .agent-local-ui .target-choices .target-choice-reserved {
  opacity: 1;
  border-style: dashed;
  color: var(--muted);
  background: var(--sunken);
}
.zz-agents .agent-local-ui .target-choice-reserved > :not(.target-choice-title) {
  color: var(--muted);
}
.zz-agents .agent-local-ui .creation-actions {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
  margin-top: 20px;
  padding-top: 16px;
  border-top: 1px solid var(--line);
}
.zz-agents .agent-local-ui .creation-actions.split {
  justify-content: space-between;
}
.zz-agents .agent-local-ui .creation-error-card {
  display: grid;
  gap: 12px;
  margin-bottom: 18px;
  padding: 14px 16px;
  border: 1px solid color-mix(in srgb, var(--danger-text) 28%, var(--line));
  border-radius: 10px;
  background: color-mix(in srgb, var(--danger-text) 5%, var(--panel));
}
.zz-agents .agent-local-ui .creation-error-card .creation-error {
  margin: 0;
}
.zz-agents .agent-local-ui .creation-error-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
.zz-agents .agent-local-ui .creation-error-actions button {
  padding-block: 7px;
}
.zz-agents .agent-local-ui .remote-connect-button {
  min-width: 104px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 7px;
}
.zz-agents .agent-local-ui .remote-connect-spinner {
  animation: remote-connect-spin 0.8s linear infinite;
}
@keyframes remote-connect-spin {
  to {
    transform: rotate(360deg);
  }
}
@media (prefers-reduced-motion: reduce) {
  .zz-agents .agent-local-ui .remote-connect-spinner {
    animation: none;
  }
}
.zz-agents .agent-local-ui .environment-ready {
  display: grid;
  gap: 5px;
  padding: 16px 18px;
  border: 1px solid color-mix(in srgb, #23864b 26%, var(--line));
  border-radius: 10px;
  background: color-mix(in srgb, #23864b 5%, var(--panel));
  color: light-dark(#236c43, #73c991);
}
.zz-agents .agent-local-ui .environment-ready span {
  font-size: 12px;
}
.zz-agents .agent-local-ui .environment-card {
  padding: 20px;
  border: 1px solid var(--line);
  border-radius: 10px;
}
.zz-agents .agent-local-ui .environment-checks {
  margin: 18px 0 0;
  padding: 0;
  list-style: none;
}
.zz-agents .agent-local-ui .environment-checks li {
  display: flex;
  justify-content: space-between;
  padding: 12px 0;
  border-bottom: 1px solid var(--line);
}
.zz-agents .agent-local-ui .environment-checks strong {
  font-size: 12px;
}
.zz-agents .agent-local-ui .row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 20px;
}
.zz-agents .agent-local-ui .path {
  display: block;
  padding: 12px;
  border-radius: 8px;
  background: var(--bg);
  overflow-wrap: anywhere;
}
.zz-agents .agent-local-ui .target-summary {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 18px;
  margin-bottom: 18px;
  padding: 14px 16px;
  border-radius: 10px;
  background: var(--bg);
}
.zz-agents .agent-local-ui .target-summary > div {
  display: flex;
  align-items: center;
  gap: 12px;
}
.zz-agents .agent-local-ui .instance-kind {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 5px 9px;
  border-radius: 7px;
  font-size: 11px;
  font-weight: 700;
}
.zz-agents .agent-local-ui .instance-kind.remote {
  background: color-mix(in srgb, var(--accent) 9%, var(--panel));
  color: var(--accent-text, var(--accent));
}
.zz-agents .agent-local-ui .instance-kind.local {
  background: color-mix(in srgb, light-dark(#1f806f, #70c9bb) 12%, var(--panel));
  color: light-dark(#17685e, #70c9bb);
}
.zz-agents .agent-local-ui .instance-kind.platform {
  background: color-mix(in srgb, light-dark(#7c4dff, #b69cff) 12%, var(--panel));
  color: light-dark(#5c35c8, #c8b7ff);
}
.zz-agents .agent-local-ui .creation-body .form-grid {
  gap: 14px;
  margin: 16px 0;
}
.zz-agents .agent-local-ui .platform-publish-note {
  margin: 0;
  padding: 12px 14px;
  border-radius: 9px;
  background: color-mix(in srgb, var(--accent) 5%, var(--bg));
}
.zz-agents .agent-local-ui .creation-error {
  margin: 0 0 16px;
}
.zz-agents .agent-local-ui .instance-list-heading {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 20px;
  margin: 4px 0 14px;
}
.zz-agents .agent-local-ui .instance-list-heading strong,
.zz-agents .agent-local-ui .instance-list-heading span {
  display: block;
}
.zz-agents .agent-local-ui .instance-list-heading span {
  margin-top: 4px;
  color: var(--muted2);
  font-size: 12px;
}
.zz-agents .agent-local-ui .autonomous-instance-list {
  display: grid;
  gap: 12px;
}
.zz-agents .agent-local-ui .empty-create {
  padding: 48px 24px;
  border: 1px solid var(--line);
  border-radius: 14px;
  background: var(--panel);
  text-align: center;
}
@media (max-width: 760px) {
  .zz-agents .agent-local-ui .creation-dialog-positioner {
    padding: var(--sp-3);
  }
  .zz-agents .agent-local-ui .creation-flow {
    max-height: calc(100vh - (var(--sp-3) * 2));
  }
  .zz-agents .agent-local-ui .creation-runtime-progress {
    max-height: calc(100vh - (var(--sp-3) * 2));
  }
  .zz-agents .agent-local-ui .creation-header {
    padding: 16px 18px;
  }
  .zz-agents .agent-local-ui .creation-steps {
    padding: 12px 18px;
  }
  .zz-agents .agent-local-ui .target-choices {
    grid-template-columns: 1fr;
  }
  .zz-agents .agent-local-ui .creation-steps li span + * {
    display: none;
  }
  .zz-agents .agent-local-ui .creation-body {
    padding: 18px;
  }
  .zz-agents .agent-local-ui .target-summary,
  .zz-agents .agent-local-ui .instance-list-heading {
    align-items: flex-start;
  }
  .zz-agents .agent-local-ui .target-summary > div {
    align-items: flex-start;
    flex-direction: column;
  }
}
@media (max-width: 980px) and (min-width: 761px) {
  .zz-agents .agent-local-ui .target-choices {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
  .zz-agents .agent-local-ui .target-choice-reserved {
    grid-column: 1 / -1;
  }
}

.zz-agents .agent-local-ui .workflow-resources {
  margin: 0;
  padding: 24px;
  border: 1px solid var(--line);
  border-radius: 16px;
  background: var(--panel);
}
.zz-agents .agent-local-ui .workflow-resources h3 {
  margin: 0;
  font-size: 18px;
}
.zz-agents .agent-local-ui .workflow-resources button {
  padding: 9px 14px;
  border: 1px solid var(--line);
  border-radius: 8px;
  background: var(--panel);
  color: var(--ink);
  font: inherit;
  font-size: 13px;
  cursor: pointer;
}
.zz-agents .agent-local-ui .workflow-resources button:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}
.zz-agents .agent-local-ui .workflow-resources button:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 3px;
}
.zz-agents .agent-local-ui .workflow-resources .resource-error {
  color: var(--danger-text);
}
.zz-agents .agent-local-ui .resource-warning {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
  padding: 10px 14px;
  background: color-mix(in srgb, #e7a12c 8%, var(--panel));
  border: 1px solid color-mix(in srgb, #e7a12c 30%, var(--line));
  border-radius: 8px;
}
.zz-agents .agent-local-ui .workflow-resources p {
  line-height: 1.7;
  color: var(--muted2);
}
.zz-agents .agent-local-ui .resource-list {
  max-height: 440px;
  overflow: auto;
  margin-top: 16px;
}
.zz-agents .agent-local-ui .resource-list label {
  display: flex;
  gap: 12px;
  align-items: center;
  padding: 12px 0;
}
.zz-agents .agent-local-ui .resource-list input {
  width: auto;
}
.zz-agents .agent-local-ui .resource-list small {
  display: block;
  color: var(--muted2);
  margin-top: 4px;
}

.zz-agents .agent-local-ui .delete-confirmation {
  display: grid;
  gap: 18px;
}
.zz-agents .agent-local-ui .delete-confirmation h3 {
  margin: 0;
  font-size: 20px;
}
.zz-agents .agent-local-ui .delete-confirmation p {
  margin: 0;
}
.zz-agents .agent-local-ui .delete-warning {
  display: grid;
  gap: 5px;
  padding: 14px 16px;
  border: 1px solid color-mix(in srgb, var(--danger-text, #bd3030) 24%, var(--line));
  border-radius: 10px;
  background: color-mix(in srgb, var(--danger-text, #bd3030) 5%, var(--panel));
  color: var(--danger-text, #bd3030);
  line-height: 1.6;
}
.zz-agents .agent-local-ui .delete-warning span {
  font-size: 13px;
}
.zz-agents .agent-local-ui .delete-actions {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
}

.zz-agents .za-progress .runtime-progress {
  padding: 28px;
  border: 1px solid color-mix(in srgb, var(--accent) 65%, var(--line));
  border-radius: 16px;
  background: var(--panel);
  color: var(--ink);
}
.zz-agents .za-progress .progress-heading {
  display: flex;
  align-items: center;
  gap: 20px;
}
.zz-agents .za-progress h3 {
  margin: 0;
  font-size: 24px;
  line-height: 1.4;
}
.zz-agents .za-progress .instance-name {
  margin: 6px 0 0;
  color: var(--muted2);
}
.zz-agents .za-progress .progress-orbit {
  width: 64px;
  height: 64px;
  flex-shrink: 0;
  display: grid;
  place-items: center;
  position: relative;
  color: var(--accent);
  font-size: 27px;
}
.zz-agents .za-progress .progress-orbit::before {
  content: '';
  position: absolute;
  inset: 0;
  border: 5px solid color-mix(in srgb, var(--accent) 15%, transparent);
  border-top-color: var(--accent);
  border-right-color: var(--accent);
  border-radius: 50%;
  animation: orbit 1.5s linear infinite;
}
.zz-agents .za-progress .progress-pill {
  margin-left: auto;
  padding: 6px 12px;
  border-radius: 20px;
  color: var(--accent-text, var(--accent));
  background: color-mix(in srgb, var(--accent) 10%, var(--panel));
  font-size: 12px;
  white-space: nowrap;
}
.zz-agents .za-progress .progress-footer {
  color: var(--muted2);
  font-size: 13px;
  line-height: 1.7;
}
.zz-agents .za-progress .actual-progress {
  margin: 0 0 24px;
  border-top: 1px solid var(--line);
  border-bottom: 1px solid var(--line);
}
.zz-agents .za-progress .progress-summary {
  display: flex;
  justify-content: space-between;
  gap: 16px;
  padding: 16px 0 10px;
  color: var(--muted2);
  font-size: 13px;
}
.zz-agents .za-progress .progress-summary strong {
  color: var(--ink);
  font-variant-numeric: tabular-nums;
}
.zz-agents .za-progress .progress-track {
  height: 5px;
  overflow: hidden;
  border-radius: 999px;
  background: color-mix(in srgb, var(--accent) 12%, var(--line));
}
.zz-agents .za-progress .progress-track span {
  display: block;
  width: 100%;
  height: 100%;
  transform-origin: left center;
  border-radius: inherit;
  background: var(--accent);
  transition: transform 200ms ease-out;
}
.zz-agents .za-progress .actual-steps {
  list-style: none;
  margin: 10px 0 0;
  padding: 0;
}
.zz-agents .za-progress .actual-steps > li {
  display: grid;
  grid-template-columns: 24px minmax(0, 1fr) auto;
  align-items: start;
  gap: 12px;
  padding: 11px 0;
  border-top: 1px solid color-mix(in srgb, var(--line) 72%, transparent);
  color: var(--muted2);
}
.zz-agents .za-progress .actual-steps > li:first-child {
  border-top: 0;
}
.zz-agents .za-progress .step-marker {
  width: 20px;
  height: 20px;
  display: grid;
  place-items: center;
  margin-top: 1px;
  border: 1px solid var(--line-strong);
  border-radius: 50%;
  font-size: 12px;
}
.zz-agents .za-progress .step-copy {
  min-width: 0;
  display: grid;
  gap: 3px;
}
.zz-agents .za-progress .step-copy strong {
  color: inherit;
  font-size: 14px;
  font-weight: 600;
}
.zz-agents .za-progress .step-copy small,
.zz-agents .za-progress .step-state {
  font-size: 12px;
}
.zz-agents .za-progress .step-copy small {
  color: var(--muted2);
}
.zz-agents .za-progress .step-state {
  padding-top: 2px;
  white-space: nowrap;
}
.zz-agents .za-progress .actual-steps > li.is-succeeded {
  color: light-dark(#25784a, #75d69b);
}
.zz-agents .za-progress .actual-steps > li.is-succeeded .step-marker {
  color: white;
  border-color: #258653;
  background: #258653;
}
.zz-agents .za-progress .actual-steps > li.is-running {
  color: var(--accent-text, var(--accent));
}
.zz-agents .za-progress .actual-steps > li.is-running .step-marker {
  border: 4px solid var(--accent);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--accent) 12%, transparent);
}
.zz-agents .za-progress .actual-steps > li.is-failed {
  color: var(--danger, #d23b32);
}
.zz-agents .za-progress .actual-steps > li.is-failed .step-marker {
  color: white;
  border-color: var(--danger, #d23b32);
  background: var(--danger, #d23b32);
}
.zz-agents .za-progress .image-progress {
  grid-column: 2 / 4;
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
  gap: 8px 16px;
  margin: 8px 0 2px;
  padding: 10px 12px;
  list-style: none;
  border-radius: 8px;
  background: color-mix(in srgb, var(--accent) 4%, var(--bg));
}
.zz-agents .za-progress .image-progress li {
  display: grid;
  grid-template-columns: 8px minmax(0, 1fr) auto;
  align-items: center;
  gap: 7px;
  color: var(--muted2);
  font-size: 12px;
}
.zz-agents .za-progress .image-progress li > span {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--line-strong);
}
.zz-agents .za-progress .image-progress li.is-running > span {
  background: var(--accent);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--accent) 14%, transparent);
}
.zz-agents .za-progress .image-progress li.is-succeeded > span {
  background: #258653;
}
.zz-agents .za-progress .image-progress li.is-failed > span {
  background: var(--danger, #d23b32);
}
.zz-agents .za-progress .image-progress strong {
  color: var(--ink);
  font-weight: 500;
}
.zz-agents .za-progress .image-progress small {
  color: inherit;
}
.zz-agents .za-progress .progress-steps {
  list-style: none;
  padding: 0;
  display: flex;
  margin: 26px 0;
}
.zz-agents .za-progress .progress-steps li {
  flex: 1;
  display: flex;
  align-items: center;
  gap: 9px;
  font-size: 13px;
  color: var(--muted2);
}
.zz-agents .za-progress .progress-steps li:not(:last-child)::after {
  content: '';
  height: 1px;
  background: var(--line);
  flex: 1;
  margin-right: 16px;
}
.zz-agents .za-progress .progress-steps li > span {
  width: 24px;
  height: 24px;
  border: 1px solid var(--line);
  border-radius: 50%;
  display: grid;
  place-items: center;
  flex-shrink: 0;
}
.zz-agents .za-progress .progress-steps .done > span {
  color: white;
  background: #239953;
  border-color: #239953;
}
.zz-agents .za-progress .progress-steps .active {
  color: var(--accent-text, var(--accent));
  font-weight: 600;
}
.zz-agents .za-progress .progress-steps .active > span {
  border: 3px solid var(--accent);
  box-shadow: 0 0 0 4px color-mix(in srgb, var(--accent) 12%, transparent);
}
.zz-agents .za-progress .current-stage {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 10px 24px;
  margin: 20px 0 24px;
  padding: 16px 18px;
  border-radius: 10px;
  background: color-mix(in srgb, var(--accent) 5%, var(--bg));
}
.zz-agents .za-progress .stage-copy {
  min-width: 0;
}
.zz-agents .za-progress .stage-label {
  font-size: 12px;
  color: var(--accent-text, var(--accent));
}
.zz-agents .za-progress .stage-detail {
  font-size: 15px;
  font-weight: 600;
  line-height: 1.6;
  margin: 5px 0 6px;
}
.zz-agents .za-progress .stage-guidance {
  margin: 0;
  color: var(--muted2);
  font-size: 13px;
  line-height: 1.65;
}
.zz-agents .za-progress .stage-guidance strong {
  color: var(--accent-text, var(--accent));
  font-weight: 600;
}
.zz-agents .za-progress .stage-timing {
  display: grid;
  align-content: center;
  justify-items: end;
  gap: 5px;
  font-size: 12px;
  color: var(--muted2);
  white-space: nowrap;
}
.zz-agents .za-progress .stage-timing strong {
  color: var(--accent-text, var(--accent));
  font-variant-numeric: tabular-nums;
}
.zz-agents .za-progress .long-wait {
  grid-column: 1 / -1;
  padding-top: 10px;
  border-top: 1px solid color-mix(in srgb, var(--line) 70%, transparent);
  font-size: 13px;
  line-height: 1.6;
  color: var(--muted2);
  margin: 0;
}
.zz-agents .za-progress .progress-footer {
  padding-top: 14px;
  margin: 18px 0 0;
}
@keyframes orbit {
  to {
    transform: rotate(360deg);
  }
}
@media (prefers-reduced-motion: reduce) {
  .zz-agents .za-progress .progress-orbit::before {
    animation: none;
  }
  .zz-agents .za-progress .progress-track span {
    transition: none;
  }
}
@media (max-width: 700px) {
  .zz-agents .za-progress .runtime-progress {
    padding: 20px;
  }
  .zz-agents .za-progress h3 {
    font-size: 20px;
  }
  .zz-agents .za-progress .progress-pill {
    display: none;
  }
  .zz-agents .za-progress .image-progress {
    grid-template-columns: 1fr;
  }
  .zz-agents .za-progress .current-stage {
    grid-template-columns: 1fr;
  }
  .zz-agents .za-progress .stage-timing {
    grid-auto-flow: column;
    justify-content: space-between;
    justify-items: start;
  }
}
`
