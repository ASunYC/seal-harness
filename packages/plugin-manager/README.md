# @seal-harness/plugin-manager

Isolated, pnpm-backed plugin profiles for Seal Harness. The CLI accepts DSH-compatible package
specs, including npm packages, local paths and `github:user/repo#path:/subdir` dependencies.

```sh
seal-harness plugin --profile web add 'github:user/repo#path:/plugin'
seal-harness plugin --profile web list
seal-harness plugin --profile web doctor
seal-harness plugin --profile web remove '@scope/plugin'
```

Third-party plugins are trusted Node.js code. They are installed only after an explicit `add` and
stay outside the Seal Harness application bundle under `~/.seal-harness/profiles/<profile>`.
