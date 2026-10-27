export const loginStyles = `
.seal-harness-local-login{box-sizing:border-box;min-height:100vh;min-height:100dvh;display:grid;place-items:center;padding:24px;background:#101010;color:#f2f2f2;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI","Microsoft YaHei UI",sans-serif}
.seal-harness-local-login *{box-sizing:border-box}
.seal-harness-local-login-card{width:min(100%,488px);padding:26px 40px 40px;border:1px solid #363636;border-radius:20px;background:#161616;box-shadow:0 18px 52px #0005}
.seal-harness-local-login-language{display:flex;justify-content:flex-end;gap:4px;margin-bottom:24px}
.seal-harness-local-login-language button{min-height:36px;padding:6px 12px;border:0;border-radius:9px;background:transparent;color:#a6a6a6;font:inherit;font-size:13px;cursor:pointer}
.seal-harness-local-login-language button[aria-pressed=true]{background:#26384a;color:#d8eaff;font-weight:700}
.seal-harness-local-login button:focus-visible,.seal-harness-local-login input:focus-visible,.seal-harness-login-slider:focus-visible{outline:2px solid #75aee8;outline-offset:3px}
.seal-harness-local-login-brand{display:flex;flex-direction:column;align-items:center;gap:12px;margin-bottom:28px}
.seal-harness-local-login-brand img{width:72px;height:72px;object-fit:contain}
.seal-harness-local-login-brand strong{font-size:27px;line-height:1.2;font-weight:750;letter-spacing:-.035em;color:#f9f9f9}
.seal-harness-local-login h1{margin:0;text-align:center;font-size:25px;font-weight:700;line-height:1.3}
.seal-harness-local-login-lead{margin:10px 0 32px;text-align:center;color:#a6a6a6;font-size:14px;line-height:1.6}
.seal-harness-local-login form{display:flex;flex-direction:column;min-width:0}
.seal-harness-local-login form>label:not(.seal-harness-local-login-remember){margin:0 0 8px;color:#f2f2f2;font-size:15px;font-weight:600}
.seal-harness-local-login form>input,.seal-harness-local-login-password input{display:block;width:100%;min-width:0;height:54px;margin:0 0 20px;padding:0 15px;border:1px solid #373737;border-radius:11px;background:#141414;color:#f4f4f4;font:inherit;font-size:15px;outline:none}
.seal-harness-local-login input::placeholder{color:#777}
.seal-harness-local-login form>input:focus,.seal-harness-local-login-password input:focus{border-color:#639bd6;box-shadow:0 0 0 2px #639bd630}
.seal-harness-local-login input:disabled{opacity:.65}
.seal-harness-local-login input:-webkit-autofill{-webkit-text-fill-color:#f4f4f4;box-shadow:0 0 0 100px #141414 inset}
.seal-harness-local-login-password{position:relative}
.seal-harness-local-login-password input{padding-right:54px}
.seal-harness-local-login-password button{position:absolute;top:0;right:4px;width:48px;height:54px;border:0;background:none;color:#d6d6d6;cursor:pointer}
.seal-harness-local-login-password svg{width:21px;height:21px}
.seal-harness-login-slider{position:relative;display:flex;align-items:center;justify-content:center;width:100%;height:50px;margin:0 0 19px;overflow:hidden;border:1px solid #3d3d3d;border-radius:11px;background:#222;color:#a9a9a9;touch-action:none;user-select:none;cursor:grab}
.seal-harness-login-slider:active{cursor:grabbing}
.seal-harness-login-slider[data-verified=true]{border-color:#83b5e5;background:#eaf4ff;color:#3979b5;cursor:default}
.seal-harness-login-slider__fill{position:absolute;inset:0 auto 0 0;width:calc(var(--seal-slide-offset) + 24px);background:#4d8bc833;pointer-events:none}
.seal-harness-login-slider[data-verified=true] .seal-harness-login-slider__fill{display:none}
.seal-harness-login-slider__label{position:relative;padding:0 55px;font-size:14px;line-height:1.3;white-space:nowrap;pointer-events:none}
.seal-harness-login-slider__thumb{position:absolute;top:0;left:var(--seal-slide-offset);display:grid;place-items:center;width:48px;height:48px;border:1px solid #454545;border-radius:10px;background:#303030;color:#eee;box-shadow:0 1px 4px #0004;pointer-events:none}
.seal-harness-login-slider__thumb svg{width:19px;height:19px}
.seal-harness-login-slider[data-verified=true] .seal-harness-login-slider__thumb{border-color:#4d8bc8;background:#4d8bc8;color:white}
.seal-harness-local-login-remember{display:flex;align-items:center;gap:9px;margin:0 0 17px;color:#a6a6a6;font-size:13px;cursor:pointer}
.seal-harness-local-login-remember input{width:16px;height:16px;margin:0;accent-color:#5b9bd7;cursor:pointer}
.seal-harness-local-login-submit{width:100%;min-height:54px;border:0;border-radius:11px;background:#4b86c3;color:white;font:inherit;font-size:16px;font-weight:700;cursor:pointer}
.seal-harness-local-login-submit:hover:not(:disabled){background:#5a9bd7}
.seal-harness-local-login-submit:disabled{opacity:.55;cursor:default}
.seal-harness-local-login-error{margin:0 0 14px;color:#ff8f94;font-size:13px;line-height:1.5;overflow-wrap:anywhere}
.seal-harness-local-login-restoring{margin:48px 0;color:#aaa;text-align:center;font-size:14px}
@media(max-width:520px){.seal-harness-local-login{padding:0}.seal-harness-local-login-card{min-height:100dvh;width:100%;padding:26px clamp(22px,8vw,40px) 36px;border-radius:20px}}
@media(max-height:760px){.seal-harness-local-login-card{padding-top:18px;padding-bottom:24px}.seal-harness-local-login-language{margin-bottom:12px}.seal-harness-local-login-brand{margin-bottom:18px}.seal-harness-local-login-lead{margin-bottom:22px}}
`
