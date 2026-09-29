// 来源：Stratex skill-ui.css 的文件工作台布局，限定在产品资源页。
export const fileStyles = `
.zz-resource-page .skill-detail-resizer{position:absolute;display:block;top:0;bottom:0;left:0;width:6px;cursor:ew-resize;z-index:3;touch-action:none}.zz-resource-page .skill-detail-resizer:hover{background:var(--line-strong)}
.zz-resource-page .skill-file-workbench{display:grid;grid-template-columns:minmax(150px,24%) minmax(0,1fr);min-height:430px;border:1px solid var(--line);border-radius:10px;overflow:hidden;margin:18px 0;background:var(--panel)}
.zz-resource-page .skill-file-sidebar{border-right:1px solid var(--line);overflow:auto;background:var(--bg)}
.zz-resource-page .skill-pane-heading{display:flex;justify-content:space-between;align-items:center;gap:10px;min-height:44px;padding:8px 14px;border-bottom:1px solid var(--line);font-size:12px;overflow-wrap:anywhere}
.zz-resource-page .skill-pane-heading>span{min-width:0}.zz-resource-page .skill-file-tree{list-style:none;margin:0;padding:8px}
.zz-resource-page .skill-file-tree .skill-file-tree{padding:3px 0 3px 14px}.zz-resource-page .skill-file-tree li{margin:2px 0;min-width:0}
.zz-resource-page .skill-file-tree button{display:flex;align-items:center;gap:8px;width:100%;border:0!important;border-radius:6px!important;background:transparent!important;text-align:left;padding:7px!important;font-size:12px!important;overflow-wrap:anywhere}
.zz-resource-page .skill-file-tree-name{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.zz-resource-page .skill-file-tree button[aria-pressed=true]{background:var(--raised)!important;color:var(--accent-text)!important}
.zz-resource-page .skill-file-tree summary{display:flex;align-items:center;gap:8px;cursor:pointer;font-size:12px;padding:5px;list-style:none}.zz-resource-page .skill-file-tree summary::-webkit-details-marker{display:none}.zz-resource-page .skill-file-tree-spacer{width:13px;flex:none}.zz-resource-page .skill-file-tree [data-icon-name="skill-file"],.zz-resource-page .skill-file-tree [data-icon-name="skill-folder"]{color:var(--muted)}.zz-resource-page .skill-file-tree-chevron{transition:transform 120ms ease}.zz-resource-page .skill-file-tree details[open]>summary>.skill-file-tree-chevron{transform:rotate(90deg)}.zz-resource-page .skill-file-tree details{border:0;padding:0}
.zz-resource-page .skill-file-content{min-width:0;display:flex;flex-direction:column}.zz-resource-page .skill-file-metadata{padding:8px 16px;font-size:11px;color:var(--muted2);border-bottom:1px solid var(--line)}
.zz-resource-page .skill-editor-actions{display:flex;gap:6px;flex-shrink:0}.zz-resource-page .skill-editor-actions button{padding:5px 8px!important;font-size:12px!important}
.zz-resource-page .skill-code-surface{padding:20px;flex:1;min-height:280px;overflow:auto;max-height:58vh}
.zz-resource-page .skill-code-surface>textarea{box-sizing:border-box;width:100%;height:100%;min-height:350px;border:0;background:var(--panel);color:var(--ink);font:13px/1.7 var(--font-mono,monospace);resize:vertical}
.zz-resource-page .skill-code-surface pre{white-space:pre-wrap;overflow-wrap:anywhere;font:12px/1.7 var(--font-mono,monospace);margin:0}
.zz-resource-page .skill-markdown-document{font-size:14px;line-height:1.8;overflow-wrap:anywhere;color:var(--ink)}
.zz-resource-page .skill-markdown-document h1{font-size:24px}.zz-resource-page .skill-markdown-document h2{font-size:20px}.zz-resource-page .skill-markdown-document h3{font-size:16px}
.zz-resource-page .skill-markdown-document pre{padding:16px;background:var(--raised);border-radius:8px;overflow:auto}.zz-resource-page .skill-markdown-document code{font-family:var(--font-mono,monospace);font-size:12px}
.zz-resource-page .skill-markdown-document table{border-collapse:collapse;width:100%}.zz-resource-page .skill-markdown-document td,.zz-resource-page .skill-markdown-document th{border:1px solid var(--line);padding:6px 10px}.zz-resource-page .skill-md-table-wrap{overflow:auto}
@media(prefers-reduced-motion:reduce){.zz-resource-page .skill-file-tree-chevron{transition:none}}
@media(max-width:620px){.zz-resource-page .skill-file-workbench{grid-template-columns:1fr}.zz-resource-page .skill-file-sidebar{max-height:160px;border-right:0;border-bottom:1px solid var(--line)}}
`
