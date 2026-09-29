import { constants, lstatSync, realpathSync, type Stats } from 'node:fs';
import { lstat, open, opendir, realpath } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';

import {
  ProjectLinkedDirectoryListArgumentsSchema,
  ProjectLinkedDirectoryReadArgumentsSchema,
  ProjectLinkedDirectorySearchArgumentsSchema,
  type ProjectLinkedDirectoryReadResult,
} from '../../../../../projects/stratex/shared/protocol/project-workspace.js';
import {
  pathContains,
  pathsOverlap,
  sameIdentity,
  samePath,
  type ProjectLinkedDirectoryContext,
  type ProjectLinkedDirectoryLease,
  type ProjectLinkedDirectoryService,
} from '../projectWorkspacePreferenceLinkedDirectories.js';

type Entry = { relativePath: string; kind: 'file' | 'directory' };
class AccessFailure extends Error {
  constructor(readonly code: 'authentication' | 'invalidInput' | 'offline') {
    super(code);
  }
}

/** Bounded Main filesystem reads. No write operation or writable-root registration is exposed. */
export class ProjectLinkedDirectoryReadAccess {
  constructor(private readonly service: ProjectLinkedDirectoryService) {}

  async list(
    context: ProjectLinkedDirectoryContext,
    input: unknown,
  ): Promise<ProjectLinkedDirectoryReadResult> {
    const parsed = ProjectLinkedDirectoryListArgumentsSchema.safeParse(input);
    if (!parsed.success || !parsed.data.refId) return failure('invalidInput');
    return this.walk(
      context,
      parsed.data.refId,
      parsed.data.relativePath ?? '',
      parsed.data.limit ?? 100,
    );
  }

  async search(
    context: ProjectLinkedDirectoryContext,
    input: unknown,
  ): Promise<ProjectLinkedDirectoryReadResult> {
    const parsed = ProjectLinkedDirectorySearchArgumentsSchema.safeParse(input);
    if (!parsed.success) return failure('invalidInput');
    const { refId, relativePath = '', limit = 100, query } = parsed.data;
    return this.walk(context, refId, relativePath, limit, query.toLowerCase());
  }

  async read(
    context: ProjectLinkedDirectoryContext,
    input: unknown,
  ): Promise<ProjectLinkedDirectoryReadResult> {
    const parsed = ProjectLinkedDirectoryReadArgumentsSchema.safeParse(input);
    if (!parsed.success) return failure('invalidInput');
    try {
      const lease = await this.lease(context, parsed.data.refId);
      const path = await this.checkedPath(context, lease, parsed.data.relativePath);
      const before = await lstat(path);
      await this.ensure(context, lease);
      if (!before.isFile() || before.nlink !== 1) throw new AccessFailure('invalidInput');
      const handle = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
      let text: string;
      let truncated: boolean;
      let readIdentity: Stats;
      try {
        await this.ensure(context, lease);
        const opened = await handle.stat();
        if (!opened.isFile() || !sameIdentity(before, opened) || opened.nlink !== 1)
          throw new AccessFailure('offline');
        readIdentity = opened;
        await this.checkedPath(context, lease, parsed.data.relativePath);
        await this.recheckMembership(context, lease);
        const maximum = parsed.data.maxBytes ?? 32768;
        const buffer = Buffer.alloc(maximum);
        const { bytesRead } = await handle.read(buffer, 0, maximum, 0);
        await this.ensure(context, lease);
        const after = await handle.stat();
        if (
          !sameIdentity(opened, after) ||
          opened.size !== after.size ||
          opened.mtimeMs !== after.mtimeMs ||
          after.nlink !== 1
        )
          throw new AccessFailure('offline');
        const currentPath = await this.checkedPath(context, lease, parsed.data.relativePath);
        const current = await lstat(currentPath);
        if (!sameIdentity(opened, current)) throw new AccessFailure('offline');
        truncated = after.size > bytesRead;
        if (buffer.subarray(0, bytesRead).includes(0)) throw new AccessFailure('invalidInput');
        text = new TextDecoder('utf-8', { fatal: true }).decode(buffer.subarray(0, bytesRead), {
          stream: truncated,
        });
      } finally {
        await handle.close();
      }
      await this.checkedPath(context, lease, parsed.data.relativePath);
      await this.recheckMembership(context, lease);
      const finalCheck = (): void => {
        this.assertRootCurrent(context, lease);
        const finalFile = lstatSync(path);
        if (
          !sameIdentity(readIdentity, finalFile) ||
          finalFile.nlink !== 1 ||
          readIdentity.size !== finalFile.size ||
          readIdentity.mtimeMs !== finalFile.mtimeMs ||
          !samePath(path, realpathSync(path))
        )
          throw new AccessFailure('offline');
      };
      finalCheck();
      context.registerFinalReadCheck?.(finalCheck);
      return { ok: true, text, truncated };
    } catch (error) {
      return fromError(error);
    }
  }

  private async walk(
    context: ProjectLinkedDirectoryContext,
    refId: string,
    start: string,
    limit: number,
    query?: string,
  ): Promise<ProjectLinkedDirectoryReadResult> {
    try {
      const lease = await this.lease(context, refId);
      const queue = [{ relativePath: start, depth: 0 }];
      const entries: Entry[] = [];
      let scanned = 0;
      let truncated = false;
      while (queue.length && !truncated) {
        const next = queue.shift();
        if (!next) break;
        const path = await this.checkedPath(context, lease, next.relativePath);
        const directory = await opendir(path);
        try {
          await this.ensure(context, lease);
          while (true) {
            const child = await directory.read();
            await this.ensure(context, lease);
            if (!child) break;
            if (++scanned > 1000) {
              truncated = true;
              break;
            }
            if (child.isSymbolicLink() || (!child.isFile() && !child.isDirectory())) continue;
            const childPath = relative(lease.canonicalPath, join(path, child.name)).replace(
              /\\/g,
              '/',
            );
            if (childPath.length > 1024) continue;
            await this.checkedPath(context, lease, childPath);
            if (!query || child.name.toLowerCase().includes(query)) {
              if (entries.length === limit) {
                truncated = true;
                break;
              }
              entries.push({
                relativePath: childPath,
                kind: child.isDirectory() ? 'directory' : 'file',
              });
            }
            if (query && child.isDirectory()) {
              if (next.depth >= 16) truncated = true;
              else queue.push({ relativePath: childPath, depth: next.depth + 1 });
            }
          }
        } finally {
          await directory.close();
        }
      }
      await this.checkedPath(context, lease, start);
      await this.recheckMembership(context, lease);
      const finalCheck = (): void => this.assertRootCurrent(context, lease);
      finalCheck();
      context.registerFinalReadCheck?.(finalCheck);
      return { ok: true, entries, truncated };
    } catch (error) {
      return fromError(error);
    }
  }

  private async lease(
    context: ProjectLinkedDirectoryContext,
    refId: string,
  ): Promise<ProjectLinkedDirectoryLease> {
    const lease = await this.service.authorize(context, refId);
    if (!lease) throw new AccessFailure('authentication');
    await this.ensure(context, lease);
    return lease;
  }

  private async ensure(
    context: ProjectLinkedDirectoryContext,
    lease: ProjectLinkedDirectoryLease,
  ): Promise<void> {
    if (!context.isCurrentContext() || !lease.isCurrent())
      throw new AccessFailure('authentication');
  }

  private async recheckMembership(
    context: ProjectLinkedDirectoryContext,
    lease: ProjectLinkedDirectoryLease,
  ): Promise<void> {
    await this.ensure(context, lease);
    if (!(await this.service.checkContext(context))) throw new AccessFailure('authentication');
    await this.ensure(context, lease);
  }

  /** No await after this final disk/authority check, so delayed remote checks cannot revive roots. */
  private assertRootCurrent(
    context: ProjectLinkedDirectoryContext,
    lease: ProjectLinkedDirectoryLease,
  ): void {
    if (!context.isCurrentContext() || !lease.isCurrent())
      throw new AccessFailure('authentication');
    const info = lstatSync(lease.canonicalPath);
    if (
      !info.isDirectory() ||
      info.isSymbolicLink() ||
      !sameIdentity(info, lease.rootIdentity) ||
      !samePath(lease.canonicalPath, realpathSync(lease.canonicalPath))
    )
      throw new AccessFailure('offline');
    if (
      context.workspaceRoot &&
      pathsOverlap(realpathSync(context.workspaceRoot), lease.canonicalPath)
    )
      throw new AccessFailure('invalidInput');
  }

  private async checkedPath(
    context: ProjectLinkedDirectoryContext,
    lease: ProjectLinkedDirectoryLease,
    relativePath: string,
  ): Promise<string> {
    await this.ensure(context, lease);
    const rootInfo = await lstat(lease.canonicalPath);
    await this.ensure(context, lease);
    if (
      !rootInfo.isDirectory() ||
      rootInfo.isSymbolicLink() ||
      !sameIdentity(rootInfo, lease.rootIdentity)
    )
      throw new AccessFailure('offline');
    const root = await realpath(lease.canonicalPath);
    await this.ensure(context, lease);
    if (!samePath(root, lease.canonicalPath)) throw new AccessFailure('offline');
    if (context.workspaceRoot) {
      const workspace = await realpath(context.workspaceRoot);
      await this.ensure(context, lease);
      if (pathsOverlap(workspace, root)) throw new AccessFailure('invalidInput');
    }
    const candidate = resolve(root, relativePath);
    if (!pathContains(root, candidate)) throw new AccessFailure('invalidInput');
    let cursor = root;
    for (const segment of relative(root, candidate).split(/[\\/]/).filter(Boolean)) {
      cursor = join(cursor, segment);
      const info = await lstat(cursor);
      if (info.isSymbolicLink()) throw new AccessFailure('invalidInput');
      await this.ensure(context, lease);
    }
    const canonical = await realpath(candidate);
    if (!samePath(canonical, candidate) || !pathContains(root, canonical))
      throw new AccessFailure('invalidInput');
    await this.ensure(context, lease);
    return candidate;
  }
}

function failure(
  code: 'authentication' | 'invalidInput' | 'offline' | 'unavailable',
): ProjectLinkedDirectoryReadResult {
  return { ok: false, error: { code, referenceCode: `project-linked-directory:${code}` } };
}
function fromError(error: unknown): ProjectLinkedDirectoryReadResult {
  if (error instanceof AccessFailure) return failure(error.code);
  return failure('offline');
}
