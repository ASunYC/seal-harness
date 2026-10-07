export const loginStyles = `
.seal-harness-local-login{box-sizing:border-box;min-height:100vh;display:grid;place-items:center;padding:32px 18px;background:#222;color:#18333b;font-family:"Segoe UI Variable Text","Segoe UI","Microsoft YaHei UI",sans-serif}
.seal-harness-local-login *{box-sizing:border-box}
.seal-harness-local-login-card{width:min(100%,440px);padding:36px;border:1px solid #ffffffb8;border-radius:24px;background:#fffffff0;box-shadow:0 24px 70px #1b4b4b22}
.seal-harness-local-login-identity{display:flex;align-items:center;gap:18px}
.seal-harness-local-login-identity img{flex:none;border-radius:19px;object-fit:cover}
.seal-harness-local-login-identity span{color:#397e7a;font-size:11px;font-weight:700;letter-spacing:.17em}
.seal-harness-local-login-identity h1{margin:5px 0 0;font-size:25px;line-height:1.2;letter-spacing:-.02em}
.seal-harness-local-login-lead{margin:25px 0 21px;color:#537078;font-size:14px;line-height:1.6}
.seal-harness-local-login form{display:grid;gap:16px}
.seal-harness-local-login label{display:grid;gap:7px;font-size:13px;font-weight:600}
.seal-harness-local-login input{width:100%;min-height:42px;padding:9px 12px;border:1px solid #b9d4d2;border-radius:10px;background:#fff;color:#18333b;font:inherit;outline:none}
.seal-harness-local-login input:focus{border-color:#37988d;box-shadow:0 0 0 3px #65c5b633}
.seal-harness-local-login input:disabled{opacity:.65}
.seal-harness-local-login button{min-height:44px;margin-top:4px;border:0;border-radius:10px;background:#2f8f85;color:#fff;font:inherit;font-weight:700;cursor:pointer}
.seal-harness-local-login button:hover:not(:disabled){background:#257c73}
.seal-harness-local-login button:disabled{opacity:.65;cursor:default}
.seal-harness-local-login-error{margin:0;color:#a52e40;font-size:13px;line-height:1.45}
.seal-harness-local-login-note{margin:20px 0 0;color:#6f898d;font-size:11px;line-height:1.5;text-align:center}
@media(max-width:480px){.seal-harness-local-login-card{padding:27px 22px}.seal-harness-local-login-identity img{width:72px;height:72px}.seal-harness-local-login-identity h1{font-size:22px}}
`
