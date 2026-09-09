export function credentialStatusModel(descriptor) {
  if (descriptor === null) return { label: "unavailable", writable: true, clearable: false };
  const writable = descriptor.writable !== false;
  return {
    label: descriptor.configured ? (descriptor.source === "env" ? "environment" : "configured") : "missing",
    writable,
    clearable: writable && descriptor.configured === true,
  };
}
