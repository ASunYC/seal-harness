import { resourceStyles } from '../../capability-shared/src/resource-styles.js'
import { sourceStyles } from './source-styles.js'

export const styles = resourceStyles + sourceStyles + `
.zz-agents { --focus-ring:0 0 0 2px var(--accent); }
.zz-agents button { font:inherit; cursor:pointer; }
.zz-agents button:disabled { cursor:not-allowed; }
.zz-agents .za-overlay { position:fixed; inset:0; z-index:1000; display:flex; align-items:center; justify-content:center; padding:20px; background:var(--scrim); }
.zz-agents .za-overlay>.agent-local-ui { display:contents; }
.zz-agents .za-dialog { width:min(500px,100%); max-height:90vh; overflow:auto; padding:24px; border:1px solid var(--line); border-radius:14px; background:var(--panel); }
.zz-agents .za-overlay :is(.create-dialog,.settings-dialog) { max-height:90vh; overflow:auto; }
.zz-agents .za-error { color:var(--danger-text); white-space:pre-wrap; overflow-wrap:anywhere; }
.zz-agents .za-progress { margin:16px 0; }
.zz-agents .za-overlay .za-progress { width:min(780px,100%); max-height:90vh; overflow:auto; margin:0; }
.zz-agents .za-detail { width:min(1184px,100%); min-height:100%; margin:auto; padding:20px 28px 40px; }
.zz-agents .za-detail .local-agent { max-width:none; margin:14px 0 0; }
.zz-agents .center-card .za-resource-button { width:auto; padding:0 10px; line-height:1.3; }
.zz-agents .card-meta-item { min-width:0; }
.zz-agents .za-workspace { overflow:hidden; white-space:nowrap; text-overflow:ellipsis; max-width:280px; }
.zz-agents .settings-dialog-body code { overflow-wrap:anywhere; font-size:12px; }
.zz-agents .agent-local-ui :is(.instance-overview .actions button, .access-card>.text-button) { display:inline-flex; align-items:center; gap:6px; }
.zz-agents .agent-local-ui .creation-close { padding:0; }
.zz-agents .agent-local-ui .form-grid .za-wide { grid-column:1/-1; }
.zz-agents .agent-local-ui details>summary { cursor:pointer; }
.zz-agents .agent-local-ui .workflow-resources input { width:auto; }
.zz-agents .agent-local-ui .resource-list label { cursor:pointer; }
@media(max-width:760px){.zz-agents .za-overlay{padding:12px}.zz-agents .za-detail{padding:16px}.zz-agents .center-cards{grid-template-columns:1fr}.zz-agents .center-actions{flex-wrap:wrap}}
`
