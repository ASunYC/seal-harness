export const styles = `
.seal-org-page { display: flex; flex-direction: column; min-width: 0; height: 100%; color: var(--dsw-alias-label-primary,#f4f4f5); background: var(--dsw-alias-bg-base,#151618); font: 14px/1.5 "Segoe UI Variable Text","Segoe UI","Microsoft YaHei UI",sans-serif; }
.seal-org-page button,.seal-org-page input,.seal-org-page select { font: inherit; }
.seal-org-page button { cursor: pointer; }
.seal-org-header { display: flex; align-items: center; justify-content: space-between; gap: 18px; min-height: 68px; padding: 12px 24px; box-sizing: border-box; border-bottom: 1px solid var(--dsw-alias-border-l1,#34363b); }
.seal-org-header > div:first-child { display: flex; align-items: center; gap: 10px; }
.seal-org-header h1 { margin: 0; font-size: 20px; }
.seal-org-header small { color: var(--dsw-alias-label-tertiary,#92949a); }
.seal-org-header button[aria-label="返回会话"] { border: 0; background: none; color: inherit; font-size: 20px; }
.seal-org-actions { display: flex; flex-wrap: wrap; gap: 8px; }
.seal-org-actions button { min-height: 34px; padding: 5px 12px; border: 1px solid var(--dsw-alias-border-l2,#44464b); border-radius: 8px; background: var(--dsw-alias-bg-layer-1,#242529); color: inherit; }
.seal-org-actions .seal-org-primary { border-color: #316fae; background: #316fae; color: #fff; }
.seal-org-actions .seal-org-primary:hover { border-color: #3f83c2; background: #3f83c2; }
.seal-org-actions .seal-org-danger { color: var(--dsw-alias-state-error-primary,#e97878); }
.seal-org-columns { display: grid; grid-template-columns: minmax(245px,300px) minmax(0,1fr); flex: 1; min-height: 0; }
.seal-org-sidebar { min-width: 0; overflow: auto; border-right: 1px solid var(--dsw-alias-border-l1,#34363b); background: var(--dsw-alias-bg-layer-1,#1e1f22); }
.seal-org-sidebar-head { display: flex; flex-direction: column; gap: 2px; padding: 24px 18px 16px; }
.seal-org-sidebar-head strong { font-size: 18px; }
.seal-org-sidebar-head span,.seal-org-tree small,.seal-org-results small { color: var(--dsw-alias-label-tertiary,#92949a); font-size: 12px; }
.seal-org-search { display: block; margin: 0 14px 14px; }
.seal-org-search input { box-sizing: border-box; width: 100%; min-height: 38px; padding: 8px 12px; border: 1px solid var(--dsw-alias-border-l2,#3a3c42); border-radius: 9px; outline: none; background: var(--dsw-alias-bg-base,#151618); color: inherit; }
.seal-org-search input:focus-visible,.seal-org-editor :is(input,select):focus-visible { border-color: var(--dsw-alias-brand-primary,#5d8ef0); }
.seal-org-root,.seal-org-tree button,.seal-org-results button { display: flex; justify-content: space-between; align-items: center; gap: 8px; box-sizing: border-box; width: 100%; min-height: 36px; padding: 7px 13px; border: 0; border-radius: 8px; background: transparent; color: inherit; text-align: left; }
.seal-org-root { width: calc(100% - 28px); margin: 2px 14px; }
.seal-org-root:hover,.seal-org-tree button:hover,.seal-org-results button:hover,.seal-org-root[aria-current="page"],.seal-org-tree button[aria-current="page"] { background: var(--dsw-alias-interactive-bg-hover,#30343b); }
.seal-org-tree,.seal-org-tree ul { margin: 0; padding: 0; list-style: none; }
.seal-org-tree { padding: 0 14px; }
.seal-org-tree ul { padding-left: 14px; }
.seal-org-tree button span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.seal-org-results { display: flex; flex-direction: column; padding: 0 14px; }
.seal-org-results > strong { padding: 12px 8px 4px; font-size: 12px; color: var(--dsw-alias-label-tertiary,#92949a); }
.seal-org-results > p { padding: 8px; color: var(--dsw-alias-label-secondary,#b2b4ba); }
.seal-org-content { min-width: 0; overflow: auto; padding: clamp(20px,3vw,42px); }
.seal-org-detail-head { display: flex; justify-content: space-between; align-items: start; gap: 14px; margin-bottom: 22px; }
.seal-org-detail-head h2,.seal-org-editor h2,.seal-org-confirm h2 { margin: 0; font-size: 24px; }
.seal-org-detail-head p { margin: 4px 0 0; color: var(--dsw-alias-label-secondary,#b2b4ba); }
.seal-org-person-list { display: flex; flex-direction: column; max-width: 780px; }
.seal-org-person-list button { display: flex; align-items: center; gap: 12px; min-height: 64px; padding: 10px; border: 0; border-bottom: 1px solid var(--dsw-alias-border-l1,#34363b); background: transparent; color: inherit; text-align: left; }
.seal-org-person-list button:hover { background: var(--dsw-alias-interactive-bg-hover,#30343b); }
.seal-org-person-list button > span:nth-child(2) { display: flex; flex: 1; flex-direction: column; }
.seal-org-person-list small { color: var(--dsw-alias-label-secondary,#b2b4ba); }
.seal-org-avatar { display: grid; width: 34px; height: 34px; place-items: center; border-radius: 50%; background: #374766; color: white; }
.seal-org-empty { padding: 35px 10px; color: var(--dsw-alias-label-secondary,#b2b4ba); }
.seal-org-detail { display: grid; gap: 15px; max-width: 650px; }
.seal-org-detail div { display: grid; grid-template-columns: 90px 1fr; gap: 15px; padding-bottom: 14px; border-bottom: 1px solid var(--dsw-alias-border-l1,#34363b); }
.seal-org-detail dt { color: var(--dsw-alias-label-secondary,#b2b4ba); }
.seal-org-detail dd { margin: 0; }
.seal-org-editor { display: grid; gap: 15px; max-width: 570px; }
.seal-org-editor label { display: grid; gap: 6px; }
.seal-org-editor label span { color: var(--dsw-alias-label-secondary,#b2b4ba); }
.seal-org-editor :is(input,select) { box-sizing: border-box; width: 100%; min-height: 38px; padding: 7px 10px; border: 1px solid var(--dsw-alias-border-l2,#44464b); border-radius: 8px; background: var(--dsw-alias-bg-layer-1,#242529); color: inherit; }
.seal-org-editor .seal-org-check { display: flex; align-items: center; gap: 8px; }
.seal-org-editor .seal-org-check input { width: auto; min-height: 0; }
.seal-org-editor .seal-org-actions { margin-top: 6px; }
.seal-org-confirm { display: grid; gap: 15px; max-width: 560px; }
.seal-org-error { display: flex; align-items: center; gap: 12px; margin: 0; padding: 8px 24px; background: #4b2a2a; color: #fff; }
.seal-org-error button { border: 1px solid currentColor; border-radius: 6px; background: transparent; color: inherit; }
@media (max-width: 760px) { .seal-org-header { flex-wrap: wrap; padding: 12px; } .seal-org-columns { grid-template-columns: 1fr; grid-template-rows: minmax(180px,36vh) minmax(0,1fr); } .seal-org-sidebar { border-right: 0; border-bottom: 1px solid var(--dsw-alias-border-l1,#34363b); } }
`
