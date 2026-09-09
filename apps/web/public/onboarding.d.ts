export function credentialStatusModel(descriptor: null | { configured?: boolean; writable?: boolean; source?: string }): {
  label: "unavailable" | "environment" | "configured" | "missing";
  writable: boolean;
  clearable: boolean;
};
