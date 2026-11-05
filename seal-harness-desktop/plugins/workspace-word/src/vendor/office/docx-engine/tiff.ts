/** GenOffice TIFF decoding adapted to bounded Worker OffscreenCanvas; source TIFF remains in the package. */
import UTIF from 'utif2';
const TIFF_MIMES = new Set(['image/tiff', 'image/tif', 'image/x-tiff']);
const MAX_PIXELS = 16 * 1024 * 1024;
function numericTag(value: unknown): number {
  if (!Array.isArray(value) || typeof value[0] !== 'number') return 0;
  return value[0];
}
export function isTiffMime(mime: string | undefined): mime is string {
  return mime !== undefined && TIFF_MIMES.has(mime);
}
/** Unsupported decoding is an explicit failed open, never an empty image frame. */
export async function tiffToDataUrl(bytes: ArrayBuffer | Uint8Array): Promise<string> {
  if (typeof OffscreenCanvas === 'undefined' || typeof ImageData === 'undefined')
    throw new Error('DOCX_IMAGE_UNSUPPORTED');
  const buffer = new Uint8Array(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)).buffer;
  const pages = UTIF.decode(buffer);
  let page = pages[0];
  if (!page || pages.length > 256) throw new Error('DOCX_IMAGE_INVALID');
  for (const candidate of pages) {
    const width = numericTag(candidate['t256']);
    const height = numericTag(candidate['t257']);
    if (
      !Number.isSafeInteger(width) ||
      !Number.isSafeInteger(height) ||
      width <= 0 ||
      height <= 0 ||
      width * height > MAX_PIXELS
    )
      throw new Error('DOCX_IMAGE_LIMIT');
    if (width * height > numericTag(page['t256']) * numericTag(page['t257'])) page = candidate;
  }
  UTIF.decodeImage(buffer, page);
  const width = page.width;
  const height = page.height;
  if (!width || !height || width * height > MAX_PIXELS) throw new Error('DOCX_IMAGE_LIMIT');
  const rgba = UTIF.toRGBA8(page);
  const canvas = new OffscreenCanvas(width, height);
  const context = canvas.getContext('2d');
  if (!context) throw new Error('DOCX_IMAGE_UNSUPPORTED');
  context.putImageData(new ImageData(new Uint8ClampedArray(rgba), width, height), 0, 0);
  const png = new Uint8Array(
    await (await canvas.convertToBlob({ type: 'image/png' })).arrayBuffer(),
  );
  let binary = '';
  for (const byte of png) binary += String.fromCharCode(byte);
  return `data:image/png;base64,${btoa(binary)}`;
}
