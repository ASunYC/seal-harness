# Seal Harness

Seal Harness is a desktop agent workspace built on the architecture of [DSH Desktop](https://github.com/anywhere-labs/dsh-desktop). It composes product features through Cordis plugins, bundles, and profiles. The product identity, seal artwork, plugins, and packaging entry points live in [`seal-harness-desktop/`](seal-harness-desktop/).

This repository imports the downstream source supplied by the user. It preserves attribution and licenses for DSH Desktop, DeepSeek Harness, and other third-party components. Seal Harness is an independent product and does not use the DSH Desktop release or update channel.

## Project origins and acknowledgements

- **Original project: [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness).** Seal Harness uses its agent runtime, Web UI, and plugin system. The [`deepseek-harness/`](deepseek-harness/) directory is a pinned upstream submodule.
- **Reference project and desktop codebase: [DSH Desktop](https://github.com/anywhere-labs/dsh-desktop).** Seal Harness inherits its desktop repository structure and draws on its Electron shell and Cordis plugin, bundle, and profile composition.

We thank both upstream projects and their contributors. Seal Harness is an independent downstream product; this attribution does not imply authorization, partnership, or endorsement by either upstream project. Third-party licenses and notices are linked under “License and attribution” below.

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

The product build compiles plugins and composes them with the Beta Desktop through `cordis.patch.yml` and the profile. `product.json` defines native application identity. The default data directory is `~/.seal-harness`; an explicit `DSH_HOME` overrides it. On first launch, create a local administrator account. Users, experts, and skills share one `seal-harness.sqlite` database. The project, knowledge-base, and product-specific agent plugins have been removed; ordinary conversations and workspaces continue to use native DSH capabilities. Community Desktop updates remain disabled.

The desktop has a persistent top-level navigation rail for Home, Ask Jev, Spaces, and Scheduled Tasks. Ask Jev opens its own decision page. Home keeps the native workspace and session list alongside feature entries such as Experts, Skills, Connectors, and Plugins. The native New Session button opens the existing chat. Spaces and Scheduled Tasks currently show explicit empty states.

## Development

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
