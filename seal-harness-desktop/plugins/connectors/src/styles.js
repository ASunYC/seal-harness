// 来源：Stratex 070ba39e82a4d47dec812870b691eedcb7f7b28e，capabilities/mcp 与 capability-ui/prototype.css。
import { dialogStyles } from './dialog.jsx'
export const styles = dialogStyles + `
.zz-connectors .mcp-dialog { color: var(--ink); font: var(--fw-body) var(--fs-body) / var(--lh-tight) var(--font-sans); }
.zz-connectors .mcp-dialog { z-index: var(--z-modal); width: min(920px, calc(100vw - 2 * var(--sp-5))); max-height: calc(100vh - 2 * var(--sp-5)); overflow: auto; border: var(--bw) solid var(--line-strong); border-radius: var(--r-xl); background: var(--panel); box-shadow: var(--sh-3); }
.zz-connectors .mcp-dialog--narrow { width: min(560px, calc(100vw - 2 * var(--sp-5))); }
.zz-connectors .mcp-dialog__footer, .zz-connectors .mcp-inline-actions { display: flex; align-items: center; gap: var(--sp-3); }
.zz-connectors .mcp-dialog__body { padding: var(--sp-5); }
.zz-connectors .mcp-dialog__footer { position: sticky; bottom: 0; justify-content: flex-end; padding: var(--sp-4) var(--sp-5); border-top: var(--bw) solid var(--line); background: var(--panel); }
.zz-connectors .mcp-field { display: grid; gap: var(--sp-2); }
.zz-connectors .mcp-field > span, .zz-connectors .mcp-field > label { color: var(--muted2); font-weight: var(--fw-label); }
.zz-connectors .mcp-field input, .zz-connectors .mcp-field select, .zz-connectors .mcp-field textarea { box-sizing: border-box; min-height: var(--ctl-h-lg); width: 100%; padding: var(--sp-2) var(--sp-3); border: var(--bw) solid var(--line-strong); border-radius: var(--r-sm); background: var(--sunken); color: var(--ink); font: inherit; }
.zz-connectors .mcp-field textarea { resize: vertical; }
.zz-connectors .mcp-field :is(input, select, textarea):hover:not(:disabled) { border-color: var(--accent-line); background: var(--panel); }
.zz-connectors .mcp-field :is(input, select, textarea):focus-visible { border-color: var(--accent); background: var(--panel); }
.zz-connectors .mcp-field :is(input, select, textarea)[aria-invalid='true'] { border-color: var(--danger); box-shadow: 0 0 0 1px var(--danger); }
.zz-connectors .mcp-field input::placeholder, .zz-connectors .mcp-field textarea::placeholder { color: var(--muted2); }
.zz-connectors .mcp-field select:required:invalid { color: var(--muted2); font-style: italic; background: var(--sunken); }
.zz-connectors .mcp-field select option { color: var(--ink); font-style: normal; }
.zz-connectors .mcp-field small, .zz-connectors .mcp-muted { color: var(--muted2); font-size: var(--fs-meta); }
.zz-connectors .mcp-alert { padding: var(--sp-3) var(--sp-4); border: var(--bw) solid var(--danger-line); border-radius: var(--r-md); background: var(--danger-soft); color: var(--danger-text); }
.zz-connectors .mcp-stack { display: grid; gap: var(--sp-4); }
.zz-connectors .mcp-status { display: inline-flex; align-items: center; gap: var(--sp-2); color: var(--muted2); }
.zz-connectors .mcp-status::before { width: 8px; height: 8px; border-radius: var(--r-pill); background: var(--muted); content: ''; }
.zz-connectors .mcp-status[data-tone='success']::before { background: var(--ok); }
.zz-connectors .mcp-status[data-tone='progress']::before { background: var(--accent); }
.zz-connectors .mcp-status[data-tone='warning']::before { background: var(--warn); }
.zz-connectors .mcp-status[data-tone='danger']::before { background: var(--danger); }
.zz-connectors .mcp-installed__quick { display: flex; gap: var(--sp-4); overflow-x: auto; border-bottom: var(--bw) solid var(--line); }
.zz-connectors .mcp-installed__quick button { min-height: var(--ctl-h); padding: 0 var(--sp-1); border: 0; border-bottom: var(--bw-strong) solid transparent; background: transparent; color: var(--muted2); cursor: pointer; white-space: nowrap; transition: border-color var(--dur-2) ease, color var(--dur-2) ease; }
.zz-connectors .mcp-installed__quick button[aria-pressed='true'] { border-bottom-color: var(--accent); color: var(--accent-text); }
.zz-connectors .mcp-installed__quick button:hover:not(:disabled) { background: transparent; color: var(--ink); }
.zz-connectors .mcp-installed__list { display: flex; align-items: flex-start; flex-wrap: wrap; gap: var(--sp-3); }
.zz-connectors .connector-installed-section { margin-top: 30px; }
.zz-connectors .connector-installed-section h2 { margin: 0 0 16px; font-size: 20px; }
.zz-connectors .connector-installed-section h2 small { margin-left: 6px; color: var(--muted2); font: 12px var(--font-mono, monospace); }
.zz-connectors .connector-library { margin-top: 34px; padding-top: 14px; border-top: 1px solid var(--line); }
.zz-connectors .connector-library .connector-directory-tabs { margin: 0 0 20px; }
.zz-connectors .connector-library .zz-directory-search { display: flex; margin: 0 0 18px; }
.zz-connectors .connector-library .mcp-installed__list { margin-top: 18px; }
.zz-connectors .mcp-draft-card .mcp-installed-card__identity { cursor: default; }
.zz-connectors .mcp-installed-card { position: relative; display: grid; width: min(400px, 100%); max-width: 100%; flex: 0 1 400px; grid-template-columns: minmax(0, 1fr); gap: var(--sp-3); padding: var(--sp-4); border: var(--bw) solid var(--line); border-radius: var(--r-xl); background: var(--panel); transition: border-color var(--dur-2) ease, background-color var(--dur-2) ease; }
.zz-connectors .mcp-installed-card:focus-within { border-color: var(--accent-line); }
.zz-connectors .mcp-installed-card__identity { display: grid; grid-template-columns: 44px minmax(0, 1fr); gap: var(--sp-3); align-items: center; min-width: 0; padding: 0; border: 0; background: transparent; color: var(--ink); text-align: left; cursor: pointer; }
.zz-connectors button.mcp-installed-card__identity { min-height: 0; padding: 0; border: 0; border-radius: 0; background: transparent; }
.zz-connectors .mcp-installed-card__identity:hover { background: transparent; }
.zz-connectors .mcp-installed-card__copy { min-width: 0; }
.zz-connectors .mcp-installed-card__copy strong, .zz-connectors .mcp-installed-card__identity small { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.zz-connectors .mcp-installed-card__identity small { margin-top: var(--sp-1); color: var(--muted2); font-size: var(--fs-200); line-height: var(--lh-body); }
.zz-connectors .mcp-installed-card__icon { display: inline-grid; place-items: center; border: var(--bw-strong) solid var(--accent-line); border-radius: var(--r-md); background: var(--accent-soft); color: var(--accent-text); font-weight: var(--fw-title); }
.zz-connectors .mcp-installed-card__icon { width: 42px; height: 42px; }
.zz-connectors .mcp-installed-card__context, .zz-connectors .mcp-empty-state p { margin: 0; color: var(--muted2); font-size: var(--fs-meta); }
.zz-connectors .mcp-installed-card__context { display: flex; flex-wrap: wrap; gap: var(--sp-1) var(--sp-3); color: var(--muted2); }
.zz-connectors .mcp-installed-card__footer { display: flex; align-items: center; justify-content: space-between; min-width: 0; gap: var(--sp-2); padding-top: var(--sp-1); }
.zz-connectors .mcp-installed-card__icon-action {display:inline-grid;width:36px;min-width:36px;height:36px;min-height:36px;place-items:center;padding:0;border:0;border-radius:var(--r-md);background:transparent;color:var(--ink)}
.zz-connectors .mcp-installed-card__icon-action:hover:not(:disabled) {background:var(--sunken)}
.zz-connectors .mcp-installed-card__icon-action--danger {color:var(--danger-text)}
.zz-connectors .mcp-installed-card__icon-action--danger:hover:not(:disabled) {background:var(--danger-soft)}
.zz-connectors .mcp-installed-card__icon-action:focus-visible {outline:none;box-shadow:var(--focus-ring-flat)}
.zz-connectors .mcp-installed-card__actions { display: flex; flex: none; align-items: center; gap: var(--sp-1); }
.zz-connectors .mcp-catalog-icon { display: inline-grid; flex: none; overflow: hidden; place-items: center; border: var(--bw) solid var(--line-strong); border-radius: 9px; background: var(--sunken); color: var(--accent-text); }
.zz-connectors .mcp-catalog-icon img { display: block; width: 100%; height: 100%; object-fit: contain; }
.zz-connectors .mcp-public-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: var(--sp-3); }
.zz-connectors .mcp-public-card { display: grid; min-width: 0; min-height: 190px; grid-template-rows: auto minmax(38px, auto) auto auto; gap: var(--sp-2); overflow: hidden; padding: var(--sp-4) var(--sp-4) 0; border: var(--bw) solid var(--line-strong); border-radius: var(--r-lg); background: var(--panel); }
.zz-connectors .mcp-public-card__identity { display: flex; min-width: 0; align-items: center; gap: var(--sp-3); padding: 0; border: 0; color: var(--ink); background: transparent; text-align: left; cursor: pointer; }
.zz-connectors .mcp-public-card__identity strong { overflow: hidden; font-size: var(--fs-500); text-overflow: ellipsis; white-space: nowrap; }
.zz-connectors .mcp-public-card__fallback { display: inline-grid; width: 40px; height: 40px; flex: none; border: var(--bw) solid var(--accent-line); border-radius: 9px; color: var(--accent-text); background: var(--accent-soft); place-items: center; }
.zz-connectors .mcp-public-card__summary { display: -webkit-box; overflow: hidden; margin: 0; color: var(--muted2); font-size: var(--fs-300); line-height: 1.55; -webkit-box-orient: vertical; -webkit-line-clamp: 2; }
.zz-connectors .mcp-public-card__tags { display: flex; flex-wrap: wrap; gap: var(--sp-2); }
.zz-connectors .mcp-public-card__tags span { padding: 4px 8px; border: var(--bw) solid var(--line); border-radius: var(--r-sm); color: var(--muted2); background: var(--sunken); font-size: var(--fs-200); line-height: 1.2; }
.zz-connectors .mcp-public-card > footer { display: flex; align-items: center; justify-content: space-between; gap: var(--sp-3); margin: 0 calc(-1 * var(--sp-4)); padding: var(--sp-2) var(--sp-4); border-top: var(--bw) solid var(--line); color: var(--muted2); font-size: var(--fs-300); }
.zz-connectors .mcp-public-card > footer .btn { height: 30px; padding-inline: var(--sp-3); }
.zz-connectors .mcp-public-detail__identity { display: flex; align-items: center; gap: var(--sp-3); }
.zz-connectors .mcp-public-detail__identity h3, .zz-connectors .mcp-public-detail__identity small { display: block; margin: 0; }
.zz-connectors .mcp-public-detail__identity small { margin-bottom: var(--sp-1); color: var(--muted2); }
.zz-connectors .zz-installed-drawer { display: grid; grid-template-rows: auto minmax(0, 1fr) auto; }
.zz-connectors .zz-installed-drawer__header { display: flex; align-items: flex-start; justify-content: space-between; gap: var(--sp-4); padding: var(--sp-5); }
.zz-connectors .zz-installed-drawer__header h2, .zz-connectors .zz-installed-drawer__header p { margin: 0; }
.zz-connectors .zz-installed-drawer__header p { margin-top: var(--sp-1); color: var(--muted2); }
.zz-connectors .zz-installed-drawer__close { display: grid; width: 40px; min-width: 40px; height: 40px; padding: 0; place-items: center; }
.zz-connectors .mcp-installed-drawer__body { min-height: 0; overflow-y: auto; padding: 0 var(--sp-5) var(--sp-5); }
.zz-connectors .zz-installed-drawer__toolbar { display: flex; justify-content: flex-end; padding: var(--sp-3) 0 var(--sp-5); }
.zz-connectors .zz-installed-drawer .mcp-installed__list { display: grid; grid-template-columns: minmax(0, 1fr); gap: var(--sp-3); }
.zz-connectors .zz-installed-drawer .mcp-installed-card { box-sizing: border-box; width: 100%; max-width: none; min-height: 154px; padding: var(--sp-4); }
.zz-connectors .zz-installed-drawer .mcp-installed-card__context { flex-wrap: nowrap; overflow: hidden; white-space: nowrap; }
.zz-connectors .zz-installed-drawer .mcp-installed-card__context span { overflow: hidden; text-overflow: ellipsis; }
.zz-connectors .zz-installed-drawer__footer { padding: var(--sp-3) var(--sp-5); border-top: var(--bw) solid var(--line); color: var(--muted2); font-size: var(--fs-meta); }
.zz-connectors .mcp-empty-state { display: grid; min-height: 190px; place-items: center; align-content: center; gap: var(--sp-2); padding: var(--sp-6); border: var(--bw) dashed var(--line-strong); border-radius: var(--r-lg); background: var(--sunken); text-align: center; }
.zz-connectors :is(.connector-installed-section, .connector-library) .mcp-empty-state { min-height: 110px; border: 0; background: transparent; }
.zz-connectors .mcp-runtime { position: relative; z-index: var(--z-modal); display: grid; grid-template-rows: auto auto auto minmax(0, 1fr) auto; width: min(620px, calc(100vw - 2 * var(--sp-6))); max-height: min(780px, calc(100vh - 2 * var(--sp-6))); overflow: hidden; border: var(--bw) solid var(--line-strong); border-radius: var(--r-xl); background: var(--panel); box-shadow: var(--sh-3); }
.zz-connectors .mcp-runtime__footer { display: flex; align-items: center; justify-content: space-between; gap: var(--sp-4); padding: var(--sp-3) var(--sp-5); border-block: var(--bw) solid var(--line); }
.zz-connectors .mcp-file-schema-unavailable {display:flex;align-items:flex-start;gap:var(--sp-2);color:var(--muted2)}
.zz-connectors .mcp-file-schema-unavailable .app-icon {flex:none;margin-top:2px;color:var(--accent-text)}
.zz-connectors .mcp-file-schema-unavailable strong {display:block;color:var(--ink)}
.zz-connectors .mcp-file-schema-unavailable p {margin:var(--sp-1) 0 0}
.zz-connectors .mcp-runtime__header {display:grid;grid-template-columns:52px minmax(0,1fr) auto auto;align-items:center;gap:var(--sp-3);padding:var(--sp-5);border-bottom:var(--bw) solid var(--line)}
.zz-connectors .mcp-runtime__header h2 {margin:0}
.zz-connectors .mcp-runtime__icon {display:inline-grid;place-items:center;width:48px;height:48px;border:var(--bw-strong) solid var(--accent-line);border-radius:var(--r-md);background:var(--accent-soft);color:var(--accent-text);font-weight:var(--fw-title)}
.zz-connectors .mcp-runtime__body { overflow: auto; padding: var(--sp-4) var(--sp-5); }
.zz-connectors .mcp-runtime-description { margin: 0; color: var(--muted2); line-height: var(--lh-body); }
.zz-connectors .mcp-runtime-summary { margin-top: var(--sp-4); padding: var(--sp-4); border: var(--bw) solid var(--line); border-radius: var(--r-lg); background: var(--sunken); }
.zz-connectors .mcp-runtime-summary, .zz-connectors .mcp-runtime-row { display: flex; align-items: center; justify-content: space-between; gap: var(--sp-4); }
.zz-connectors .mcp-runtime-row { padding: var(--sp-4) 0; border-bottom: var(--bw) solid var(--line); }
.zz-connectors .mcp-runtime-summary h3, .zz-connectors .mcp-runtime-summary p, .zz-connectors .mcp-runtime-row h3, .zz-connectors .mcp-runtime-row p { margin: 0; }
.zz-connectors .mcp-runtime-summary p, .zz-connectors .mcp-runtime-row p { margin-top: var(--sp-1); color: var(--muted2); line-height: var(--lh-body); }
.zz-connectors .mcp-runtime-summary[data-tone='success'] h3 { color: var(--ok-text); }
.zz-connectors .mcp-runtime-summary[data-tone='warning'] h3 { color: var(--warn-text); }
.zz-connectors .mcp-runtime-summary[data-tone='danger'] h3 { color: var(--danger-text); }
.zz-connectors .mcp-runtime-disclosure { border-bottom: var(--bw) solid var(--line); }
.zz-connectors .mcp-runtime-disclosure > summary { padding: var(--sp-4) 0; cursor: pointer; }
.zz-connectors .mcp-runtime-disclosure > summary span, .zz-connectors .mcp-runtime-disclosure > summary small { display: block; }
.zz-connectors .mcp-runtime-disclosure > summary small { margin-top: var(--sp-1); color: var(--muted2); font-weight: var(--fw-body); }
.zz-connectors .mcp-runtime-disclosure__content { padding: 0 0 var(--sp-4) var(--sp-4); }
.zz-connectors .mcp-runtime__footer { border-bottom: 0; }
.zz-connectors .mcp-version-row { justify-content: space-between; }
.zz-connectors .mcp-version-row { display: flex; align-items: center; justify-content: space-between; gap: var(--sp-3); padding: var(--sp-2) 0; }
@media (max-width: 760px) {
.zz-connectors .mcp-dialog { width: calc(100vw - 2 * var(--sp-2)); max-height: calc(100vh - 2 * var(--sp-2)); }
.zz-connectors .mcp-public-grid { grid-template-columns: 1fr; }
.zz-connectors .mcp-installed-card { width: 100%; flex-basis: 100%; }
.zz-connectors .mcp-installed-card__footer, .zz-connectors .mcp-installed-card__actions { flex-wrap: wrap; }
.zz-connectors .mcp-runtime { width: calc(100vw - 2 * var(--sp-2)); max-height: calc(100vh - 2 * var(--sp-2)); border-radius: var(--r-lg); }
.zz-connectors .mcp-runtime__footer, .zz-connectors .mcp-runtime__body { padding-inline: var(--sp-3); }
}
.zz-connectors .mcp-create-dialog { display: flex; width: min(760px, calc(100vw - 2 * var(--sp-5))); max-height: min(820px, calc(100dvh - 36px - 2 * var(--sp-5))); flex-direction: column; overflow: hidden; }
.zz-connectors .mcp-create-body { min-height: 0; flex: 1; overflow-y: auto; padding: var(--sp-5) var(--sp-6); overscroll-behavior: contain; }
.zz-connectors .mcp-create-single-page { display: grid; max-width: 660px; margin: 0 auto; }
.zz-connectors .mcp-create-section { display: grid; gap: var(--sp-4); padding: 0 0 var(--sp-5); border-bottom: var(--bw) solid var(--line); }
.zz-connectors .mcp-create-section + .mcp-create-section { padding-top: var(--sp-5); }
.zz-connectors .mcp-create-secondary { padding-bottom: 0; border-bottom: 0; }
.zz-connectors .mcp-create-basics-row { display: grid; grid-template-columns: minmax(0, 2fr) minmax(180px, 1fr); gap: var(--sp-4); }
.zz-connectors .mcp-create-transport { display: block; padding: 0; border: 0; }
.zz-connectors .mcp-create-transport legend { margin-bottom: var(--sp-2); color: var(--muted2); font-weight: var(--fw-label); }
.zz-connectors .mcp-create-transport > div { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: var(--sp-1); padding: var(--sp-1); border-radius: var(--r-md); background: var(--sunken); }
.zz-connectors .mcp-create-transport button { min-height: var(--ctl-h); padding: 0 var(--sp-3); border: 0; border-radius: var(--r-sm); background: transparent; color: var(--muted2); font: inherit; cursor: pointer; }
.zz-connectors .mcp-create-transport button:hover:not(:disabled) { background: var(--raised); color: var(--ink); }
.zz-connectors .mcp-create-transport button[aria-checked='true'] { background: var(--panel); color: var(--ink); font-weight: var(--fw-label); box-shadow: var(--sh-1); }
.zz-connectors .mcp-package-drop { position: relative; display: grid; min-height: 136px; place-items: center; align-content: center; gap: var(--sp-2); padding: var(--sp-5); border: 1px dashed var(--accent-line); border-radius: var(--r-lg); background: var(--accent-soft); color: var(--ink); text-align: center; cursor: pointer; transition: border-color 120ms ease, background-color 120ms ease; }
.zz-connectors .mcp-package-drop:hover, .zz-connectors .mcp-package-drop:focus-within { border-color: var(--accent); background: color-mix(in srgb, var(--accent-soft) 72%, var(--panel)); }
.zz-connectors .mcp-package-drop__icon { display: grid; width: 42px; height: 42px; place-items: center; border-radius: var(--r-md); background: var(--panel); color: var(--accent-text); box-shadow: var(--sh-1); }
.zz-connectors .mcp-package-drop[data-status='ready'] { border-color: color-mix(in srgb, var(--ok) 65%, var(--line)); background: color-mix(in srgb, var(--ok) 8%, var(--panel)); }
.zz-connectors .mcp-package-drop[data-status='ready'] .mcp-package-drop__icon { color: var(--ok-text); }
.zz-connectors .mcp-package-drop[data-status='error'] { border-color: color-mix(in srgb, var(--danger) 65%, var(--line)); background: color-mix(in srgb, var(--danger) 7%, var(--panel)); }
.zz-connectors .mcp-package-drop small { color: var(--muted2); }
.zz-connectors .mcp-package-drop__filename { max-width: min(100%, 560px); overflow: hidden; color: var(--ink); text-overflow: ellipsis; white-space: nowrap; }
.zz-connectors .mcp-package-progress { position: relative; width: min(100%, 460px); height: 6px; overflow: hidden; border-radius: 999px; background: var(--sunken); }
.zz-connectors .mcp-package-progress > span { position: absolute; inset: 0 auto 0 -35%; width: 35%; border-radius: inherit; background: var(--accent); animation: mcp-package-progress 1.1s ease-in-out infinite; }
.zz-connectors .mcp-package-drop__result { display: flex; align-items: center; justify-content: center; gap: var(--sp-2); flex-wrap: wrap; }
.zz-connectors .mcp-package-drop__result strong { color: var(--ok-text); }
.zz-connectors .mcp-package-drop__result--error { color: var(--danger); }
.zz-connectors .mcp-package-drop > .btn { min-width: 172px; justify-content: center; margin-top: var(--sp-1); pointer-events: none; }
.zz-connectors .mcp-package-drop input { position: absolute; width: 1px; height: 1px; opacity: 0; pointer-events: none; }
@keyframes mcp-package-progress { 0% { left: -35%; } 100% { left: 135%; } }
.zz-connectors .mcp-create-inline-check { display: flex; align-items: center; gap: var(--sp-2); }
.zz-connectors .mcp-config-list { display: grid; gap: var(--sp-2); }
.zz-connectors .mcp-config-list + .mcp-config-list { padding-top: var(--sp-3); border-top: var(--bw) solid var(--line); }
.zz-connectors .mcp-create-subsection { padding-top: var(--sp-4); border-top: var(--bw) solid var(--line); }
.zz-connectors .mcp-connection-check { display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: center; gap: var(--sp-2) var(--sp-4); }
.zz-connectors .mcp-connection-check > div { display: flex; align-items: center; gap: var(--sp-2); }
.zz-connectors .mcp-connection-check > p { grid-column: 1 / -1; margin: 0; color: var(--muted2); font-size: var(--fs-meta); }
.zz-connectors .mcp-check-state { color: var(--muted2); font-size: var(--fs-meta); }
.zz-connectors .mcp-check-state::before { content: ''; display: inline-block; width: 6px; height: 6px; margin-right: var(--sp-1); border-radius: 50%; background: currentColor; vertical-align: middle; }
.zz-connectors .mcp-check-state[data-status="ready"] { color: var(--success); }
.zz-connectors .mcp-check-state[data-status="error"] { color: var(--danger); }
.zz-connectors .mcp-config-list__label { color: var(--ink); font-weight: var(--fw-label); }
.zz-connectors .mcp-config-row { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr) 32px; gap: var(--sp-2); align-items: center; }
.zz-connectors .mcp-config-row--single { grid-template-columns: minmax(0, 1fr) 32px; }
.zz-connectors .mcp-create-dialog .mcp-config-row input { box-sizing: border-box; width: 100%; min-height: var(--ctl-h-lg); padding: var(--sp-2) var(--sp-3); border: var(--bw) solid var(--line-strong); border-radius: var(--r-sm); background: var(--sunken); color: var(--ink); font: inherit; transition: border-color 120ms ease, background-color 120ms ease, box-shadow 120ms ease; }
.zz-connectors .mcp-create-dialog .mcp-config-row input:hover:not(:disabled) { border-color: var(--accent-line); background: var(--panel); }
.zz-connectors .mcp-create-dialog .mcp-config-row input:focus-visible { border-color: var(--accent); background: var(--panel); outline: none; box-shadow: var(--focus-ring); }
.zz-connectors .mcp-create-dialog .mcp-config-row input::placeholder { color: var(--muted2); }
.zz-connectors .mcp-create-dialog .mcp-config-row__remove { display: grid; width: 32px; min-width: 32px; height: 32px; min-height: 32px; place-items: center; padding: 0; border: 0; border-radius: var(--r-sm); background: transparent; color: var(--muted2); cursor: pointer; }
.zz-connectors .mcp-create-dialog .mcp-config-row__remove:hover:not(:disabled) { background: var(--danger-soft); color: var(--danger); }
.zz-connectors .mcp-config-row__remove svg { display: block; width: 16px; height: 16px; fill: none; stroke: currentColor; stroke-linecap: round; stroke-linejoin: round; stroke-width: 1.6; }
.zz-connectors .mcp-create-dialog .mcp-config-list__add { display:inline-flex;align-items:center;justify-content:center;gap:var(--sp-2); width:100%; min-height: 30px; padding: 0 var(--sp-3); border: 0; border-radius: var(--r-sm); background: var(--sunken); color: var(--muted2); font: inherit; cursor: pointer; }
.zz-connectors .mcp-create-dialog .mcp-config-list__add:hover:not(:disabled) { background: var(--accent-soft); color: var(--accent-text); }
.zz-connectors .mcp-create-dialog .mcp-config-list__add:active:not(:disabled), .zz-connectors .mcp-create-dialog .mcp-config-row__remove:active:not(:disabled), .zz-connectors .mcp-create-transport button:active:not(:disabled) { transform: translateY(1px); }
.zz-connectors .mcp-create-dialog :is(button, input, select, textarea, summary):focus-visible { outline: 2px solid var(--focus-ring-color); outline-offset: 2px; }
@media (max-width: 760px) { .zz-connectors .mcp-create-dialog { width: calc(100vw - 2 * var(--sp-2)); max-height: calc(100dvh - 36px - 2 * var(--sp-2)); }
.zz-connectors .mcp-create-body { padding: var(--sp-4); }
.zz-connectors .mcp-create-transport { display: block; }
.zz-connectors .mcp-create-transport button { padding-inline: var(--sp-2); font-size: var(--fs-meta); }
}
@media (max-width: 520px) { .zz-connectors .mcp-create-basics-row { grid-template-columns: 1fr; }
.zz-connectors .mcp-config-row { grid-template-columns: minmax(0, 1fr) 32px; }
}
.zz-connectors .capability-page__content { width: 100%; max-width: 1740px; box-sizing: border-box; margin-inline: auto; padding: var(--sp-5) var(--sp-6) var(--sp-7); }
.zz-connectors .capability-featured-scenes { gap: 13px; margin: 34px 0 0; }
.zz-connectors .capability-featured-scenes__header h2 { font-size: 15px; }
.zz-connectors .capability-featured-scenes__header p { font-size: var(--fs-200); }
.zz-connectors .capability-featured-scenes__grid { gap: 11px; }
.zz-connectors button.capability-featured-scene { position: relative; display: flex; height: 138px; min-height: 138px; overflow: hidden; flex-direction: column; align-items: flex-start; justify-content: flex-end; gap: 0; padding: 17px; border: 0; border-radius: 12px; color: #f7f8f4; background: linear-gradient(180deg, transparent 16%, rgba(8, 10, 9, 0.84)), radial-gradient(circle at 72% 16%, rgba(94, 156, 255, 0.72), transparent 34%), linear-gradient(135deg, #263c5c, #171e29); box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.1); }
.zz-connectors button.capability-featured-scene:nth-child(2) { background: linear-gradient(180deg, transparent 16%, rgba(8, 10, 9, 0.84)), radial-gradient(circle at 72% 16%, rgba(178, 126, 255, 0.62), transparent 34%), linear-gradient(135deg, #3d3158, #211a2b); }
.zz-connectors button.capability-featured-scene::before { position: absolute; top: -10px; right: -12px; width: 88px; height: 88px; border: 1px solid rgba(255, 255, 255, 0.14); border-radius: 24px; content: ''; transform: rotate(24deg); }
.zz-connectors button.capability-featured-scene:hover { border: 0; color: #fff; background: linear-gradient(180deg, transparent 16%, rgba(8, 10, 9, 0.84)), radial-gradient(circle at 72% 16%, rgba(94, 156, 255, 0.8), transparent 34%), linear-gradient(135deg, #2d466b, #171e29); box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.18), 0 12px 24px rgba(0, 0, 0, 0.16); transform: translateY(-2px); }
.zz-connectors button.capability-featured-scene.is-selected { border: 0; background: linear-gradient(180deg, transparent 16%, rgba(8, 10, 9, 0.84)), radial-gradient(circle at 72% 16%, rgba(94, 156, 255, 0.82), transparent 34%), linear-gradient(135deg, #2d466b, #171e29); box-shadow: inset 0 0 0 2px var(--accent), 0 12px 24px rgba(0, 0, 0, 0.2); }
.zz-connectors .capability-featured-scene__icon { position: absolute; z-index: 1; top: 16px; left: 16px; width: auto; height: auto; border: 0; color: rgba(247, 248, 244, 0.78); background: transparent; }
.zz-connectors .capability-featured-scene__copy { z-index: 1; gap: 7px; }
.zz-connectors .capability-featured-scene__copy strong { font-size: var(--fs-500); }
.zz-connectors .capability-featured-scene__copy span { color: rgba(247, 248, 244, 0.68); font-size: var(--fs-100); }
.zz-connectors .capability-featured-scene__count { position: absolute; z-index: 1; right: 17px; bottom: 17px; color: rgba(247, 248, 244, 0.62); font: var(--fs-100) / 1 var(--font-mono); }
.zz-connectors .capability-installed__header { display: flex; align-items: center; gap: 10px; }
.zz-connectors .capability-installed__header h2 { margin: 0; font-size: 15px; }
.zz-connectors .capability-installed__header span { color: var(--muted); font: var(--fs-100) / 1 var(--font-mono); }
.zz-connectors .capability-installed__rail { display: flex; align-items: center; gap: 10px; margin-top: 16px; }
.zz-connectors button.capability-installed__empty { min-height: 34px; padding: 0 12px; border-color: var(--line); color: var(--muted2); background: var(--panel); font-size: var(--fs-200); }
.zz-connectors .connector-directory-tabs { display: flex; align-items: center; gap: 8px; margin: 28px 0 0; }
.zz-connectors .connector-directory-tabs button { min-height: 32px; padding: 4px 12px; border: 0; border-radius: 8px; color: var(--muted2); background: transparent; font-size: 14px; cursor: pointer; }
.zz-connectors .connector-directory-tabs button[aria-selected=true] { color: var(--ink); background: var(--raised); font-weight: 650; }
.zz-connectors .connector-directory-tabs button:disabled { cursor: default; opacity: .5; }
.zz-connectors .connector-directory-tabs + .zz-directory-section { margin-top: 16px; }
@media (max-width: 760px) { .zz-connectors .capability-page__content { padding: var(--sp-4) var(--sp-3) var(--sp-6); }
.zz-connectors .capability-featured-scenes__grid { grid-template-columns: 1fr; }
}
.zz-connectors .capability-featured-scenes { display: grid; gap: var(--sp-3); margin: var(--sp-2) 0 var(--sp-6); }
.zz-connectors .capability-featured-scenes__header { display: flex; align-items: flex-end; justify-content: space-between; }
.zz-connectors .capability-featured-scenes__header h2, .zz-connectors .capability-featured-scenes__header p { margin: 0; }
.zz-connectors .capability-featured-scenes__header h2 { font-size: var(--fs-500); }
.zz-connectors .capability-featured-scenes__header p { margin-top: var(--sp-1); color: var(--muted2); font-size: var(--fs-200); }
.zz-connectors .capability-featured-scenes__grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: var(--sp-3); }
.zz-connectors button.capability-featured-scene { display: grid; min-height: 112px; grid-template-columns: auto minmax(0, 1fr) auto; align-items: center; gap: var(--sp-4); padding: var(--sp-4) var(--sp-5); border-color: var(--line); border-radius: var(--r-xl); background: linear-gradient( 135deg, var(--panel), color-mix(in srgb, var(--accent-soft) 22%, var(--panel)) ); text-align: left; }
.zz-connectors button.capability-featured-scene:hover { border-color: var(--line-strong); background: var(--raised, var(--panel)); transform: translateY(-1px); box-shadow: var(--sh-2); }
.zz-connectors button.capability-featured-scene.is-selected { border-color: var(--line-strong); background: var(--sunken); box-shadow: inset 0 0 0 1px var(--line-strong); }
.zz-connectors .capability-featured-scene__icon { display: grid; width: 42px; height: 42px; place-items: center; border: var(--bw) solid var(--line); border-radius: var(--r-lg); color: var(--accent-text); background: var(--panel); }
.zz-connectors .capability-featured-scene__copy { display: grid; gap: var(--sp-1); }
.zz-connectors .capability-featured-scene__copy strong { font-size: var(--fs-500); }
.zz-connectors .capability-featured-scene__copy span, .zz-connectors .capability-featured-scene__count { color: var(--muted2); font-size: var(--fs-200); }
.zz-connectors .capability-featured-scene__count { min-width: 24px; text-align: right; font-variant-numeric: tabular-nums; }
@media (max-width: 760px) { .zz-connectors .capability-featured-scenes__grid { grid-template-columns: 1fr; }
}
.zz-connectors .capability-featured-scenes { gap: 13px; margin: 34px 0 0; }
.zz-connectors .capability-featured-scenes__header h2 { font-size: 15px; }
.zz-connectors .capability-featured-scenes__grid { gap: 11px; }
.zz-connectors button.capability-featured-scene { position: relative; display: flex; height: auto; min-height: 0; overflow: visible; flex-direction: row; align-items: center; justify-content: flex-start; gap: 13px; padding: 14px 17px; border: var(--bw) solid var(--line); border-radius: var(--r-lg); color: var(--ink); background: linear-gradient(135deg, var(--panel), var(--sunken)); box-shadow: none; text-align: left; transition: transform var(--d-pop) var(--spring-smooth), border-color var(--d-pop) var(--spring-smooth), box-shadow var(--d-pop) var(--spring-smooth); }
.zz-connectors button.capability-featured-scene:nth-child(2) { background: linear-gradient(135deg, var(--panel), var(--sunken)); }
.zz-connectors button.capability-featured-scene::before { content: none; }
.zz-connectors button.capability-featured-scene:hover { transform: translateY(-2px); box-shadow: var(--sh-2); }
.zz-connectors button.capability-featured-scene.is-selected { border-color: color-mix(in srgb, var(--accent) 55%, transparent); box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--accent) 55%, transparent), var(--sh-1); }
.zz-connectors .capability-featured-scene__icon { position: static; z-index: 1; display: grid; width: 34px; height: 34px; flex: 0 0 auto; border: 0; border-radius: 9px; color: var(--accent-text); background: var(--accent-soft); place-items: center; transition: transform var(--d-press) var(--spring-snappy); }
.zz-connectors .capability-featured-scene.is-selected .capability-featured-scene__icon svg { stroke-width: 2.2; }
.zz-connectors .capability-featured-scene__copy { z-index: 1; min-width: 0; gap: 2px; }
.zz-connectors .capability-featured-scene__copy strong { color: var(--ink); font-size: var(--fs-400); }
.zz-connectors .capability-featured-scene__copy span { color: var(--muted2); font-size: var(--fs-200); }
.zz-connectors .capability-featured-scene__count { position: static; z-index: 1; margin-left: auto; color: var(--muted2); font: var(--fs-100) / 1 var(--font-mono); }
@media (max-width: 760px) { .zz-connectors .capability-featured-scenes__grid { grid-template-columns: 1fr; }
}
.zz-connectors .header-actions {display:flex;align-items:center;gap:10px;margin-left:auto}
.zz-connectors .zz-tools-dialog {width:min(960px,94vw)}
.zz-connectors .zz-tools-layout {display:grid;grid-template-columns:260px minmax(0,1fr);min-height:360px;max-height:65vh;overflow:hidden}
.zz-connectors .zz-tools-list {border-right:1px solid var(--line);padding:20px;overflow:auto}
.zz-connectors .zz-tool-option {display:grid;gap:5px;width:100%;padding:12px 8px;border:0;background:transparent;color:var(--ink);text-align:left;cursor:pointer}
.zz-connectors .zz-tool-option[aria-pressed=true] {background:var(--accent-soft);color:var(--accent-text)}
.zz-connectors .zz-tool-option small {color:var(--muted2);display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.zz-connectors .zz-tool-detail {padding:24px;overflow:auto;overflow-wrap:anywhere}
.zz-connectors pre {white-space:pre-wrap;overflow-wrap:anywhere;padding:14px;background:var(--sunken);border-radius:8px;font:12px/1.6 var(--font-mono)}
.zz-connectors .mcp-create-dialog {max-height:calc(100dvh - 80px)}
.zz-connectors .mcp-runtime {grid-template-rows:auto minmax(0,1fr) auto}
.zz-connectors .mcp-runtime__body {overflow-wrap:anywhere}
.zz-connectors .mcp-runtime-tools-summary__list {display:flex;flex-wrap:wrap;gap:6px;list-style:none;padding:0;font:12px var(--font-mono)}
.zz-connectors .mcp-installed-card__identity {text-align:left}
@media(max-width:700px){.zz-connectors .resource-page-nav {height:auto;min-height:54px;flex-wrap:wrap;padding:10px}.zz-connectors .zz-tools-layout {grid-template-columns:1fr}.zz-connectors .zz-tools-list {max-height:180px;border-right:0;border-bottom:1px solid var(--line)}}
`
