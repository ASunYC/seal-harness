# @seal-harness/webhook-github

Optional exact-route GitHub webhook adapter. It bounds the raw UTF-8 JSON body, resolves the shared secret for every request, verifies `x-hub-signature-256`, normalizes delivery headers, dispatches without waiting for rules, and returns `202`.

The plugin requires a Web host route service, credential service, and `@seal-harness/webhook-core`. Secrets and request payloads are never included in returned diagnostics.
