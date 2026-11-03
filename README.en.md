# Seal Harness

Seal Harness is a desktop agent workspace built on the architecture of [DSH Desktop](https://github.com/anywhere-labs/dsh-desktop). It composes product features through Cordis plugins, bundles, and profiles. The product identity, seal artwork, plugins, and packaging entry points live in [`seal-harness-desktop/`](seal-harness-desktop/).

This repository imports the downstream source supplied by the user. It preserves attribution and licenses for DSH Desktop, DeepSeek Harness, and other third-party components. Seal Harness is an independent product and does not use the DSH Desktop release or update channel.

## Project origins and acknowledgements

- **Original project: [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness).** Seal Harness uses its agent runtime, Web UI, and plugin system. The [`deepseek-harness/`](deepseek-harness/) directory is a pinned upstream submodule.
- **Reference project and desktop codebase: [DSH Desktop](https://github.com/anywhere-labs/dsh-desktop).** Seal Harness inherits its desktop repository structure and draws on its Electron shell and Cordis plugin, bundle, and profile composition.

We thank both upstream projects and their contributors. Seal Harness is an independent downstream product; this attribution does not imply authorization, partnership, or endorsement by either upstream project. Third-party licenses and notices are linked under “License and attribution” below.

## Project links

- [Repository](https://github.com/ASunYC/seal-harness) · [Issues and usage questions](https://github.com/ASunYC/seal-harness/issues) · [Releases and downloads](https://github.com/ASunYC/seal-harness/releases)
- [Contributing](CONTRIBUTING.en.md) · [Code of conduct](CODE_OF_CONDUCT.en.md) · [Documentation](docs/README.en.md)

## Structure

| Path | Responsibility |
| --- | --- |
| `seal-harness-desktop/` | Product identity, icons, plugins, build and packaging |
| `packages/dsh-plugin-ask-jev/` | Standalone DSH decision plugin for Jev and Alibaba Model Studio, also bundled with Seal Harness |
| `dsh-plugin-desktop-beta/` | Reused Desktop Host, Client, and Electron shell |
| `dsh-plugin-desktop/` | Upstream Stable Desktop variant |
| `dsh-desktop-next/` | Upstream experimental Next variant |
| `deepseek-harness/` | Pinned read-only upstream submodule |
| `vendor/dsh-runtime/` | Pinned upstream runtime packages |

The product build compiles plugins and composes them with the Beta Desktop through `cordis.patch.yml` and the profile. `product.json` defines native application identity. The default data directory is `~/.seal-harness`; an explicit `DSH_HOME` overrides it. On first launch, create a local administrator account. Users, experts, and skills share one `seal-harness.sqlite` database. The project and old product-specific agent plugins have been removed; ordinary conversations and workspaces continue to use native DSH capabilities. Knowledge bases use WeKnora through a separate plugin. Community Desktop updates remain disabled.

The Seal Harness release version comes from `seal-harness-desktop/package.json`. Product builds use it for the desktop title bar and package metadata. DSH Desktop and DeepSeek Harness retain their separate dependency versions.

The desktop has a persistent top-level navigation rail for Home, Ask Jev, Automated Tasks, Token Statistics, Knowledge Base, Remote Hosts, ACP, Spaces, and Plugin Market. Ask Jev opens its own decision page. Home keeps the native workspace and session list alongside feature entries such as Experts, Skills, Connectors, and Plugins. The native New Session button opens the existing chat. Scheduled tasks support daily, weekly, interval, and one-time schedules, with a separate session for each run. Users can edit, enable or disable, run immediately, and inspect records. Tasks run while the application is running and the account is signed in; missed runs are not replayed. Spaces currently shows an explicit empty state.

Token Statistics records actual conversation turns for the current local account, with multidimensional filtering and Excel export; unassigned history and unknown usage are not estimated. Knowledge Base reuses WeKnora libraries, documents, indexing, and retrieval, requiring a service URL, API key, and suitable permissions. Remote Hosts stores multiple server configurations and connects through native OpenSSH, RDP, and TigerVNC clients. Password entry and host identity confirmation take place in those clients; missing clients prompt installation. ACP manages installed external coding runners, distinguishing discovery, protocol checks, and task execution; it does not automatically download or sign in to third-party CLIs.

## Development

The System tabs for Skills and Connectors include the complete cc-haha catalog snapshot: 55 connectors (43 remote MCP servers, 3 Office CLIs, and 9 skill toolkits), plus 398 curated online skills. The 9 toolkits contain 29 skills in total; complete resources are installed using pinned commits and file checksums. Online skills are fetched from their original sources when selected by the user. Service authorization, API keys, and runtimes remain user-configured. Source, version, license, and platform requirements are available in the details, and existing personal content is retained.

Use Node.js `^22.19.0` or `>=24.0.0`, Corepack, and Yarn `4.18.0`:

```bash
git submodule update --init --recursive
corepack yarn install --immutable
corepack yarn seal-harness:build
corepack yarn seal-harness:check
corepack yarn seal-harness:dev
```

Windows, macOS, and Linux packages use `seal-harness:dist:win`, `seal-harness:dist:mac`, and `seal-harness:dist:linux`; validate each on its target platform. The original seal artwork is [`seal-harness-desktop/assets/app-icon.png`](seal-harness-desktop/assets/app-icon.png), and `scripts/export-product-icons.py` derives native formats. See [`seal-harness-desktop/README.md`](seal-harness-desktop/README.md) for product configuration.

## License and attribution

The repository retains [`LICENSE`](LICENSE), [`seal-harness-desktop/THIRD_PARTY_NOTICES.md`](seal-harness-desktop/THIRD_PARTY_NOTICES.md), and component provenance. DSH Desktop and DeepSeek Harness are named to identify their upstream work.
