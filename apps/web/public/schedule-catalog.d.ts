export interface ScheduleRecord { readonly scheduledAt: string; readonly kind?: string; readonly everySeconds?: number }
export function orderScheduleRecords<T extends ScheduleRecord>(records: readonly T[], now: number): T[];
export function formatScheduleFrequency(record: { readonly kind: string; readonly everySeconds?: number }, translate: (key: string) => string): string;
export function formatScheduleRelative(scheduledAt: string, now: number, translate: (key: string) => string): string;
export function formatScheduleLocalTime(scheduledAt: string, locale: string): string;
