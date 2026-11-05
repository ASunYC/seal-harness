export const workspaceFileActionStyles = `
.seal-workspace-office-file-actions { display: inline-flex; align-items: center; gap: 6px; }
.seal-workspace-office-file-actions > button { border: 1px solid var(--dsw-alias-border-l2, #444); border-radius: 7px; background: var(--dsw-alias-bg-base, #252529); color: inherit; padding: 5px 8px; font: inherit; font-size: 12px; cursor: pointer; }
.seal-workspace-office-file-actions > button:disabled { opacity: .5; cursor: default; }
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
