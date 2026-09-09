# @seal-harness/web

![Seal Harness mascot](public/assets/seal-harness-mascot.png)

Local-first Web UI and streaming HTTP host for Seal Harness.

Installed DSH Profile packages can contribute Cordis Host routes and same-origin Client Bundles;
compatible skins appear in the sidebar Themes selector.

```sh
seal-harness web
```

The server binds to `127.0.0.1:3080` by default. Built-in provider API keys entered
in the UI are stored in the workspace-local credential file and never in Session
files. Keys supplied by the launch environment remain read-only. Credentials for
dynamically discovered custom providers remain process-local.
