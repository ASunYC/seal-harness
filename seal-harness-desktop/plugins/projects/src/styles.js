export const styles = `
.seal-harness-local-projects{box-sizing:border-box;width:100%;height:100%;overflow:auto;padding:30px 38px;color:var(--text-primary,#e9f1f0);background:var(--bg-primary,#111a1d);font-family:inherit}
.seal-harness-local-projects *{box-sizing:border-box}
.seal-harness-local-projects>header{display:flex;align-items:flex-end;justify-content:space-between;gap:20px;margin:0 auto 28px;max-width:1100px}
.seal-harness-local-projects>header span{display:block;margin:8px 0 5px;color:#78bfb2;font-size:11px;font-weight:700;letter-spacing:.16em}
.seal-harness-local-projects h1{margin:0;font-size:30px}.seal-harness-local-projects h2{margin:0 0 8px;font-size:18px}
.seal-harness-local-projects p{margin:0;color:var(--text-secondary,#97aaa9);line-height:1.55}
.seal-harness-local-projects button{min-height:34px;padding:7px 13px;border:1px solid #5d8d87;border-radius:9px;background:#27584f;color:#f4fffc;font:inherit;cursor:pointer}
.seal-harness-local-projects button:hover:not(:disabled){background:#347267}.seal-harness-local-projects button:disabled{opacity:.55;cursor:default}
.seal-harness-local-projects>header button:first-child{padding:3px 9px;background:transparent;border-color:transparent}
.seal-harness-local-projects-list{display:grid;gap:15px;max-width:1100px;margin:auto}
.seal-harness-local-projects-list article{display:flex;justify-content:space-between;gap:24px;padding:21px;border:1px solid #40635e;border-radius:14px;background:#1b2a2c}
.seal-harness-local-projects-path{max-width:65ch;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font:12px/1.5 Consolas,monospace}
.seal-harness-local-projects-actions{display:flex;align-items:flex-start;gap:8px;flex-wrap:wrap}
.seal-harness-local-projects-empty{max-width:1100px;margin:30px auto;padding:30px;border:1px dashed #597b76;border-radius:14px;text-align:center}
.seal-harness-local-projects-form{display:grid;gap:16px;max-width:720px;margin:auto;padding:25px;border:1px solid #40635e;border-radius:14px;background:#1b2a2c}
.seal-harness-local-projects-form label{display:grid;gap:7px}.seal-harness-local-projects-form input,.seal-harness-local-projects-form textarea{width:100%;padding:9px 11px;border:1px solid #68837f;border-radius:8px;background:#122022;color:inherit;font:inherit}
.seal-harness-local-projects-form textarea{min-height:90px;resize:vertical}.seal-harness-local-projects-form>div{display:flex;gap:10px;justify-content:flex-end}
.seal-harness-local-projects-error{max-width:1100px;margin:0 auto 16px!important;color:#f9a7ad!important}.seal-harness-local-projects-notice{max-width:1100px;margin:0 auto 16px!important;color:#96d9c8!important}
.seal-harness-local-projects-overlay{position:fixed;inset:0;z-index:1000;display:grid;place-items:center;background:#0009}.seal-harness-local-projects-overlay>div{width:min(92vw,430px);padding:25px;border-radius:15px;background:#213033}.seal-harness-local-projects-overlay button{margin:20px 8px 0 0}
@media(max-width:760px){.seal-harness-local-projects{padding:20px}.seal-harness-local-projects-list article{display:block}.seal-harness-local-projects-actions{margin-top:16px}}
`
