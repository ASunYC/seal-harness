import type { Credential, CredentialStore } from "@earendil-works/pi-ai";
import type { CredentialRecord, CredentialService, JsonValue } from "@seal-harness/core";

const prefix = "pi-auth/";
function decode(record: CredentialRecord | undefined): Credential | undefined {
  if (!record) return undefined;
  if (record.kind === "api-key") return { type: "api_key", ...("key" in record ? { key: record.key } : {}), ...(record.env ? { env: { ...record.env } } : {}) };
  const value: unknown = record.payload;
  const data = value as Record<string, unknown>;
  if (typeof value !== "object" || value === null || Array.isArray(value) || data.type !== "oauth" ||
      typeof data.access !== "string" || typeof data.refresh !== "string" || typeof data.expires !== "number" || !Number.isFinite(data.expires)) {
    throw new Error("Invalid stored PI OAuth credential");
  }
  return structuredClone(value) as Credential;
}
function encode(value: Credential): CredentialRecord {
  return value.type === "api_key"
    ? { kind: "api-key", ...(value.key === undefined ? {} : { key: value.key }), ...(value.env === undefined ? {} : { env: value.env }) }
    : { kind: "grant", payload: structuredClone(value) as JsonValue };
}

/** Reuse Seal's locked, owner-local storage; never import another application's auth file. */
export function piCredentialStore(service: CredentialService): CredentialStore {
  const key = (provider: string) => prefix + provider;
  return {
    async read(provider, options) { options?.signal?.throwIfAborted(); return decode(await service.readRecord?.(key(provider))); },
    async list(options) {
      options?.signal?.throwIfAborted();
      return (await service.listRecords?.() ?? []).filter(entry => entry.key.startsWith(prefix))
        .map(entry => ({ providerId: entry.key.slice(prefix.length), type: entry.kind === "grant" ? "oauth" as const : "api_key" as const }));
    },
    async modify(provider, mutate, options) {
      options?.signal?.throwIfAborted();
      if (!service.modifyRecord) throw new Error("Persistent PI credential storage is unavailable");
      const record = await service.modifyRecord(key(provider), async current => {
        const next = await mutate(decode(current));
        options?.signal?.throwIfAborted();
        return next === undefined ? current : encode(next);
      });
      return decode(record);
    },
    async delete(provider, options) {
      options?.signal?.throwIfAborted();
      if (!service.deleteRecord) throw new Error("Persistent PI credential storage is unavailable");
      await service.deleteRecord(key(provider));
    },
  };
}
