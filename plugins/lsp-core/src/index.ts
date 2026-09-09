import { lspServiceToken, LspError, type LspProvider, type LspQueryRequest, type LspQueryResult, type LspService, type SealHarnessEvents } from "@seal-harness/core";
import { definePlugin } from "@seal-harness/kernel";

export function finalExtension(filePath: string): string {
  const base = filePath.slice(Math.max(filePath.lastIndexOf("/"), filePath.lastIndexOf("\\")) + 1);
  const dot = base.lastIndexOf(".");
  return dot <= 0 ? "" : base.slice(dot).toLowerCase();
}

export class DefaultLspService implements LspService {
  readonly #ids = new Set<string>();
  readonly #routes = new Map<string, { provider: LspProvider; languageId: string }>();
  registerProvider(provider: LspProvider): () => void {
    if (typeof provider.id !== "string" || provider.id.trim() === "") throw new LspError("an LSP provider id must be a non-empty string", "LSP_INVALID_PROVIDER");
    if (this.#ids.has(provider.id)) throw new LspError(`an LSP provider with id \"${provider.id}\" is already registered`, "LSP_CONFLICT");
    const entries = Object.entries(provider.extensionToLanguage);
    if (entries.length === 0) throw new LspError(`LSP provider \"${provider.id}\" registers no file extensions`, "LSP_INVALID_PROVIDER");
    const pending = new Map<string, string>();
    for (const [raw, languageId] of entries) {
      const ext = (raw.startsWith(".") ? raw : `.${raw}`).toLowerCase();
      if (!/^\.[^./\\]+$/.test(ext) || languageId.trim() === "" || pending.has(ext)) throw new LspError(`LSP provider \"${provider.id}\" has an invalid or duplicate extension mapping`, "LSP_INVALID_PROVIDER");
      if (this.#routes.has(ext)) throw new LspError(`extension \"${ext}\" is already handled by another LSP provider`, "LSP_CONFLICT");
      pending.set(ext, languageId);
    }
    this.#ids.add(provider.id);
    for (const [ext, languageId] of pending) this.#routes.set(ext, { provider, languageId });
    let active = true;
    return () => { if (!active) return; active = false; this.#ids.delete(provider.id); for (const ext of pending.keys()) this.#routes.delete(ext); };
  }
  async query(request: LspQueryRequest, signal?: AbortSignal): Promise<LspQueryResult> {
    const route = this.#routes.get(finalExtension(request.filePath));
    if (route === undefined) throw new LspError(`no LSP provider handles \"${request.filePath}\"`, "LSP_UNAVAILABLE");
    return route.provider.query({ ...request, languageId: route.languageId }, signal);
  }
}

export const lspCorePlugin = definePlugin<undefined, SealHarnessEvents>({ name: "lsp-core", provides: [lspServiceToken], setup(context) { context.provide(lspServiceToken, new DefaultLspService()); } });
