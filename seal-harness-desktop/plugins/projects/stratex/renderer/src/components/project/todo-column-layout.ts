import { z } from 'zod';
import type { TodoFieldDescriptor } from './todo-fields';

export const TODO_COLUMN_SCHEMA_VERSION = 1;
export const todoColumnLayoutSchema = z.object({
  widths: z.record(z.string(), z.number().finite()).default({}),
  pinned: z.array(z.string()).default([]),
  hidden: z.array(z.string()).default([]),
});

export function todoColumnWidth(key: string, widths: Readonly<Record<string, number>>): number {
  const minimum = key === 'title' ? 210 : 80;
  const fallback = key === 'title' ? 320 : key === 'reference' ? 180 : 140;
  const value = widths[key];
  return Math.min(
    720,
    Math.max(minimum, value !== undefined && Number.isFinite(value) ? value : fallback),
  );
}

export function todoPinnedOffsets(
  fields: readonly TodoFieldDescriptor[],
  pinned: readonly string[],
  widths: Readonly<Record<string, number>>,
): Readonly<Record<string, number>> {
  const offsets: Record<string, number> = {};
  let offset = 0;
  for (const field of fields) {
    if (!pinned.includes(field.key)) continue;
    offsets[field.key] = offset;
    offset += todoColumnWidth(field.key, widths);
  }
  return offsets;
}
