export const styles = `
.seal-harness-session-context-selectors {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}
.seal-harness-session-connector,
.seal-harness-session-skill {
  position: relative;
  display: inline-flex;
}
.seal-harness-session-context-selector-trigger {
  height: 26px;
  min-width: 0;
  padding-inline: 8px 6px;
  gap: 4px;
  color: var(--dsw-alias-text-secondary, #aeb7c6);
  background: var(--dsw-alias-surface-sunken, rgba(8, 10, 14, 0.42));
  border: 1px solid var(--dsw-alias-border-subtle, rgba(255, 255, 255, 0.14));
  border-radius: 999px;
  font-size: 12px;
  line-height: 1;
  white-space: nowrap;
}
.seal-harness-session-context-selector-trigger:hover,
.seal-harness-session-context-selector-trigger:focus-visible,
.seal-harness-session-context-selector-trigger[aria-expanded="true"] {
  color: var(--dsw-alias-text-primary, #f4f7fb);
  background: var(--dsw-alias-surface-raised, rgba(255, 255, 255, 0.08));
  border-color: var(--dsw-alias-border-strong, rgba(255, 255, 255, 0.24));
}
.seal-harness-session-context-selector-trigger > svg,
.seal-harness-session-context-selector-trigger > span {
  flex: none;
}
.seal-harness-session-skill-popover {
  position: fixed;
  z-index: 1200;
  display: flex;
  box-sizing: border-box;
  width: min(780px, calc(100vw - 52px));
  max-height: min(420px, calc(100vh - 96px));
  flex-direction: column;
  gap: 8px;
  padding: 7px;
  overflow: hidden;
  color: var(--dsw-alias-text-primary, #f1f3f5);
  background: var(--dsw-alias-surface-raised, #2b2b2d);
  border: 1px solid var(--dsw-alias-border-strong, rgba(255, 255, 255, 0.22));
  border-radius: 10px;
  box-shadow: 0 18px 46px rgba(0, 0, 0, 0.42);
}
.seal-harness-session-skill-header {
  display: flex;
  min-height: 26px;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 0 4px;
  font-size: 12px;
}
.seal-harness-session-skill-header > span,
.seal-harness-session-skill-copy > small,
.seal-harness-session-skill-state {
  color: var(--dsw-alias-text-secondary, #aeb4bd);
}
.seal-harness-session-skill-search {
  box-sizing: border-box;
  width: 100%;
  height: 30px;
  padding: 0 10px;
  color: inherit;
  background: var(--dsw-alias-surface-default, #232326);
  border: 1px solid var(--dsw-alias-border-subtle, rgba(255, 255, 255, 0.14));
  border-radius: 6px;
  outline: none;
  font: inherit;
}
.seal-harness-session-skill-search:focus-visible {
  border-color: var(--dsw-alias-border-focus, #6ca0ff);
  box-shadow: 0 0 0 2px rgba(75, 133, 255, 0.35);
}
.seal-harness-session-skill-list {
  display: flex;
  min-height: 0;
  flex: 1 1 auto;
  flex-direction: column;
  gap: 4px;
  overflow-x: hidden;
  overflow-y: auto;
  overscroll-behavior: contain;
  scrollbar-gutter: stable;
}
.seal-harness-session-skill-group {
  margin: 8px 11px 4px;
  color: var(--dsw-alias-text-secondary, #aeb4bd);
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.06em;
}
.seal-harness-session-skill-row {
  display: flex;
  width: 100%;
  min-height: 38px;
  flex: 0 0 auto;
  align-items: center;
  gap: 8px;
  padding: 6px 10px;
  color: inherit;
  background: transparent;
  border: 0;
  border-radius: 6px;
  text-align: left;
  cursor: pointer;
}
.seal-harness-session-skill-row:hover,
.seal-harness-session-skill-row:focus-visible {
  color: var(--dsw-alias-text-link, #8db4ff);
  background: rgba(91, 143, 249, 0.12);
  outline: none;
}
.seal-harness-session-skill-copy {
  display: flex;
  min-width: 0;
  flex: 1;
  align-items: baseline;
  gap: 8px;
  overflow: hidden;
}
.seal-harness-session-skill-copy > strong,
.seal-harness-session-skill-copy > small {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.seal-harness-session-skill-copy > strong {
  max-width: 100%;
  flex: 0 0 auto;
  font-size: 13px;
  font-weight: 600;
}
.seal-harness-session-skill-copy > small {
  min-width: 0;
  flex: 1 1 auto;
  font-size: 12px;
}
.seal-harness-session-skill-add {
  flex: 0 0 auto;
  font-size: 16px;
  line-height: 1;
}
.seal-harness-session-skill-state {
  padding: 7px 11px 12px;
  font-size: 12px;
  line-height: 1.5;
}
.seal-harness-session-skill-state.is-error {
  color: var(--dsw-alias-text-danger, #ff8c8c);
}
.seal-harness-session-skill-divider {
  height: 1px;
  flex: 0 0 auto;
  background: var(--dsw-alias-border-subtle, rgba(255, 255, 255, 0.1));
}
.seal-harness-session-skill-manage {
  min-height: 34px;
  flex: 0 0 auto;
  padding: 6px 8px;
  color: var(--dsw-alias-text-link, #8db4ff);
  background: transparent;
  border: 0;
  border-radius: 6px;
  text-align: left;
  cursor: pointer;
}
.seal-harness-session-skill-manage:hover,
.seal-harness-session-skill-manage:focus-visible {
  color: var(--dsw-alias-text-primary, #fff);
  background: rgba(255, 255, 255, 0.05);
  outline: none;
}
.seal-harness-session-connector-popover {
  position: fixed;
  z-index: 1200;
  box-sizing: border-box;
  width: min(780px, calc(100vw - 52px));
  max-height: calc(100vh - 24px);
  padding: 10px 10px 0;
  color: var(--dsw-alias-text-primary, #f1f3f5);
  background: var(--dsw-alias-surface-raised, #2b2b2d);
  border: 1px solid var(--dsw-alias-border-strong, rgba(255, 255, 255, 0.22));
  border-radius: 10px;
  box-shadow: 0 18px 46px rgba(0, 0, 0, 0.42);
}
.seal-harness-session-connector-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  min-height: 24px;
  font-size: 12px;
}
.seal-harness-session-connector-header > span,
.seal-harness-session-connector-meta,
.seal-harness-session-connector-copy > span,
.seal-harness-session-connector-empty {
  color: var(--dsw-alias-text-secondary, #aeb4bd);
}
.seal-harness-session-connector-search {
  box-sizing: border-box;
  width: 100%;
  height: 30px;
  margin: 4px 0 10px;
  padding: 0 10px;
  color: inherit;
  background: var(--dsw-alias-surface-sunken, #202124);
  border: 1px solid var(--dsw-alias-border-strong, rgba(255, 255, 255, 0.24));
  border-radius: 5px;
  outline: none;
  font: inherit;
}
.seal-harness-session-connector-search:focus {
  border-color: var(--dsw-alias-border-focus, #6ca0ff);
  box-shadow: 0 0 0 2px rgba(75, 133, 255, 0.35);
}
.seal-harness-session-connector-section-title {
  margin: 0 10px 5px;
  font-size: 11px;
  font-weight: 600;
}
.seal-harness-session-connector-list {
  max-height: 286px;
  overflow: auto;
}
.seal-harness-session-connector-row {
  display: grid;
  grid-template-columns: 20px minmax(0, 1fr) auto 34px;
  gap: 8px;
  align-items: center;
  min-height: 46px;
  padding: 4px 10px;
  border-bottom: 1px solid var(--dsw-alias-border-subtle, rgba(255, 255, 255, 0.1));
  cursor: pointer;
}
.seal-harness-session-connector-row:hover {
  background: rgba(255, 255, 255, 0.035);
}
.seal-harness-session-connector-copy {
  display: flex;
  min-width: 0;
  align-items: baseline;
  gap: 7px;
}
.seal-harness-session-connector-copy > strong {
  flex: none;
  font-size: 13px;
}
.seal-harness-session-connector-copy > span {
  overflow: hidden;
  font-size: 12px;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.seal-harness-session-connector-meta {
  font-size: 12px;
  white-space: nowrap;
}
.seal-harness-session-connector-row input[role="switch"] {
  appearance: none;
  width: 32px;
  height: 18px;
  margin: 0;
  padding: 2px;
  background: rgba(0, 0, 0, 0.35);
  border: 1px solid rgba(255, 255, 255, 0.17);
  border-radius: 999px;
  cursor: pointer;
  transition: background 120ms ease;
}
.seal-harness-session-connector-row input[role="switch"]::after {
  display: block;
  width: 12px;
  height: 12px;
  content: '';
  background: #8d939c;
  border-radius: 50%;
  transition: transform 120ms ease, background 120ms ease;
}
.seal-harness-session-connector-row input[role="switch"]:checked {
  background: #3977e6;
}
.seal-harness-session-connector-row input[role="switch"]:checked::after {
  background: #fff;
  transform: translateX(14px);
}
.seal-harness-session-connector-row input[role="switch"]:disabled {
  cursor: progress;
  opacity: 0.55;
}
.seal-harness-session-connector-empty,
.seal-harness-session-connector-error {
  padding: 16px 10px;
  font-size: 12px;
}
.seal-harness-session-connector-error {
  color: var(--dsw-alias-text-danger, #ff8c8c);
}
.seal-harness-session-connector-manage {
  display: block;
  width: 100%;
  padding: 10px;
  color: var(--dsw-alias-text-link, #8db4ff);
  text-align: left;
  background: transparent;
  border: 0;
  cursor: pointer;
}
.seal-harness-session-connector-manage:hover {
  color: var(--dsw-alias-text-primary, #fff);
}
.seal-harness-session-delete-copy {
  margin: 0;
  color: var(--dsw-alias-text-primary, #f1f3f5);
  line-height: 1.6;
}
.seal-harness-session-delete-error {
  margin: 12px 0 0;
  color: var(--dsw-alias-text-danger, #ff7777);
  font-size: 13px;
}
.seal-harness-session-delete-confirm {
  color: #fff;
  background: var(--dsw-alias-button-danger-background, #d64141);
}
.seal-harness-session-delete-confirm:hover:not(:disabled) {
  background: var(--dsw-alias-button-danger-background-hover, #ed5555);
}
@media (max-width: 760px) {
  .seal-harness-session-connector-popover {
    width: min(560px, calc(100vw - 24px));
  }
  .seal-harness-session-connector-row {
    grid-template-columns: 20px minmax(0, 1fr) 34px;
  }
  .seal-harness-session-connector-meta {
    display: none;
  }
}
`
