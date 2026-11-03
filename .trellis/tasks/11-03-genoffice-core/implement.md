# Apache GenOffice core integration — local handoff

Validated 2026-11-04 UTC. User authorized implementation without commit, push or release.

## Delivered

- Private product plugin `seal-harness-desktop/plugins/office/`: local structured editing page, authenticated RPC, worker isolation, immutable revisions, account and brand storage namespaces.
- Actual DOCX/XLSX/PPTX creation/import/inspection/edit/export. No ee, old Univer plugin, fonts, native sidecar, AI provider, telemetry or external document upload service.
- Upstream pinned at `e1f50e90d246f3ecc6427d2a0af90f04f37810ec`: 176 source/package files copied unchanged and SHA256-verified on build. Apache LICENSE/NOTICE retained. Fifteen compiled third-party package licenses collected; JSZip MIT option selected, pako MIT AND Zlib texts retained.
- Added exact build dependency aliases in root package/lock, core CJS build, worker/client entries, product default plugin insertion and installer inclusion through existing product plugin rules. No change to the five root workspaces or upstream kernel pin.
- Fixed long numeric identifiers/overflow during XLSX edits by using upstream `isNumericCell`; regression covers preservation as text.

## Verified

- Earlier full product build succeeded; after numeric fix, all product plugins rebuilt and staged successfully.
- Latest complete product check exit 0: 316 passed / 319 tests, 3 skipped, 0 failed. Includes Office 14/14, actual React-to-Host RPC, ZIP inflate/path limits, protected documents, immutable originals, account cancellation, hardlink refusal and no silent slide truncation.
- Product verifier: brand and 21 business plugins, duplicate profile composition, resource/update checks; Electron standard session with 24 browser MCP tools; Creator/plugin manager and two Profile HMR generations.
- Both brands' staged `node_modules/@seal-harness/office/lib/index.js` + worker ran under Node 24.22.1 and existing Electron 44.0.0 / Node 24.18.1. Three formats create/import/edit/export, original bytes and account/brand isolation passed.
- Exported synthetic files independently reopened with python-docx, openpyxl, python-pptx and ZIP CRC; all passed for both brands and runtimes.
- Immutable Yarn install, check:layout and root typecheck passed before final adapter numeric change (root typecheck does not cover this private adapter; actual rebuilt adapter/format regressions above cover the change).
- Previously failing connectors tests passed on isolated repeat and in latest complete product check. No security/port settings or connector tests were changed.

## Skips and limits

Three existing product skips: POSIX-shell portable stdio fixture, executable permission attributes on Windows, and opt-in official DBX archive integration. The wider root OS-specific suite had prior Windows symlink/POSIX limitations; it was not rerun or claimed passing for this integration.

This is the Apache document engines with a new structured editor, not the full upstream WYSIWYG application. No formula recalculation, PDF/pixel rendering, native sidecar or external AI. File/preview limits and editing semantics are in the plugin README and UI. No final installer was generated and no fresh-machine validation is claimed.

## Preservation and handoff

No staging, commits, push or release. Existing kernel upgrade and Univer removal remain uncommitted as received. Active profile configurations contain no old Univer references, and the two permanently deleted plugin recovery directories remain absent. User documents and unrelated caches were not removed. Brand manifests/storage namespaces differ and staged runtime tests prove separate roots using the same synthetic database location/account.

Seal has concurrent changes to two Trellis specs and navigation client/test, preserved without overwrite; AE's preexisting dirty files outside this integration's edited paths remain byte-identical to the initial snapshot. See the audit for exact paths and repository heads.

Evidence directory: `C:\Users\Administrator\Documents\Codex\2026-11-03\task-3`. Logs: `genoffice-seal-restage.log`, `genoffice-seal-recheck.log`, `genoffice-staged-node.log`, `genoffice-staged-electron-captured.log`, `genoffice-independent-interop.log`, `genoffice-final-audit.json`; earlier complete build/types/layout/immutable logs retain their separate names. Synthetic interop fixtures are in `genoffice-interop/`; they contain no user data.

A transient execution-service disconnect was recovered. An initial Electron PowerShell invocation did not reliably capture completion and the first independent verifier ran before its AE fixtures existed; a subsequent hidden spawnSync run captured status 0 and both-brand output, then the independent verifier passed. All task-owned command sessions have been collected.
