# Contributing

English | [中文](CONTRIBUTING.md)

Thank you for contributing to Seal Harness. Users, plugin authors, and developers can report problems, discuss ideas, and contribute in [this repository](https://github.com/ASunYC/seal-harness).

## Users: use, report, and share

- Report problems through [Seal Harness Issues](https://github.com/ASunYC/seal-harness/issues/new/choose). Include the operating system, Seal Harness and kernel versions, reproduction steps, and error details.
- Use [this repository's Issues](https://github.com/ASunYC/seal-harness/issues) for feature requests, usage questions, and ecosystem recommendations. Search existing reports first.
- Find published versions and installers in [Seal Harness Releases](https://github.com/ASunYC/seal-harness/releases). Availability follows the actual release assets and notes.
- Tutorials, experience reports, documentation, and translations are welcome. See the [README](README.en.md) for the project overview.
- Remove API keys, tokens, account details, and other sensitive information before attaching logs or screenshots.

## Plugin authors: extend the ecosystem

Seal Harness uses DSH's plugin, bundle, and Profile mechanisms. Start with:

- [Seal Harness product and build guide](seal-harness-desktop/README.md): product identity, plugin composition, and verification boundaries.
- [Plugin development](docs/plugin-development.en.md): inherited DSH Host, Web Client, and Desktop extension contracts.
- [DSH plugin ecosystem manifesto](docs/plugin-ecosystem.en.md): composition first, clear declarations, and compatibility first.
- [Community Market](dsh-community-market/README.md): catalog sources, installation confirmation, and security boundaries.

Prefer public contracts, respect user authorization and account isolation, and preserve third-party attribution, licenses, and notices. Submit Seal Harness improvements here. Report upstream-specific problems to the corresponding upstream project after confirming they reproduce independently.

## Developers: contribute code

### Development environment

Use Node.js `^22.19.0` or `>=24.0.0` and the root Yarn `4.18.0`. Read the root [AGENTS.md](AGENTS.md) and [Trellis workflow](.trellis/workflow.md), then run:

```sh
git clone --recurse-submodules https://github.com/ASunYC/seal-harness.git
cd seal-harness
corepack yarn install --immutable
corepack yarn seal-harness:build
corepack yarn seal-harness:check
corepack yarn seal-harness:dev
```

`seal-harness:dev` opens the graphical application. Builds, type checks, and other automated verification must remain headless-safe.

### Repository boundaries

- `seal-harness-desktop/` owns product identity, business plugins, composition, and packaging. Product-owned packages stay outside the root Yarn workspaces and do not introduce another lockfile.
- `deepseek-harness/` is a pinned, read-only upstream submodule. Do not edit its source as part of desktop feature work; commit pin updates separately.
- `dsh-plugin-desktop-beta/`, `dsh-plugin-desktop/`, and `dsh-desktop-next/` are inherited desktop packages. Develop shared Desktop behavior in Beta first and synchronize Stable. Prefer product plugins for Seal-specific features.
- Prefer public services, events, slots, and bundles. Follow the [desktop build contract](.trellis/spec/general/desktop-build.md) for boundaries and required verification.

### Commits and pull requests

- Open PRs against [Seal Harness](https://github.com/ASunYC/seal-harness/compare). Explain the problem, motivation, verification results, and known limitations.
- Use Conventional Commits with Chinese descriptions, for example `fix: 修复模型列表重叠`.
- Run affected checks and product checks; run `corepack yarn check` before merging. Record platform or environment limitations honestly, and never report skipped or failed checks as passing.
- For shared Desktop changes, run `corepack yarn check:desktop-variants` and validate both variants. Review lockfile and third-party notices when dependencies change.
- Keep documentation bilingual and update the corresponding `*.i18n.yaml` hash records.
- Do not commit credentials, account databases, personal Profiles, temporary files, or build output.

## Contact and code of conduct

Contact maintainers through [this repository's Issues](https://github.com/ASunYC/seal-harness/issues) for collaboration and general questions. Upstream email addresses and community groups are not Seal Harness maintenance channels.

Be kind, respectful, and constructive. The [Code of Conduct](CODE_OF_CONDUCT.en.md) applies to this project's spaces. For confidential reports, request a private contact channel first without disclosing incident details in a public issue.
