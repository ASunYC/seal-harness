export const styles = `
.ask-jev-page{--aj-bg:var(--dsw-alias-bg-base,#151515);--aj-panel:var(--dsw-alias-bg-layer-1,#222);--aj-raised:var(--dsw-alias-bg-layer-2,#2c2c2c);--aj-ink:var(--dsw-alias-label-primary,#f5f5f5);--aj-muted:var(--dsw-alias-label-secondary,#aaa);--aj-line:color-mix(in srgb,var(--aj-ink) 14%,transparent);--aj-accent:var(--dsw-alias-brand-primary,#6488d2);box-sizing:border-box;width:100%;height:100%;overflow:auto;background:var(--aj-bg);color:var(--aj-ink);font:14px/1.6 "Segoe UI Variable Text","Segoe UI","Microsoft YaHei UI",sans-serif}
.ask-jev-page *{box-sizing:border-box}
.ask-jev-page button,.ask-jev-page input,.ask-jev-page textarea,.ask-jev-page select{font:inherit}
.ask-jev-page :focus-visible{outline:2px solid var(--aj-accent);outline-offset:3px}
.ask-jev-nav{position:sticky;top:0;z-index:10;display:flex;align-items:center;gap:10px;height:54px;padding:0 clamp(20px,4vw,52px);border-bottom:1px solid var(--aj-line);background:var(--aj-bg)}
.ask-jev-nav strong{font-size:14px}.ask-jev-nav>span{padding:2px 8px;border-radius:999px;background:var(--aj-raised);color:var(--aj-muted);font-size:10px;letter-spacing:.04em}
.ask-jev-back{display:grid;place-items:center;width:32px;height:32px;padding:0;border:0;border-radius:8px;background:transparent;color:var(--aj-muted);font-size:20px;cursor:pointer}
.ask-jev-back:hover{background:var(--aj-panel);color:var(--aj-ink)}
.ask-jev-content{display:grid;gap:24px;max-width:1040px;margin:auto;padding:30px clamp(20px,4vw,52px) 52px}
.ask-jev-intro{margin-bottom:4px}.ask-jev-eyebrow{margin:0 0 6px;color:var(--aj-accent);font-size:11px;font-weight:700;letter-spacing:.13em}
.ask-jev-intro h1{margin:0;font-size:clamp(27px,3vw,38px);line-height:1.2;letter-spacing:-.03em}.ask-jev-intro>p:last-child{max-width:680px;margin:10px 0 0;color:var(--aj-muted)}
.ask-jev-card,.ask-jev-result{padding:24px;border:1px solid var(--aj-line);border-radius:14px;background:var(--aj-panel)}
.ask-jev-section-title{display:flex;align-items:start;justify-content:space-between;gap:16px;margin-bottom:20px}.ask-jev-section-title h2,.ask-jev-result h2{margin:0;font-size:20px}.ask-jev-section-title p{margin:4px 0 0;color:var(--aj-muted);font-size:12px}.ask-jev-section-title>span{padding:3px 9px;border-radius:999px;background:var(--aj-raised);color:var(--aj-muted);white-space:nowrap;font-size:12px}
.ask-jev-provider-choices,.ask-jev-mode-choices{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:18px}
.ask-jev-provider-choices button,.ask-jev-mode-choices button{padding:9px 14px;border:1px solid var(--aj-line);border-radius:9px;background:var(--aj-raised);color:var(--aj-ink);text-align:left;cursor:pointer}
.ask-jev-provider-choices button[aria-pressed="true"],.ask-jev-mode-choices button[aria-pressed="true"]{border-color:var(--aj-accent);background:color-mix(in srgb,var(--aj-accent) 17%,var(--aj-panel))}
.ask-jev-provider-choices small{display:block;color:var(--aj-muted);font-size:11px}.ask-jev-page button:disabled{cursor:default;opacity:.55}
.ask-jev-settings-form,.ask-jev-decision-form{display:grid;gap:16px}.ask-jev-settings-form{grid-template-columns:repeat(2,minmax(0,1fr));align-items:end}.ask-jev-settings-form>button{justify-self:start}
.ask-jev-page label{display:grid;gap:6px;color:var(--aj-ink);font-size:13px;font-weight:600}
.ask-jev-page input,.ask-jev-page select,.ask-jev-page textarea{width:100%;min-height:40px;padding:9px 12px;border:1px solid var(--aj-line);border-radius:8px;background:var(--aj-bg);color:var(--aj-ink);font-weight:400;outline:none}
.ask-jev-page textarea{min-height:85px;resize:vertical}.ask-jev-page input:focus,.ask-jev-page select:focus,.ask-jev-page textarea:focus{border-color:var(--aj-accent)}
.ask-jev-settings-form>button,.ask-jev-submit{min-height:39px;padding:8px 18px;border:0;border-radius:8px;background:var(--aj-ink);color:var(--aj-bg);font-weight:600;cursor:pointer}.ask-jev-submit{justify-self:start;margin-top:3px}
.ask-jev-hint{margin:0;color:var(--aj-muted);font-size:12px}.ask-jev-message{margin:0;padding:10px 14px;border:1px solid var(--aj-line);border-radius:8px;background:var(--aj-raised)}.ask-jev-error{color:var(--dsw-alias-state-error-primary,#ff8d8d)}
.ask-jev-result h2{font-size:26px}.ask-jev-result-model,.ask-jev-result-note{color:var(--aj-muted);font-size:12px}.ask-jev-result-metric{margin:18px 0}.ask-jev-result-metric>strong{display:block;font-size:26px}.ask-jev-meter{height:7px;overflow:hidden;border-radius:99px;background:var(--aj-raised)}.ask-jev-meter span{display:block;height:100%;background:var(--aj-accent)}
.ask-jev-result-metric ul{display:grid;gap:8px;max-width:520px;padding:0;list-style:none}.ask-jev-result-metric li{display:flex;justify-content:space-between;gap:16px;padding:7px 0;border-bottom:1px solid var(--aj-line)}
.ask-jev-attribution{margin:0;color:var(--aj-muted);font-size:11px}.ask-jev-attribution a{color:var(--aj-accent)}
@media(max-width:650px){.ask-jev-content{padding:22px 16px 38px}.ask-jev-card,.ask-jev-result{padding:18px}.ask-jev-settings-form{grid-template-columns:1fr}}
.ask-jev-settings-page{height:auto;min-height:0;overflow:visible;padding:4px 0 28px;background:transparent}.ask-jev-settings-page h2{margin:0 0 6px;font-size:22px}.ask-jev-settings-page>.ask-jev-hint{margin-bottom:18px}.ask-jev-settings-page .ask-jev-card{padding:20px}.ask-jev-settings-page .ask-jev-section-title h3{margin:0;font-size:17px}
`
