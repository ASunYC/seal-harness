import { fileStyles } from './file-styles.js'

// 来源：Stratex local-skill-catalog.css / LocalSkillScopeGroup.vue，070ba39e82。
export const styles = `.zz-resource-page.zz-skills {
.local-skill-catalog {
  display: grid;
  gap: 0;
  min-width: 0;
  margin-top: 20px;
  color: var(--ink);
}

.local-skill-toolbar,
.local-skill-search,
.local-skill-status-filter,
.local-skill-sources,
.local-skill-note,
.local-skill-row__main,
.local-skill-row__source > span {
  display: flex;
  align-items: center;
}

.local-skill-toolbar {
  gap: 10px;
  margin-bottom: 16px;
}

.local-skill-search {
  flex: 1;
  gap: 8px;
  min-width: 0;
  height: 42px;
  padding: 0 12px;
  border: var(--bw) solid var(--line);
  border-radius: 12px;
  color: var(--muted2);
  background: var(--panel);
  transition:
    border-color 120ms ease,
    background 120ms ease;
}

.local-skill-search:focus-within,
.local-skill-status-filter:focus-within {
  border-color: var(--line-strong);
  box-shadow: var(--focus-ring-flat);
}

.local-skill-search input,
.local-skill-status-filter select {
  min-width: 0;
  border: 0;
  outline: 0;
  color: var(--ink);
  font: 13px/1.4 var(--font-sans);
  background: transparent;
}

.local-skill-search input {
  flex: 1;
}

.local-skill-search kbd {
  flex: none;
  padding: 2px 5px;
  border: var(--bw) solid var(--line);
  border-radius: 5px;
  color: var(--muted2);
  font: 10px/1.2 var(--font-mono, ui-monospace, monospace);
  background: var(--raised);
}

.local-skill-status-filter {
  gap: 5px;
  height: 36px;
  padding: 0 10px;
  border: var(--bw) solid var(--line);
  border-radius: 9px;
  color: var(--muted2);
  background: var(--panel);
}

.local-skill-status-filter select {
  background: var(--panel);
  cursor: pointer;
}

.local-skill-status-filter option {
  color: var(--ink);
  background: var(--panel);
}

.local-skill-sources {
  flex-wrap: wrap;
  gap: 8px;
  margin-bottom: 18px;
}

.local-skill-sources__caption {
  margin-right: 2px;
  color: var(--muted2);
  font-size: 12px;
}

.local-skill-sources button {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  min-height: 25px;
  padding: 2px 9px;
  border: var(--bw) solid var(--line);
  border-radius: 999px;
  color: var(--muted2);
  font: 11px/1.2 var(--font-sans);
  background: var(--panel);
  cursor: pointer;
}

.local-skill-sources button:hover,
.local-skill-sources button.is-active {
  border-color: var(--line-strong);
  color: var(--ink);
  background: var(--raised);
}

.local-skill-sources button.is-active {
  font-weight: 650;
}

.local-skill-sources button > span:last-child {
  color: var(--muted);
  font-size: 10px;
}

.local-skill-note {
  gap: 6px;
  margin: 0 0 20px;
  color: var(--muted2);
  font-size: 12px;
}

.state-banner,
.loading-state,
.empty-state {
  margin-bottom: 14px;
}

.local-skill-catalog > .state-banner button {
  min-height: 34px;
  padding: 0 12px;
  border: var(--bw) solid var(--btn-p-bg);
  border-color: var(--btn-p-bg);
  border-radius: 8px;
  color: var(--btn-p-fg);
  font: 12px/1 var(--font-sans);
  background: var(--btn-p-bg);
  cursor: pointer;
}

@media (max-width: 960px) {
  .local-skill-catalog > .state-banner {
    flex-direction: column;
    align-items: stretch;
  }

  .local-skill-catalog > .state-banner > span {
    min-width: 0;
    width: 100%;
    line-height: 1.6;
  }

  .local-skill-catalog > .state-banner > button {
    align-self: flex-start;
    min-height: 44px;
    max-width: 100%;
    white-space: normal;
  }
}

.local-skill-results {
  min-width: 0;
}

.local-skill-table-heading,
.local-skill-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 204px 110px 28px;
  align-items: center;
  gap: 20px;
}

.local-skill-table-heading {
  min-height: 32px;
  padding: 0 13px;
  border-bottom: var(--bw) solid var(--line);
  color: var(--muted2);
  font-size: 12px;
}

.local-skill-list {
  display: grid;
}

.local-skill-row {
  min-height: 76px;
  padding: 10px 13px;
  border: 0;
  border-bottom: var(--bw) solid var(--line);
  border-radius: 0;
  color: var(--ink);
  text-align: left;
  background: transparent;
  cursor: pointer;
  transition: background 120ms ease;
}

.local-skill-row:hover,
.local-skill-row:focus-visible {
  background: var(--raised);
}

.local-skill-row:focus-visible,
.local-skill-sources button:focus-visible,
.local-skill-scope button:focus-visible,
.local-skill-detail button:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: -2px;
}

.local-skill-row__main {
  gap: 12px;
  min-width: 0;
}

.local-skill-row__icon {
  display: grid;
  flex: none;
  place-items: center;
  width: 34px;
  height: 34px;
  border: var(--bw) solid var(--line);
  border-radius: 9px;
  color: var(--accent-text);
  background: var(--panel);
}

.local-skill-row__copy,
.local-skill-row__source {
  display: grid;
  gap: 3px;
  min-width: 0;
}

.local-skill-row__copy > strong,
.local-skill-row__copy > small,
.local-skill-row__source > span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.local-skill-row__copy > strong {
  font-size: 14px;
  font-weight: 650;
}

.local-skill-row__copy > small,
.local-skill-row__source,
.local-skill-row__status {
  color: var(--muted2);
  font-size: 12px;
}

.local-skill-row__source > span {
  gap: 4px;
}

.local-skill-row__source > span > :not(:last-child)::after {
  margin-left: 4px;
  color: var(--muted);
  content: '·';
}

.local-skill-row__source small {
  color: var(--muted);
  font-size: 11px;
}

.local-skill-row__status {
  color: var(--ok-text);
}

.local-skill-row__status.is-default {
  color: var(--accent-text);
  font-weight: 650;
}

.local-skill-results__count {
  margin: 10px 13px 0;
  color: var(--muted);
  font-size: 11px;
}

.local-skill-catalog button:disabled,
.local-skill-scope button:disabled,
.local-skill-detail button:disabled {
  cursor: not-allowed;
  opacity: 0.52;
}

.local-skill-scope {
  display: grid;
  gap: 14px;
}

.local-skill-scope > p {
  margin: 0;
  color: var(--muted2);
  font-size: 12px;
  line-height: 1.65;
}

.local-skill-detail {
  display: grid;
  gap: 24px;
  padding: 8px;
}

.local-skill-detail__section {
  display: grid;
  gap: 10px;
}

.local-skill-detail__section h4 {
  margin: 0;
  font-size: 12px;
  font-weight: 680;
}

.local-skill-detail__section dl {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px;
  margin: 0;
}

.local-skill-detail__section dl div {
  min-width: 0;
  padding: 10px;
  border-radius: 8px;
  background: var(--raised);
}

.local-skill-detail__section dt,
.local-skill-detail__section dd {
  margin: 0;
}

.local-skill-detail__section dt {
  color: var(--muted2);
  font-size: 11px;
}

.local-skill-detail__section dd {
  margin-top: 4px;
  overflow: hidden;
  font-size: 12px;
  font-weight: 650;
  text-overflow: ellipsis;
  white-space: nowrap;
}

@media (max-width: 760px) {
  .local-skill-table-heading,
  .local-skill-row {
    grid-template-columns: minmax(0, 1fr) 120px 28px;
    gap: 12px;
  }

  .local-skill-table-heading > span:nth-child(3),
  .local-skill-row__status {
    display: none;
  }
}

@media (max-width: 560px) {
  .local-skill-toolbar {
    align-items: stretch;
    flex-direction: column;
  }

  .local-skill-status-filter {
    align-self: flex-start;
  }

  .local-skill-search kbd,
  .local-skill-table-heading {
    display: none;
  }

  .local-skill-row {
    grid-template-columns: minmax(0, 1fr) 44px;
    gap: 8px;
    min-height: 76px;
    padding: 10px 0;
  }

  .local-skill-row__source {
    display: none;
  }

  .local-skill-row > svg {
    justify-self: center;
  }

  .local-skill-sources button {
    min-height: 44px;
  }

  .local-skill-detail__section dl {
    grid-template-columns: 1fr;
  }
}


.local-skill-scope-group {
  display: grid;
  margin: 0;
  border: 0;
}

.local-skill-scope-group > h4,
.local-skill-scope-group > summary {
  margin: 0;
  padding: 9px 2px;
  color: var(--ink);
  font-size: 12px;
}

.local-skill-scope-group > summary {
  cursor: pointer;
}

.local-skill-scope-group > summary span {
  margin-left: 8px;
  color: var(--muted2);
  font-weight: 400;
}

.local-skill-scope-group__list {
  display: grid;
  border-top: var(--bw) solid var(--line);
}

.local-skill-scope-group__list article {
  display: grid;
  grid-template-columns: 34px minmax(0, 1fr) auto;
  align-items: center;
  gap: 10px;
  min-height: 64px;
  border-bottom: var(--bw) solid var(--line);
}

.local-skill-scope-group__icon {
  display: grid;
  place-items: center;
  width: 30px;
  height: 30px;
  border-radius: 8px;
  color: var(--muted2);
  background: var(--raised);
}

.local-skill-scope-group__copy {
  display: grid;
  gap: 4px;
  min-width: 0;
}

.local-skill-scope-group__copy small {
  color: var(--muted2);
  font-size: 11px;
}

.local-skill-scope-group__copy ul {
  display: grid;
  gap: 3px;
  margin: 2px 0 0;
  padding: 0;
  list-style: none;
}

.local-skill-scope-group__copy li {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  color: var(--muted2);
  font-size: 11px;
}

.local-skill-scope-group__copy code {
  overflow-wrap: anywhere;
  color: var(--ink);
  font: inherit;
}

.local-skill-scope-group__list button {
  display: inline-flex;
  align-items: center;
  min-height: 34px;
  padding: 0 12px;
  border: var(--bw) solid var(--line);
  border-radius: 8px;
  color: var(--ink);
  font: 12px/1 var(--font-sans);
  background: var(--panel);
  cursor: pointer;
}

.local-skill-scope-group__list button:disabled {
  cursor: not-allowed;
  opacity: 0.52;
}

@media (max-width: 560px) {
  .local-skill-scope-group__list article {
    grid-template-columns: 34px minmax(0, 1fr);
    padding: 8px 0;
  }

  .local-skill-scope-group__list article > button {
    grid-column: 2;
    justify-self: start;
    min-height: 44px;
  }
}

}

.zz-skills{height:100%;overflow:auto;box-sizing:border-box;padding-top:var(--dsh-frame-top-clearance,0px);color:var(--ink)}
.zz-skills button,.zz-skills input,.zz-skills select{font:inherit;color:inherit}.zz-skills button{cursor:pointer}.zz-skills button:disabled{opacity:.5;cursor:default}.zz-skills :focus-visible{outline:2px solid var(--accent);outline-offset:3px}
.zz-skills .skills-page-content{padding:34px 26px 44px}.zz-skills .skills-hero h1{margin:0;font-size:clamp(26px,3vw,36px);font-weight:680;line-height:1.12;letter-spacing:-.022em}.zz-skills .skills-hero p{margin:9px 0 0;color:var(--muted2);font-size:13.5px;line-height:1.7}
.zz-skills .resource-page-nav > .skills-actions{margin-left:auto}
.zz-skills .skills-actions{display:flex;gap:10px;align-items:center;flex-wrap:wrap}.zz-skills .skills-actions button:not(.resource-sync-button),.zz-skills .skills-dialog button,.zz-skills .skills-batch button,.zz-skills .empty-state button{padding:7px 12px;border:1px solid var(--line);border-radius:8px;background:var(--panel);color:var(--ink);font-size:12px}
.zz-skills button.primary{background:var(--ink);color:var(--btn-p-fg)}
.zz-skills .skills-primary-tabs{display:flex;gap:8px;margin:24px 0 16px}.zz-skills .skills-primary-tabs button{min-height:32px;padding:4px 12px;border:0;border-radius:8px;background:transparent;color:var(--muted2);font-size:14px}.zz-skills .skills-primary-tabs button[aria-pressed=true]{background:var(--raised);color:var(--ink);font-weight:650}
.zz-skills .skills-batch{display:flex;align-items:center;gap:12px;padding:12px 0;font-size:12px;color:var(--muted2)}.zz-skills .skills-batch label{display:flex;gap:7px;align-items:center}
.zz-skills .local-skill-row__copy{background:transparent;border:0;padding:0;text-align:left;cursor:pointer;color:var(--ink)}.zz-skills .local-skill-row__copy strong{font:inherit;font-weight:650}.zz-skills .local-skill-row__main>input{margin:0;flex:none}
.zz-skills .local-skill-row>button{border:0;background:transparent;color:var(--muted2);font-size:20px}.zz-skills .skills-row-menu{position:relative}.zz-skills .skills-row-menu summary{display:grid;place-items:center;width:28px;height:28px;cursor:pointer;list-style:none}.zz-skills .skills-row-menu summary::-webkit-details-marker{display:none}.zz-skills .skills-row-menu>div{position:absolute;right:0;top:28px;z-index:5;display:grid;width:110px;padding:5px;background:var(--panel);border:1px solid var(--line);border-radius:9px;box-shadow:0 8px 20px #0002}.zz-skills .skills-row-menu button{padding:7px 12px;border:0;border-radius:5px;background:transparent;text-align:left;font-size:12px}.zz-skills .skills-row-menu button:hover{background:var(--raised)}
.zz-skills .state-banner{display:grid;gap:6px;margin:12px 0;padding:12px 16px;border:1px solid var(--line);border-radius:9px;background:var(--raised);font-size:13px}.zz-skills .state-banner.is-error{color:var(--danger-text,#ba3c3c)}
.zz-skills .empty-state,.zz-skills .loading-state{display:grid;justify-items:center;gap:10px;padding:60px 20px;text-align:center;color:var(--muted2)}.zz-skills .empty-state strong{color:var(--ink)}
.zz-skills .skills-dialog{box-sizing:border-box;width:min(660px,calc(100vw - 48px));max-height:calc(100vh - 60px);padding:0;border:1px solid var(--line);border-radius:16px;background:var(--panel);color:var(--ink);box-shadow:0 24px 80px #0003}.zz-skills .skills-dialog::backdrop{background:#0005}
.zz-skills .skills-dialog.is-drawer{position:fixed;inset:calc(80px + var(--dsh-frame-top-clearance,0px)) 24px 24px auto;margin:0;width:min(560px,calc(100vw - 48px));height:calc(100dvh - 104px - var(--dsh-frame-top-clearance,0px));max-height:calc(100dvh - 104px - var(--dsh-frame-top-clearance,0px));overflow:hidden}.zz-skills .skills-dialog.is-drawer::backdrop{background:transparent}.zz-skills .skills-dialog.is-editor{width:min(1160px,calc(100vw - 48px))}
.zz-skills .skills-dialog.is-drawer[open]{display:flex;flex-direction:column}
.zz-skills .skills-dialog.is-drawer>.skills-dialog-header{flex-shrink:0}
.zz-skills .skills-dialog.is-drawer>.skills-dialog-body,.zz-skills .skills-dialog.is-drawer>.skills-workbench-content{flex:1;min-height:0;overflow:auto;overscroll-behavior:contain}
.zz-skills .skills-dialog-header{display:flex;justify-content:space-between;align-items:center;padding:18px 24px;border-bottom:1px solid var(--line);position:sticky;top:0;background:var(--panel);z-index:1}.zz-skills .skills-dialog-header button{display:grid;place-items:center;width:32px;height:32px;border:1px solid var(--line);border-radius:8px;padding:0;color:var(--muted2);background:var(--panel)}
.zz-skills .skills-dialog-body,.zz-skills .skills-workbench-content{padding:20px 24px}.zz-skills .skills-dialog p{line-height:1.7;font-size:13px}.zz-skills .skills-dialog footer{display:flex;justify-content:flex-end;gap:8px;margin-top:24px;padding-top:16px;border-top:1px solid var(--line)}
.zz-skills .skills-path-form{display:flex;align-items:end;gap:10px;margin:24px 0}.zz-skills .skills-path-form label{display:grid;gap:8px;flex:1;min-width:0;font-size:12px}.zz-skills .skills-path-form input{width:100%;box-sizing:border-box;padding:9px 12px;border:1px solid var(--line);border-radius:8px;background:var(--bg);color:var(--ink)}
.zz-skills .skills-import-drop{display:grid;justify-items:center;gap:12px;padding:28px 20px;border:1px dashed var(--line-strong);border-radius:12px;background:var(--bg);cursor:pointer}.zz-skills .skills-import-drop>span{font-size:28px}.zz-skills .skills-import-drop small{color:var(--muted2)}.zz-skills .skills-import-drop input{max-width:100%;font-size:12px}
.zz-skills .skills-import-preview article{border-top:1px solid var(--line);padding:16px 0}.zz-skills .skills-import-preview label{display:flex;gap:8px;align-items:center}.zz-skills .skills-import-preview pre{white-space:pre-wrap;max-height:300px;overflow:auto;font-size:12px}
.zz-skills .skills-dialog .skills-variant{display:grid;gap:7px;text-align:left;width:100%;margin:10px 0;padding:16px}.zz-skills .skills-variant small{color:var(--muted2)}
.zz-skills .skills-copy{display:grid;gap:8px;border:1px solid var(--line);border-radius:10px;margin:10px 0;padding:14px}.zz-skills .skills-copy small{color:var(--muted2);overflow-wrap:anywhere}
.zz-skills .skills-detail-tabs{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));border-bottom:1px solid var(--line);position:sticky;top:0;z-index:1;background:var(--panel)}.zz-skills .skills-detail-tabs button{border:0;border-radius:0;padding:9px 0;background:transparent;color:var(--muted2)}.zz-skills .skills-detail-tabs button[aria-pressed=true]{border-bottom:2px solid var(--ink);color:var(--ink);font-weight:650}
.zz-skills .skills-description{color:var(--muted2)}
@media(max-width:700px){.zz-skills .skills-page-content{padding:24px 16px}.zz-skills .skills-dialog.is-drawer{inset:12px;width:calc(100vw - 24px);height:calc(100dvh - 24px);max-height:calc(100dvh - 24px)}.zz-skills .skills-dialog-body,.zz-skills .skills-workbench-content{padding:16px}.zz-skills .skills-batch{flex-wrap:wrap}}
` + fileStyles
