const DEFAULT_MAX_FRAME_BYTES = 1024 * 1024;

export class AepSseProtocolError extends Error {
  constructor() {
    super('invalidSseFrame');
    this.name = 'AepSseProtocolError';
  }
}

export class AepSseDecoder {
  private readonly decoder = new TextDecoder();
  private readonly maxFrameBytes: number;
  private buffer = '';

  constructor(maxFrameBytes = DEFAULT_MAX_FRAME_BYTES) {
    if (!Number.isSafeInteger(maxFrameBytes) || maxFrameBytes < 1) {
      throw new AepSseProtocolError();
    }
    this.maxFrameBytes = maxFrameBytes;
  }

  push(chunk: Uint8Array): readonly unknown[] {
    this.buffer += this.decoder.decode(chunk, { stream: true });
    return this.drain(false);
  }

  finish(): readonly unknown[] {
    this.buffer += this.decoder.decode();
    return this.drain(true);
  }

  private drain(flush: boolean): readonly unknown[] {
    this.buffer = this.buffer.replace(/\r\n/gu, '\n');
    const frames = this.buffer.split('\n\n');
    this.buffer = flush ? '' : (frames.pop() ?? '');
    if (byteLength(this.buffer) > this.maxFrameBytes) throw new AepSseProtocolError();
    const values: unknown[] = [];
    for (const frame of frames) {
      const value = parseFrame(frame, this.maxFrameBytes);
      if (value !== NO_DATA) values.push(value);
    }
    return values;
  }
}

const NO_DATA = Symbol('no-data');

function parseFrame(frame: string, maxFrameBytes: number): unknown | typeof NO_DATA {
  if (byteLength(frame) > maxFrameBytes) throw new AepSseProtocolError();
  const data = frame
    .split('\n')
    .filter((line) => !line.startsWith(':'))
    .filter((line) => line === 'data' || line.startsWith('data:'))
    .map((line) => (line === 'data' ? '' : line.slice(5).replace(/^ /u, '')));
  if (data.length === 0) return NO_DATA;
  try {
    return JSON.parse(data.join('\n')) as unknown;
  } catch {
    throw new AepSseProtocolError();
  }
}

function byteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}
