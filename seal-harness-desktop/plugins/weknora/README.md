# WeKnora local plugin

Seal Harness Desktop ships the published `@wxg-prc-cpg/dsh-weknora@0.1.0` runtime as its local `@seal-harness/weknora` plugin. The six runtime files in `upstream/` are copied unchanged from the verified npm tarball. See [PROVENANCE.md](PROVENANCE.md) and [LICENSE](LICENSE).

The product Cordis patch enables four upstream tools: `weknora_list_knowledge_bases`, `weknora_search`, `weknora_read_document`, and `weknora_ask`. The Seal Host wrapper reads the current connection credential for every call, so changing the connection does not require restarting Seal.

In Seal Settings → WeKnora, open WeKnora's native API Key management link, create a key with `retrieve` capability (`chat` too if the Ask tool is needed), enter it with the WeKnora API root, then use **测试连接**. The Key stays in the Host credential store under the current local Seal account and is never returned by the settings RPC. Changing the API address without entering a new Key clears the previous Key to prevent sending it to a different service.

For unattended deployment, the Cordis patch also accepts these environment defaults at Desktop startup:

- `WEKNORA_BASE_URL` to the backend API root. `http://localhost:8080/api/v1` is only correct when WeKnora runs on the **same computer as Desktop**. On another computer, use the reachable WeKnora server address, for example `https://kb.example.com/api/v1`.
- `WEKNORA_API_KEY` to a WeKnora workspace API token with `retrieve` and `chat` capabilities. Scope it to the knowledge bases the Desktop user should access. Keep the token outside tracked files.

Desktop is a client of WeKnora. Ollama runs where the **WeKnora service** runs; it is not needed on each Desktop computer. The WeKnora server can use its own Ollama instance or a configured remote model provider. The container registry stores the app image but does not run the service.

The Desktop Settings page includes a separate link to WeKnora's native **Model Settings** page. Add either the local Ollama Embedding model or an external Embedding model there, then select it for a knowledge base. Configure the answer LLM as an external provider in WeKnora. Seal's connection form configures only the retrieval plugin's API access.

The current verification deployment runs on this workstation from the separate `WeKnora` checkout. Its Web UI is at `http://localhost`, its API at `http://localhost:8080`, and its Compose configuration is in that checkout's ignored `.env`. The Ollama service and only the local embedding model are packaged in `agentearth/ollama-weknora:nomic-embed-text`; configure the answer LLM as an external provider in WeKnora. Start the stack with the `docker-compose.ollama.yml` overlay described in `WeKnora/deploy/ollama/README.md`. This deployment binds ports 80, 8080, and 11434 to `127.0.0.1`, so it is **not reachable from other computers**. Before using it remotely, deploy the full stack on an always-on server or configure a secure network endpoint for this host, then set each Desktop client's `WEKNORA_BASE_URL` to that endpoint.

To rebuild the Desktop integration, run `corepack yarn seal-harness:build` at the Seal Harness repository root. On this workstation, where `corepack` is not installed globally, the equivalent command is `npx --yes --package=corepack@0.34.5 -- node seal-harness-desktop/scripts/desktop.mjs build`. The product build copies the pinned upstream runtime into the Desktop's local plugin package and includes its provenance and MIT license.
