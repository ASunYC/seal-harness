import { access, mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { sessionId } from "@seal-harness/core";
import { MemorySessionStore } from "@seal-harness/session-memory";
import { DshWorkspaceRegistryBridge, WorkspaceRegistry } from "../src/workspaces.js";

const cleanup: string[] = [];
afterEach(async () => { for (const path of cleanup.splice(0)) await rm(path, { recursive: true, force: true }); });

describe("WorkspaceRegistry", () => {
  it("canonicalizes, persists, orders, renames, and safely unregisters directories", async () => {
    const root = await mkdtemp(join(tmpdir(), "seal-workspaces-")); cleanup.push(root);
    const firstPath = join(root, "first"); const secondPath = join(root, "second");
    await mkdir(firstPath); await mkdir(secondPath);
    const store = new MemorySessionStore();
    await store.create({ id: sessionId("first-session"), cwd: firstPath });
    const registryPath = join(root, "state", "workspaces.json");
    const registry = new WorkspaceRegistry(registryPath, store); await registry.start();
    expect(await registry.list()).toEqual([expect.objectContaining({ title: "first", sessionIds: ["first-session"] })]);

    const same = await registry.create(join(firstPath, "."), "ignored duplicate title");
    expect(same.title).toBe("first");
    const second = await registry.create(secondPath, "Second project");
    const first = (await registry.list()).find((item) => item.path === firstPath)!;
    await registry.rename(first.id, "First project");
    await registry.reorder([first.id, second.id]);

    const reopened = new WorkspaceRegistry(registryPath, store); await reopened.start();
    expect((await reopened.list()).map((item) => item.title)).toEqual(["First project", "Second project"]);
    expect(await reopened.remove(first.id)).toBe(true);
    await expect(access(firstPath)).resolves.toBeUndefined();
    expect((await reopened.list()).map((item) => item.id)).toEqual([second.id]);
  });

  it("archives sessions without deleting their history", async () => {
    const root = await mkdtemp(join(tmpdir(), "seal-workspaces-")); cleanup.push(root);
    const workspacePath = join(root, "project"); await mkdir(workspacePath);
    const store = new MemorySessionStore(); const id = sessionId("archivable");
    await store.create({ id, cwd: workspacePath });
    const registry = new WorkspaceRegistry(join(root, "workspaces.json"), store); await registry.start();
    await registry.archiveSession(id, true);
    expect((await registry.list())[0]?.sessionIds).toEqual([]);
    expect(await store.read(id)).toBeDefined();
    await registry.archiveSession(id, false);
    expect((await registry.list())[0]?.sessionIds).toEqual([id]);
  });

  it("persists manual session ordering within a workspace", async () => {
    const root = await mkdtemp(join(tmpdir(), "seal-workspaces-")); cleanup.push(root);
    const workspacePath = join(root, "project"); await mkdir(workspacePath);
    const store = new MemorySessionStore();
    await store.create({ id: sessionId("older"), cwd: workspacePath });
    await store.create({ id: sessionId("newer"), cwd: workspacePath });
    const path = join(root, "workspaces.json"); const registry = new WorkspaceRegistry(path, store); await registry.start();
    const workspace = (await registry.list())[0]!;
    await registry.insertSessionBefore(workspace.id, sessionId("newer"), sessionId("older"));
    expect((await registry.list())[0]?.sessionIds).toEqual(["newer", "older"]);
    const reopened = new WorkspaceRegistry(path, store); await reopened.start();
    expect((await reopened.list())[0]?.sessionIds).toEqual(["newer", "older"]);
  });

  it("persists explicit DSH-style session detach and attach operations", async () => {
    const root = await mkdtemp(join(tmpdir(), "seal-workspaces-")); cleanup.push(root);
    const workspacePath = join(root, "project"); await mkdir(workspacePath);
    const store = new MemorySessionStore(); const id = sessionId("movable");
    await store.create({ id, cwd: workspacePath });
    const path = join(root, "workspaces.json"); const registry = new WorkspaceRegistry(path, store); await registry.start();
    const workspace = (await registry.list())[0]!;
    await registry.detachSession(workspace.id, id);
    expect((await registry.list())[0]?.sessionIds).toEqual([]);
    const reopened = new WorkspaceRegistry(path, store); await reopened.start();
    expect((await reopened.list())[0]?.sessionIds).toEqual([]);
    await reopened.attachSession(workspace.id, id);
    expect((await reopened.list())[0]?.sessionIds).toEqual([id]);
  });

  it("projects the same persisted registry through the DSH workspace contract", async () => {
    const root = await mkdtemp(join(tmpdir(), "seal-workspaces-")); cleanup.push(root);
    const firstPath = join(root, "first"); const secondPath = join(root, "second");
    await mkdir(firstPath); await mkdir(secondPath);
    const store = new MemorySessionStore(); const id = sessionId("bridge-session");
    await store.create({ id, cwd: firstPath });
    const registry = new WorkspaceRegistry(join(root, "workspaces.json"), store); await registry.start();
    const bridge = new DshWorkspaceRegistryBridge(registry); await bridge.start();
    const changes: unknown[] = []; bridge.subscribeDomainChanges((change) => changes.push(change));
    const first = bridge.list()[0]!;
    expect(first).toMatchObject({ path: firstPath, title: "first", sessionIds: [id] });
    await first.setTitle("First");
    await first.detachSession(id); expect(first.sessionIds).toEqual([]);
    await first.attachSession(id); expect(first.sessionIds).toEqual([id]);
    expect(await first.status()).toBe("ok");
    const second = await bridge.create(secondPath, "Second");
    expect((await bridge.resolveByPath(secondPath))?.id).toBe(second.id);
    expect(await bridge.insertBefore(first.id)).toEqual([second.id, first.id]);
    await bridge.archiveSession(id); expect(bridge.archivedSessionIds).toEqual([id]);
    expect(await bridge.delete(second.id)).toBe(true);
    expect(changes).toEqual(expect.arrayContaining([
      expect.objectContaining({ domain: "workspace", table: "workspaces", operation: "put", key: first.id, value: expect.objectContaining({ title: "First" }) }),
      expect.objectContaining({ domain: "workspace", table: "workspaces", operation: "put", key: second.id, value: expect.objectContaining({ title: "Second" }) }),
      expect.objectContaining({ domain: "workspace", table: "", operation: "put", value: expect.objectContaining({ initialized: true, archivedSessionIds: [id] }) }),
      expect.objectContaining({ domain: "workspace", table: "workspaces", operation: "deleted", key: second.id }),
    ]));
  });

  it("rejects corrupt duplicate registry records instead of silently repairing them", async () => {
    const root = await mkdtemp(join(tmpdir(), "seal-workspaces-")); cleanup.push(root);
    const project = join(root, "project"); await mkdir(project);
    const path = join(root, "workspaces.json");
    const { writeFile } = await import("node:fs/promises");
    const record = { id: "duplicate", path: project, title: "Project", createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
    await writeFile(path, JSON.stringify({ version: 1, workspaces: [record, record], archivedSessionIds: [] }));
    await expect(new WorkspaceRegistry(path, new MemorySessionStore()).start()).rejects.toThrow("uniqueness");
  });
});
