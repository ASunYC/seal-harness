// 来源：Stratex 070ba39e82a4d47dec812870b691eedcb7f7b28e，styles/tokens.css、components.css 与 resource-pages.css。
// 仅作用于产品内部页面；颜色接入 DSH 主题，尺寸与资源页结构沿用来源。
export const resourceStyles = `
.zz-resource-page {
  --font-sans: "Segoe UI Variable Text", "Segoe UI", "Microsoft YaHei UI", system-ui, -apple-system, "Noto Sans SC", sans-serif;
  --font-mono: "SF Mono", "JetBrains Mono", Consolas, Menlo, "PingFang SC", monospace;
  --fs-100:11px; --fs-200:12px; --fs-300:13px; --fs-400:14px; --fs-500:16px; --fs-600:20px; --fs-700:26px;
  --fw-body:400; --fw-label:500; --fw-title:600;
  --sp-1:3px; --sp-2:6px; --sp-3:10px; --sp-4:14px; --sp-5:20px; --sp-6:28px; --sp-7:40px;
  --r-sm:6px; --r-md:8px; --r-lg:12px; --r-xl:16px; --r-pill:999px;
  --bw:.5px; --bw-strong:2px; --bw-rule:3px;
  --ctl-h-sm:26px; --ctl-h:32px; --ctl-h-lg:40px; --row-h:32px;
  --lh-tight:1.6; --lh-body:1.75; --lh-mono:1.55;
  --card-pad:16px; --card-gap:14px; --grid-min:280px;
  --fs-body:var(--fs-400); --fs-meta:var(--fs-200);
  --z-base:0; --z-sticky:10; --z-dropdown:100; --z-scrim:300; --z-drawer:305; --z-modal:310; --z-toast:400;
  --dur-1:90ms; --dur-2:150ms; --dur-3:220ms; --ease-out:cubic-bezier(.2,.8,.3,1);
  --bg:var(--dsw-alias-bg-base,#fff); --panel:var(--dsw-alias-bg-layer-1,#fff);
  --raised:var(--dsw-alias-bg-layer-2,var(--panel)); --sunken:color-mix(in srgb,var(--ink) 4%,var(--bg));
  --ink:var(--dsw-alias-label-primary,#0f1115); --muted2:var(--dsw-alias-label-secondary,#61666b); --muted:var(--dsw-alias-label-tertiary,#81858c);
  --line:color-mix(in srgb,var(--ink) 12%,transparent); --line-strong:color-mix(in srgb,var(--ink) 20%,transparent); --line-weak:color-mix(in srgb,var(--ink) 6%,transparent);
  --accent:var(--dsw-alias-brand-primary,#4176e6); --accent-text:var(--accent); --accent-hover:var(--accent);
  --accent-soft:color-mix(in srgb,var(--accent) 10%,var(--bg)); --accent-line:color-mix(in srgb,var(--accent) 32%,transparent);
  --btn-p-bg:var(--ink); --btn-p-fg:var(--bg); --on-accent-icon:#fff;
  --danger:var(--dsw-alias-state-error-primary,#ec1313); --danger-text:var(--danger); --danger-hover:var(--danger); --danger-soft:color-mix(in srgb,var(--danger) 9%,var(--bg)); --danger-line:color-mix(in srgb,var(--danger) 28%,transparent);
  --ok:#22c55e; --ok-text:var(--ok); --ok-soft:color-mix(in srgb,var(--ok) 10%,var(--bg)); --ok-line:color-mix(in srgb,var(--ok) 32%,transparent);
  --warn:#f59e0b; --warn-text:#dd8629; --warn-soft:color-mix(in srgb,var(--warn) 10%,var(--bg)); --warn-line:color-mix(in srgb,var(--warn) 32%,transparent);
  --on-danger:#fff; --scrim:rgba(0,0,0,.32); --focus-ring:0 0 0 2px var(--panel),0 0 0 4px var(--focus-ring-color); --focus-ring-color:var(--accent); --focus-ring-flat:0 0 0 2px var(--accent);
  --sh-1:0 3px 8px #00000008,0 0 16px #00000005; --sh-2:0 4px 16px #00000008,0 0 24px #00000008; --sh-3:0 3px 8px #0000000a,0 0 20px #0000000d;
  color:var(--ink); background:var(--bg); font:var(--fs-400)/1.6 var(--font-sans);
  min-width:0; min-height:0; height:100%; overflow:auto; box-sizing:border-box;
}
.zz-resource-page *, .zz-resource-page *::before, .zz-resource-page *::after { box-sizing:border-box; }
.zz-resource-page :is(button,input,select,textarea) { font:inherit; }
.zz-resource-page :focus-visible { outline:2px solid var(--focus-ring-color); outline-offset:3px; }
/* Shared resource-page chrome. The approved wide prototype is the acceptance baseline. */
:is(.zz-resource-page.resource-page-shell,.zz-resource-page .resource-page-shell) {
  min-height: 100%;
  width: 100%;
  max-width: 1760px;
  box-sizing: border-box;
  margin-inline: auto;
  padding: var(--sp-6) clamp(var(--sp-4), 3vw, var(--sp-7)) var(--sp-7);
  color: var(--ink);
  background: var(--bg);
}

.zz-resource-page .resource-page-nav {
  position: sticky;
  z-index: var(--z-sticky);
  top: 0;
  display: flex;
  width: 100%;
  height: 54px;
  box-sizing: border-box;
  align-items: center;
  gap: 18px;
  padding: 0 28px;
  border-bottom: var(--bw) solid var(--line);
  background: color-mix(in srgb, var(--bg) 94%, transparent);
  backdrop-filter: blur(16px);
}

.zz-resource-page .resource-page-nav__path {
  display: flex;
  min-width: 0;
  align-items: center;
  gap: 10px;
}

.zz-resource-page .resource-page-nav__path strong {
  font-size: var(--fs-300);
  font-weight: var(--fw-title);
}

.zz-resource-page button.resource-page-nav__back {
  display: grid;
  width: 32px;
  min-width: 32px;
  height: 32px;
  margin-left: -7px;
  padding: 0;
  border: 0;
  border-radius: 8px;
  color: var(--muted2);
  background: transparent;
  place-items: center;
  cursor: pointer;
}

.zz-resource-page button.resource-page-nav__back:hover {
  color: var(--ink);
  background: var(--panel);
}

.zz-resource-page .resource-page-nav__badge {
  padding: 3px 7px;
  border-radius: var(--r-pill);
  color: var(--accent-text);
  background: var(--accent-soft);
  font: var(--fw-label) 10px / 1.2 var(--font-mono);
  letter-spacing: 0.04em;
}

.zz-resource-page .resource-page-hero {
  display: grid;
  grid-template-columns: minmax(290px, 0.72fr) minmax(520px, 1.28fr);
  align-items: end;
  gap: 56px;
}

.zz-resource-page .resource-page-hero__eyebrow {
  margin: 0 0 9px;
  color: var(--accent-text);
  font-size: var(--fs-100);
  font-weight: 750;
  letter-spacing: 0.12em;
}

.zz-resource-page .resource-page-hero h1 {
  margin: 0;
  color: var(--ink);
  font-size: clamp(34px, 3vw, 46px);
  font-weight: 680;
  letter-spacing: -0.045em;
  line-height: 1.05;
}

.zz-resource-page .resource-page-hero__subtitle {
  margin: 12px 0 0;
  color: var(--muted2);
  font-size: 15px;
  line-height: 1.6;
}

.zz-resource-page .resource-page-hero :is(.experts-search, .library-search, .capability-header-search) {
  height: 48px;
  min-height: 48px;
}

@media (max-width: 1200px) {
  .zz-resource-page .resource-page-hero {
    grid-template-columns: 1fr;
    gap: 22px;
  }
}

@media (max-width: 760px) {
  :is(.zz-resource-page.resource-page-shell,.zz-resource-page .resource-page-shell) {
    padding: var(--sp-5) var(--sp-4) var(--sp-7);
  }
  .zz-resource-page .resource-page-nav {
    padding-inline: 18px;
  }
  .zz-resource-page .resource-page-nav__badge {
    display: none;
  }
  .zz-resource-page .resource-page-hero {
    grid-template-columns: 1fr;
    gap: 22px;
  }
}

@media (max-height: 700px) {
  :is(.zz-resource-page.resource-page-shell,.zz-resource-page .resource-page-shell) {
    padding-top: var(--sp-5);
  }
}
.zz-resource-page .btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: var(--sp-2);
  height: var(--ctl-h);
  padding: 0 calc(var(--sp-3) + var(--sp-2));
  border: var(--bw) solid transparent;

  border-radius: var(--r-md);

  font: var(--fw-label) var(--fs-body) / 1 var(--font-sans);
  cursor: pointer;
  white-space: nowrap;
  user-select: none;
  transition:
    background-color var(--dur-1) var(--ease-out),
    border-color var(--dur-1) var(--ease-out),
    transform var(--dur-1) var(--ease-out);
}

.zz-resource-page .btn--primary {
  background: var(--btn-p-bg);
  color: var(--btn-p-fg);
}

.zz-resource-page .btn--primary:hover {
  box-shadow: 0 4px 16px color-mix(in srgb, var(--btn-p-bg) 30%, transparent);
}
.zz-resource-page .btn--primary.btn--danger {
  background: var(--danger);
  color: var(--on-danger);
}
.zz-resource-page .btn--primary.btn--danger:hover {
  background: var(--danger-hover);
}

.zz-resource-page .btn--primary.btn--danger:focus-visible {
  box-shadow:
    0 0 0 2px var(--panel),
    0 0 0 4px var(--danger);
}

.zz-resource-page .btn--secondary {
  background: var(--panel);
  border-color: var(--line-strong);
  color: var(--ink);
}
.zz-resource-page .btn--secondary:hover {
  background: var(--sunken);
  border-color: var(--accent-line);
}

.zz-resource-page .btn--ghost {
  background: transparent;
  color: var(--muted2);
}
.zz-resource-page .btn--ghost:hover {
  background: var(--sunken);
  color: var(--ink);
}

.zz-resource-page .btn:focus-visible {
  outline: none;
  box-shadow: var(--focus-ring);
}
.zz-resource-page .btn:active:not([aria-disabled='true']):not(:disabled) {
  transform: translateY(1px);
}


.zz-resource-page .btn[aria-disabled='true'],
.zz-resource-page .btn:disabled {
  pointer-events: none;
  background: var(--line);
  border-color: var(--line);
  color: var(--muted);
}
.zz-resource-page .btn--secondary[aria-disabled='true'],
.zz-resource-page .btn--ghost[aria-disabled='true'],
.zz-resource-page .btn--secondary:disabled,
.zz-resource-page .btn--ghost:disabled {
  background: transparent;
}

.zz-resource-page .btn__spin {
  width: 12px;
  height: 12px;
  border-radius: var(--r-pill);
  border: 2px solid currentColor;
  border-top-color: transparent;
  animation: zz-resource-spin 0.7s linear infinite;
  opacity: 0.85;
}
@keyframes zz-resource-spin {
  to {
    transform: rotate(360deg);
  }
}


.zz-resource-page .tnum {
  font-variant-numeric: tabular-nums;
}
`
