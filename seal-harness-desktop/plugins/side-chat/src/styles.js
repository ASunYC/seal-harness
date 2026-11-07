export const styles = `
.seal-side-chat{height:100%;min-height:0;display:flex;flex-direction:column;background:#141414}
.seal-side-chat [data-conversation-content]{height:100%;min-height:0;flex:1}
.seal-side-chat [data-composer-seat]{margin-top:auto}
.seal-side-chat-error{margin:20px;color:#ef7777;font:13px system-ui}
.seal-side-chat-selection{position:fixed;z-index:10000;padding:8px 12px;border:1px solid #494949;border-radius:10px;background:#28282b;color:#f6f6f7;font:13px system-ui;box-shadow:0 8px 24px #0008;cursor:pointer}
.seal-side-chat-selection:hover{background:#39393e;border-color:#777}
.seal-side-chat-launch{display:inline-flex;align-items:center;justify-content:center;width:30px;height:30px;border:0;border-radius:8px;background:transparent;color:#b8b9bd;cursor:pointer}
.seal-side-chat-launch:hover{background:#303034;color:#fff}
.seal-side-chat-launch svg{width:18px;height:18px}
`
