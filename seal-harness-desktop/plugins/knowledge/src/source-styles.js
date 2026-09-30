// 来源：Stratex@070ba39e，完整来源与接受差异见 SOURCE.md。仅添加知识库作用域。
export const sourceStyles = `
/* Stratex VaultLibraryView.vue */
.zz-knowledge.library-page {
  min-height: 100%;
  width: 100%;
  box-sizing: border-box;
  color: var(--ink);
  background: var(--bg);
}
.zz-knowledge .library-page__content {
  width: 100%;
  max-width: 1740px;
  box-sizing: border-box;
  margin-inline: auto;
  padding: var(--sp-5) var(--sp-6) var(--sp-7);
}
.zz-knowledge .library-share-redeem {
  display: grid;
  grid-template-columns: minmax(220px, 1fr) minmax(240px, 0.8fr) auto auto;
  align-items: center;
  gap: 12px;
  margin-top: 12px;
  padding: 12px 14px;
  background: var(--raised);
  border: var(--bw) solid var(--line);
  border-radius: var(--r-md);
}
.zz-knowledge .library-share-redeem > div {
  display: grid;
  gap: 2px;
}
.zz-knowledge .library-share-redeem span {
  color: var(--muted2);
  font-size: var(--fs-meta);
}
.zz-knowledge .library-share-redeem input {
  min-width: 0;
  height: var(--ctl-h);
  padding: 0 var(--sp-3);
  color: var(--ink);
  background: var(--sunken);
  border: var(--bw) solid var(--line-strong);
  border-radius: var(--r-md);
}
.zz-knowledge.library-page .resource-page-nav__back {
  display: grid;
  width: 32px;
  height: 32px;
  margin-left: -7px;
  padding: 0;
  place-items: center;
  color: var(--muted2);
  background: transparent;
  border: 0;
  border-radius: 8px;
  cursor: pointer;
}
.zz-knowledge .library-nav-actions {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-left: auto;
}
.zz-knowledge .library-service-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-top: 28px;
  padding: 11px 12px;
  background: color-mix(in srgb, var(--panel) 82%, transparent);
  border: var(--bw) solid var(--line);
  border-radius: 12px;
}
.zz-knowledge .library-service-bar > div:first-child {
  display: grid;
  gap: 2px;
}
.zz-knowledge .library-service-bar span {
  color: var(--muted2);
  font-size: var(--fs-200);
}
.zz-knowledge .library-service-bar .knowledge-service__trigger {
  min-width: 246px;
  height: 44px;
  background: var(--raised);
  border-color: var(--line);
  border-radius: 9px;
}
.zz-knowledge .library-state {
  min-height: 430px;
  display: grid;
  place-content: center;
  justify-items: center;
  gap: 12px;
  color: var(--muted2);
  text-align: center;
}
.zz-knowledge .library-state > span {
  width: 56px;
  height: 56px;
  display: grid;
  place-items: center;
  color: var(--warn-text);
  background: var(--warn-soft);
  border: var(--bw) solid var(--warn-line);
  border-radius: 50%;
  font-size: 26px;
}
.zz-knowledge .library-state strong {
  color: var(--ink);
  font-size: var(--fs-500);
}
.zz-knowledge .library-state p {
  margin: 0;
}
@media (max-width: 900px) {
.zz-knowledge .library-page__content {
    padding: var(--sp-4) var(--sp-3) var(--sp-6);
  }
.zz-knowledge .library-service-bar {
    align-items: stretch;
    flex-direction: column;
  }
}

/* Stratex vault-library-collections.css */
.zz-knowledge .collection-catalog {
  display: grid;
  gap: 34px;
  padding-top: 30px;
}
.zz-knowledge .collection-scope-tabs {
  display: flex;
  width: 100%;
  min-width: 0;
  align-items: center;
  gap: var(--sp-5);
  margin: 0 0 var(--sp-5);
  border: 0;
  border-bottom: var(--bw) solid var(--line);
  border-radius: 0;
  background: transparent;
  overflow: visible;
}
.zz-knowledge .collection-scope-tab {
  position: relative;
  display: inline-flex;
  min-width: 0;
  min-height: var(--ctl-h-lg);
  align-items: center;
  justify-content: center;
  gap: var(--sp-2);
  padding: 0 var(--sp-2);
  color: var(--muted2);
  background: transparent !important;
  border: 0 !important;
  border-radius: 0 !important;
  font-size: var(--fs-400);
}
.zz-knowledge .collection-scope-tab.active {
  color: var(--accent-text);
  font-weight: 650;
}
.zz-knowledge .collection-scope-tab::after {
  position: absolute;
  right: 0;
  bottom: -1px;
  left: 0;
  height: 2px;
  background: transparent;
  content: '';
}
.zz-knowledge .collection-scope-tab.active::after {
  background: var(--accent);
}
.zz-knowledge .collection-scope-tab .tab-count {
  display: inline-grid;
  min-width: 20px;
  height: 20px;
  place-items: center;
  padding: 0 6px;
  color: var(--muted2);
  background: var(--sunken);
  border-radius: 10px;
  font-size: 12px;
  font-weight: 600;
}
.zz-knowledge .collection-scope-tab.active .tab-count {
  color: var(--accent-text);
  background: var(--accent-soft);
}
.zz-knowledge .collection-catalog-toolbar,
.zz-knowledge .collection-catalog-search {
  display: flex;
  align-items: center;
}
.zz-knowledge .collection-catalog-toolbar {
  gap: 10px;
}
.zz-knowledge .collection-catalog-search {
  height: 42px;
  min-width: 0;
  flex: 1;
  gap: 9px;
  padding: 0 14px;
  color: var(--muted2);
  background: var(--panel);
  border: var(--bw) solid var(--line-strong);
  border-radius: 12px;
}
.zz-knowledge .collection-catalog-search:focus-within {
  border-color: var(--accent);
  box-shadow: var(--focus-ring-flat);
}
.zz-knowledge .collection-catalog-search input {
  width: 100%;
  min-width: 0;
  min-height: 36px;
  color: var(--ink);
  background: transparent;
  border: 0;
  outline: 0;
  font: 13px var(--font-sans);
}
.zz-knowledge .collection-catalog-search input::placeholder {
  color: var(--muted2);
}
.zz-knowledge .collection-catalog-search kbd {
  padding: 0 5px;
  color: var(--muted2);
  border: var(--bw) solid var(--line-strong);
  border-bottom-width: 2px;
  border-radius: 4px;
  font: 600 10px var(--font-mono);
  white-space: nowrap;
}
.zz-knowledge .collection-search-clear {
  display: grid;
  width: 28px;
  min-width: 28px;
  height: 28px;
  min-height: 28px;
  padding: 0;
  place-items: center;
  color: var(--muted2);
  background: transparent;
  border: 0;
  border-radius: 7px;
}
.zz-knowledge .collection-installation-filter {
  position: relative;
  width: 138px;
  height: 42px;
}
.zz-knowledge .collection-installation-filter summary {
  display: flex;
  height: 100%;
  align-items: center;
  gap: 8px;
  padding: 0 11px;
  color: var(--muted2);
  background: var(--panel);
  border: var(--bw) solid var(--line-strong);
  border-radius: 12px;
  cursor: pointer;
  list-style: none;
  transition:
    border-color var(--dur-2) var(--ease-out),
    box-shadow var(--dur-2) var(--ease-out),
    background-color var(--dur-2) var(--ease-out);
}
.zz-knowledge .collection-installation-filter summary::-webkit-details-marker {
  display: none;
}
.zz-knowledge .collection-installation-filter summary:hover {
  background: var(--raised);
  border-color: var(--muted2);
}
.zz-knowledge .collection-installation-filter summary:focus-visible,
.zz-knowledge .collection-installation-filter[open] summary {
  border-color: var(--accent);
  outline: 0;
  box-shadow: var(--focus-ring-flat);
}
.zz-knowledge .collection-installation-filter summary span {
  min-width: 0;
  flex: 1;
  color: var(--ink);
  font: 13px var(--font-sans);
  white-space: nowrap;
}
.zz-knowledge .collection-installation-filter__menu {
  position: absolute;
  z-index: 30;
  top: calc(100% + 6px);
  right: 0;
  left: 0;
  display: grid;
  gap: 2px;
  padding: 5px;
  background: var(--panel);
  border: var(--bw) solid var(--line-strong);
  border-radius: 10px;
  box-shadow: var(--sh-3);
}
.zz-knowledge .collection-installation-filter__menu button {
  display: flex;
  width: 100%;
  min-height: 32px;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 0 9px;
  color: var(--ink);
  text-align: left;
  background: transparent;
  border: 0;
  border-radius: 7px;
  cursor: pointer;
  font: 13px var(--font-sans);
}
.zz-knowledge .collection-installation-filter__menu button:hover,
.zz-knowledge .collection-installation-filter__menu button:focus-visible {
  background: var(--sunken);
  outline: 0;
}
.zz-knowledge .collection-installation-filter__menu button.is-selected {
  color: var(--accent-text);
  background: var(--accent-soft);
}
.zz-knowledge .collection-installation-filter__chevron {
  flex: none;
  color: var(--muted2);
  pointer-events: none;
  transition: transform var(--dur-2) var(--ease-out);
}
.zz-knowledge .collection-installation-filter[open] .collection-installation-filter__chevron {
  transform: rotate(180deg);
}
.zz-knowledge .collection-catalog .capability-featured-scenes {
  display: grid;
  gap: 16px;
}
.zz-knowledge .collection-catalog .capability-featured-scenes__header h2,
.zz-knowledge .collection-catalog .capability-featured-scenes__header p {
  margin: 0;
}
.zz-knowledge .collection-catalog .capability-featured-scenes__header h2 {
  font-size: var(--fs-500);
}
.zz-knowledge .collection-catalog .capability-featured-scenes__header p {
  margin-top: 4px;
  color: var(--muted2);
  font-size: var(--fs-200);
}
.zz-knowledge .collection-catalog .capability-featured-scenes__grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
}
.zz-knowledge .collection-catalog button.capability-featured-scene {
  position: relative;
  display: grid;
  min-height: 80px;
  grid-template-columns: auto minmax(0, 1fr) auto;
  align-items: center;
  gap: 14px;
  padding: 14px 17px;
  color: var(--ink);
  text-align: left;
  background: var(--panel);
  border: var(--bw) solid var(--line);
  border-radius: 12px;
  cursor: pointer;
  transition:
    transform var(--dur-2) var(--ease-out),
    border-color var(--dur-2) var(--ease-out),
    box-shadow var(--dur-2) var(--ease-out);
}
.zz-knowledge .collection-catalog button.capability-featured-scene:hover {
  border-color: var(--line-strong);
  transform: translateY(-1px);
  box-shadow: var(--sh-2);
}
.zz-knowledge .collection-catalog button.capability-featured-scene.is-selected {
  border-color: var(--accent-line);
  background: var(--accent-soft);
  box-shadow: inset 0 0 0 1px var(--accent-line);
}
.zz-knowledge .collection-catalog .capability-featured-scene__icon {
  position: static;
  display: grid;
  width: 40px;
  height: 40px;
  place-items: center;
  color: var(--accent-text);
  background: var(--raised);
  border: var(--bw) solid var(--line);
  border-radius: 10px;
  transform: none;
}
.zz-knowledge .collection-catalog .capability-featured-scene__copy {
  display: grid;
  gap: 3px;
}
.zz-knowledge .collection-catalog .capability-featured-scene__copy strong {
  color: var(--ink);
  font-size: var(--fs-400);
}
.zz-knowledge .collection-catalog .capability-featured-scene__copy span,
.zz-knowledge .collection-catalog .capability-featured-scene__count {
  color: var(--muted2);
  font-size: var(--fs-200);
}
.zz-knowledge .collection-catalog .capability-featured-scene__count {
  min-width: 24px;
  text-align: right;
  font-variant-numeric: tabular-nums;
}
.zz-knowledge .collection-catalog .capability-catalog-section {
  min-width: 0;
  padding: 0;
  background: transparent;
  border: 0;
}
.zz-knowledge .collection-catalog .capability-catalog-section__header {
  position: relative;
  padding-bottom: 12px;
}
.zz-knowledge .collection-catalog .capability-catalog-section__title {
  display: flex;
  align-items: center;
  gap: 8px;
}
.zz-knowledge .collection-catalog .capability-catalog-section__title h2 {
  margin: 0;
  font-size: var(--fs-500);
  line-height: 24px;
}
.zz-knowledge .collection-catalog .capability-catalog-section__count {
  display: inline-grid;
  min-width: 24px;
  height: 24px;
  box-sizing: border-box;
  place-items: center;
  padding: 0 8px;
  color: var(--muted2);
  background: var(--sunken);
  border-radius: var(--r-pill);
  font-size: var(--fs-200);
}
.zz-knowledge .collection-catalog .capability-catalog-section__divider {
  height: var(--px-1);
  min-width: 16px;
  flex: 1 1 auto;
  margin-left: 4px;
  background: var(--line);
}
.zz-knowledge .collection-catalog .capability-catalog-section__header > p {
  max-width: 72ch;
  margin: 4px 0 0;
  color: var(--muted2);
  font-size: var(--fs-300);
  line-height: var(--lh-body);
}
.zz-knowledge .collection-catalog .capability-catalog-section__tools {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 12px;
  margin-top: 10px;
}
.zz-knowledge .collection-catalog .capability-catalog-section__content {
  min-width: 0;
  padding-top: 14px;
}
.zz-knowledge .collection-sections,
.zz-knowledge .collection-discovery-flow {
  display: grid;
  gap: 40px;
}
.zz-knowledge .collection-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(min(100%, 300px), 1fr));
  gap: 14px;
}
.zz-knowledge .collection-card {
  position: relative;
  min-height: 220px;
  display: grid;
  grid-template-rows: 1fr auto;
  border: var(--bw) solid var(--line);
  border-radius: 12px;
  background: var(--panel);
  overflow: hidden;
  transition:
    transform var(--dur-2) var(--ease-out),
    box-shadow var(--dur-2) var(--ease-out);
}
.zz-knowledge .collection-card.is-share-selecting {
  padding-top: 36px;
  border-color: var(--accent-line);
}
.zz-knowledge .collection-card__selector {
  position: absolute;
  top: 12px;
  left: 14px;
  z-index: 1;
  display: grid;
  width: 22px;
  height: 22px;
  place-items: center;
  cursor: pointer;
}
.zz-knowledge .collection-card__selector input {
  width: 16px;
  height: 16px;
  margin: 0;
  accent-color: var(--accent);
}
.zz-knowledge .collection-card:hover {
  transform: translateY(-2px);
  box-shadow: var(--sh-2);
}
.zz-knowledge .collection-card__main {
  display: grid;
  grid-template-columns: 40px minmax(0, 1fr);
  min-width: 0;
  gap: 12px;
  width: 100%;
  padding: 16px;
  color: var(--ink);
  text-align: left;
  background: transparent;
  border: 0;
  cursor: pointer;
}
.zz-knowledge .collection-card__icon {
  width: 40px;
  height: 40px;
  display: grid;
  place-items: center;
  color: var(--accent-text);
  background: var(--accent-soft);
  border: var(--bw) solid var(--accent-line);
  border-radius: 10px;
}
.zz-knowledge .collection-card__copy {
  min-width: 0;
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  align-content: start;
  gap: 13px;
}
.zz-knowledge .collection-card__heading {
  min-width: 0;
  display: flex;
  align-items: start;
  justify-content: space-between;
  gap: 8px;
}
.zz-knowledge .collection-card__heading strong {
  min-width: 0;
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.zz-knowledge .collection-card__heading small {
  white-space: nowrap;
  flex: none;
  padding: 3px 7px;
  color: var(--muted2);
  background: var(--sunken);
  border-radius: var(--r-pill);
}
.zz-knowledge .collection-card__summary {
  min-height: 42px;
  display: -webkit-box;
  overflow: hidden;
  color: var(--muted2);
  line-height: 1.55;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
}
.zz-knowledge .collection-card__meta {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.zz-knowledge .collection-card__meta small {
  padding: 3px 7px;
  color: var(--accent-text);
  background: var(--accent-soft);
  border-radius: var(--r-pill);
}
.zz-knowledge .collection-card__meta .is-state {
  color: var(--warn-text);
  background: var(--warn-soft);
}
.zz-knowledge .collection-card__footer {
  box-sizing: border-box;
  min-height: 54px;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 11px 15px;
  border-top: var(--bw) solid var(--line);
  color: var(--muted2);
  font-size: var(--fs-meta);
}
.zz-knowledge .collection-card__footer div {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  margin-left: auto;
  gap: 10px;
}
.zz-knowledge .collection-card__footer button,
.zz-knowledge .collection-section-action {
  white-space: nowrap;
  padding: 0;
  color: var(--accent-text);
  background: transparent;
  border: 0;
  cursor: pointer;
}
.zz-knowledge .collection-section-action.is-primary {
  font-weight: 600;
}
.zz-knowledge .collection-share-selection__count {
  color: var(--muted2);
  font-size: var(--fs-meta);
}
.zz-knowledge .collection-card__footer button.is-primary {
  min-height: 30px;
  padding: 0 14px;
  color: var(--btn-p-fg);
  background: var(--btn-p-bg);
  border-radius: 7px;
}
.zz-knowledge .collection-empty {
  display: grid;
  place-items: center;
  min-height: 145px;
  padding: 20px;
  color: var(--muted2);
  text-align: center;
  border: var(--bw) dashed var(--line);
  border-radius: 12px;
}
.zz-knowledge .collection-empty p {
  margin: 7px 0 0;
}
.zz-knowledge .collection-dialog {
  min-height: 390px;
  display: grid;
  align-content: start;
  gap: 17px;
}
.zz-knowledge .collection-dialog label {
  display: grid;
  gap: 7px;
  color: var(--muted2);
}
.zz-knowledge .collection-dialog input,
.zz-knowledge .collection-dialog textarea,
.zz-knowledge .collection-dialog select {
  width: 100%;
  box-sizing: border-box;
  padding: 10px 12px;
  color: var(--ink);
  background: var(--raised);
  border: var(--bw) solid var(--line-strong);
  border-radius: 8px;
  font: inherit;
}
.zz-knowledge .collection-dialog__danger {
  padding: 12px;
  color: var(--danger-text);
  background: var(--danger-soft);
  border: var(--bw) solid var(--danger-line);
  border-radius: 8px;
}
.zz-knowledge .collection-dialog__delete {
  margin-right: auto;
}
@media (max-width: 760px) {
.zz-knowledge .collection-catalog-toolbar {
    flex-wrap: wrap;
  }
.zz-knowledge .collection-catalog-search {
    flex-basis: 100%;
  }
.zz-knowledge .collection-catalog-search input {
    font-size: 16px;
  }
.zz-knowledge .collection-catalog-search kbd {
    display: none;
  }
.zz-knowledge .collection-installation-filter {
    width: 138px;
    height: 44px;
    min-height: 44px;
  }
.zz-knowledge .collection-catalog .capability-featured-scenes__grid,
.zz-knowledge .collection-grid {
    grid-template-columns: 1fr;
  }
}

/* Stratex VaultLibraryCollectionDetailDialog.vue */
.zz-knowledge .collection-detail {
  min-height: 500px;
  display: grid;
  grid-template-rows: auto 1fr;
}
.zz-knowledge .collection-detail__tabs {
  display: flex;
  gap: 22px;
  border-bottom: var(--bw) solid var(--line);
}
.zz-knowledge .collection-detail__tabs button {
  position: relative;
  min-height: 42px;
  padding: 0;
  color: var(--muted2);
  background: transparent;
  border: 0;
  cursor: pointer;
}
.zz-knowledge .collection-detail__tabs button.is-active {
  color: var(--ink);
  font-weight: 650;
}
.zz-knowledge .collection-detail__tabs button.is-active::after {
  content: '';
  position: absolute;
  right: 0;
  bottom: -1px;
  left: 0;
  height: 2px;
  background: var(--accent);
}
.zz-knowledge .collection-detail__tabs span {
  color: var(--muted2);
  font-size: var(--fs-meta);
}
.zz-knowledge .collection-detail__overview,
.zz-knowledge .collection-detail__files,
.zz-knowledge .collection-detail__share {
  padding-top: 22px;
}
.zz-knowledge .collection-detail__share {
  margin-top: 24px;
  border-top: var(--bw) solid var(--line);
}
.zz-knowledge .collection-share-code {
  margin-top: 4px;
}
.zz-knowledge .collection-share-methods {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
  margin-top: 14px;
}
.zz-knowledge .collection-share-method {
  min-width: 0;
  padding: 15px;
  background: var(--sunken);
  border: var(--bw) solid var(--line);
  border-radius: 10px;
}
.zz-knowledge .collection-share-method h4 {
  margin: 0 0 8px;
  font-size: var(--fs-300);
}
.zz-knowledge .collection-share-method > p {
  color: var(--muted2);
  font-size: var(--fs-200);
  line-height: 1.6;
}
.zz-knowledge .collection-detail__summary {
  display: grid;
  grid-template-columns: 52px 1fr;
  gap: 14px;
}
.zz-knowledge .collection-detail__icon {
  width: 50px;
  height: 50px;
  display: grid;
  place-items: center;
  color: var(--accent-text);
  background: var(--accent-soft);
  border: var(--bw) solid var(--accent-line);
  border-radius: 12px;
}
.zz-knowledge .collection-detail h3,
.zz-knowledge .collection-detail p {
  margin: 0;
}
.zz-knowledge .collection-detail__summary p,
.zz-knowledge .collection-detail__files header p,
.zz-knowledge .collection-detail__share p {
  margin-top: 7px;
  color: var(--muted2);
  line-height: 1.6;
}
.zz-knowledge .collection-detail__topics {
  display: grid;
  gap: 10px;
  margin-top: 24px;
}
.zz-knowledge .collection-detail__topics div {
  display: flex;
  flex-wrap: wrap;
  gap: 7px;
}
.zz-knowledge .collection-detail__topics span {
  padding: 5px 9px;
  color: var(--accent-text);
  background: var(--accent-soft);
  border-radius: var(--r-pill);
}
.zz-knowledge .collection-detail__facts {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 1px;
  margin: 24px 0 0;
  overflow: hidden;
  background: var(--line);
  border: var(--bw) solid var(--line);
  border-radius: 10px;
}
.zz-knowledge .collection-detail__facts div {
  padding: 13px;
  background: var(--panel);
}
.zz-knowledge .collection-detail__facts dt {
  color: var(--muted2);
  font-size: var(--fs-meta);
}
.zz-knowledge .collection-detail__facts dd {
  margin: 5px 0 0;
  font-weight: 650;
}
.zz-knowledge .collection-detail__files > header {
  display: flex;
  align-items: start;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 16px;
}
.zz-knowledge .collection-detail__files ul,
.zz-knowledge .collection-share-users {
  display: grid;
  gap: 8px;
  margin: 0;
  padding: 0;
  list-style: none;
}
.zz-knowledge .collection-detail__files .upload-zone {
  margin-bottom: 16px;
}
.zz-knowledge .collection-detail__files li {
  display: grid;
  grid-template-columns: 38px 1fr auto;
  align-items: center;
  gap: 11px;
  padding: 11px 12px;
  background: var(--panel);
  border: var(--bw) solid var(--line);
  border-radius: 9px;
}
.zz-knowledge .collection-file__icon {
  width: 36px;
  height: 36px;
  display: grid;
  place-items: center;
  color: var(--accent-text);
  background: var(--accent-soft);
  border-radius: 8px;
}
.zz-knowledge .collection-file__copy {
  min-width: 0;
  display: grid;
  gap: 3px;
}
.zz-knowledge .collection-file__copy strong {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.zz-knowledge .collection-file__copy small {
  color: var(--muted2);
}
.zz-knowledge .collection-file__actions {
  display: flex;
  gap: 10px;
}
.zz-knowledge .collection-file__actions button,
.zz-knowledge .collection-share-users button {
  padding: 0;
  color: var(--accent-text);
  background: transparent;
  border: 0;
  cursor: pointer;
}
.zz-knowledge .collection-file__actions button.is-danger {
  color: var(--danger-text);
}
.zz-knowledge .collection-detail__empty {
  display: grid;
  place-items: center;
  min-height: 190px;
  color: var(--muted2);
  text-align: center;
  border: var(--bw) dashed var(--line);
  border-radius: 10px;
}
.zz-knowledge .collection-detail__empty p {
  margin-top: 7px;
}
.zz-knowledge .collection-share-search {
  display: grid;
  grid-template-columns: 1fr 130px;
  gap: 10px;
  margin-top: 20px;
}
.zz-knowledge .collection-share-search input,
.zz-knowledge .collection-share-search select {
  min-height: 40px;
  padding: 0 11px;
  color: var(--ink);
  background: var(--panel);
  border: var(--bw) solid var(--line-strong);
  border-radius: 8px;
}
.zz-knowledge .collection-share-users {
  margin-top: 14px;
}
.zz-knowledge .collection-share-users li {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 11px 12px;
  border: var(--bw) solid var(--line);
  border-radius: 8px;
}
.zz-knowledge .collection-share-users span {
  display: grid;
  gap: 2px;
}
.zz-knowledge .collection-share-users small,
.zz-knowledge .collection-share-hint {
  color: var(--muted2);
}
.zz-knowledge .collection-share-hint {
  margin-top: 16px !important;
}
@media (max-width: 720px) {
.zz-knowledge .collection-share-methods {
    grid-template-columns: 1fr;
  }
.zz-knowledge .collection-detail__facts {
    grid-template-columns: repeat(2, 1fr);
  }
.zz-knowledge .collection-detail__files li {
    grid-template-columns: 38px 1fr;
  }
.zz-knowledge .collection-file__actions {
    grid-column: 2;
  }
}

/* Stratex VaultDialogShell.vue */
.zz-knowledge .vault-modal {
  box-sizing: border-box;
  width: 100%;
  height: 100%;
  display: grid;
  place-items: center;
  padding: 28px;
  padding-top: calc(28px + 36px);
}
.zz-knowledge .vault-modal__panel {
  width: min(520px, calc(100vw - 56px));
  max-height: min(760px, calc(100vh - 56px));
  display: grid;
  grid-template-rows: auto minmax(0, 1fr) auto;
  overflow: hidden;
  color: var(--ink);
  background: var(--raised);
  border: var(--bw) solid var(--line-strong);
  border-radius: var(--r-xl);
  box-shadow: var(--sh-3);
  pointer-events: auto;
}
.zz-knowledge .vault-modal__panel--wide {
  width: min(920px, calc(100vw - 56px));
}
.zz-knowledge .vault-modal__header,
.zz-knowledge .vault-modal__footer {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: var(--sp-4);
  padding: var(--sp-5);
  border-bottom: var(--bw) solid var(--line);
}
.zz-knowledge .vault-modal__header h2 {
  margin: 0;
  font-size: var(--fs-600);
}
.zz-knowledge .vault-modal__header p {
  margin: var(--sp-1) 0 0;
  color: var(--muted2);
  font-size: var(--fs-meta);
}
.zz-knowledge .vault-modal__close {
  width: 28px;
  height: 28px;
  padding: 0;
  color: var(--muted2);
  background: transparent;
  border: 0;
  border-radius: var(--r-sm);
  font-size: 22px;
  cursor: pointer;
}
.zz-knowledge .vault-modal__close:hover {
  color: var(--ink);
  background: var(--sunken);
}
.zz-knowledge .vault-modal__body {
  min-height: 0;
  padding: var(--sp-5);
  overflow: auto;
}
.zz-knowledge .vault-modal__footer {
  align-items: center;
  justify-content: flex-end;
  border-top: var(--bw) solid var(--line);
  border-bottom: 0;
}

/* Stratex VaultLibraryFileDropZone.vue */
.zz-knowledge .upload-zone {
  width: 100%;
  box-sizing: border-box;
  min-height: 170px;
  display: grid;
  place-content: center;
  justify-items: center;
  gap: var(--sp-2);
  padding: var(--sp-5);
  color: var(--muted2);
  text-align: center;
  background: var(--sunken);
  border: var(--bw) dashed var(--line-strong);
  border-radius: var(--r-lg);
  cursor: pointer;
}
.zz-knowledge .upload-zone:hover:not(:disabled),
.zz-knowledge .upload-zone.is-dragging {
  background: var(--accent-soft);
  border-color: var(--accent);
}
.zz-knowledge .upload-zone:disabled {
  cursor: not-allowed;
  opacity: 0.65;
}
.zz-knowledge .upload-zone__icon {
  width: 42px;
  height: 42px;
  display: grid;
  place-items: center;
  color: var(--accent-text);
  background: var(--panel);
  border: var(--bw) solid var(--accent-line);
  border-radius: 50%;
  font-size: 22px;
}
.zz-knowledge .upload-zone small {
  color: var(--muted2);
  font-size: var(--fs-meta);
  line-height: 1.6;
}

/* Stratex VaultLibraryDialogs.vue */
.zz-knowledge .upload-dialog-content {
  display: grid;
  gap: var(--sp-3);
}
.zz-knowledge .file-queue small,
.zz-knowledge .dialog-hint,
.zz-knowledge .user-results small {
  color: var(--muted2);
  font-size: var(--fs-meta);
}
.zz-knowledge .dialog-error {
  width: 100%;
  box-sizing: border-box;
  display: flex;
  align-items: flex-start;
  gap: var(--sp-2);
  margin: 0;
  padding: var(--sp-3);
  color: var(--danger-text);
  background: var(--danger-soft);
  border: var(--bw) solid var(--danger-line);
  border-radius: var(--r-md);
  font-size: var(--fs-meta);
  line-height: 1.5;
}
.zz-knowledge .dialog-error > span {
  width: 18px;
  height: 18px;
  flex: 0 0 auto;
  display: grid;
  place-items: center;
  margin-top: 1px;
  border: var(--bw) solid currentColor;
  border-radius: 50%;
  font-size: 11px;
  font-weight: 700;
}
.zz-knowledge .upload-target,
.zz-knowledge .move-dialog label {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 240px;
  align-items: center;
  gap: var(--sp-4);
  padding: var(--sp-3);
  color: var(--ink);
  background: var(--panel);
  border: var(--bw) solid var(--line);
  border-radius: var(--r-md);
}
.zz-knowledge .upload-target > span {
  display: grid;
  gap: 3px;
}
.zz-knowledge .upload-target small,
.zz-knowledge .move-dialog p {
  margin: 0;
  color: var(--muted2);
  font-size: var(--fs-meta);
}
.zz-knowledge .upload-target select,
.zz-knowledge .move-dialog select {
  height: 36px;
  padding: 0 var(--sp-3);
  color: var(--ink);
  background: var(--raised);
  border: var(--bw) solid var(--line-strong);
  border-radius: var(--r-md);
}
.zz-knowledge .move-dialog {
  min-height: 220px;
  display: grid;
  align-content: start;
  gap: var(--sp-3);
}
.zz-knowledge .file-queue,
.zz-knowledge .user-results {
  display: grid;
  gap: var(--sp-2);
  margin: var(--sp-4) 0 0;
  padding: 0;
  list-style: none;
}
.zz-knowledge .file-queue {
  max-height: 240px;
  margin: 0;
  overflow: auto;
}
.zz-knowledge .file-queue li {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 112px auto 28px;
  align-items: center;
  column-gap: var(--sp-3);
  row-gap: var(--sp-2);
  padding: var(--sp-3);
  background: var(--sunken);
  border-radius: var(--r-md);
}
.zz-knowledge .file-queue__details {
  min-width: 0;
  display: grid;
  gap: var(--sp-1);
}
.zz-knowledge .file-queue__details strong {
  min-width: 0;
  overflow-wrap: anywhere;
  font-size: var(--fs-body);
  font-weight: 500;
  line-height: 1.35;
}
.zz-knowledge .file-queue__status {
  white-space: nowrap;
}
.zz-knowledge .upload-category-hint {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: var(--sp-3);
  color: var(--muted2);
  font-size: var(--fs-meta);
}
.zz-knowledge .upload-category-hint strong {
  flex: 0 0 auto;
  color: var(--ink);
}
.zz-knowledge .file-queue__category {
  display: grid;
  gap: 2px;
  color: var(--muted2);
  font-size: var(--fs-100);
}
.zz-knowledge .file-queue__category select {
  height: 30px;
  padding: 0 var(--sp-2);
  color: var(--ink);
  background: var(--panel);
  border: var(--bw) solid var(--line-strong);
  border-radius: var(--r-sm);
}
.zz-knowledge .file-queue progress {
  grid-column: 1 / 5;
  width: 100%;
  height: 6px;
}
.zz-knowledge .file-queue button,
.zz-knowledge .preview-panel header button {
  color: var(--muted2);
  background: transparent;
  border: 0;
  cursor: pointer;
}
.zz-knowledge .file-queue__remove {
  width: 28px;
  height: 28px;
  padding: 0;
  border-radius: var(--r-sm);
  font-size: 18px;
}
.zz-knowledge .file-queue__remove:hover:not(:disabled) {
  color: var(--ink);
  background: var(--panel);
}
.zz-knowledge .preview-panel {
  box-sizing: border-box;
  width: min(1040px, calc(100vw - 300px));
  height: calc(100vh - 48px);
  margin-top: 48px;
  display: grid;
  grid-template-rows: 58px minmax(0, 1fr);
  overflow: hidden;
  background: var(--panel);
  border: var(--bw) solid var(--line-strong);
  border-radius: var(--r-xl) 0 0 0;
  box-shadow: var(--sh-3);
  pointer-events: auto;
}
.zz-knowledge .preview-panel header {
  display: flex;
  align-items: center;
  padding: 0 var(--sp-4);
  border-bottom: var(--bw) solid var(--line);
}
.zz-knowledge .preview-panel header div {
  min-width: 0;
  display: grid;
  flex: 1;
}
.zz-knowledge .preview-panel header small {
  color: var(--muted2);
}
.zz-knowledge .preview-panel header button {
  font-size: 22px;
}
.zz-knowledge .preview-panel article {
  min-height: 0;
  padding: var(--sp-5);
  overflow: auto;
  background: var(--sunken);
}
.zz-knowledge .preview-panel pre {
  width: min(820px, 100%);
  min-height: 100%;
  box-sizing: border-box;
  margin: 0 auto;
  padding: var(--sp-7);
  color: #272b34;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  background: #fff;
  border: var(--bw) solid #d9dce2;
  box-shadow: var(--sh-1);
  font: 15px/1.8 var(--font-sans);
}
.zz-knowledge .share-search {
  display: grid;
  gap: var(--sp-2);
  color: var(--muted2);
  font-size: var(--fs-meta);
}
.zz-knowledge .share-search input {
  height: var(--ctl-h);
  padding: 0 var(--sp-3);
  color: var(--ink);
  background: var(--sunken);
  border: var(--bw) solid var(--line-strong);
  border-radius: var(--r-md);
}
.zz-knowledge .selected-users {
  display: flex;
  flex-wrap: wrap;
  gap: var(--sp-2);
  margin-top: var(--sp-3);
  color: var(--accent-text);
  font-size: var(--fs-meta);
}
.zz-knowledge .selected-users > span {
  min-height: 28px;
  display: inline-flex;
  align-items: center;
  gap: var(--sp-1);
  padding: 0 var(--sp-2);
  background: var(--accent-soft);
  border: var(--bw) solid var(--accent-line);
  border-radius: var(--r-pill);
}
.zz-knowledge .selected-users button {
  padding: 0;
  color: inherit;
  background: transparent;
  border: 0;
  cursor: pointer;
}
.zz-knowledge .user-results label {
  display: flex;
  align-items: center;
  gap: var(--sp-3);
  padding: var(--sp-2) var(--sp-3);
  background: var(--sunken);
  border-radius: var(--r-md);
}
.zz-knowledge .user-results span {
  display: grid;
}
.zz-knowledge .notice-box,
.zz-knowledge .danger-box {
  padding: var(--sp-4);
  border-radius: var(--r-md);
}
.zz-knowledge .notice-box {
  color: var(--warn-text);
  background: var(--warn-soft);
  border: var(--bw) solid var(--warn-line);
}
.zz-knowledge .danger-box {
  color: var(--danger-text);
  background: var(--danger-soft);
  border: var(--bw) solid var(--danger-line);
}

/* Stratex VaultKnowledgeServiceSelector.vue */
.zz-knowledge .knowledge-service {
  position: relative;
}
.zz-knowledge .knowledge-service__trigger {
  width: 100%;
  height: var(--ctl-h);
  max-width: 320px;
  display: inline-flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--sp-3);
  padding: 0 var(--sp-3);
  color: var(--ink);
  background: var(--raised);
  border: var(--bw) solid var(--line-strong);
  border-radius: var(--r-md);
  text-align: left;
  cursor: pointer;
}
.zz-knowledge .knowledge-service__identity {
  min-width: 0;
  flex: 1;
  display: flex;
  align-items: center;
  gap: var(--sp-2);
}
.zz-knowledge .knowledge-service__name {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.zz-knowledge .knowledge-service__chevron {
  box-sizing: border-box;
  width: 7px;
  height: 7px;
  flex: none;
  margin: -3px 2px 0 0;
  border-right: 1.5px solid currentColor;
  border-bottom: 1.5px solid currentColor;
  transform: rotate(45deg);
  transform-origin: 55% 55%;
  transition: transform var(--dur-1) var(--ease-out);
}
.zz-knowledge .knowledge-service__chevron.is-open {
  margin-top: 3px;
  transform: rotate(225deg);
}
.zz-knowledge .knowledge-service__status {
  width: 7px;
  height: 7px;
  flex: none;
  background: var(--ok);
  border-radius: 50%;
}
.zz-knowledge .knowledge-service__status.is-empty {
  background: var(--warn);
}
.zz-knowledge .knowledge-service__menu {
  width: min(360px, calc(100vw - 40px));
  overflow: hidden;
  background: var(--raised);
  border: var(--bw) solid var(--line-strong);
  border-radius: var(--r-lg);
  box-shadow: var(--sh-3);
  pointer-events: auto;
}
.zz-knowledge .knowledge-service__menu header,
.zz-knowledge .knowledge-service__option > span:first-child {
  display: grid;
  gap: 2px;
}
.zz-knowledge .knowledge-service__menu header {
  padding: var(--sp-3) var(--sp-4);
  border-bottom: var(--bw) solid var(--line);
}
.zz-knowledge .knowledge-service__menu small,
.zz-knowledge .configuration-item small {
  color: var(--muted2);
}
.zz-knowledge .knowledge-service__option {
  width: 100%;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--sp-3);
  padding: var(--sp-3) var(--sp-4);
  color: var(--ink);
  background: transparent;
  border: 0;
  text-align: left;
  cursor: pointer;
}
.zz-knowledge .knowledge-service__option:hover,
.zz-knowledge .knowledge-service__option.is-selected {
  background: var(--accent-soft);
}
.zz-knowledge .knowledge-service__configure {
  width: 100%;
  min-height: var(--ctl-h-lg);
  padding: 0 var(--sp-4);
  color: var(--accent-text);
  background: var(--panel);
  border: 0;
  border-top: var(--bw) solid var(--line);
  text-align: left;
  cursor: pointer;
}
.zz-knowledge .knowledge-service__error {
  position: absolute;
  top: calc(100% + 4px);
  right: 0;
  z-index: 2;
  width: max-content;
  max-width: 360px;
  margin: 0;
  color: var(--danger-text);
  font-size: var(--fs-meta);
}
.zz-knowledge .configuration-layout {
  height: 400px;
  min-height: 400px;
  display: grid;
  grid-template-columns: minmax(220px, 0.8fr) minmax(360px, 1.4fr);
  gap: var(--sp-5);
}
.zz-knowledge .configuration-list {
  min-height: 0;
  display: grid;
  align-content: start;
  gap: var(--sp-2);
  padding-right: var(--sp-4);
  border-right: var(--bw) solid var(--line);
  overflow-y: auto;
}
.zz-knowledge .configuration-add {
  min-height: var(--ctl-h);
  color: var(--accent-text);
  background: var(--accent-soft);
  border: var(--bw) solid var(--accent);
  border-radius: var(--r-md);
  cursor: pointer;
}
.zz-knowledge .configuration-add.is-selected {
  box-shadow: 0 0 0 2px var(--accent-soft);
}
.zz-knowledge .configuration-add--default {
  color: var(--ink);
  background: var(--raised);
  border-color: var(--line-strong);
}
.zz-knowledge .configuration-add--default:hover:not(:disabled) {
  border-color: var(--accent-line);
  background: var(--sunken);
}
.zz-knowledge .configuration-add--default:disabled {
  color: var(--muted2);
  background: var(--sunken);
  border-color: var(--line);
  cursor: default;
}
.zz-knowledge .configuration-item {
  display: flex;
  align-items: center;
  gap: var(--sp-1);
  border: var(--bw) solid var(--line);
  border-radius: var(--r-md);
}
.zz-knowledge .configuration-item.is-draft {
  border-color: var(--accent);
  border-style: dashed;
}
.zz-knowledge .configuration-item__main {
  min-width: 0;
  flex: 1;
  display: grid;
  gap: 2px;
  padding: var(--sp-3);
  color: var(--ink);
  background: transparent;
  border: 0;
  text-align: left;
  cursor: pointer;
}
.zz-knowledge .configuration-item__main.is-selected {
  background: var(--accent-soft);
  border-radius: var(--r-md);
}
.zz-knowledge .configuration-item__main:disabled {
  color: var(--muted2);
  cursor: default;
}
.zz-knowledge .configuration-empty {
  margin: 0;
  padding: var(--sp-3);
  color: var(--muted2);
  border: var(--bw) dashed var(--line);
  border-radius: var(--r-md);
}
.zz-knowledge .configuration-form {
  box-sizing: border-box;
  min-height: 0;
  display: flex;
  flex-direction: column;
  gap: var(--sp-4);
  padding-right: 4px;
  overflow-y: auto;
}
.zz-knowledge .configuration-form__heading,
.zz-knowledge .configuration-actions {
  margin-left: 104px;
}
.zz-knowledge .configuration-detail {
  min-height: 0;
  display: grid;
  align-content: start;
  gap: var(--sp-5);
}
.zz-knowledge .configuration-detail--empty {
  place-content: center;
  max-width: 520px;
}
.zz-knowledge .configuration-form__heading p {
  margin: var(--sp-1) 0 0;
  color: var(--muted2);
  font-size: var(--fs-meta);
}
.zz-knowledge .configuration-form__hint {
  margin: calc(var(--sp-2) * -1) 0 0 104px;
  color: var(--accent-text);
  font-size: var(--fs-meta);
  line-height: 1.5;
}
.zz-knowledge .configuration-detail h3,
.zz-knowledge .configuration-detail p {
  margin: 0;
}
.zz-knowledge .configuration-detail p {
  margin-top: var(--sp-2);
  color: var(--muted2);
  line-height: 1.6;
}
.zz-knowledge .configuration-detail__eyebrow {
  color: var(--accent-text);
  font-size: var(--fs-meta);
}
.zz-knowledge .configuration-detail dl {
  display: grid;
  gap: var(--sp-2);
  margin: 0;
}
.zz-knowledge .configuration-detail dl > div {
  display: grid;
  grid-template-columns: 96px minmax(0, 1fr);
  gap: var(--sp-3);
  padding: var(--sp-3);
  background: var(--sunken);
  border-radius: var(--r-md);
}
.zz-knowledge .configuration-detail dt {
  color: var(--muted2);
}
.zz-knowledge .configuration-detail dd {
  min-width: 0;
  margin: 0;
  overflow-wrap: anywhere;
}
.zz-knowledge .configuration-form h3 {
  margin: 0;
}
.zz-knowledge .configuration-form label {
  display: grid;
  grid-template-columns: 88px minmax(0, 1fr);
  align-items: center;
  column-gap: var(--sp-4);
  color: var(--muted2);
  font-size: var(--fs-meta);
}
.zz-knowledge .configuration-form label > span {
  text-align: right;
  line-height: var(--ctl-h);
}
.zz-knowledge .configuration-form input,
.zz-knowledge .configuration-form select {
  box-sizing: border-box;
  width: 100%;
  min-width: 0;
  height: var(--ctl-h);
  padding: 0 var(--sp-3);
  color: var(--ink);
  background: var(--sunken);
  border: var(--bw) solid var(--line-strong);
  border-radius: var(--r-md);
}
.zz-knowledge .configuration-error {
  margin: 0;
  padding: var(--sp-3);
  color: var(--danger-text);
  background: var(--danger-soft);
  border-radius: var(--r-md);
}
.zz-knowledge .configuration-feedback {
  box-sizing: border-box;
  height: 64px;
  padding-top: var(--sp-3);
  overflow-y: auto;
}
.zz-knowledge .configuration-notice {
  margin: 0;
  padding: var(--sp-3);
  color: var(--ok-text);
  background: var(--ok-soft);
  border-radius: var(--r-md);
}
.zz-knowledge .configuration-actions {
  margin-top: auto;
  display: flex;
  justify-content: flex-end;
  gap: var(--sp-2);
}
.zz-knowledge .configuration-delete.is-confirming {
  color: var(--danger-text);
  background: var(--danger-soft);
}
.zz-knowledge .configuration-delete {
  color: var(--danger-text);
}
@media (max-width: 760px) {
.zz-knowledge .configuration-layout {
    height: min(560px, calc(100vh - 260px));
    min-height: 0;
    grid-template-columns: 1fr;
    grid-template-rows: minmax(120px, 0.55fr) minmax(240px, 1fr);
  }
.zz-knowledge .configuration-list {
    padding: 0 0 var(--sp-4);
    border: 0;
    border-bottom: var(--bw) solid var(--line);
  }
.zz-knowledge .configuration-form__heading,
.zz-knowledge .configuration-actions {
    margin-left: 0;
  }
.zz-knowledge .configuration-form label {
    grid-template-columns: 1fr;
    gap: var(--sp-2);
  }
.zz-knowledge .configuration-form label > span {
    text-align: left;
    line-height: normal;
  }
}

/* Stratex VaultKnowledgeShareDialog.vue */
.zz-knowledge .knowledge-share__code {
  display: grid;
  gap: var(--sp-3);
  padding: var(--sp-4);
  border: var(--bw) solid var(--line);
  border-radius: var(--r-md);
}
.zz-knowledge .knowledge-share__code code {
  overflow-wrap: anywhere;
  user-select: text;
}
.zz-knowledge .knowledge-share__code p,
.zz-knowledge .knowledge-share__history p {
  margin: var(--sp-1) 0;
  color: var(--muted2);
  line-height: 1.6;
}
.zz-knowledge .knowledge-share__history {
  display: grid;
  gap: var(--sp-3);
  margin: 0;
  padding: 0;
  list-style: none;
}
.zz-knowledge .knowledge-share__history li {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--sp-3);
  padding: var(--sp-3);
  border: var(--bw) solid var(--line);
  border-radius: var(--r-md);
}

/* Stratex VaultCollectionGrantMembers.vue */
.zz-knowledge .collection-members {
  display: grid;
  gap: 8px;
  align-content: start;
  margin-top: 12px;
}
.zz-knowledge .collection-members h4,
.zz-knowledge .collection-members p,
.zz-knowledge .collection-members ul {
  margin: 0;
}
.zz-knowledge .collection-members h4 {
  font-size: var(--fs-meta);
}
.zz-knowledge .collection-members p {
  color: var(--muted2);
  line-height: 1.6;
}
.zz-knowledge .collection-members button {
  justify-self: start;
  padding: 5px 9px;
  color: var(--accent-text);
  background: transparent;
  border: var(--bw) solid var(--line);
  border-radius: var(--r-sm);
  font: inherit;
  cursor: pointer;
}
.zz-knowledge .collection-members button:hover:not(:disabled) {
  background: var(--accent-soft);
}
.zz-knowledge .collection-members button:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.zz-knowledge .collection-members ul {
  display: grid;
  gap: 8px;
  padding: 0;
  list-style: none;
}
.zz-knowledge .collection-members li {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 12px;
  padding: 8px 10px;
  border: var(--bw) solid var(--line);
  border-radius: var(--r-sm);
}
.zz-knowledge .collection-members li span {
  flex: 1;
  min-width: 120px;
  overflow-wrap: anywhere;
}
`
