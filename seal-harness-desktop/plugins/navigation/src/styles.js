export const styles = `
/* The public shell.overlay owns the product rail; Desktop keeps its own sidebar and main slots. */
#root :has(> [data-shell-overlay]) { box-sizing: border-box; padding-left: 56px; }
#root :has(> [data-shell-overlay]) > [data-side="sidebar"] { transform: translateX(56px); }
#root [data-slot="sidebar"] button[aria-label="插件"], #root [data-slot="sidebar"] button[aria-label="Plugins"] { display: none !important; }
.seal-nav-rail { position: absolute; z-index: 2; inset: 0 auto 0 0; display: flex; flex-direction: column; align-items: center; gap: 8px; width: 56px; padding: 48px 7px 14px; box-sizing: border-box; border-right: 1px solid var(--dsw-alias-border-l1,#34363b); background: var(--dsw-alias-bg-layer-1,#1c1d20); color: var(--dsw-alias-label-secondary,#a6a8ae); pointer-events: auto; -webkit-app-region: no-drag; }
.seal-nav-rail button { display: grid; width: 42px; height: 42px; padding: 0; place-items: center; border: 0; border-radius: 12px; background: transparent; color: inherit; cursor: pointer; }
.seal-nav-rail button:hover { background: var(--dsw-alias-interactive-bg-hover,#34363b); color: var(--dsw-alias-label-primary,#fff); }
.seal-nav-rail button[aria-current="page"] { background: var(--dsw-alias-interactive-bg-hover,#34363b); color: var(--dsw-alias-label-primary,#fff); }
.seal-nav-rail button:focus-visible, .seal-nav-secondary button:focus-visible { outline: 2px solid var(--dsw-alias-brand-primary,#6d9cf5); outline-offset: 2px; }
.seal-nav-secondary { display: flex; height: 100%; min-height: 0; flex-direction: column; gap: 3px; overflow-y: auto; padding: 18px 12px; box-sizing: border-box; color: var(--dsw-alias-label-primary,#fff); }
.seal-nav-secondary header { margin: 0 8px 20px; }
.seal-nav-secondary header span { color: var(--dsw-alias-label-tertiary,#92949a); font-size: 10px; font-weight: 700; letter-spacing: .14em; }
.seal-nav-secondary h2 { margin: 5px 0 0; font-size: 19px; line-height: 1.3; }
.seal-nav-secondary button { display: flex; width: 100%; min-height: 40px; align-items: center; gap: 11px; padding: 8px 12px; border: 0; border-radius: 9px; background: transparent; color: var(--dsw-alias-label-secondary,#b2b4ba); font: inherit; text-align: left; cursor: pointer; }
.seal-nav-secondary button:hover, .seal-nav-secondary button[aria-current="page"] { background: var(--dsw-alias-interactive-bg-hover,#303137); color: var(--dsw-alias-label-primary,#fff); }
.seal-nav-secondary__empty { margin: 10px 12px; color: var(--dsw-alias-label-secondary,#b2b4ba); font-size: 13px; }
.seal-nav-content { display: flex; width: 100%; height: 100%; min-width: 0; min-height: 0; flex-direction: column; overflow: hidden; }
.seal-nav-content > :last-child { min-height: 0; flex: 1; }
.seal-nav-content .resource-page-nav__back { display: none; }
.seal-nav-compact-tabs, .seal-nav-plugin-tabs { display: none; box-sizing: border-box; align-items: center; gap: 4px; height: 52px; min-height: 52px; padding: 8px 16px; overflow-x: auto; border-bottom: 1px solid var(--dsw-alias-border-l1,#34363b); background: var(--dsw-alias-bg-layer-1,#1c1d20); }
.seal-nav-compact-tabs button, .seal-nav-plugin-tabs button { flex: none; padding: 7px 11px; border: 0; border-radius: 8px; background: transparent; color: var(--dsw-alias-label-secondary,#b2b4ba); font: inherit; cursor: pointer; }
.seal-nav-compact-tabs button[aria-current="page"], .seal-nav-compact-tabs button:hover, .seal-nav-plugin-tabs button[aria-current="page"], .seal-nav-plugin-tabs button:hover { background: var(--dsw-alias-interactive-bg-hover,#34363b); color: var(--dsw-alias-label-primary,#fff); }
.seal-nav-page { width: 100%; height: 100%; overflow: auto; box-sizing: border-box; padding: clamp(32px,5vw,72px); background: var(--dsw-alias-bg-base,#151618); color: var(--dsw-alias-label-primary,#fff); font: 14px/1.6 "Segoe UI Variable Text","Segoe UI","Microsoft YaHei UI",sans-serif; }
.seal-nav-page__eyebrow { margin: 0 0 10px; color: var(--dsw-alias-label-tertiary,#92949a); font-size: 11px; font-weight: 700; letter-spacing: .15em; }
.seal-nav-page h1 { margin: 0; font-size: clamp(28px,3vw,42px); line-height: 1.25; letter-spacing: -.03em; }
.seal-nav-page > p:not(.seal-nav-page__eyebrow), .seal-nav-page__heading p { margin: 12px 0 0; color: var(--dsw-alias-label-secondary,#b2b4ba); }
.seal-nav-page__heading { display: flex; align-items: end; justify-content: space-between; gap: 20px; }
.seal-nav-page__heading button { min-height: 36px; padding: 0 16px; border: 1px solid var(--dsw-alias-border-l2,#45464b); border-radius: 9px; background: var(--dsw-alias-bg-layer-1,#242529); color: inherit; cursor: pointer; }
.seal-nav-page__heading button:disabled { opacity: .5; cursor: default; }
.seal-nav-spaces-grid { display: grid; grid-template-columns: repeat(auto-fit,minmax(230px,1fr)); gap: 14px; max-width: 1050px; margin-top: 38px; }
.seal-nav-spaces-grid button { display: flex; min-height: 170px; flex-direction: column; align-items: flex-start; gap: 10px; padding: 22px; border: 1px solid var(--dsw-alias-border-l2,#393b40); border-radius: 16px; background: var(--dsw-alias-bg-layer-1,#242529); color: inherit; font: inherit; text-align: left; cursor: pointer; }
.seal-nav-spaces-grid button:hover { border-color: var(--dsw-alias-brand-primary,#6d9cf5); transform: translateY(-2px); }
.seal-nav-spaces-grid button strong { font-size: 18px; }
.seal-nav-spaces-grid button small { color: var(--dsw-alias-label-secondary,#b2b4ba); }
.seal-nav-spaces-grid button span { margin-top: auto; color: var(--dsw-alias-brand-primary,#8ab3ff); }
.seal-nav-spaces-grid button small { overflow: hidden; max-width: 100%; text-overflow: ellipsis; white-space: nowrap; }
.seal-nav-page__empty { display: grid; max-width: 700px; min-height: 260px; align-content: center; justify-items: center; gap: 8px; margin: 42px auto; text-align: center; color: var(--dsw-alias-label-secondary,#b2b4ba); }
.seal-nav-page__empty h2 { margin: 4px 0; color: var(--dsw-alias-label-primary,#fff); font-size: 20px; }
.seal-nav-page__empty p { margin: 0; }
.seal-nav-page__error { color: var(--dsw-alias-state-error-primary,#e15a5a) !important; }
@media (max-width: 800px) { .seal-nav-rail { width: 48px; padding-inline: 3px; } #root :has(> [data-shell-overlay]) { padding-left: 48px; } #root :has(> [data-shell-overlay]) > [data-side="sidebar"] { transform: translateX(48px); } .seal-nav-page { padding: 24px; } .seal-nav-page__heading { align-items: flex-start; flex-direction: column; } }
#root [data-sidebar-collapsed] .seal-nav-secondary { display: none; }
#root [data-sidebar-collapsed] .seal-nav-compact-tabs { display: flex; }
#root [data-sidebar-collapsed] .seal-nav-plugin-tabs { position: absolute; z-index: 3; top: 0; right: 0; left: 112px; display: flex; pointer-events: auto; }
#root [data-sidebar-collapsed]:has(.seal-nav-plugin-tabs) [data-plugin-panel] { padding-top: 52px; }
@media (max-width: 800px) { #root [data-sidebar-collapsed] .seal-nav-plugin-tabs { left: 104px; } }
#root [data-desktop-mode="advanced"][data-desktop-platform="win32"][data-sidebar-collapsed] .seal-nav-plugin-tabs { top: 32px; }
#root [data-desktop-mode="advanced"][data-desktop-platform="darwin"][data-sidebar-collapsed] .seal-nav-plugin-tabs { top: 32px; }
`
