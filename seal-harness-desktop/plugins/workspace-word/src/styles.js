export const styles = `
.seal-workspace-word { container-type: inline-size; height: 100%; min-height: 0; display: flex; flex-direction: column; color: var(--dsw-alias-label-primary, #e8e8ea); background: var(--dsw-alias-bg-layer-1, #151515); font-family: var(--dsw-font-family, system-ui, sans-serif); }
.seal-workspace-word * { box-sizing: border-box; }
.seal-workspace-word button, .seal-workspace-word select, .seal-workspace-word input { font: inherit; }
.seal-workspace-word-empty { padding: 32px 36px; }
.seal-workspace-word-empty h1 { margin: 0 0 10px; font-size: 20px; font-weight: 600; }
.seal-workspace-word-empty p { margin: 0; color: #a4a4aa; font-size: 13px; }
.seal-workspace-word-editor { display: flex; flex-direction: column; min-height: 0; flex: 1; }
.seal-workspace-word-header { display: flex; flex-direction: column; gap: 12px; padding: 18px 24px 14px; border-bottom: 1px solid var(--dsw-alias-border-l2, #303034); }
.seal-workspace-word-identity { display: flex; align-items: center; min-width: 0; gap: 12px; }
.seal-workspace-word-format { display: grid; width: 36px; height: 36px; flex: none; place-items: center; border: 1px solid var(--dsw-alias-border-l1, #444); border-radius: 9px; background: var(--dsw-alias-bg-layer-2, #26262a); font-size: 16px; font-weight: 700; }
.seal-workspace-word-title { min-width: 0; }
.seal-workspace-word-title > span { display: block; color: var(--dsw-alias-label-tertiary, #999); font-size: 11px; line-height: 16px; }
.seal-workspace-word-title h1 { margin: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 15px; font-weight: 600; line-height: 22px; }
.seal-workspace-word-path { margin: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--dsw-alias-label-tertiary, #999); font-size: 11px; line-height: 16px; }
.seal-workspace-word-header-actions { display: flex; align-items: center; justify-content: space-between; min-width: 0; gap: 12px; }
.seal-workspace-word-status { display: inline-flex; align-items: center; min-width: 0; gap: 6px; overflow: hidden; color: var(--dsw-alias-label-tertiary, #aaa); font-size: 11px; text-overflow: ellipsis; white-space: nowrap; }
.seal-workspace-word-status-dot { width: 6px; height: 6px; flex: none; border-radius: 50%; background: var(--dsw-alias-state-success-primary, #4ba76a); }
.seal-workspace-word-status[data-dirty] .seal-workspace-word-status-dot { background: #e4a344; }
.seal-workspace-word-buttons { display: flex; flex: none; gap: 6px; }
.seal-workspace-word-buttons button, .seal-workspace-word-edit-action { min-height: 30px; border: 1px solid var(--dsw-alias-border-l1, #46464c); border-radius: 7px; background: var(--dsw-alias-bg-layer-2, #252529); color: var(--dsw-alias-label-primary, #f1f1f3); padding: 5px 10px; cursor: pointer; font-size: 11px; }
.seal-workspace-word-buttons .seal-workspace-word-save { background: var(--dsw-alias-label-primary, #f1f1f3); color: var(--dsw-alias-bg-layer-1, #151515); border-color: transparent; }
.seal-workspace-word-buttons button:disabled { opacity: .45; cursor: default; }
.seal-workspace-word-buttons button:hover:not(:disabled), .seal-workspace-word-edit-action:hover { filter: brightness(1.12); }
.seal-workspace-word-buttons button:focus-visible, .seal-workspace-word-edit-action:focus-visible { outline: 2px solid var(--dsw-focus-ring-color, #bf3540); outline-offset: 2px; }
.seal-workspace-word-error { margin: 0; padding: 10px 28px; background: #3e1f25; color: #ffb8bb; font-size: 12px; }
.seal-workspace-word .word-ribbon { display: flex; flex: none; flex-wrap: nowrap; gap: 10px; overflow-x: auto; overflow-y: hidden; padding: 10px 24px; border-bottom: 1px solid var(--dsw-alias-border-l2, #303034); scrollbar-width: thin; }
.seal-workspace-word .word-ribbon fieldset { display: flex; flex: none; align-items: center; gap: 5px; padding: 0 10px 0 0; margin: 0; border: 0; border-right: 1px solid var(--dsw-alias-border-l2, #3e3e43); }
.seal-workspace-word .word-ribbon legend { padding: 0 0 3px; color: #9999a0; font-size: 10px; }
.seal-workspace-word .word-ribbon button, .seal-workspace-word .word-ribbon select { border: 1px solid #414148; border-radius: 6px; background: #252529; color: #efeff1; padding: 5px 8px; cursor: pointer; font-size: 12px; }
.seal-workspace-word .word-ribbon button:hover:not(:disabled), .seal-workspace-word .word-ribbon button[aria-pressed=true] { background: #4a2529; border-color: #8a4149; }
.seal-workspace-word .word-ribbon button:disabled { opacity: .45; cursor: default; }
.seal-workspace-word .word-ribbon label { display: flex; gap: 4px; align-items: center; color: #c9c9ce; font-size: 12px; }
.seal-workspace-word .word-ribbon input[type=color] { width: 27px; height: 27px; padding: 0; border: 0; background: transparent; }
.seal-workspace-word-paper-scroll { flex: 1; min-height: 0; overflow: auto; padding: 28px 20px 48px; background: var(--dsw-alias-bg-base, #1d1d20); }
.seal-workspace-word-paper { width: min(100%, var(--page-width)); min-height: var(--page-height); margin: 0 auto; padding: min(var(--margin-top), 8%) min(var(--margin-right), 9%) min(var(--margin-bottom), 8%) min(var(--margin-left), 9%); background: #fff; color: #222; box-shadow: 0 8px 32px #0005; }
.seal-workspace-word-paper .tiptap { outline: none; min-height: 65vh; font: 14px/1.65 'Times New Roman', SimSun, serif; overflow-wrap: anywhere; }
.seal-workspace-word-paper .tiptap p { margin: 0 0 .7em; }
.seal-workspace-word-paper .tiptap table { border-collapse: collapse; width: 100%; }
.seal-workspace-word-paper .tiptap td, .seal-workspace-word-paper .tiptap th { border: 1px solid #8f8f8f; padding: 5px; min-width: 24px; }
.seal-workspace-word-paper .tiptap img { max-width: 100%; }
.seal-workspace-word-paper .tiptap .ProseMirror-selectednode { outline: 2px solid #bf3540; }
.seal-workspace-word-blocks { flex: 1; min-height: 0; overflow: auto; padding: 20px 24px; }
.seal-workspace-word-block-note { color: #aaaab2; font-size: 12px; line-height: 1.5; margin: 0 0 16px; }
.seal-workspace-word-block { display: flex; flex-direction: column; gap: 7px; margin: 0 0 16px; color: #dddde2; font-size: 12px; }
.seal-workspace-word-block textarea { box-sizing: border-box; width: 100%; min-height: 72px; resize: vertical; border: 1px solid #46464c; border-radius: 8px; padding: 10px 12px; background: #232326; color: #f1f1f3; font: inherit; line-height: 1.5; }
.seal-workspace-word-block textarea:disabled { opacity: .6; }
.seal-workspace-word-block textarea:focus { outline: 1px solid #bd313c; border-color: #bd313c; }
.seal-workspace-word-sheets { display: flex; gap: 6px; flex-wrap: wrap; margin-bottom: 12px; }
.seal-workspace-word-sheets button { border: 1px solid #46464c; border-radius: 6px; padding: 6px 10px; background: #252529; color: #eee; cursor: pointer; }
.seal-workspace-word-sheets button[aria-current=page] { border-color: #bd313c; background: #4a2529; }
.seal-workspace-word-sheet-scroll { max-width: 100%; overflow: auto; }
.seal-workspace-word-sheet { width: 100%; border-collapse: collapse; }
.seal-workspace-word-sheet th, .seal-workspace-word-sheet td { border: 1px solid #46464c; padding: 5px; }
.seal-workspace-word-sheet th { width: 45px; color: #aaa; font-size: 12px; font-weight: 500; }
.seal-workspace-word-sheet textarea { min-height: 36px; resize: vertical; }
.seal-workspace-word-slide { margin: 0 0 22px; padding: 18px; border: 1px solid #46464c; border-radius: 8px; background: #222226; }
.seal-workspace-word-slide h2 { margin: 0 0 16px; font-size: 15px; }
@container (max-width: 600px) {
  .seal-workspace-word-header { padding: 14px 16px 12px; }
  .seal-workspace-word-header-actions { align-items: flex-start; flex-direction: column; gap: 8px; }
  .seal-workspace-word .word-ribbon { padding: 8px 16px; }
  .seal-workspace-word-paper-scroll { padding: 16px 10px 32px; }
  .seal-workspace-word-blocks { padding: 16px; }
}
`
