export const rightGuideStyles = `
.seal-right-guide { box-sizing: border-box; container-type: inline-size; height: 100%; overflow-y: auto; padding: 24px clamp(16px, 4vw, 32px) 48px; background: var(--dsw-alias-bg-layer-1, #151515); color: var(--dsw-alias-label-primary, #eee); font-family: var(--dsw-font-family, system-ui, sans-serif); }
.seal-right-guide * { box-sizing: border-box; }
.seal-right-guide button, .seal-right-guide input { font: inherit; }
.seal-right-guide-toolbar { display: flex; align-items: center; gap: 10px; max-width: 720px; margin: 0 auto 32px; }
.seal-right-guide-address { display: flex; align-items: center; gap: 10px; min-width: 0; flex: 1; min-height: 42px; padding: 0 8px 0 14px; border: 1px solid var(--dsw-alias-border-l1, #454549); border-radius: 22px; background: var(--dsw-alias-bg-layer-2, #2b2b2d); }
.seal-right-guide-address svg { width: 18px; height: 18px; flex: none; color: #aaa; }
.seal-right-guide-address input { width: 100%; min-width: 0; border: 0; outline: 0; background: transparent; color: inherit; font-size: 13px; }
.seal-right-guide-address input::placeholder { color: var(--dsw-alias-label-tertiary, #888); }
.seal-right-guide-address button { border: 0; border-radius: 16px; padding: 5px 11px; background: #46464a; color: #eee; cursor: pointer; font-size: 11px; }
.seal-right-guide-more { position: relative; flex: none; margin-left: auto; }
.seal-right-guide-more summary { display: grid; place-items: center; width: 38px; height: 38px; border-radius: 50%; background: var(--dsw-alias-bg-layer-2, #2b2b2d); color: #ddd; cursor: pointer; font-size: 22px; line-height: 1; list-style: none; }
.seal-right-guide-more summary::-webkit-details-marker { display: none; }
.seal-right-guide-more summary:hover, .seal-right-guide-more[open] summary { background: #3a3a3e; }
.seal-right-guide-more summary:focus-visible, .seal-right-guide-menu button:focus-visible { outline: 2px solid var(--dsw-focus-ring-color, #bf3540); outline-offset: 2px; }
.seal-right-guide-menu { position: absolute; z-index: 20; top: 44px; right: 0; width: min(280px, 80cqw); padding: 7px; border: 1px solid var(--dsw-alias-border-l1, #454549); border-radius: 13px; background: var(--dsw-alias-bg-layer-2, #29292c); box-shadow: 0 14px 40px #0008; }
.seal-right-guide-menu-heading { margin: 4px 8px 6px; color: var(--dsw-alias-label-tertiary, #aaa); font-size: 11px; }
.seal-right-guide-menu-divider { margin-top: 8px; padding-top: 9px; border-top: 1px solid var(--dsw-alias-border-l2, #454549); }
.seal-right-guide-menu button { display: flex; justify-content: space-between; align-items: center; gap: 12px; width: 100%; min-height: 34px; padding: 6px 9px; border: 0; border-radius: 7px; background: transparent; color: #eee; text-align: left; cursor: pointer; font-size: 12px; }
.seal-right-guide-menu button:hover { background: #404044; }
.seal-right-guide-menu button span:last-child { color: #aab3c7; }
.seal-right-guide-section { max-width: 720px; margin: 0 auto 36px; }
.seal-right-guide-section h2 { margin: 0 0 16px; font-size: 14px; line-height: 20px; font-weight: 600; }
.seal-right-guide-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 7px; }
.seal-right-guide-tool, .seal-right-guide-document { display: flex; align-items: center; min-width: 0; width: 100%; border: 1px solid transparent; border-radius: 10px; background: var(--dsw-alias-bg-layer-2, #242426); color: inherit; text-align: left; cursor: pointer; }
.seal-right-guide-tool { gap: 10px; min-height: 52px; padding: 8px 11px; }
.seal-right-guide-tool:hover, .seal-right-guide-document:hover { border-color: var(--dsw-alias-border-l1, #4b4b50); background: #303034; }
.seal-right-guide-tool:focus-visible, .seal-right-guide-document:focus-visible, .seal-right-guide-address button:focus-visible, .seal-right-guide-address input:focus-visible { outline: 2px solid var(--dsw-focus-ring-color, #bf3540); outline-offset: 2px; }
.seal-right-guide-tool-icon { display: grid; place-items: center; flex: none; width: 22px; height: 22px; color: #adb6c8; }
.seal-right-guide-tool-icon svg { width: 19px; height: 19px; }
.seal-right-guide-tool-copy, .seal-right-guide-document-copy { display: flex; flex-direction: column; min-width: 0; gap: 2px; }
.seal-right-guide-tool-copy strong, .seal-right-guide-document-copy strong { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 12px; line-height: 17px; font-weight: 550; }
.seal-right-guide-tool-copy small, .seal-right-guide-document-copy small { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--dsw-alias-label-tertiary, #999); font-size: 10px; line-height: 14px; }
.seal-right-guide-tool-arrow { margin-left: auto; color: #777; font-size: 18px; }
.seal-right-guide-document-list { display: flex; flex-direction: column; gap: 5px; }
.seal-right-guide-document { gap: 12px; min-height: 53px; padding: 7px 11px; background: transparent; border-bottom-color: var(--dsw-alias-border-l2, #303034); }
.seal-right-guide-document-icon { display: grid; place-items: center; width: 28px; height: 28px; flex: none; border-radius: 8px; background: #30343e; color: #94b9ff; font-size: 12px; font-weight: 700; }
.seal-right-guide-empty { margin: 0; color: var(--dsw-alias-label-tertiary, #999); font-size: 12px; line-height: 1.6; }
@container (max-width: 430px) { .seal-right-guide-grid { grid-template-columns: minmax(0, 1fr); } }
`
