/** Seal Harness 登录页沿用 Stratex 的双栏比例和排版，并接入产品图标。 */
export const loginStyles = `
.seal-harness-login-shell{--zz-brand:#68c6bb;box-sizing:border-box;display:grid;grid-template-columns:1.25fr 1fr;grid-template-rows:56px minmax(0,1fr);width:100%;height:100vh;min-width:0;min-height:560px;overflow:hidden;isolation:isolate;background:#07101b;color:#eaf1fb;font-family:"Segoe UI Variable Text","Segoe UI","Microsoft YaHei UI",sans-serif}
.seal-harness-login-shell *, .seal-harness-login-shell *::before, .seal-harness-login-shell *::after{box-sizing:border-box}
.seal-harness-login-top{grid-column:1/-1;z-index:2;display:flex;align-items:center;justify-content:space-between;padding:0 22px;border-bottom:1px solid #99b1d133;background:#080f1a;-webkit-app-region:drag}
.seal-harness-login-brand{display:flex;align-items:baseline;gap:11px;min-width:0}.seal-harness-login-brand strong{font-size:16px;font-weight:660;white-space:nowrap;letter-spacing:-.012em;color:#f5f8ff}
.seal-harness-login-brand-en{padding-left:11px;border-left:1px solid #99b1d13d;color:#97a8bd;font:11px/1 "Cascadia Code",Consolas,monospace;letter-spacing:.16em;white-space:nowrap}
.seal-harness-login-top-note{color:#97a8bd;font:11px/1 "Cascadia Code",Consolas,monospace;letter-spacing:.08em;-webkit-app-region:no-drag;padding-right:108px}
.seal-harness-login-visual{position:relative;grid-column:1;grid-row:2;display:flex;flex-direction:column;justify-content:center;gap:22px;min-width:0;min-height:0;padding:clamp(34px,5vw,60px);overflow:hidden;border-right:1px solid #95b0d32e;background:linear-gradient(160deg,#0a1521,#07101b 70%)}
.seal-harness-login-grid{position:absolute;inset:0;pointer-events:none;opacity:.24;background:linear-gradient(#99b1d138 1px,transparent 1px),linear-gradient(90deg,#99b1d138 1px,transparent 1px);background-size:44px 44px;mask-image:radial-gradient(70% 70% at 40% 45%,#000,transparent)}
.seal-harness-login-kicker,.seal-harness-login-step{position:relative;margin:0;color:#97a8bd;font:11px/1.2 "Cascadia Code",Consolas,monospace;letter-spacing:.18em}
.seal-harness-login-mark{position:relative;display:block;width:132px;height:132px;border-radius:28px;object-fit:cover;box-shadow:0 18px 44px #0404078a,0 2px 8px #0404076b}
.seal-harness-login-visual-title{position:relative;max-width:15em;margin:0;color:#f5f8ff;font-size:clamp(24px,3vw,34px);font-weight:680;line-height:1.2;letter-spacing:-.02em;text-wrap:balance}
.seal-harness-login-caption{position:relative;margin:0;color:#97a8bd;font:12px/1.5 "Cascadia Code",Consolas,monospace}
.seal-harness-login-auth{position:relative;grid-column:2;grid-row:2;display:flex;align-items:center;justify-content:center;min-width:0;min-height:0;overflow:auto;background:#091321}
.seal-harness-login-frame{display:flex;flex-direction:column;gap:22px;width:min(400px,calc(100% - 48px));padding:40px 0}
.seal-harness-login-form{display:flex;flex-direction:column;gap:14px;animation:zz-login-in .42s ease-out both}@keyframes zz-login-in{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:none}}
.seal-harness-login-head{display:flex;flex-direction:column;gap:5px}.seal-harness-login-title{margin:0;color:#f5f8ff;font-size:26px;font-weight:680;letter-spacing:-.02em}.seal-harness-login-lead{margin:0;color:#97a8bd;font-size:13px}
.seal-harness-login-seg{display:inline-flex;align-self:flex-start;gap:2px;padding:3px;border:1px solid #2b3d54;border-radius:999px;background:#0c1826}
.seal-harness-login-seg button{padding:5px 16px;border:0;border-radius:999px;color:#8699b0;background:transparent;font-family:inherit;font-size:13px;font-weight:560;line-height:1.3;cursor:pointer}
.seal-harness-login-seg button[aria-pressed=true]{color:#66788f;background:#f5f8ff;font-weight:640;box-shadow:0 2px 8px #0003}.seal-harness-login-seg button:disabled{opacity:.55;cursor:default}
.seal-harness-login-field{display:flex;flex-direction:column;gap:5px}.seal-harness-login-field label{color:#cbd7e7;font-size:12px;font-weight:600}
.seal-harness-login-field input{width:100%;height:40px;padding:0 13px;border:1px solid #3e536e;border-radius:8px;outline:0;background:#0c1929;color:#f3f7fd;caret-color:var(--zz-brand);font:inherit;font-size:13px}
.seal-harness-login-field input::placeholder{color:#5f7590}.seal-harness-login-field input:focus-visible{border-color:#8ba7d3;box-shadow:0 0 0 3px #8ba7d338}
.seal-harness-login-remember{display:flex;align-items:center;gap:7px;margin:0;color:#97a8bd;font-size:12px}.seal-harness-login-remember input{accent-color:var(--zz-brand)}
.seal-harness-login-sso-note{min-height:100px;margin:0;color:#97a8bd;font-size:13px;line-height:1.6}
.seal-harness-login-error-slot{min-height:20px}.seal-harness-login-error{margin:0;color:#ff8997;font-size:12px;line-height:1.4}.seal-harness-login-status{margin:0;color:#97a8bd;font-size:12px;line-height:1.4}
.seal-harness-login-submit{display:inline-flex;align-items:center;justify-content:center;min-height:42px;padding:0 18px;border:0;border-radius:8px;background:#b8cb22;color:#17191c;font-size:14px;font-weight:700;cursor:pointer}
.seal-harness-login-submit:hover:not(:disabled){filter:brightness(1.08);box-shadow:0 6px 20px #b8cb2240}.seal-harness-login-submit:active:not(:disabled){transform:scale(.98)}.seal-harness-login-submit:disabled{opacity:.65;cursor:default}
.seal-harness-login-submit--ghost{border:1px solid #415672;background:transparent;color:#dbe5f2}.seal-harness-login-help{margin:2px 0 0;text-align:center;color:#97a8bd;font-size:12px}
.seal-harness-login-extra{display:flex;justify-content:center;gap:14px}.seal-harness-login-extra button{padding:0;border:0;background:transparent;color:#9fb5d0;font:inherit;font-size:12px;cursor:pointer}.seal-harness-login-extra button:hover{text-decoration:underline}
.seal-harness-login-services{margin-top:12px;color:#97a8bd;font-size:11px}.seal-harness-login-services summary{cursor:pointer}.seal-harness-login-services dl{display:grid;grid-template-columns:max-content 1fr;gap:5px 10px}.seal-harness-login-services dd{margin:0;overflow-wrap:anywhere}
.seal-harness-login-corner{position:absolute;top:0;right:0;z-index:3;display:grid;place-items:start end;width:72px;height:72px;padding:9px;border:0;background:transparent;color:#111315;cursor:pointer}
.seal-harness-login-corner::before{content:"";position:absolute;inset:0;z-index:-1;background:var(--zz-brand);clip-path:polygon(0 0,100% 0,100% 100%)}.seal-harness-login-corner svg{width:23px;height:23px}
.seal-harness-login-corner:disabled{opacity:.55;cursor:default}.seal-harness-login-corner:focus-visible{outline:2px solid #f5f8ff;outline-offset:-5px}
.seal-harness-wecom-mode{align-items:flex-start;padding-top:76px}.seal-harness-wecom-back{position:absolute;top:22px;left:26px;padding:4px 0;border:0;border-bottom:1px solid #ffffff52;background:transparent;color:#d9dde2;font:650 11px/1.2 "Cascadia Code",Consolas,monospace;cursor:pointer}
.seal-harness-wecom-panel{display:flex;flex-direction:column;align-items:center;gap:16px;width:320px;max-width:calc(100% - 48px);padding-bottom:24px}
.seal-harness-wecom-card{width:100%;padding-bottom:12px;background:#2c2c2d;text-align:center}
.seal-harness-wecom-content{display:flex;flex-direction:column;align-items:center;gap:25px;min-height:380px;padding:36px 24px 24px}
.seal-harness-wecom-refresh{padding:6px 12px;border:0;border-radius:4px;background:transparent;color:#cbd7e7;font:inherit;font-size:12px;cursor:pointer}.seal-harness-wecom-refresh:hover:not(:disabled){color:#f5f8ff;text-decoration:underline}.seal-harness-wecom-refresh:focus-visible{outline:2px solid var(--zz-brand);outline-offset:2px}.seal-harness-wecom-refresh:disabled{opacity:.55;cursor:default}
.seal-harness-wecom-card h1{margin:0;color:#f5f8ff;font-size:18px;font-weight:600}.seal-harness-wecom-window{display:flex;align-items:center;justify-content:center;width:210px;height:210px;padding:18px;border-radius:8px;background:#f5f8ff;color:#1f2c3d;font-size:14px;line-height:1.5}
.seal-harness-wecom-card p{margin:0;color:#97a8bd;font-size:13px;line-height:1.6}.seal-harness-wecom-foot{margin:0;color:#d9dde2;font-size:12px;text-align:center}
@media(max-width:900px){.seal-harness-login-shell{grid-template-columns:minmax(0,1fr)}.seal-harness-login-visual{display:none}.seal-harness-login-auth{grid-column:1}}
@media(max-height:680px){.seal-harness-login-shell{grid-template-rows:52px minmax(0,1fr)}.seal-harness-login-frame{gap:16px;padding:20px 0}.seal-harness-login-field input{height:38px}.seal-harness-wecom-mode{padding-top:42px}}
@media(prefers-reduced-motion:reduce){.seal-harness-login-form{animation:none}}
`
