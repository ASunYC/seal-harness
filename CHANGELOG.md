# Changelog

All notable changes to Seal Harness will be documented in this file.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and
the project uses Semantic Versioning for published packages.

## [Unreleased]

### Changed

- Renamed the project, npm scope, CLI, environment variables, data directories, configuration
  files, Web UI, documentation, and release assets from Seal Harness's former name to
  `seal-harness` / `@seal-harness/*`.
- Raised all workspace package versions to `0.2.0` for the breaking rename.

### Added

- Rounded seal mascot artwork used by the Web UI, favicon, README, and self-contained releases.

- Zero-runtime-dependency plugin microkernel and native ESM Profiles.
- Provider-neutral Agent, Model, Session, Tool, Policy, Context and Telemetry contracts.
- Pi Agent runtime and Pi AI Provider adapters.
- Fully replaceable scripted Runtime with no Pi or ModelService dependency.
- JSONL, Memory and SQLite Session stores with fork and recovery semantics.
- Policy-routed workspace and MCP tools.
- Headless CLI, JSONL RPC, filesystem Skills and offline scripted model.
- Awaited durability barriers, deterministic Compaction and interrupted-tool recovery.
- Local-first Web UI with streaming runs, model and workspace selection, Session browsing,
  in-memory credentials, cancellation, and browser-based approvals.
- Unified `seal-harness run|headless|web` product launcher.
- Self-contained Windows, Linux, and macOS release bundles with an embedded Node.js runtime,
  archive extraction smoke tests, and SHA-256 checksums.
- Double-click `Start Seal Harness.cmd` entry in every Windows release while retaining the full CLI.
