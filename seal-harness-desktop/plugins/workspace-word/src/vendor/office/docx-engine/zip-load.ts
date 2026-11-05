import JSZip from 'jszip';
import { requiredValue } from './required-value';
import { needsOoxmlNormalization, normalizeOoxmlXml } from './ooxml-normalize';

const EOCD_SIG = 0x06054b50;
const CENTRAL_SIG = 0x02014b50;
const UNICODE_PATH_ID = 0x7075;

/**
 * Word resolves docx parts by the zip header file names and ignores Info-ZIP
 * Unicode Path (0x7075) extra fields; JSZip honors them, so a crc-valid but
 * conflicting field can shadow word/document.xml with another entry's bytes
 * (POI's unicode-path corpus). Blank the field id in the central directory so
 * JSZip falls back to the header names. Returns the input when nothing to do.
 */
function neutralizeUnicodePathFields(bytes: Uint8Array): Uint8Array {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let eocd = -1;
  const stop = Math.max(0, bytes.length - 22 - 0xffff);
  for (let i = bytes.length - 22; i >= stop; i--) {
    if (view.getUint32(i, true) === EOCD_SIG) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) return bytes;
  const count = view.getUint16(eocd + 10, true);
  const cdOffset = view.getUint32(eocd + 16, true);
  if (count === 0xffff || cdOffset === 0xffffffff) return bytes; // zip64: leave as-is
  let out: Uint8Array | null = null;
  let p = cdOffset;
  for (let i = 0; i < count; i++) {
    if (p + 46 > bytes.length || view.getUint32(p, true) !== CENTRAL_SIG) return out ?? bytes;
    const nameLen = view.getUint16(p + 28, true);
    const extraLen = view.getUint16(p + 30, true);
    const commentLen = view.getUint16(p + 32, true);
    let q = p + 46 + nameLen;
    const extraEnd = Math.min(q + extraLen, bytes.length);
    while (q + 4 <= extraEnd) {
      const fieldId = view.getUint16(q, true);
      const fieldLen = view.getUint16(q + 2, true);
      if (fieldId === UNICODE_PATH_ID) {
        out ??= new Uint8Array(bytes);
        out[q] = 0xff;
        out[q + 1] = 0xff;
      }
      q += 4 + fieldLen;
    }
    p += 46 + nameLen + extraLen + commentLen;
  }
  return out ?? bytes;
}

const MAX_ZIP_PARTS = 2048;
const MAX_PART_UNCOMPRESSED_BYTES = 64 * 1024 * 1024;
const MAX_TOTAL_UNCOMPRESSED_BYTES = 64 * 1024 * 1024;

/**
 * Reject zip bombs before any part is inflated, using the declared
 * uncompressed sizes from the central directory (JSZip keeps them in
 * the lazy `_data` compressed object).
 */
export function assertZipWithinLimits(zip: JSZip): void {
  const files = Object.values(zip.files).filter((f) => !f.dir);
  if (files.length > MAX_ZIP_PARTS) {
    throw new Error(`docx rejected: ${files.length} parts exceeds the ${MAX_ZIP_PARTS} limit`);
  }
  let total = 0;
  for (const file of files) {
    const size =
      (file as unknown as { _data?: { uncompressedSize?: number | undefined } | undefined })._data
        ?.uncompressedSize ?? 0;
    if (size > MAX_PART_UNCOMPRESSED_BYTES) {
      throw new Error(
        `docx rejected: part ${file.name} declares ${size} uncompressed bytes ` +
          `(limit ${MAX_PART_UNCOMPRESSED_BYTES})`,
      );
    }
    if (size > 0) total += size;
  }
  if (total > MAX_TOTAL_UNCOMPRESSED_BYTES) {
    throw new Error(
      `docx rejected: total uncompressed size ${total} exceeds the ` +
        `${MAX_TOTAL_UNCOMPRESSED_BYTES} limit`,
    );
  }
}

// The gate parts carry the strict / non-canonical-prefix markers whenever the
// package needs normalizing (strict packages are strict in document.xml and
// their rels; prefix oddities live in document.xml).
const NORMALIZE_GATE_PARTS = ['word/document.xml', 'word/_rels/document.xml.rels', '_rels/.rels'];

/**
 * ISO Strict OOXML and non-canonical namespace prefixes are normalized here,
 * at the single zip entry point, so parseDocx offsets and saveDocx patches
 * operate on identical part text (and saved packages come out transitional).
 */
async function normalizeOoxmlParts(zip: JSZip): Promise<void> {
  let needed = false;
  for (const path of NORMALIZE_GATE_PARTS) {
    const file = zip.file(path);
    if (file && needsOoxmlNormalization(await file.async('string'))) {
      needed = true;
      break;
    }
  }
  if (!needed) return;
  for (const file of Object.values(zip.files)) {
    if (file.dir || !/\.(xml|rels)$/i.test(file.name)) continue;
    const xml = await file.async('string');
    if (needsOoxmlNormalization(xml)) zip.file(file.name, normalizeOoxmlXml(xml));
  }
}

/** Load a docx/zip resolving part names the way Word does. */
export async function loadDocxZip(bytes: Uint8Array): Promise<JSZip> {
  validatePackageDirectory(bytes);
  const zip = await JSZip.loadAsync(neutralizeUnicodePathFields(bytes));
  assertZipWithinLimits(zip);
  await validateExpandedParts(zip);
  await normalizeOoxmlParts(zip);
  return zip;
}

/** Fail closed before JSZip can sanitize traversal paths or overwrite duplicate central entries. */
function validatePackageDirectory(bytes: Uint8Array): void {
  if (bytes.byteLength === 0 || bytes.byteLength > 64 * 1024 * 1024)
    throw new Error('DOCX_ZIP_SOURCE_LIMIT');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let end = -1;
  for (
    let position = bytes.length - 22;
    position >= Math.max(0, bytes.length - 65557);
    position--
  ) {
    if (
      view.getUint32(position, true) === EOCD_SIG &&
      position + 22 + view.getUint16(position + 20, true) === bytes.length
    ) {
      end = position;
      break;
    }
  }
  if (end < 0 || view.getUint16(end + 4, true) !== 0 || view.getUint16(end + 6, true) !== 0)
    throw new Error('DOCX_ZIP_INVALID');
  const count = view.getUint16(end + 10, true);
  if (count > MAX_ZIP_PARTS || view.getUint16(end + 8, true) !== count)
    throw new Error('DOCX_ZIP_PART_LIMIT');
  let position = view.getUint32(end + 16, true);
  if (position + view.getUint32(end + 12, true) !== end) throw new Error('DOCX_ZIP_INVALID');
  const names = new Set<string>();
  for (let index = 0; index < count; index++) {
    if (position + 46 > end || view.getUint32(position, true) !== CENTRAL_SIG)
      throw new Error('DOCX_ZIP_INVALID');
    const flags = view.getUint16(position + 8, true);
    const method = view.getUint16(position + 10, true);
    const nameLength = view.getUint16(position + 28, true);
    const entryEnd =
      position +
      46 +
      nameLength +
      view.getUint16(position + 30, true) +
      view.getUint16(position + 32, true);
    if ((flags & 1) !== 0 || (method !== 0 && method !== 8) || entryEnd > end)
      throw new Error('DOCX_ZIP_UNSUPPORTED');
    const name = new TextDecoder('utf-8', { fatal: true }).decode(
      bytes.subarray(position + 46, position + 46 + nameLength),
    );
    if (
      !name ||
      name.startsWith('/') ||
      name.includes('\\') ||
      name.includes(':') ||
      name.includes('\0') ||
      name.includes('//') ||
      name.split('/').some((part) => part === '.' || part === '..')
    )
      throw new Error('DOCX_ZIP_PATH_INVALID');
    if (names.has(name)) throw new Error('DOCX_ZIP_DUPLICATE');
    names.add(name);
    position = entryEnd;
  }
  if (position !== end) throw new Error('DOCX_ZIP_INVALID');
}

const CRC_TABLE = Uint32Array.from({ length: 256 }, (_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit++) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  return value >>> 0;
});

/** Enforce actual stream output and CRC, including untouched parts; header sizes are only an early check. */
async function validateExpandedParts(zip: JSZip): Promise<void> {
  let expanded = 0;
  for (const file of Object.values(zip.files)) {
    if (file.dir) continue;
    const expected = (file as unknown as { _data: { uncompressedSize: number; crc32: number } })
      ._data;
    const bytes = await new Promise<Uint8Array>((resolve, reject) => {
      let size = 0;
      let crc = 0xffffffff;
      const chunks: Uint8Array[] = [];
      // JSZip 3.10.1 exposes this bounded streaming API at runtime but omits it from JSZipObject's types.
      const streamingFile = file as JSZip.JSZipObject & {
        internalStream(type: 'uint8array'): JSZip.JSZipStreamHelper<Uint8Array>;
      };
      if (typeof streamingFile.internalStream !== 'function') {
        reject(new Error('DOCX_ZIP_STREAM_UNAVAILABLE'));
        return;
      }
      const stream = streamingFile.internalStream('uint8array');
      stream.on('data', (chunk: Uint8Array) => {
        size += chunk.byteLength;
        if (size > MAX_PART_UNCOMPRESSED_BYTES || expanded + size > MAX_TOTAL_UNCOMPRESSED_BYTES) {
          stream.pause();
          reject(new Error('DOCX_ZIP_EXPANSION_LIMIT'));
          return;
        }
        for (const byte of chunk) crc = requiredValue(CRC_TABLE[(crc ^ byte) & 0xff]) ^ (crc >>> 8);
        chunks.push(chunk);
      });
      stream.on('error', reject);
      stream.on('end', () => {
        if (
          size !== expected.uncompressedSize ||
          (crc ^ 0xffffffff) >>> 0 !== expected.crc32 >>> 0
        ) {
          reject(new Error('DOCX_ZIP_CORRUPT'));
          return;
        }
        const output = new Uint8Array(size);
        let offset = 0;
        for (const chunk of chunks) {
          output.set(chunk, offset);
          offset += chunk.byteLength;
        }
        resolve(output);
      });
      stream.resume();
    });
    expanded += bytes.byteLength;
    zip.file(file.name, bytes);
  }
}
