export const styles = `
.seal-harness-local-projects { padding-bottom: 0; }
.seal-harness-local-projects .resource-page-nav { padding-inline: var(--sp-6); }
.seal-harness-local-projects .resource-page-nav > .btn { margin-left: auto; }
.seal-harness-local-projects-content { width: 100%; max-width: 1740px; margin-inline: auto; padding: var(--sp-5) var(--sp-6) var(--sp-7); }
.seal-harness-local-projects .resource-page-hero { display: block; margin-bottom: var(--sp-7); }
.seal-harness-local-projects .resource-page-hero h1 { font-size: var(--fs-700); }
.seal-harness-local-projects .resource-page-hero__subtitle { margin-top: var(--sp-2); font-size: var(--fs-300); }
.seal-harness-local-projects h2 { margin: 0; color: var(--ink); font-size: var(--fs-500); font-weight: var(--fw-title); }
.seal-harness-local-projects p { margin: 0; color: var(--muted2); line-height: 1.6; }
.seal-harness-local-projects .btn:disabled { opacity: .55; cursor: default; }
.seal-harness-local-projects-list { display: grid; gap: var(--sp-4); }
.seal-harness-local-projects-list article { display: flex; align-items: center; justify-content: space-between; gap: var(--sp-5); padding: var(--sp-5); border: var(--bw) solid var(--line); border-radius: var(--r-lg); background: var(--panel); box-shadow: var(--sh-1); }
.seal-harness-local-projects-list article > div:first-child { min-width: 0; }
.seal-harness-local-projects-list article h2 { margin-bottom: var(--sp-1); }
.seal-harness-local-projects-path { max-width: 70ch; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font: var(--fs-meta)/1.5 var(--font-mono); }
.seal-harness-local-projects-actions { display: flex; align-items: center; gap: var(--sp-2); flex-wrap: wrap; }
.seal-harness-local-projects-empty { min-height: 240px; display: grid; align-content: center; justify-items: center; gap: var(--sp-3); text-align: center; }
.seal-harness-local-projects-empty p { font-size: var(--fs-300); }
.seal-harness-local-projects-empty button { margin-top: var(--sp-2); }
.seal-harness-local-projects-form { display: grid; gap: var(--sp-4); max-width: 760px; padding: var(--sp-6); border: var(--bw) solid var(--line); border-radius: var(--r-lg); background: var(--panel); box-shadow: var(--sh-1); }
.seal-harness-local-projects-form label { display: grid; gap: var(--sp-2); color: var(--ink); font-size: var(--fs-300); font-weight: var(--fw-label); }
.seal-harness-local-projects-form input, .seal-harness-local-projects-form textarea { width: 100%; padding: 9px 11px; border: var(--bw) solid var(--line-strong); border-radius: var(--r-md); background: var(--raised); color: var(--ink); }
.seal-harness-local-projects-form textarea { min-height: 90px; resize: vertical; }
.seal-harness-local-projects-form > div { display: flex; gap: var(--sp-2); justify-content: flex-end; }
.seal-harness-local-projects-error, .seal-harness-local-projects-notice { margin-bottom: var(--sp-4) !important; }
.seal-harness-local-projects-error { color: var(--danger-text) !important; }
.seal-harness-local-projects-notice { color: var(--ok-text) !important; }
.seal-harness-local-projects-overlay { position: fixed; inset: 0; z-index: var(--z-modal); display: grid; place-items: center; padding: var(--sp-4); background: var(--scrim); }
.seal-harness-local-projects-overlay > div { width: min(100%, 430px); padding: var(--sp-6); border: var(--bw) solid var(--line); border-radius: var(--r-lg); background: var(--raised); box-shadow: var(--sh-3); }
.seal-harness-local-projects-overlay h2 { margin-bottom: var(--sp-3); }
.seal-harness-local-projects-overlay footer { display: flex; justify-content: flex-end; gap: var(--sp-2); margin-top: var(--sp-5); }
@media (max-width: 760px) {
  .seal-harness-local-projects .resource-page-nav { min-height: 54px; height: auto; flex-wrap: wrap; padding: var(--sp-2) var(--sp-3); }
  .seal-harness-local-projects-content { padding: var(--sp-4) var(--sp-3) var(--sp-6); }
  .seal-harness-local-projects-list article { display: block; }
  .seal-harness-local-projects-actions { margin-top: var(--sp-4); }
}
`
