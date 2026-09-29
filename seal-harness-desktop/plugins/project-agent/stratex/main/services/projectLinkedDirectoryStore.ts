import { randomUUID } from 'node:crypto';
import {
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { dirname, isAbsolute } from 'node:path';

import { z } from 'zod';

const identitySchema = z.strictObject({
  dev: z.number(),
  ino: z.number(),
  birthtimeMs: z.number(),
});
const entrySchema = z.strictObject({
  refId: z.string().uuid(),
  displayName: z.string().min(1).max(255),
  canonicalPath: z.string().min(1).max(32768),
  rootIdentity: identitySchema.optional(),
});
const documentSchema = z.strictObject({
  version: z.literal(1),
  groups: z
    .array(
      z.strictObject({
        key: z.string().min(1).max(4096),
        entries: z.array(entrySchema).max(64),
      }),
    )
    .max(4096),
});

export type ProjectLinkedDirectoryIdentity = z.infer<typeof identitySchema>;
export type ProjectLinkedDirectoryEntry = z.infer<typeof entrySchema>;
export interface ProjectLinkedDirectoryPersistence {
  readonly deviceId: string;
  read(key: string): ProjectLinkedDirectoryEntry[];
  write(key: string, entries: readonly ProjectLinkedDirectoryEntry[]): void;
}

/** Main-only, local userData storage. A sync atomic replacement has no async commit gap. */
export class ProjectLinkedDirectoryStore implements ProjectLinkedDirectoryPersistence {
  constructor(
    private readonly filePath: string,
    readonly deviceId: string,
  ) {
    if (!isAbsolute(filePath)) throw new Error('Linked directory store requires an absolute path');
    if (!deviceId || deviceId.length > 255 || deviceId.includes('\0')) {
      throw new Error('Invalid linked directory device scope');
    }
  }

  read(key: string): ProjectLinkedDirectoryEntry[] {
    return this.load().groups.find((group) => group.key === key)?.entries ?? [];
  }

  write(key: string, entries: readonly ProjectLinkedDirectoryEntry[]): void {
    const previous = this.load();
    const next = documentSchema.parse({
      version: 1,
      groups: [
        ...previous.groups.filter((group) => group.key !== key),
        ...(entries.length ? [{ key, entries }] : []),
      ],
    });
    const content = JSON.stringify(next);
    if (Buffer.byteLength(content) > 4 * 1024 * 1024)
      throw new Error('Linked directory store is full');
    mkdirSync(dirname(this.filePath), { recursive: true });
    const temporaryPath = `${this.filePath}.${randomUUID()}.tmp`;
    let descriptor: number | undefined;
    try {
      descriptor = openSync(temporaryPath, 'wx');
      writeFileSync(descriptor, content, 'utf8');
      fsyncSync(descriptor);
      closeSync(descriptor);
      descriptor = undefined;
      renameSync(temporaryPath, this.filePath);
    } finally {
      if (descriptor !== undefined) closeSync(descriptor);
      if (existsSync(temporaryPath)) unlinkSync(temporaryPath);
    }
  }

  private load(): z.infer<typeof documentSchema> {
    try {
      if (statSync(this.filePath).size > 4 * 1024 * 1024) throw new Error('Invalid store size');
      return documentSchema.parse(JSON.parse(readFileSync(this.filePath, 'utf8')));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { version: 1, groups: [] };
      throw new Error('Linked directory persistence is unavailable');
    }
  }
}
