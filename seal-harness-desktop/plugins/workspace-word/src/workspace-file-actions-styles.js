export const workspaceFileActionStyles = `
.seal-workspace-office-file-actions { display: inline-flex; align-items: center; gap: 6px; }
.seal-workspace-office-file-action { display: inline-flex; flex: none; align-items: center; justify-content: center; width: 28px; height: 28px; padding: 0; border: 0; border-radius: var(--dsw-radius-sm, 7px); background: transparent; color: var(--dsw-alias-label-secondary, #aaa); cursor: pointer; }
.seal-workspace-office-file-action svg { width: 16px; height: 16px; }
.seal-workspace-office-file-action:hover:not(:disabled) { background: var(--dsw-alias-interactive-bg-hover, #34363b); color: var(--dsw-alias-label-primary, #fff); }
.seal-workspace-office-file-action:focus-visible { outline: 2px solid var(--dsw-focus-ring-color, #bf3540); outline-offset: 2px; }
.seal-workspace-office-file-actions > button:disabled { opacity: .5; cursor: default; }
[data-files-entry="file"]:has(> .seal-workspace-file-row-actions) { position: relative; }
[data-files-entry="file"]:has(> .seal-workspace-file-row-actions) > button { padding-right: 106px; }
.seal-workspace-file-row-actions { position: absolute; top: 50%; right: 7px; display: inline-flex; align-items: center; gap: 2px; transform: translateY(-50%); }
.seal-workspace-file-row-actions > button { display: inline-flex; align-items: center; justify-content: center; width: 26px; height: 26px; padding: 0; border: 0; border-radius: 6px; background: transparent; color: var(--dsw-alias-label-secondary, #aaa); cursor: pointer; }
.seal-workspace-file-row-actions > button svg { width: 15px; height: 15px; }
.seal-workspace-file-row-actions > button:hover:not(:disabled), .seal-workspace-file-row-actions > button:focus-visible { background: var(--dsw-alias-interactive-bg-hover, #34363b); color: var(--dsw-alias-label-primary, #fff); }
.seal-workspace-file-row-actions > button:disabled { opacity: .4; cursor: default; }
.seal-workspace-file-open-menu { position: absolute; top: calc(100% + 5px); right: 0; z-index: 30; display: grid; min-width: 176px; padding: 5px; border: 1px solid var(--dsw-alias-border-l2, #45454b); border-radius: 9px; background: var(--dsw-alias-bg-elevated, #29292d); box-shadow: 0 12px 32px #0008; }
.seal-workspace-file-open-menu button { width: 100%; padding: 7px 9px; border: 0; border-radius: 5px; background: transparent; color: var(--dsw-alias-label-primary, #fff); font: inherit; text-align: left; cursor: pointer; }
.seal-workspace-file-open-menu button:hover, .seal-workspace-file-open-menu button:focus-visible { background: var(--dsw-alias-interactive-bg-hover, #34363b); }
.seal-workspace-office-file-notice { position: absolute; right: 8px; top: 100%; z-index: 2; max-width: 280px; padding: 7px 9px; border-radius: 7px; background: var(--dsw-alias-bg-elevated, #252529); box-shadow: 0 6px 20px #0005; font-size: 12px; }
.seal-workspace-office-dialog-backdrop { position: fixed; inset: 0; z-index: 10000; display: grid; place-items: center; background: #0008; }
.seal-workspace-office-dialog { width: min(440px, calc(100vw - 32px)); max-height: calc(100vh - 32px); overflow: auto; padding: 22px; border: 1px solid var(--dsw-alias-border-l2, #45454b); border-radius: 14px; background: var(--dsw-alias-bg-base, #222226); color: var(--dsw-alias-text-primary, #eee); box-shadow: 0 18px 60px #0008; }
.seal-workspace-office-dialog header, .seal-workspace-office-dialog footer { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
.seal-workspace-office-dialog h2 { margin: 0 0 16px; font-size: 18px; }
.seal-workspace-office-dialog header button { align-self: start; border: 0; background: none; color: inherit; font-size: 22px; cursor: pointer; }
.seal-workspace-office-dialog form { display: grid; gap: 13px; }
.seal-workspace-office-dialog label { display: grid; gap: 6px; font-size: 13px; }
.seal-workspace-office-dialog input, .seal-workspace-office-dialog select, .seal-workspace-office-dialog textarea { min-width: 0; width: 100%; box-sizing: border-box; border: 1px solid var(--dsw-alias-border-l2, #45454b); border-radius: 8px; background: var(--dsw-alias-bg-elevated, #2b2b2f); color: inherit; padding: 9px; font: inherit; }
.seal-workspace-office-dialog p { margin: 0; color: var(--dsw-alias-text-secondary, #aaa); font-size: 12px; }
.seal-workspace-office-dialog .seal-workspace-office-dialog-error { color: #ff9c9c; margin-bottom: 12px; }
.seal-workspace-office-dialog footer { justify-content: flex-end; margin-top: 4px; }
.seal-workspace-office-dialog footer button { border: 1px solid var(--dsw-alias-border-l2, #45454b); border-radius: 8px; background: var(--dsw-alias-bg-elevated, #2b2b2f); color: inherit; padding: 8px 15px; font: inherit; cursor: pointer; }
.seal-workspace-office-dialog footer button[type=submit] { border-color: #bd313c; background: #bd313c; color: white; }
.seal-workspace-office-dialog footer button:disabled { opacity: .5; cursor: default; }
`
