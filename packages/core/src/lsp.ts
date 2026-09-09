export type LspOperation = "goToDefinition" | "findReferences" | "goToImplementation" | "hover";
export interface LspPosition { readonly line: number; readonly character: number }
export interface LspRange { readonly start: LspPosition; readonly end: LspPosition }
export interface LspLocation { readonly uri: string; readonly range: LspRange }
export interface LspHover { readonly contents: string; readonly range?: LspRange }
export interface LspQueryRequest { readonly operation: LspOperation; readonly filePath: string; readonly position: LspPosition; readonly workspaceRoot: string }
export interface LspProviderQuery extends LspQueryRequest { readonly languageId: string }
export type LspQueryResult =
  | { readonly kind: "locations"; readonly locations: readonly LspLocation[]; readonly resolvedWorkspaceUri: string }
  | { readonly kind: "hover"; readonly hover: LspHover | null };
export interface LspProvider {
  readonly id: string;
  readonly extensionToLanguage: Readonly<Record<string, string>>;
  query(request: LspProviderQuery, signal?: AbortSignal): Promise<LspQueryResult>;
}
export interface LspService {
  registerProvider(provider: LspProvider): () => void;
  query(request: LspQueryRequest, signal?: AbortSignal): Promise<LspQueryResult>;
}
export class LspError extends Error {
  override readonly name = "LspError";
  constructor(message: string, readonly code: string) { super(message); }
}
