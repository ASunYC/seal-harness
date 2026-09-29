import { lstat, realpath, stat } from 'node:fs/promises';
import { basename, isAbsolute, relative, resolve, sep, win32 } from 'node:path';

import { z } from 'zod';

type AccountKey = string;
import {
  ProjectLinkedDirectoriesResultSchema,
  type ProjectLinkedDirectoriesResult,
  type ProjectLinkedDirectoryError,
} from '../../../../projects/stratex/shared/protocol/project-workspace.js';
import type {
  ProjectLinkedDirectoryEntry,
  ProjectLinkedDirectoryIdentity,
  ProjectLinkedDirectoryPersistence,
} from './projectLinkedDirectoryStore.js';

export interface ProjectLinkedDirectoryContext {
  readonly accountKey: AccountKey;
  readonly signal?: AbortSignal;
  /**
   * 协作项目归属（模板档）。⚠️ 本地绑定归属（`localBindingId`）时**无协作项目**，故本字段可缺省——
   * 归属校验与 groupKey 会按 local > session > collab 的优先级选取实际归属键。
   */
  readonly collabProjectId?: string;
  /**
   * 本地绑定归属（轴 local，A3 本地侧）。存在时关联目录挂到**本地工作空间绑定**（设备级，
   * 键 `{scope:'local',device,bindingId}`），与会话档（`{scope:'session',…}`，靠 scope 字段区分）、
   * 协作项目档（JSON 数组 `[…]`，靠对象 vs 数组区分）**零碰撞、零迁移**。恒 `access:'read'`，
   * 与其它两档同为只读、永不进可写 cwd（D3 安全基石）。归属靠 `localBindingId`（uuid，不可猜）
   * + 上游账号门控（isCurrentContext），与会话档对称。
   */
  readonly localBindingId?: string;
  readonly isCurrentContext: () => boolean;
  /**
   * 会话归属维度（轴 B，ADR-0051 D4/D5）。存在时关联目录改挂**会话**（按 `bindingId` 分组、
   * 与协作项目那份彻底隔离，改协作项目配置动不了已存在会话的附加源）；缺省即沿用协作项目归属，
   * 那份此后是**模板**（新会话默认值来源，P5 负责冻结复制），不再是运行期权威。
   * ⛔ 归属维度改变**不**触碰只读语义：两种归属都恒 `access:'read'`，附加源永不进入可写路径判定
   * （D3 安全基石）。账号隔离随 `bindingId` 不可猜 + 上游账号门控，与轴 A（`workspace_binding_session`）
   * 按标识解析不做账号门控保持对称（ADR-0051 M1）。
   */
  readonly sessionBindingId?: string;
  /** Main injects the current writable root and membership check; never model arguments. */
  readonly workspaceRoot?: string;
  readonly isAuthorized?: () => Promise<boolean>;
  /** Main-only final disk checks, rerun after an outer adapter's last authorization await. */
  readonly registerFinalReadCheck?: (check: () => void) => void;
}

export interface ProjectLinkedDirectoryDependencies {
  readonly selectDirectory: (context: ProjectLinkedDirectoryContext) => Promise<string | null>;
  readonly canonicalize: (path: string) => Promise<string>;
  readonly directoryExists: (path: string) => Promise<boolean>;
  readonly createRefId: () => string;
  readonly deriveDisplayName?: (canonicalPath: string) => string;
  readonly getDirectoryIdentity?: (
    canonicalPath: string,
  ) => Promise<ProjectLinkedDirectoryIdentity>;
  /** Production composition supplies local persistent storage. Omission supports legacy pure tests. */
  readonly store?: ProjectLinkedDirectoryPersistence;
}

export interface ProjectLinkedDirectoryLease {
  readonly canonicalPath: string;
  readonly rootIdentity: ProjectLinkedDirectoryIdentity;
  readonly isCurrent: () => boolean;
}

/** Main-only references. Removing a reference never removes the selected directory. */
export class ProjectLinkedDirectoryService {
  private readonly groups = new Map<string, ProjectLinkedDirectoryEntry[]>();
  private stopped = false;
  constructor(private readonly deps: ProjectLinkedDirectoryDependencies) {}

  stop(): void {
    this.stopped = true;
  }

  captureReferences(context: ProjectLinkedDirectoryContext): () => boolean {
    if (this.stopped || !context.isCurrentContext()) return () => false;
    try {
      const fingerprint = JSON.stringify(this.entriesFor(context));
      return () => {
        if (this.stopped || !context.isCurrentContext()) return false;
        try {
          return JSON.stringify(this.entriesFor(context)) === fingerprint;
        } catch {
          return false;
        }
      };
    } catch {
      return () => false;
    }
  }

  async list(context: ProjectLinkedDirectoryContext): Promise<ProjectLinkedDirectoriesResult> {
    if (!(await this.checkContext(context))) return failure('authentication');
    return this.project(context);
  }

  async add(context: ProjectLinkedDirectoryContext): Promise<ProjectLinkedDirectoriesResult> {
    if (!(await this.checkContext(context))) return failure('authentication');
    let picked: string | null;
    try {
      picked = await this.deps.selectDirectory(context);
    } catch {
      return failure('unavailable');
    }
    if (!(await this.checkContext(context))) return failure('authentication');
    if (picked === null) return failure('selectionCancelled');
    if (unsafeRoot(picked)) return failure('invalidInput');
    let canonical: string;
    let rootIdentity: ProjectLinkedDirectoryIdentity | undefined;
    try {
      canonical = await this.deps.canonicalize(picked);
      if (!context.isCurrentContext()) return failure('authentication');
      if (unsafeRoot(canonical)) return failure('invalidInput');
      if (!(await this.deps.directoryExists(canonical))) return failure('offline');
      if (!context.isCurrentContext()) return failure('authentication');
      if (this.deps.getDirectoryIdentity) {
        rootIdentity = await this.deps.getDirectoryIdentity(canonical);
        if (!context.isCurrentContext()) return failure('authentication');
      }
      if (context.workspaceRoot) {
        const workspace = await this.deps.canonicalize(context.workspaceRoot);
        if (!context.isCurrentContext()) return failure('authentication');
        if (pathsOverlap(workspace, canonical)) return failure('duplicate');
      }
    } catch {
      return failure('offline');
    }
    if (!(await this.checkContext(context))) return failure('authentication');
    try {
      const entries = this.entriesFor(context);
      if (entries.some((entry) => samePath(entry.canonicalPath, canonical)))
        return failure('duplicate');
      if (entries.length >= 64) return failure('invalidInput');
      const refId = z.string().uuid().parse(this.deps.createRefId());
      const derived = this.deps.deriveDisplayName?.(canonical) ?? basename(canonical);
      const displayName = derived.trim().slice(0, 255) || 'Directory';
      this.write(context, [
        ...entries,
        { refId, displayName, canonicalPath: canonical, ...(rootIdentity ? { rootIdentity } : {}) },
      ]);
    } catch {
      return failure('persistenceUnavailable');
    }
    return this.project(context);
  }

  async remove(
    context: ProjectLinkedDirectoryContext,
    refId: string,
  ): Promise<ProjectLinkedDirectoriesResult> {
    if (!(await this.checkContext(context))) return failure('authentication');
    if (!z.string().uuid().safeParse(refId).success) return failure('invalidInput');
    try {
      this.write(
        context,
        this.entriesFor(context).filter((entry) => entry.refId !== refId),
      );
    } catch {
      return failure('persistenceUnavailable');
    }
    return this.project(context);
  }

  async rename(
    context: ProjectLinkedDirectoryContext,
    refId: string,
    displayName: string,
  ): Promise<ProjectLinkedDirectoriesResult> {
    if (!(await this.checkContext(context))) return failure('authentication');
    const parsed = z.string().trim().min(1).max(255).safeParse(displayName);
    if (!parsed.success) return failure('invalidInput');
    try {
      const entries = this.entriesFor(context);
      if (!entries.some((entry) => entry.refId === refId)) return failure('invalidInput');
      if (entries.some((entry) => entry.refId !== refId && entry.displayName === parsed.data))
        return failure('duplicate');
      this.write(
        context,
        entries.map((entry) =>
          entry.refId === refId ? { ...entry, displayName: parsed.data } : entry,
        ),
      );
    } catch {
      return failure('persistenceUnavailable');
    }
    return this.project(context);
  }

  /** Main-only lease. It is never exposed over IPC or passed as a writable root. */
  async authorize(
    context: ProjectLinkedDirectoryContext,
    refId: string,
  ): Promise<ProjectLinkedDirectoryLease | null> {
    if (!(await this.checkContext(context))) return null;
    try {
      const entry = this.entriesFor(context).find((candidate) => candidate.refId === refId);
      if (!entry?.rootIdentity) return null;
      const fingerprint = JSON.stringify(entry);
      return {
        canonicalPath: entry.canonicalPath,
        rootIdentity: entry.rootIdentity,
        isCurrent: () => {
          if (this.stopped || !context.isCurrentContext()) return false;
          try {
            return this.entriesFor(context).some(
              (candidate) => candidate.refId === refId && JSON.stringify(candidate) === fingerprint,
            );
          } catch {
            return false;
          }
        },
      };
    } catch {
      return null;
    }
  }

  async checkContext(context: ProjectLinkedDirectoryContext): Promise<boolean> {
    // 归属校验按优先级取键：本地绑定校验 `localBindingId`（轴 local），会话校验 `sessionBindingId`
    // （轴 B），否则协作项目校验 `collabProjectId`（模板）。三者皆缺或非 uuid 一律拒。
    const ownershipValid =
      context.localBindingId !== undefined
        ? z.string().uuid().safeParse(context.localBindingId).success
        : context.sessionBindingId !== undefined
          ? z.string().uuid().safeParse(context.sessionBindingId).success
          : z
              .string()
              .uuid()
              .safeParse(context.collabProjectId ?? '').success;
    if (this.stopped || !context.accountKey || !ownershipValid || !context.isCurrentContext())
      return false;
    try {
      const authorized = context.isAuthorized ? await context.isAuthorized() : true;
      return authorized && !this.stopped && context.isCurrentContext();
    } catch {
      return false;
    }
  }

  /**
   * D5 冻结播种：把某协作项目的关联目录（**模板**）复制成一份**会话自持**的附加源（轴 B）。
   * 新会话（协作）创建首轮调用一次；**幂等**——会话组已有条目就跳过（重试 / 重启不重复复制），
   * 模板为空亦不创建会话组。返回是否发生了播种（供上层区分「首轮冻结」与「已存在、跳过」）。
   *
   * 每个条目铸**新 refId**（同 `captureSessionBinding` 铸新 bindingId 的纪律）：与模板彻底隔离，
   * 此后改模板动不了已冻结会话、改会话动不了模板（A3）。⛔ `access` 恒 read——投影层写死，
   * 复制**不携带任何可写位**（D3 安全基石）；归属校验随 `sessionBindingId`（uuid）不可猜 + 上游
   * 账号门控，与轴 A 按标识解析不做账号门控对称（M1）。
   */
  seedSessionFromProjectTemplate(input: {
    readonly accountKey: AccountKey;
    readonly collabProjectId: string;
    readonly sessionBindingId: string;
  }): boolean {
    if (this.stopped || !input.accountKey) return false;
    if (!z.string().uuid().safeParse(input.sessionBindingId).success) return false;
    if (!z.string().uuid().safeParse(input.collabProjectId).success) return false;
    try {
      const sessionKey = this.groupKeyFrom({
        accountKey: input.accountKey,
        collabProjectId: input.collabProjectId,
        sessionBindingId: input.sessionBindingId,
      });
      // 幂等：会话组已有条目 ⇒ 已冻结，不再播种。
      if (this.readEntries(sessionKey).length > 0) return false;
      const template = this.readEntries(
        this.groupKeyFrom({ accountKey: input.accountKey, collabProjectId: input.collabProjectId }),
      );
      if (template.length === 0) return false;
      const seeded = template.map((entry) => ({
        ...entry,
        refId: z.string().uuid().parse(this.deps.createRefId()),
      }));
      this.writeEntries(sessionKey, seeded);
      return true;
    } catch {
      return false;
    }
  }

  private groupKey(context: ProjectLinkedDirectoryContext): string {
    return this.groupKeyFrom(context);
  }
  private groupKeyFrom(fields: {
    readonly accountKey: AccountKey;
    readonly collabProjectId?: string;
    readonly sessionBindingId?: string;
    readonly localBindingId?: string;
  }): string {
    const device = this.deps.store?.deviceId ?? 'memory';
    // 三档 groupKey（优先级 local > session > collab）刻意选互不相等的字符串形状，零碰撞零迁移：
    //   · 轴 local（本地绑定）：JSON 对象 `{scope:'local',…}` —— 与会话档靠 `scope` 字段区分；
    //   · 轴 B（会话）：JSON 对象 `{scope:'session',…}`；
    //   · 协作项目（模板）：JSON **数组** `[...]` —— 与两个对象档靠 `{` vs `[` 区分。
    // 既有模板/会话条目的键形状均不变（无需迁移、不孤立存量）。
    if (fields.localBindingId !== undefined) {
      return JSON.stringify({ scope: 'local', device, bindingId: fields.localBindingId });
    }
    if (fields.sessionBindingId !== undefined) {
      return JSON.stringify({ scope: 'session', device, bindingId: fields.sessionBindingId });
    }
    return JSON.stringify([fields.accountKey, device, fields.collabProjectId]);
  }
  private readEntries(key: string): ProjectLinkedDirectoryEntry[] {
    return this.deps.store ? this.deps.store.read(key) : (this.groups.get(key) ?? []);
  }
  private writeEntries(key: string, entries: ProjectLinkedDirectoryEntry[]): void {
    if (this.deps.store) this.deps.store.write(key, entries);
    else this.groups.set(key, entries);
  }
  private entriesFor(context: ProjectLinkedDirectoryContext): ProjectLinkedDirectoryEntry[] {
    return this.readEntries(this.groupKey(context));
  }
  private write(
    context: ProjectLinkedDirectoryContext,
    entries: ProjectLinkedDirectoryEntry[],
  ): void {
    if (this.stopped || !context.isCurrentContext()) throw new Error('Directory context expired');
    this.writeEntries(this.groupKey(context), entries);
  }

  private async project(
    context: ProjectLinkedDirectoryContext,
  ): Promise<ProjectLinkedDirectoriesResult> {
    try {
      const entries = this.entriesFor(context);
      const revision = JSON.stringify(entries);
      const directories = [];
      for (const entry of entries) {
        let available = false;
        try {
          available = await this.deps.directoryExists(entry.canonicalPath);
          if (!context.isCurrentContext()) return failure('authentication');
          if (available && entry.rootIdentity && this.deps.getDirectoryIdentity) {
            available = sameIdentity(
              entry.rootIdentity,
              await this.deps.getDirectoryIdentity(entry.canonicalPath),
            );
          }
        } catch {
          available = false;
        }
        if (!context.isCurrentContext()) return failure('authentication');
        directories.push({
          refId: entry.refId,
          displayName: entry.displayName,
          access: 'read' as const,
          availability: available ? ('available' as const) : ('offline' as const),
        });
      }
      if (!(await this.checkContext(context))) return failure('authentication');
      if (JSON.stringify(this.entriesFor(context)) !== revision) return failure('unavailable');
      return ProjectLinkedDirectoriesResultSchema.parse({ ok: true, directories });
    } catch {
      return failure('persistenceUnavailable');
    }
  }
}

export function sameIdentity(
  left: ProjectLinkedDirectoryIdentity,
  right: ProjectLinkedDirectoryIdentity,
): boolean {
  return left.dev === right.dev && left.ino === right.ino && left.birthtimeMs === right.birthtimeMs;
}
export function samePath(left: string, right: string): boolean {
  const normalizedLeft = resolve(left);
  const normalizedRight = resolve(right);
  return process.platform === 'win32'
    ? normalizedLeft.toLowerCase() === normalizedRight.toLowerCase()
    : normalizedLeft === normalizedRight;
}
export function pathContains(root: string, candidate: string): boolean {
  const rel = relative(root, candidate);
  return rel === '' || (!isAbsolute(rel) && rel !== '..' && !rel.startsWith(`..${sep}`));
}
export function pathsOverlap(left: string, right: string): boolean {
  return pathContains(left, right) || pathContains(right, left);
}
function unsafeRoot(path: string): boolean {
  return (
    path.includes('\0') ||
    /^[\\/]{2}/.test(path) ||
    path.split(/[\\/]/).includes('..') ||
    (!isAbsolute(path) && !win32.isAbsolute(path))
  );
}

export function createProjectLinkedDirectoryFileSystemDependencies(): Pick<
  ProjectLinkedDirectoryDependencies,
  'canonicalize' | 'directoryExists' | 'getDirectoryIdentity'
> {
  return {
    canonicalize: async (path) => {
      if (unsafeRoot(path)) throw new Error('Invalid directory');
      const canonical = await realpath(path);
      if (unsafeRoot(canonical) || !(await stat(canonical)).isDirectory())
        throw new Error('Invalid directory');
      return canonical;
    },
    directoryExists: async (path) => {
      try {
        return (await lstat(path)).isDirectory() && samePath(path, await realpath(path));
      } catch {
        return false;
      }
    },
    getDirectoryIdentity: async (path) => {
      const info = await lstat(path);
      if (!info.isDirectory() || info.isSymbolicLink() || !samePath(path, await realpath(path)))
        throw new Error('Invalid directory');
      return { dev: info.dev, ino: info.ino, birthtimeMs: info.birthtimeMs };
    },
  };
}

function failure(code: ProjectLinkedDirectoryError['code']): ProjectLinkedDirectoriesResult {
  return { ok: false, error: { code, referenceCode: `project-linked-directory:${code}` } };
}
