export interface WebSearchRequest { readonly query: string; readonly maxResults: number }
export interface WebSearchSource { readonly url: string; readonly title?: string; readonly snippet?: string; readonly publishedAt?: string }
export interface WebSearchResult { readonly answer?: string; readonly sources: readonly WebSearchSource[]; readonly truncated?: boolean }
export interface WebFetchRequest { readonly url: string }
export type WebFetchBody = { readonly kind: "html" | "text"; readonly content: string };
export interface WebFetchResult { readonly url: string; readonly status: number; readonly body: WebFetchBody; readonly truncated: boolean }
export interface WebSearchProvider { readonly id: string; available(): boolean; search(request: WebSearchRequest, signal?: AbortSignal): Promise<WebSearchResult> }
export interface WebFetchProvider { readonly id: string; available(): boolean; fetch(request: WebFetchRequest, signal?: AbortSignal): Promise<WebFetchResult> }
export interface WebAccessService {
  registerSearchProvider(provider: WebSearchProvider): () => void;
  registerFetchProvider(provider: WebFetchProvider): () => void;
  search(request: WebSearchRequest, signal?: AbortSignal): Promise<WebSearchResult>;
  fetch(request: WebFetchRequest, signal?: AbortSignal): Promise<WebFetchResult>;
}
export class WebError extends Error { override readonly name = "WebError"; constructor(message: string, readonly code: string) { super(message); } }
