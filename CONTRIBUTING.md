# Contributing

## Prerequisites

- Node.js 22.19 or later
- Corepack and pnpm 11

## Workflow

`main` is protected. Create a topic branch and open a pull request; do not push directly to
`main`. Before merging, the branch must be current with `main`, all review conversations must be
resolved, and these GitHub Actions checks must pass:

- `Node 22.19.0`;
- `Node 24`;
- `Packed install smoke`.

```sh
corepack enable
pnpm install --frozen-lockfile
pnpm check
pnpm build
pnpm pack:smoke
```

Keep capability boundaries explicit. Pi-specific types may only appear in Pi adapter packages.
Every new tool must classify its Policy action, and every long-lived resource must register a
Disposer or follow the plugin AbortSignal.

Commits use Conventional Commits. Public contract changes require tests, documentation and a
Changelog entry.
