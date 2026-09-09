import { mkdir, readFile, realpath, rename, stat, writeFile } from "node:fs/promises";
import { basename, dirname, normalize, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import type { SessionId, SessionSnapshot, SessionStore } from "@seal-harness/core";

export interface WorkspaceRecord {
  readonly id: string;
  readonly path: string;
  readonly title: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface WorkspaceView extends WorkspaceRecord {
  readonly sessionIds: readonly SessionId[];
}

interface StoredRegistry {
  readonly version: 1;
  readonly workspaces: readonly WorkspaceRecord[];
  readonly archivedSessionIds: readonly SessionId[];
  readonly sessionOrderByWorkspace: Readonly<Record<string, readonly SessionId[]>>;
  readonly detachedSessionIdsByWorkspace: Readonly<Record<string, readonly SessionId[]>>;
}

export class WorkspaceRegistry {
  #state: StoredRegistry = { version: 1, workspaces: [], archivedSessionIds: [], sessionOrderByWorkspace: {}, detachedSessionIdsByWorkspace: {} };
  #queue: Promise<unknown> = Promise.resolve();

  constructor(readonly path: string, readonly sessions: SessionStore) {}

  async start(): Promise<void> {
    try { this.#state = validate(JSON.parse(await readFile(this.path, "utf8"))); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      const snapshots = await this.sessions.list();
      const byPath = new Map<string, { path: string; createdAt: string }>();
      for (const session of snapshots) {
        const cwd = sessionCwd(session); if (cwd === undefined) continue;
        const canonical = await canonicalDirectory(cwd).catch(() => undefined); if (canonical === undefined) continue;
        const createdAt = session.events[0]?.timestamp ?? new Date(0).toISOString();
        const prior = byPath.get(canonical);
        if (prior === undefined || createdAt > prior.createdAt) byPath.set(canonical, { path: canonical, createdAt });
      }
      this.#state = { version: 1, workspaces: [...byPath.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).map((item) => ({ id: randomUUID(), path: item.path, title: basename(item.path), createdAt: item.createdAt, updatedAt: item.createdAt })), archivedSessionIds: [], sessionOrderByWorkspace: {}, detachedSessionIdsByWorkspace: {} };
      await this.#save();
    }
  }

  async list(): Promise<readonly WorkspaceView[]> {
    const snapshots = await this.sessions.list();
    const archived = new Set(this.#state.archivedSessionIds);
    const grouped = new Map(this.#state.workspaces.map((item) => [pathKey(item.path), [] as SessionId[]]));
    for (const session of snapshots) {
      if (archived.has(session.id)) continue;
      const cwd = sessionCwd(session); if (cwd === undefined) continue;
      const canonical = await canonicalDirectory(cwd).catch(() => resolve(cwd));
      grouped.get(pathKey(canonical))?.push(session.id);
    }
    return this.#state.workspaces.map((item) => { const detached = new Set(this.#state.detachedSessionIdsByWorkspace[item.id] ?? []); const discovered = (grouped.get(pathKey(item.path)) ?? []).filter((id) => !detached.has(id)); const retained = (this.#state.sessionOrderByWorkspace[item.id] ?? []).filter((id) => discovered.includes(id)); const known = new Set(retained); return { ...item, sessionIds: [...retained, ...discovered.filter((id) => !known.has(id))] }; });
  }

  async resolveByPath(path: string): Promise<WorkspaceView | undefined> {
    const canonical = await canonicalDirectory(path);
    return (await this.list()).find((item) => pathKey(item.path) === pathKey(canonical));
  }

  archivedSessionIds(): readonly SessionId[] { return [...this.#state.archivedSessionIds]; }

  create(path: string, title?: string): Promise<WorkspaceRecord> {
    return this.#serial(async () => {
      const canonical = await canonicalDirectory(path);
      const existing = this.#state.workspaces.find((item) => pathKey(item.path) === pathKey(canonical));
      if (existing !== undefined) return existing;
      const now = new Date().toISOString();
      const workspace = { id: randomUUID(), path: canonical, title: title?.trim() || basename(canonical), createdAt: now, updatedAt: now };
      this.#state = { ...this.#state, workspaces: [workspace, ...this.#state.workspaces] };
      await this.#save(); return workspace;
    });
  }

  rename(id: string, title: string): Promise<WorkspaceRecord> {
    return this.#serial(async () => {
      const trimmed = title.trim(); if (!trimmed) throw new Error("Workspace title must not be empty");
      const current = this.#state.workspaces.find((item) => item.id === id); if (current === undefined) throw new WorkspaceNotFoundError(id);
      const updated = { ...current, title: trimmed, updatedAt: new Date().toISOString() };
      this.#state = { ...this.#state, workspaces: this.#state.workspaces.map((item) => item.id === id ? updated : item) };
      await this.#save(); return updated;
    });
  }

  remove(id: string): Promise<boolean> {
    return this.#serial(async () => {
      if (!this.#state.workspaces.some((item) => item.id === id)) return false;
      const { [id]: _removed, ...sessionOrderByWorkspace } = this.#state.sessionOrderByWorkspace;
      const { [id]: _detached, ...detachedSessionIdsByWorkspace } = this.#state.detachedSessionIdsByWorkspace;
      this.#state = { ...this.#state, workspaces: this.#state.workspaces.filter((item) => item.id !== id), sessionOrderByWorkspace, detachedSessionIdsByWorkspace };
      await this.#save(); return true;
    });
  }

  reorder(ids: readonly string[]): Promise<void> {
    return this.#serial(async () => {
      if (ids.length !== this.#state.workspaces.length || new Set(ids).size !== ids.length || ids.some((id) => !this.#state.workspaces.some((item) => item.id === id))) throw new Error("Workspace order must contain every workspace exactly once");
      const byId = new Map(this.#state.workspaces.map((item) => [item.id, item]));
      this.#state = { ...this.#state, workspaces: ids.map((id) => byId.get(id)!) };
      await this.#save();
    });
  }

  archiveSession(id: SessionId, archived: boolean): Promise<void> {
    return this.#serial(async () => {
      if (await this.sessions.read(id) === undefined) throw new Error(`Session not found: ${id}`);
      const values = new Set(this.#state.archivedSessionIds); if (archived) values.add(id); else values.delete(id);
      this.#state = { ...this.#state, archivedSessionIds: [...values] };
      await this.#save();
    });
  }

  insertSessionBefore(workspaceId: string, id: SessionId, beforeId?: SessionId): Promise<void> {
    return this.#serial(async () => {
      const workspace = (await this.list()).find((item) => item.id === workspaceId);
      if (workspace === undefined) throw new WorkspaceNotFoundError(workspaceId);
      if (!workspace.sessionIds.includes(id)) throw new Error(`Session ${id} does not belong to Workspace ${workspaceId}`);
      const order = workspace.sessionIds.filter((candidate) => candidate !== id);
      const index = beforeId === undefined ? order.length : order.indexOf(beforeId);
      if (beforeId !== undefined && index < 0) throw new Error(`Anchor Session ${beforeId} does not belong to Workspace ${workspaceId}`);
      order.splice(index, 0, id);
      this.#state = { ...this.#state, sessionOrderByWorkspace: { ...this.#state.sessionOrderByWorkspace, [workspaceId]: order } };
      await this.#save();
    });
  }

  attachSession(workspaceId: string, id: SessionId): Promise<void> {
    return this.#serial(async () => {
      const workspace = this.#state.workspaces.find((item) => item.id === workspaceId);
      if (workspace === undefined) throw new WorkspaceNotFoundError(workspaceId);
      const session = await this.sessions.read(id);
      if (session === undefined) throw new Error(`Session not found: ${id}`);
      const cwd = sessionCwd(session);
      if (cwd === undefined || pathKey(await canonicalDirectory(cwd)) !== pathKey(workspace.path)) {
        throw new Error(`Session ${id} does not belong to Workspace ${workspaceId}`);
      }
      const detached = (this.#state.detachedSessionIdsByWorkspace[workspaceId] ?? []).filter((candidate) => candidate !== id);
      this.#state = { ...this.#state, detachedSessionIdsByWorkspace: { ...this.#state.detachedSessionIdsByWorkspace, [workspaceId]: detached } };
      await this.#save();
    });
  }

  detachSession(workspaceId: string, id: SessionId): Promise<void> {
    return this.#serial(async () => {
      const workspace = this.#state.workspaces.find((item) => item.id === workspaceId);
      if (workspace === undefined) throw new WorkspaceNotFoundError(workspaceId);
      const current = await this.list();
      if (!current.find((item) => item.id === workspaceId)?.sessionIds.includes(id)) return;
      const detached = new Set(this.#state.detachedSessionIdsByWorkspace[workspaceId] ?? []);
      detached.add(id);
      this.#state = {
        ...this.#state,
        sessionOrderByWorkspace: {
          ...this.#state.sessionOrderByWorkspace,
          [workspaceId]: (this.#state.sessionOrderByWorkspace[workspaceId] ?? []).filter((candidate) => candidate !== id),
        },
        detachedSessionIdsByWorkspace: { ...this.#state.detachedSessionIdsByWorkspace, [workspaceId]: [...detached] },
      };
      await this.#save();
    });
  }

  async #save(): Promise<void> {
    await mkdir(dirname(this.path), { recursive: true });
    const temporary = `${this.path}.${process.pid}.${randomUUID()}.tmp`;
    await writeFile(temporary, `${JSON.stringify(this.#state, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
    await rename(temporary, this.path);
  }

  #serial<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.#queue.catch(() => undefined).then(operation);
    this.#queue = result.then(() => undefined, () => undefined); return result;
  }
}

export class WorkspaceNotFoundError extends Error {
  constructor(readonly workspaceId: string) { super(`Workspace not found: ${workspaceId}`); }
}

/** DSH workspaceRegistry facade over the Web registry's single persisted truth. */
export class DshWorkspaceRegistryBridge {
  #views = new Map<string, WorkspaceView>();
  #entities = new Map<string, DshWorkspaceEntity>();
  #archived: readonly SessionId[] = [];
  #domainListeners = new Set<(change: DshWorkspaceDomainChange) => void>();

  constructor(readonly registry: WorkspaceRegistry) {}

  async start(): Promise<void> { await this.refresh(false); }

  subscribeDomainChanges(listener: (change: DshWorkspaceDomainChange) => void): () => void {
    this.#domainListeners.add(listener);
    return () => { this.#domainListeners.delete(listener); };
  }

  list(): readonly DshWorkspaceEntity[] {
    return [...this.#views.keys()].map((id) => this.entity(id));
  }

  get(id: string): DshWorkspaceEntity | undefined {
    return this.#views.has(id) ? this.entity(id) : undefined;
  }

  async create(path: string, title?: string): Promise<DshWorkspaceEntity> {
    const created = await this.registry.create(path, title);
    await this.refresh();
    return this.entity(created.id);
  }

  async resolveByPath(path: string): Promise<DshWorkspaceEntity | undefined> {
    const found = await this.registry.resolveByPath(path);
    return found === undefined ? undefined : this.entity(found.id);
  }

  async delete(id: string): Promise<boolean> {
    const deleted = await this.registry.remove(id);
    await this.refresh();
    return deleted;
  }

  async insertBefore(id: string, beforeId?: string): Promise<readonly string[]> {
    const ids = [...this.#views.keys()];
    if (!ids.includes(id) || (beforeId !== undefined && !ids.includes(beforeId))) throw new WorkspaceNotFoundError(beforeId ?? id);
    const reordered = ids.filter((candidate) => candidate !== id);
    reordered.splice(beforeId === undefined ? reordered.length : reordered.indexOf(beforeId), 0, id);
    await this.registry.reorder(reordered);
    await this.refresh();
    return reordered;
  }

  get archivedSessionIds(): readonly SessionId[] { return this.registry.archivedSessionIds(); }

  async archiveSession(id: SessionId): Promise<void> {
    await this.registry.archiveSession(id, true);
    await this.refresh();
  }

  view(id: string): WorkspaceView {
    const view = this.#views.get(id);
    if (view === undefined) throw new WorkspaceNotFoundError(id);
    return view;
  }

  async refresh(publish = true): Promise<void> {
    const previous = this.#views;
    const previousOrder = [...previous.keys()];
    const previousArchived = this.#archived;
    const views = await this.registry.list();
    this.#views = new Map(views.map((view) => [view.id, view]));
    this.#archived = [...this.registry.archivedSessionIds()];
    for (const id of [...this.#entities.keys()]) if (!this.#views.has(id)) this.#entities.delete(id);
    if (!publish) return;
    for (const [id, view] of this.#views) {
      const prior = previous.get(id);
      if (prior !== undefined && sameWorkspaceView(prior, view)) continue;
      this.emitDomain({ domain: "workspace", table: "workspaces", operation: "put", key: id, value: workspaceDomainRecord(view) });
    }
    for (const id of previous.keys()) {
      if (!this.#views.has(id)) this.emitDomain({ domain: "workspace", table: "workspaces", operation: "deleted", key: id });
    }
    const order = [...this.#views.keys()];
    if (!sameStrings(previousOrder, order) || !sameStrings(previousArchived, this.#archived)) {
      this.emitDomain({ domain: "workspace", table: "", operation: "put", key: "", value: { initialized: true, workspaceIds: order, archivedSessionIds: [...this.#archived] } });
    }
  }

  private emitDomain(change: DshWorkspaceDomainChange): void {
    for (const listener of this.#domainListeners) listener(change);
  }

  private entity(id: string): DshWorkspaceEntity {
    let entity = this.#entities.get(id);
    if (entity === undefined) { entity = new DshWorkspaceEntity(this, id); this.#entities.set(id, entity); }
    return entity;
  }
}

export type DshWorkspaceDomainChange = Readonly<{
  domain: "workspace";
  table: "" | "workspaces";
  operation: "put" | "deleted";
  key: string;
  value?: unknown;
}>;

function workspaceDomainRecord(view: WorkspaceView): Readonly<Record<string, unknown>> {
  return { path: view.path, title: view.title, sessionIds: [...view.sessionIds], createdAt: view.createdAt, updatedAt: view.updatedAt };
}

function sameWorkspaceView(left: WorkspaceView, right: WorkspaceView): boolean {
  return left.path === right.path && left.title === right.title && left.createdAt === right.createdAt && left.updatedAt === right.updatedAt && sameStrings(left.sessionIds, right.sessionIds);
}

function sameStrings(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

export class DshWorkspaceEntity {
  constructor(readonly bridge: DshWorkspaceRegistryBridge, readonly id: string) {}
  get path(): string { return this.bridge.view(this.id).path; }
  get title(): string { return this.bridge.view(this.id).title; }
  get createdAt(): string { return this.bridge.view(this.id).createdAt; }
  get updatedAt(): string { return this.bridge.view(this.id).updatedAt; }
  get sessionIds(): readonly SessionId[] { return this.bridge.view(this.id).sessionIds; }
  async setTitle(title: string): Promise<void> { await this.bridge.registry.rename(this.id, title); await this.bridge.refresh(); }
  async attachSession(id: SessionId): Promise<void> { await this.bridge.registry.attachSession(this.id, id); await this.bridge.refresh(); }
  async insertSessionBefore(id: SessionId, beforeId?: SessionId): Promise<void> { await this.bridge.registry.insertSessionBefore(this.id, id, beforeId); await this.bridge.refresh(); }
  async detachSession(id: SessionId): Promise<void> { await this.bridge.registry.detachSession(this.id, id); await this.bridge.refresh(); }
  async status(): Promise<"ok" | "missing-dir"> { try { return (await stat(this.path)).isDirectory() ? "ok" : "missing-dir"; } catch { return "missing-dir"; } }
}

async function canonicalDirectory(path: string): Promise<string> {
  const resolved = await realpath(resolve(path));
  if (!(await stat(resolved)).isDirectory()) throw new Error(`Workspace is not a directory: ${path}`);
  return normalize(resolved);
}

function pathKey(path: string): string { const normalized = normalize(path); return process.platform === "win32" ? normalized.toLowerCase() : normalized; }
function sessionCwd(session: SessionSnapshot): string | undefined {
  const event = session.events.find((entry) => entry.event.type === "session.created")?.event;
  return event?.type === "session.created" ? event.payload.cwd : undefined;
}

function validate(value: unknown): StoredRegistry {
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid workspace registry");
  const record = value as Record<string, unknown>;
  if (record.version !== 1 || !Array.isArray(record.workspaces) || !Array.isArray(record.archivedSessionIds)) throw new Error("Invalid workspace registry");
  const workspaces = record.workspaces.map((item) => {
    if (item === null || typeof item !== "object" || Array.isArray(item)) throw new Error("Invalid workspace record");
    const entry = item as Record<string, unknown>;
    for (const key of ["id", "path", "title", "createdAt", "updatedAt"]) if (typeof entry[key] !== "string" || entry[key] === "") throw new Error(`Invalid workspace ${key}`);
    return entry as unknown as WorkspaceRecord;
  });
  if (new Set(workspaces.map((item) => item.id)).size !== workspaces.length || new Set(workspaces.map((item) => pathKey(item.path))).size !== workspaces.length || record.archivedSessionIds.some((id) => typeof id !== "string")) throw new Error("Invalid workspace registry uniqueness");
  const rawOrder = record.sessionOrderByWorkspace ?? {};
  if (rawOrder === null || typeof rawOrder !== "object" || Array.isArray(rawOrder) || Object.values(rawOrder).some((ids) => !Array.isArray(ids) || ids.some((id) => typeof id !== "string") || new Set(ids).size !== ids.length)) throw new Error("Invalid workspace session order");
  const rawDetached = record.detachedSessionIdsByWorkspace ?? {};
  if (rawDetached === null || typeof rawDetached !== "object" || Array.isArray(rawDetached) || Object.values(rawDetached).some((ids) => !Array.isArray(ids) || ids.some((id) => typeof id !== "string") || new Set(ids).size !== ids.length)) throw new Error("Invalid detached workspace sessions");
  return { version: 1, workspaces, archivedSessionIds: record.archivedSessionIds as SessionId[], sessionOrderByWorkspace: rawOrder as Record<string, SessionId[]>, detachedSessionIdsByWorkspace: rawDetached as Record<string, SessionId[]> };
}
