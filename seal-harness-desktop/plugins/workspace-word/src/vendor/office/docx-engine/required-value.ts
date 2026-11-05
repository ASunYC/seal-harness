/** Reject malformed inputs at indexed/capture accesses the upstream algorithm requires to exist. */
export function requiredValue<T>(value: T | null | undefined): T {
  if (value === null || value === undefined) throw new Error('DOCX_STRUCTURE_INVALID');
  return value;
}
