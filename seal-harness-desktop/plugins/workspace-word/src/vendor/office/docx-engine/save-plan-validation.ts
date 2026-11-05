import shapeData from './save-plan-shape.json';
import type { SaveBlock, SaveOptions } from './patch';

interface Shape {
  kind?: string | undefined;
  literal?: (string | number | boolean) | undefined;
  union?: number[] | undefined;
  array?: number | undefined;
  tuple?: number[] | undefined;
  object?: Record<string, { type: number; optional: boolean }> | undefined;
  index?: number | undefined;
  numberIndex?: number | undefined;
}
const shapes: readonly Shape[] = shapeData.descriptors;

/** Runtime shape generated from the complete upstream SaveBlock/SaveOptions type graph. */
function matches(
  value: unknown,
  index: number,
  depth: number,
  budget: { remaining: number },
): boolean {
  if (depth > 48 || --budget.remaining < 0) return false;
  const shape = shapes[index];
  if (!shape) return false;
  if (shape.literal !== undefined) return value === shape.literal;
  if (shape.kind) {
    if (shape.kind === 'undefined') return value === undefined;
    if (shape.kind === 'null') return value === null;
    if (shape.kind === 'number') return typeof value === 'number' && Number.isFinite(value);
    if (shape.kind === 'string')
      return typeof value === 'string' && value.length <= 4 * 1024 * 1024;
    return typeof value === shape.kind;
  }
  if (shape.union) return shape.union.some((member) => matches(value, member, depth + 1, budget));
  if (shape.array !== undefined)
    return (
      Array.isArray(value) &&
      value.length <= 20_000 &&
      value.every((item) => matches(item, shape.array!, depth + 1, budget))
    );
  if (shape.tuple)
    return (
      Array.isArray(value) &&
      value.length === shape.tuple.length &&
      shape.tuple.every((type, position) => matches(value[position], type, depth + 1, budget))
    );
  if (
    value === null ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Object.prototype
  )
    return false;
  const record = value as Record<string, unknown>;
  const properties = shape.object;
  if (!properties || Object.keys(record).length > 256) return false;
  for (const [name, field] of Object.entries(properties)) {
    if (!(name in record)) {
      if (!field.optional) return false;
      continue;
    }
    if (!matches(record[name], field.type, depth + 1, budget)) return false;
  }
  for (const name of Object.keys(record)) {
    if (name === '__proto__' || name === 'constructor' || name === 'prototype') return false;
    if (Object.hasOwn(properties, name)) continue;
    const numericKey = Number.isFinite(Number(name)) && String(Number(name)) === name;
    const index = numericKey ? (shape.numberIndex ?? shape.index) : shape.index;
    if (index === undefined || !matches(record[name], index, depth + 1, budget)) return false;
  }
  return true;
}

export function isSaveBlock(value: unknown): value is SaveBlock {
  if (!matches(value, shapeData.roots.SaveBlock, 0, { remaining: 100_000 })) return false;
  const block = value as SaveBlock;
  if (
    (block.kind === 'original' || block.kind === 'xml') &&
    block.docxIndex !== undefined &&
    (!Number.isSafeInteger(block.docxIndex) || block.docxIndex < 0)
  )
    return false;
  if (block.kind === 'image') {
    const { widthPx, heightPx, base64, mime } = block.image;
    if (
      widthPx <= 0 ||
      heightPx <= 0 ||
      widthPx * heightPx > 16 * 1024 * 1024 ||
      !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u.test(base64)
    )
      return false;
    const head = atob(base64.slice(0, 16));
    if (mime === 'image/png' && !head.startsWith('\x89PNG\r\n\x1a\n')) return false;
    if (mime === 'image/jpeg' && !head.startsWith('\xff\xd8\xff')) return false;
    if (mime === 'image/gif' && !head.startsWith('GIF87a') && !head.startsWith('GIF89a'))
      return false;
  }
  return true;
}
export function isSaveOptions(value: unknown): value is SaveOptions {
  return matches(value, shapeData.roots.SaveOptions, 0, { remaining: 100_000 });
}
