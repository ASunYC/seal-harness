import { WebError, webAccessServiceToken, type SealHarnessEvents, type WebAccessService, type WebFetchProvider, type WebFetchRequest, type WebFetchResult, type WebSearchProvider, type WebSearchRequest, type WebSearchResult } from "@seal-harness/core";
import { definePlugin } from "@seal-harness/kernel";
export interface WebCoreConfig { readonly searchProvider?: string; readonly fetchProvider?: string }

export class DefaultWebAccessService implements WebAccessService {
  readonly #search = new Map<string, WebSearchProvider>(); readonly #fetch = new Map<string, WebFetchProvider>();
  constructor(readonly config: WebCoreConfig = {}) {}
  registerSearchProvider(provider: WebSearchProvider): () => void { return register(this.#search, provider, "search"); }
  registerFetchProvider(provider: WebFetchProvider): () => void { return register(this.#fetch, provider, "fetch"); }
  async search(request: WebSearchRequest, signal?: AbortSignal): Promise<WebSearchResult> {
    if (!Number.isSafeInteger(request.maxResults) || request.maxResults < 1) throw new WebError("maxResults must be a positive safe integer", "WEB_INVALID_REQUEST");
    const result = await select(this.#search, this.config.searchProvider, "search").search(request, signal);
    const truncated = result.sources.length > request.maxResults || result.truncated === true;
    return { ...(result.answer === undefined ? {} : { answer: result.answer }), sources: result.sources.slice(0, request.maxResults), ...(truncated ? { truncated: true } : {}) };
  }
  fetch(request: WebFetchRequest, signal?: AbortSignal): Promise<WebFetchResult> { return select(this.#fetch, this.config.fetchProvider, "fetch").fetch(request, signal); }
}
function register<T extends { readonly id: string }>(map: Map<string, T>, provider: T, kind: string): () => void { if (provider.id.trim() === "") throw new WebError(`${kind} provider id must be non-empty`, "WEB_INVALID_PROVIDER"); if (map.has(provider.id)) throw new WebError(`duplicate ${kind} provider \"${provider.id}\"`, "WEB_PROVIDER_CONFLICT"); map.set(provider.id, provider); return () => { if (map.get(provider.id) === provider) map.delete(provider.id); }; }
function select<T extends { readonly id: string; available(): boolean }>(map: Map<string, T>, configured: string | undefined, kind: string): T {
  if (configured !== undefined) { const provider = map.get(configured); if (provider === undefined) throw new WebError(`configured ${kind} provider \"${configured}\" is not registered`, "WEB_PROVIDER_CONFIGURED_MISSING"); if (!provider.available()) throw new WebError(`configured ${kind} provider \"${configured}\" is unavailable`, "WEB_PROVIDER_CONFIGURED_UNAVAILABLE"); return provider; }
  const usable = [...map.values()].filter((item) => item.available()); if (usable.length === 0) throw new WebError(`no usable web ${kind} provider`, "WEB_PROVIDER_UNAVAILABLE"); if (usable.length > 1) throw new WebError(`multiple usable web ${kind} providers: ${usable.map((x) => x.id).sort().join(", ")}`, "WEB_PROVIDER_AMBIGUOUS"); return usable[0]!;
}
export const webCorePlugin = definePlugin<WebCoreConfig, SealHarnessEvents>({ name: "web-core", provides: [webAccessServiceToken], setup(context, config) { context.provide(webAccessServiceToken, new DefaultWebAccessService(config)); } });
