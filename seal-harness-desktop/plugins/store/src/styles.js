import { fileStyles } from '../../skills/src/file-styles.js'
// 来源：Stratex SkillCatalogExperience.vue / SkillPlatformCatalog.vue，070ba39e82。
export const styles = `.zz-resource-page.zz-store {

.skill-catalog-page {
  min-height: 100%;
  color: var(--ink);
}

.skill-catalog-page__content {
  display: grid;
  gap: 0;
  max-width: none;
  margin: 0;
  padding: 34px 26px 44px;
}

.skill-catalog-hero {
  display: block;
}

.skill-catalog-hero h1,
.skill-catalog-hero p {
  margin: 0;
}

.skill-catalog-hero h1 {
  font-size: clamp(26px, 3vw, 36px);
  font-weight: 680;
  line-height: 1.12;
  letter-spacing: -0.022em;
}

.skill-catalog-hero p:last-child {
  margin-top: 9px;
  color: var(--muted2);
  font-size: 13.5px;
  line-height: 1.7;
}

.skill-catalog-primary-tabs,
.skill-catalog-secondary-tabs,
.skill-catalog-toolbar,
.skill-catalog-search,
.skill-installation-filter,
.skill-catalog-header-actions {
  display: flex;
  align-items: center;
}

.skill-catalog-header-actions {
  gap: var(--sp-3);
}

.skill-catalog-header-actions :slotted(button:focus-visible) {
  outline: none;
  box-shadow: var(--focus-ring-flat);
}

.skill-catalog-primary-tabs {
  gap: 8px;
  margin: 24px 0 16px;
}

.skill-catalog-primary-tabs button,
.skill-catalog-secondary-tabs button {
  border: 0;
  color: var(--muted2);
  background: transparent;
  cursor: pointer;
}

.skill-catalog-primary-tabs button {
  min-height: 32px;
  padding: 4px 12px;
  border-radius: 8px;
  font-size: 14px;
}

.skill-catalog-primary-tabs button.is-active {
  color: var(--ink);
  background: var(--raised);
  font-weight: 650;
}

.skill-catalog-panel {
  display: grid;
  gap: 0;
}

.skill-catalog-personal-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  border-bottom: var(--bw) solid var(--line);
}

.skill-catalog-secondary-tabs {
  gap: 24px;
}

.skill-catalog-secondary-tabs button {
  position: relative;
  min-height: 36px;
  padding: 7px 0;
  border-radius: 0;
  font-size: 13px;
}

.skill-catalog-secondary-tabs button.is-active {
  color: var(--ink);
  font-weight: 650;
}

.skill-catalog-secondary-tabs button.is-active::after {
  position: absolute;
  right: 0;
  bottom: -1px;
  left: 0;
  height: 2px;
  background: var(--ink);
  content: '';
}

.skill-catalog-toolbar {
  gap: 10px;
  margin: 20px 0 26px;
}

.skill-catalog-search {
  height: 42px;
  min-width: 0;
  flex: 1;
  gap: 9px;
  padding: 0 14px;
  border: var(--bw) solid var(--line-strong);
  border-radius: 12px;
  color: var(--muted2);
  background: var(--panel);
}

.skill-catalog-search:focus-within {
  border-color: var(--accent);
  box-shadow: var(--focus-ring-flat);
}

.skill-catalog-search input {
  width: 100%;
  min-width: 0;
  min-height: 36px;
  border: 0;
  outline: 0;
  color: var(--ink);
  background: transparent;
  font: 13px var(--font-sans);
}

.skill-catalog-search input::placeholder {
  color: var(--muted2);
}

.skill-catalog-search kbd {
  padding: 0 5px;
  border: var(--bw) solid var(--line-strong);
  border-bottom-width: 2px;
  border-radius: 4px;
  color: var(--muted2);
  font: 600 10px var(--font-mono);
  white-space: nowrap;
}

.skill-catalog-search .search-clear {
  display: grid;
  width: 28px;
  min-width: 28px;
  height: 28px;
  min-height: 28px;
  padding: 0;
  border: 0;
  border-radius: 7px;
  color: var(--muted2);
  background: transparent;
  place-items: center;
}

.skill-installation-filter {
  height: 36px;
  gap: 7px;
  padding: 0 10px;
  border: var(--bw) solid var(--line-strong);
  border-radius: 8px;
  color: var(--muted2);
  background: var(--panel);
}

.skill-installation-filter:focus-within {
  border-color: var(--accent);
  box-shadow: var(--focus-ring-flat);
}

.skill-installation-filter select {
  min-height: 31px;
  border: 0;
  outline: 0;
  color: var(--ink);
  background: var(--panel);
  font: 12px var(--font-sans);
}

.skill-installation-filter option {
  color: var(--ink);
  background: var(--panel);
}

@media (max-width: 760px) {
  .skill-catalog-page__content {
    padding: 24px 16px 40px;
  }

  .skill-catalog-toolbar {
    flex-wrap: wrap;
  }

  .skill-catalog-search {
    flex-basis: 100%;
  }

  .skill-catalog-search input {
    font-size: 16px;
  }

  .skill-catalog-search kbd {
    display: none;
  }

  .skill-installation-filter {
    height: 44px;
    min-height: 44px;
  }

  .skill-installation-filter select {
    font-size: 14px;
  }

  .skill-catalog-primary-tabs button {
    min-height: 44px;
  }
}


.skill-platform-catalog {
  display: grid;
  gap: 26px;
}

.skill-platform-section {
  display: grid;
  gap: 0;
}

.skill-platform-section__header {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 13px;
  padding-bottom: 7px;
  border-bottom: var(--bw) solid var(--line);
}

.skill-platform-section__header h2 {
  margin: 0;
  color: var(--ink);
  font-size: 14px;
  font-weight: 650;
}

.skill-platform-section__header span {
  color: var(--muted2);
  font-size: 12px;
}

.skill-platform-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  column-gap: 40px;
}

.skill-platform-row {
  display: grid;
  grid-template-columns: 38px minmax(0, 1fr) 28px;
  align-items: center;
  gap: 13px;
  min-height: 86px;
  padding: 13px 0;
  border: 0;
  border-bottom: var(--bw) solid var(--line);
  border-radius: 0;
  background: transparent;
  transition: background-color 140ms ease;
}

.skill-platform-row:hover {
  background: color-mix(in srgb, var(--raised) 52%, transparent);
}

.skill-platform-row__icon {
  display: grid;
  place-items: center;
  width: 38px;
  height: 38px;
  border: var(--bw) solid var(--line);
  border-radius: 10px;
  color: var(--accent-text);
  background: var(--panel);
}

.skill-platform-row__copy,
.skill-platform-row__action {
  border: 0;
  color: inherit;
  background: transparent;
}

.skill-platform-row__copy {
  display: grid;
  gap: 2px;
  min-width: 0;
  padding: 0;
  text-align: left;
}

.skill-platform-row__title {
  display: flex;
  align-items: center;
  gap: 7px;
  min-width: 0;
}

.skill-platform-row__title strong {
  overflow: hidden;
  color: var(--ink);
  font-size: 14px;
  font-weight: 650;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.skill-installation-label {
  display: inline-flex;
  flex: none;
  align-items: center;
  gap: 3px;
  padding: 1px 6px;
  border: 0;
  border-radius: 5px;
  color: var(--muted);
  background: var(--raised);
  font-size: 11px;
}

.skill-installation-label.is-installed {
  color: var(--ok-text);
  background: var(--ok-soft);
}

.skill-platform-row__summary {
  overflow: hidden;
  color: var(--muted2);
  font-size: 12px;
  line-height: 1.7;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.skill-platform-row__action {
  display: grid;
  place-items: center;
  width: 28px;
  height: 28px;
  min-width: 28px;
  min-height: 28px;
  border-radius: 7px;
  color: var(--muted2);
  cursor: pointer;
}

.skill-platform-row__action:hover:not(:disabled) {
  color: var(--ink);
  background: var(--raised);
}

.skill-platform-row__action:disabled,
.skill-platform-row__copy:disabled {
  cursor: not-allowed;
  opacity: 0.56;
}

.skill-platform-row__spinner {
  width: 13px;
  height: 13px;
  border: 2px solid currentColor;
  border-right-color: transparent;
  border-radius: 50%;
  animation: skill-row-spin 700ms linear infinite;
}

.skill-platform-empty {
  display: grid;
  place-items: center;
  gap: 6px;
  min-height: 180px;
  color: var(--muted2);
  text-align: center;
}

.skill-platform-empty strong {
  color: var(--ink);
}

@keyframes skill-row-spin {
  to {
    transform: rotate(360deg);
  }
}

@media (max-width: 900px) {
  .skill-platform-grid {
    grid-template-columns: 1fr;
  }
}

@media (max-width: 620px) {
  .skill-platform-row {
    grid-template-columns: 40px minmax(0, 1fr) 44px;
    gap: 12px;
    min-height: 88px;
  }

  .skill-platform-row__icon {
    width: 40px;
    height: 40px;
  }

  .skill-platform-row__action {
    width: 44px;
    height: 44px;
    min-width: 44px;
    min-height: 44px;
  }

  .skill-platform-row__summary {
    font-size: 13px;
  }
}

@media (prefers-reduced-motion: reduce) {
  .skill-platform-row,
  .skill-platform-row__spinner {
    transition: none;
    animation: none;
  }
}

}

.zz-store { height:100%; overflow:auto; box-sizing:border-box; padding-top:var(--dsh-frame-top-clearance,0px); }
.zz-store button,.zz-store input,.zz-store select,.zz-store textarea { font:inherit; }
.zz-store [hidden]{display:none!important}.zz-store fieldset{border:0;padding:0}
.zz-store button { cursor:pointer; }
.zz-store button:disabled { opacity:.5;cursor:default; }
.zz-store :focus-visible { outline:2px solid var(--accent);outline-offset:3px; }
.zz-store .header-actions { display:flex;align-items:center;gap:12px;margin-left:auto; }
.zz-store .header-actions button,.zz-store .store-overlay button { border:1px solid var(--line);border-radius:8px;background:var(--panel);color:var(--ink);padding:7px 12px; }
.zz-store .header-actions .primary,.zz-store .store-overlay .primary { color:var(--btn-p-fg);background:var(--ink); }
.zz-store .sync-state { display:inline-flex;align-items:center;gap:var(--sp-2);color:var(--muted2);font-size:12px; }
.zz-store .sync-dot { width:7px;height:7px;border-radius:var(--r-pill);background:currentColor; }
.zz-store .state-banner { margin:14px 0;padding:12px 16px;border:1px solid var(--line);border-radius:10px;color:var(--ink);background:var(--raised); }
.zz-store .empty-state { display:grid;justify-items:center;gap:10px;padding:64px 16px;color:var(--muted2);text-align:center; }
.zz-store .empty-state h2 { font-size:16px;color:var(--ink); }
.zz-store .store-overlay { box-sizing:border-box;width:min(940px,calc(100vw - 64px));max-height:calc(100vh - 80px);padding:0;border:1px solid var(--line);border-radius:16px;background:var(--panel);color:var(--ink);box-shadow:0 24px 80px #0003; }
.zz-store .store-overlay::backdrop { background:#0005; }
.zz-store .store-overlay.is-drawer { margin:0;position:fixed;inset:calc(80px + var(--dsh-frame-top-clearance,0px)) 24px 24px auto;width:min(560px,calc(100vw - 48px));height:calc(100dvh - 104px - var(--dsh-frame-top-clearance,0px));max-height:calc(100dvh - 104px - var(--dsh-frame-top-clearance,0px));overflow:hidden; }
.zz-store .store-overlay.is-drawer[open] { display:flex;flex-direction:column; }
.zz-store .store-drawer-body { flex:1;min-height:0;overflow:auto;overscroll-behavior:contain;padding:0 24px; }
.zz-store .store-drawer-body>.skill-catalog-secondary-tabs { position:sticky;top:0;z-index:1;display:grid;grid-auto-flow:column;grid-auto-columns:minmax(0,1fr);gap:0;background:var(--panel);border-bottom:1px solid var(--line); }
.zz-store .store-drawer-body>.zz-cap-version.is-current { position:sticky;bottom:0;background:var(--panel);z-index:1; }
.zz-store .store-overlay.is-drawer::backdrop { background:transparent; }
.zz-store .store-overlay-header { display:flex;align-items:center;justify-content:space-between;padding:16px 24px;border-bottom:1px solid var(--line);position:sticky;top:0;background:var(--panel);z-index:1; }
.zz-store .is-drawer>.store-overlay-header { flex-shrink:0; }
.zz-store .store-overlay-header button { display:grid;place-items:center;width:32px;height:32px;border:0;padding:0; }
.zz-store .store-overlay>form,.zz-store .store-overlay>section { padding:24px; }
.zz-store .store-detail-heading { display:grid;grid-template-columns:58px minmax(0,1fr);align-items:center;gap:16px;margin:18px 0 8px; }
.zz-store .store-detail-heading h2 { margin:0;font-size:24px; }
.zz-store .skill-detail-icon { display:grid;place-items:center;width:54px;height:54px;border:2px solid var(--accent);border-radius:9px;background:var(--accent-soft);color:var(--accent); }
.zz-store .store-overlay p { line-height:1.7; }
.zz-store .store-overlay .zz-cap-card { border:0;background:none; }
.zz-store .store-overlay .zz-cap-form-grid { border:0;padding:16px 0;display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:18px; }
.zz-store .zz-cap-form-grid label { display:grid;gap:7px;font-size:13px; }
.zz-store .zz-cap-form-grid input,.zz-store .zz-cap-form-grid select,.zz-store .zz-cap-form-grid textarea { box-sizing:border-box;width:100%;padding:9px 12px;border:1px solid var(--line);border-radius:8px;background:var(--bg);color:var(--ink); }
.zz-store .zz-cap-form-grid textarea { min-height:100px;resize:vertical; }
.zz-store .zz-cap-form-grid>section,.zz-store .zz-cap-form-grid>.span-all { grid-column:1/-1; }
.zz-store .zz-cap-toolbar { display:flex;gap:8px;flex-wrap:wrap;align-items:center; }
.zz-store .zz-cap-muted { color:var(--muted2);font-size:12px; }
.zz-store .store-version-select { display:flex;gap:12px;align-items:center;margin:20px 0; }
.zz-store .store-version-select select { border:1px solid var(--line);border-radius:7px;padding:6px;color:var(--ink);background:var(--panel); }
.zz-store .store-overview { padding:24px 0!important; }
.zz-store .store-overview h3 { font-size:13px; }
.zz-store .store-overview dl { display:grid;grid-template-columns:1fr 1fr;gap:16px; }
.zz-store dt { color:var(--muted2);font-size:12px; }.zz-store dd { margin:6px 0; }
.zz-store .zz-cap-version { display:flex;align-items:center;gap:10px;flex-wrap:wrap;border-top:1px solid var(--line);padding:18px 0; }
.zz-store .zz-cap-version>strong { font-size:15px; }.zz-store .zz-cap-version>span { color:var(--muted2);font-size:12px; }
.zz-store .zz-cap-version label { display:grid;gap:6px; }.zz-store .zz-cap-version input { max-width:220px; }
@media(max-width:700px) { .zz-store .store-overlay{width:calc(100vw - 24px);max-height:calc(100vh - 24px)} .zz-store .store-overlay.is-drawer{inset:12px;width:calc(100vw - 24px);height:calc(100dvh - 24px);max-height:calc(100dvh - 24px)} .zz-store .store-overlay .zz-cap-form-grid{grid-template-columns:1fr} }
` + fileStyles
