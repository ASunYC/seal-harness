export interface CredentialRequest {
  readonly provider: string;
  readonly name: string;
  readonly signal?: AbortSignal;
}

export interface CredentialService {
  resolve(request: CredentialRequest): Promise<string | undefined>;
  /** Resolve an already-authored environment-style reference without re-addressing it. */
  resolveRef?(reference: string, signal?: AbortSignal): Promise<string | undefined>;
  describeRef?(reference: string): Promise<{ readonly configured: boolean; readonly source?: string; readonly writable: boolean }>;
  setRef?(reference: string, value: string): Promise<void>;
  unsetRef?(reference: string): Promise<void>;
  readRecord?(key: string): Promise<CredentialRecord | undefined>;
  describeRecord?(key: string): Promise<{ readonly configured: boolean; readonly kind?: CredentialRecord["kind"]; readonly writable: boolean }>;
  listRecords?(): Promise<readonly CredentialRecordEntry[]>;
  modifyRecord?(key: string, mutate: (current: CredentialRecord | undefined) => Promise<CredentialRecord | undefined>): Promise<CredentialRecord | undefined>;
  deleteRecord?(key: string): Promise<void>;
  subscribe?(listener: (change: CredentialChange) => void): () => void;
}

export type CredentialRecord =
  | { readonly kind: "api-key"; readonly key?: string; readonly env?: Readonly<Record<string, string>> }
  | { readonly kind: "grant"; readonly payload: JsonValue };

export interface CredentialRecordEntry { readonly key: string; readonly kind: CredentialRecord["kind"]; }
export type CredentialChange = { readonly kind: "reference"; readonly reference: string } | { readonly kind: "record"; readonly key: string };
import type { JsonValue } from "./json.js";
